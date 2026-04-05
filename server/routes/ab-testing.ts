import type { Express } from "express";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import { storage } from "../storage";
import { assemblyAIService } from "../services/assemblyai";
import { BedrockProvider } from "../services/bedrock";
import { requireAuth, requireRole, injectOrgContext } from "../auth";
import { broadcastCallUpdate } from "../services/websocket";
import { trackUsage } from "../services/queue";
import { upload } from "./helpers";
import { logger } from "../services/logger";
import { requireActiveSubscription, requirePlanFeature } from "./billing";
import { asyncHandler } from "../middleware/error-handler";
import { BEDROCK_MODEL_PRESETS, CALL_CATEGORIES, type UsageRecord } from "@shared/schema";
import { estimateBedrockCost, estimateAssemblyAICost } from "../services/cost-estimation";

async function cleanupFile(filePath: string) {
  try {
    await fs.promises.unlink(filePath);
  } catch (err) {
    logger.debug({ err }, "Failed to clean up temporary file");
  }
}

export function registerABTestRoutes(app: Express): void {
  // List all A/B tests
  app.get("/api/ab-tests", requireAuth, requireRole("admin"), injectOrgContext, asyncHandler(async (req, res) => {
      const tests = await storage.getAllABTests(req.orgId!);
      res.json(tests);
  }));

  // Get a single A/B test
  app.get("/api/ab-tests/:id", requireAuth, requireRole("admin"), injectOrgContext, asyncHandler(async (req, res) => {
      const test = await storage.getABTest(req.orgId!, req.params.id);
      if (!test) {
        res.status(404).json({ message: "A/B test not found" });
        return;
      }
      res.json(test);
  }));

  // Upload audio for A/B model comparison
  app.post(
    "/api/ab-tests/upload",
    requireAuth,
    requireRole("admin"),
    injectOrgContext,
    requireActiveSubscription(),
    requirePlanFeature("abTestingEnabled", "A/B model testing requires a Pro or Enterprise plan"),
    upload.single("audioFile"),
    async (req, res) => {
      try {
        if (!req.file) {
          res.status(400).json({ message: "No audio file provided" });
          return;
        }

        const { testModel } = req.body;
        const validModels = BEDROCK_MODEL_PRESETS.map((m) => m.value) as string[];
        if (!testModel || !validModels.includes(testModel)) {
          await cleanupFile(req.file.path);
          res.status(400).json({ message: `Invalid model. Must be one of: ${validModels.join(", ")}` });
          return;
        }
        const abValidCategories = CALL_CATEGORIES.map((c) => c.value) as string[];
        const callCategory = abValidCategories.includes(req.body.callCategory) ? req.body.callCategory : undefined;

        const user = req.user;
        const orgId = req.orgId!;
        const baselineModel = process.env.BEDROCK_MODEL || "us.anthropic.claude-sonnet-4-6";

        const abTest = await storage.createABTest(orgId, {
          orgId,
          fileName: req.file.originalname,
          callCategory: callCategory || undefined,
          baselineModel,
          testModel,
          status: "processing",
          createdBy: user?.username || "admin",
        });

        const filePath = req.file.path;

        // Async processing — non-blocking
        processABTest(orgId, abTest.id, filePath, callCategory, user?.username || "admin").catch(async (error) => {
          logger.error({ testId: abTest.id, err: error }, "A/B test processing failed");
          try {
            await storage.updateABTest(orgId, abTest.id, { status: "failed" });
          } catch (err) {
            logger.warn({ err, testId: abTest.id }, "Failed to update A/B test status to failed");
          }
        });

        res.status(201).json(abTest);
      } catch (error) {
        logger.error({ err: error }, "Error starting A/B test");
        if (req.file?.path) await cleanupFile(req.file.path);
        res.status(500).json({ message: "Failed to start A/B test" });
      }
    },
  );

  // Export A/B test result as JSON
  app.get("/api/ab-tests/:id/export", requireAuth, requireRole("admin"), injectOrgContext, asyncHandler(async (req, res) => {
      const test = await storage.getABTest(req.orgId!, req.params.id);
      if (!test) {
        res.status(404).json({ message: "A/B test not found" });
        return;
      }
      if (test.status !== "completed" && test.status !== "partial") {
        res.status(400).json({ message: "Test must be completed before export" });
        return;
      }
      const baselineLabel =
        BEDROCK_MODEL_PRESETS.find((m) => m.value === test.baselineModel)?.label || test.baselineModel;
      const testLabel = BEDROCK_MODEL_PRESETS.find((m) => m.value === test.testModel)?.label || test.testModel;
      const exportData = {
        testId: test.id,
        fileName: test.fileName,
        callCategory: test.callCategory,
        createdAt: test.createdAt,
        createdBy: test.createdBy,
        status: test.status,
        baseline: {
          model: test.baselineModel,
          modelLabel: baselineLabel,
          latencyMs: test.baselineLatencyMs,
          analysis: test.baselineAnalysis,
        },
        test: {
          model: test.testModel,
          modelLabel: testLabel,
          latencyMs: test.testLatencyMs,
          analysis: test.testAnalysis,
        },
      };
      const safeName = (test.fileName || "ab-test").replace(/[^a-zA-Z0-9._-]/g, "_");
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Disposition", `attachment; filename="ab-test-${safeName}-${test.id.slice(0, 8)}.json"`);
      res.json(exportData);
  }));

  // Delete an A/B test
  app.delete("/api/ab-tests/:id", requireAuth, requireRole("admin"), injectOrgContext, asyncHandler(async (req, res) => {
      const test = await storage.getABTest(req.orgId!, req.params.id);
      if (!test) {
        res.status(404).json({ message: "A/B test not found" });
        return;
      }
      await storage.deleteABTest(req.orgId!, req.params.id);
      res.json({ message: "A/B test deleted" });
  }));

  // --- Batch upload: test multiple calls at once ---
  app.post(
    "/api/ab-tests/batch",
    requireAuth,
    requireRole("admin"),
    injectOrgContext,
    requireActiveSubscription(),
    requirePlanFeature("abTestingEnabled", "A/B model testing requires a Pro or Enterprise plan"),
    upload.array("audioFiles", 50),
    async (req, res) => {
      try {
        const files = req.files as any[] | undefined;
        if (!files || files.length === 0) {
          return res.status(400).json({ message: "No audio files provided" });
        }
        if (files.length > 50) {
          for (const f of files) await cleanupFile(f.path);
          return res.status(400).json({ message: "Maximum 50 files per batch" });
        }

        const { testModel } = req.body;
        const validModels = BEDROCK_MODEL_PRESETS.map((m) => m.value) as string[];
        if (!testModel || !validModels.includes(testModel)) {
          for (const f of files) await cleanupFile(f.path);
          return res.status(400).json({ message: `Invalid model. Must be one of: ${validModels.join(", ")}` });
        }

        const abValidCategories = CALL_CATEGORIES.map((c) => c.value) as string[];
        const callCategory = abValidCategories.includes(req.body.callCategory) ? req.body.callCategory : undefined;
        const orgId = req.orgId!;
        const baselineModel = process.env.BEDROCK_MODEL || "us.anthropic.claude-sonnet-4-6";
        const batchId = randomUUID();
        const userName = req.user?.username || "admin";

        const tests: any[] = [];
        for (const file of files) {
          const abTest = await storage.createABTest(orgId, {
            orgId,
            fileName: file.originalname,
            callCategory,
            baselineModel,
            testModel,
            status: "processing",
            createdBy: userName,
            batchId,
          });
          tests.push(abTest);

          // Process each file asynchronously
          processABTest(orgId, abTest.id, file.path, callCategory, userName).catch(async (error) => {
            logger.error({ testId: abTest.id, err: error }, "Batch A/B test processing failed");
            try {
              await storage.updateABTest(orgId, abTest.id, { status: "failed" });
            } catch (err) {
              logger.warn({ err }, "Failed to update batch test status");
            }
          });
        }

        logger.info({ orgId, batchId, fileCount: files.length }, "A/B test batch started");
        res.status(201).json({ batchId, tests, totalFiles: files.length });
      } catch (error) {
        logger.error({ err: error }, "Error starting A/B test batch");
        const files = req.files as any[] | undefined;
        if (files) for (const f of files) await cleanupFile(f.path);
        res.status(500).json({ message: "Failed to start A/B test batch" });
      }
    },
  );

  // --- Get batch status and aggregate results ---
  app.get("/api/ab-tests/batch/:batchId", requireAuth, requireRole("admin"), injectOrgContext, asyncHandler(async (req, res) => {
      const orgId = req.orgId!;
      const allTests = await storage.getAllABTests(orgId);
      const batchTests = allTests.filter((t) => t.batchId === req.params.batchId);

      if (batchTests.length === 0) {
        return res.status(404).json({ message: "Batch not found" });
      }

      const completed = batchTests.filter((t) => t.status === "completed");
      const processing = batchTests.filter((t) => t.status === "processing" || t.status === "analyzing");
      const failed = batchTests.filter((t) => t.status === "failed");

      res.json({
        batchId: req.params.batchId,
        totalTests: batchTests.length,
        completedCount: completed.length,
        processingCount: processing.length,
        failedCount: failed.length,
        partialCount: batchTests.filter((t) => t.status === "partial").length,
        isComplete: processing.length === 0,
        tests: batchTests,
      });
  }));

  // --- Aggregate statistics with statistical significance ---
  app.get("/api/ab-tests/stats", requireAuth, requireRole("admin"), injectOrgContext, asyncHandler(async (req, res) => {
      const orgId = req.orgId!;
      const allTests = await storage.getAllABTests(orgId);
      const { batchId, baselineModel, testModel } = req.query;

      let tests = allTests.filter((t) => t.status === "completed");
      if (batchId) tests = tests.filter((t) => t.batchId === batchId);
      if (baselineModel) tests = tests.filter((t) => t.baselineModel === baselineModel);
      if (testModel) tests = tests.filter((t) => t.testModel === testModel);

      if (tests.length === 0) {
        return res.json({ testCount: 0, message: "No completed tests found matching filters" });
      }

      const stats = computeAggregateStats(tests);
      res.json(stats);
  }));

  // --- Segment analysis: breakdown by call category ---
  app.get("/api/ab-tests/segments", requireAuth, requireRole("admin"), injectOrgContext, asyncHandler(async (req, res) => {
      const orgId = req.orgId!;
      const allTests = await storage.getAllABTests(orgId);
      const completed = allTests.filter((t) => t.status === "completed");

      // Group by call category
      const segments: Record<string, typeof completed> = {};
      for (const test of completed) {
        const cat = test.callCategory || "uncategorized";
        if (!segments[cat]) segments[cat] = [];
        segments[cat].push(test);
      }

      // Also group by model pair
      const modelPairs: Record<string, typeof completed> = {};
      for (const test of completed) {
        const pair = `${test.baselineModel} vs ${test.testModel}`;
        if (!modelPairs[pair]) modelPairs[pair] = [];
        modelPairs[pair].push(test);
      }

      const categoryBreakdown: Record<string, any> = {};
      for (const [cat, catTests] of Object.entries(segments)) {
        if (catTests.length >= 2) {
          categoryBreakdown[cat] = computeAggregateStats(catTests);
        } else {
          categoryBreakdown[cat] = { testCount: catTests.length, message: "Insufficient data (need 2+ tests)" };
        }
      }

      const modelPairBreakdown: Record<string, any> = {};
      for (const [pair, pairTests] of Object.entries(modelPairs)) {
        if (pairTests.length >= 2) {
          modelPairBreakdown[pair] = computeAggregateStats(pairTests);
        } else {
          modelPairBreakdown[pair] = { testCount: pairTests.length, message: "Insufficient data" };
        }
      }

      res.json({
        totalCompletedTests: completed.length,
        byCategory: categoryBreakdown,
        byModelPair: modelPairBreakdown,
      });
  }));

  // --- Automated recommendation ---
  app.get("/api/ab-tests/recommend", requireAuth, requireRole("admin"), injectOrgContext, asyncHandler(async (req, res) => {
      const orgId = req.orgId!;
      const allTests = await storage.getAllABTests(orgId);
      const completed = allTests.filter((t) => t.status === "completed");

      if (completed.length < 5) {
        return res.json({
          recommendation: null,
          message: `Need at least 5 completed tests for recommendations (have ${completed.length})`,
        });
      }

      // Group by model pair
      const modelPairs: Record<string, typeof completed> = {};
      for (const test of completed) {
        const pair = `${test.baselineModel}::${test.testModel}`;
        if (!modelPairs[pair]) modelPairs[pair] = [];
        modelPairs[pair].push(test);
      }

      const recommendations: Array<{
        baselineModel: string;
        testModel: string;
        baselineLabel: string;
        testLabel: string;
        testCount: number;
        recommendation: string;
        confidence: string;
        details: {
          scoreDiff: number;
          costDiff: number;
          latencyDiff: number;
          pValue: number | null;
          isSignificant: boolean;
        };
        categoryRecommendations?: Array<{
          category: string;
          winner: string;
          scoreDiff: number;
          testCount: number;
        }>;
      }> = [];

      for (const [pairKey, pairTests] of Object.entries(modelPairs)) {
        if (pairTests.length < 3) continue;
        const [bModel, tModel] = pairKey.split("::");
        const stats = computeAggregateStats(pairTests);

        const baselineLabel = BEDROCK_MODEL_PRESETS.find((m) => m.value === bModel)?.label || bModel;
        const testLabel = BEDROCK_MODEL_PRESETS.find((m) => m.value === tModel)?.label || tModel;

        let recommendation: string;
        let confidence: string;

        const scoreDiff = stats.avgScoreDiff;
        const isSignificant = stats.significance?.isSignificant ?? false;
        const costDiff = stats.costComparison?.percentDiff ?? 0;

        if (!isSignificant) {
          recommendation = `No statistically significant difference between ${baselineLabel} and ${testLabel}. Continue testing to gather more data.`;
          confidence = "low";
        } else if (scoreDiff > 0.5) {
          const costNote =
            costDiff > 5
              ? ` (${costDiff.toFixed(0)}% more expensive)`
              : costDiff < -5
                ? ` (${Math.abs(costDiff).toFixed(0)}% cheaper)`
                : "";
          recommendation = `Consider switching to ${testLabel} — scores ${scoreDiff.toFixed(1)} points higher on average${costNote}.`;
          confidence = pairTests.length >= 10 ? "high" : "moderate";
        } else if (scoreDiff < -0.5) {
          recommendation = `Keep ${baselineLabel} — it scores ${Math.abs(scoreDiff).toFixed(1)} points higher than ${testLabel}.`;
          confidence = pairTests.length >= 10 ? "high" : "moderate";
        } else if (costDiff < -10) {
          recommendation = `Consider ${testLabel} — similar quality but ${Math.abs(costDiff).toFixed(0)}% cheaper.`;
          confidence = "moderate";
        } else {
          recommendation = `Both models perform similarly. ${baselineLabel} is the safer choice as the current production model.`;
          confidence = "moderate";
        }

        // Per-category recommendations
        const categories: Record<string, typeof pairTests> = {};
        for (const t of pairTests) {
          const cat = t.callCategory || "uncategorized";
          if (!categories[cat]) categories[cat] = [];
          categories[cat].push(t);
        }

        const categoryRecs: (typeof recommendations)[0]["categoryRecommendations"] = [];
        for (const [cat, catTests] of Object.entries(categories)) {
          if (catTests.length < 2) continue;
          const catStats = computeAggregateStats(catTests);
          if (Math.abs(catStats.avgScoreDiff) >= 0.5) {
            categoryRecs.push({
              category: cat,
              winner: catStats.avgScoreDiff > 0 ? tModel : bModel,
              scoreDiff: catStats.avgScoreDiff,
              testCount: catTests.length,
            });
          }
        }

        recommendations.push({
          baselineModel: bModel,
          testModel: tModel,
          baselineLabel,
          testLabel,
          testCount: pairTests.length,
          recommendation,
          confidence,
          details: {
            scoreDiff,
            costDiff,
            latencyDiff: stats.latencyComparison?.percentDiff ?? 0,
            pValue: stats.significance?.pValue ?? null,
            isSignificant,
          },
          categoryRecommendations: categoryRecs.length > 0 ? categoryRecs : undefined,
        });
      }

      res.json({ recommendations });
  }));
}

