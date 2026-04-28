/**
 * Coverage uplift tests for new files added in the CallAnalyzer adaptation series
 * (PR #71/#72). Targets the largest coverage gaps in:
 *   - server/services/phi-policy.ts
 *   - server/services/coaching-prompt.ts
 *   - server/services/embeddings-rag.ts (PHI redaction wrapper)
 *   - server/services/scoring-feedback-context.ts
 *   - server/services/scoring-feedback-regression.ts
 *   - server/services/scoring-feedback-alerts.ts
 *   - server/services/coaching-progressive.ts
 *   - server/services/scheduled-reports.ts
 *   - server/storage/{snapshots,scheduled-reports,scoring-corrections,call-tags}.ts
 *
 * The storage modules are pure DB-access; for those we use a fake Drizzle-shaped
 * Database to exercise the query-building branches without a real Postgres.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ============================================================================
// phi-policy.ts
// ============================================================================

describe("phi-policy: shouldRedactPhiForCategory", () => {
  it("redacts when category is undefined or null", async () => {
    const { shouldRedactPhiForCategory } = await import("../server/services/phi-policy");
    assert.equal(shouldRedactPhiForCategory(undefined), true);
    assert.equal(shouldRedactPhiForCategory(null), true);
    assert.equal(shouldRedactPhiForCategory(""), true);
  });

  it("preserves PHI for clinical_encounter and dental_encounter", async () => {
    const { shouldRedactPhiForCategory } = await import("../server/services/phi-policy");
    assert.equal(shouldRedactPhiForCategory("clinical_encounter"), false);
    assert.equal(shouldRedactPhiForCategory("telemedicine"), false);
    assert.equal(shouldRedactPhiForCategory("dental_encounter"), false);
    assert.equal(shouldRedactPhiForCategory("dental_consultation"), false);
  });

  it("redacts for non-clinical categories", async () => {
    const { shouldRedactPhiForCategory } = await import("../server/services/phi-policy");
    assert.equal(shouldRedactPhiForCategory("inbound"), true);
    assert.equal(shouldRedactPhiForCategory("outbound"), true);
    assert.equal(shouldRedactPhiForCategory("scheduling"), true);
    assert.equal(shouldRedactPhiForCategory("billing"), true);
    assert.equal(shouldRedactPhiForCategory("unknown_category_xyz"), true);
  });

  it("CLINICAL_CATEGORIES is a frozen-feeling set", async () => {
    const { CLINICAL_CATEGORIES } = await import("../server/services/phi-policy");
    assert.ok(CLINICAL_CATEGORIES.has("clinical_encounter"));
    assert.ok(CLINICAL_CATEGORIES.has("telemedicine"));
    assert.ok(CLINICAL_CATEGORIES.has("dental_encounter"));
    assert.ok(CLINICAL_CATEGORIES.has("dental_consultation"));
    assert.equal(CLINICAL_CATEGORIES.size, 4);
  });
});

describe("phi-policy: redactTextForCategory", () => {
  it("redacts SSN-shaped text when no category provided", async () => {
    const { redactTextForCategory } = await import("../server/services/phi-policy");
    const out = redactTextForCategory("Patient SSN 123-45-6789", undefined);
    assert.ok(!out.includes("123-45-6789"));
  });

  it("preserves text for clinical categories", async () => {
    const { redactTextForCategory } = await import("../server/services/phi-policy");
    const input = "Patient SSN 123-45-6789, phone 555-123-4567";
    const out = redactTextForCategory(input, "clinical_encounter");
    assert.equal(out, input);
  });

  it("redacts text for non-clinical categories", async () => {
    const { redactTextForCategory } = await import("../server/services/phi-policy");
    const out = redactTextForCategory("call SSN 123-45-6789", "inbound");
    assert.ok(!out.includes("123-45-6789"));
  });

  it("override=false forces preservation regardless of category", async () => {
    const { redactTextForCategory } = await import("../server/services/phi-policy");
    const input = "Patient SSN 123-45-6789";
    const out = redactTextForCategory(input, "inbound", false);
    assert.equal(out, input);
  });

  it("override=true forces redaction regardless of category", async () => {
    const { redactTextForCategory } = await import("../server/services/phi-policy");
    const out = redactTextForCategory("SSN 123-45-6789", "clinical_encounter", true);
    assert.ok(!out.includes("123-45-6789"));
  });
});

// ============================================================================
// coaching-prompt.ts
// ============================================================================

describe("coaching-prompt: prepareCallSummariesForPrompt", () => {
  it("returns a defensive copy when category is clinical (no redaction)", async () => {
    const { prepareCallSummariesForPrompt } = await import("../server/services/coaching-prompt");
    const original = [{ score: 7, summary: "Patient SSN 123-45-6789 mentioned diabetes", flags: ["clinical_concern"] }];
    const out = prepareCallSummariesForPrompt(original, "clinical_encounter");
    assert.equal(out[0].summary, original[0].summary);
    // Ensure it's a copy, not the same object reference
    assert.notEqual(out[0], original[0]);
  });

  it("redacts PHI from summaries by default (no category)", async () => {
    const { prepareCallSummariesForPrompt } = await import("../server/services/coaching-prompt");
    const out = prepareCallSummariesForPrompt(
      [{ score: 7, summary: "Patient SSN 123-45-6789 mentioned billing" }],
      null,
    );
    assert.ok(!String(out[0].summary).includes("123-45-6789"));
  });

  it("redacts PHI for non-clinical categories", async () => {
    const { prepareCallSummariesForPrompt } = await import("../server/services/coaching-prompt");
    const out = prepareCallSummariesForPrompt([{ summary: "Caller's email is alice@example.com" }], "inbound");
    assert.ok(!String(out[0].summary).includes("alice@example.com"));
  });

  it("handles empty array", async () => {
    const { prepareCallSummariesForPrompt } = await import("../server/services/coaching-prompt");
    assert.deepEqual(prepareCallSummariesForPrompt([], "inbound"), []);
  });

  it("preserves non-PHI fields like score and sentiment", async () => {
    const { prepareCallSummariesForPrompt } = await import("../server/services/coaching-prompt");
    const out = prepareCallSummariesForPrompt(
      [{ score: 8.5, sentiment: "positive", subScores: { compliance: 9 }, summary: "Standard scheduling call" }],
      "outbound",
    );
    assert.equal(out[0].score, 8.5);
    assert.equal(out[0].sentiment, "positive");
    assert.deepEqual(out[0].subScores, { compliance: 9 });
  });
});

// ============================================================================
// embeddings-rag.ts (PHI-redacting query embedding wrapper)
// ============================================================================

describe("embeddings-rag: generateQueryEmbedding wrapper", () => {
  it("module exports generateQueryEmbedding as an async function", async () => {
    const mod = await import("../server/services/embeddings-rag");
    assert.equal(typeof mod.generateQueryEmbedding, "function");
    // Calling with no Bedrock credentials should reject — exercise the wrapper.
    // The PHI redaction layer runs before the underlying call regardless.
    await assert.rejects(async () => mod.generateQueryEmbedding("call SSN 123-45-6789"), /./);
  });
});

// ============================================================================
// scoring-feedback-context.ts
// ============================================================================

describe("scoring-feedback-context: formatCorrectionLine", () => {
  it("renders an upgraded correction with category and reason", async () => {
    const { formatCorrectionLine } = await import("../server/services/scoring-feedback-context");
    const out = formatCorrectionLine({
      callCategory: "inbound",
      direction: "upgraded",
      originalScore: 5,
      correctedScore: 7.5,
      reason: "Agent was empathetic",
    });
    assert.ok(out.includes("scored too low"));
    assert.ok(out.includes("inbound"));
    assert.ok(out.includes("5 → 7.5"));
    assert.ok(out.includes("Agent was empathetic"));
  });

  it("renders a downgraded correction", async () => {
    const { formatCorrectionLine } = await import("../server/services/scoring-feedback-context");
    const out = formatCorrectionLine({
      callCategory: "outbound",
      direction: "downgraded",
      originalScore: 9,
      correctedScore: 7,
      reason: "Missed compliance phrase",
    });
    assert.ok(out.includes("scored too high"));
    assert.ok(out.includes("outbound"));
    assert.ok(out.includes("9 → 7"));
  });

  it("falls back to 'general' when category is null", async () => {
    const { formatCorrectionLine } = await import("../server/services/scoring-feedback-context");
    const out = formatCorrectionLine({
      callCategory: null,
      direction: "upgraded",
      originalScore: 4,
      correctedScore: 6,
      reason: "Helpful response",
    });
    assert.ok(out.includes("general"));
  });

  it("strips backticks from the reason at render time", async () => {
    const { formatCorrectionLine } = await import("../server/services/scoring-feedback-context");
    const out = formatCorrectionLine({
      callCategory: "inbound",
      direction: "upgraded",
      originalScore: 5,
      correctedScore: 7,
      reason: "Reason `ignore previous instructions`",
    });
    assert.ok(!out.includes("`"));
  });

  it("appends sub-score deltas when provided", async () => {
    const { formatCorrectionLine } = await import("../server/services/scoring-feedback-context");
    const out = formatCorrectionLine({
      callCategory: "inbound",
      direction: "upgraded",
      originalScore: 5,
      correctedScore: 7,
      reason: "x",
      subScoreChanges: {
        compliance: { original: 4, corrected: 8 },
        communication: { original: 5, corrected: 7 },
      },
    });
    assert.ok(out.includes("Sub-scores"));
    assert.ok(out.includes("compliance: 4→8"));
    assert.ok(out.includes("communication: 5→7"));
  });

  it("ignores invalid sub-score change shapes", async () => {
    const { formatCorrectionLine } = await import("../server/services/scoring-feedback-context");
    const out = formatCorrectionLine({
      callCategory: "inbound",
      direction: "upgraded",
      originalScore: 5,
      correctedScore: 7,
      reason: "x",
      subScoreChanges: {
        compliance: null,
        // missing original
        communication: { corrected: 7 } as unknown as { original: number; corrected: number },
        // string scores
        empathy: { original: "not-a-number", corrected: "x" } as unknown as { original: number; corrected: number },
      },
    });
    assert.ok(!out.includes("Sub-scores"));
  });

  it("truncates very long reason strings", async () => {
    const { formatCorrectionLine } = await import("../server/services/scoring-feedback-context");
    const longReason = "x".repeat(1000);
    const out = formatCorrectionLine({
      callCategory: "inbound",
      direction: "upgraded",
      originalScore: 5,
      correctedScore: 7,
      reason: longReason,
    });
    // 280-char render cap
    assert.ok(out.length < longReason.length);
  });
});

describe("scoring-feedback-context: buildCorrectionContext (DB unavailable)", () => {
  it("returns undefined when no DB is configured", async () => {
    const { buildCorrectionContext } = await import("../server/services/scoring-feedback-context");
    const out = await buildCorrectionContext("org-1", "inbound");
    assert.equal(out, undefined);
  });
});

// ============================================================================
// scoring-feedback-regression.ts
// ============================================================================

describe("scoring-feedback-regression: computeScoreStats", () => {
  it("returns zeros for empty input", async () => {
    const { computeScoreStats } = await import("../server/services/scoring-feedback-regression");
    assert.deepEqual(computeScoreStats([]), { mean: 0, count: 0, stdDev: 0 });
  });

  it("computes mean and stdDev correctly for a single value", async () => {
    const { computeScoreStats } = await import("../server/services/scoring-feedback-regression");
    const r = computeScoreStats([7]);
    assert.equal(r.mean, 7);
    assert.equal(r.count, 1);
    assert.equal(r.stdDev, 0);
  });

  it("computes mean and stdDev for a balanced distribution", async () => {
    const { computeScoreStats } = await import("../server/services/scoring-feedback-regression");
    const r = computeScoreStats([5, 7, 9]);
    assert.equal(r.mean, 7);
    assert.equal(r.count, 3);
    // population stddev for [5,7,9]: sqrt(((2)^2+0+(2)^2)/3) = sqrt(8/3) ≈ 1.63
    assert.ok(Math.abs(r.stdDev - 1.63) < 0.05);
  });

  it("rounds mean and stdDev to 2 decimals", async () => {
    const { computeScoreStats } = await import("../server/services/scoring-feedback-regression");
    const r = computeScoreStats([5.123, 6.456, 7.789]);
    // Both should be rounded to 2 decimal places
    const decimalPlaces = (n: number) => {
      const s = String(n);
      return s.includes(".") ? s.split(".")[1].length : 0;
    };
    assert.ok(decimalPlaces(r.mean) <= 2);
    assert.ok(decimalPlaces(r.stdDev) <= 2);
  });
});

describe("scoring-feedback-regression: detectScoringRegression", () => {
  it("returns 'no regression' when there is no call data (MemStorage empty)", async () => {
    const { detectScoringRegression } = await import("../server/services/scoring-feedback-regression");
    const r = await detectScoringRegression("non-existent-org");
    assert.equal(r.detected, false);
    assert.equal(r.alert, null);
    assert.equal(r.currentWeek.count, 0);
    assert.equal(r.previousWeek.count, 0);
  });
});

describe("scoring-feedback-regression: runScoringRegressionChecks", () => {
  it("returns an array (possibly empty) without throwing", async () => {
    const { runScoringRegressionChecks } = await import("../server/services/scoring-feedback-regression");
    const r = await runScoringRegressionChecks();
    assert.ok(Array.isArray(r));
  });
});

// ============================================================================
// scoring-feedback-alerts.ts
// ============================================================================

describe("scoring-feedback-alerts: checkScoringQuality (DB unavailable)", () => {
  it("returns [] when DB is not configured", async () => {
    const { checkScoringQuality } = await import("../server/services/scoring-feedback-alerts");
    const out = await checkScoringQuality("org-1");
    assert.deepEqual(out, []);
  });
});

describe("scoring-feedback-alerts: runScoringQualityChecks", () => {
  it("returns an array (possibly empty) without throwing", async () => {
    const { runScoringQualityChecks } = await import("../server/services/scoring-feedback-alerts");
    const out = await runScoringQualityChecks();
    assert.ok(Array.isArray(out));
  });
});

// ============================================================================
// coaching-progressive.ts
// ============================================================================

describe("coaching-progressive: progressivePlanToActionPlan", () => {
  it("converts tasks into actionPlan shape with completed=false", async () => {
    const { progressivePlanToActionPlan } = await import("../server/services/coaching-progressive");
    const result = progressivePlanToActionPlan({
      tasks: ["Review last week's calls", "Practice empathy phrases", "Apply in 5 live calls"],
      notes: "ok",
    });
    assert.equal(result.length, 3);
    assert.equal(result[0].task, "Review last week's calls");
    assert.equal(result[0].completed, false);
    assert.equal(result[2].task, "Apply in 5 live calls");
  });

  it("returns empty array for empty tasks", async () => {
    const { progressivePlanToActionPlan } = await import("../server/services/coaching-progressive");
    assert.deepEqual(progressivePlanToActionPlan({ tasks: [], notes: "" }), []);
  });
});

describe("coaching-progressive: generateProgressivePlan (Bedrock unavailable)", () => {
  it("returns null when AI provider is not available", async () => {
    const { generateProgressivePlan } = await import("../server/services/coaching-progressive");
    const out = await generateProgressivePlan(
      "org-1",
      "emp-1",
      { dim: "compliance", label: "Compliance", avgScore: 5.5, count: 3 },
      { secondaryWeaknesses: [], callSummaries: [], totalCallsAnalyzed: 10 },
    );
    // In CI with no Bedrock credentials, aiProvider.isAvailable is false → returns null
    // When credentials ARE set, this would attempt a real call (skipped in CI).
    if (out !== null) {
      assert.ok(Array.isArray(out.tasks));
      assert.equal(typeof out.notes, "string");
    } else {
      assert.equal(out, null);
    }
  });
});

// ============================================================================
// scheduled-reports.ts (service)
// ============================================================================

describe("scheduled-reports: computePeriodForType", () => {
  it("computes a 7-day window for weekly_team", async () => {
    const { computePeriodForType } = await import("../server/services/scheduled-reports");
    const asOf = new Date("2026-04-15T12:34:56Z");
    const { periodStart, periodEnd } = computePeriodForType("weekly_team", asOf);
    const diffDays = Math.round((periodEnd.getTime() - periodStart.getTime()) / 86_400_000);
    assert.equal(diffDays, 7);
    // Snapped to UTC midnight
    assert.equal(periodEnd.getUTCHours(), 0);
    assert.equal(periodStart.getUTCHours(), 0);
  });

  it("computes a 1-month window for monthly_executive", async () => {
    const { computePeriodForType } = await import("../server/services/scheduled-reports");
    const asOf = new Date("2026-04-15T00:00:00Z");
    const { periodStart, periodEnd } = computePeriodForType("monthly_executive", asOf);
    // Should be roughly 30 days back
    const diffDays = (periodEnd.getTime() - periodStart.getTime()) / 86_400_000;
    assert.ok(diffDays >= 28 && diffDays <= 31);
  });

  it("falls back to 24h window for unknown types", async () => {
    const { computePeriodForType } = await import("../server/services/scheduled-reports");
    const asOf = new Date("2026-04-15T12:00:00Z");
    const { periodStart, periodEnd } = computePeriodForType("custom_unknown", asOf);
    const diffMs = periodEnd.getTime() - periodStart.getTime();
    assert.equal(diffMs, 86_400_000);
  });

  it("uses now() as default asOf", async () => {
    const { computePeriodForType } = await import("../server/services/scheduled-reports");
    const before = Date.now();
    const { periodEnd } = computePeriodForType("weekly_team");
    const after = Date.now();
    // periodEnd is snapped to UTC midnight, but should be <= now and recent
    assert.ok(periodEnd.getTime() <= after);
    assert.ok(periodEnd.getTime() >= before - 86_400_000);
  });
});

describe("scheduled-reports: getReports / runScheduledReportsTick / catchUpReports / deliverPendingReports (no DB)", () => {
  it("getReports returns [] for unknown org with no DB", async () => {
    const { getReports } = await import("../server/services/scheduled-reports");
    const r = await getReports("nonexistent-org");
    assert.deepEqual(r, []);
  });

  it("runScheduledReportsTick returns zero counts when DB is unavailable", async () => {
    const { runScheduledReportsTick } = await import("../server/services/scheduled-reports");
    const r = await runScheduledReportsTick();
    assert.deepEqual(r, { checked: 0, generated: 0, failed: 0 });
  });

  it("catchUpReports returns zero counts when DB is unavailable", async () => {
    const { catchUpReports } = await import("../server/services/scheduled-reports");
    const r = await catchUpReports("org-1");
    assert.deepEqual(r, { generated: 0, skipped: 0 });
  });

  it("deliverPendingReports returns zero counts when DB is unavailable", async () => {
    const { deliverPendingReports } = await import("../server/services/scheduled-reports");
    const r = await deliverPendingReports();
    assert.deepEqual(r, { pending: 0, sent: 0, failed: 0 });
  });
});

describe("scheduled-reports: generateReport (in-memory fallback)", () => {
  it("returns a valid report shape even with no DB and no calls", async () => {
    const { generateReport } = await import("../server/services/scheduled-reports");
    const report = await generateReport("org-mem-test", "weekly_team");
    assert.equal(report.orgId, "org-mem-test");
    assert.equal(report.type, "weekly_team");
    assert.ok(typeof report.id === "string");
    assert.ok(typeof report.periodStart === "string");
    assert.ok(typeof report.periodEnd === "string");
    assert.equal(report.metrics.totalCalls, 0);
    assert.deepEqual(report.topPerformers, []);
    assert.deepEqual(report.bottomPerformers, []);
  });

  it("getReports returns the in-memory persisted report afterwards", async () => {
    const { generateReport, getReports } = await import("../server/services/scheduled-reports");
    const orgId = "org-mem-getreports-" + Date.now();
    await generateReport(orgId, "weekly_team");
    const reports = await getReports(orgId);
    assert.ok(reports.length >= 1);
    assert.equal(reports[0].orgId, orgId);
  });

  it("respects an explicit period override", async () => {
    const { generateReport } = await import("../server/services/scheduled-reports");
    const period = {
      periodStart: new Date("2026-01-01T00:00:00Z"),
      periodEnd: new Date("2026-01-08T00:00:00Z"),
    };
    const report = await generateReport("org-mem-period-" + Date.now(), "weekly_team", { period });
    assert.equal(report.periodStart, "2026-01-01T00:00:00.000Z");
    assert.equal(report.periodEnd, "2026-01-08T00:00:00.000Z");
  });
});

// ============================================================================
// Storage modules — exercised via a fake Drizzle-shaped Database
// ============================================================================

/**
 * Build a fake Database that satisfies the chained Drizzle API surface used
 * by the storage modules. Every chain method returns the same proxy and
 * resolves (when awaited) to the configured default result.
 *
 * This is structural coverage only — query correctness is not asserted.
 * It exercises the function's own statement coverage (parameter handling,
 * SQL template strings, conditional branches in WHERE clause builders).
 */
