import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import { config, TOKEN_STANDARD } from './config.js';
import { withRetry } from './utils/retry.js';
import { ledgerBreaker } from './utils/circuit-breaker.js';
import { LedgerError } from './utils/errors.js';
import { decimalToNumber } from './utils/decimal.js';

// ---------------------------------------------------------------------------
// Types — Canton JSON Ledger API v2
// ---------------------------------------------------------------------------

export interface DamlContract<T = Record<string, unknown>> {
  contractId: string;
  templateId: string;
  payload: T;
  createdEventBlob?: string;
}

export interface SubmitResult {
  transaction?: {
    events: Array<{
      CreatedEvent?: { contractId: string; templateId: string; createArguments: Record<string, unknown> };
      ExercisedEvent?: { contractId: string; choice: string; exerciseResult: unknown };
    }>;
  };
}

export interface ActiveContractsResult<T = Record<string, unknown>> {
  activeContracts: Array<{
    contractId: string;
    templateId: string;
    createArguments: T;
    createdEventBlob?: string;
  }>;
  offset: number;
}

/** Shape returned by the v2 /state/active-contracts endpoint */
export interface ActiveContractsResponse {
  contractEntry?: {
    JsActiveContract?: {
      createdEvent: {
        contractId: string;
        templateId: string;
        createArgument?: Record<string, unknown>;
        createArguments?: Record<string, unknown>;
        createdEventBlob?: string;
      };
    };
  };
  contractId?: string;
  templateId?: string;
  createArgument?: Record<string, unknown>;
  createArguments?: Record<string, unknown>;
  createdEventBlob?: string;
}

// ---------------------------------------------------------------------------
// JWT Builder — supports multiple signing modes
// ---------------------------------------------------------------------------

function buildJwt(actAs: string[], readAs: string[]): string {
  const header: Record<string, string> = { typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);

  const payload: Record<string, unknown> = {
    sub: config.ledgerUserId,
    aud: config.jwtAudience,
    iss: config.applicationId,
    iat: now,
    nbf: now - 30, // 30s clock skew tolerance for Canton
    exp: now + 3600,
    scope: 'daml_ledger_api',
    actAs,
    readAs,
    applicationId: config.applicationId,
  };

  switch (config.jwtMode) {
    case 'unsafe': {
      // Unsigned JWT — accepted by Canton sandbox / cn-quickstart dev mode
      header.alg = 'none';
      const h = Buffer.from(JSON.stringify(header)).toString('base64url');
      const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
      return `${h}.${p}.`;
    }

    case 'hmac256': {
      header.alg = 'HS256';
      const h = Buffer.from(JSON.stringify(header)).toString('base64url');
      const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
      const sig = crypto.createHmac('sha256', config.jwtSecret)
        .update(`${h}.${p}`)
        .digest('base64url');
      return `${h}.${p}.${sig}`;
    }

    case 'rs256': {
      header.alg = 'RS256';
      const h = Buffer.from(JSON.stringify(header)).toString('base64url');
      const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
      const key = fs.readFileSync(config.jwtPrivateKeyPath, 'utf-8');
      const sig = crypto.createSign('RSA-SHA256')
        .update(`${h}.${p}`)
        .sign(key, 'base64url');
      return `${h}.${p}.${sig}`;
    }

    case 'es256': {
      header.alg = 'ES256';
      const h = Buffer.from(JSON.stringify(header)).toString('base64url');
      const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
      const key = fs.readFileSync(config.jwtPrivateKeyPath, 'utf-8');
      const sig = crypto.createSign('SHA256')
        .update(`${h}.${p}`)
        .sign({ key, dsaEncoding: 'ieee-p1363' }, 'base64url');
      return `${h}.${p}.${sig}`;
    }
  }
}

// ---------------------------------------------------------------------------
// DamlLedger — Canton JSON Ledger API v2 client
// ---------------------------------------------------------------------------

