import { describe, it, expect, vi, beforeEach } from 'vitest';
import { withRetry } from '../src/utils/retry.js';

// Silence console.log during tests
beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('withRetry', () => {
  it('should return the result on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should retry on failure and succeed on 2nd attempt', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce('recovered');

    const onRetry = vi.fn();
    const result = await withRetry(fn, {
      maxRetries: 3,
      baseDelayMs: 1,
      maxDelayMs: 10,
      onRetry,
    });

    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(1, expect.any(Error));
  });

  it('should give up after maxRetries and throw the last error', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('always fails'));

    await expect(
      withRetry(fn, { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 10 }),
    ).rejects.toThrow('always fails');

    // 1 initial attempt + 2 retries = 3 total
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('should apply exponential backoff between retries', async () => {
    const timestamps: number[] = [];
    const fn = vi.fn().mockImplementation(() => {
      timestamps.push(Date.now());
      return Promise.reject(new Error('fail'));
    });

    await expect(
      withRetry(fn, {
        maxRetries: 2,
        baseDelayMs: 50,
        maxDelayMs: 5000,
        backoffMultiplier: 2,
      }),
    ).rejects.toThrow('fail');

    expect(timestamps.length).toBe(3);
    // Second gap should be >= first gap (exponential backoff)
    const gap1 = timestamps[1]! - timestamps[0]!;
    const gap2 = timestamps[2]! - timestamps[1]!;
    // gap1 should be around baseDelayMs (50ms + jitter), gap2 around baseDelayMs * 2 (100ms + jitter)
    // Use generous bounds since timers aren't precise
    expect(gap1).toBeGreaterThanOrEqual(30);
    expect(gap2).toBeGreaterThanOrEqual(gap1 * 0.8); // second gap should be roughly >= first
  });

  it('should not retry errors that are not in retryableErrors', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('validation failed'));

    await expect(
      withRetry(fn, {
        maxRetries: 3,
        baseDelayMs: 1,
        maxDelayMs: 10,
        retryableErrors: ['ECONNREFUSED', 'ETIMEDOUT'],
      }),
    ).rejects.toThrow('validation failed');

    // Only the initial attempt — no retries for non-retryable errors
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should retry errors that match retryableErrors', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED: connection refused'))
      .mockResolvedValueOnce('ok');

    const result = await withRetry(fn, {
      maxRetries: 3,
      baseDelayMs: 1,
      maxDelayMs: 10,
      retryableErrors: ['ECONNREFUSED', 'ETIMEDOUT'],
    });

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should handle non-Error rejections', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce('string error')
      .mockResolvedValueOnce('ok');

    const result = await withRetry(fn, {
      maxRetries: 1,
      baseDelayMs: 1,
      maxDelayMs: 10,
    });

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should use default options when none provided', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce('ok');

    // This uses defaults: maxRetries=3, baseDelayMs=1000
    // Override delays for speed but don't pass maxRetries — should still work
    const result = await withRetry(fn, { baseDelayMs: 1, maxDelayMs: 10 });

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
