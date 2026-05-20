/**
 * Unit tests for agentsToCoachingSystems.
 *
 * Phase 4 of the Orrery redesign. Validates per-agent mini-orrery data
 * derived from /api/performance + /api/employees + /api/coaching +
 * /api/calls. Industry-agnostic — no role labels assumed; works for any
 * vertical.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { agentsToCoachingSystems } from "../client/src/lib/orrery-adapters";

describe("agentsToCoachingSystems — basic shape", () => {
  it("returns one agent per active employee", () => {
    const result = agentsToCoachingSystems(
      [
        { id: "e1", name: "Alice", role: "Lead", status: "Active" },
        { id: "e2", name: "Bob", role: null, status: "Active" },
      ],
      [],
      [],
      [],
    );
    assert.equal(result.length, 2);
    assert.deepEqual(
      result.map((a) => a.name).sort(),
      ["Alice", "Bob"],
    );
  });

  it("excludes inactive employees", () => {
    const result = agentsToCoachingSystems(
      [
        { id: "e1", name: "Alice", status: "Active" },
        { id: "e2", name: "Bob", status: "Inactive" },
      ],
      [],
      [],
      [],
    );
    assert.equal(result.length, 1);
    assert.equal(result[0].name, "Alice");
  });

  it("returns empty list when no employees", () => {
    assert.deepEqual(agentsToCoachingSystems([], [], [], []), []);
  });
});

describe("agentsToCoachingSystems — performance → brightness", () => {
  it("avgPerformanceScore = 9.0 → brightness = 0.9", () => {
    const result = agentsToCoachingSystems(
      [{ id: "e1", name: "Star", status: "Active" }],
      [{ id: "e1", name: "Star", avgPerformanceScore: 9.0, totalCalls: 20 }],
      [],
      [],
    );
    assert.equal(result[0].brightness, 0.9);
    assert.equal(result[0].avgScore, 9);
    assert.equal(result[0].callCount, 20);
  });

  it("missing performance row → mid-ramp brightness 0.5", () => {
    const result = agentsToCoachingSystems(
      [{ id: "e1", name: "New", status: "Active" }],
      [],
      [],
      [],
    );
    assert.equal(result[0].brightness, 0.5);
    assert.equal(result[0].avgScore, null);
    assert.equal(result[0].callCount, 0);
  });

  it("null performance score → mid-ramp brightness", () => {
    const result = agentsToCoachingSystems(
      [{ id: "e1", name: "Untested", status: "Active" }],
      [{ id: "e1", name: "Untested", avgPerformanceScore: null, totalCalls: 0 }],
      [],
      [],
    );
    assert.equal(result[0].brightness, 0.5);
    assert.equal(result[0].avgScore, null);
  });
});

describe("agentsToCoachingSystems — sort order (brightest first)", () => {
  it("brightest agent first; ties broken by name asc", () => {
    const result = agentsToCoachingSystems(
      [
        { id: "low", name: "Z", status: "Active" },
        { id: "mid", name: "B", status: "Active" },
        { id: "high", name: "A", status: "Active" },
        { id: "highb", name: "Maya", status: "Active" },
      ],
      [
        { id: "low", name: "Z", avgPerformanceScore: 4 },
        { id: "mid", name: "B", avgPerformanceScore: 6 },
        { id: "high", name: "A", avgPerformanceScore: 9 },
        { id: "highb", name: "Maya", avgPerformanceScore: 9 }, // same brightness as high
      ],
      [],
      [],
    );
    assert.deepEqual(
      result.map((a) => a.name),
      ["A", "Maya", "B", "Z"],
    );
  });
});

describe("agentsToCoachingSystems — hasActiveSession flag", () => {
  it("flags an agent with an in_progress session", () => {
    const result = agentsToCoachingSystems(
      [{ id: "e1", name: "X", status: "Active" }],
      [],
      [{ employeeId: "e1", status: "in_progress" }],
      [],
    );
    assert.equal(result[0].hasActiveSession, true);
  });

  it("does NOT flag an agent whose session is completed", () => {
    const result = agentsToCoachingSystems(
      [{ id: "e1", name: "X", status: "Active" }],
      [],
      [{ employeeId: "e1", status: "completed" }],
      [],
    );
    assert.equal(result[0].hasActiveSession, false);
  });

  it("does NOT flag an agent whose session is dismissed", () => {
    const result = agentsToCoachingSystems(
      [{ id: "e1", name: "X", status: "Active" }],
      [],
      [{ employeeId: "e1", status: "dismissed" }],
      [],
    );
    assert.equal(result[0].hasActiveSession, false);
  });
});

describe("agentsToCoachingSystems — flag derivation from calls", () => {
  it("flagged=true when any call has low_score", () => {
    const result = agentsToCoachingSystems(
      [{ id: "e1", name: "X", status: "Active" }],
      [],
      [],
      [{ employeeId: "e1", analysis: { flags: ["low_score"] } }],
    );
    assert.equal(result[0].flagged, true);
    assert.equal(result[0].exceptional, false);
  });

  it("exceptional=true when any call has exceptional_call", () => {
    const result = agentsToCoachingSystems(
      [{ id: "e1", name: "X", status: "Active" }],
      [],
      [],
      [{ employeeId: "e1", analysis: { flags: ["exceptional_call"] } }],
    );
    assert.equal(result[0].exceptional, true);
    assert.equal(result[0].flagged, false);
  });

  it("agent_misconduct_* variants count as coaching-flagged", () => {
    const result = agentsToCoachingSystems(
      [{ id: "e1", name: "X", status: "Active" }],
      [],
      [],
      [{ employeeId: "e1", analysis: { flags: ["agent_misconduct_threat"] } }],
    );
    assert.equal(result[0].flagged, true);
  });

  it("calls without an employeeId are ignored for flag attribution", () => {
    const result = agentsToCoachingSystems(
      [{ id: "e1", name: "X", status: "Active" }],
      [],
      [],
      [{ employeeId: null, analysis: { flags: ["low_score"] } }],
    );
    assert.equal(result[0].flagged, false);
  });
});

describe("agentsToCoachingSystems — industry-agnostic", () => {
  it("works for a contact-center team with no role data", () => {
    const result = agentsToCoachingSystems(
      [
        { id: "1", name: "Maya Cruz", status: "Active" },
        { id: "2", name: "Devi Patel", status: "Active" },
      ],
      [
        { id: "1", name: "Maya Cruz", avgPerformanceScore: 8.6, totalCalls: 142 },
        { id: "2", name: "Devi Patel", avgPerformanceScore: 7.1, totalCalls: 98 },
      ],
      [],
      [],
    );
    assert.equal(result.length, 2);
    assert.equal(result[0].name, "Maya Cruz");
    assert.equal(result[0].callCount, 142);
  });

  it("works for a legal firm where role is meaningful", () => {
    const result = agentsToCoachingSystems(
      [
        { id: "1", name: "Sara Kim", role: "Partner", status: "Active" },
        { id: "2", name: "Jordan Lee", role: "Associate", status: "Active" },
      ],
      [
        { id: "1", name: "Sara Kim", role: "Partner", avgPerformanceScore: 8.9, totalCalls: 35 },
      ],
      [],
      [],
    );
    assert.equal(result[0].role, "Partner");
    assert.equal(result[1].role, "Associate");
  });
});
