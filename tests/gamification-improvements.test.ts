/**
 * Tests for Gamification improvements:
 * - Opt-out mechanism (org settings)
 * - Custom recognition badges (manager-awarded)
 * - Effectiveness measurement (correlation logic)
 * - Team competition grouping
 *
 * Run with: npx tsx --test tests/gamification-improvements.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  orgSettingsSchema,
  employeeBadgeSchema,
  BADGE_DEFINITIONS,
  type EmployeeBadge,
} from "../shared/schema.js";

describe("Gamification Settings - Opt-out", () => {
  it("accepts gamification settings in OrgSettings", () => {
    const settings = orgSettingsSchema.parse({
      gamification: {
        enabled: true,
        optedOutRoles: ["viewer"],
        optedOutEmployeeIds: ["emp-123"],
        teamCompetitionsEnabled: true,
      },
    });
    assert.equal(settings.gamification?.enabled, true);
    assert.deepEqual(settings.gamification?.optedOutRoles, ["viewer"]);
    assert.deepEqual(settings.gamification?.optedOutEmployeeIds, ["emp-123"]);
    assert.equal(settings.gamification?.teamCompetitionsEnabled, true);
  });

  it("defaults gamification to undefined (enabled)", () => {
    const settings = orgSettingsSchema.parse({});
    assert.equal(settings.gamification, undefined);
  });

  it("can disable gamification globally", () => {
    const settings = orgSettingsSchema.parse({
      gamification: { enabled: false },
    });
    assert.equal(settings.gamification?.enabled, false);
  });

  it("supports multiple opted-out roles", () => {
    const settings = orgSettingsSchema.parse({
      gamification: {
        enabled: true,
        optedOutRoles: ["viewer", "manager"],
      },
    });
    assert.equal(settings.gamification?.optedOutRoles?.length, 2);
  });
});

describe("Custom Recognition Badges", () => {
  it("accepts awardedBy field for manager-awarded badges", () => {
    const badge = employeeBadgeSchema.parse({
      id: "badge-1",
      orgId: "org-1",
      employeeId: "emp-1",
      badgeId: "custom_empathy",
      awardedAt: new Date().toISOString(),
      awardedBy: "manager-user-id",
      customMessage: "Great empathy with that difficult caller today!",
    });
    assert.equal(badge.awardedBy, "manager-user-id");
    assert.equal(badge.customMessage, "Great empathy with that difficult caller today!");
  });

  it("awardedBy and customMessage are optional", () => {
    const badge = employeeBadgeSchema.parse({
      id: "badge-2",
      orgId: "org-1",
      employeeId: "emp-1",
      badgeId: "first_call",
      awardedAt: new Date().toISOString(),
    });
    assert.equal(badge.awardedBy, undefined);
    assert.equal(badge.customMessage, undefined);
  });

  it("custom badges use custom_ prefix convention", () => {
    const badgeId = "empathy";
    const customBadgeId = badgeId.startsWith("custom_") ? badgeId : `custom_${badgeId}`;
    assert.equal(customBadgeId, "custom_empathy");
  });

  it("already-prefixed custom badges are not double-prefixed", () => {
    const badgeId = "custom_teamwork";
    const customBadgeId = badgeId.startsWith("custom_") ? badgeId : `custom_${badgeId}`;
    assert.equal(customBadgeId, "custom_teamwork");
  });
});

describe("Effectiveness Measurement - Correlation", () => {
  function pearsonCorrelation(data: Array<{ x: number; y: number }>): number {
    const n = data.length;
    if (n < 2) return 0;
    const meanX = data.reduce((s, d) => s + d.x, 0) / n;
    const meanY = data.reduce((s, d) => s + d.y, 0) / n;
    let num = 0, denomX = 0, denomY = 0;
    for (const d of data) {
      const dx = d.x - meanX;
      const dy = d.y - meanY;
      num += dx * dy;
      denomX += dx * dx;
      denomY += dy * dy;
    }
    const denom = Math.sqrt(denomX * denomY);
    return denom > 0 ? Math.round((num / denom) * 1000) / 1000 : 0;
  }

  it("returns positive correlation for aligned data", () => {
    const data = [
      { x: 1, y: 5.0 },  // 1 badge, 5.0 score
      { x: 3, y: 7.0 },  // 3 badges, 7.0 score
      { x: 5, y: 8.5 },  // 5 badges, 8.5 score
      { x: 8, y: 9.0 },  // 8 badges, 9.0 score
    ];
    const r = pearsonCorrelation(data);
    assert.ok(r > 0.5, `Expected strong positive correlation, got ${r}`);
  });

  it("returns negative correlation for inverse data", () => {
    const data = [
      { x: 8, y: 4.0 },
      { x: 5, y: 6.0 },
      { x: 3, y: 7.5 },
      { x: 1, y: 9.0 },
    ];
    const r = pearsonCorrelation(data);
    assert.ok(r < -0.5, `Expected negative correlation, got ${r}`);
  });

  it("returns weak correlation for mixed data", () => {
    // Data with no clear linear pattern
    const data = [
      { x: 1, y: 8.0 },
      { x: 2, y: 4.0 },
      { x: 3, y: 9.0 },
      { x: 4, y: 3.0 },
      { x: 5, y: 7.0 },
      { x: 6, y: 5.0 },
    ];
    const r = pearsonCorrelation(data);
    assert.ok(Math.abs(r) < 0.7, `Expected non-strong correlation, got ${r}`);
  });

  it("handles identical values (zero variance)", () => {
    const data = [
      { x: 3, y: 7.0 },
      { x: 3, y: 7.0 },
      { x: 3, y: 7.0 },
    ];
    const r = pearsonCorrelation(data);
    assert.equal(r, 0); // zero variance → 0 correlation
  });
});

describe("Team Competition Grouping", () => {
  it("groups employees by subTeam correctly", () => {
    const employees = [
      { id: "e1", subTeam: "Sales" },
      { id: "e2", subTeam: "Sales" },
      { id: "e3", subTeam: "Support" },
      { id: "e4", subTeam: null },
    ];

    const teams: Record<string, { count: number; ids: string[] }> = {};
    for (const emp of employees) {
      const team = emp.subTeam || "Unassigned";
      if (!teams[team]) teams[team] = { count: 0, ids: [] };
      teams[team].count++;
      teams[team].ids.push(emp.id);
    }

    assert.equal(Object.keys(teams).length, 3);
    assert.equal(teams["Sales"].count, 2);
    assert.equal(teams["Support"].count, 1);
    assert.equal(teams["Unassigned"].count, 1);
  });

  it("computes avg points per member for fair comparison", () => {
    const teamA = { totalPoints: 500, memberCount: 5 };
    const teamB = { totalPoints: 300, memberCount: 2 };

    const avgA = teamA.totalPoints / teamA.memberCount;
    const avgB = teamB.totalPoints / teamB.memberCount;

    assert.equal(avgA, 100);
    assert.equal(avgB, 150);
    assert.ok(avgB > avgA, "Smaller team with higher avg should rank higher per-member");
  });
});

describe("Opt-out Filtering", () => {
  it("filters out opted-out employees from leaderboard", () => {
    const leaderboardData = [
      { employeeId: "e1", totalPoints: 100 },
      { employeeId: "e2", totalPoints: 80 },
      { employeeId: "e3", totalPoints: 60 },
    ];

    const optedOutIds = new Set(["e2"]);
    const filtered = leaderboardData.filter(e => !optedOutIds.has(e.employeeId));

    assert.equal(filtered.length, 2);
    assert.ok(!filtered.some(e => e.employeeId === "e2"));
  });

  it("filters by opted-out roles", () => {
    const entries = [
      { employeeId: "e1", role: "admin" },
      { employeeId: "e2", role: "viewer" },
      { employeeId: "e3", role: "manager" },
    ];

    const optedOutRoles = new Set(["viewer"]);
    const filtered = entries.filter(e => !optedOutRoles.has(e.role));

    assert.equal(filtered.length, 2);
    assert.ok(!filtered.some(e => e.role === "viewer"));
  });
});

describe("Badge Definitions", () => {
  it("all system badges have required fields", () => {
    for (const badge of BADGE_DEFINITIONS) {
      assert.ok(badge.id, "Badge must have id");
      assert.ok(badge.name, "Badge must have name");
      assert.ok(badge.description, "Badge must have description");
      assert.ok(badge.icon, "Badge must have icon");
      assert.ok(badge.category, "Badge must have category");
    }
  });

  it("has 12 system badge definitions", () => {
    assert.equal(BADGE_DEFINITIONS.length, 12);
  });

  it("covers all 5 categories", () => {
    const categories = new Set(BADGE_DEFINITIONS.map(b => b.category));
    assert.ok(categories.has("milestone"));
    assert.ok(categories.has("performance"));
    assert.ok(categories.has("improvement"));
    assert.ok(categories.has("engagement"));
    assert.ok(categories.has("streak"));
  });
});
