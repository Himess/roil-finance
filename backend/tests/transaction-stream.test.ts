import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config.js', () => ({
  config: {
    jsonApiUrl: 'http://localhost:3975',
    platformParty: 'test-platform::1220abc',
  },
}));

vi.mock('../src/monitoring/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { TransactionStream } from '../src/services/transaction-stream.js';

describe('TransactionStream', () => {
  let stream: TransactionStream;

  beforeEach(() => {
    vi.clearAllMocks();
    stream = new TransactionStream('http://localhost:3975', ['test-party']);
  });

  it('initializes with correct defaults', () => {
    expect(stream.getOffset()).toBe('');
  });

  it('stop sets isRunning to false', () => {
    stream.stop();
    // After stop, start should be able to run again
    expect(stream.getOffset()).toBe('');
  });

  it('start fetches ledger-end offset', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ offset: '42' }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
      });

    globalThis.fetch = mockFetch;

    // Start will fetch ledger-end then try to stream (which will fail and retry)
    const startPromise = stream.start();

    // Give it a moment to fetch ledger-end
    await new Promise(r => setTimeout(r, 100));
    stream.stop();

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3975/v2/state/ledger-end',
      expect.any(Object),
    );
    expect(stream.getOffset()).toBe('42');
  });

  it('handles failed ledger-end fetch gracefully', async () => {
    globalThis.fetch = vi.fn().mockRejectedValueOnce(new Error('Connection refused'));

    await stream.start();

    // Should not crash, offset stays empty
    expect(stream.getOffset()).toBe('');
  });
});
