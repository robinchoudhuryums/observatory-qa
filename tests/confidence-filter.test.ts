/**
 * Confidence as first-class filter tests — verifies that confidence scores
 * are surfaced in dashboard metrics, data quality breakdowns, and insights.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("Confidence as first-class filter", () => {
  describe("calculateDashboardMetrics with confidence", () => {
    it("returns avgConfidence and dataQuality breakdown", async () => {
      const { calculateDashboardMetrics } = await import("../server/storage/types.js");

      const result = calculateDashboardMetrics(
        3,
        [{ overallScore: "0.8" }, { overallScore: "0.5" }, { overallScore: "0.7" }],
        [
          { performanceScore: "7.5", confidenceScore: "0.85" },
          { performanceScore: "6.0", confidenceScore: "0.55" },
          { performanceScore: "8.0", confidenceScore: "0.3" },
        ],
      );

      assert.ok(result.avgConfidence !== null, "avgConfidence should not be null");
      assert.ok(result.avgConfidence! > 0, "avgConfidence should be positive");
      assert.ok(result.dataQuality, "dataQuality should be present");
      assert.equal(result.dataQuality!.highConfidence, 1, "One call >= 0.7");
      assert.equal(result.dataQuality!.mediumConfidence, 1, "One call >= 0.4 and < 0.7");
      assert.equal(result.dataQuality!.lowConfidence, 1, "One call < 0.4");
      assert.equal(result.dataQuality!.noConfidence, 0, "No calls missing confidence");
    });

    it("handles missing confidence scores gracefully", async () => {
      const { calculateDashboardMetrics } = await import("../server/storage/types.js");

      const result = calculateDashboardMetrics(
        2,
        [{ overallScore: "0.8" }],
        [
          { performanceScore: "7.5", confidenceScore: undefined },
          { performanceScore: "6.0", confidenceScore: "" },
        ],
      );

      assert.equal(result.avgConfidence, null, "avgConfidence should be null when no valid scores");
      assert.equal(result.dataQuality!.noConfidence, 2, "Both calls should be noConfidence");
      assert.equal(result.dataQuality!.highConfidence, 0);
      assert.equal(result.dataQuality!.mediumConfidence, 0);
      assert.equal(result.dataQuality!.lowConfidence, 0);
    });

    it("correctly rounds avgConfidence to 2 decimal places", async () => {
      const { calculateDashboardMetrics } = await import("../server/storage/types.js");

      const result = calculateDashboardMetrics(
        2,
        [],
        [
          { performanceScore: "7.0", confidenceScore: "0.777" },
          { performanceScore: "8.0", confidenceScore: "0.888" },
        ],
      );

      // (0.777 + 0.888) / 2 = 0.8325 → rounded to 0.83
      assert.equal(result.avgConfidence, 0.83);
    });

    it("categorizes boundary values correctly", async () => {
      const { calculateDashboardMetrics } = await import("../server/storage/types.js");

      const result = calculateDashboardMetrics(
        3,
        [],
        [
          { performanceScore: "7.0", confidenceScore: "0.7" },  // exactly 0.7 → high
          { performanceScore: "8.0", confidenceScore: "0.4" },  // exactly 0.4 → medium
          { performanceScore: "6.0", confidenceScore: "0.39" }, // just under 0.4 → low
        ],
      );

      assert.equal(result.dataQuality!.highConfidence, 1, "0.7 should be high");
      assert.equal(result.dataQuality!.mediumConfidence, 1, "0.4 should be medium");
      assert.equal(result.dataQuality!.lowConfidence, 1, "0.39 should be low");
    });

    it("returns zero totals for empty analyses", async () => {
      const { calculateDashboardMetrics } = await import("../server/storage/types.js");

      const result = calculateDashboardMetrics(0, [], []);

      assert.equal(result.avgConfidence, null);
      assert.equal(result.dataQuality!.highConfidence, 0);
      assert.equal(result.dataQuality!.mediumConfidence, 0);
      assert.equal(result.dataQuality!.lowConfidence, 0);
      assert.equal(result.dataQuality!.noConfidence, 0);
    });
  });

  describe("DashboardMetrics type includes confidence fields", () => {
    it("avgConfidence is optional and nullable", async () => {
      // Type-level test: just verifying the shape compiles correctly
      const metrics: import("@shared/schema").DashboardMetrics = {
        totalCalls: 10,
        avgSentiment: 7.5,
        avgTranscriptionTime: 2.3,
        avgPerformanceScore: 7.0,
        avgConfidence: 0.82,
        dataQuality: {
          highConfidence: 5,
          mediumConfidence: 3,
          lowConfidence: 1,
          noConfidence: 1,
        },
      };
      assert.equal(metrics.avgConfidence, 0.82);
      assert.equal(metrics.dataQuality!.highConfidence, 5);
    });

    it("TopPerformer includes avgConfidence", async () => {
      const performer: import("@shared/schema").TopPerformer = {
        id: "emp-1",
        name: "Alice",
        avgPerformanceScore: 8.5,
        totalCalls: 20,
        avgConfidence: 0.91,
      };
      assert.equal(performer.avgConfidence, 0.91);
    });
  });

  describe("MemStorage returns confidence in dashboard metrics", () => {
    it("getDashboardMetrics includes confidence data", async () => {
      const { MemStorage } = await import("../server/storage/memory.js");
      const storage = new MemStorage();

      const org = await storage.createOrganization({ name: "Test", slug: "test", status: "trial" });
      const call = await storage.createCall({
        orgId: org.id,
        fileName: "test.mp3",
        status: "completed",
      });
      await storage.createCallAnalysis(org.id, {
        orgId: org.id,
        callId: call.id,
        performanceScore: "8.0",
        confidenceScore: "0.85",
        summary: "Good call",
      });

      const metrics = await storage.getDashboardMetrics(org.id);
      assert.ok(metrics.avgConfidence !== undefined, "Should include avgConfidence");
      assert.ok(metrics.dataQuality !== undefined, "Should include dataQuality");
    });
  });
});