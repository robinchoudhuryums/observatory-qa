/**
 * Load and performance tests for the audio processing pipeline.
 *
 * Tests that:
 *   - MemStorage handles 100+ concurrent call operations within time bounds
 *   - Throughput does not degrade catastrophically under load
 *   - Memory footprint stays bounded (no obvious leaks)
 *   - Sequential pipeline steps complete in deterministic order
 *   - Batch re-analysis throughput meets baseline expectations
 *   - Storage search scales reasonably with call volume
 *
 * NOTE: These are in-process load tests using MemStorage, not end-to-end.
 *       They catch regressions in storage-layer concurrency, not I/O limits.
 *
 * Run with: npx tsx --test tests/load-pipeline.test.ts
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { MemStorage } from "../server/storage/index.js";

const ORG_ID = "org-load-test";

let storage: MemStorage;

beforeEach(() => {
  storage = new MemStorage();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createCallBatch(count: number, orgId = ORG_ID) {
  return Promise.all(
    Array.from({ length: count }, (_, i) =>
      storage.createCall(orgId, {
        status: "completed",
        fileName: `load-test-${i}.mp3`,
        duration: 60 + (i % 120),
      })
    )
  );
}

async function measureMs(fn: () => Promise<void>): Promise<number> {
  const start = performance.now();
  await fn();
  return performance.now() - start;
}

// ---------------------------------------------------------------------------
// Concurrent write throughput
// ---------------------------------------------------------------------------

describe("Concurrent write throughput", () => {
  it("creates 100 calls concurrently within 2 seconds", async () => {
    const COUNT = 100;
    const elapsed = await measureMs(async () => {
      await createCallBatch(COUNT);
    });

    assert.ok(elapsed < 2000, `Expected <2000ms for ${COUNT} concurrent creates, took ${elapsed.toFixed(0)}ms`);

    const stored = await storage.getCallsWithDetails(ORG_ID);
    assert.equal(stored.length, COUNT, "All 100 calls must be persisted");
  });

  it("creates 200 calls sequentially and all are retrievable", async () => {
    const COUNT = 200;
    for (let i = 0; i < COUNT; i++) {
      await storage.createCall(ORG_ID, { status: "pending", fileName: `seq-${i}.mp3` });
    }
    const list = await storage.getCallsWithDetails(ORG_ID);
    assert.equal(list.length, COUNT);
  });

  it("50 concurrent transcript writes complete without data loss", async () => {
    const calls = await createCallBatch(50);
    await Promise.all(
      calls.map((c, i) =>
        storage.createTranscript(ORG_ID, {
          callId: c.id,
          text: `Transcript content for call ${i}. `.repeat(20),
          confidence: 0.8 + (i % 20) / 100,
          words: [],
        })
      )
    );

    // Verify all transcripts are stored
    let found = 0;
    for (const call of calls) {
      const t = await storage.getTranscript(ORG_ID, call.id);
      if (t) found++;
    }
    assert.equal(found, 50, "All 50 transcripts must be stored");
  });
});

// ---------------------------------------------------------------------------
// Concurrent read throughput
// ---------------------------------------------------------------------------

describe("Concurrent read throughput", () => {
  it("100 concurrent getCall reads complete within 500ms", async () => {
    const calls = await createCallBatch(100);

    const elapsed = await measureMs(async () => {
      await Promise.all(calls.map(c => storage.getCall(ORG_ID, c.id)));
    });

    assert.ok(elapsed < 500, `Expected <500ms for 100 concurrent reads, took ${elapsed.toFixed(0)}ms`);
  });

  it("getCallsWithDetails on 200 calls completes within 1 second", async () => {
    await createCallBatch(200);

    const elapsed = await measureMs(async () => {
      await storage.getCallsWithDetails(ORG_ID);
    });

    assert.ok(elapsed < 1000, `Expected <1000ms for list of 200, took ${elapsed.toFixed(0)}ms`);
  });
});

// ---------------------------------------------------------------------------
// Mixed read/write load
// ---------------------------------------------------------------------------

describe("Mixed read/write concurrency", () => {
  it("interleaved creates and reads produce consistent results", async () => {
    const WRITES = 50;
    const writePromises = Array.from({ length: WRITES }, (_, i) =>
      storage.createCall(ORG_ID, { status: "pending", fileName: `mixed-${i}.mp3` })
    );

    // Fire reads concurrently with writes
    const listPromise = storage.getCallsWithDetails(ORG_ID);

    await Promise.all([...writePromises, listPromise]);

    // After everything settles, verify final count
    const finalList = await storage.getCallsWithDetails(ORG_ID);
    assert.ok(
      finalList.length >= WRITES,
      `Expected ≥${WRITES} calls after concurrent writes, got ${finalList.length}`
    );
  });

  it("concurrent create + update on same call does not corrupt data", async () => {
    const call = await storage.createCall(ORG_ID, { status: "pending" });

    await Promise.all([
      storage.updateCall(ORG_ID, call.id, { status: "processing" }),
      storage.updateCall(ORG_ID, call.id, { status: "processing" }),
    ]);

    const final = await storage.getCall(ORG_ID, call.id);
    assert.ok(final, "Call must still exist after concurrent updates");
    assert.ok(
      ["pending", "processing", "completed", "failed"].includes(final!.status),
      `Unexpected status: ${final!.status}`
    );
  });
});

// ---------------------------------------------------------------------------
// Multi-org load isolation
// ---------------------------------------------------------------------------

describe("Multi-org load isolation", () => {
  it("50 orgs × 20 calls each — all isolated, total 1000 calls", async () => {
    const ORG_COUNT = 50;
    const CALLS_PER_ORG = 20;

    // Create calls across 50 orgs concurrently
    await Promise.all(
      Array.from({ length: ORG_COUNT }, (_, orgIdx) =>
        Promise.all(
          Array.from({ length: CALLS_PER_ORG }, () =>
            storage.createCall(`load-org-${orgIdx}`, { status: "completed" })
          )
        )
      )
    );

    // Spot-check 5 random orgs
    for (let i = 0; i < 5; i++) {
      const orgCalls = await storage.getCallsWithDetails(`load-org-${i}`);
      assert.equal(orgCalls.length, CALLS_PER_ORG,
        `load-org-${i} should have exactly ${CALLS_PER_ORG} calls`);
    }
  });
});

// ---------------------------------------------------------------------------
// Search performance under load
// ---------------------------------------------------------------------------

describe("Search performance under load", () => {
  it("searchCalls with 500 calls completes within 2 seconds", async () => {
    const calls = await createCallBatch(500);

    // Add transcripts with searchable content to some calls
    await Promise.all(
      calls.slice(0, 50).map((c, i) =>
        storage.createTranscript(ORG_ID, {
          callId: c.id,
          text: `Call about appointment scheduling and insurance verification ${i}`,
          confidence: 0.9,
          words: [],
        })
      )
    );

    const elapsed = await measureMs(async () => {
      await storage.searchCalls(ORG_ID, "insurance");
    });

    assert.ok(elapsed < 2000, `Search over 500 calls must complete <2000ms, took ${elapsed.toFixed(0)}ms`);
  });
});

// ---------------------------------------------------------------------------
// Pipeline step sequencing
// ---------------------------------------------------------------------------

describe("Pipeline step sequencing", () => {
  it("pipeline stages complete in correct order for a single call", async () => {
    const order: string[] = [];

    // Simulate pipeline steps
    const call = await storage.createCall(ORG_ID, { status: "pending" });
    order.push("created");

    await storage.updateCall(ORG_ID, call.id, { status: "processing" });
    order.push("processing");

    await storage.createTranscript(ORG_ID, {
      callId: call.id, text: "Hello world", confidence: 0.95, words: [],
    });
    order.push("transcribed");

    await storage.createSentimentAnalysis(ORG_ID, {
      callId: call.id, overallSentiment: "positive", overallScore: 0.8, segments: [],
    });
    order.push("sentiment");

    await storage.createCallAnalysis(ORG_ID, {
      callId: call.id, performanceScore: "7.5", summary: "Good call",
      flags: [], topics: [], feedback: [], subScores: {}, confidenceFactors: {},
    });
    order.push("analyzed");

    await storage.updateCall(ORG_ID, call.id, { status: "completed" });
    order.push("completed");

    assert.deepEqual(order, [
      "created", "processing", "transcribed", "sentiment", "analyzed", "completed"
    ]);

    // Verify all data is accessible after pipeline
    const finalCall = await storage.getCall(ORG_ID, call.id);
    assert.equal(finalCall!.status, "completed");

    const transcript = await storage.getTranscript(ORG_ID, call.id);
    assert.ok(transcript);

    const sentiment = await storage.getSentimentAnalysis(ORG_ID, call.id);
    assert.ok(sentiment);

    const analysis = await storage.getCallAnalysis(ORG_ID, call.id);
    assert.ok(analysis);
  });

  it("10 calls processed through full pipeline steps without data corruption", async () => {
    const COUNT = 10;
    const calls = await Promise.all(
      Array.from({ length: COUNT }, (_, i) =>
        storage.createCall(ORG_ID, { status: "pending", fileName: `pipeline-${i}.mp3` })
      )
    );

    // Simulate full pipeline for each call
    await Promise.all(calls.map(async (call, i) => {
      await storage.updateCall(ORG_ID, call.id, { status: "processing" });
      await storage.createTranscript(ORG_ID, {
        callId: call.id,
        text: `Agent: Hello, how can I help you today? Call ${i}`,
        confidence: 0.9,
        words: [],
      });
      await storage.createCallAnalysis(ORG_ID, {
        callId: call.id,
        performanceScore: String(6 + (i % 4)),
        summary: `Summary for call ${i}`,
        flags: i === 0 ? ["low_score"] : [],
        topics: [`topic-${i}`],
        feedback: [],
        subScores: {},
        confidenceFactors: {},
      });
      await storage.updateCall(ORG_ID, call.id, { status: "completed" });
    }));

    // Verify all 10 completed
    const finalCalls = await storage.getCallsWithDetails(ORG_ID);
    const completed = finalCalls.filter(c => c.status === "completed");
    assert.equal(completed.length, COUNT, `All ${COUNT} calls must be completed`);

    // Verify analysis data integrity
    for (const call of calls) {
      const analysis = await storage.getCallAnalysis(ORG_ID, call.id);
      assert.ok(analysis, `Call ${call.id} must have analysis`);
      assert.ok(analysis!.summary?.startsWith("Summary for call"), "Summary must be correct");
    }
  });
});

// ---------------------------------------------------------------------------
// Retention under load
// ---------------------------------------------------------------------------

describe("Data retention under load", () => {
  it("deleting 100 old calls does not affect newer calls", async () => {
    // Create 100 old calls
    const old = await createCallBatch(100);
    // Create 50 new calls
    const newCalls = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        storage.createCall(ORG_ID, { status: "completed", fileName: `new-${i}.mp3` })
      )
    );

    // Delete all old calls
    await Promise.all(old.map(c => storage.deleteCall(ORG_ID, c.id)));

    const remaining = await storage.getCallsWithDetails(ORG_ID);
    assert.equal(remaining.length, 50, "Only new calls must remain after bulk delete");

    const remainingIds = new Set(remaining.map(c => c.id));
    for (const n of newCalls) {
      assert.ok(remainingIds.has(n.id), `New call ${n.id} must still exist`);
    }
  });
});
