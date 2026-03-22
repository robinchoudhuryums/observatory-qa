import type { Express } from "express";
import { storage } from "../storage";
import { aiProvider } from "../services/ai-factory";
import { getRedis, getRedisStatus } from "../services/redis";
import { logger } from "../services/logger";

const startedAt = Date.now();

export function registerHealthRoutes(app: Express): void {
  // ==================== HEALTH CHECK (unauthenticated) ====================

  /**
   * GET /api/health
   * Returns 200 if all critical dependencies are reachable, 503 if degraded.
   * Used by Docker HEALTHCHECK, load balancers, and monitoring systems.
   */
  app.get("/api/health", async (_req, res) => {
    const checks: Record<string, { status: string; detail?: string; latencyMs?: number }> = {};
    let overall = true;

    // --- Database / Storage connectivity ---
    try {
      const start = Date.now();
      const orgs = await storage.listOrganizations();
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
        await redis.ping();
        checks.redis = { status: "ok", latencyMs: Date.now() - start };
      } catch (error) {
        checks.redis = { status: "error", detail: (error as Error).message };
        overall = false;
      }
    } else {
      checks.redis = { status: "unavailable", detail: "No REDIS_URL configured" };
    }

    // --- AI provider availability ---
    checks.ai = {
      status: aiProvider.isAvailable ? "ok" : "unavailable",
      detail: aiProvider.name,
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

    // --- Memory usage ---
    const mem = process.memoryUsage();
    const heapRatio = mem.heapUsed / mem.heapTotal;
    const rssBytes = mem.rss;
    checks.memory = {
      status: heapRatio > 0.9 ? "warning" : "ok",
      detail: `${Math.round(mem.heapUsed / 1024 / 1024)}MB / ${Math.round(mem.heapTotal / 1024 / 1024)}MB heap, ${Math.round(rssBytes / 1024 / 1024)}MB RSS`,
    };

    // --- Disk (process.cpuUsage for load indication) ---
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
      await storage.listOrganizations();
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
}
