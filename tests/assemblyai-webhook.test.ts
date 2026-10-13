/**
 * HTTP-level tests for POST /api/webhooks/assemblyai.
 *
 * AssemblyAI's webhook body is `{ transcript_id, status }` — not a transcript.
 * The handler used to read `req.body.id` and treat the body as the full
 * transcript, so every real callback got 400 and webhook-mode calls stayed in
 * "processing" forever. No test exercised the route.
 *
 * These mount the real route on Express with MemStorage and stub the two
 * external calls: the AssemblyAI fetch (assemblyAIService.getTranscript) and
 * the Bedrock analysis (aiProvider.analyzeCallTranscript), so no test touches
 * the network even when AWS credentials are present in the environment.
 */
import { describe, it, before, after, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { randomUUID } from "node:crypto";
import express from "express";

const SECRET = "test-assemblyai-webhook-secret";

function post(server: http.Server, body: unknown, token = SECRET): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: addr.port,
        method: "POST",
        path: "/api/webhooks/assemblyai",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          "X-Assembly-Webhook-Token": token,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString();
          resolve({ status: res.statusCode ?? 0, body: raw ? JSON.parse(raw) : undefined });
        });
      },
    );
    req.on("error", reject);
    req.end(payload);
  });
}

async function waitFor<T>(fn: () => Promise<T>, done: (v: T) => boolean, timeoutMs = 5000): Promise<T> {
  const start = Date.now();
  let value = await fn();
  while (!done(value)) {
    if (Date.now() - start > timeoutMs) return value;
    await new Promise((r) => setTimeout(r, 25));
    value = await fn();
  }
  return value;
}

const TRANSCRIPT_TEXT = "Hello, thank you for calling. How can I help you with your appointment today?";

function fullTranscript(id: string) {
  return {
    id,
    status: "completed",
    text: TRANSCRIPT_TEXT,
    confidence: 0.93,
    words: TRANSCRIPT_TEXT.split(" ").map((w, i) => ({
      text: w,
      start: i * 400,
      end: i * 400 + 350,
      confidence: 0.93,
      speaker: i < 6 ? "A" : "B",
    })),
  };
}

