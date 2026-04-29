/**
 * Storage-layer tests for simulated calls (TTS-generated training/calibration).
 *
 * Covers MemStorage CRUD + cross-org isolation. The CloudStorage path is a
 * stub-throws pattern (synthetic calls require PG or in-memory) and is
 * exercised separately. The PG path is verified at the type level via the
 * IStorage interface — runtime PG behavior is covered by integration tests
 * elsewhere in the suite.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { MemStorage } from "../server/storage/index.js";
import type { InsertSimulatedCall, SimulatedCallScript, SimulatedCallConfig } from "../shared/simulated-call-schema.js";

const baseScript: SimulatedCallScript = {
  title: "Order status check",
  scenario: "Customer calling about a delayed shipment",
  qualityTier: "acceptable",
  voices: { agent: "voice_AGENT_id", customer: "voice_CUST_id" },
  turns: [
    { speaker: "agent", text: "Thanks for calling, how can I help?" },
    { speaker: "customer", text: "I'm checking on my order." },
  ],
};

const baseConfig: SimulatedCallConfig = {
  qualityTier: "acceptable",
  circumstances: [],
  injectDisfluencies: false,
};

function makeInsert(overrides?: Partial<InsertSimulatedCall>): InsertSimulatedCall {
  return {
    orgId: "org-A",
    title: "Order status check",
    scenario: baseScript.scenario,
    qualityTier: "acceptable",
    script: baseScript,
    config: baseConfig,
    createdBy: "admin@orgA.test",
    ...overrides,
  };
}

let storage: MemStorage;

beforeEach(() => {
  storage = new MemStorage();
});

describe("MemStorage simulated calls — create + read", () => {
  it("creates a row with status=pending and returns the persisted shape", async () => {
    const created = await storage.createSimulatedCall("org-A", makeInsert());
    assert.equal(created.orgId, "org-A");
    assert.equal(created.title, "Order status check");
    assert.equal(created.status, "pending");
    assert.equal(created.audioFormat, "mp3");
    assert.equal(created.ttsCharCount, 0);
    assert.equal(created.estimatedCost, 0);
    assert.equal(created.audioS3Key, null);
    assert.equal(created.error, null);
    assert.equal(created.sentToAnalysisCallId, null);
    assert.ok(created.id, "id should be assigned");
    assert.ok(created.createdAt, "createdAt should be set");
    assert.ok(created.updatedAt, "updatedAt should be set");
    assert.deepEqual(created.script, baseScript);
    assert.deepEqual(created.config, baseConfig);
  });

  it("getSimulatedCall returns the row when orgId matches", async () => {
    const created = await storage.createSimulatedCall("org-A", makeInsert());
    const fetched = await storage.getSimulatedCall("org-A", created.id);
    assert.ok(fetched);
    assert.equal(fetched!.id, created.id);
    assert.equal(fetched!.title, "Order status check");
  });

  it("getSimulatedCall returns undefined for missing id", async () => {
    const fetched = await storage.getSimulatedCall("org-A", "does-not-exist");
    assert.equal(fetched, undefined);
  });
});

describe("MemStorage simulated calls — list + filters", () => {
  it("lists rows for the org in reverse-chronological order", async () => {
    const a = await storage.createSimulatedCall("org-A", makeInsert({ title: "first" }));
    // Force a different timestamp for deterministic ordering.
    await new Promise((r) => setTimeout(r, 5));
    const b = await storage.createSimulatedCall("org-A", makeInsert({ title: "second" }));
    const list = await storage.listSimulatedCalls("org-A");
    assert.equal(list.length, 2);
    assert.equal(list[0].id, b.id, "newest first");
    assert.equal(list[1].id, a.id);
  });

  it("filters by status when provided", async () => {
    const created = await storage.createSimulatedCall("org-A", makeInsert());
    await storage.updateSimulatedCall("org-A", created.id, { status: "ready" });
    await storage.createSimulatedCall("org-A", makeInsert({ title: "still pending" }));
    const ready = await storage.listSimulatedCalls("org-A", { status: "ready" });
    assert.equal(ready.length, 1);
    assert.equal(ready[0].status, "ready");
  });

  it("respects the limit option", async () => {
    for (let i = 0; i < 5; i++) {
      await storage.createSimulatedCall("org-A", makeInsert({ title: `call-${i}` }));
    }
    const limited = await storage.listSimulatedCalls("org-A", { limit: 2 });
    assert.equal(limited.length, 2);
  });
});

describe("MemStorage simulated calls — update", () => {
  it("merges partial updates and bumps updatedAt", async () => {
    const created = await storage.createSimulatedCall("org-A", makeInsert());
    const before = created.updatedAt;
    await new Promise((r) => setTimeout(r, 5));
    const updated = await storage.updateSimulatedCall("org-A", created.id, {
      status: "generating",
      ttsCharCount: 1234,
      estimatedCost: 0.37,
    });
    assert.ok(updated);
    assert.equal(updated!.status, "generating");
    assert.equal(updated!.ttsCharCount, 1234);
    assert.equal(updated!.estimatedCost, 0.37);
    assert.equal(updated!.title, created.title, "untouched fields preserved");
    assert.notEqual(updated!.updatedAt, before, "updatedAt must change");
  });

  it("ignores attempts to mutate id or orgId", async () => {
    const created = await storage.createSimulatedCall("org-A", makeInsert());
    const updated = await storage.updateSimulatedCall("org-A", created.id, {
      // @ts-expect-error — intentional misuse to verify the storage layer pins id/orgId
      id: "tampered",
      // @ts-expect-error — intentional misuse to verify cross-org tampering is blocked
      orgId: "org-B",
    });
    assert.ok(updated);
    assert.equal(updated!.id, created.id);
    assert.equal(updated!.orgId, "org-A");
  });

  it("returns undefined when the row does not exist", async () => {
    const result = await storage.updateSimulatedCall("org-A", "ghost", { status: "ready" });
    assert.equal(result, undefined);
  });

  it("can record terminal error state", async () => {
    const created = await storage.createSimulatedCall("org-A", makeInsert());
    const updated = await storage.updateSimulatedCall("org-A", created.id, {
      status: "failed",
      error: "Bedrock 429 rate limit",
    });
    assert.equal(updated!.status, "failed");
    assert.equal(updated!.error, "Bedrock 429 rate limit");
  });

  it("can link a generated call to its analysis Call row", async () => {
    const created = await storage.createSimulatedCall("org-A", makeInsert());
    const updated = await storage.updateSimulatedCall("org-A", created.id, {
      status: "ready",
      audioS3Key: "simulated/org-A/abc.mp3",
      durationSeconds: 47,
      sentToAnalysisCallId: "call-xyz",
    });
    assert.equal(updated!.audioS3Key, "simulated/org-A/abc.mp3");
    assert.equal(updated!.durationSeconds, 47);
    assert.equal(updated!.sentToAnalysisCallId, "call-xyz");
  });
});

describe("MemStorage simulated calls — delete", () => {
  it("removes the row and getSimulatedCall returns undefined", async () => {
    const created = await storage.createSimulatedCall("org-A", makeInsert());
    await storage.deleteSimulatedCall("org-A", created.id);
    const after = await storage.getSimulatedCall("org-A", created.id);
    assert.equal(after, undefined);
  });

  it("is a no-op when the row does not exist", async () => {
    await assert.doesNotReject(() => storage.deleteSimulatedCall("org-A", "missing"));
  });
});

describe("MemStorage simulated calls — cross-org isolation", () => {
  it("getSimulatedCall does not leak rows across orgs", async () => {
    const created = await storage.createSimulatedCall("org-A", makeInsert());
    const leaked = await storage.getSimulatedCall("org-B", created.id);
    assert.equal(leaked, undefined, "org-B must not see org-A's row");
  });

  it("listSimulatedCalls scopes results to the requesting org", async () => {
    await storage.createSimulatedCall("org-A", makeInsert({ orgId: "org-A", title: "A1" }));
    await storage.createSimulatedCall("org-A", makeInsert({ orgId: "org-A", title: "A2" }));
    await storage.createSimulatedCall("org-B", makeInsert({ orgId: "org-B", title: "B1" }));
    const aList = await storage.listSimulatedCalls("org-A");
    const bList = await storage.listSimulatedCalls("org-B");
    assert.equal(aList.length, 2);
    assert.equal(bList.length, 1);
    assert.ok(aList.every((c) => c.orgId === "org-A"));
    assert.ok(bList.every((c) => c.orgId === "org-B"));
  });

  it("updateSimulatedCall refuses to update a row owned by a different org", async () => {
    const created = await storage.createSimulatedCall("org-A", makeInsert());
    const result = await storage.updateSimulatedCall("org-B", created.id, { status: "ready" });
    assert.equal(result, undefined);
    const stillPending = await storage.getSimulatedCall("org-A", created.id);
    assert.equal(stillPending!.status, "pending");
  });

  it("deleteSimulatedCall on the wrong org leaves the row intact", async () => {
    const created = await storage.createSimulatedCall("org-A", makeInsert());
    await storage.deleteSimulatedCall("org-B", created.id);
    const stillThere = await storage.getSimulatedCall("org-A", created.id);
    assert.ok(stillThere, "row must still exist");
  });
});
