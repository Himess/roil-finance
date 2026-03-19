import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/monitoring/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { CircuitBreaker } from '../src/utils/circuit-breaker.js';

// Silence console.log during tests
beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('CircuitBreaker', () => {
  function createBreaker(overrides: Partial<{
    failureThreshold: number;
    resetTimeoutMs: number;
    successThreshold: number;
  }> = {}) {
    return new CircuitBreaker({
      name: 'test-service',
      failureThreshold: 3,
      resetTimeoutMs: 100,
      successThreshold: 2,
      ...overrides,
    });
  }

  it('should start in closed state', () => {
    const breaker = createBreaker();
    expect(breaker.getState()).toBe('closed');
    expect(breaker.getStats()).toEqual({
      state: 'closed',
      failures: 0,
      successes: 0,
    });
  });

  it('should pass calls through when closed', async () => {
    const breaker = createBreaker();
    const result = await breaker.execute(() => Promise.resolve('hello'));
    expect(result).toBe('hello');
    expect(breaker.getState()).toBe('closed');
  });

  it('should open after failureThreshold consecutive failures', async () => {
    const breaker = createBreaker({ failureThreshold: 3 });

    for (let i = 0; i < 3; i++) {
      await expect(
        breaker.execute(() => Promise.reject(new Error(`fail-${i}`))),
      ).rejects.toThrow();
    }

    expect(breaker.getState()).toBe('open');
    expect(breaker.getStats().failures).toBe(3);
  });

  it('should reject calls immediately when open', async () => {
    const breaker = createBreaker({ failureThreshold: 2, resetTimeoutMs: 60_000 });

    // Open the circuit
    for (let i = 0; i < 2; i++) {
      await expect(
        breaker.execute(() => Promise.reject(new Error('fail'))),
      ).rejects.toThrow('fail');
    }

    expect(breaker.getState()).toBe('open');

    // Should reject without calling the function
    const fn = vi.fn().mockResolvedValue('should not be called');
    await expect(breaker.execute(fn)).rejects.toThrow(
      'Circuit breaker [test-service] is OPEN',
    );
    expect(fn).not.toHaveBeenCalled();
  });

  it('should transition to half-open after resetTimeoutMs', async () => {
    const breaker = createBreaker({ failureThreshold: 2, resetTimeoutMs: 50 });

    // Open the circuit
    for (let i = 0; i < 2; i++) {
      await expect(
        breaker.execute(() => Promise.reject(new Error('fail'))),
      ).rejects.toThrow();
    }
    expect(breaker.getState()).toBe('open');

    // Wait for reset timeout
    await new Promise((r) => setTimeout(r, 60));

    // Next call should go through (half-open)
    const result = await breaker.execute(() => Promise.resolve('probe'));
    expect(result).toBe('probe');
    // After 1 success, not yet at successThreshold of 2 — still half-open
    expect(breaker.getState()).toBe('half-open');
  });

  it('should close after successThreshold successes in half-open', async () => {
    const breaker = createBreaker({
      failureThreshold: 2,
      resetTimeoutMs: 50,
      successThreshold: 2,
    });

    // Open the circuit
    for (let i = 0; i < 2; i++) {
      await expect(
        breaker.execute(() => Promise.reject(new Error('fail'))),
      ).rejects.toThrow();
    }
    expect(breaker.getState()).toBe('open');

    // Wait for reset timeout
    await new Promise((r) => setTimeout(r, 60));

    // First success — transitions to half-open, then counts success
    await breaker.execute(() => Promise.resolve('ok'));
    expect(breaker.getState()).toBe('half-open');

    // Second success — reaches successThreshold, transitions to closed
    await breaker.execute(() => Promise.resolve('ok'));
    expect(breaker.getState()).toBe('closed');
    expect(breaker.getStats().failures).toBe(0);
    expect(breaker.getStats().successes).toBe(0); // reset on close
  });

  it('should re-open on failure during half-open', async () => {
    const breaker = createBreaker({
      failureThreshold: 2,
      resetTimeoutMs: 50,
      successThreshold: 2,
    });

    // Open the circuit
    for (let i = 0; i < 2; i++) {
      await expect(
        breaker.execute(() => Promise.reject(new Error('fail'))),
      ).rejects.toThrow();
    }
    expect(breaker.getState()).toBe('open');

    // Wait for reset timeout
    await new Promise((r) => setTimeout(r, 60));

    // Probe with a failure — should re-open immediately
    await expect(
      breaker.execute(() => Promise.reject(new Error('still broken'))),
    ).rejects.toThrow('still broken');

    expect(breaker.getState()).toBe('open');
  });

  it('should reset failure count on a success while closed', async () => {
    const breaker = createBreaker({ failureThreshold: 3 });

    // 2 failures (not enough to open)
    for (let i = 0; i < 2; i++) {
      await expect(
        breaker.execute(() => Promise.reject(new Error('fail'))),
      ).rejects.toThrow();
    }
    expect(breaker.getStats().failures).toBe(2);

    // 1 success resets the counter
    await breaker.execute(() => Promise.resolve('ok'));
    expect(breaker.getStats().failures).toBe(0);
    expect(breaker.getState()).toBe('closed');

    // Now need full 3 failures to open
    for (let i = 0; i < 2; i++) {
      await expect(
        breaker.execute(() => Promise.reject(new Error('fail'))),
      ).rejects.toThrow();
    }
    expect(breaker.getState()).toBe('closed'); // still closed — only 2 of 3
  });

  it('reset() should restore to initial closed state', async () => {
    const breaker = createBreaker({ failureThreshold: 2 });

    // Open the circuit
    for (let i = 0; i < 2; i++) {
      await expect(
        breaker.execute(() => Promise.reject(new Error('fail'))),
      ).rejects.toThrow();
    }
    expect(breaker.getState()).toBe('open');

    // Manual reset
    breaker.reset();

    expect(breaker.getState()).toBe('closed');
    expect(breaker.getStats()).toEqual({
      state: 'closed',
      failures: 0,
      successes: 0,
    });

    // Should work normally again
    const result = await breaker.execute(() => Promise.resolve('after-reset'));
    expect(result).toBe('after-reset');
  });
});
