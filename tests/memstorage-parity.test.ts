/**
 * MemStorage parity tests.
 *
 * These tests pin the four behavioral gaps between MemStorage and PostgresStorage
 * that were documented in CLAUDE.md and shipped in this PR. Run against MemStorage
 * directly so dev/test environments behave like prod.
 *
 *   1. searchCalls scope        — transcript text + analysis.summary + analysis.topics
 *   2. getTopPerformers         — min-call floor (MIN_CALLS_FOR_TOP_PERFORMER_RANKING)
 *   3. deleteOrgData            — also clears liveSessions and audioFiles
 *   4. deleteExpiredCallShares  — only sweeps the calling org's expired shares
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MemStorage, MIN_CALLS_FOR_TOP_PERFORMER_RANKING } from "../server/storage/index.js";

const ORG_A = "00000000-0000-0000-0000-00000000000a";
const ORG_B = "00000000-0000-0000-0000-00000000000b";

async function makeCallWithAnalysis(
  s: MemStorage,
  orgId: string,
  opts: { transcript?: string; summary?: string; topics?: string[]; performanceScore?: string },
): Promise<string> {
  const call = await s.createCall(orgId, { status: "completed" } as any);
  if (opts.transcript) {
    await s.createTranscript(orgId, {
      callId: call.id,
      text: opts.transcript,
      confidence: 0.9,
      words: [],
    } as any);
  }
  if (opts.summary || opts.topics || opts.performanceScore) {
    await s.createCallAnalysis(orgId, {
      callId: call.id,
      performanceScore: opts.performanceScore ?? "5.0",
      summary: opts.summary ?? "",
      flags: [],
      topics: opts.topics ?? [],
      feedback: [],
      subScores: {},
      confidenceFactors: {},
    } as any);
  }
  return call.id;
}

describe("MemStorage parity — searchCalls scope", () => {
  it("matches on transcript text", async () => {
    const s = new MemStorage();
    await makeCallWithAnalysis(s, ORG_A, { transcript: "the patient mentioned chest pain" });
    await makeCallWithAnalysis(s, ORG_A, { transcript: "totally unrelated" });
    const hits = await s.searchCalls(ORG_A, "chest pain");
    assert.equal(hits.length, 1);
    assert.ok(hits[0].transcript?.text.includes("chest pain"));
  });

  it("matches on analysis.summary even when transcript misses (gap 1)", async () => {
    const s = new MemStorage();
    await makeCallWithAnalysis(s, ORG_A, {
      transcript: "neutral conversation about scheduling",
      summary: "Provider reviewed the patient's pacemaker settings during the call.",
    });
    const hits = await s.searchCalls(ORG_A, "pacemaker");
    assert.equal(hits.length, 1, "summary-only matches must surface in dev (parity with PG)");
    assert.ok(hits[0].analysis?.summary?.includes("pacemaker"));
  });

  it("matches on analysis.topics even when transcript and summary miss (gap 1)", async () => {
    const s = new MemStorage();
    await makeCallWithAnalysis(s, ORG_A, {
      transcript: "general greeting",
      summary: "general conversation",
      topics: ["billing", "insurance dispute", "follow-up appointment"],
    });
    const hits = await s.searchCalls(ORG_A, "insurance");
    assert.equal(hits.length, 1, "topic-only matches must surface in dev (parity with PG)");
  });

  it("does not return cross-org matches", async () => {
    const s = new MemStorage();
    await makeCallWithAnalysis(s, ORG_A, { transcript: "shared keyword" });
    await makeCallWithAnalysis(s, ORG_B, { transcript: "shared keyword" });
    const hitsA = await s.searchCalls(ORG_A, "shared");
    assert.equal(hitsA.length, 1, "must be tenant-scoped");
  });
});

describe("MemStorage parity — getTopPerformers min-call floor", () => {
  it("excludes employees below the min-calls threshold (gap 2)", async () => {
    const s = new MemStorage();
    const lowVolume = await s.createEmployee(ORG_A, { name: "Newbie", email: "newbie@x.com" } as any);
    const highVolume = await s.createEmployee(ORG_A, { name: "Veteran", email: "vet@x.com" } as any);

    // Newbie has 4 calls (below MIN_CALLS_FOR_TOP_PERFORMER_RANKING) all scoring 10
    for (let i = 0; i < MIN_CALLS_FOR_TOP_PERFORMER_RANKING - 1; i++) {
      const id = await makeCallWithAnalysis(s, ORG_A, { performanceScore: "10.0" });
      await s.updateCall(ORG_A, id, { employeeId: lowVolume.id });
    }
    // Veteran has MIN_CALLS_FOR_TOP_PERFORMER_RANKING calls scoring a modest 6
    for (let i = 0; i < MIN_CALLS_FOR_TOP_PERFORMER_RANKING; i++) {
      const id = await makeCallWithAnalysis(s, ORG_A, { performanceScore: "6.0" });
      await s.updateCall(ORG_A, id, { employeeId: highVolume.id });
    }

    const top = await s.getTopPerformers(ORG_A, 5);
    // Despite Newbie's 10/10 average, they must be filtered out because they have
    // too few calls — same rule PG applies via HAVING count(*) >= threshold.
    const ids = top.map((t) => t.id);
    assert.ok(!ids.includes(lowVolume.id), "low-volume employee must be excluded");
    assert.ok(ids.includes(highVolume.id), "high-volume employee must be included");
  });

  it("threshold constant is consistently exported and applied", () => {
    assert.ok(MIN_CALLS_FOR_TOP_PERFORMER_RANKING >= 5, "threshold must be ≥ 5 to dilute small samples");
  });
});

describe("MemStorage parity — deleteExpiredCallShares is org-scoped", () => {
  it("only sweeps expired shares in the requested org (gap 4)", async () => {
    const s = new MemStorage();
    const callA = await s.createCall(ORG_A, { status: "completed" } as any);
    const callB = await s.createCall(ORG_B, { status: "completed" } as any);

    const expired = new Date(Date.now() - 60_000).toISOString();
    await s.createCallShare(ORG_A, {
      orgId: ORG_A,
      callId: callA.id,
      tokenHash: "hashA",
      tokenPrefix: "prefA",
      expiresAt: expired,
      createdBy: "user",
    } as any);
    await s.createCallShare(ORG_B, {
      orgId: ORG_B,
      callId: callB.id,
      tokenHash: "hashB",
      tokenPrefix: "prefB",
      expiresAt: expired,
      createdBy: "user",
    } as any);

    await s.deleteExpiredCallShares(ORG_A);

    const remainingA = await s.listCallShares(ORG_A, callA.id);
    const remainingB = await s.listCallShares(ORG_B, callB.id);
    assert.equal(remainingA.length, 0, "org A's expired share should be gone");
    assert.equal(remainingB.length, 1, "org B's expired share should still be present (not their sweep)");
  });
});

describe("MemStorage parity — deleteOrgData scope", () => {
  it("clears liveSessions for the org (gap 3)", async () => {
    const s = new MemStorage();
    await s.createLiveSession(ORG_A, {
      orgId: ORG_A,
      createdBy: "user-1",
      status: "active",
    } as any);
    const beforeActive = await s.getActiveLiveSessions(ORG_A);
    assert.equal(beforeActive.length, 1);

    await s.deleteOrgData(ORG_A);

    const afterActive = await s.getActiveLiveSessions(ORG_A);
    assert.equal(afterActive.length, 0, "deleteOrgData must clean up liveSessions");
  });

  it("clears audio buffers stored under the org's prefix (gap 3)", async () => {
    const s = new MemStorage();
    const call = await s.createCall(ORG_A, { status: "completed" } as any);
    await s.uploadAudio(ORG_A, call.id, "rec.mp3", Buffer.from("fake audio bytes"), "audio/mpeg");
    const filesBefore = await s.getAudioFiles(ORG_A, call.id);
    assert.equal(filesBefore.length, 1, "audio file should be present before purge");

    await s.deleteOrgData(ORG_A);

    const filesAfter = await s.getAudioFiles(ORG_A, call.id);
    assert.equal(filesAfter.length, 0, "audio buffer must be cleared by deleteOrgData");
  });

  it("does not touch other orgs' data", async () => {
    const s = new MemStorage();
    const callA = await s.createCall(ORG_A, { status: "completed" } as any);
    const callB = await s.createCall(ORG_B, { status: "completed" } as any);
    await s.createTranscript(ORG_B, {
      callId: callB.id,
      text: "B-org transcript",
      confidence: 0.9,
      words: [],
    } as any);

    await s.deleteOrgData(ORG_A);

    const orgACalls = await s.getCallsWithDetails(ORG_A);
    const orgBCalls = await s.getCallsWithDetails(ORG_B);
    assert.equal(orgACalls.length, 0, "org A's calls should be gone");
    assert.equal(orgBCalls.length, 1, "org B's calls must be untouched");
    const tx = await s.getTranscript(ORG_B, callB.id);
    assert.ok(tx, "org B's transcript must be untouched");
    void callA; // referenced for clarity
  });
});
