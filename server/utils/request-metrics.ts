/**
 * In-memory request metrics collector with per-route latency percentiles.
 * Sliding window: keeps last 10 minutes of data.
 */

interface RequestEntry {
  timestamp: number;
  statusCode: number;
  durationMs: number;
}

interface RouteData {
  entries: RequestEntry[];
}

const WINDOW_MS = 10 * 60 * 1000;
const routeMetrics = new Map<string, RouteData>();

export function recordRequest(method: string, route: string, statusCode: number, durationMs: number): void {
  const key = `${method} ${route}`;
  let data = routeMetrics.get(key);
  if (!data) {
    data = { entries: [] };
    routeMetrics.set(key, data);
  }
  data.entries.push({ timestamp: Date.now(), statusCode, durationMs });
}

export interface RouteSummary {
  requestCount: number;
  errorCount: number;
  p50: number;
  p95: number;
  p99: number;
}

export function getMetricsSummary(): Record<string, RouteSummary> {
  const now = Date.now();
  const cutoff = now - WINDOW_MS;
  const result: Record<string, RouteSummary> = {};
  const keys = Array.from(routeMetrics.keys());
  for (const key of keys) {
    const data = routeMetrics.get(key)!;
    data.entries = data.entries.filter((e: RequestEntry) => e.timestamp > cutoff);
    if (data.entries.length === 0) {
      routeMetrics.delete(key);
      continue;
    }
    const latencies = data.entries.map((e: RequestEntry) => e.durationMs).sort((a: number, b: number) => a - b);
    const errorCount = data.entries.filter((e: RequestEntry) => e.statusCode >= 400).length;
    result[key] = {
      requestCount: data.entries.length,
      errorCount,
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      p99: percentile(latencies, 99),
    };
  }
  return result;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((sorted.length * p) / 100) - 1;
  return sorted[Math.max(0, idx)];
}
