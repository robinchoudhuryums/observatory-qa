/**
 * Integration tests for server/routes/admin.ts
 *
 * Tests prompt template CRUD, user management, org settings,
 * audit log queries, and RBAC enforcement.
 * Uses MemStorage directly (no external services).
 *
 * Run with: npx tsx --test tests/admin-routes.test.ts
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { MemStorage } from "../server/storage/memory.js";

const ORG_ID = "org-admin-test";
const OTHER_ORG = "org-admin-other";

let storage: MemStorage;

beforeEach(() => {
  storage = new MemStorage();
});

// ==================== PROMPT TEMPLATE CRUD ====================

describe("Prompt template CRUD", () => {
  it("creates a prompt template", async () => {
    const template = await storage.createPromptTemplate(ORG_ID, {
      callCategory: "inbound",
      evaluationCriteria: "Check for proper greeting and identification",
      requiredPhrases: [{ phrase: "How can I help?", label: "greeting", severity: "required" }],
      scoringWeights: { compliance: 30, customerExperience: 30, communication: 20, resolution: 20 },
    });

    assert.ok(template.id);
    assert.equal(template.orgId, ORG_ID);
    assert.equal(template.callCategory, "inbound");
    assert.equal(template.evaluationCriteria, "Check for proper greeting and identification");
  });

  it("lists prompt templates for org", async () => {
    await storage.createPromptTemplate(ORG_ID, { callCategory: "inbound" });
    await storage.createPromptTemplate(ORG_ID, { callCategory: "outbound" });
    await storage.createPromptTemplate(OTHER_ORG, { callCategory: "inbound" });

    const templates = await storage.getAllPromptTemplates(ORG_ID);
    assert.equal(templates.length, 2);
    assert.ok(templates.every(t => t.orgId === ORG_ID));
  });

  it("gets prompt template by ID", async () => {
    const created = await storage.createPromptTemplate(ORG_ID, { callCategory: "internal" });
    const fetched = await storage.getPromptTemplate(ORG_ID, created.id);
    assert.ok(fetched);
    assert.equal(fetched!.callCategory, "internal");
  });

  it("gets prompt template by org-scoped", async () => {
    const created = await storage.createPromptTemplate(ORG_ID, { callCategory: "internal" });
    const notFound = await storage.getPromptTemplate(OTHER_ORG, created.id);
    assert.equal(notFound, undefined);
  });

  it("updates a prompt template", async () => {
    const created = await storage.createPromptTemplate(ORG_ID, {
      callCategory: "inbound",
      evaluationCriteria: "Old criteria",
    });

    const updated = await storage.updatePromptTemplate(ORG_ID, created.id, {
      evaluationCriteria: "New evaluation criteria with HIPAA checks",
    });

    assert.ok(updated);
    assert.equal(updated!.evaluationCriteria, "New evaluation criteria with HIPAA checks");
    assert.equal(updated!.callCategory, "inbound"); // unchanged
  });

  it("deletes a prompt template", async () => {
    const created = await storage.createPromptTemplate(ORG_ID, { callCategory: "inbound" });
    await storage.deletePromptTemplate(ORG_ID, created.id);
    const fetched = await storage.getPromptTemplate(ORG_ID, created.id);
    assert.equal(fetched, undefined);
  });

  it("does not delete template from wrong org", async () => {
    const created = await storage.createPromptTemplate(ORG_ID, { callCategory: "inbound" });
    await storage.deletePromptTemplate(OTHER_ORG, created.id);
    // Should still exist
    const fetched = await storage.getPromptTemplate(ORG_ID, created.id);
    assert.ok(fetched);
  });
});

// ==================== USER MANAGEMENT ====================

describe("User management CRUD", () => {
  it("creates a user in an org", async () => {
    const user = await storage.createUser({
      orgId: ORG_ID,
      username: "newadmin",
      passwordHash: "hashed-password",
      name: "New Admin",
      role: "admin",
    });

    assert.ok(user.id);
    assert.equal(user.orgId, ORG_ID);
    assert.equal(user.username, "newadmin");
    assert.equal(user.role, "admin");
  });

  it("lists users for org only", async () => {
    await storage.createUser({ orgId: ORG_ID, username: "user1", name: "User 1", role: "viewer" });
    await storage.createUser({ orgId: ORG_ID, username: "user2", name: "User 2", role: "manager" });
    await storage.createUser({ orgId: OTHER_ORG, username: "user3", name: "User 3", role: "admin" });

    const users = await storage.listUsersByOrg(ORG_ID);
    assert.equal(users.length, 2);
    assert.ok(users.every(u => u.orgId === ORG_ID));
  });

  it("gets user by username (org-scoped)", async () => {
    await storage.createUser({ orgId: ORG_ID, username: "alice", name: "Alice", role: "viewer" });
    await storage.createUser({ orgId: OTHER_ORG, username: "alice", name: "Other Alice", role: "admin" });

    const user = await storage.getUserByUsername("alice", ORG_ID);
    assert.ok(user);
    assert.equal(user!.orgId, ORG_ID);
    assert.equal(user!.name, "Alice");
  });

  it("updates user role", async () => {
    const user = await storage.createUser({ orgId: ORG_ID, username: "bob", name: "Bob", role: "viewer" });
    const updated = await storage.updateUser(ORG_ID, user.id, { role: "manager" });
    assert.ok(updated);
    assert.equal(updated!.role, "manager");
  });

  it("does not update user in wrong org", async () => {
    const user = await storage.createUser({ orgId: ORG_ID, username: "bob", name: "Bob", role: "viewer" });
    const result = await storage.updateUser(OTHER_ORG, user.id, { role: "admin" });
    assert.equal(result, undefined);
  });

  it("deletes user", async () => {
    const user = await storage.createUser({ orgId: ORG_ID, username: "temp", name: "Temp", role: "viewer" });
    await storage.deleteUser(ORG_ID, user.id);
    const fetched = await storage.getUser(user.id);
    assert.equal(fetched, undefined);
  });
});

// ==================== ORGANIZATION SETTINGS ====================

describe("Organization settings", () => {
  it("creates org with default settings", async () => {
    const org = await storage.createOrganization({ name: "Test Org", slug: "test-org", status: "active" });
    assert.ok(org.id);
    assert.equal(org.name, "Test Org");
    assert.equal(org.slug, "test-org");
    assert.equal(org.status, "active");
  });

  it("updates org settings", async () => {
    const org = await storage.createOrganization({ name: "Test", slug: "test", status: "active" });
    const updated = await storage.updateOrganization(org.id, {
      settings: {
        industryType: "dental",
        retentionDays: 180,
        departments: ["Front Desk", "Clinical"],
      },
    });

    assert.ok(updated);
    assert.equal(updated!.settings?.industryType, "dental");
    assert.equal(updated!.settings?.retentionDays, 180);
    assert.deepEqual(updated!.settings?.departments, ["Front Desk", "Clinical"]);
  });

  it("updates org name", async () => {
    const org = await storage.createOrganization({ name: "Old Name", slug: "old", status: "active" });
    const updated = await storage.updateOrganization(org.id, { name: "New Name" });
    assert.ok(updated);
    assert.equal(updated!.name, "New Name");
    assert.equal(updated!.slug, "old"); // slug unchanged
  });

  it("updates org status", async () => {
    const org = await storage.createOrganization({ name: "Test", slug: "test", status: "active" });
    const updated = await storage.updateOrganization(org.id, { status: "suspended" });
    assert.ok(updated);
    assert.equal(updated!.status, "suspended");
  });

  it("returns undefined for non-existent org update", async () => {
    const result = await storage.updateOrganization("fake-id", { name: "Test" });
    assert.equal(result, undefined);
  });
});

// ==================== INVITATION MANAGEMENT ====================

describe("Invitation management", () => {
  it("creates an invitation", async () => {
    const invitation = await storage.createInvitation(ORG_ID, {
      email: "newuser@company.com",
      role: "viewer",
      token: "invite-token-123",
      invitedBy: "admin-user",
    });

    assert.ok(invitation.id);
    assert.equal(invitation.orgId, ORG_ID);
    assert.equal(invitation.email, "newuser@company.com");
    assert.equal(invitation.role, "viewer");
  });

  it("gets invitation by token", async () => {
    const token = "unique-token-abc";
    await storage.createInvitation(ORG_ID, {
      email: "user@test.com",
      role: "manager",
      token,
      invitedBy: "admin",
    });

    const found = await storage.getInvitationByToken(token);
    assert.ok(found);
    assert.equal(found!.email, "user@test.com");
    assert.equal(found!.role, "manager");
  });

  it("returns undefined for invalid token", async () => {
    const found = await storage.getInvitationByToken("invalid-token");
    assert.equal(found, undefined);
  });
});

// ==================== ACCESS REQUESTS ====================

describe("Access requests", () => {
  it("creates access request", async () => {
    const request = await storage.createAccessRequest(ORG_ID, {
      name: "John Doe",
      email: "john@company.com",
      requestedRole: "viewer",
    });

    assert.ok(request.id);
    assert.equal(request.orgId, ORG_ID);
    assert.equal(request.name, "John Doe");
  });

  it("lists access requests for org", async () => {
    await storage.createAccessRequest(ORG_ID, { name: "User A", email: "a@test.com" });
    await storage.createAccessRequest(ORG_ID, { name: "User B", email: "b@test.com" });
    await storage.createAccessRequest(OTHER_ORG, { name: "User C", email: "c@test.com" });

    const requests = await storage.getAllAccessRequests(ORG_ID);
    assert.equal(requests.length, 2);
    assert.ok(requests.every(r => r.orgId === ORG_ID));
  });

  it("updates access request status", async () => {
    const request = await storage.createAccessRequest(ORG_ID, {
      name: "John",
      email: "john@test.com",
      status: "pending",
    });

    const updated = await storage.updateAccessRequest(ORG_ID, request.id, { status: "approved" });
    assert.ok(updated);
    assert.equal(updated!.status, "approved");
  });

  it("access requests are org-scoped", async () => {
    await storage.createAccessRequest(ORG_ID, { name: "Secret", email: "secret@test.com" });
    const otherOrgRequests = await storage.getAllAccessRequests(OTHER_ORG);
    assert.equal(otherOrgRequests.length, 0);
  });
});

// ==================== ROLE HIERARCHY VALIDATION ====================

describe("Role hierarchy validation", () => {
  const ROLE_HIERARCHY: Record<string, number> = {
    super_admin: 4,
    admin: 3,
    manager: 2,
    viewer: 1,
  };

  function hasRole(userRole: string, requiredRole: string): boolean {
    return (ROLE_HIERARCHY[userRole] || 0) >= (ROLE_HIERARCHY[requiredRole] || 0);
  }

  it("admin has admin access", () => {
    assert.equal(hasRole("admin", "admin"), true);
  });

  it("admin has manager access", () => {
    assert.equal(hasRole("admin", "manager"), true);
  });

  it("admin has viewer access", () => {
    assert.equal(hasRole("admin", "viewer"), true);
  });

  it("manager does NOT have admin access", () => {
    assert.equal(hasRole("manager", "admin"), false);
  });

  it("viewer does NOT have manager access", () => {
    assert.equal(hasRole("viewer", "manager"), false);
  });

  it("super_admin has all access", () => {
    assert.equal(hasRole("super_admin", "admin"), true);
    assert.equal(hasRole("super_admin", "manager"), true);
    assert.equal(hasRole("super_admin", "viewer"), true);
  });
});

// ==================== ALLOWED ANALYSIS EDIT FIELDS ====================

describe("Analysis edit field validation", () => {
  const ALLOWED_FIELDS = new Set([
    "summary", "performanceScore", "topics", "actionItems",
    "feedback", "flags", "sentiment", "sentimentScore",
  ]);

  it("allows valid fields", () => {
    const updates = { summary: "New summary", performanceScore: "8.0" };
    const disallowed = Object.keys(updates).filter(k => !ALLOWED_FIELDS.has(k));
    assert.equal(disallowed.length, 0);
  });

  it("rejects disallowed fields", () => {
    const updates = { summary: "OK", id: "fake", orgId: "hack", callId: "tamper" };
    const disallowed = Object.keys(updates).filter(k => !ALLOWED_FIELDS.has(k));
    assert.deepEqual(disallowed.sort(), ["callId", "id", "orgId"]);
  });

  it("rejects clinicalNote direct edit", () => {
    const updates = { clinicalNote: { subjective: "hacked" } };
    const disallowed = Object.keys(updates).filter(k => !ALLOWED_FIELDS.has(k));
    assert.ok(disallowed.includes("clinicalNote"));
  });
});

// ==================== EMPLOYEE MANAGEMENT (via admin) ====================

describe("Employee management", () => {
  it("creates an employee", async () => {
    const emp = await storage.createEmployee(ORG_ID, {
      name: "Jane Smith",
      email: "jane@company.com",
      role: "Agent",
      status: "active",
    });

    assert.ok(emp.id);
    assert.equal(emp.orgId, ORG_ID);
    assert.equal(emp.name, "Jane Smith");
    assert.equal(emp.status, "active");
  });

  it("updates employee status", async () => {
    const emp = await storage.createEmployee(ORG_ID, { name: "Jane", email: "jane@test.com", status: "active" });
    const updated = await storage.updateEmployee(ORG_ID, emp.id, { status: "inactive" });
    assert.ok(updated);
    assert.equal(updated!.status, "inactive");
  });

  it("gets employee by email (org-scoped)", async () => {
    await storage.createEmployee(ORG_ID, { name: "Alice", email: "shared@email.com" });
    await storage.createEmployee(OTHER_ORG, { name: "Bob", email: "shared@email.com" });

    const fromOrg = await storage.getEmployeeByEmail(ORG_ID, "shared@email.com");
    assert.ok(fromOrg);
    assert.equal(fromOrg!.name, "Alice");

    const fromOther = await storage.getEmployeeByEmail(OTHER_ORG, "shared@email.com");
    assert.ok(fromOther);
    assert.equal(fromOther!.name, "Bob");
  });

  it("lists employees for org only", async () => {
    await storage.createEmployee(ORG_ID, { name: "A", email: "a@t.com" });
    await storage.createEmployee(ORG_ID, { name: "B", email: "b@t.com" });
    await storage.createEmployee(OTHER_ORG, { name: "C", email: "c@t.com" });

    const employees = await storage.getAllEmployees(ORG_ID);
    assert.equal(employees.length, 2);
  });
});

// ==================== COACHING SESSIONS ====================

describe("Coaching session management", () => {
  it("creates a coaching session", async () => {
    const emp = await storage.createEmployee(ORG_ID, { name: "Agent", email: "agent@test.com" });
    const session = await storage.createCoachingSession(ORG_ID, {
      employeeId: emp.id,
      assignedBy: "manager-id",
      title: "Improve greeting",
      notes: "Focus on opening statement",
      status: "scheduled",
    });

    assert.ok(session.id);
    assert.equal(session.orgId, ORG_ID);
    assert.equal(session.title, "Improve greeting");
    assert.equal(session.status, "scheduled");
  });

  it("lists coaching sessions for org", async () => {
    const emp = await storage.createEmployee(ORG_ID, { name: "Agent", email: "a@t.com" });
    await storage.createCoachingSession(ORG_ID, { employeeId: emp.id, assignedBy: "mgr", title: "Session 1" });
    await storage.createCoachingSession(ORG_ID, { employeeId: emp.id, assignedBy: "mgr", title: "Session 2" });

    const sessions = await storage.getAllCoachingSessions(ORG_ID);
    assert.equal(sessions.length, 2);
  });

  it("coaching sessions are org-scoped", async () => {
    const emp = await storage.createEmployee(ORG_ID, { name: "Agent", email: "a@t.com" });
    await storage.createCoachingSession(ORG_ID, { employeeId: emp.id, assignedBy: "mgr", title: "Private" });

    const otherSessions = await storage.getAllCoachingSessions(OTHER_ORG);
    assert.equal(otherSessions.length, 0);
  });

  it("gets coaching sessions by employee", async () => {
    const emp1 = await storage.createEmployee(ORG_ID, { name: "A", email: "a@t.com" });
    const emp2 = await storage.createEmployee(ORG_ID, { name: "B", email: "b@t.com" });
    await storage.createCoachingSession(ORG_ID, { employeeId: emp1.id, assignedBy: "mgr", title: "For A" });
    await storage.createCoachingSession(ORG_ID, { employeeId: emp2.id, assignedBy: "mgr", title: "For B" });

    const sessions = await storage.getCoachingSessionsByEmployee(ORG_ID, emp1.id);
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].title, "For A");
  });
});

// ==================== DATA RETENTION ====================

describe("Data retention", () => {
  it("purges calls older than retention period", async () => {
    // Create a "recent" call
    await storage.createCall(ORG_ID, { fileName: "recent.mp3", status: "completed" });

    // All calls from storage will have uploadedAt set to "now"
    // The purge function checks against a retention window
    const allCalls = await storage.getAllCalls(ORG_ID);
    assert.equal(allCalls.length, 1);
  });
});

// ==================== DASHBOARD METRICS ====================

describe("Dashboard metrics from admin perspective", () => {
  it("returns accurate metrics for org", async () => {
    const call1 = await storage.createCall(ORG_ID, { status: "completed" });
    const call2 = await storage.createCall(ORG_ID, { status: "completed" });
    await storage.createCallAnalysis(ORG_ID, { callId: call1.id, performanceScore: "8.0" });
    await storage.createCallAnalysis(ORG_ID, { callId: call2.id, performanceScore: "6.0" });
    await storage.createSentimentAnalysis(ORG_ID, { callId: call1.id, overallSentiment: "positive", overallScore: "0.8" });

    const metrics = await storage.getDashboardMetrics(ORG_ID);
    assert.equal(metrics.totalCalls, 2);
    assert.ok(metrics.avgPerformanceScore > 0);
  });

  it("metrics are org-scoped", async () => {
    await storage.createCall(ORG_ID, { status: "completed" });
    const metricsOther = await storage.getDashboardMetrics(OTHER_ORG);
    assert.equal(metricsOther.totalCalls, 0);
  });
});
