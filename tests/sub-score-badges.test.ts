/**
 * Tests for the Tier 1D sub-score excellence badges.
 *
 * Focused on the pure helper qualifiesForBadge — the storage-touching
 * evaluateSubScoreBadges is exercised by integration after the wire-up
 * to checkAndAwardBadges lands.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SUB_SCORE_EXCELLENCE_BADGES,
  qualifiesForBadge,
  type SubScoreBadgeDef,
} from "../server/services/sub-score-badges";

// --- Test fixtures ---

const COMPLIANCE_DEF = SUB_SCORE_EXCELLENCE_BADGES.find((b) => b.id === "compliance_star")!;
const EMPATHY_DEF = SUB_SCORE_EXCELLENCE_BADGES.find((b) => b.id === "empathy_champion")!;
const RESOLUTION_DEF = SUB_SCORE_EXCELLENCE_BADGES.find((b) => b.id === "resolution_ace")!;

/** Build a synthetic call with a single sub-score field. */
function callWithSubScore(dimension: string, value: number | null): { analysis: { subScores: Record<string, number> } } {
  if (value === null) return { analysis: { subScores: {} } };
  return { analysis: { subScores: { [dimension]: value } } };
}

/** Build N calls with the same sub-score in the given dimension. */
function nCalls(n: number, dimension: string, value: number) {
  return Array.from({ length: n }, () => callWithSubScore(dimension, value));
}

// --- Tests ---

describe("SUB_SCORE_EXCELLENCE_BADGES — definitions", () => {
  it("has exactly three badge definitions", () => {
    assert.equal(SUB_SCORE_EXCELLENCE_BADGES.length, 3);
  });

  it("each badge has id, name, description, dimension, threshold, consecutiveRequired", () => {
    for (const def of SUB_SCORE_EXCELLENCE_BADGES) {
      assert.ok(def.id, "id required");
      assert.ok(def.name, "name required");
      assert.ok(def.description, "description required");
      assert.ok(def.dimension, "dimension required");
      assert.equal(def.threshold, 9.0);
      assert.equal(def.consecutiveRequired, 5);
    }
  });

  it("dimensions cover compliance, customerExperience, resolution", () => {
    const dims = new Set(SUB_SCORE_EXCELLENCE_BADGES.map((b) => b.dimension));
    assert.ok(dims.has("compliance"));
    assert.ok(dims.has("customerExperience"));
    assert.ok(dims.has("resolution"));
  });

  it("empathy_champion includes a snake_case fallback for customer_experience", () => {
    assert.equal(EMPATHY_DEF.dimensionFallback, "customer_experience");
  });

  it("badge IDs are unique", () => {
    const ids = SUB_SCORE_EXCELLENCE_BADGES.map((b) => b.id);
    assert.equal(new Set(ids).size, ids.length);
  });
});

describe("qualifiesForBadge — happy path", () => {
  it("awards when last 5 calls all >= 9.0 in the dimension", () => {
    const calls = nCalls(5, "compliance", 9.5);
    assert.equal(qualifiesForBadge(calls, COMPLIANCE_DEF), true);
  });

  it("awards when exactly the threshold (9.0) is hit by every call", () => {
    const calls = nCalls(5, "compliance", 9.0);
    assert.equal(qualifiesForBadge(calls, COMPLIANCE_DEF), true);
  });

  it("only considers the last N calls — older qualifying calls don't help", () => {
    // 5 qualifying calls older + 5 NEW non-qualifying — should NOT award
    const calls = [...nCalls(5, "compliance", 9.5), ...nCalls(5, "compliance", 7.0)];
    assert.equal(qualifiesForBadge(calls, COMPLIANCE_DEF), false);
  });

  it("uses the LATEST 5 of an oldest-first array (matches storage default sort)", () => {
    const calls = [...nCalls(5, "compliance", 6.0), ...nCalls(5, "compliance", 9.5)];
    assert.equal(qualifiesForBadge(calls, COMPLIANCE_DEF), true);
  });
});

