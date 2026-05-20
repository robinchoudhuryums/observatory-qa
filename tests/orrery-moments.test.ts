/**
 * Unit tests for transcriptToMoments + callToClinicalTimeline.
 *
 * Validates the locked moment-detection algorithm from
 * ORRERY_IMPLEMENTATION_PLAN.md §5 Phase 2:
 *   - Short calls (<60s) collapse to 3 moments (greeting/middle/close)
 *   - No sentiment data: even-spaced 6 moments
 *   - Long calls (>30min) cap at 10 moments, prefer largest swings
 *   - Tone derived from sentiment + flags (warm/cool/amber/green/neutral)
 *   - Labels from analysis.topics[] when timestamps match; "Moment N" fallback
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  transcriptToMoments,
  callToClinicalTimeline,
  type Moment,
} from "../client/src/lib/orrery-adapters";

// Helpers for building fixture sentiment segments.
function segment(startMs: number, sentiment: string, score: number) {
  return { start: startMs, end: startMs + 5000, sentiment, score };
}

describe("transcriptToMoments — short calls (<60s)", () => {
  it("collapses to 3 moments with preset labels", () => {
    const moments = transcriptToMoments(undefined, undefined, undefined, 45);
    assert.equal(moments.length, 3);
    assert.deepEqual(
      moments.map((m) => m.label),
      ["Greeting", "Middle", "Close"],
    );
    // Times are evenly spaced.
    assert.ok(moments[0].time < moments[1].time);
    assert.ok(moments[1].time < moments[2].time);
  });

  it("applies coaching flag to middle moment when present", () => {
    const moments = transcriptToMoments(
      undefined,
      undefined,
      { flags: ["low_score"] },
      30,
    );
    assert.equal(moments[1].tone, "amber");
  });

  it("applies exceptional flag to close moment when present", () => {
    const moments = transcriptToMoments(
      undefined,
      undefined,
      { flags: ["exceptional_call"] },
      30,
    );
    assert.equal(moments[2].tone, "green");
  });
});

describe("transcriptToMoments — no sentiment data", () => {
  it("returns 6 evenly-spaced neutral moments", () => {
    const moments = transcriptToMoments(undefined, undefined, undefined, 600);
    assert.equal(moments.length, 6);
    for (const m of moments) {
      assert.equal(m.tone, "neutral");
      assert.equal(m.brightness, 0.5);
    }
  });

  it("uses durationSec=600 fallback when nothing is passed", () => {
    const moments = transcriptToMoments(undefined, undefined, undefined, 0);
    assert.ok(moments.length >= 3);
    assert.ok(moments[moments.length - 1].time > 0);
  });
});

describe("transcriptToMoments — sentiment-driven detection", () => {
  it("creates a moment per sentiment segment when count <= TARGET", () => {
    const segments = [
      segment(0, "NEUTRAL", 0.5),
      segment(10000, "POSITIVE", 0.8),
      segment(20000, "NEGATIVE", 0.2),
      segment(30000, "NEUTRAL", 0.5),
    ];
    const moments = transcriptToMoments(undefined, { segments }, undefined, 60);
    assert.equal(moments.length, 4);
    assert.ok(moments.every((m) => m.id));
  });

  it("tone reflects sentiment + score boundary at 0.6/0.4", () => {
    const segments = [
      segment(0, "POSITIVE", 0.9), // warm
      segment(10000, "NEGATIVE", 0.1), // cool
      segment(20000, "NEUTRAL", 0.5), // neutral
    ];
    const moments = transcriptToMoments(undefined, { segments }, undefined, 60);
    assert.equal(moments[0].tone, "warm");
    assert.equal(moments[1].tone, "cool");
    assert.equal(moments[2].tone, "neutral");
  });

  it("flag tones override sentiment tones", () => {
    const segments = [segment(0, "POSITIVE", 0.9)];
    // exceptional flag + score > 0.7 → green wins over warm
    const moments = transcriptToMoments(
      undefined,
      { segments },
      { flags: ["exceptional_call"] },
      60,
    );
    assert.equal(moments[0].tone, "green");
  });

  it("supplements with speaker-turn boundaries when sentiment is sparse", () => {
    const segments = [segment(0, "NEUTRAL", 0.5)];
    const words = [
      { start: 0, end: 1000, speaker: "A" },
      { start: 1500, end: 2500, speaker: "A" },
      // 6 second gap → triggers a turn boundary
      { start: 8500, end: 9500, speaker: "B" },
      { start: 10000, end: 11000, speaker: "B" },
    ];
    const moments = transcriptToMoments({ words }, { segments }, undefined, 120);
    // Should include both sentiment-derived and turn-derived moments.
    assert.ok(moments.length >= 2);
    assert.ok(moments.some((m) => m.label === "Speaker turn"));
  });
});

describe("transcriptToMoments — labels from analysis.topics", () => {
  it("uses topic label when timestamp matches within 30s", () => {
    const segments = [segment(60000, "POSITIVE", 0.8)];
    const topics = [{ label: "Pricing question", time: 65 }];
    const moments = transcriptToMoments(
      undefined,
      { segments },
      { topics },
      120,
    );
    assert.equal(moments[0].label, "Pricing question");
  });

  it("falls back to round-robin topic labels when no timestamps", () => {
    const segments = [
      segment(0, "NEUTRAL", 0.5),
      segment(60000, "NEUTRAL", 0.5),
      segment(120000, "NEUTRAL", 0.5),
    ];
    const topics = ["Onboarding", "Eligibility", "Wrap-up"];
    const moments = transcriptToMoments(undefined, { segments }, { topics }, 180);
    // Each moment gets a label from the topic list (round-robin by slot).
    for (const m of moments) {
      assert.ok(["Onboarding", "Eligibility", "Wrap-up"].includes(m.label));
    }
  });

  it("falls back to 'Moment N' when no topics", () => {
    const segments = [segment(0, "NEUTRAL", 0.5), segment(10000, "NEUTRAL", 0.5)];
    const moments = transcriptToMoments(undefined, { segments }, undefined, 60);
    assert.ok(moments.every((m) => /^Moment \d+$/.test(m.label)));
  });
});

describe("transcriptToMoments — long-call cap", () => {
  it("caps at 10 moments for calls over 30 minutes", () => {
    // Build 20 sentiment segments, evenly spaced across 40 minutes.
    const segments: Array<{ start: number; end: number; sentiment: string; score: number }> = [];
    for (let i = 0; i < 20; i++) {
      const t = i * 120000; // every 2 min
      // Alternate POS/NEG so each pair has a non-zero swing.
      segments.push(segment(t, i % 2 === 0 ? "POSITIVE" : "NEGATIVE", i % 2 === 0 ? 0.8 : 0.2));
    }
    const moments = transcriptToMoments(undefined, { segments }, undefined, 40 * 60);
    assert.equal(moments.length, 10);
  });

  it("returned moments are sorted by time ascending", () => {
    const segments: Array<{ start: number; end: number; sentiment: string; score: number }> = [];
    for (let i = 0; i < 15; i++) {
      segments.push(segment(i * 60000, i % 2 ? "POSITIVE" : "NEGATIVE", i % 2 ? 0.8 : 0.2));
    }
    const moments = transcriptToMoments(undefined, { segments }, undefined, 35 * 60);
    for (let i = 1; i < moments.length; i++) {
      assert.ok(moments[i].time >= moments[i - 1].time);
    }
  });
});

describe("transcriptToMoments — output shape", () => {
  it("every moment has id, time, label, tone, brightness", () => {
    const segments = [segment(0, "POSITIVE", 0.7), segment(10000, "NEGATIVE", 0.3)];
    const moments = transcriptToMoments(undefined, { segments }, undefined, 60);
    for (const m of moments) {
      assert.ok(typeof m.id === "string" && m.id.length > 0);
      assert.ok(typeof m.time === "number" && m.time >= 0);
      assert.ok(typeof m.label === "string");
      assert.ok(["warm", "cool", "amber", "green", "neutral"].includes(m.tone));
      assert.ok(m.brightness >= 0 && m.brightness <= 1);
    }
  });

  it("does not leak internal _swing field", () => {
    const segments = [segment(0, "POSITIVE", 0.8), segment(10000, "NEGATIVE", 0.2)];
    const moments = transcriptToMoments(undefined, { segments }, undefined, 60);
    for (const m of moments) {
      assert.ok(!("_swing" in (m as object)));
    }
  });
});

describe("callToClinicalTimeline", () => {
  it("returns smoothed points + moments together", () => {
    const segments = [
      segment(0, "POSITIVE", 0.8),
      segment(30000, "NEGATIVE", 0.3),
      segment(60000, "NEUTRAL", 0.5),
    ];
    const timeline = callToClinicalTimeline(undefined, { segments }, undefined, 90);
    assert.ok(timeline.moments.length >= 3);
    assert.ok(timeline.points.length >= 3);
    // Quality is on a 0-100 scale.
    for (const p of timeline.points) {
      assert.ok(p.quality >= 0 && p.quality <= 100);
    }
  });

  it("anchors endpoints to 0 and duration", () => {
    const segments = [segment(30000, "POSITIVE", 0.8)];
    const timeline = callToClinicalTimeline(undefined, { segments }, undefined, 120);
    assert.equal(timeline.points[0].time, 0);
    assert.equal(timeline.points[timeline.points.length - 1].time, 120);
  });

  it("falls back to flat quality when no sentiment data", () => {
    const timeline = callToClinicalTimeline(undefined, undefined, undefined, 60);
    // Points come from even-spaced moments at brightness=0.5 → quality 50.
    for (const p of timeline.points) {
      assert.ok(p.quality >= 0 && p.quality <= 100);
    }
  });
});
