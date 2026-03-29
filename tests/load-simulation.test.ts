/**
 * Load simulation test — exercises key API code paths under concurrent load.
 *
 * Tests storage layer performance with realistic multi-tenant workloads:
 * - Concurrent call creation + retrieval across multiple orgs
 * - Search under load
 * - Dashboard metrics computation
 * - Coaching and employee operations
 *
 * Run: npx tsx --test tests/load-simulation.test.ts
 *
 * NOTE: This tests the in-memory storage layer (no DB/network).
 * Production load testing should use k6 or Artillery against a real deployment.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { MemStorage } from "../server/storage/memory.js";

const NUM_ORGS = 5;
const CALLS_PER_ORG = 200;
const EMPLOYEES_PER_ORG = 20;
const CONCURRENT_OPS = 50;

describe("Load simulation", () => {
  let storage: InstanceType<typeof MemStorage>;
  const orgIds: string[] = [];
  const employeesByOrg = new Map<string, string[]>();
  const callsByOrg = new Map<string, string[]>();

  beforeEach(async () => {
    storage = new MemStorage();
    orgIds.length = 0;
    employeesByOrg.clear();
    callsByOrg.clear();

    // Setup: create orgs, employees, and calls
    for (let i = 0; i < NUM_ORGS; i++) {
      const org = await storage.createOrganization({
        name: `Org ${i}`, slug: `org-${i}`, status: "active",
      });
      orgIds.push(org.id);

      const empIds: string[] = [];
      for (let j = 0; j < EMPLOYEES_PER_ORG; j++) {
        const emp = await storage.createEmployee(org.id, {
          name: `Employee ${j}`, email: `emp${j}@org${i}.com`,
        });
        empIds.push(emp.id);
      }
      employeesByOrg.set(org.id, empIds);

      const cIds: string[] = [];
      for (let j = 0; j < CALLS_PER_ORG; j++) {
        const empId = empIds[j % empIds.length];
        const call = await storage.createCall(org.id, {
          orgId: org.id, status: "completed", employeeId: empId,
          fileName: `call-${j}.mp3`,
        });
        cIds.push(call.id);

        // Add transcript + analysis for search and metrics
        await storage.createTranscript(org.id, {
          orgId: org.id, callId: call.id,
          text: `Hello this is a test call number ${j} about scheduling an appointment`,
          confidence: 0.95, words: [],
        });
        await storage.createCallAnalysis(org.id, {
          orgId: org.id, callId: call.id,
          performanceScore: String(5 + Math.random() * 5),
          summary: `Call ${j} summary — patient discussed treatment options`,
        });
        await storage.createSentimentAnalysis(org.id, {
          orgId: org.id, callId: call.id,
          overallSentiment: ["positive", "neutral", "negative"][j % 3] as any,
          overallScore: String(0.3 + Math.random() * 0.6),
          segments: [],
        });
      }
      callsByOrg.set(org.id, cIds);
    }
  });

  it(`handles ${NUM_ORGS} orgs × ${CALLS_PER_ORG} calls setup`, () => {
    assert.equal(orgIds.length, NUM_ORGS);
    for (const orgId of orgIds) {
      assert.equal(callsByOrg.get(orgId)!.length, CALLS_PER_ORG);
    }
  });

  it(`concurrent call listing (${CONCURRENT_OPS} parallel requests)`, async () => {
    const start = performance.now();
    const promises = Array.from({ length: CONCURRENT_OPS }, (_, i) => {
      const orgId = orgIds[i % NUM_ORGS];
      return storage.getCallsWithDetails(orgId);
    });
    const results = await Promise.all(promises);
    const elapsed = performance.now() - start;

    for (const r of results) {
      assert.ok(r.length > 0, "Should return results");
      assert.ok(r.length <= CALLS_PER_ORG, "Should not exceed org's calls");
    }
    assert.ok(elapsed < 5000, `Should complete in <5s, took ${elapsed.toFixed(0)}ms`);
  });

  it(`concurrent search across orgs (${CONCURRENT_OPS} parallel)`, async () => {
    const start = performance.now();
    const queries = ["appointment", "scheduling", "test call", "hello", "number"];
    const promises = Array.from({ length: CONCURRENT_OPS }, (_, i) => {
      const orgId = orgIds[i % NUM_ORGS];
      const query = queries[i % queries.length];
      return storage.searchCalls(orgId, query);
    });
    const results = await Promise.all(promises);
    const elapsed = performance.now() - start;

    for (const r of results) {
      assert.ok(r.length > 0, "Search should find results");
    }
    assert.ok(elapsed < 10000, `Should complete in <10s, took ${elapsed.toFixed(0)}ms`);
  });

  it("concurrent dashboard metrics computation", async () => {
    const start = performance.now();
    const promises = orgIds.map(orgId => storage.getDashboardMetrics(orgId));
    const results = await Promise.all(promises);
    const elapsed = performance.now() - start;

    for (let i = 0; i < results.length; i++) {
      assert.equal(results[i].totalCalls, CALLS_PER_ORG, `Org ${i} should have ${CALLS_PER_ORG} calls`);
      assert.ok(results[i].avgPerformanceScore > 0, "Should have positive avg score");
    }
    assert.ok(elapsed < 3000, `Should complete in <3s, took ${elapsed.toFixed(0)}ms`);
  });

  it("data isolation under concurrent load", async () => {
    // Verify no cross-org data leakage under concurrent access
    const promises = orgIds.flatMap(orgId => [
      storage.getCallsWithDetails(orgId).then(calls => {
        for (const c of calls) {
          assert.equal(c.orgId, orgId, `Call ${c.id} should belong to ${orgId}`);
        }
        return calls.length;
      }),
      storage.getAllEmployees(orgId).then(emps => {
        for (const e of emps) {
          assert.equal(e.orgId, orgId, `Employee ${e.id} should belong to ${orgId}`);
        }
        return emps.length;
      }),
    ]);

    const results = await Promise.all(promises);
    // Each org has CALLS_PER_ORG calls and EMPLOYEES_PER_ORG employees
    for (let i = 0; i < orgIds.length; i++) {
      assert.equal(results[i * 2], CALLS_PER_ORG);
      assert.equal(results[i * 2 + 1], EMPLOYEES_PER_ORG);
    }
  });

  it("concurrent employee operations don't conflict", async () => {
    const orgId = orgIds[0];
    const start = performance.now();

    // Simulate 20 concurrent employee creates
    const creates = Array.from({ length: 20 }, (_, i) =>
      storage.createEmployee(orgId, { name: `New Emp ${i}`, email: `new${i}@test.com` })
    );
    const created = await Promise.all(creates);
    const elapsed = performance.now() - start;

    // All should have unique IDs
    const ids = new Set(created.map(e => e.id));
    assert.equal(ids.size, 20, "All 20 employees should have unique IDs");

    const allEmps = await storage.getAllEmployees(orgId);
    assert.equal(allEmps.length, EMPLOYEES_PER_ORG + 20);
    assert.ok(elapsed < 1000, `Should complete in <1s, took ${elapsed.toFixed(0)}ms`);
  });

  it("search returns correct org-scoped results under load", async () => {
    // Search from org 0 and org 1 simultaneously with same query
    const [r0, r1] = await Promise.all([
      storage.searchCalls(orgIds[0], "appointment"),
      storage.searchCalls(orgIds[1], "appointment"),
    ]);

    // Results should only contain calls from the respective org
    assert.ok(r0.every(c => c.orgId === orgIds[0]), "Org 0 search must only return org 0 calls");
    assert.ok(r1.every(c => c.orgId === orgIds[1]), "Org 1 search must only return org 1 calls");
  });

  it("hard cap prevents excessive results", async () => {
    const orgId = orgIds[0];
    const allCalls = await storage.getAllCalls(orgId);
    assert.ok(allCalls.length <= 5000, `getAllCalls should be capped at 5000, got ${allCalls.length}`);
    assert.equal(allCalls.length, CALLS_PER_ORG); // 200 < 5000, should return all
  });
});
