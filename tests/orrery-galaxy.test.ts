/**
 * Unit tests for dayBucketsToGalaxy + patternsToConstellations.
 *
 * Validates the Phase 3 adapter logic against the schemas they consume
 * (GalaxyDayRow shape, TopicCluster shape). Industry-agnostic — no
 * dental/medical-specific topics assumed.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  dayBucketsToGalaxy,
  patternsToConstellations,
  type GalaxyDayRow,
} from "../client/src/lib/orrery-adapters";

const NOW = new Date("2026-05-20T14:00:00Z");

function makeRow(date: string, calls: number, closeRate: number | null): GalaxyDayRow {
  return { date, calls, closeRate };
}

describe("dayBucketsToGalaxy — degenerate inputs", () => {
  it("returns empty for empty input", () => {
    assert.deepEqual(dayBucketsToGalaxy([]), []);
  });

  it("preserves all rows including zero-call days", () => {
    const rows = [makeRow("2026-05-01", 0, null), makeRow("2026-05-02", 5, 0.8)];
    const days = dayBucketsToGalaxy(rows, { now: NOW });
    assert.equal(days.length, 2);
    assert.equal(days[0].calls, 0);
    assert.equal(days[1].calls, 5);
  });

  it("flags weekend days correctly (Sat + Sun)", () => {
    const rows = [
      makeRow("2026-05-15", 5, 0.6), // Friday
      makeRow("2026-05-16", 2, 0.5), // Saturday
      makeRow("2026-05-17", 3, 0.4), // Sunday
      makeRow("2026-05-18", 6, 0.7), // Monday
    ];
    const days = dayBucketsToGalaxy(rows, { now: NOW });
    const byDate = new Map(days.map((d) => [d.date, d]));
    assert.equal(byDate.get("2026-05-15")?.weekend, false);
    assert.equal(byDate.get("2026-05-16")?.weekend, true);
    assert.equal(byDate.get("2026-05-17")?.weekend, true);
    assert.equal(byDate.get("2026-05-18")?.weekend, false);
  });

  it("marks today as the anchor", () => {
    const rows = [
      makeRow("2026-05-19", 4, 0.5),
      makeRow("2026-05-20", 8, 0.7), // matches NOW
      makeRow("2026-05-21", 5, 0.6),
    ];
    const days = dayBucketsToGalaxy(rows, { now: NOW });
    const anchors = days.filter((d) => d.anchor);
    assert.equal(anchors.length, 1);
    assert.equal(anchors[0].date, "2026-05-20");
  });

  it("does not mark any anchor when month doesn't include today", () => {
    const rows = [makeRow("2026-04-15", 5, 0.6)];
    const days = dayBucketsToGalaxy(rows, { now: NOW });
    assert.equal(days.filter((d) => d.anchor).length, 0);
  });
});

describe("dayBucketsToGalaxy — brightness from closeRate", () => {
  it("brightness scales with closeRate", () => {
    const rows = [makeRow("2026-05-01", 5, 0.2), makeRow("2026-05-02", 5, 0.9)];
    const days = dayBucketsToGalaxy(rows, { now: NOW });
    assert.ok(days[1].br > days[0].br, "higher closeRate → higher brightness");
  });

  it("falls back to mid-low brightness when closeRate is null", () => {
    const rows = [makeRow("2026-05-01", 5, null)];
    const days = dayBucketsToGalaxy(rows, { now: NOW });
    // Should be in the mid-low band, readable but uncertain.
    assert.ok(days[0].br >= 0.4 && days[0].br <= 0.6);
  });
});

describe("dayBucketsToGalaxy — spiral positions", () => {
  it("places days at increasing radii (inner → outer)", () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      makeRow(`2026-05-${String(i + 1).padStart(2, "0")}`, i + 1, 0.5),
    );
    const days = dayBucketsToGalaxy(rows, { now: NOW });
    // First day's distance to origin should be smaller than last's (log scale).
    const radius = (d: { px: number; py: number }) => Math.hypot(d.px, d.py);
    assert.ok(radius(days[0]) < radius(days[days.length - 1]));
  });

  it("zero-call days still get positions (small radius)", () => {
    const rows = [makeRow("2026-05-15", 0, null)];
    const days = dayBucketsToGalaxy(rows, { now: NOW });
    assert.equal(days.length, 1);
    assert.ok(days[0].sz > 0);
  });
});

describe("patternsToConstellations — basic shaping", () => {
  it("returns empty for empty clusters", () => {
    assert.deepEqual(patternsToConstellations([]), []);
  });

  it("skips clusters without topics", () => {
    const result = patternsToConstellations([
      { id: "1", label: "Empty", topics: [] },
      { id: "2", label: "Has topics", topics: ["billing", "payment"] },
    ]);
    // The empty cluster still appears, but with zero nodes.
    assert.equal(result.length, 2);
    assert.equal(result[0].nodes.length, 0);
    assert.equal(result[1].nodes.length, 2);
  });

  it("first topic becomes the hub (center node)", () => {
    const result = patternsToConstellations([
      { id: "p1", label: "Billing trends", topics: ["billing", "payment", "invoice"] },
    ]);
    const pattern = result[0];
    assert.equal(pattern.nodes[0].px, 0);
    assert.equal(pattern.nodes[0].py, 0);
    assert.equal(pattern.nodes[0].label, "billing");
  });

  it("caps at MAX_CONSTELLATION_NODES (6) per cluster", () => {
    const topics = Array.from({ length: 15 }, (_, i) => `topic${i}`);
    const result = patternsToConstellations([{ id: "p1", label: "Big pattern", topics }]);
    assert.equal(result[0].nodes.length, 6);
  });

  it("hub-and-spoke: every non-hub node connects to hub", () => {
    const result = patternsToConstellations([
      { id: "p1", label: "Test", topics: ["A", "B", "C", "D"] },
    ]);
    const pattern = result[0];
    const hubKey = pattern.nodes[0].key;
    // Each spoke node should have an edge from the hub.
    for (let i = 1; i < pattern.nodes.length; i++) {
      const has = pattern.edges.some(
        (e) =>
          (e.fromKey === hubKey && e.toKey === pattern.nodes[i].key) ||
          (e.toKey === hubKey && e.fromKey === pattern.nodes[i].key),
      );
      assert.ok(has, `expected edge from hub to ${pattern.nodes[i].label}`);
    }
  });
});

describe("patternsToConstellations — trend → color", () => {
  it("rising → bright color", () => {
    const result = patternsToConstellations([
      { id: "p1", label: "Rising", topics: ["x"], trend: "rising" },
    ]);
    assert.equal(result[0].color, "bright");
  });

  it("declining → amber color", () => {
    const result = patternsToConstellations([
      { id: "p1", label: "Declining", topics: ["x"], trend: "declining" },
    ]);
    assert.equal(result[0].color, "amber");
  });

  it("stable (or missing) → warm color", () => {
    const result = patternsToConstellations([
      { id: "p1", label: "Stable", topics: ["x"], trend: "stable" },
      { id: "p2", label: "Unknown trend", topics: ["x"] },
    ]);
    assert.equal(result[0].color, "warm");
    assert.equal(result[1].color, "warm");
  });

  it("stat line includes occurrence count + trend verb", () => {
    const result = patternsToConstellations([
      { id: "p1", label: "Big", topics: ["x"], callCount: 18, trend: "rising" },
    ]);
    assert.match(result[0].stat, /Rising/);
    assert.match(result[0].stat, /18/);
  });
});

describe("patternsToConstellations — industry-agnostic", () => {
  it("works with any topic vocabulary (legal example)", () => {
    const result = patternsToConstellations([
      {
        id: "p1",
        label: "Discovery deadline confusion",
        topics: ["discovery", "deadline", "production", "deposition"],
        callCount: 11,
        trend: "rising",
      },
    ]);
    const pattern = result[0];
    assert.equal(pattern.label, "Discovery deadline confusion");
    assert.equal(pattern.nodes[0].label, "discovery");
    // No assumptions about specific industry — labels read through unchanged.
  });

  it("works with healthcare topics (no special-casing)", () => {
    const result = patternsToConstellations([
      {
        id: "p1",
        label: "Pre-auth verification",
        topics: ["pre-auth", "insurance", "eligibility", "denial"],
        callCount: 23,
        trend: "stable",
      },
    ]);
    assert.equal(result[0].nodes.length, 4);
    assert.equal(result[0].color, "warm");
  });
});
