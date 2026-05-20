/**
 * Unit tests for Atlas data adapters.
 *
 * Validates the industry-agnostic principle from the redesign plan:
 *   - Adapters consume real shared/schema/calls.ts shapes
 *   - No hardcoded category names — labels come from input data
 *   - Degenerate inputs (0/1/many groups, missing fields) produce sane output
 *   - Realism state derives from actual call counts + statuses
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { callsToPlanets, deriveAtlasRealism, MAX_PLANETS } from "../client/src/lib/orrery-adapters";
import { ORBIT_RADII } from "../client/src/lib/orrery-lenses";
import type { CallWithDetails } from "../shared/schema";

// Frozen "now" so test data lines up against a known day boundary.
const NOW = new Date("2026-05-20T14:00:00Z");
const TODAY_MID = "2026-05-20T10:00:00Z";
const TODAY_LATE = "2026-05-20T17:00:00Z";
const YESTERDAY = "2026-05-19T10:00:00Z";

function makeCall(overrides: Partial<CallWithDetails> = {}): CallWithDetails {
  return {
    id: overrides.id || `call-${Math.random().toString(36).slice(2, 8)}`,
    orgId: "org-1",
    status: "completed",
    uploadedAt: TODAY_MID,
    callCategory: "inbound",
    ...overrides,
  } as CallWithDetails;
}

function makeCalls(n: number, overrides: Partial<CallWithDetails> = {}): CallWithDetails[] {
  return Array.from({ length: n }, (_, i) =>
    makeCall({ ...overrides, id: `${overrides.id || "c"}-${i}` }),
  );
}

describe("callsToPlanets — basic shaping", () => {
  it("returns empty array when no calls", () => {
    const planets = callsToPlanets([], "type", { now: NOW });
    assert.equal(planets.length, 0);
  });

  it("returns empty when all calls are from prior days", () => {
    const planets = callsToPlanets(makeCalls(5, { uploadedAt: YESTERDAY }), "type", { now: NOW });
    assert.equal(planets.length, 0);
  });

  it("builds one planet per distinct category", () => {
    const calls = [
      makeCall({ callCategory: "scheduling" }),
      makeCall({ callCategory: "scheduling" }),
      makeCall({ callCategory: "billing" }),
    ];
    const planets = callsToPlanets(calls, "type", { now: NOW });
    assert.equal(planets.length, 2);
    const labels = planets.map((p) => p.label).sort();
    assert.deepEqual(labels, ["Billing", "Scheduling"]);
  });

  it("planets read group counts directly from input — no hardcoded numbers", () => {
    const calls = [
      ...makeCalls(7, { callCategory: "vendor" }),
      ...makeCalls(3, { callCategory: "internal" }),
    ];
    const planets = callsToPlanets(calls, "type", { now: NOW });
    const byKey = new Map(planets.map((p) => [p.groupKey, p]));
    assert.equal(byKey.get("vendor")?.count, 7);
    assert.equal(byKey.get("internal")?.count, 3);
  });

  it("falls back to 'uncategorized' label when callCategory is missing", () => {
    const calls = [makeCall({ callCategory: undefined })];
    const planets = callsToPlanets(calls, "type", { now: NOW });
    assert.equal(planets.length, 1);
    assert.equal(planets[0].label, "Uncategorized");
    assert.equal(planets[0].groupKey, "uncategorized");
  });

  it("the highest-volume non-other planet is the day's anchor (hot=true)", () => {
    const calls = [
      ...makeCalls(10, { callCategory: "vendor" }),
      ...makeCalls(2, { callCategory: "internal" }),
    ];
    const planets = callsToPlanets(calls, "type", { now: NOW });
    const anchor = planets.find((p) => p.hot);
    assert.ok(anchor, "expected an anchor planet");
    assert.equal(anchor.groupKey, "vendor");
    // Only one hot planet allowed.
    assert.equal(planets.filter((p) => p.hot).length, 1);
  });
});

describe("callsToPlanets — degenerate inputs (industry-agnostic safety)", () => {
  it("0 categories → 0 planets", () => {
    const planets = callsToPlanets([], "type", { now: NOW });
    assert.equal(planets.length, 0);
  });

  it("1 category → 1 planet on the innermost orbit (top rank)", () => {
    const planets = callsToPlanets(makeCalls(3, { callCategory: "inbound" }), "type", { now: NOW });
    assert.equal(planets.length, 1);
    assert.equal(planets[0].orbit, 0);
    assert.ok(planets[0].hot);
  });

  it("3 categories distribute on orbits 0..2", () => {
    const calls = [
      ...makeCalls(5, { callCategory: "A" }),
      ...makeCalls(3, { callCategory: "B" }),
      ...makeCalls(2, { callCategory: "C" }),
    ];
    const planets = callsToPlanets(calls, "type", { now: NOW });
    const orbits = planets.map((p) => p.orbit).sort();
    assert.deepEqual(orbits, [0, 1, 2]);
  });

  it("caps planets at MAX_PLANETS, collapsing overflow into 'Other'", () => {
    // 15 distinct categories — exceeds the 12-planet cap.
    const calls = Array.from({ length: 15 }, (_, i) =>
      makeCall({ id: `c-${i}`, callCategory: `category-${i}`, uploadedAt: TODAY_MID }),
    );
    const planets = callsToPlanets(calls, "type", { now: NOW });
    assert.equal(planets.length, MAX_PLANETS);
    const other = planets.find((p) => p.groupKey === "__other__");
    assert.ok(other, "expected an Other planet");
    // Other is on the outermost orbit.
    assert.equal(other.orbit, 3);
    // Other absorbed the 4 smallest categories (15 - 11 = 4 calls of count 1).
    assert.equal(other.count, 4);
    // Other never gets the anchor flag.
    assert.equal(other.hot, false);
  });

  it("calls without uploadedAt are excluded", () => {
    const planets = callsToPlanets(
      [makeCall({ uploadedAt: undefined }), makeCall({ callCategory: "x" })],
      "type",
      { now: NOW },
    );
    assert.equal(planets.length, 1);
  });

  it("planet coordinates project onto one of the four orbit radii", () => {
    const planets = callsToPlanets(
      [
        makeCall({ callCategory: "a" }),
        makeCall({ callCategory: "b" }),
        makeCall({ callCategory: "c" }),
        makeCall({ callCategory: "d" }),
      ],
      "type",
      { now: NOW },
    );
    for (const p of planets) {
      // sqrt(px² + (py/TILT)²) ≈ ORBIT_RADII[p.orbit]
      const radius = Math.sqrt(p.px * p.px + (p.py / 0.42) * (p.py / 0.42));
      assert.ok(
        Math.abs(radius - ORBIT_RADII[p.orbit]) < 0.1,
        `planet ${p.groupKey} should sit on orbit ${p.orbit}=${ORBIT_RADII[p.orbit]}, got radius ${radius}`,
      );
    }
  });
});

describe("callsToPlanets — performance score → brightness", () => {
  it("brightness reflects avg performance score", () => {
    const calls = [
      makeCall({
        callCategory: "a",
        analysis: { performanceScore: "9.0" } as CallWithDetails["analysis"],
      }),
      makeCall({
        callCategory: "a",
        analysis: { performanceScore: "9.0" } as CallWithDetails["analysis"],
      }),
    ];
    const planets = callsToPlanets(calls, "type", { now: NOW });
    assert.equal(planets.length, 1);
    assert.equal(planets[0].avgScore, 9);
    assert.equal(planets[0].br, 0.9);
  });

  it("brightness defaults to 0.5 when no analysis scores exist", () => {
    const planets = callsToPlanets([makeCall({ callCategory: "a" })], "type", { now: NOW });
    assert.equal(planets[0].avgScore, null);
    assert.equal(planets[0].br, 0.5);
  });

  it("handles numeric performanceScore (not just string)", () => {
    const calls = [
      makeCall({
        callCategory: "a",
        analysis: { performanceScore: 7 as unknown as string } as CallWithDetails["analysis"],
      }),
    ];
    const planets = callsToPlanets(calls, "type", { now: NOW });
    assert.equal(planets[0].avgScore, 7);
  });
});

describe("callsToPlanets — flag derivation", () => {
  it("coaching=true when any call has low_score flag", () => {
    const calls = [
      makeCall({
        callCategory: "a",
        analysis: { flags: ["low_score"] } as CallWithDetails["analysis"],
      }),
      makeCall({ callCategory: "a" }),
    ];
    const planets = callsToPlanets(calls, "type", { now: NOW });
    assert.equal(planets[0].coaching, true);
  });

  it("exceptional=true when any call has exceptional_call flag", () => {
    const calls = [
      makeCall({
        callCategory: "a",
        analysis: { flags: ["exceptional_call"] } as CallWithDetails["analysis"],
      }),
    ];
    const planets = callsToPlanets(calls, "type", { now: NOW });
    assert.equal(planets[0].exceptional, true);
  });

  it("coaching=true on agent_misconduct flag variants", () => {
    const calls = [
      makeCall({
        callCategory: "a",
        analysis: { flags: ["agent_misconduct_threat"] } as CallWithDetails["analysis"],
      }),
    ];
    const planets = callsToPlanets(calls, "type", { now: NOW });
    assert.equal(planets[0].coaching, true);
  });
});

describe("callsToPlanets — anomaly detection (volume vs 7-day avg)", () => {
  it("flags anomaly when today's volume exceeds 2x trailing daily average", () => {
    // 21 calls in 7 days = 3/day avg. Today: 8 calls. 8 > 2*3 → anomaly.
    const historical = Array.from({ length: 21 }, (_, i) =>
      makeCall({
        id: `h-${i}`,
        callCategory: "spike",
        uploadedAt: new Date(NOW.getTime() - 86400000 * (1 + (i % 7))).toISOString(),
      }),
    );
    const today = makeCalls(8, { callCategory: "spike" });
    const planets = callsToPlanets(today, "type", { now: NOW, historicalCalls: historical });
    assert.equal(planets[0].anomaly, true);
  });

  it("no anomaly when historical data is sparse", () => {
    const planets = callsToPlanets(makeCalls(8, { callCategory: "x" }), "type", { now: NOW });
    assert.equal(planets[0].anomaly, false);
  });
});

describe("callsToPlanets — lens selection (industry-agnostic)", () => {
  it("recency lens buckets by hour of day", () => {
    const calls = [
      makeCall({ id: "1", uploadedAt: "2026-05-20T08:00:00Z" }), // morning
      makeCall({ id: "2", uploadedAt: "2026-05-20T13:00:00Z" }), // afternoon
      makeCall({ id: "3", uploadedAt: "2026-05-20T19:00:00Z" }), // evening
    ];
    const planets = callsToPlanets(calls, "recency", { now: NOW });
    // 3 distinct buckets depending on local timezone of test runner.
    // We don't assert specific bucket names (TZ-dependent), only that we got planets.
    assert.ok(planets.length >= 1);
    assert.ok(planets.length <= 4);
  });

  it("sentiment lens groups by overallSentiment with deterministic orbits", () => {
    const calls = [
      makeCall({
        id: "p",
        sentiment: { overallSentiment: "positive" } as CallWithDetails["sentiment"],
      }),
      makeCall({
        id: "n",
        sentiment: { overallSentiment: "negative" } as CallWithDetails["sentiment"],
      }),
    ];
    const planets = callsToPlanets(calls, "sentiment", { now: NOW });
    const byKey = new Map(planets.map((p) => [p.groupKey, p]));
    assert.equal(byKey.get("positive")?.orbit, 0);
    assert.equal(byKey.get("negative")?.orbit, 2);
  });

  it("agent lens uses employee.name as label, employee.id as key", () => {
    const calls = [
      makeCall({
        callCategory: "a",
        employeeId: "emp-1",
        employee: { id: "emp-1", name: "Maria Hernandez" } as CallWithDetails["employee"],
      }),
    ];
    const planets = callsToPlanets(calls, "agent", { now: NOW });
    assert.equal(planets[0].groupKey, "emp-1");
    assert.equal(planets[0].label, "Maria Hernandez");
  });

  it("agent lens falls back to 'Unassigned' when call has no employee", () => {
    const planets = callsToPlanets([makeCall({ employeeId: undefined })], "agent", { now: NOW });
    assert.equal(planets[0].label, "Unassigned");
  });
});

describe("deriveAtlasRealism", () => {
  it("returns day-1 when zero completed and no history", () => {
    assert.equal(deriveAtlasRealism([], []), "day-1");
  });

  it("returns day-1-afternoon when 1-5 completed today AND <14 days history", () => {
    const today = makeCalls(3, { status: "completed", uploadedAt: TODAY_MID });
    assert.equal(deriveAtlasRealism(today, [], { historyDays: 7 }), "day-1-afternoon");
  });

  it("returns partial when any call still processing", () => {
    const today = [
      ...makeCalls(10, { status: "completed", uploadedAt: TODAY_MID }),
      makeCall({ status: "processing", uploadedAt: TODAY_LATE }),
    ];
    assert.equal(deriveAtlasRealism(today, [], { historyDays: 30 }), "partial");
  });

  it("returns flat-day when distribution has no anchor (max ≤ 1.5x avg)", () => {
    const today = [
      ...makeCalls(3, { status: "completed", callCategory: "a" }),
      ...makeCalls(3, { status: "completed", callCategory: "b" }),
      ...makeCalls(3, { status: "completed", callCategory: "c" }),
    ];
    assert.equal(deriveAtlasRealism(today, [], { historyDays: 30 }), "flat-day");
  });

  it("returns normal when there's a clear anchor", () => {
    const today = [
      ...makeCalls(15, { status: "completed", callCategory: "anchor" }),
      ...makeCalls(2, { status: "completed", callCategory: "other" }),
    ];
    assert.equal(deriveAtlasRealism(today, [], { historyDays: 30 }), "normal");
  });
});