describe("AssemblyAI webhook route", () => {
  let server: http.Server;
  let storage: typeof import("../server/storage/index").storage;
  let assemblyAIService: typeof import("../server/services/assemblyai").assemblyAIService;
  let aiProvider: typeof import("../server/services/ai-factory").aiProvider;
  let ephemeralSet: typeof import("../server/services/redis").ephemeralSet;
  let orgId: string;
  let getTranscriptMock: ReturnType<typeof mock.method>;

  before(async () => {
    process.env.ASSEMBLYAI_WEBHOOK_SECRET = SECRET;
    ({ storage } = await import("../server/storage/index"));
    ({ assemblyAIService } = await import("../server/services/assemblyai"));
    ({ aiProvider } = await import("../server/services/ai-factory"));
    ({ ephemeralSet } = await import("../server/services/redis"));
    const { registerAssemblyAIWebhookRoutes } = await import("../server/routes/assemblyai-webhook");

    const org = await storage.createOrganization({
      name: "Webhook Org",
      slug: `wh-${randomUUID().slice(0, 8)}`,
      status: "active",
    } as never);
    orgId = org.id;

    const app = express();
    app.use(express.json());
    registerAssemblyAIWebhookRoutes(app);
    server = app.listen(0);
  });

  after(() => {
    server?.close();
    mock.restoreAll();
  });

  function stubExternals() {
    getTranscriptMock = mock.method(assemblyAIService, "getTranscript", async (id: string) => fullTranscript(id));
    mock.method(aiProvider, "analyzeCallTranscript", async () => ({
      summary: "Agent helped the caller book an appointment.",
      topics: ["scheduling"],
      sentiment: "positive",
      sentiment_score: 0.8,
      performance_score: 7.5,
      sub_scores: { compliance: 7, customer_experience: 8, communication: 7.5, resolution: 7.5 },
      action_items: [],
      feedback: { strengths: [], suggestions: [] },
      call_party_type: "customer",
      flags: [],
      detected_agent_name: null,
    }));
  }

  beforeEach(() => {
    mock.restoreAll();
    stubExternals();
  });

  async function processingCall(transcriptId: string) {
    return storage.createCall(orgId, {
      orgId,
      fileName: "webhook.wav",
      status: "processing",
      assemblyAiId: transcriptId,
    } as never);
  }

  it("accepts the documented { transcript_id, status } body and completes the call", async () => {
    const transcriptId = `tr-${randomUUID()}`;
    const call = await processingCall(transcriptId);

    const res = await post(server, { transcript_id: transcriptId, status: "completed" });
    assert.equal(res.status, 200);

    const done = await waitFor(
      () => storage.getCall(orgId, call.id),
      (c) => c?.status === "completed",
    );
    assert.equal(done?.status, "completed");
    assert.equal(getTranscriptMock.mock.callCount(), 1);
    assert.equal(getTranscriptMock.mock.calls[0].arguments[0], transcriptId);
    const transcript = await storage.getTranscript(orgId, call.id);
    assert.equal(transcript?.text, TRANSCRIPT_TEXT, "transcript must come from the fetched transcript");
  });

  it("returns 400 when no transcript id is present", async () => {
    const res = await post(server, { status: "completed" });
    assert.equal(res.status, 400);
  });

  it("rejects a bad token", async () => {
    const res = await post(server, { transcript_id: "x", status: "completed" }, "wrong-token-value-here");
    assert.equal(res.status, 401);
  });

  it("processes a duplicate delivery only once", async () => {
    const transcriptId = `tr-${randomUUID()}`;
    const call = await processingCall(transcriptId);

    await Promise.all([
      post(server, { transcript_id: transcriptId, status: "completed" }),
      post(server, { transcript_id: transcriptId, status: "completed" }),
    ]);
    await waitFor(
      () => storage.getCall(orgId, call.id),
      (c) => c?.status === "completed",
    );
    assert.equal(getTranscriptMock.mock.callCount(), 1, "second delivery must not re-run the pipeline");
    assert.equal((await storage.getCall(orgId, call.id))?.status, "completed");
  });

  it("marks the call failed on a transcription error status", async () => {
    const transcriptId = `tr-${randomUUID()}`;
    const call = await processingCall(transcriptId);
    await post(server, { transcript_id: transcriptId, status: "error" });
    const c = await waitFor(
      () => storage.getCall(orgId, call.id),
      (v) => v?.status === "failed",
    );
    assert.equal(c?.status, "failed");
    assert.equal(getTranscriptMock.mock.callCount(), 0);
  });

  it("marks the call failed (not stuck processing) when the transcript fetch fails", async () => {
    getTranscriptMock.mock.mockImplementation(async () => {
      throw new Error("AssemblyAI unavailable");
    });
    const transcriptId = `tr-${randomUUID()}`;
    const call = await processingCall(transcriptId);
    await post(server, { transcript_id: transcriptId, status: "completed" });
    const c = await waitFor(
      () => storage.getCall(orgId, call.id),
      (v) => v?.status === "failed",
    );
    assert.equal(c?.status, "failed");
  });

  it("restores upload-time options saved at submit (audio_missing tag survives)", async () => {
    const transcriptId = `tr-${randomUUID()}`;
    const call = await processingCall(transcriptId);
    // What processAudioFile saves when it submits in webhook mode.
    await ephemeralSet("aai-webhook-opts", call.id, JSON.stringify({ audioArchived: false }), 60_000);

    await post(server, { transcript_id: transcriptId, status: "completed" });
    const c = await waitFor(
      () => storage.getCall(orgId, call.id),
      (v) => v?.status === "completed",
    );
    assert.equal(c?.status, "completed");
    assert.ok((c?.tags as string[] | undefined)?.includes("audio_missing"), `tags were ${JSON.stringify(c?.tags)}`);
  });
});
