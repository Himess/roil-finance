import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import { config } from './config.js';
import { withRetry } from './utils/retry.js';
import { ledgerBreaker } from './utils/circuit-breaker.js';
import { LedgerError } from './utils/errors.js';

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
      const res = await fetch(`${this.baseUrl}/livez`);
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
   */
  async create(
    templateId: string,
    createArguments: Record<string, unknown>,
    actAs: string[],
    commandId?: string,
  ): Promise<SubmitResult> {
    return this.post<SubmitResult>(
      '/v2/commands/submit-and-wait',
      {
        commands: [{
          CreateCommand: { templateId, createArguments },
        }],
        userId: config.ledgerUserId,
        actAs,
        commandId: commandId ?? `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      },
      actAs,
    );
  }

  /**
   * Exercise a choice on an existing contract.
   */
  async exercise(
    templateId: string,
    contractId: string,
    choice: string,
    choiceArgument: Record<string, unknown>,
    actAs: string[],
    commandId?: string,
  ): Promise<SubmitResult> {
    return this.post<SubmitResult>(
      '/v2/commands/submit-and-wait',
      {
        commands: [{
          ExerciseCommand: { templateId, contractId, choice, choiceArgument },
        }],
        userId: config.ledgerUserId,
        actAs,
        commandId: commandId ?? `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      },
      actAs,
    );
  }

  /**
   * Query active contracts by template, optionally filtered by party.
   */
  async queryContracts<T = Record<string, unknown>>(
    filtersByParty: Record<string, { templateIds: string[] }>,
    actAs: string[],
  ): Promise<DamlContract<T>[]> {
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

    const result = await this.post<ActiveContractsResult<T>>(
      '/v2/state/active-contracts',
      { eventFormat: { filtersByParty: filters } },
      actAs,
    );

    return (result.activeContracts || []).map(c => ({
      contractId: c.contractId,
      templateId: c.templateId,
      payload: c.createArguments,
      createdEventBlob: c.createdEventBlob,
    }));
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

  /** Create — accepts single party string for convenience */
  async createAs(
    templateId: string,
    createArguments: Record<string, unknown>,
    party: string,
  ): Promise<string> {
    const result = await this.create(templateId, createArguments, [party]);
    return extractCreatedContractId(result);
  }

  /** Exercise — accepts single party string for convenience */
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