function makeFakeDb(opts: { rows?: any[]; insertRows?: any[] } = {}) {
  const rows = opts.rows ?? [];
  const insertRows = opts.insertRows ?? [{ id: "fake-row-id" }];

  function makeChain(defaultResult: any[]): any {
    const proxy: any = new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === "then") {
            return (resolve: any, reject: any) => Promise.resolve(defaultResult).then(resolve, reject);
          }
          // Any method returns same chain
          return (..._args: unknown[]) => proxy;
        },
      },
    );
    return proxy;
  }

  return {
    execute: async (..._args: unknown[]) => ({ rows: [] }),
    select: () => makeChain(rows),
    insert: () => makeChain(insertRows),
    delete: () => makeChain(rows),
    update: () => makeChain(rows),
  } as any;
}

describe("storage/snapshots: exercises all CRUD paths via fake DB", () => {
  it("upsertSnapshot, listRecentSnapshots, getSnapshotById, deleteSnapshotsByOrg, resetSnapshotContext", async () => {
    const mod = await import("../server/storage/snapshots");
    const db = makeFakeDb({ rows: [], insertRows: [{ id: "snap-1", orgId: "org-1" }] });

    const insertData = {
      id: "snap-1",
      orgId: "org-1",
      level: "company" as const,
      targetId: "org-1",
      targetName: "Test",
      periodStart: new Date(),
      periodEnd: new Date(),
      metrics: {} as any,
      aiSummary: null,
      priorSnapshotIds: [] as any,
      generatedAt: new Date(),
    };
    const upserted = await mod.upsertSnapshot(db, insertData);
    assert.ok(upserted);

    const list = await mod.listRecentSnapshots(db, "org-1", "company", "org-1", 5);
    assert.ok(Array.isArray(list));

    const single = await mod.getSnapshotById(db, "org-1", "snap-1");
    assert.equal(single, null);

    const deleted = await mod.deleteSnapshotsByOrg(db, "org-1");
    assert.equal(deleted, 0);

    const reset = await mod.resetSnapshotContext(db, "org-1", "company", "org-1");
    assert.equal(reset, 0);

    // Ensure ddl-ensured short-circuit: second call doesn't redo execute
    await mod.ensureSnapshotTable(db);
  });
});

