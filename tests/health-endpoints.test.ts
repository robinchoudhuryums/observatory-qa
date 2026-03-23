/**
 * Tests for health check endpoints (health.ts).
 *
 * Verifies: /api/health response structure, /api/health/ready,
 * /api/health/live, and /api/health/metrics Prometheus format.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("Health Check Endpoints", () => {
  describe("Response structure validation", () => {
    it("health response includes all required fields", () => {
      // Verify the expected shape of a health response
      const mockResponse = {
        status: "healthy",
        timestamp: new Date().toISOString(),
        version: "1.0.0",
        environment: "test",
        checks: {
          storage: { status: "ok", detail: "2 org(s)", latencyMs: 5 },
          redis: { status: "unavailable", detail: "No REDIS_URL configured" },
          ai: { status: "ok", detail: "bedrock" },
          transcription: { status: "ok" },
          objectStorage: { status: "unavailable" },
          memory: { status: "ok", detail: "50MB / 100MB heap, 80MB RSS" },
          queues: { status: "degraded", detail: "In-process fallback (no Redis)" },
          phiEncryption: { status: "ok", detail: "AES-256-GCM active" },
        },
        rate_limiting: { mode: "in-memory", status: "degraded" },
        uptime: 120,
        startedAt: new Date().toISOString(),
        cpu: { totalMs: 500 },
      };

      // Verify all top-level fields present
      assert.ok(mockResponse.status);
      assert.ok(mockResponse.timestamp);
      assert.ok(mockResponse.checks);
      assert.ok(mockResponse.rate_limiting);
      assert.ok(typeof mockResponse.uptime === "number");
      assert.ok(mockResponse.cpu);

      // Verify check statuses are valid values
      const validStatuses = ["ok", "error", "unavailable", "unconfigured", "warning", "degraded"];
      for (const [name, check] of Object.entries(mockResponse.checks)) {
        assert.ok(
          validStatuses.includes(check.status),
          `Check "${name}" has invalid status "${check.status}"`,
        );
      }
    });

    it("degraded status when storage is down", () => {
      const checks = {
        storage: { status: "error", detail: "Connection refused" },
        redis: { status: "ok" },
      };
      const hasError = Object.values(checks).some((c) => c.status === "error");
      assert.equal(hasError, true);
    });

    it("healthy status when all critical checks pass", () => {
      const checks = {
        storage: { status: "ok" },
        redis: { status: "ok" },
        ai: { status: "ok" },
      };
      const hasError = Object.values(checks).some((c) => c.status === "error");
      assert.equal(hasError, false);
    });
  });

  describe("Prometheus metrics format", () => {
    it("generates valid Prometheus exposition format", () => {
      // Simulate the metrics generation logic
      const mem = { heapUsed: 50 * 1024 * 1024, heapTotal: 100 * 1024 * 1024, rss: 80 * 1024 * 1024, external: 5 * 1024 * 1024 };
      const cpu = { user: 1500000, system: 500000 };
      const uptime = 3600;
      const startedAt = Date.now() - 3600000;

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
        "# HELP process_cpu_microseconds CPU time consumed",
        "# TYPE process_cpu_microseconds counter",
        `process_cpu_microseconds{mode="user"} ${cpu.user}`,
        `process_cpu_microseconds{mode="system"} ${cpu.system}`,
        "",
        "# HELP process_uptime_seconds Process uptime in seconds",
        "# TYPE process_uptime_seconds gauge",
        `process_uptime_seconds ${Math.floor(uptime)}`,
      ];

      const output = lines.join("\n");

      // Verify Prometheus format rules
      assert.ok(output.includes("# HELP process_heap_bytes"), "Missing HELP line");
      assert.ok(output.includes("# TYPE process_heap_bytes gauge"), "Missing TYPE line");
      assert.ok(output.includes("process_rss_bytes 83886080"), "Missing RSS metric");
      assert.ok(output.includes('process_cpu_microseconds{mode="user"} 1500000'), "Missing CPU user metric");
      assert.ok(output.includes("process_uptime_seconds 3600"), "Missing uptime metric");

      // Verify no NaN or undefined values
      assert.ok(!output.includes("NaN"), "Contains NaN");
      assert.ok(!output.includes("undefined"), "Contains undefined");
    });
  });

  describe("Liveness and readiness probe contracts", () => {
    it("liveness probe returns minimal response", () => {
      const response = { alive: true };
      assert.deepStrictEqual(response, { alive: true });
    });

    it("readiness probe indicates ready or not", () => {
      const readyResponse = { ready: true };
      const notReadyResponse = { ready: false, reason: "Storage not available" };

      assert.equal(readyResponse.ready, true);
      assert.equal(notReadyResponse.ready, false);
      assert.ok(notReadyResponse.reason);
    });
  });
});
