import { describe, it, expect, beforeEach } from 'vitest';
import { metrics, METRICS, type MetricValue } from '../src/monitoring/metrics.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MetricsRegistry', () => {
  beforeEach(() => {
    metrics.reset();
  });

  // -------------------------------------------------------------------------
  // Counter
  // -------------------------------------------------------------------------

  describe('counters', () => {
    it('should increment a counter by 1 by default', () => {
      metrics.increment('test_counter');
      metrics.increment('test_counter');

      const json = metrics.toJSON();
      expect(json.counters).toHaveLength(1);
      expect(json.counters[0].name).toBe('test_counter');
      expect(json.counters[0].value).toBe(2);
      expect(json.counters[0].type).toBe('counter');
    });

    it('should increment a counter by a custom amount', () => {
      metrics.increment('test_counter', {}, 5);
      metrics.increment('test_counter', {}, 3);

      const json = metrics.toJSON();
      expect(json.counters[0].value).toBe(8);
    });

    it('should track counters with different labels independently', () => {
      metrics.increment('http_total', { method: 'GET' });
      metrics.increment('http_total', { method: 'POST' });
      metrics.increment('http_total', { method: 'GET' });

      const json = metrics.toJSON();
      expect(json.counters).toHaveLength(2);

      const get = json.counters.find((c) => c.labels.method === 'GET');
      const post = json.counters.find((c) => c.labels.method === 'POST');
      expect(get?.value).toBe(2);
      expect(post?.value).toBe(1);
    });

    it('should include labels in JSON export', () => {
      metrics.increment('req', { route: '/api', status: '200' });

      const json = metrics.toJSON();
      expect(json.counters[0].labels).toEqual({ route: '/api', status: '200' });
    });
  });

  // -------------------------------------------------------------------------
  // Gauge
  // -------------------------------------------------------------------------

  describe('gauges', () => {
    it('should set a gauge value', () => {
      metrics.setGauge('active_connections', 42);

      const json = metrics.toJSON();
      expect(json.gauges).toHaveLength(1);
      expect(json.gauges[0].value).toBe(42);
      expect(json.gauges[0].type).toBe('gauge');
    });

    it('should overwrite previous gauge value', () => {
      metrics.setGauge('temperature', 20);
      metrics.setGauge('temperature', 25);
      metrics.setGauge('temperature', 18);

      const json = metrics.toJSON();
      expect(json.gauges).toHaveLength(1);
      expect(json.gauges[0].value).toBe(18);
    });

    it('should track gauges with different labels independently', () => {
      metrics.setGauge('pool_size', 10, { pool: 'a' });
      metrics.setGauge('pool_size', 20, { pool: 'b' });

      const json = metrics.toJSON();
      expect(json.gauges).toHaveLength(2);

      const a = json.gauges.find((g) => g.labels.pool === 'a');
      const b = json.gauges.find((g) => g.labels.pool === 'b');
      expect(a?.value).toBe(10);
      expect(b?.value).toBe(20);
    });
  });

  // -------------------------------------------------------------------------
  // Histogram
  // -------------------------------------------------------------------------

  describe('histograms', () => {
    it('should record observed values', () => {
      metrics.observe('latency', 100);
      metrics.observe('latency', 200);
      metrics.observe('latency', 150);

      const json = metrics.toJSON();
      expect(json.histograms).toHaveLength(1);
      expect(json.histograms[0].type).toBe('histogram');
      // average = (100 + 200 + 150) / 3 = 150
      expect(json.histograms[0].value).toBe(150);
      expect(json.histograms[0].labels._count).toBe('3');
      expect(json.histograms[0].labels._sum).toBe('450');
    });

    it('should track histograms with different labels independently', () => {
      metrics.observe('duration', 10, { route: '/a' });
      metrics.observe('duration', 20, { route: '/a' });
      metrics.observe('duration', 50, { route: '/b' });

      const json = metrics.toJSON();
      expect(json.histograms).toHaveLength(2);

      const a = json.histograms.find((h) => h.labels.route === '/a');
      const b = json.histograms.find((h) => h.labels.route === '/b');
      expect(a?.labels._count).toBe('2');
      expect(a?.labels._sum).toBe('30');
      expect(b?.labels._count).toBe('1');
      expect(b?.labels._sum).toBe('50');
    });
  });

  // -------------------------------------------------------------------------
  // Prometheus text format
  // -------------------------------------------------------------------------

  describe('toPrometheusText', () => {
    it('should produce valid Prometheus text for counters', () => {
      metrics.increment('http_requests_total', { method: 'GET', status: '200' });
      metrics.increment('http_requests_total', { method: 'GET', status: '200' });

      const text = metrics.toPrometheusText();
      expect(text).toContain('# HELP http_requests_total Counter');
      expect(text).toContain('# TYPE http_requests_total counter');
      expect(text).toContain('http_requests_total{method="GET",status="200"} 2');
    });

    it('should produce valid Prometheus text for gauges', () => {
      metrics.setGauge('active_portfolios', 5);

      const text = metrics.toPrometheusText();
      expect(text).toContain('# HELP active_portfolios Gauge');
      expect(text).toContain('# TYPE active_portfolios gauge');
      expect(text).toContain('active_portfolios 5');
    });

    it('should produce _count and _sum for histograms', () => {
      metrics.observe('request_duration_ms', 100);
      metrics.observe('request_duration_ms', 200);

      const text = metrics.toPrometheusText();
      expect(text).toContain('# HELP request_duration_ms Histogram');
      expect(text).toContain('# TYPE request_duration_ms histogram');
      expect(text).toContain('request_duration_ms_count 2');
      expect(text).toContain('request_duration_ms_sum 300');
    });

    it('should handle metrics without labels', () => {
      metrics.increment('simple_counter');

      const text = metrics.toPrometheusText();
      // No braces for unlabelled metrics
      expect(text).toContain('simple_counter 1');
      expect(text).not.toContain('simple_counter{');
    });

    it('should not duplicate HELP/TYPE for same metric name with different labels', () => {
      metrics.increment('req', { method: 'GET' });
      metrics.increment('req', { method: 'POST' });

      const text = metrics.toPrometheusText();
      const helpCount = (text.match(/# HELP req/g) || []).length;
      const typeCount = (text.match(/# TYPE req/g) || []).length;
      expect(helpCount).toBe(1);
      expect(typeCount).toBe(1);
    });

    it('should end with a newline', () => {
      metrics.increment('test');
      const text = metrics.toPrometheusText();
      expect(text.endsWith('\n')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // JSON export
  // -------------------------------------------------------------------------

  describe('toJSON', () => {
    it('should return counters, gauges, and histograms arrays', () => {
      const json = metrics.toJSON();
      expect(json).toHaveProperty('counters');
      expect(json).toHaveProperty('gauges');
      expect(json).toHaveProperty('histograms');
      expect(Array.isArray(json.counters)).toBe(true);
      expect(Array.isArray(json.gauges)).toBe(true);
      expect(Array.isArray(json.histograms)).toBe(true);
    });

    it('should include timestamps in entries', () => {
      metrics.increment('test_counter');
      const json = metrics.toJSON();

      const now = Date.now();
      expect(json.counters[0].timestamp).toBeLessThanOrEqual(now);
      expect(json.counters[0].timestamp).toBeGreaterThan(now - 1000);
    });

    it('should include all metric types in a mixed export', () => {
      metrics.increment('counter_a');
      metrics.setGauge('gauge_b', 99);
      metrics.observe('histo_c', 42);

      const json = metrics.toJSON();
      expect(json.counters).toHaveLength(1);
      expect(json.gauges).toHaveLength(1);
      expect(json.histograms).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // Reset
  // -------------------------------------------------------------------------

  describe('reset', () => {
    it('should clear all counters, gauges, and histograms', () => {
      metrics.increment('counter_1');
      metrics.increment('counter_2');
      metrics.setGauge('gauge_1', 10);
      metrics.observe('histo_1', 100);

      metrics.reset();

      const json = metrics.toJSON();
      expect(json.counters).toHaveLength(0);
      expect(json.gauges).toHaveLength(0);
      expect(json.histograms).toHaveLength(0);
    });

    it('should produce empty Prometheus text after reset', () => {
      metrics.increment('test');
      metrics.reset();

      const text = metrics.toPrometheusText();
      expect(text.trim()).toBe('');
    });
  });

  // -------------------------------------------------------------------------
  // Labels
  // -------------------------------------------------------------------------

  describe('labels', () => {
    it('should treat different label combinations as separate series', () => {
      metrics.increment('req', { method: 'GET', route: '/a' });
      metrics.increment('req', { method: 'GET', route: '/b' });
      metrics.increment('req', { method: 'POST', route: '/a' });

      const json = metrics.toJSON();
      expect(json.counters).toHaveLength(3);
    });

    it('should produce consistent keys regardless of label insertion order', () => {
      metrics.increment('req', { b: '2', a: '1' });
      metrics.increment('req', { a: '1', b: '2' });

      // Same sorted key → same counter, value should be 2
      const json = metrics.toJSON();
      expect(json.counters).toHaveLength(1);
      expect(json.counters[0].value).toBe(2);
    });

    it('should default to empty labels when none provided', () => {
      metrics.increment('no_labels');

      const json = metrics.toJSON();
      expect(json.counters[0].labels).toEqual({});
    });
  });

  // -------------------------------------------------------------------------
  // Pre-defined METRICS constants
  // -------------------------------------------------------------------------

  describe('METRICS constants', () => {
    it('should define expected metric names', () => {
      expect(METRICS.httpRequestsTotal).toBe('http_requests_total');
      expect(METRICS.httpRequestDurationMs).toBe('http_request_duration_ms');
      expect(METRICS.rebalancesExecuted).toBe('rebalances_executed_total');
      expect(METRICS.dcaExecuted).toBe('dca_executed_total');
      expect(METRICS.activePortfolios).toBe('active_portfolios');
      expect(METRICS.activeDcaSchedules).toBe('active_dca_schedules');
      expect(METRICS.ledgerApiLatencyMs).toBe('ledger_api_latency_ms');
      expect(METRICS.rewardDistributed).toBe('reward_distributed_cc');
    });
  });
});
