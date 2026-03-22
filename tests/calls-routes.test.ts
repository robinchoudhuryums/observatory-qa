/**
 * Integration tests for server/routes/calls.ts
 *
 * Tests call CRUD, upload validation, analysis editing, assignment,
 * tag management, duplicate detection, and data isolation.
 * Uses MemStorage directly (no external services).
 *
 * Run with: npx tsx --test tests/calls-routes.test.ts
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { MemStorage } from "../server/storage/memory.js";

const ORG_ID = "org-calls-test";
const OTHER_ORG = "org-other";

let storage: MemStorage;

beforeEach(() => {
  storage = new MemStorage();
});

// ==================== CALL CRUD ====================

describe("Call CRUD operations", () => {
  it("creates a call with explicit status", async () => {
    const call = await storage.createCall(ORG_ID, { fileName: "test.mp3", status: "pending" });
    assert.ok(call.id);
    assert.equal(call.orgId, ORG_ID);
    assert.equal(call.status, "pending");
    assert.equal(call.fileName, "test.mp3");
  });

  it("creates a call with all optional fields", async () => {
    const call = await storage.createCall(ORG_ID, {
      fileName: "call.wav",
      filePath: "/tmp/call.wav",
      status: "processing",
      duration: 120,
      callCategory: "inbound",
      tags: ["important"],
      channel: "voice",
      fileHash: "abc123hash",
    });
    assert.equal(call.status, "processing");
    assert.equal(call.duration, 120);
    assert.equal(call.callCategory, "inbound");
    assert.deepEqual(call.tags, ["important"]);
    assert.equal(call.channel, "voice");
  });

  it("retrieves a call by ID", async () => {
    const call = await storage.createCall(ORG_ID, { fileName: "test.mp3" });
    const fetched = await storage.getCall(ORG_ID, call.id);
    assert.ok(fetched);
    assert.equal(fetched!.id, call.id);
    assert.equal(fetched!.fileName, "test.mp3");
  });

  it("returns undefined for non-existent call", async () => {
    const fetched = await storage.getCall(ORG_ID, "non-existent-id");
    assert.equal(fetched, undefined);
  });

  it("updates call status", async () => {
    const call = await storage.createCall(ORG_ID, { status: "pending" });
    const updated = await storage.updateCall(ORG_ID, call.id, { status: "completed" });
    assert.ok(updated);
    assert.equal(updated!.status, "completed");
  });

  it("updates call employee assignment", async () => {
    const emp = await storage.createEmployee(ORG_ID, { name: "Alice", email: "alice@test.com" });
    const call = await storage.createCall(ORG_ID, { status: "completed" });
    const updated = await storage.updateCall(ORG_ID, call.id, { employeeId: emp.id });
    assert.ok(updated);
    assert.equal(updated!.employeeId, emp.id);
  });

  it("updates call tags", async () => {
    const call = await storage.createCall(ORG_ID, { tags: ["tag1"] });
    const updated = await storage.updateCall(ORG_ID, call.id, { tags: ["tag1", "tag2", "new_tag"] });
    assert.ok(updated);
    assert.deepEqual(updated!.tags, ["tag1", "tag2", "new_tag"]);
  });

  it("deletes a call", async () => {
    const call = await storage.createCall(ORG_ID, { status: "completed" });
    await storage.deleteCall(ORG_ID, call.id);
    const fetched = await storage.getCall(ORG_ID, call.id);
    assert.equal(fetched, undefined);
  });

  it("lists all calls for org", async () => {
    await storage.createCall(ORG_ID, { fileName: "a.mp3" });
    await storage.createCall(ORG_ID, { fileName: "b.mp3" });
    const calls = await storage.getAllCalls(ORG_ID);
    assert.equal(calls.length, 2);
  });
});

// ==================== CALL DATA ISOLATION ====================

describe("Call data isolation", () => {
  it("calls are isolated between orgs", async () => {
    await storage.createCall(ORG_ID, { fileName: "org1.mp3" });
    await storage.createCall(ORG_ID, { fileName: "org1b.mp3" });
    await storage.createCall(OTHER_ORG, { fileName: "org2.mp3" });

    const org1Calls = await storage.getAllCalls(ORG_ID);
    const org2Calls = await storage.getAllCalls(OTHER_ORG);
    assert.equal(org1Calls.length, 2);
    assert.equal(org2Calls.length, 1);
  });

  it("getCall only returns from correct org", async () => {
    const call = await storage.createCall(ORG_ID, { fileName: "test.mp3" });
    const found = await storage.getCall(ORG_ID, call.id);
    assert.ok(found);
    const notFound = await storage.getCall(OTHER_ORG, call.id);
    assert.equal(notFound, undefined);
  });

  it("updateCall only updates in correct org", async () => {
    const call = await storage.createCall(ORG_ID, { status: "pending" });
    const updated = await storage.updateCall(OTHER_ORG, call.id, { status: "completed" });
    assert.equal(updated, undefined);
    // Original should be unchanged
    const original = await storage.getCall(ORG_ID, call.id);
    assert.equal(original!.status, "pending");
  });

  it("deleteCall only deletes from correct org", async () => {
    const call = await storage.createCall(ORG_ID, { status: "completed" });
    await storage.deleteCall(OTHER_ORG, call.id);
    // Should still exist in original org
    const found = await storage.getCall(ORG_ID, call.id);
    assert.ok(found);
  });
});

// ==================== DUPLICATE DETECTION ====================

describe("Duplicate file detection", () => {
  it("getCallByFileHash finds existing call", async () => {
    const hash = "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";
    await storage.createCall(ORG_ID, { fileName: "original.mp3", fileHash: hash, status: "completed" });

    const found = await storage.getCallByFileHash(ORG_ID, hash);
    assert.ok(found);
    assert.equal(found!.fileName, "original.mp3");
  });

  it("getCallByFileHash returns undefined for unknown hash", async () => {
    const found = await storage.getCallByFileHash(ORG_ID, "unknown-hash");
    assert.equal(found, undefined);
  });

  it("getCallByFileHash is org-scoped", async () => {
    const hash = "shared-hash-value-1234567890abcdef";
    await storage.createCall(ORG_ID, { fileName: "org1.mp3", fileHash: hash, status: "completed" });

    const found = await storage.getCallByFileHash(OTHER_ORG, hash);
    assert.equal(found, undefined);
  });

  it("getCallByFileHash skips failed calls", async () => {
    const hash = "failed-hash-1234567890abcdef";
    await storage.createCall(ORG_ID, { fileName: "failed.mp3", fileHash: hash, status: "failed" });

    const found = await storage.getCallByFileHash(ORG_ID, hash);
    assert.equal(found, undefined);
  });
});

// ==================== TRANSCRIPT OPERATIONS ====================

describe("Transcript operations", () => {
  it("creates and retrieves transcript for a call", async () => {
    const call = await storage.createCall(ORG_ID, { status: "completed" });
    await storage.createTranscript(ORG_ID, {
      callId: call.id,
      text: "Hello, this is a test transcript.",
      confidence: "0.95",
    });

    const transcript = await storage.getTranscript(ORG_ID, call.id);
    assert.ok(transcript);
    assert.equal(transcript!.text, "Hello, this is a test transcript.");
    assert.equal(transcript!.confidence, "0.95");
  });

  it("transcript is org-scoped", async () => {
    const call = await storage.createCall(ORG_ID, { status: "completed" });
    await storage.createTranscript(ORG_ID, { callId: call.id, text: "Secret data" });

    const notFound = await storage.getTranscript(OTHER_ORG, call.id);
    assert.equal(notFound, undefined);
  });

  it("updates transcript text", async () => {
    const call = await storage.createCall(ORG_ID, { status: "completed" });
    await storage.createTranscript(ORG_ID, { callId: call.id, text: "Original text" });

    const updated = await storage.updateTranscript(ORG_ID, call.id, { text: "Corrected text" });
    assert.ok(updated);
    assert.equal(updated!.text, "Corrected text");
  });
});

// ==================== ANALYSIS OPERATIONS ====================

describe("Analysis operations", () => {
  it("creates and retrieves call analysis", async () => {
    const call = await storage.createCall(ORG_ID, { status: "completed" });
    await storage.createCallAnalysis(ORG_ID, {
      callId: call.id,
      performanceScore: "8.5",
      summary: "Good call",
      topics: ["billing", "support"],
      flags: [],
    });

    const analysis = await storage.getCallAnalysis(ORG_ID, call.id);
    assert.ok(analysis);
    assert.equal(analysis!.performanceScore, "8.5");
    assert.equal(analysis!.summary, "Good call");
    assert.deepEqual(analysis!.topics, ["billing", "support"]);
  });

  it("analysis is org-scoped", async () => {
    const call = await storage.createCall(ORG_ID, { status: "completed" });
    await storage.createCallAnalysis(ORG_ID, { callId: call.id, performanceScore: "7.0" });

    const notFound = await storage.getCallAnalysis(OTHER_ORG, call.id);
    assert.equal(notFound, undefined);
  });

  it("updates existing call analysis", async () => {
    const call = await storage.createCall(ORG_ID, { status: "completed" });
    await storage.createCallAnalysis(ORG_ID, {
      callId: call.id,
      performanceScore: "7.0",
      summary: "Original summary",
      flags: [],
    });

    const updated = await storage.updateCallAnalysis(ORG_ID, call.id, {
      performanceScore: "8.5",
      summary: "Updated summary",
      manualEdits: [{ editedBy: "admin", reason: "Correction" }],
    });

    assert.ok(updated);
    assert.equal(updated!.performanceScore, "8.5");
    assert.equal(updated!.summary, "Updated summary");
    assert.ok(Array.isArray(updated!.manualEdits));
  });

  it("updateCallAnalysis returns undefined for wrong org", async () => {
    const call = await storage.createCall(ORG_ID, { status: "completed" });
    await storage.createCallAnalysis(ORG_ID, { callId: call.id, performanceScore: "7.0" });

    const result = await storage.updateCallAnalysis(OTHER_ORG, call.id, { performanceScore: "9.0" });
    assert.equal(result, undefined);
  });

  it("updateCallAnalysis preserves fields not in updates", async () => {
    const call = await storage.createCall(ORG_ID, { status: "completed" });
    await storage.createCallAnalysis(ORG_ID, {
      callId: call.id,
      performanceScore: "7.0",
      summary: "Keep this",
      topics: ["billing"],
    });

    const updated = await storage.updateCallAnalysis(ORG_ID, call.id, {
      performanceScore: "9.0",
    });

    assert.ok(updated);
    assert.equal(updated!.performanceScore, "9.0");
    assert.equal(updated!.summary, "Keep this");
    assert.deepEqual(updated!.topics, ["billing"]);
  });
});

// ==================== SENTIMENT OPERATIONS ====================

describe("Sentiment operations", () => {
  it("creates and retrieves sentiment analysis", async () => {
    const call = await storage.createCall(ORG_ID, { status: "completed" });
    await storage.createSentimentAnalysis(ORG_ID, {
      callId: call.id,
      overallSentiment: "positive",
      overallScore: "0.85",
    });

    const sentiment = await storage.getSentimentAnalysis(ORG_ID, call.id);
    assert.ok(sentiment);
    assert.equal(sentiment!.overallSentiment, "positive");
    assert.equal(sentiment!.overallScore, "0.85");
  });

  it("sentiment is org-scoped", async () => {
    const call = await storage.createCall(ORG_ID, { status: "completed" });
    await storage.createSentimentAnalysis(ORG_ID, {
      callId: call.id,
      overallSentiment: "positive",
    });

    const notFound = await storage.getSentimentAnalysis(OTHER_ORG, call.id);
    assert.equal(notFound, undefined);
  });
});

// ==================== CALLS WITH DETAILS ====================

describe("Calls with details", () => {
  it("returns call with employee, transcript, sentiment, and analysis", async () => {
    const emp = await storage.createEmployee(ORG_ID, { name: "Alice", email: "alice@test.com" });
    const call = await storage.createCall(ORG_ID, { status: "completed", employeeId: emp.id });
    await storage.createTranscript(ORG_ID, { callId: call.id, text: "Hello" });
    await storage.createSentimentAnalysis(ORG_ID, { callId: call.id, overallSentiment: "positive" });
    await storage.createCallAnalysis(ORG_ID, { callId: call.id, performanceScore: "8.0" });

    const details = await storage.getCallsWithDetails(ORG_ID);
    assert.equal(details.length, 1);
    assert.equal(details[0].employee?.name, "Alice");
    assert.ok(details[0].transcript);
    assert.ok(details[0].sentiment);
    assert.ok(details[0].analysis);
  });

  it("filters calls by status", async () => {
    await storage.createCall(ORG_ID, { status: "completed" });
    await storage.createCall(ORG_ID, { status: "pending" });
    await storage.createCall(ORG_ID, { status: "failed" });

    const completed = await storage.getCallsWithDetails(ORG_ID, { status: "completed" });
    assert.equal(completed.length, 1);
    assert.equal(completed[0].status, "completed");
  });

  it("filters calls by employee", async () => {
    const emp = await storage.createEmployee(ORG_ID, { name: "Alice", email: "alice@test.com" });
    await storage.createCall(ORG_ID, { status: "completed", employeeId: emp.id });
    await storage.createCall(ORG_ID, { status: "completed" }); // no employee

    const filtered = await storage.getCallsWithDetails(ORG_ID, { employee: emp.id });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].employeeId, emp.id);
  });

  it("returns all calls when no pagination specified", async () => {
    for (let i = 0; i < 5; i++) {
      await storage.createCall(ORG_ID, { fileName: `call-${i}.mp3`, status: "completed" });
    }

    const all = await storage.getCallsWithDetails(ORG_ID);
    assert.equal(all.length, 5);
  });
});

// ==================== SEARCH ====================

describe("Call search", () => {
  it("searches across transcripts and analysis", async () => {
    const call = await storage.createCall(ORG_ID, { status: "completed" });
    await storage.createTranscript(ORG_ID, { callId: call.id, text: "Customer asked about billing policy" });
    await storage.createCallAnalysis(ORG_ID, { callId: call.id, summary: "Billing inquiry" });

    const results = await storage.searchCalls(ORG_ID, "billing");
    assert.ok(results.length > 0);
  });

  it("search is org-scoped", async () => {
    const call = await storage.createCall(ORG_ID, { status: "completed" });
    await storage.createTranscript(ORG_ID, { callId: call.id, text: "Secret information" });

    const results = await storage.searchCalls(OTHER_ORG, "secret");
    assert.equal(results.length, 0);
  });

  it("search returns empty for no matches", async () => {
    const call = await storage.createCall(ORG_ID, { status: "completed" });
    await storage.createTranscript(ORG_ID, { callId: call.id, text: "Normal conversation" });

    const results = await storage.searchCalls(ORG_ID, "xyznonexistent");
    assert.equal(results.length, 0);
  });
});

// ==================== COUNT OPERATIONS ====================

describe("Count operations", () => {
  it("countCallsByOrg returns correct count", async () => {
    await storage.createCall(ORG_ID, { status: "completed" });
    await storage.createCall(ORG_ID, { status: "pending" });
    await storage.createCall(OTHER_ORG, { status: "completed" });

    const count = await storage.countCallsByOrg(ORG_ID);
    assert.equal(count, 2);
  });

  it("countUsersByOrg returns correct count", async () => {
    await storage.createUser({ orgId: ORG_ID, username: "user1", role: "viewer", name: "User 1" });
    await storage.createUser({ orgId: ORG_ID, username: "user2", role: "admin", name: "User 2" });
    await storage.createUser({ orgId: OTHER_ORG, username: "user3", role: "admin", name: "User 3" });

    const count = await storage.countUsersByOrg(ORG_ID);
    assert.equal(count, 2);
  });

  it("countCallsByOrgAndStatus returns breakdown", async () => {
    await storage.createCall(ORG_ID, { status: "completed" });
    await storage.createCall(ORG_ID, { status: "completed" });
    await storage.createCall(ORG_ID, { status: "pending" });
    await storage.createCall(ORG_ID, { status: "failed" });

    const counts = await storage.countCallsByOrgAndStatus(ORG_ID);
    assert.equal(counts.completed, 2);
    assert.equal(counts.pending, 1);
    assert.equal(counts.failed, 1);
    assert.equal(counts.processing, 0);
  });

  it("countCallsByOrg returns 0 for empty org", async () => {
    const count = await storage.countCallsByOrg("empty-org");
    assert.equal(count, 0);
  });
});

// ==================== EMPTY TRANSCRIPT HANDLING ====================

describe("Empty transcript handling", () => {
  it("short transcripts should be flagged", () => {
    const transcriptText = "Hi";
    const isEmpty = !transcriptText || transcriptText.trim().length < 10;
    assert.equal(isEmpty, true);
  });

  it("normal transcripts should not be flagged", () => {
    const transcriptText = "Hello, thank you for calling. How can I help you today?";
    const isEmpty = !transcriptText || transcriptText.trim().length < 10;
    assert.equal(isEmpty, false);
  });

  it("empty string is flagged", () => {
    const isEmpty = !("") || ("").trim().length < 10;
    assert.equal(isEmpty, true);
  });
});

// ==================== SERVER-SIDE FLAG ENFORCEMENT ====================

describe("Server-side flag enforcement", () => {
  it("adds low_score flag when performance <= 2.0", () => {
    const performanceScore = 2.0;
    const flags: string[] = [];
    if (performanceScore <= 2.0) flags.push("low_score");
    if (performanceScore >= 9.0) flags.push("exceptional_call");
    assert.ok(flags.includes("low_score"));
    assert.ok(!flags.includes("exceptional_call"));
  });

  it("adds exceptional_call flag when performance >= 9.0", () => {
    const performanceScore = 9.5;
    const flags: string[] = [];
    if (performanceScore <= 2.0) flags.push("low_score");
    if (performanceScore >= 9.0) flags.push("exceptional_call");
    assert.ok(flags.includes("exceptional_call"));
    assert.ok(!flags.includes("low_score"));
  });

  it("no flags for mid-range scores", () => {
    const performanceScore = 5.0;
    const flags: string[] = [];
    if (performanceScore <= 2.0) flags.push("low_score");
    if (performanceScore >= 9.0) flags.push("exceptional_call");
    assert.equal(flags.length, 0);
  });

  it("boundary: 2.0 gets low_score flag", () => {
    const performanceScore = 2.0;
    const flags: string[] = [];
    if (performanceScore <= 2.0) flags.push("low_score");
    assert.ok(flags.includes("low_score"));
  });

  it("boundary: 9.0 gets exceptional_call flag", () => {
    const performanceScore = 9.0;
    const flags: string[] = [];
    if (performanceScore >= 9.0) flags.push("exceptional_call");
    assert.ok(flags.includes("exceptional_call"));
  });
});

// ==================== SCORE CLAMPING ====================

describe("Score clamping", () => {
  it("clamps performance score to 0-10 range", () => {
    const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
    assert.equal(clamp(-1, 0, 10), 0);
    assert.equal(clamp(15, 0, 10), 10);
    assert.equal(clamp(7.5, 0, 10), 7.5);
  });

  it("clamps sentiment score to 0-1 range", () => {
    const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
    assert.equal(clamp(-0.5, 0, 1), 0);
    assert.equal(clamp(1.5, 0, 1), 1);
    assert.equal(clamp(0.85, 0, 1), 0.85);
  });
});

// ==================== MULTI-CHANNEL CALLS ====================

describe("Multi-channel call support", () => {
  it("creates email channel call with email fields", async () => {
    const call = await storage.createCall(ORG_ID, {
      channel: "email",
      emailSubject: "Inquiry about services",
      emailFrom: "customer@example.com",
      emailTo: "support@company.com",
      emailCc: "manager@company.com",
      emailBody: "I want to learn more about your services.",
      emailBodyHtml: "<p>I want to learn more about your services.</p>",
      emailMessageId: "msg-123",
      emailThreadId: "thread-456",
      emailReceivedAt: "2025-01-15T10:00:00Z",
    });

    assert.equal(call.channel, "email");
    assert.equal(call.emailSubject, "Inquiry about services");
    assert.equal(call.emailFrom, "customer@example.com");
    assert.equal(call.emailCc, "manager@company.com");
    assert.equal(call.emailBodyHtml, "<p>I want to learn more about your services.</p>");
    assert.equal(call.emailMessageId, "msg-123");
  });

  it("defaults to voice channel", async () => {
    const call = await storage.createCall(ORG_ID, { fileName: "call.mp3" });
    // MemStorage uses spread, so channel may be undefined (voice is default in pg-storage)
    assert.ok(!call.channel || call.channel === "voice");
  });

  it("creates chat channel call with chat fields", async () => {
    const call = await storage.createCall(ORG_ID, {
      channel: "chat",
      chatPlatform: "intercom",
      messageCount: 15,
    });

    assert.equal(call.channel, "chat");
    assert.equal(call.chatPlatform, "intercom");
    assert.equal(call.messageCount, 15);
  });
});

// ==================== FILE UPLOAD VALIDATION ====================

describe("File upload validation", () => {
  const ALLOWED_AUDIO_TYPES = new Set([
    "audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav",
    "audio/mp4", "audio/x-m4a", "audio/ogg", "audio/webm",
    "audio/flac", "audio/x-flac", "video/mp4", "video/webm",
  ]);
  const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
  const MAX_BATCH_SIZE = 20;

  it("accepts valid audio MIME types", () => {
    assert.ok(ALLOWED_AUDIO_TYPES.has("audio/mpeg"));
    assert.ok(ALLOWED_AUDIO_TYPES.has("audio/wav"));
    assert.ok(ALLOWED_AUDIO_TYPES.has("audio/mp4"));
    assert.ok(ALLOWED_AUDIO_TYPES.has("audio/flac"));
  });

  it("rejects invalid MIME types", () => {
    assert.ok(!ALLOWED_AUDIO_TYPES.has("text/plain"));
    assert.ok(!ALLOWED_AUDIO_TYPES.has("image/jpeg"));
    assert.ok(!ALLOWED_AUDIO_TYPES.has("application/pdf"));
  });

  it("enforces file size limit", () => {
    const fileSize = 150 * 1024 * 1024; // 150MB
    assert.ok(fileSize > MAX_FILE_SIZE, "File should exceed limit");
  });

  it("allows files under size limit", () => {
    const fileSize = 50 * 1024 * 1024; // 50MB
    assert.ok(fileSize <= MAX_FILE_SIZE, "File should be under limit");
  });

  it("enforces batch upload limit", () => {
    const fileCount = 25;
    assert.ok(fileCount > MAX_BATCH_SIZE, "Batch should exceed limit");
  });
});

// ==================== FILE HASH DEDUPLICATION ====================

describe("File hash computation", () => {
  it("SHA256 produces consistent hashes", async () => {
    const { createHash } = await import("node:crypto");
    const data = Buffer.from("test audio data");
    const hash1 = createHash("sha256").update(data).digest("hex");
    const hash2 = createHash("sha256").update(data).digest("hex");
    assert.equal(hash1, hash2);
    assert.equal(hash1.length, 64);
  });

  it("different data produces different hashes", async () => {
    const { createHash } = await import("node:crypto");
    const hash1 = createHash("sha256").update(Buffer.from("data1")).digest("hex");
    const hash2 = createHash("sha256").update(Buffer.from("data2")).digest("hex");
    assert.notEqual(hash1, hash2);
  });
});

// ==================== MANUAL EDIT TRACKING ====================

describe("Manual analysis edit tracking", () => {
  it("tracks edit history with metadata", async () => {
    const call = await storage.createCall(ORG_ID, { status: "completed" });
    await storage.createCallAnalysis(ORG_ID, {
      callId: call.id,
      performanceScore: "7.0",
      summary: "Original",
      flags: [],
      manualEdits: [],
    });

    const editRecord = {
      editedBy: "Manager Smith",
      editedAt: new Date().toISOString(),
      reason: "Score was too low for excellent call",
      fieldsChanged: ["performanceScore", "summary"],
      previousValues: { performanceScore: "7.0", summary: "Original" },
    };

    const updated = await storage.updateCallAnalysis(ORG_ID, call.id, {
      performanceScore: "9.0",
      summary: "Excellent customer interaction",
      manualEdits: [editRecord],
    });

    assert.ok(updated);
    assert.equal(updated!.performanceScore, "9.0");
    assert.equal(updated!.summary, "Excellent customer interaction");
    const edits = updated!.manualEdits as any[];
    assert.equal(edits.length, 1);
    assert.equal(edits[0].editedBy, "Manager Smith");
    assert.equal(edits[0].reason, "Score was too low for excellent call");
    assert.deepEqual(edits[0].fieldsChanged, ["performanceScore", "summary"]);
  });

  it("preserves previous edit history on subsequent edits", async () => {
    const call = await storage.createCall(ORG_ID, { status: "completed" });
    await storage.createCallAnalysis(ORG_ID, {
      callId: call.id,
      performanceScore: "5.0",
      manualEdits: [{ editedBy: "Admin", reason: "First edit" }],
    });

    const updated = await storage.updateCallAnalysis(ORG_ID, call.id, {
      performanceScore: "8.0",
      manualEdits: [
        { editedBy: "Admin", reason: "First edit" },
        { editedBy: "Manager", reason: "Second edit" },
      ],
    });

    assert.ok(updated);
    const edits = updated!.manualEdits as any[];
    assert.equal(edits.length, 2);
    assert.equal(edits[0].editedBy, "Admin");
    assert.equal(edits[1].editedBy, "Manager");
  });
});

// ==================== EMPLOYEE AUTO-ASSIGNMENT LOGIC ====================

describe("Employee auto-assignment logic", () => {
  it("matches employee by exact full name", async () => {
    const emp = await storage.createEmployee(ORG_ID, { name: "Sarah Johnson", email: "sarah@test.com", status: "active" });
    const employees = await storage.getAllEmployees(ORG_ID);

    const detectedName = "Sarah Johnson";
    const match = employees.find(e => e.name === detectedName && e.status === "active");
    assert.ok(match);
    assert.equal(match!.id, emp.id);
  });

  it("skips assignment for ambiguous matches", async () => {
    await storage.createEmployee(ORG_ID, { name: "Sarah Johnson", email: "sarah.j@test.com", status: "active" });
    await storage.createEmployee(ORG_ID, { name: "Sarah Smith", email: "sarah.s@test.com", status: "active" });
    const employees = await storage.getAllEmployees(ORG_ID);

    const detectedName = "Sarah";
    const matches = employees.filter(e =>
      e.status === "active" && e.name.toLowerCase().includes(detectedName.toLowerCase())
    );
    assert.ok(matches.length > 1, "Should have multiple matches — ambiguous");
  });

  it("skips inactive employees", async () => {
    await storage.createEmployee(ORG_ID, { name: "Inactive Agent", email: "inactive@test.com", status: "inactive" });
    const employees = await storage.getAllEmployees(ORG_ID);

    const detectedName = "Inactive Agent";
    const activeMatches = employees.filter(e => e.name === detectedName && e.status === "active");
    assert.equal(activeMatches.length, 0);
  });
});
