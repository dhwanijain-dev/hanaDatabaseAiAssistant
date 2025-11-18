// Simple in-memory metrics store (will reset on serverless cold starts)
// Provides recordRequest and getMetrics utilities.
// NOTE: Not production-ready persistent metrics. Demonstration only.

export interface IntentMetrics {
  count: number;
  totalDurationMs: number;
  totalRowCount: number;
}

export interface MetricsSnapshot {
  totalRequests: number;
  totalErrors: number;
  totalRowCount: number;
  totalDurationMs: number;
  averageDurationMs: number;
  intents: Record<string, IntentMetrics>;
  lastUpdated: string;
}

const store: MetricsSnapshot = {
  totalRequests: 0,
  totalErrors: 0,
  totalRowCount: 0,
  totalDurationMs: 0,
  averageDurationMs: 0,
  intents: {},
  lastUpdated: new Date().toISOString(),
};

function updateAverages() {
  store.averageDurationMs = store.totalRequests ? store.totalDurationMs / store.totalRequests : 0;
}

export function recordRequest(
  correlationId: string,
  intent: string,
  durationMs: number,
  rowCount: number,
  filters: Record<string, any>,
  error?: string
) {
  store.totalRequests += 1;
  store.totalDurationMs += durationMs;
  store.totalRowCount += rowCount;
  if (error) store.totalErrors += 1;

  const intentBucket = store.intents[intent] || { count: 0, totalDurationMs: 0, totalRowCount: 0 };
  intentBucket.count += 1;
  intentBucket.totalDurationMs += durationMs;
  intentBucket.totalRowCount += rowCount;
  store.intents[intent] = intentBucket;

  store.lastUpdated = new Date().toISOString();
  updateAverages();

  // Structured log output
  const logEntry = {
    level: error ? 'error' : 'info',
    ts: new Date().toISOString(),
    correlationId,
    intent,
    durationMs: Math.round(durationMs),
    rowCount,
    filters,
    error: error || undefined,
  };
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(logEntry));
}

export function getMetrics(): MetricsSnapshot {
  return JSON.parse(JSON.stringify(store)); // return a shallow clone to avoid mutation
}