describe("qualifiesForBadge — disqualifying conditions", () => {
  it("does not award with fewer than 5 calls", () => {
    assert.equal(qualifiesForBadge(nCalls(4, "compliance", 9.5), COMPLIANCE_DEF), false);
    assert.equal(qualifiesForBadge(nCalls(0, "compliance", 9.5), COMPLIANCE_DEF), false);
  });

  it("does not award when one of the last 5 is below threshold", () => {
    const calls = [...nCalls(4, "compliance", 9.5), callWithSubScore("compliance", 8.9)];
    assert.equal(qualifiesForBadge(calls, COMPLIANCE_DEF), false);
  });

  it("does not award when sub-score is missing on any of the last 5", () => {
    const calls = [...nCalls(4, "compliance", 9.5), callWithSubScore("compliance", null)];
    assert.equal(qualifiesForBadge(calls, COMPLIANCE_DEF), false);
  });

  it("does not award when sub-scores object is entirely missing on any of the last 5", () => {
    const calls = [
      ...nCalls(4, "compliance", 9.5),
      { analysis: {} } as unknown as { analysis: { subScores: Record<string, number> } },
    ];
    assert.equal(qualifiesForBadge(calls, COMPLIANCE_DEF), false);
  });

  it("does not award when analysis is missing entirely on any of the last 5", () => {
    const calls = [
      ...nCalls(4, "compliance", 9.5),
      {} as unknown as { analysis: { subScores: Record<string, number> } },
    ];
    assert.equal(qualifiesForBadge(calls, COMPLIANCE_DEF), false);
  });
});

describe("qualifiesForBadge — dimension-specific behavior", () => {
  it("compliance_star checks the compliance dimension only", () => {
    // High compliance + low customerExperience — compliance still qualifies
    const calls = Array.from({ length: 5 }, () => ({
      analysis: { subScores: { compliance: 9.5, customerExperience: 5.0 } },
    }));
    assert.equal(qualifiesForBadge(calls, COMPLIANCE_DEF), true);
  });

  it("empathy_champion accepts customerExperience (camelCase)", () => {
    const calls = Array.from({ length: 5 }, () => ({
      analysis: { subScores: { customerExperience: 9.2 } },
    }));
    assert.equal(qualifiesForBadge(calls, EMPATHY_DEF), true);
  });

  it("empathy_champion falls back to customer_experience (snake_case)", () => {
    const calls = Array.from({ length: 5 }, () => ({
      analysis: { subScores: { customer_experience: 9.2 } },
    }));
    assert.equal(qualifiesForBadge(calls, EMPATHY_DEF), true);
  });

  it("empathy_champion does not match unrelated keys", () => {
    const calls = Array.from({ length: 5 }, () => ({
      analysis: { subScores: { compliance: 9.5, communication: 9.5 } },
    }));
    assert.equal(qualifiesForBadge(calls, EMPATHY_DEF), false);
  });

  it("resolution_ace checks resolution dimension only", () => {
    const calls = Array.from({ length: 5 }, () => ({
      analysis: { subScores: { resolution: 9.5, compliance: 6.0 } },
    }));
    assert.equal(qualifiesForBadge(calls, RESOLUTION_DEF), true);
  });
});

describe("qualifiesForBadge — type tolerance", () => {
  it("ignores non-numeric sub-score values", () => {
    const calls = [
      ...nCalls(4, "compliance", 9.5),
      { analysis: { subScores: { compliance: "9.5" as unknown as number } } },
    ];
    assert.equal(qualifiesForBadge(calls, COMPLIANCE_DEF), false);
  });

  it("ignores non-finite sub-score values (NaN, Infinity)", () => {
    const calls = [...nCalls(4, "compliance", 9.5), callWithSubScore("compliance", NaN)];
    assert.equal(qualifiesForBadge(calls, COMPLIANCE_DEF), false);

    const calls2 = [...nCalls(4, "compliance", 9.5), callWithSubScore("compliance", Infinity)];
    assert.equal(qualifiesForBadge(calls2, COMPLIANCE_DEF), false);
  });

  it("works with a custom def for boundary testing", () => {
    const customDef: SubScoreBadgeDef = {
      id: "compliance_star",
      name: "Custom",
      description: "test",
      icon: "x",
      dimension: "compliance",
      threshold: 7.0,
      consecutiveRequired: 3,
    };
    assert.equal(qualifiesForBadge(nCalls(3, "compliance", 7.0), customDef), true);
    assert.equal(qualifiesForBadge(nCalls(3, "compliance", 6.99), customDef), false);
    assert.equal(qualifiesForBadge(nCalls(2, "compliance", 9.0), customDef), false);
  });
});
