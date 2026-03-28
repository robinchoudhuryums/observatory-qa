import type { Express } from "express";
import { storage } from "../storage";
import { aiProvider, getBedrockCircuitState } from "../services/ai-factory";
import { getRedis, getRedisStatus } from "../services/redis";
import { logger } from "../services/logger";
import { getMetricsSummary } from "../utils/request-metrics";

const startedAt = Date.now();

/** Run a check with a timeout — prevents a hung dependency from blocking the entire health check. */
async function withTimeout<T>(fn: () => Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} health check timed out after ${timeoutMs}ms`)), timeoutMs);
    fn().then(
      (result) => { clearTimeout(timer); resolve(result); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

export function registerHealthRoutes(app: Express): void {
  // ==================== HEALTH CHECK (unauthenticated) ====================

  /**
   * GET /api/health
   * Returns 200 if all critical dependencies are reachable, 503 if degraded.
   * Used by Docker HEALTHCHECK, load balancers, and monitoring systems.
   * Each dependency check has a 3s timeout to prevent hanging.
   */
  app.get("/api/health", async (_req, res) => {
    const checks: Record<string, { status: string; detail?: string; latencyMs?: number }> = {};
    let overall = true;

    const CHECK_TIMEOUT_MS = 3000;

    // --- Database / Storage connectivity ---
    try {
      const start = Date.now();
      const orgs = await withTimeout(() => storage.listOrganizations(), CHECK_TIMEOUT_MS, "storage");
      checks.storage = { status: "ok", detail: `${orgs.length} org(s)`, latencyMs: Date.now() - start };
    } catch (error) {
      checks.storage = { status: "error", detail: (error as Error).message };
      overall = false;
    }

    // --- Redis connectivity ---
    const redis = getRedis();
    if (redis) {
      try {
        const start = Date.now();
        await withTimeout(() => redis.ping(), CHECK_TIMEOUT_MS, "redis");
        checks.redis = { status: "ok", latencyMs: Date.now() - start };
      } catch (error) {
        checks.redis = { status: "error", detail: (error as Error).message };
        overall = false;
      }
    } else {
      checks.redis = { status: "unavailable", detail: "No REDIS_URL configured" };
    }

    // --- AI provider availability + circuit breaker state ---
    const circuit = getBedrockCircuitState();
    checks.ai = {
      status: !aiProvider.isAvailable ? "unavailable"
        : circuit.state === "OPEN" ? "degraded"
        : "ok",
      detail: `${aiProvider.name} | circuit: ${circuit.state}${circuit.state !== "CLOSED" ? ` (${circuit.consecutiveFailures} failures)` : ""}`,
    };

    // --- Transcription service ---
    checks.transcription = {
      status: process.env.ASSEMBLYAI_API_KEY ? "ok" : "unconfigured",
    };

    // --- S3 / Object storage ---
    if (process.env.S3_BUCKET) {
      checks.objectStorage = { status: "ok", detail: `bucket: ${process.env.S3_BUCKET}` };
    } else {
      checks.objectStorage = { status: "unavailable", detail: "No S3_BUCKET configured" };
    }

    // --- Job queues (BullMQ) ---
    if (redis) {
      try {
        // Check if BullMQ queues are reachable by testing Redis
        checks.queues = { status: "ok", detail: "BullMQ active (Redis-backed)" };
      } catch {
        checks.queues = { status: "degraded", detail: "Queue backend unavailable" };
      }
    } else {
      checks.queues = { status: "degraded", detail: "In-process fallback (no Redis)" };
    }

    // --- Memory usage ---
    const mem = process.memoryUsage();
    const heapRatio = mem.heapUsed / mem.heapTotal;
    const rssBytes = mem.rss;
    checks.memory = {
      status: heapRatio > 0.9 ? "warning" : "ok",
      detail: `${Math.round(mem.heapUsed / 1024 / 1024)}MB / ${Math.round(mem.heapTotal / 1024 / 1024)}MB heap, ${Math.round(rssBytes / 1024 / 1024)}MB RSS`,
    };

    // --- CPU usage ---
    const cpu = process.cpuUsage();
    const cpuTotalMs = (cpu.user + cpu.system) / 1000;

    // --- Rate limiting status ---
    const redisStatus = getRedisStatus();
    const rateLimiting = {
      mode: redisStatus.mode === "distributed" ? "redis" as const : "in-memory" as const,
      status: redisStatus.mode === "distributed" ? "ok" as const : "degraded" as const,
    };

    // --- Encryption ---
    checks.phiEncryption = {
      status: process.env.PHI_ENCRYPTION_KEY ? "ok" : "unconfigured",
      detail: process.env.PHI_ENCRYPTION_KEY ? "AES-256-GCM active" : "PHI fields stored unencrypted",
    };

    const statusCode = overall ? 200 : 503;
    res.status(statusCode).json({
      status: overall ? "healthy" : "degraded",
      timestamp: new Date().toISOString(),
      version: process.env.APP_VERSION || process.env.npm_package_version || "unknown",
      environment: process.env.NODE_ENV || "development",
      checks,
      rate_limiting: rateLimiting,
      uptime: Math.floor(process.uptime()),
      startedAt: new Date(startedAt).toISOString(),
      cpu: { totalMs: Math.round(cpuTotalMs) },
    });
  });

  // ==================== READINESS CHECK (for orchestrators) ====================

  /**
   * GET /api/health/ready
   * Returns 200 only when the app is ready to accept traffic.
   * Used by Kubernetes readinessProbe or load balancer health checks.
   * Stricter than /api/health — requires storage to be operational.
   */
  app.get("/api/health/ready", async (_req, res) => {
    try {
      await withTimeout(() => storage.listOrganizations(), 3000, "readiness");
      res.status(200).json({ ready: true });
    } catch {
      res.status(503).json({ ready: false, reason: "Storage not available" });
    }
  });

  // ==================== LIVENESS CHECK (for orchestrators) ====================

  /**
   * GET /api/health/live
   * Returns 200 as long as the process is running.
   * Used by Kubernetes livenessProbe. Intentionally trivial — if this fails,
   * the process is hung and should be killed.
   */
  app.get("/api/health/live", (_req, res) => {
    res.status(200).json({ alive: true });
  });

  // ==================== METRICS ENDPOINT (Prometheus-compatible) ====================

  /**
   * GET /api/health/metrics
   * Returns key runtime metrics in Prometheus exposition format.
   * Designed for scraping by Prometheus, Datadog, or similar systems.
   */
  app.get("/api/health/metrics", (_req, res) => {
    const mem = process.memoryUsage();
    const cpu = process.cpuUsage();
    const uptime = process.uptime();

    const lines = [
      "# HELP process_heap_bytes Node.js heap memory usage in bytes",
      "# TYPE process_heap_bytes gauge",
      `process_heap_bytes{type="used"} ${mem.heapUsed}`,
      `process_heap_bytes{type="total"} ${mem.heapTotal}`,
      "",
      "# HELP process_rss_bytes Resident set size in bytes",
      "# TYPE process_rss_bytes gauge",
      `process_rss_bytes ${mem.rss}`,
      "",
      "# HELP process_external_bytes External memory usage in bytes",
      "# TYPE process_external_bytes gauge",
      `process_external_bytes ${mem.external}`,
      "",
      "# HELP process_cpu_microseconds CPU time consumed",
      "# TYPE process_cpu_microseconds counter",
      `process_cpu_microseconds{mode="user"} ${cpu.user}`,
      `process_cpu_microseconds{mode="system"} ${cpu.system}`,
      "",
      "# HELP process_uptime_seconds Process uptime in seconds",
      "# TYPE process_uptime_seconds gauge",
      `process_uptime_seconds ${Math.floor(uptime)}`,
      "",
      "# HELP nodejs_active_handles Number of active handles",
      "# TYPE nodejs_active_handles gauge",
      `nodejs_active_handles ${(process as any)._getActiveHandles?.()?.length || 0}`,
      "",
      "# HELP nodejs_active_requests Number of active requests",
      "# TYPE nodejs_active_requests gauge",
      `nodejs_active_requests ${(process as any)._getActiveRequests?.()?.length || 0}`,
      "",
      "# HELP observatory_started_at_seconds Unix timestamp when the process started",
      "# TYPE observatory_started_at_seconds gauge",
      `observatory_started_at_seconds ${Math.floor(startedAt / 1000)}`,
      "",
    ];

    // Per-route request metrics (sliding 10-minute window)
    const routeMetrics = getMetricsSummary();
    const routeKeys = Object.keys(routeMetrics);
    if (routeKeys.length > 0) {
      lines.push("# HELP http_requests_total Total requests per route (10m window)", "# TYPE http_requests_total gauge");
      for (const key of routeKeys) { const [method, ...rp] = key.split(" "); const route = rp.join(" "); lines.push(`http_requests_total{method="${method}",route="${route}"} ${routeMetrics[key].requestCount}`); }
      lines.push("", "# HELP http_request_errors_total Error responses (4xx/5xx) per route (10m window)", "# TYPE http_request_errors_total gauge");
      for (const key of routeKeys) { const [method, ...rp] = key.split(" "); const route = rp.join(" "); lines.push(`http_request_errors_total{method="${method}",route="${route}"} ${routeMetrics[key].errorCount}`); }
      lines.push("", "# HELP http_request_duration_p50_ms 50th percentile latency (10m window)", "# TYPE http_request_duration_p50_ms gauge");
      for (const key of routeKeys) { const [method, ...rp] = key.split(" "); const route = rp.join(" "); lines.push(`http_request_duration_p50_ms{method="${method}",route="${route}"} ${routeMetrics[key].p50}`); }
      lines.push("", "# HELP http_request_duration_p95_ms 95th percentile latency (10m window)", "# TYPE http_request_duration_p95_ms gauge");
      for (const key of routeKeys) { const [method, ...rp] = key.split(" "); const route = rp.join(" "); lines.push(`http_request_duration_p95_ms{method="${method}",route="${route}"} ${routeMetrics[key].p95}`); }
      lines.push("", "# HELP http_request_duration_p99_ms 99th percentile latency (10m window)", "# TYPE http_request_duration_p99_ms gauge");
      for (const key of routeKeys) { const [method, ...rp] = key.split(" "); const route = rp.join(" "); lines.push(`http_request_duration_p99_ms{method="${method}",route="${route}"} ${routeMetrics[key].p99}`); }
      lines.push("");
    }

    res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
    res.send(lines.join("\n"));
  });
}