// ==================== STATISTICAL ANALYSIS HELPERS ====================

function extractScore(analysis: any): number | null {
  if (!analysis || analysis.error) return null;
  const score = analysis.performance_score ?? analysis.performanceScore;
  if (score === undefined || score === null) return null;
  const num = typeof score === "number" ? score : parseFloat(String(score));
  return isNaN(num) ? null : num;
}

function extractSubScore(analysis: any, field: string): number | null {
  const sub = analysis?.sub_scores ?? analysis?.subScores;
  if (!sub) return null;
  const val = sub[field];
  if (val === undefined || val === null) return null;
  const num = typeof val === "number" ? val : parseFloat(String(val));
  return isNaN(num) ? null : num;
}

/**
 * Welch's t-test for two independent samples (unequal variance).
 * Returns { tStatistic, degreesOfFreedom, pValue }.
 */
function welchTTest(
  sample1: number[],
  sample2: number[],
): { tStatistic: number; degreesOfFreedom: number; pValue: number } | null {
  if (sample1.length < 2 || sample2.length < 2) return null;

  const n1 = sample1.length;
  const n2 = sample2.length;
  const mean1 = sample1.reduce((a, b) => a + b, 0) / n1;
  const mean2 = sample2.reduce((a, b) => a + b, 0) / n2;
  const var1 = sample1.reduce((sum, x) => sum + Math.pow(x - mean1, 2), 0) / (n1 - 1);
  const var2 = sample2.reduce((sum, x) => sum + Math.pow(x - mean2, 2), 0) / (n2 - 1);

  const se = Math.sqrt(var1 / n1 + var2 / n2);
  if (se === 0) return { tStatistic: 0, degreesOfFreedom: n1 + n2 - 2, pValue: 1 };

  const t = (mean1 - mean2) / se;

  // Welch-Satterthwaite degrees of freedom
  const num = Math.pow(var1 / n1 + var2 / n2, 2);
  const den = Math.pow(var1 / n1, 2) / (n1 - 1) + Math.pow(var2 / n2, 2) / (n2 - 1);
  const df = den > 0 ? num / den : n1 + n2 - 2;

  // Approximate two-tailed p-value using the t-distribution CDF
  // Use the regularized incomplete beta function approximation
  const pValue = tDistPValue(Math.abs(t), df);

  return {
    tStatistic: Math.round(t * 1000) / 1000,
    degreesOfFreedom: Math.round(df * 10) / 10,
    pValue: Math.round(pValue * 10000) / 10000,
  };
}