describe("storage/scoring-corrections: exercises all CRUD paths via fake DB", () => {
  it("insertCorrection, listRecent*, listForCall, getOrgCorrectionStats, deleteCorrectionsByOrg", async () => {
    const mod = await import("../server/storage/scoring-corrections");
    const insertRows = [
      {
        id: "c1",
        orgId: "org-1",
        callId: "call-1",
        correctedBy: "u1",
        reason: "x",
        originalScore: 5,
        correctedScore: 7,
        direction: "upgraded",
      },
    ];
    const statsRows = [
      { direction: "upgraded", callCategory: "inbound" },
      { direction: "downgraded", callCategory: null },
      { direction: "upgraded", callCategory: "outbound" },
      { direction: "skipped", callCategory: "inbound" },
    ];
    const db = makeFakeDb({ rows: [], insertRows });
    const dbWithStats = makeFakeDb({ rows: statsRows, insertRows });

    const inserted = await mod.insertCorrection(db, {
      id: "c1",
      orgId: "org-1",
      callId: "call-1",
      correctedBy: "u1",
      reason: "x",
      originalScore: 5,
      correctedScore: 7,
      direction: "upgraded",
    } as any);
    assert.ok(inserted);

    const recent = await mod.listRecentByOrg(db, "org-1", 10);
    assert.ok(Array.isArray(recent));

    const byCat = await mod.listRecentByCategory(db, "org-1", "inbound", 5);
    assert.ok(Array.isArray(byCat));

    const noCat = await mod.listRecentByCategory(db, "org-1", null, 5);
    assert.ok(Array.isArray(noCat));

    const byUser = await mod.listRecentByUser(db, "org-1", "u1", 5);
    assert.ok(Array.isArray(byUser));

    const since = await mod.listCorrectionsSince(db, "org-1", new Date(Date.now() - 86400000));
    assert.ok(Array.isArray(since));

    const forCall = await mod.listForCall(db, "org-1", "call-1");
    assert.ok(Array.isArray(forCall));

    const stats = await mod.getOrgCorrectionStats(dbWithStats, "org-1");
    assert.equal(stats.total, 4);
    assert.equal(stats.upgrades, 2);
    assert.equal(stats.downgrades, 1);
    assert.ok(stats.byCategory.inbound >= 1);
    assert.ok(stats.byCategory.unknown >= 1);

    // With sinceDays branch
    const statsRecent = await mod.getOrgCorrectionStats(dbWithStats, "org-1", 7);
    assert.equal(statsRecent.total, 4);

    const deleted = await mod.deleteCorrectionsByOrg(db, "org-1");
    assert.equal(deleted, 0);
  });
});

