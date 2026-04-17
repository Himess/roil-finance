import { EventEmitter } from 'node:events';
import { config } from '../config.js';
import { logger } from '../monitoring/logger.js';
import { buildJwt } from '../ledger.js';

/**
 * Transaction stream subscriber for Canton Ledger API v2.
 *
 * Subscribes to `/v2/updates` and emits parsed events so engines can react
 * without polling. All requests are authenticated with a JWT signed by the
 * platform party — devnet/testnet/mainnet participants all gate the updates
 * endpoint. A fresh JWT is minted per request so long-running streams never
 * hit the 60-minute token expiry.
 */
export class TransactionStream extends EventEmitter {
  private offset: string = '';
  private isRunning = false;
  private abortController?: AbortController;

  constructor(
    private readonly baseUrl: string = config.jsonApiUrl,
    private readonly parties: string[] = [config.platformParty],
  ) {
    super();
  }

  /** Mint a fresh JWT for ledger API calls made from this stream. */
  private authHeader(): string {
    return `Bearer ${buildJwt(this.parties, this.parties)}`;
  }

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    logger.info('Transaction stream starting', { parties: this.parties });

    // Fetch current ledger end as starting offset (authenticated).
    try {
      const endRes = await fetch(`${this.baseUrl}/v2/state/ledger-end`, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: this.authHeader(),
        },
      });
      if (!endRes.ok) {
        logger.error('ledger-end fetch failed', { status: endRes.status });
        this.isRunning = false;
        return;
      }
      const endData = (await endRes.json()) as { offset: string | number };
      this.offset = String(endData.offset);
      logger.info('Transaction stream initialized', { offset: this.offset });
    } catch (err) {
      logger.error('Failed to fetch ledger-end for stream', { error: String(err) });
      this.isRunning = false;
      return;
    }

    // Start streaming loop
    this.streamLoop().catch((err) => {
      logger.error('Transaction stream loop failed', { error: String(err) });
      this.isRunning = false;
    });
  }

  private async streamLoop(): Promise<void> {
    while (this.isRunning) {
      try {
        this.abortController = new AbortController();
        const res = await fetch(`${this.baseUrl}/v2/updates`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: this.authHeader(),
          },
          body: JSON.stringify({
            beginExclusive: this.offset,
            filter: {
              filtersByParty: Object.fromEntries(
                this.parties.map((p) => [p, { cumulative: [] }]),
              ),
            },
          }),
          signal: this.abortController.signal,
        });

        if (!res.ok) {
          logger.warn('Stream request failed, retrying in 5s', { status: res.status });
          await new Promise((r) => setTimeout(r, 5000));
          continue;
        }

        // Process streaming response (newline-delimited JSON)
        const reader = res.body?.getReader();
        if (!reader) {
          logger.warn('Transaction stream reader is null, skipping cycle');
          continue;
        }

        const decoder = new TextDecoder();
        let buffer = '';

        while (this.isRunning) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const event = JSON.parse(line);
              this.handleEvent(event);
            } catch {
              // Skip malformed lines
            }
          }
        }
      } catch (err: unknown) {
        const e = err as { name?: string; message?: string };
        if (e?.name === 'AbortError') break;
        logger.warn('Stream connection lost, reconnecting in 5s', { error: String(err) });
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }

  // v2 /v2/updates returns newline-delimited JSON where each line is an Update
  // envelope with one of these shapes:
  //   { transaction: { offset, events: [...] } }
  //   { reassignment: { offset, events: [...] } }
  //   { offsetCheckpoint: { offset } }
  // Events inside transactions are either { CreatedEvent: {...} } or
  // { ArchivedEvent: {...} }. The prior `event.eventsById` shape was a stale
  // v1 format and never fired under v2.
  private handleEvent(envelope: unknown): void {
    const env = envelope as {
      transaction?: { offset?: string; events?: unknown[] };
      reassignment?: { offset?: string; events?: unknown[] };
      offsetCheckpoint?: { offset?: string };
    };

    const offset =
      env.transaction?.offset ??
      env.reassignment?.offset ??
      env.offsetCheckpoint?.offset;
    if (offset) this.offset = String(offset);

    const events = env.transaction?.events ?? env.reassignment?.events ?? [];
    for (const ev of events as Array<{
      CreatedEvent?: { templateId?: string; contractId?: string; createArguments?: unknown };
      ArchivedEvent?: { templateId?: string; contractId?: string };
    }>) {
      if (ev.CreatedEvent) {
        const { templateId, contractId, createArguments } = ev.CreatedEvent;
        logger.debug('Contract created', { templateId, contractId });

        if (templateId?.includes('RebalanceLog')) {
          this.emit('rebalance-completed', { contractId, payload: createArguments });
        } else if (templateId?.includes('DCALog')) {
          this.emit('dca-executed', { contractId, payload: createArguments });
        } else if (templateId?.includes('RewardPayout')) {
          this.emit('reward-distributed', { contractId, payload: createArguments });
        } else if (templateId?.includes('SwapLog')) {
          this.emit('swap-completed', { contractId, payload: createArguments });
        } else if (templateId?.includes('Portfolio')) {
          this.emit('portfolio-updated', { contractId, payload: createArguments });
        }
      }
      if (ev.ArchivedEvent) {
        const { templateId, contractId } = ev.ArchivedEvent;
        logger.debug('Contract archived', { templateId, contractId });
        this.emit('contract-archived', { templateId, contractId });
      }
    }
  }

  stop(): void {
    this.isRunning = false;
    this.abortController?.abort();
    logger.info('Transaction stream stopped');
  }

  getOffset(): string {
    return this.offset;
  }
}

// Singleton instance (initialized but not started — call start() when ready)
export const transactionStream = new TransactionStream();
