// ---------------------------------------------------------------------------
// OpenTelemetry tracing setup — must be imported before any other modules
// ---------------------------------------------------------------------------
//
// Initializes the OpenTelemetry NodeSDK with OTLP exporter and auto-
// instrumentation for Express and HTTP.  Gracefully no-ops if the
// OTEL_EXPORTER_OTLP_ENDPOINT env var is not set (no collector configured).
// ---------------------------------------------------------------------------

import { logger } from './monitoring/logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SpanAttributes = Record<string, string | number | boolean>;

// ---------------------------------------------------------------------------
// State — lazily populated by init()
// ---------------------------------------------------------------------------

let sdkStarted = false;
let tracerInstance: any = null;
let apiModule: any = null;

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

async function init(): Promise<void> {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

  if (!endpoint) {
    logger.info('OpenTelemetry disabled — OTEL_EXPORTER_OTLP_ENDPOINT not set', {
      component: 'tracing',
    });
    return;
  }

  try {
    // Dynamic imports so the app does not crash if OTel packages are not
    // installed (they are optional peer dependencies).
    const [
      { NodeSDK },
      { OTLPTraceExporter },
      { getNodeAutoInstrumentations },
      resourceMod,
      { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION },
      api,
    ] = await Promise.all([
      import('@opentelemetry/sdk-node'),
      import('@opentelemetry/exporter-trace-otlp-http'),
      import('@opentelemetry/auto-instrumentations-node'),
      import('@opentelemetry/resources'),
      import('@opentelemetry/semantic-conventions'),
      import('@opentelemetry/api'),
    ]);

    apiModule = api;

    const resource = resourceMod.resourceFromAttributes({
      [ATTR_SERVICE_NAME]: 'roil-backend',
      [ATTR_SERVICE_VERSION]: '1.0.0',
    });

    const traceExporter = new OTLPTraceExporter({ url: `${endpoint}/v1/traces` });

    const sdk = new NodeSDK({
      resource,
      traceExporter,
      instrumentations: [
        getNodeAutoInstrumentations({
          '@opentelemetry/instrumentation-express': { enabled: true },
          '@opentelemetry/instrumentation-http': { enabled: true },
          // Disable noisy instrumentations that are not useful here
          '@opentelemetry/instrumentation-fs': { enabled: false },
        }),
      ],
    });

    sdk.start();
    sdkStarted = true;

    tracerInstance = api.trace.getTracer('roil-backend', '1.0.0');

    logger.info('OpenTelemetry initialized', {
      component: 'tracing',
      endpoint,
    });

    // Graceful shutdown
    const shutdown = async () => {
      try {
        await sdk.shutdown();
        logger.info('OpenTelemetry SDK shut down', { component: 'tracing' });
      } catch (err) {
        logger.error('OpenTelemetry shutdown error', {
          component: 'tracing',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  } catch (err) {
    // OTel packages not installed or init failed — log and continue
    logger.warn('OpenTelemetry initialization failed (packages may not be installed)', {
      component: 'tracing',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Wrap an async function in an OpenTelemetry span.
 *
 * If tracing is not configured the function is executed directly without
 * any overhead.
 *
 * @param name  Span name (e.g. 'rebalanceEngine.execute')
 * @param fn    The async work to trace
 * @param attrs Optional attributes to attach to the span
 */
export async function traceAsync<T>(
  name: string,
  fn: () => Promise<T>,
  attrs?: SpanAttributes,
): Promise<T> {
  if (!tracerInstance || !apiModule) {
    return fn();
  }

  return tracerInstance.startActiveSpan(name, async (span: any) => {
    try {
      if (attrs) {
        for (const [key, value] of Object.entries(attrs)) {
          span.setAttribute(key, value);
        }
      }
      const result = await fn();
      span.setStatus({ code: apiModule.SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.setStatus({
        code: apiModule.SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : String(err),
      });
      span.recordException(err instanceof Error ? err : new Error(String(err)));
      throw err;
    } finally {
      span.end();
    }
  });
}

/**
 * Add attributes to the currently active span (if any).
 *
 * No-op if tracing is not configured or there is no active span.
 */
export function addSpanAttributes(attrs: SpanAttributes): void {
  if (!apiModule) return;

  const span = apiModule.trace.getActiveSpan?.();
  if (!span) return;

  for (const [key, value] of Object.entries(attrs)) {
    span.setAttribute(key, value);
  }
}

/**
 * Whether the OTel SDK was successfully started.
 */
export function isTracingEnabled(): boolean {
  return sdkStarted;
}

// ---------------------------------------------------------------------------
// Auto-initialize on import
// ---------------------------------------------------------------------------

// We use a top-level await-free pattern: fire init() and let it resolve in
// the background.  The traceAsync/addSpanAttributes helpers gracefully
// no-op until init completes.
init().catch(() => {
  // Already logged inside init()
});
