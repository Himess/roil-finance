import { EventEmitter } from 'node:events';
import { config } from '../config.js';
import { logger } from '../monitoring/logger.js';

/**
 * Transaction stream subscriber for Canton Ledger API v2.
 * Uses /v2/updates/flat for real-time contract event processing.
 *
 * On devnet/mainnet, this replaces polling-based contract queries
 * with push-based event processing for lower latency.
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

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    logger.info('Transaction stream starting', { parties: this.parties });

    // Fetch current ledger end as starting offset
    // Note: In production with auth enabled, add Authorization header here.
    // For devnet/mainnet with participant-level auth, the stream endpoint may require JWT.
    try {
      const endRes = await fetch(`${this.baseUrl}/v2/state/ledger-end`, {
        headers: { 'Content-Type': 'application/json' },
      });
      const endData = await endRes.json() as { offset: string };
      this.offset = endData.offset;
      logger.info('Transaction stream initialized', { offset: this.offset });
    } catch (err) {
      logger.error('Failed to fetch ledger-end for stream', { error: String(err) });
      this.isRunning = false;
      return;
    }

    // Start streaming loop
    this.streamLoop().catch(err => {
      logger.error('Transaction stream loop failed', { error: String(err) });
      this.isRunning = false;
    });
  }

  private async streamLoop(): Promise<void> {
    while (this.isRunning) {
      try {
        this.abortController = new AbortController();
        const res = await fetch(`${this.baseUrl}/v2/updates/flat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            beginExclusive: this.offset,
            filter: {
              filtersByParty: Object.fromEntries(
                this.parties.map(p => [p, { cumulative: [] }])
              ),
            },
          }),
          signal: this.abortController.signal,
        });

        if (!res.ok) {
          logger.warn('Stream request failed, retrying in 5s', { status: res.status });
          await new Promise(r => setTimeout(r, 5000));
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
      } catch (err: any) {
        if (err.name === 'AbortError') break;
        logger.warn('Stream connection lost, reconnecting in 5s', { error: String(err) });
        await new Promise(r => setTimeout(r, 5000));
      }
    }
  }

  private handleEvent(event: any): void {
    if (event.offset) {
      this.offset = event.offset;
    }

    const events = event.eventsById ? Object.values(event.eventsById) : [];
    for (const ev of events as any[]) {
      if (ev.CreatedEvent) {
        const { templateId, contractId, createArguments } = ev.CreatedEvent;
        logger.debug('Contract created', { templateId, contractId });

        // Dispatch based on template
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