/**
 * Approximate two-tailed p-value for t-distribution.
 * For df > 100, uses normal approximation directly.
 * For smaller df, uses the transformation: z ≈ t * (1 + t²/df)^{-0.5}
 * which maps the t-distribution to an approximate standard normal.
 */
function tDistPValue(absT: number, df: number): number {
  if (df <= 0) return 1;
  // For large df, t ≈ normal
  if (df > 100) {
    return 2 * normalCdfComplement(absT);
  }
  // Cornish-Fisher approximation: transform t → z for moderate df
  const adjustedZ = absT * Math.pow(1 + (absT * absT) / df, -0.5);
  return Math.min(1, 2 * normalCdfComplement(adjustedZ));
}

/** Standard normal CDF complement: P(Z > z) */
function normalCdfComplement(z: number): number {
  // Abramowitz & Stegun approximation 26.2.17
  const p = 0.2316419;
  const b1 = 0.31938153;
  const b2 = -0.356563782;
  const b3 = 1.781477937;
  const b4 = -1.821255978;
  const b5 = 1.330274429;

  const t = 1 / (1 + p * Math.abs(z));
  const phi = Math.exp((-z * z) / 2) / Math.sqrt(2 * Math.PI);
  const cdf = phi * (b1 * t + b2 * t * t + b3 * Math.pow(t, 3) + b4 * Math.pow(t, 4) + b5 * Math.pow(t, 5));
  return z >= 0 ? cdf : 1 - cdf;
}

