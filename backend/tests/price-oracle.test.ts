import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PriceOracle } from '../src/services/price-oracle.js';

// ---------------------------------------------------------------------------
// Mock cantex module
// ---------------------------------------------------------------------------

const mockGetPrices = vi.fn();
const mockGetPoolInfo = vi.fn();

vi.mock('../src/cantex.js', () => ({
  cantex: {
    getPrices: (...args: unknown[]) => mockGetPrices(...args),
    getPoolInfo: (...args: unknown[]) => mockGetPoolInfo(...args),
  },
}));

// Mock config
vi.mock('../src/config.js', () => ({
  config: {
    network: 'localnet',
    cantexApiUrl: 'http://localhost:6100',
  },
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PriceOracle', () => {
  let oracle: PriceOracle;

  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock responses
    mockGetPrices.mockResolvedValue({ CC: 0.15, USDCx: 1.0, CBTC: 40_000.0 });
    mockGetPoolInfo.mockResolvedValue([
      { pair: 'CC/USDCx', liquidity: 2_000_000, volume24h: 500_000, fee: 0.003 },
      { pair: 'CBTC/USDCx', liquidity: 5_000_000, volume24h: 1_200_000, fee: 0.003 },
    ]);

    // Create with short TTL for testing
    oracle = new PriceOracle(100); // 100ms TTL
  });

  afterEach(() => {
    oracle.stopPolling();
  });

  // -----------------------------------------------------------------------
  // Cache behavior
  // -----------------------------------------------------------------------

  describe('cache', () => {
    it('should return cached value within TTL', async () => {
      // First call populates cache
      const first = await oracle.getPrice('CC');
      expect(first.source).toBe('cantex');
      expect(first.priceUsdcx).toBe(0.15);
      expect(first.confidence).toBe('high');

      // Second call should use cache (no new Cantex call)
      const second = await oracle.getPrice('CC');
      expect(second.source).toBe('cantex');
      expect(second.priceUsdcx).toBe(0.15);

      // getPrices should have been called only once (batch fetch)
      expect(mockGetPrices).toHaveBeenCalledTimes(1);
    });

    it('should expire cache after TTL', async () => {
      // First call
      await oracle.getPrice('CC');
      expect(mockGetPrices).toHaveBeenCalledTimes(1);

      // Wait for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Second call should fetch again
      await oracle.getPrice('CC');
      expect(mockGetPrices).toHaveBeenCalledTimes(2);
    });
  });

  // -----------------------------------------------------------------------
  // Fallback behavior
  // -----------------------------------------------------------------------

  describe('fallback', () => {
    it('should fall back to hardcoded price when Cantex is unavailable', async () => {
      mockGetPrices.mockRejectedValue(new Error('Connection refused'));

      const price = await oracle.getPrice('CC');

      expect(price.source).toBe('fallback');
      expect(price.confidence).toBe('low');
      expect(price.priceUsdcx).toBe(0.15); // Hardcoded fallback
    });

    it('should fall back to cached value (stale) when Cantex is unavailable', async () => {
      // First: populate cache
      await oracle.getPrice('CC');

      // Wait for TTL expiry
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Now Cantex is unavailable
      mockGetPrices.mockRejectedValue(new Error('Timeout'));

      const price = await oracle.getPrice('CC');

      expect(price.source).toBe('cached');
      expect(price.confidence).toBe('medium');
      expect(price.priceUsdcx).toBe(0.15); // Stale cached value
    });

    it('should return fallback for unknown assets', async () => {
      mockGetPrices.mockResolvedValue({ CC: 0.15 }); // No UNKNOWN asset

      // PriceOracle.getPrice tries to get from Cantex, but the asset isn't there.
      // Since the Cantex response doesn't contain UNKNOWN, it falls back.
      mockGetPrices.mockRejectedValue(new Error('Not found'));

      const price = await oracle.getPrice('UNKNOWN');

      expect(price.source).toBe('fallback');
      expect(price.priceUsdcx).toBe(1.0); // Default fallback
    });
  });

  // -----------------------------------------------------------------------
  // Conversion
  // -----------------------------------------------------------------------

  describe('convert', () => {
    it('should convert between assets correctly', async () => {
      // CC price = 0.15 USDCx, CBTC price = 40000 USDCx
      // 1000 CC = 1000 * 0.15 = 150 USDCx = 150 / 40000 CBTC = 0.00375 CBTC
      const result = await oracle.convert('CC', 'CBTC', 1000);

      expect(result).toBeCloseTo(0.00375, 5);
    });

    it('should return same amount when converting to same asset', async () => {
      const result = await oracle.convert('CC', 'CC', 500);
      expect(result).toBe(500);
    });

    it('should convert USDCx to CC correctly', async () => {
      // 100 USDCx = 100 / 0.15 CC = 666.67 CC
      const result = await oracle.convert('USDCx', 'CC', 100);
      expect(result).toBeCloseTo(666.67, 1);
    });

    it('should convert CBTC to USDCx correctly', async () => {
      // 0.5 CBTC = 0.5 * 40000 = 20000 USDCx
      const result = await oracle.convert('CBTC', 'USDCx', 0.5);
      expect(result).toBeCloseTo(20_000, 0);
    });
  });

  // -----------------------------------------------------------------------
  // Price history
  // -----------------------------------------------------------------------

  describe('price history', () => {
    it('should track price history from getPrice calls', async () => {
      // Make a price call to populate history
      await oracle.getPrice('CC');

      const history = await oracle.getPriceHistory('CC', 1);

      expect(history.length).toBe(1);
      expect(history[0].price).toBe(0.15);
      expect(history[0].timestamp).toBeTruthy();
    });

    it('should accumulate history across multiple calls', async () => {
      // First call
      await oracle.getPrice('CC');

      // Wait for cache to expire
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Change mock price
      mockGetPrices.mockResolvedValue({ CC: 0.16, USDCx: 1.0, CBTC: 40_000.0 });

      // Second call
      await oracle.getPrice('CC');

      const history = await oracle.getPriceHistory('CC', 1);

      expect(history.length).toBe(2);
      expect(history[0].price).toBe(0.15);
      expect(history[1].price).toBe(0.16);
    });

    it('should filter history by time window', async () => {
      await oracle.getPrice('CC');

      // Request with 0 hours window should return nothing (point is just now, at boundary)
      // Request with 1 hour window should return the point
      const history1h = await oracle.getPriceHistory('CC', 1);
      expect(history1h.length).toBe(1);
    });

    it('should return empty array for asset with no history', async () => {
      const history = await oracle.getPriceHistory('UNKNOWN', 24);
      expect(history).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // getAllPrices
  // -----------------------------------------------------------------------

  describe('getAllPrices', () => {
    it('should return prices for all supported assets', async () => {
      const prices = await oracle.getAllPrices();

      expect(prices.CC).toBeDefined();
      expect(prices.USDCx).toBeDefined();
      expect(prices.CBTC).toBeDefined();

      expect(prices.CC.priceUsdcx).toBe(0.15);
      expect(prices.USDCx.priceUsdcx).toBe(1.0);
      expect(prices.CBTC.priceUsdcx).toBe(40_000.0);
    });

    it('should have high confidence when Cantex is available', async () => {
      const prices = await oracle.getAllPrices();

      expect(prices.CC.confidence).toBe('high');
      expect(prices.CC.source).toBe('cantex');
    });
  });

  // -----------------------------------------------------------------------
  // Polling
  // -----------------------------------------------------------------------

  describe('polling', () => {
    it('should start and stop polling without errors', () => {
      // Should not throw
      oracle.startPolling(50);

      // Starting again should be a no-op (not create multiple intervals)
      oracle.startPolling(50);

      oracle.stopPolling();
    });

    it('should populate cache and history when polling', async () => {
      oracle.startPolling(50);

      // Wait for at least one poll cycle
      await new Promise((resolve) => setTimeout(resolve, 100));

      oracle.stopPolling();

      // Cache should be populated
      const price = await oracle.getPrice('CC');
      expect(price.priceUsdcx).toBe(0.15);

      // History should have at least one entry
      const history = await oracle.getPriceHistory('CC', 1);
      expect(history.length).toBeGreaterThanOrEqual(1);
    });
  });
});