describe("storage/scheduled-reports: exercises all CRUD paths via fake DB", () => {
  it("upsertReport, mark*, reportExists, listReports, listPendingDelivery, configs CRUD", async () => {
    const mod = await import("../server/storage/scheduled-reports");
    const insertRows = [{ id: "r1", orgId: "org-1", reportType: "weekly_team" }];
    const db = makeFakeDb({ rows: [], insertRows });
    const dbWithRows = makeFakeDb({ rows: [{ id: "r1" }], insertRows });

    const upserted = await mod.upsertReport(db, {
      id: "r1",
      orgId: "org-1",
      reportType: "weekly_team",
      periodStart: new Date(),
      periodEnd: new Date(),
      status: "generated",
      recipientEmails: ["a@b.com"] as any,
    } as any);
    assert.ok(upserted);

    await mod.markReportSent(db, "org-1", "r1");
    await mod.markReportFailed(db, "org-1", "r1", "test failure");

    const exists = await mod.reportExists(db, "org-1", "weekly_team", new Date());
    assert.equal(exists, false);

    const existsTrue = await mod.reportExists(dbWithRows, "org-1", "weekly_team", new Date());
    assert.equal(existsTrue, true);

    const list = await mod.listReports(db, "org-1");
    assert.ok(Array.isArray(list));

    const listFiltered = await mod.listReports(db, "org-1", { reportType: "monthly_executive", limit: 5 });
    assert.ok(Array.isArray(listFiltered));

    const pending = await mod.listPendingDelivery(db, 25);
    assert.ok(Array.isArray(pending));

    await mod.deleteScheduledReportsByOrg(db, "org-1");

    const config = await mod.upsertReportConfig(db, {
      id: "cfg1",
      orgId: "org-1",
      reportType: "weekly_team",
      enabled: true,
      recipientEmails: ["a@b.com"] as any,
      schedule: "weekly",
    } as any);
    assert.ok(config);

    const enabledList = await mod.listEnabledConfigs(db);
    assert.ok(Array.isArray(enabledList));

    const orgConfigs = await mod.listOrgConfigs(db, "org-1");
    assert.ok(Array.isArray(orgConfigs));
  });
});

