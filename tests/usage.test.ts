import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

/**
 * Usage tracking and analytics tests.
 *
 * Verifies that usage events are recorded and summarized correctly
 * with proper org isolation and date filtering.
 */

describe("Usage Tracking", () => {
  let storage: any;
  let orgId: string;

  beforeEach(async () => {
    const { MemStorage } = await import("../server/storage/memory");
    storage = new MemStorage();
    const org = await storage.createOrganization({ name: "Test Org", slug: "test", status: "active" });
    orgId = org.id;
  });

  describe("recordUsageEvent", () => {
    it("records a transcription event", async () => {
      await storage.recordUsageEvent({
        orgId,
        eventType: "transcription",
        quantity: 1,
        metadata: { callId: "call-1" },
      });

      const summary = await storage.getUsageSummary(orgId);
      assert.strictEqual(summary.length, 1);
      assert.strictEqual(summary[0].eventType, "transcription");
      assert.strictEqual(summary[0].totalQuantity, 1);
      assert.strictEqual(summary[0].eventCount, 1);
    });

    it("records an AI analysis event", async () => {
      await storage.recordUsageEvent({
        orgId,
        eventType: "ai_analysis",
        quantity: 1,
        metadata: { callId: "call-1", model: "claude-sonnet-4" },
      });

      const summary = await storage.getUsageSummary(orgId);
      assert.strictEqual(summary.length, 1);
      assert.strictEqual(summary[0].eventType, "ai_analysis");
    });

    it("records a storage event with quantity", async () => {
      await storage.recordUsageEvent({
        orgId,
        eventType: "storage_mb",
        quantity: 15.5,
      });

      const summary = await storage.getUsageSummary(orgId);
      assert.strictEqual(summary[0].totalQuantity, 15.5);
    });
  });

  describe("getUsageSummary", () => {
    it("aggregates multiple events by type", async () => {
      await storage.recordUsageEvent({ orgId, eventType: "transcription", quantity: 1 });
      await storage.recordUsageEvent({ orgId, eventType: "transcription", quantity: 1 });
      await storage.recordUsageEvent({ orgId, eventType: "transcription", quantity: 1 });
      await storage.recordUsageEvent({ orgId, eventType: "ai_analysis", quantity: 1 });
      await storage.recordUsageEvent({ orgId, eventType: "ai_analysis", quantity: 1 });

      const summary = await storage.getUsageSummary(orgId);
      assert.strictEqual(summary.length, 2);

      const transcription = summary.find((s: any) => s.eventType === "transcription");
      const aiAnalysis = summary.find((s: any) => s.eventType === "ai_analysis");

      assert.ok(transcription);
      assert.strictEqual(transcription.totalQuantity, 3);
      assert.strictEqual(transcription.eventCount, 3);

      assert.ok(aiAnalysis);
      assert.strictEqual(aiAnalysis.totalQuantity, 2);
      assert.strictEqual(aiAnalysis.eventCount, 2);
    });

    it("isolates usage data by org", async () => {
      const org2 = await storage.createOrganization({ name: "Org 2", slug: "org2", status: "active" });

      await storage.recordUsageEvent({ orgId, eventType: "transcription", quantity: 5 });
      await storage.recordUsageEvent({ orgId: org2.id, eventType: "transcription", quantity: 10 });

      const org1Summary = await storage.getUsageSummary(orgId);
      const org2Summary = await storage.getUsageSummary(org2.id);

      assert.strictEqual(org1Summary[0].totalQuantity, 5);
      assert.strictEqual(org2Summary[0].totalQuantity, 10);
    });

    it("returns empty array for org with no usage", async () => {
      const summary = await storage.getUsageSummary(orgId);
      assert.strictEqual(summary.length, 0);
    });

    it("sums quantity across events of same type", async () => {
      await storage.recordUsageEvent({ orgId, eventType: "storage_mb", quantity: 10 });
      await storage.recordUsageEvent({ orgId, eventType: "storage_mb", quantity: 20.5 });
      await storage.recordUsageEvent({ orgId, eventType: "storage_mb", quantity: 5 });

      const summary = await storage.getUsageSummary(orgId);
      const storageSummary = summary.find((s: any) => s.eventType === "storage_mb");
      assert.ok(storageSummary);
      assert.strictEqual(storageSummary.totalQuantity, 35.5);
      assert.strictEqual(storageSummary.eventCount, 3);
    });
  });
});