/**
 * Compute aggregate statistics across multiple A/B tests.
 */
function computeAggregateStats(tests: any[]) {
  const baselineScores: number[] = [];
  const testScores: number[] = [];
  const baselineLatencies: number[] = [];
  const testLatencies: number[] = [];
  const baselineCosts: number[] = [];
  const testCosts: number[] = [];
  const subScoreFields = ["compliance", "customerExperience", "communication", "resolution"];
  const baselineSubScores: Record<string, number[]> = {};
  const testSubScores: Record<string, number[]> = {};
  for (const f of subScoreFields) {
    baselineSubScores[f] = [];
    testSubScores[f] = [];
  }

  for (const test of tests) {
    const bScore = extractScore(test.baselineAnalysis);
    const tScore = extractScore(test.testAnalysis);
    // Only include tests where BOTH models produced valid scores (paired comparison)
    if (bScore !== null && tScore !== null) {
      baselineScores.push(bScore);
      testScores.push(tScore);
    }

    if (test.baselineLatencyMs) baselineLatencies.push(test.baselineLatencyMs);
    if (test.testLatencyMs) testLatencies.push(test.testLatencyMs);

    // Estimate costs (only for successful analyses)
    const wordCount = test.transcriptText ? test.transcriptText.split(/\s+/).length : 0;
    const inputTokens = Math.ceil(wordCount * 1.3) + 500;
    if (bScore !== null) baselineCosts.push(estimateBedrockCost(test.baselineModel, inputTokens, 900));
    if (tScore !== null) testCosts.push(estimateBedrockCost(test.testModel, inputTokens, 900));

    // Sub-scores
    for (const f of subScoreFields) {
      const bSub = extractSubScore(test.baselineAnalysis, f);
      const tSub = extractSubScore(test.testAnalysis, f);
      if (bSub !== null) baselineSubScores[f].push(bSub);
      if (tSub !== null) testSubScores[f].push(tSub);
    }
  }

  const avg = (arr: number[]) => (arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
  const round2 = (n: number) => Math.round(n * 100) / 100;

  const avgBaseline = avg(baselineScores);
  const avgTest = avg(testScores);
  const avgScoreDiff = round2(avgTest - avgBaseline);

  // Statistical significance via Welch's t-test
  const tTest = welchTTest(baselineScores, testScores);
  const significance = tTest
    ? {
        tStatistic: tTest.tStatistic,
        degreesOfFreedom: tTest.degreesOfFreedom,
        pValue: tTest.pValue,
        isSignificant: tTest.pValue < 0.05,
        confidenceLevel: tTest.pValue < 0.01 ? "99%" : tTest.pValue < 0.05 ? "95%" : "not significant",
      }
    : null;

  // Confidence interval for score difference (bootstrap-free, using t-distribution)
  let confidenceInterval: { lower: number; upper: number; level: string } | null = null;
  if (baselineScores.length >= 2 && testScores.length >= 2) {
    const n1 = baselineScores.length;
    const n2 = testScores.length;
    const var1 = baselineScores.reduce((sum, x) => sum + Math.pow(x - avgBaseline, 2), 0) / (n1 - 1);
    const var2 = testScores.reduce((sum, x) => sum + Math.pow(x - avgTest, 2), 0) / (n2 - 1);
    const se = Math.sqrt(var1 / n1 + var2 / n2);
    // Approximate t-critical for 95% CI using degrees of freedom from t-test.
    // For df > 30 → ~2.0, for df = 10 → ~2.23, for df = 5 → ~2.57
    const ciDf = significance?.degreesOfFreedom || Math.min(n1, n2) - 1 || 1;
    const tCrit = ciDf > 120 ? 1.96 : ciDf > 30 ? 2.0 : ciDf > 10 ? 2.23 : ciDf > 5 ? 2.57 : 3.18;
    confidenceInterval = {
      lower: round2(avgScoreDiff - tCrit * se),
      upper: round2(avgScoreDiff + tCrit * se),
      level: "95%",
    };
  }

  // Sub-score comparison
  const subScoreComparison: Record<string, { baseline: number; test: number; diff: number }> = {};
  for (const f of subScoreFields) {
    if (baselineSubScores[f].length > 0 && testSubScores[f].length > 0) {
      subScoreComparison[f] = {
        baseline: round2(avg(baselineSubScores[f])),
        test: round2(avg(testSubScores[f])),
        diff: round2(avg(testSubScores[f]) - avg(baselineSubScores[f])),
      };
    }
  }

  // Cost comparison
  const avgBaselineCost = avg(baselineCosts);
  const avgTestCost = avg(testCosts);
  const costComparison = {
    avgBaselineCost: Math.round(avgBaselineCost * 10000) / 10000,
    avgTestCost: Math.round(avgTestCost * 10000) / 10000,
    percentDiff: avgBaselineCost > 0 ? round2(((avgTestCost - avgBaselineCost) / avgBaselineCost) * 100) : 0,
  };

  // Latency comparison
  const latencyComparison = {
    avgBaselineMs: Math.round(avg(baselineLatencies)),
    avgTestMs: Math.round(avg(testLatencies)),
    percentDiff:
      avg(baselineLatencies) > 0
        ? round2(((avg(testLatencies) - avg(baselineLatencies)) / avg(baselineLatencies)) * 100)
        : 0,
  };

  return {
    testCount: tests.length,
    baselineModel: tests[0]?.baselineModel,
    testModel: tests[0]?.testModel,
    avgBaselineScore: round2(avgBaseline),
    avgTestScore: round2(avgTest),
    avgScoreDiff,
    significance,
    confidenceInterval,
    subScoreComparison,
    costComparison,
    latencyComparison,
  };
}

// --- A/B test processing pipeline ---
async function processABTest(
  orgId: string,
  testId: string,
  filePath: string,
  callCategory?: string,
  userName?: string,
) {
  logger.info({ testId }, "Starting A/B model comparison");
  try {
    const abTest = await storage.getABTest(orgId, testId);
    if (!abTest) throw new Error("A/B test record not found");

    // Read file
    const audioBuffer = await fs.promises.readFile(filePath);

    // Step 1: Upload to AssemblyAI and transcribe
    logger.info({ testId, step: "1/2" }, "Uploading to AssemblyAI");
    const audioUrl = await assemblyAIService.uploadAudioFile(audioBuffer, path.basename(filePath));
    const transcriptId = await assemblyAIService.transcribeAudio(audioUrl);
    const transcriptResponse = await assemblyAIService.pollTranscript(transcriptId);

    if (!transcriptResponse || transcriptResponse.status !== "completed") {
      throw new Error(`Transcription failed. Status: ${transcriptResponse?.status}`);
    }

    const transcriptText = transcriptResponse.text || "";
    await storage.updateABTest(orgId, testId, { transcriptText, status: "analyzing" });
    logger.info({ testId, chars: transcriptText.length }, "Transcription complete");

    // Guard: skip AI analysis for empty/noise transcripts
    if (transcriptText.trim().length < 10) {
      await storage.updateABTest(orgId, testId, {
        status: "completed",
        baselineAnalysis: { error: "Transcript too short for analysis (silence or noise detected)" },
        testAnalysis: { error: "Transcript too short for analysis (silence or noise detected)" },
      });
      await cleanupFile(filePath);
      broadcastCallUpdate(testId, "ab-test-completed", { label: "A/B test complete (empty transcript)" }, orgId);
      return;
    }

    // Load prompt template if applicable
    let promptTemplate = undefined;
    if (callCategory) {
      try {
        const tmpl = await storage.getPromptTemplateByCategory(orgId, callCategory);
        if (tmpl) {
          promptTemplate = {
            evaluationCriteria: tmpl.evaluationCriteria,
            requiredPhrases: tmpl.requiredPhrases,
            scoringWeights: tmpl.scoringWeights,
            additionalInstructions: tmpl.additionalInstructions,
          };
        }
      } catch (e) {
        logger.warn({ testId, err: e }, "Failed to load prompt template");
      }
    }

    // Step 2: Run both models in parallel
    logger.info({ testId, step: "2/2" }, "Running analysis with both models");
    const baselineProvider = BedrockProvider.createWithModel(abTest.baselineModel);
    const testProvider = BedrockProvider.createWithModel(abTest.testModel);

    const [baselineResult, testResult] = await Promise.allSettled([
      (async () => {
        const start = Date.now();
        const analysis = await baselineProvider.analyzeCallTranscript(
          transcriptText,
          `ab-baseline-${testId}`,
          callCategory,
          promptTemplate,
        );
        return { analysis, latencyMs: Date.now() - start };
      })(),
      (async () => {
        const start = Date.now();
        const analysis = await testProvider.analyzeCallTranscript(
          transcriptText,
          `ab-test-${testId}`,
          callCategory,
          promptTemplate,
        );
        return { analysis, latencyMs: Date.now() - start };
      })(),
    ]);

    const updates: Record<string, any> = { status: "completed" };

    // Helper to sanitize error messages — strip internal details, API keys, paths
    const sanitizeError = (err: any): string => {
      const raw = err?.message || "Analysis failed";
      // Strip potential API keys, file paths, and stack traces
      if (raw.includes("credentials") || raw.includes("AccessDenied") || raw.includes("UnrecognizedClient")) {
        return "Model access error — check AWS credentials and model availability in your region";
      }
      if (raw.includes("ValidationException") || raw.includes("model identifier")) {
        return "Invalid model ID — this model may not be available in your AWS region";
      }
      if (raw.length > 200) return raw.slice(0, 200) + "...";
      return raw;
    };

    if (baselineResult.status === "fulfilled") {
      updates.baselineAnalysis = baselineResult.value.analysis;
      updates.baselineLatencyMs = baselineResult.value.latencyMs;
    } else {
      updates.baselineAnalysis = { error: sanitizeError((baselineResult as PromiseRejectedResult).reason) };
    }

    if (testResult.status === "fulfilled") {
      updates.testAnalysis = testResult.value.analysis;
      updates.testLatencyMs = testResult.value.latencyMs;
    } else {
      updates.testAnalysis = { error: sanitizeError((testResult as PromiseRejectedResult).reason) };
    }

    // Determine final status
    if (baselineResult.status === "rejected" && testResult.status === "rejected") {
      updates.status = "failed";
    } else if (baselineResult.status === "rejected" || testResult.status === "rejected") {
      updates.status = "partial";
    }

    await storage.updateABTest(orgId, testId, updates);

    // Track usage/cost
    try {
      // Estimate audio duration from transcript word count (~150 words/min conversational speech)
      const wordCount = transcriptText.split(/\s+/).length;
      const audioDuration = wordCount > 0 ? Math.max(30, Math.ceil((wordCount / 150) * 60)) : 60;
      const assemblyaiCost = estimateAssemblyAICost(audioDuration);
      // Token estimation: ~1.3 tokens per word for English text, plus system prompt overhead (~500 tokens)
      const estimatedInputTokens = Math.ceil(wordCount * 1.3) + 500;
      // Output is structured JSON analysis — typically 600-1200 tokens
      const estimatedOutputTokens = 900;

      let baselineCost = 0;
      let testCost = 0;
      const services: UsageRecord["services"] = {
        assemblyai: { durationSeconds: audioDuration, estimatedCost: Math.round(assemblyaiCost * 10000) / 10000 },
      };

      if (baselineResult.status === "fulfilled") {
        baselineCost = estimateBedrockCost(abTest.baselineModel, estimatedInputTokens, estimatedOutputTokens);
        services.bedrock = {
          model: abTest.baselineModel,
          estimatedInputTokens,
          estimatedOutputTokens,
          estimatedCost: Math.round(baselineCost * 10000) / 10000,
          latencyMs: baselineResult.value.latencyMs,
        };
      }
      if (testResult.status === "fulfilled") {
        testCost = estimateBedrockCost(abTest.testModel, estimatedInputTokens, estimatedOutputTokens);
        services.bedrockSecondary = {
          model: abTest.testModel,
          estimatedInputTokens,
          estimatedOutputTokens,
          estimatedCost: Math.round(testCost * 10000) / 10000,
          latencyMs: testResult.value.latencyMs,
        };
      }

      const usageRecord: UsageRecord = {
        id: randomUUID(),
        orgId,
        callId: testId,
        type: "ab-test",
        timestamp: new Date().toISOString(),
        user: userName || "admin",
        services,
        totalEstimatedCost: Math.round((assemblyaiCost + baselineCost + testCost) * 10000) / 10000,
      };
      await storage.createUsageRecord(orgId, usageRecord);
    } catch (usageErr) {
      logger.warn({ testId, err: usageErr }, "Failed to record A/B test usage (non-blocking)");
    }

    // Track in standard usage events for quota enforcement — only count successful invocations
    trackUsage({ orgId, eventType: "transcription", quantity: 1, metadata: { callId: testId, type: "ab-test" } });
    const successfulModels = [baselineResult, testResult].filter((r) => r.status === "fulfilled").length;
    if (successfulModels > 0) {
      trackUsage({
        orgId,
        eventType: "ai_analysis",
        quantity: successfulModels,
        metadata: { callId: testId, type: "ab-test" },
      });
    }

    await cleanupFile(filePath);
    broadcastCallUpdate(testId, "ab-test-completed", { label: "A/B test complete" }, orgId);
    logger.info({ testId }, "A/B comparison complete");
  } catch (error) {
    logger.error({ testId, err: error }, "A/B test processing error");
    await storage.updateABTest(orgId, testId, { status: "failed" });
    await cleanupFile(filePath);
  }
}