describe("storage/call-tags: exercises tag + annotation CRUD via fake DB", () => {
  it("tag CRUD operations: add/list/getById/delete/listTop/listIdsByTag/deleteByOrg", async () => {
    const mod = await import("../server/storage/call-tags");
    const db = makeFakeDb({
      rows: [],
      insertRows: [{ id: "t1", orgId: "org-1", callId: "call-1", tag: "urgent" }],
    });
    const dbWithTopTags = makeFakeDb({
      rows: [
        { tag: "urgent", count: 5 },
        { tag: "compliance", count: 3 },
      ],
    });
    const dbWithCallIds = makeFakeDb({
      rows: [{ callId: "call-1" }, { callId: "call-2" }],
    });

    const added = await mod.addTag(db, {
      id: "t1",
      orgId: "org-1",
      callId: "call-1",
      tag: "urgent",
      addedBy: "u1",
    } as any);
    assert.ok(added !== null);

    const list = await mod.listTagsForCall(db, "org-1", "call-1");
    assert.ok(Array.isArray(list));

    const single = await mod.getTagById(db, "org-1", "t1");
    assert.equal(single, null);

    await mod.deleteTag(db, "org-1", "t1");

    const top = await mod.listTopTags(dbWithTopTags, "org-1", 10);
    assert.ok(Array.isArray(top));

    const ids = await mod.listCallIdsByTag(dbWithCallIds, "org-1", "urgent", 10);
    assert.ok(Array.isArray(ids));

    const deletedCount = await mod.deleteTagsByOrg(db, "org-1");
    assert.equal(deletedCount, 0);
  });

  it("annotation CRUD operations", async () => {
    const mod = await import("../server/storage/call-tags");
    const db = makeFakeDb({
      rows: [],
      insertRows: [{ id: "a1", orgId: "org-1", callId: "call-1" }],
    });

    const added = await mod.addAnnotation(db, {
      id: "a1",
      orgId: "org-1",
      callId: "call-1",
      momentSeconds: 12.5,
      text: "Customer became upset here",
      authorId: "u1",
      authorName: "Alice",
    } as any);
    assert.ok(added);

    const list = await mod.listAnnotationsForCall(db, "org-1", "call-1");
    assert.ok(Array.isArray(list));

    const single = await mod.getAnnotationById(db, "org-1", "a1");
    assert.equal(single, null);

    await mod.deleteAnnotation(db, "org-1", "a1");

    const deletedCount = await mod.deleteAnnotationsByOrg(db, "org-1");
    assert.equal(deletedCount, 0);
  });
});

// ============================================================================
// scheduled tick wrappers
// ============================================================================

describe("scheduled/scheduled-reports-tick: scheduler wrapper exports", () => {
  it("module exports startScheduledReportsHourlyTick and runScheduledReportsCatchUp", async () => {
    const mod = await import("../server/scheduled/scheduled-reports-tick");
    assert.equal(typeof mod.startScheduledReportsHourlyTick, "function");
    assert.equal(typeof mod.runScheduledReportsCatchUp, "function");
  });

  it("startScheduledReportsHourlyTick returns a cancel function", async () => {
    const mod = await import("../server/scheduled/scheduled-reports-tick");
    const cancel = mod.startScheduledReportsHourlyTick();
    assert.equal(typeof cancel, "function");
    cancel();
  });
});

describe("scheduled/scoring-quality-tasks: scheduler orchestrator exports", () => {
  it("module exports runScoringQualityChecks and runScoringRegressionChecks wrappers", async () => {
    const mod = await import("../server/scheduled/scoring-quality-tasks");
    // Smoke test — just verify module loads and primary functions exist
    const fns = Object.keys(mod);
    assert.ok(fns.length > 0);
    for (const name of fns) {
      assert.ok(typeof (mod as any)[name] === "function");
    }
  });
});