export class DamlLedger {
  private readonly baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl ?? config.jsonApiUrl;
  }

  // -----------------------------------------------------------------------
  // HTTP helpers
  // -----------------------------------------------------------------------

  private async post<T>(path: string, body: unknown, actAs: string[], readAs?: string[]): Promise<T> {
    return ledgerBreaker.execute(() =>
      withRetry(
        async () => {
          const token = buildJwt(actAs, readAs ?? actAs);
          const res = await fetch(`${this.baseUrl}${path}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(30_000),
          });

          if (!res.ok) {
            const text = await res.text();
            throw new LedgerError(
              `Ledger API ${path} failed (${res.status}): ${text}`,
              res.status,
            );
          }

          return res.json() as Promise<T>;
        },
        {
          maxRetries: 3,
          baseDelayMs: 500,
          maxDelayMs: 5000,
          retryableErrors: ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'fetch failed', '502', '503', '504'],
        },
      ),
    );
  }

  private async get<T>(path: string, actAs: string[]): Promise<T> {
    return ledgerBreaker.execute(() =>
      withRetry(
        async () => {
          const token = buildJwt(actAs, actAs);
          const res = await fetch(`${this.baseUrl}${path}`, {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(30_000),
          });

          if (!res.ok) {
            const text = await res.text();
            throw new LedgerError(
              `Ledger API GET ${path} failed (${res.status}): ${text}`,
              res.status,
            );
          }

          return res.json() as Promise<T>;
        },
        {
          maxRetries: 3,
          baseDelayMs: 500,
          maxDelayMs: 5000,
          retryableErrors: ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'fetch failed', '502', '503', '504'],
        },
      ),
    );
  }

  // -----------------------------------------------------------------------
  // Health
  // -----------------------------------------------------------------------

  async health(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/livez`, {
        signal: AbortSignal.timeout(30_000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  // -----------------------------------------------------------------------
  // Commands — v2 API
  // -----------------------------------------------------------------------

  /**
   * Create a contract and wait for the transaction result.
   *
   * Idempotency: The commandId is used by Canton to deduplicate commands.
   * If a command times out and is retried internally (via withRetry), the
   * same commandId is reused because it is generated BEFORE entering the
   * retry loop. For application-level retries (caller retrying create()),
   * pass an explicit commandId to ensure at-most-once semantics.
   */
  async create(
    templateId: string,
    createArguments: Record<string, unknown>,
    actAs: string[],
    commandId?: string,
  ): Promise<SubmitResult> {
    // Generate commandId OUTSIDE the retry loop so retries reuse the same ID.
    // Canton deduplicates commands with the same commandId, preventing duplicates.
    const finalCommandId = commandId ?? `cmd-${Date.now()}-${crypto.randomUUID()}`;
    return this.post<SubmitResult>(
      '/v2/commands/submit-and-wait',
      {
        commands: [{
          CreateCommand: { templateId, createArguments },
        }],
        userId: config.ledgerUserId,
        actAs,
        commandId: finalCommandId,
      },
      actAs,
    );
  }

  /**
   * Exercise a choice on an existing contract.
   *
   * Idempotency: The commandId is used by Canton to deduplicate commands.
   * If a command times out and is retried internally (via withRetry), the
   * same commandId is reused because it is generated BEFORE entering the
   * retry loop. For application-level retries (caller retrying exercise()),
   * pass an explicit commandId to ensure at-most-once semantics.
   */
  async exercise(
    templateId: string,
    contractId: string,
    choice: string,
    choiceArgument: Record<string, unknown>,
    actAs: string[],
    commandId?: string,
  ): Promise<SubmitResult> {
    // Generate commandId OUTSIDE the retry loop so retries reuse the same ID.
    // Canton deduplicates commands with the same commandId, preventing duplicates.
    const finalCommandId = commandId ?? `cmd-${Date.now()}-${crypto.randomUUID()}`;
    return this.post<SubmitResult>(
      '/v2/commands/submit-and-wait',
      {
        commands: [{
          ExerciseCommand: { templateId, contractId, choice, choiceArgument },
        }],
        userId: config.ledgerUserId,
        actAs,
        commandId: finalCommandId,
      },
      actAs,
    );
  }

  /**
   * Query active contracts by template, optionally filtered by party.
   *
   * Canton JSON Ledger API v2 returns contracts as of a single offset
   * (`activeAtOffset`), so this is a point-in-time snapshot rather than
   * a streaming query. A `limit` is included in the request body; if the
   * response size reaches the limit we log a warning so operators see the
   * potential truncation and can raise the limit or iterate via updates.
   *
   * For unbounded iteration use `iterateActiveContracts`.
   */
  async queryContracts<T = Record<string, unknown>>(
    filtersByParty: Record<string, { templateIds: string[] }>,
    actAs: string[],
    opts: { limit?: number } = {},
  ): Promise<DamlContract<T>[]> {
    const limit = opts.limit ?? 2000;
    const filters: Record<string, unknown> = {};
    for (const [party, f] of Object.entries(filtersByParty)) {
      filters[party] = {
        cumulative: f.templateIds.map(tid => ({
          identifierFilter: {
            TemplateFilter: { value: { templateId: tid, includeCreatedEventBlob: true } },
          },
        })),
      };
    }

    // Get current ledger end offset (required by v2 API)
    const ledgerEnd = await this.get<{ offset: number }>('/v2/state/ledger-end', actAs);

    const result = await this.post<{ activeContracts?: ActiveContractsResponse[] } | ActiveContractsResponse[]>(
      '/v2/state/active-contracts',
      {
        eventFormat: { filtersByParty: filters, verbose: true },
        activeAtOffset: ledgerEnd.offset,
        limit,
      },
      actAs,
    );

    // v2 API returns array of { contractEntry: { JsActiveContract: { createdEvent: {...} } } }
    const rawContracts: ActiveContractsResponse[] = Array.isArray(result)
      ? result
      : ((result as { activeContracts?: ActiveContractsResponse[] }).activeContracts || []);

    // Warn if the response is at or near the limit — likely truncation.
    if (rawContracts.length >= limit) {
      const templates = Object.values(filtersByParty)
        .flatMap((f) => f.templateIds)
        .join(',');
      // Lazy import to avoid a cycle with monitoring/logger at module load
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      void import('./monitoring/logger.js').then(({ logger }) =>
        logger.warn('active-contracts snapshot reached limit — possible truncation', {
          limit,
          count: rawContracts.length,
          templates,
          parties: Object.keys(filtersByParty),
        }),
      );
    }

    return rawContracts.map((item: ActiveContractsResponse) => {
      // Handle v2 nested format
      const event = item?.contractEntry?.JsActiveContract?.createdEvent ?? item;
      return {
        contractId: event.contractId ?? item.contractId,
        templateId: event.templateId ?? item.templateId,
        payload: event.createArgument ?? event.createArguments ?? item.createArguments,
        createdEventBlob: event.createdEventBlob ?? item.createdEventBlob,
      } as DamlContract<T>;
    });
  }

  /**
   * Unbounded iteration over active contracts. Yields contracts in batches
   * until no more are returned. Uses a rising `limit` per call — callers that
   * truly need the full set should consume this generator exhaustively.
   *
   * NOTE: v2 `active-contracts` is a snapshot; there is no cursor. To avoid
   * missing updates this helper re-queries at a fresh ledger offset on each
   * iteration, so the result may include contracts archived between calls.
   * Consumers should deduplicate by `contractId`.
   */
  async *iterateActiveContracts<T = Record<string, unknown>>(
    filtersByParty: Record<string, { templateIds: string[] }>,
    actAs: string[],
    batchSize = 2000,
  ): AsyncGenerator<DamlContract<T>[], void, unknown> {
    let currentLimit = batchSize;
    const maxLimit = 50_000; // hard ceiling to prevent runaway growth
    while (currentLimit <= maxLimit) {
      const batch = await this.queryContracts<T>(filtersByParty, actAs, { limit: currentLimit });
      yield batch;
      if (batch.length < currentLimit) return; // no truncation → done
      currentLimit = Math.min(currentLimit * 2, maxLimit); // widen window on next pass
    }
  }

  /**
   * Convenience: query contracts of a single template for a single party.
   */
  async query<T = Record<string, unknown>>(
    templateId: string,
    party: string,
  ): Promise<DamlContract<T>[]> {
    return this.queryContracts<T>(
      { [party]: { templateIds: [templateId] } },
      [party],
    );
  }

  // -----------------------------------------------------------------------
  // Package management
  // -----------------------------------------------------------------------

  /**
   * Upload a DAR file to the participant node.
   */
  async uploadDar(darPath: string, actAs: string[]): Promise<void> {
    await ledgerBreaker.execute(() =>
      withRetry(
        async () => {
          const darContent = fs.readFileSync(darPath);
          const token = buildJwt(actAs, actAs);
          const res = await fetch(`${this.baseUrl}/v2/packages`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/octet-stream',
              Authorization: `Bearer ${token}`,
            },
            body: darContent,
            signal: AbortSignal.timeout(30_000),
          });

          if (!res.ok) {
            const text = await res.text();
            throw new LedgerError(
              `DAR upload failed (${res.status}): ${text}`,
              res.status,
            );
          }
        },
        {
          maxRetries: 2,
          baseDelayMs: 1000,
          maxDelayMs: 5000,
          retryableErrors: ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'fetch failed', '502', '503', '504'],
        },
      ),
    );
  }

  /**
   * List uploaded packages.
   */
  async listPackages(actAs: string[]): Promise<string[]> {
    const result = await this.get<{ packageIds: string[] }>('/v2/packages', actAs);
    return result.packageIds || [];
  }

  // -----------------------------------------------------------------------
  // Party management
  // -----------------------------------------------------------------------

  /**
   * Allocate a new party on the participant node.
   */
  async allocateParty(
    partyIdHint: string,
    displayName: string,
    actAs: string[],
  ): Promise<{ party: string }> {
    return this.post<{ party: string }>(
      '/v2/parties',
      { partyIdHint, displayName },
      actAs,
    );
  }

  // -----------------------------------------------------------------------
  // Cost estimation
  // -----------------------------------------------------------------------

  /**
   * Estimate transaction cost before execution.
   */
  async estimateCost(
    commands: unknown[],
    actAs: string[],
  ): Promise<{ totalTrafficCostEstimation: number }> {
    const result = await this.post<{ costEstimation: { totalTrafficCostEstimation: number } }>(
      '/v2/interactive-submission/prepare',
      {
        commands,
        userId: config.ledgerUserId,
        actAs,
      },
      actAs,
    );
    return result.costEstimation;
  }

  // -----------------------------------------------------------------------
  // Convenience wrappers (accept single party string for backwards compat)
  // -----------------------------------------------------------------------

  /** Create — accepts single party string, returns contract ID */
  async createAs(
    templateId: string,
    createArguments: Record<string, unknown>,
    party: string,
  ): Promise<string> {
    const result = await this.create(templateId, createArguments, [party]);
    return extractCreatedContractId(result);
  }

  /** Exercise — accepts single party string, returns exercise result */
  async exerciseAs<R = unknown>(
    templateId: string,
    contractId: string,
    choice: string,
    choiceArgument: Record<string, unknown>,
    party: string,
  ): Promise<R> {
    const result = await this.exercise(templateId, contractId, choice, choiceArgument, [party]);
    return extractExerciseResult<R>(result);
  }

  /** Query — already takes single party, re-export for clarity */
  // query() method already defined above with single party

  // -----------------------------------------------------------------------
  // Package hash resolution
  // -----------------------------------------------------------------------

  private _cachedPackageHash: string | null = null;

  /**
   * Resolve the roil-finance package hash by querying /v2/packages.
   * Caches the result after the first successful resolution.
   *
   * On localnet, returns null (package-name references work natively).
   * On devnet/testnet/mainnet, the JSON API requires the full hash.
   */
  async resolvePackageHash(packageName?: string): Promise<string | null> {
    if (this._cachedPackageHash) return this._cachedPackageHash;
    if (config.network === 'localnet') return null;

    const targetName = packageName ?? config.damlPackageName;

    try {
      const packageIds = await this.listPackages([config.platformParty]);

      for (const pid of packageIds) {
        try {
          const meta = await this.get<{ name?: string; packageName?: string }>(
            `/v2/packages/${pid}`,
            [config.platformParty],
          );

          if (meta.name === targetName || meta.packageName === targetName) {
            this._cachedPackageHash = pid;
            return pid;
          }
        } catch {
          // Skip this package
        }
      }

      // Single non-system package heuristic
      if (packageIds.length === 1) {
        this._cachedPackageHash = packageIds[0];
        return packageIds[0];
      }
    } catch {
      // Network error — return null
    }

    return null;
  }

  /** Clear cached package hash (for testing or re-resolution). */
  resetPackageHashCache(): void {
    this._cachedPackageHash = null;
  }

  // -----------------------------------------------------------------------
  // Party balance (fee budget checking)
  // -----------------------------------------------------------------------

  /**
   * Get a party's balance for a specific asset.
   *
   * Queries CIP-0056 Holding contracts and sums amounts matching the
   * given asset symbol. Useful for fee budget checking before executing
   * transactions.
   */
  async getPartyBalance(party: string, asset: string): Promise<number> {
    try {
      const holdings = await this.query<{
        owner: string;
        instrument: { id: string; admin: string };
        amount: string;
      }>(TOKEN_STANDARD.Holding, party);

      let total = 0;
      for (const h of holdings) {
        const payload = h.payload;
        if (payload?.instrument?.id === asset && payload?.owner === party) {
          total += decimalToNumber(payload.amount || '0');
        }
      }

      return total;
    } catch {
      return 0;
    }
  }
}

// ---------------------------------------------------------------------------
// Result extraction helpers
// ---------------------------------------------------------------------------

/** Extract the first created contract ID from a SubmitResult */
export function extractCreatedContractId(result: SubmitResult): string {
  const events = result.transaction?.events ?? [];
  for (const event of events) {
    if (event.CreatedEvent) return event.CreatedEvent.contractId;
  }
  throw new Error('No CreatedEvent found in transaction result');
}

/** Extract the exercise result from a SubmitResult */
export function extractExerciseResult<R = unknown>(result: SubmitResult): R {
  const events = result.transaction?.events ?? [];
  for (const event of events) {
    if (event.ExercisedEvent) return event.ExercisedEvent.exerciseResult as R;
  }
  throw new Error('No ExercisedEvent found in transaction result');
}

/** Singleton ledger client */
export const ledger = new DamlLedger();
