/**
 * Call clustering tests — verifies TF-IDF topic clustering logic
 * for discovering recurring call patterns.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("Call clustering", () => {
  describe("extractTerms", () => {
    it("extracts topics as normalized terms", async () => {
      const { _testExports } = await import("../server/services/call-clustering.js");
      const terms = _testExports.extractTerms({
        id: "c1",
        analysis: { topics: ["Billing Dispute", "Insurance Coverage"] },
      } as any);
      assert.ok(terms.includes("billing dispute"));
      assert.ok(terms.includes("billing"));
      assert.ok(terms.includes("dispute"));
      assert.ok(terms.includes("insurance coverage"));
    });

    it("extracts keywords", async () => {
      const { _testExports } = await import("../server/services/call-clustering.js");
      const terms = _testExports.extractTerms({
        id: "c1",
        analysis: { keywords: ["scheduling", "appointment", "ab"] },
      } as any);
      assert.ok(terms.includes("scheduling"));
      assert.ok(terms.includes("appointment"));
      assert.ok(!terms.includes("ab"), "Short keywords should be filtered");
    });

    it("extracts summary terms, filtering stop words", async () => {
      const { _testExports } = await import("../server/services/call-clustering.js");
      const terms = _testExports.extractTerms({
        id: "c1",
        analysis: { summary: "The patient called about their dental appointment scheduling problem" },
      } as any);
      assert.ok(terms.includes("dental"));
      assert.ok(terms.includes("appointment"));
      assert.ok(terms.includes("scheduling"));
      assert.ok(!terms.includes("the"), "Stop words should be filtered");
      assert.ok(!terms.includes("about"), "Stop words should be filtered");
    });

    it("handles missing analysis gracefully", async () => {
      const { _testExports } = await import("../server/services/call-clustering.js");
      const terms = _testExports.extractTerms({ id: "c1" } as any);
      assert.deepEqual(terms, []);
    });
  });

  describe("cosineSimilarity", () => {
    it("returns 1 for identical vectors", async () => {
      const { _testExports } = await import("../server/services/call-clustering.js");
      const a = new Map([["billing", 1.5], ["dispute", 2.0]]);
      const sim = _testExports.cosineSimilarity(a, a);
      assert.ok(Math.abs(sim - 1.0) < 0.001, `Expected ~1.0, got ${sim}`);
    });

    it("returns 0 for orthogonal vectors", async () => {
      const { _testExports } = await import("../server/services/call-clustering.js");
      const a = new Map([["billing", 1.0]]);
      const b = new Map([["scheduling", 1.0]]);
      const sim = _testExports.cosineSimilarity(a, b);
      assert.equal(sim, 0);
    });

    it("returns value between 0 and 1 for partially overlapping vectors", async () => {
      const { _testExports } = await import("../server/services/call-clustering.js");
      const a = new Map([["billing", 1.0], ["dispute", 0.5]]);
      const b = new Map([["billing", 0.8], ["insurance", 1.0]]);
      const sim = _testExports.cosineSimilarity(a, b);
      assert.ok(sim > 0 && sim < 1, `Expected 0 < sim < 1, got ${sim}`);
    });

    it("handles empty vectors", async () => {
      const { _testExports } = await import("../server/services/call-clustering.js");
      const a = new Map<string, number>();
      const b = new Map([["billing", 1.0]]);
      assert.equal(_testExports.cosineSimilarity(a, b), 0);
    });
  });

  describe("clusterCalls", () => {
    it("groups similar calls together", async () => {
      const { _testExports } = await import("../server/services/call-clustering.js");

      // Two calls about billing, one about scheduling
      const docTerms = [
        { callId: "c1", terms: new Map([["billing", 2.0], ["dispute", 1.5]]), uploadedAt: "2026-04-01" },
        { callId: "c2", terms: new Map([["billing", 1.8], ["payment", 1.2]]), uploadedAt: "2026-04-01" },
        { callId: "c3", terms: new Map([["scheduling", 2.0], ["appointment", 1.5]]), uploadedAt: "2026-04-01" },
      ];

      const clusters = _testExports.clusterCalls(docTerms, 0.1);
      // c1 and c2 should be in the same cluster (both about billing)
      let billingCluster: any[] | undefined;
      for (const [, docs] of clusters) {
        const ids = docs.map((d: any) => d.callId);
        if (ids.includes("c1") && ids.includes("c2")) {
          billingCluster = docs;
          break;
        }
      }
      assert.ok(billingCluster, "Billing calls should be clustered together");
    });

    it("puts dissimilar calls in separate clusters", async () => {
      const { _testExports } = await import("../server/services/call-clustering.js");

      const docTerms = [
        { callId: "c1", terms: new Map([["billing", 2.0]]), uploadedAt: "2026-04-01" },
        { callId: "c2", terms: new Map([["emergency", 2.0]]), uploadedAt: "2026-04-01" },
      ];

      const clusters = _testExports.clusterCalls(docTerms, 0.15);
      assert.equal(clusters.size, 2, "Dissimilar calls should be in separate clusters");
    });
  });

  describe("getClusterTopTerms", () => {
    it("returns terms sorted by aggregate TF-IDF score", async () => {
      const { _testExports } = await import("../server/services/call-clustering.js");
      const docs = [
        { callId: "c1", terms: new Map([["billing", 3.0], ["dispute", 1.0]]), uploadedAt: "" },
        { callId: "c2", terms: new Map([["billing", 2.0], ["payment", 1.5]]), uploadedAt: "" },
      ];

      const topTerms = _testExports.getClusterTopTerms(docs, 3);
      assert.equal(topTerms[0], "billing", "billing should be top term (5.0 aggregate)");
      assert.ok(topTerms.length <= 3);
    });
  });

  describe("determineTrend", () => {
    it("detects rising trend when recent > older * 1.3", async () => {
      const { _testExports } = await import("../server/services/call-clustering.js");
      const now = Date.now();
      const docs = [
        // 3 recent calls (last 7 days)
        { uploadedAt: new Date(now - 1 * 86400000).toISOString() },
        { uploadedAt: new Date(now - 2 * 86400000).toISOString() },
        { uploadedAt: new Date(now - 3 * 86400000).toISOString() },
        // 1 older call (7-14 days ago)
        { uploadedAt: new Date(now - 10 * 86400000).toISOString() },
      ];
      assert.equal(_testExports.determineTrend(docs), "rising");
    });

    it("detects declining trend when recent < older * 0.7", async () => {
      const { _testExports } = await import("../server/services/call-clustering.js");
      const now = Date.now();
      const docs = [
        // 1 recent call
        { uploadedAt: new Date(now - 2 * 86400000).toISOString() },
        // 3 older calls
        { uploadedAt: new Date(now - 8 * 86400000).toISOString() },
        { uploadedAt: new Date(now - 9 * 86400000).toISOString() },
        { uploadedAt: new Date(now - 10 * 86400000).toISOString() },
      ];
      assert.equal(_testExports.determineTrend(docs), "declining");
    });

    it("detects stable trend when counts are similar", async () => {
      const { _testExports } = await import("../server/services/call-clustering.js");
      const now = Date.now();
      const docs = [
        { uploadedAt: new Date(now - 2 * 86400000).toISOString() },
        { uploadedAt: new Date(now - 3 * 86400000).toISOString() },
        { uploadedAt: new Date(now - 8 * 86400000).toISOString() },
        { uploadedAt: new Date(now - 9 * 86400000).toISOString() },
      ];
      assert.equal(_testExports.determineTrend(docs), "stable");
    });
  });

  describe("buildTfIdf", () => {
    it("applies IDF weighting to terms", async () => {
      const { _testExports } = await import("../server/services/call-clustering.js");
      const calls = [
        { id: "c1", analysis: { topics: ["billing", "insurance"] } },
        { id: "c2", analysis: { topics: ["billing", "scheduling"] } },
        { id: "c3", analysis: { topics: ["scheduling", "appointment"] } },
      ] as any[];

      const tfidf = _testExports.buildTfIdf(calls);
      assert.equal(tfidf.length, 3);

      // "billing" appears in 2/3 docs, should have lower IDF than "insurance" (1/3)
      const c1Terms = tfidf[0].terms;
      const billingWeight = c1Terms.get("billing") || 0;
      const insuranceWeight = c1Terms.get("insurance") || 0;
      assert.ok(
        insuranceWeight > billingWeight,
        `Rarer term "insurance" (${insuranceWeight}) should have higher IDF weight than common "billing" (${billingWeight})`,
      );
    });
  });
});
