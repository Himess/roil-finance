// ---------------------------------------------------------------------------
// Lightweight metrics registry (no external deps needed)
// ---------------------------------------------------------------------------
//
// Tracks counters, gauges, and histograms in-memory and can export them in
// Prometheus text exposition format or as JSON.  Optionally point a collector
// at the /metrics endpoint exposed by routes/metrics.ts.
// ---------------------------------------------------------------------------

export interface MetricValue {
  name: string;
  type: 'counter' | 'gauge' | 'histogram';
  value: number;
  labels: Record<string, string>;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a deterministic map key from metric name + sorted labels. */
function labelKey(name: string, labels: Record<string, string>): string {
  const sorted = Object.keys(labels)
    .sort()
    .map((k) => `${k}="${labels[k]}"`)
    .join(',');
  return sorted ? `${name}{${sorted}}` : name;
}

/** Format labels as Prometheus label string: {method="GET",route="/api"} */
function promLabels(labels: Record<string, string>): string {
  const entries = Object.entries(labels);
  if (entries.length === 0) return '';
  const inner = entries.map(([k, v]) => `${k}="${v}"`).join(',');
  return `{${inner}}`;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

class MetricsRegistry {
  private counters = new Map<string, { value: number; labels: Record<string, string>; name: string }>();
  private gauges = new Map<string, { value: number; labels: Record<string, string>; name: string }>();
  private histograms = new Map<string, { values: number[]; labels: Record<string, string>; name: string }>();

  // -------------------------------------------------------------------------
  // Counter: monotonically increasing
  // -------------------------------------------------------------------------

  increment(name: string, labels: Record<string, string> = {}, amount = 1): void {
    const key = labelKey(name, labels);
    const existing = this.counters.get(key);
    if (existing) {
      existing.value += amount;
    } else {
      this.counters.set(key, { value: amount, labels, name });
    }
  }

  // -------------------------------------------------------------------------
  // Gauge: can go up or down
  // -------------------------------------------------------------------------

  setGauge(name: string, value: number, labels: Record<string, string> = {}): void {
    const key = labelKey(name, labels);
    const existing = this.gauges.get(key);
    if (existing) {
      existing.value = value;
    } else {
      this.gauges.set(key, { value, labels, name });
    }
  }

  // -------------------------------------------------------------------------
  // Histogram: distribution of values
  // -------------------------------------------------------------------------

  private static readonly MAX_HISTOGRAM_VALUES = 10000;

  observe(name: string, value: number, labels: Record<string, string> = {}): void {
    const key = labelKey(name, labels);
    const existing = this.histograms.get(key);
    if (existing) {
      existing.values.push(value);
      if (existing.values.length > MetricsRegistry.MAX_HISTOGRAM_VALUES) {
        existing.values.splice(0, existing.values.length - MetricsRegistry.MAX_HISTOGRAM_VALUES);
      }
    } else {
      this.histograms.set(key, { values: [value], labels, name });
    }
  }

  // -------------------------------------------------------------------------
  // Export — Prometheus text exposition format
  // -------------------------------------------------------------------------

  toPrometheusText(): string {
    const lines: string[] = [];
    const seenHelp = new Set<string>();

    // Counters
    for (const [, entry] of this.counters) {
      if (!seenHelp.has(entry.name)) {
        lines.push(`# HELP ${entry.name} Counter`);
        lines.push(`# TYPE ${entry.name} counter`);
        seenHelp.add(entry.name);
      }
      lines.push(`${entry.name}${promLabels(entry.labels)} ${entry.value}`);
    }

    // Gauges
    for (const [, entry] of this.gauges) {
      if (!seenHelp.has(entry.name)) {
        lines.push(`# HELP ${entry.name} Gauge`);
        lines.push(`# TYPE ${entry.name} gauge`);
        seenHelp.add(entry.name);
      }
      lines.push(`${entry.name}${promLabels(entry.labels)} ${entry.value}`);
    }

    // Histograms — emit _count and _sum pseudo-metrics
    for (const [, entry] of this.histograms) {
      if (!seenHelp.has(entry.name)) {
        lines.push(`# HELP ${entry.name} Histogram`);
        lines.push(`# TYPE ${entry.name} histogram`);
        seenHelp.add(entry.name);
      }
      const count = entry.values.length;
      const sum = entry.values.reduce((a, b) => a + b, 0);
      lines.push(`${entry.name}_count${promLabels(entry.labels)} ${count}`);
      lines.push(`${entry.name}_sum${promLabels(entry.labels)} ${sum}`);
    }

    return lines.join('\n') + '\n';
  }

  // -------------------------------------------------------------------------
  // Export — JSON
  // -------------------------------------------------------------------------

  toJSON(): Record<string, MetricValue[]> {
    const now = Date.now();
    const result: Record<string, MetricValue[]> = {
      counters: [],
      gauges: [],
      histograms: [],
    };

    for (const [, entry] of this.counters) {
      result.counters.push({
        name: entry.name,
        type: 'counter',
        value: entry.value,
        labels: entry.labels,
        timestamp: now,
      });
    }

    for (const [, entry] of this.gauges) {
      result.gauges.push({
        name: entry.name,
        type: 'gauge',
        value: entry.value,
        labels: entry.labels,
        timestamp: now,
      });
    }

    for (const [, entry] of this.histograms) {
      const count = entry.values.length;
      const sum = entry.values.reduce((a, b) => a + b, 0);
      result.histograms.push({
        name: entry.name,
        type: 'histogram',
        value: sum / (count || 1),
        labels: { ...entry.labels, _count: String(count), _sum: String(sum) },
        timestamp: now,
      });
    }

    return result;
  }

  // -------------------------------------------------------------------------
  // Reset all metrics
  // -------------------------------------------------------------------------

  reset(): void {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const metrics = new MetricsRegistry();

// ---------------------------------------------------------------------------
// Pre-defined metric names
// ---------------------------------------------------------------------------

export const METRICS = {
  // HTTP
  httpRequestsTotal: 'http_requests_total',
  httpRequestDurationMs: 'http_request_duration_ms',
  httpResponseStatus: 'http_response_status',

  // Business
  rebalancesExecuted: 'rebalances_executed_total',
  rebalancesDrift: 'rebalance_drift_percent',
  dcaExecuted: 'dca_executed_total',
  compoundExecuted: 'compound_executed_total',
  swapsExecuted: 'swaps_executed_total',
  swapVolumeUsdcx: 'swap_volume_usdcx',

  // Infrastructure
  ledgerApiLatencyMs: 'ledger_api_latency_ms',
  cantexApiLatencyMs: 'cantex_api_latency_ms',
  circuitBreakerState: 'circuit_breaker_state',
  activePortfolios: 'active_portfolios',
  activeDcaSchedules: 'active_dca_schedules',

  // Rewards
  rewardTxRecorded: 'reward_tx_recorded_total',
  rewardDistributed: 'reward_distributed_cc',
} as const;
