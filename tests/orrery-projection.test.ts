/**
 * Unit tests for orrery projection math + brightness ramp + lens orbit
 * assignments. These are pure functions; the tests are mostly numeric
 * regression guards so the visual layout stays stable across refactors.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
// Import from leaf modules (not the barrel) so the tsx test runner doesn't
// load owl CSS via the barrel re-exports.
import { TILT, orreryProject, brightToColor } from "../client/src/components/orrery/projection";
import { ORRERY_LIGHT, ORRERY_DARK } from "../client/src/components/orrery/theme";
import { LENSES, ORBIT_RADII } from "../client/src/lib/orrery-lenses";

describe("orreryProject", () => {
  it("TILT is 0.42 (matches the prototype's isometric squash)", () => {
    assert.equal(TILT, 0.42);
  });

  it("origin maps to origin", () => {
    const [px, py] = orreryProject(0, 0);
    assert.equal(px, 0);
    assert.equal(py, 0);
  });

  it("x is unchanged", () => {
    const [px, py] = orreryProject(10, 0);
    assert.equal(px, 10);
    assert.equal(py, 0);
  });

  it("y is squashed by TILT", () => {
    const [px, py] = orreryProject(0, 10);
    assert.equal(px, 0);
    assert.equal(py, 4.2);
  });

  it("z offset shifts y upward (negative direction)", () => {
    const [, py] = orreryProject(0, 10, 3);
    assert.equal(py, 4.2 - 3);
  });

  it("a circle at radius R projects to an ellipse of rx=R, ry=R*TILT", () => {
    const radius = 20;
    const samples = [0, Math.PI / 4, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
    for (const ang of samples) {
      const [px, py] = orreryProject(Math.cos(ang) * radius, Math.sin(ang) * radius);
      // px should match Math.cos(ang) * radius (no scaling)
      assert.ok(Math.abs(px - Math.cos(ang) * radius) < 1e-9);
      // py should match Math.sin(ang) * radius * TILT
      assert.ok(Math.abs(py - Math.sin(ang) * radius * TILT) < 1e-9);
    }
  });
});

describe("brightToColor", () => {
  it("returns t.bright at brightness > 0.8 (light theme)", () => {
    assert.equal(brightToColor(0.9, ORRERY_LIGHT), ORRERY_LIGHT.bright);
    assert.equal(brightToColor(0.81, ORRERY_LIGHT), ORRERY_LIGHT.bright);
  });

  it("returns t.warm at 0.65 < br ≤ 0.8", () => {
    assert.equal(brightToColor(0.7, ORRERY_LIGHT), ORRERY_LIGHT.warm);
    assert.equal(brightToColor(0.8, ORRERY_LIGHT), ORRERY_LIGHT.warm);
  });

  it("returns t.cool at 0.5 < br ≤ 0.65", () => {
    assert.equal(brightToColor(0.55, ORRERY_LIGHT), ORRERY_LIGHT.cool);
    assert.equal(brightToColor(0.65, ORRERY_LIGHT), ORRERY_LIGHT.cool);
  });

  it("returns t.cold at 0.35 < br ≤ 0.5", () => {
    assert.equal(brightToColor(0.4, ORRERY_LIGHT), ORRERY_LIGHT.cold);
    assert.equal(brightToColor(0.5, ORRERY_LIGHT), ORRERY_LIGHT.cold);
  });

  it("returns t.ice at br ≤ 0.35", () => {
    assert.equal(brightToColor(0.3, ORRERY_LIGHT), ORRERY_LIGHT.ice);
    assert.equal(brightToColor(0, ORRERY_LIGHT), ORRERY_LIGHT.ice);
  });

  it("ramp colors differ between light and dark themes", () => {
    assert.notEqual(brightToColor(0.9, ORRERY_LIGHT), brightToColor(0.9, ORRERY_DARK));
    // Light bright is the deep cyan; dark bright is the lighter electric cyan.
    assert.equal(ORRERY_LIGHT.bright, "#0892a8");
    assert.equal(ORRERY_DARK.bright, "#4dd6e8");
  });
});

describe("LENSES configuration", () => {
  it("ships exactly four industry-agnostic lenses", () => {
    const ids = Object.keys(LENSES).sort();
    assert.deepEqual(ids, ["agent", "recency", "sentiment", "type"]);
  });

  it("each lens has a label, description, and pure functions", () => {
    for (const id of Object.keys(LENSES) as Array<keyof typeof LENSES>) {
      const lens = LENSES[id];
      assert.equal(typeof lens.label, "string");
      assert.equal(typeof lens.description, "string");
      assert.equal(typeof lens.keyFor, "function");
      assert.equal(typeof lens.labelFor, "function");
      assert.equal(typeof lens.assignOrbit, "function");
    }
  });

  it("4 orbit radii are 14/24/34/44 (viewBox units)", () => {
    assert.deepEqual([...ORBIT_RADII], [14, 24, 34, 44]);
  });

  it("type lens distributes by volume rank", () => {
    const lens = LENSES.type;
    assert.equal(lens.assignOrbit({ key: "a", volumeRank: 0, totalGroups: 4 }), 0);
    assert.equal(lens.assignOrbit({ key: "b", volumeRank: 3, totalGroups: 4 }), 3);
    // 12 groups distributed 3-per-orbit
    assert.equal(lens.assignOrbit({ key: "c", volumeRank: 0, totalGroups: 12 }), 0);
    assert.equal(lens.assignOrbit({ key: "c", volumeRank: 11, totalGroups: 12 }), 3);
  });

  it("sentiment lens maps positive→0, neutral→1, negative→2, unknown→3", () => {
    const lens = LENSES.sentiment;
    assert.equal(lens.assignOrbit({ key: "positive", volumeRank: 0, totalGroups: 4 }), 0);
    assert.equal(lens.assignOrbit({ key: "neutral", volumeRank: 1, totalGroups: 4 }), 1);
    assert.equal(lens.assignOrbit({ key: "negative", volumeRank: 2, totalGroups: 4 }), 2);
    assert.equal(lens.assignOrbit({ key: "unknown", volumeRank: 3, totalGroups: 4 }), 3);
  });

  it("recency lens maps morning→0, afternoon→1, evening→2, off-hours→3", () => {
    const lens = LENSES.recency;
    assert.equal(lens.assignOrbit({ key: "morning", volumeRank: 0, totalGroups: 4 }), 0);
    assert.equal(lens.assignOrbit({ key: "afternoon", volumeRank: 1, totalGroups: 4 }), 1);
    assert.equal(lens.assignOrbit({ key: "evening", volumeRank: 2, totalGroups: 4 }), 2);
    assert.equal(lens.assignOrbit({ key: "off-hours", volumeRank: 3, totalGroups: 4 }), 3);
  });

  it("labels are human-readable (no raw snake_case leaks)", () => {
    assert.equal(LENSES.type.labelFor("dental_treatment"), "Dental Treatment");
    assert.equal(LENSES.type.labelFor("email_billing"), "Email Billing");
    assert.equal(LENSES.sentiment.labelFor("positive"), "Positive");
    assert.equal(LENSES.recency.labelFor("morning"), "Morning · 6am–noon");
  });
});
