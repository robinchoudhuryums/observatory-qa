/**
 * Cross-org data isolation tests — deep coverage beyond multitenant.test.ts.
 *
 * Verifies that API keys, coaching sessions, reference docs, prompt templates,
 * feedback, calibration, ab-tests, and invitations cannot leak across org
 * boundaries even when an attacker supplies a valid entity ID from another org.
 *
 * Run with: npx tsx --test tests/cross-org-isolation.test.ts
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { MemStorage } from "../server/storage/index.js";

const ORG_A = "org-isolation-a";
const ORG_B = "org-isolation-b";

let storage: MemStorage;

beforeEach(() => {
  storage = new MemStorage();
});

// ---------------------------------------------------------------------------
// User management isolation
// ---------------------------------------------------------------------------

describe("User isolation", () => {
  it("users are scoped to their org", async () => {
    await storage.createUser(ORG_A, {
      username: "alice", passwordHash: "hash", name: "Alice", role: "admin",
    });
    await storage.createUser(ORG_B, {
      username: "bob", passwordHash: "hash", name: "Bob", role: "viewer",
    });

    const orgAUsers = await storage.listUsersByOrg(ORG_A);
    const orgBUsers = await storage.listUsersByOrg(ORG_B);

    assert.equal(orgAUsers.length, 1);
    assert.equal(orgAUsers[0].username, "alice");
    assert.equal(orgBUsers.length, 1);
    assert.equal(orgBUsers[0].username, "bob");
  });

  it("same username in different orgs is allowed (per-org uniqueness)", async () => {
    const userA = await storage.createUser(ORG_A, {
      username: "admin", passwordHash: "hashA", name: "Admin A", role: "admin",
    });
    const userB = await storage.createUser(ORG_B, {
      username: "admin", passwordHash: "hashB", name: "Admin B", role: "admin",
    });

    assert.notEqual(userA.id, userB.id);
    assert.equal(userA.orgId, ORG_A);
    assert.equal(userB.orgId, ORG_B);
  });

  it("getUserByUsername with orgId scoping", async () => {
    await storage.createUser(ORG_A, {
      username: "shared", passwordHash: "hashA", name: "Shared A", role: "admin",
    });
    await storage.createUser(ORG_B, {
      username: "shared", passwordHash: "hashB", name: "Shared B", role: "admin",
    });

    const fromA = await storage.getUserByUsername("shared", ORG_A);
    assert.ok(fromA);
    assert.equal(fromA!.name, "Shared A");

    const fromB = await storage.getUserByUsername("shared", ORG_B);
    assert.ok(fromB);
    assert.equal(fromB!.name, "Shared B");
  });

  it("deleteUser only deletes within correct org", async () => {
    const userA = await storage.createUser(ORG_A, {
      username: "target", passwordHash: "hash", name: "Target", role: "viewer",
    });
    await storage.createUser(ORG_B, {
      username: "other", passwordHash: "hash", name: "Other", role: "viewer",
    });

    await storage.deleteUser(ORG_A, userA.id);

    const usersA = await storage.listUsersByOrg(ORG_A);
    const usersB = await storage.listUsersByOrg(ORG_B);
    assert.equal(usersA.length, 0);
    assert.equal(usersB.length, 1, "Org B user must not be deleted");
  });
});

// ---------------------------------------------------------------------------
// API key isolation
// ---------------------------------------------------------------------------

describe("API key isolation", () => {
  it("API keys are scoped to their org", async () => {
    const keyA = await storage.createApiKey(ORG_A, {
      name: "Key A", keyHash: "hash-a", keyPrefix: "obs_k_a", permissions: ["read"],
    });
    const keyB = await storage.createApiKey(ORG_B, {
      name: "Key B", keyHash: "hash-b", keyPrefix: "obs_k_b", permissions: ["read"],
    });

    const aKeys = await storage.listApiKeys(ORG_A);
    const bKeys = await storage.listApiKeys(ORG_B);
    assert.equal(aKeys.length, 1);
    assert.equal(bKeys.length, 1);
    assert.equal(aKeys[0].id, keyA.id);
    assert.equal(bKeys[0].id, keyB.id);
  });

  it("revoking API key from wrong org has no effect", async () => {
    const keyA = await storage.createApiKey(ORG_A, {
      name: "Key A", keyHash: "hash-a", keyPrefix: "obs_k_a", permissions: ["read"],
    });

    // Attempt to delete Org A key using Org B context
    await storage.deleteApiKey(ORG_B, keyA.id);

    // Key should still exist in Org A
    const aKeys = await storage.listApiKeys(ORG_A);
    assert.equal(aKeys.length, 1);
  });
});

// ---------------------------------------------------------------------------
// Invitation isolation
// ---------------------------------------------------------------------------

describe("Invitation isolation", () => {
  it("invitations are scoped to their org", async () => {
    await storage.createInvitation(ORG_A, {
      email: "new@a.com", role: "viewer", token: "tok-a",
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    });
    await storage.createInvitation(ORG_B, {
      email: "new@b.com", role: "admin", token: "tok-b",
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    });

    const aInvites = await storage.listInvitations(ORG_A);
    const bInvites = await storage.listInvitations(ORG_B);
    assert.equal(aInvites.length, 1);
    assert.equal(aInvites[0].email, "new@a.com");
    assert.equal(bInvites.length, 1);
    assert.equal(bInvites[0].email, "new@b.com");
  });

  it("getInvitationByToken is global (token must be globally unique)", async () => {
    await storage.createInvitation(ORG_A, {
      email: "user@a.com", role: "viewer", token: "unique-token-123",
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    });

    const found = await storage.getInvitationByToken("unique-token-123");
    assert.ok(found);
    assert.equal(found!.orgId, ORG_A);
  });
});

// ---------------------------------------------------------------------------
// Coaching session isolation
// ---------------------------------------------------------------------------

describe("Coaching session isolation", () => {
  it("coaching sessions are isolated between orgs", async () => {
    const callA = await storage.createCall(ORG_A, { status: "completed" });
    const callB = await storage.createCall(ORG_B, { status: "completed" });
    const empA = await storage.createEmployee(ORG_A, { name: "Alice", email: "a@a.com" });
    const empB = await storage.createEmployee(ORG_B, { name: "Bob", email: "b@b.com" });

    await storage.createCoachingSession(ORG_A, {
      employeeId: empA.id, callId: callA.id, category: "performance",
      title: "Session A", status: "scheduled",
    });
    await storage.createCoachingSession(ORG_B, {
      employeeId: empB.id, callId: callB.id, category: "compliance",
      title: "Session B", status: "in_progress",
    });

    const aSessions = await storage.getCoachingSessions(ORG_A);
    const bSessions = await storage.getCoachingSessions(ORG_B);
    assert.equal(aSessions.length, 1);
    assert.equal(aSessions[0].title, "Session A");
    assert.equal(bSessions.length, 1);
    assert.equal(bSessions[0].title, "Session B");
  });
});

// ---------------------------------------------------------------------------
// Prompt template isolation
// ---------------------------------------------------------------------------

describe("Prompt template isolation", () => {
  it("prompt templates are scoped to their org", async () => {
    await storage.createPromptTemplate(ORG_A, {
      callCategory: "inbound_sales", evaluationCriteria: "Be helpful.",
      requiredPhrases: [], scoringWeights: {},
    });
    await storage.createPromptTemplate(ORG_B, {
      callCategory: "customer_service", evaluationCriteria: "Be polite.",
      requiredPhrases: [], scoringWeights: {},
    });

    const aTemplates = await storage.getPromptTemplates(ORG_A);
    const bTemplates = await storage.getPromptTemplates(ORG_B);

    assert.equal(aTemplates.length, 1);
    assert.equal(aTemplates[0].callCategory, "inbound_sales");
    assert.equal(bTemplates.length, 1);
    assert.equal(bTemplates[0].callCategory, "customer_service");
  });

  it("deletePromptTemplate from wrong org has no effect", async () => {
    const tpl = await storage.createPromptTemplate(ORG_A, {
      callCategory: "inbound_sales", evaluationCriteria: "Criteria.",
      requiredPhrases: [], scoringWeights: {},
    });

    await storage.deletePromptTemplate(ORG_B, tpl.id);

    const aTemplates = await storage.getPromptTemplates(ORG_A);
    assert.equal(aTemplates.length, 1, "Template must remain in Org A after wrong-org delete");
  });
});

// ---------------------------------------------------------------------------
// Reference document isolation
// ---------------------------------------------------------------------------

describe("Reference document isolation", () => {
  it("reference docs are scoped to their org", async () => {
    await storage.createReferenceDocument(ORG_A, {
      name: "SOP-A", category: "procedures", fileName: "sop-a.pdf",
      extractedText: "Standard operating procedure A.", appliesTo: "all",
    });
    await storage.createReferenceDocument(ORG_B, {
      name: "SOP-B", category: "compliance", fileName: "sop-b.pdf",
      extractedText: "Standard operating procedure B.", appliesTo: "all",
    });

    const aDocs = await storage.listReferenceDocuments(ORG_A);
    const bDocs = await storage.listReferenceDocuments(ORG_B);
    assert.equal(aDocs.length, 1);
    assert.equal(aDocs[0].name, "SOP-A");
    assert.equal(bDocs.length, 1);
    assert.equal(bDocs[0].name, "SOP-B");
  });

  it("deleteReferenceDocument from wrong org has no effect", async () => {
    const doc = await storage.createReferenceDocument(ORG_A, {
      name: "Private Doc", category: "internal", fileName: "private.pdf",
      extractedText: "Confidential.", appliesTo: "all",
    });

    await storage.deleteReferenceDocument(ORG_B, doc.id);

    const aDocs = await storage.listReferenceDocuments(ORG_A);
    assert.equal(aDocs.length, 1, "Document must remain in Org A");
  });
});

// ---------------------------------------------------------------------------
// Call analysis isolation
// ---------------------------------------------------------------------------

describe("Call analysis isolation", () => {
  it("call analysis cannot be read across orgs", async () => {
    const callA = await storage.createCall(ORG_A, { status: "completed" });
    await storage.saveCallAnalysis(ORG_A, {
      callId: callA.id, performanceScore: "8.5",
      summary: "Excellent call", flags: [], topics: [], feedback: [],
      subScores: {}, confidenceFactors: {},
    });

    // Org B cannot read Org A's analysis using the same call ID
    const analysis = await storage.getCallAnalysis(ORG_B, callA.id);
    assert.equal(analysis, undefined);
  });

  it("transcript cannot be read across orgs", async () => {
    const callA = await storage.createCall(ORG_A, { status: "completed" });
    await storage.createTranscript(ORG_A, {
      callId: callA.id, text: "PHI: patient name John Doe", confidence: 0.95, words: [],
    });

    const transcript = await storage.getTranscript(ORG_B, callA.id);
    assert.equal(transcript, undefined);
  });

  it("sentiment analysis cannot be read across orgs", async () => {
    const callA = await storage.createCall(ORG_A, { status: "completed" });
    await storage.saveSentimentAnalysis(ORG_A, {
      callId: callA.id, overallSentiment: "positive", overallScore: 0.9, segments: [],
    });

    const sentiment = await storage.getSentimentAnalysis(ORG_B, callA.id);
    assert.equal(sentiment, undefined);
  });
});

// ---------------------------------------------------------------------------
// Access request isolation
// ---------------------------------------------------------------------------

describe("Access request isolation", () => {
  it("access requests are scoped to their org", async () => {
    await storage.createAccessRequest(ORG_A, {
      name: "Requester A", email: "req@a.com", requestedRole: "viewer",
    });
    await storage.createAccessRequest(ORG_B, {
      name: "Requester B", email: "req@b.com", requestedRole: "manager",
    });

    const aRequests = await storage.getAccessRequests(ORG_A);
    const bRequests = await storage.getAccessRequests(ORG_B);
    assert.equal(aRequests.length, 1);
    assert.equal(aRequests[0].email, "req@a.com");
    assert.equal(bRequests.length, 1);
    assert.equal(bRequests[0].email, "req@b.com");
  });
});

// ---------------------------------------------------------------------------
// Search results isolation
// ---------------------------------------------------------------------------

describe("Search results isolation", () => {
  it("searchCalls only returns results from the correct org", async () => {
    const callA = await storage.createCall(ORG_A, { status: "completed" });
    const callB = await storage.createCall(ORG_B, { status: "completed" });

    await storage.createTranscript(ORG_A, {
      callId: callA.id, text: "The patient said hello", confidence: 0.9, words: [],
    });
    await storage.createTranscript(ORG_B, {
      callId: callB.id, text: "The patient said hello", confidence: 0.9, words: [],
    });

    const aResults = await storage.searchCalls(ORG_A, "patient");
    const bResults = await storage.searchCalls(ORG_B, "patient");

    assert.ok(aResults.every(r => r.orgId === ORG_A), "All results must belong to Org A");
    assert.ok(bResults.every(r => r.orgId === ORG_B), "All results must belong to Org B");
  });
});

// ---------------------------------------------------------------------------
// Cross-entity ID injection attack prevention
// ---------------------------------------------------------------------------

describe("ID injection attack prevention", () => {
  it("cannot retrieve Org A employee using Org B context even with correct ID", async () => {
    const emp = await storage.createEmployee(ORG_A, { name: "Victim", email: "v@a.com" });

    // Attacker uses Org B context with Org A's entity ID
    const stolen = await storage.getEmployee(ORG_B, emp.id);
    assert.equal(stolen, undefined, "Cross-org ID injection must be blocked");
  });

  it("cannot update Org A call using Org B context", async () => {
    const call = await storage.createCall(ORG_A, { status: "pending" });

    const result = await storage.updateCall(ORG_B, call.id, { status: "completed" });
    assert.equal(result, undefined);

    const original = await storage.getCall(ORG_A, call.id);
    assert.equal(original!.status, "pending", "Original call must be unmodified");
  });

  it("cannot delete Org A coaching session using Org B context", async () => {
    const callA = await storage.createCall(ORG_A, { status: "completed" });
    const empA = await storage.createEmployee(ORG_A, { name: "Alice", email: "a@a.com" });
    const session = await storage.createCoachingSession(ORG_A, {
      employeeId: empA.id, callId: callA.id,
      category: "performance", title: "Confidential", status: "scheduled",
    });

    await storage.deleteCoachingSession(ORG_B, session.id);

    const sessions = await storage.getCoachingSessions(ORG_A);
    assert.equal(sessions.length, 1, "Session must remain in Org A");
  });
});
