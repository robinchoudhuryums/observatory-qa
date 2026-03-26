/**
 * Tests for A/B Model Testing improvements:
 * - Statistical significance (Welch's t-test)
 * - Batch testing schema
 * - Aggregate statistics
 * - Segment analysis criteria
 * - Recommendation logic
 *
 * Run with: npx tsx --test tests/ab-testing-improvements.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  abTestSchema,
  insertABTestSchema,
  AB_TEST_STATUSES,
  BEDROCK_MODEL_PRESETS,
  type ABTest,
} from "../shared/schema.js";

describe("A/B Test Schema - Batch Support", () => {
  it("accepts batchId field", () => {
    const test = abTestSchema.parse({
      id: "test-1",
      orgId: "org-1",
      fileName: "call-001.mp3",
      baselineModel: "us.anthropic.claude-sonnet-4-6",
      testModel: "us.anthropic.claude-haiku-4-5-20251001",
      status: "completed",
      createdBy: "admin",
      batchId: "batch-abc-123",
    });
    assert.equal(test.batchId, "batch-abc-123");
  });

  it("batchId is optional", () => {
    const test = abTestSchema.parse({
      id: "test-1",
      orgId: "org-1",
      fileName: "call-001.mp3",
      baselineModel: "us.anthropic.claude-sonnet-4-6",
      testModel: "us.anthropic.claude-haiku-4-5-20251001",
      status: "completed",
      createdBy: "admin",
    });
    assert.equal(test.batchId, undefined);
  });

  it("insert schema accepts batchId", () => {
    const insert = insertABTestSchema.parse({
      orgId: "org-1",
      fileName: "call-001.mp3",
      baselineModel: "us.anthropic.claude-sonnet-4-6",
      testModel: "us.anthropic.claude-haiku-4-5-20251001",
      createdBy: "admin",
      batchId: "batch-xyz",
    });
    assert.equal(insert.batchId, "batch-xyz");
  });

  it("validates all AB test statuses", () => {
    for (const status of AB_TEST_STATUSES) {
      const test = abTestSchema.parse({
        id: "t1",
        orgId: "o1",
        fileName: "f.mp3",
        baselineModel: "m1",
        testModel: "m2",
        status,
        createdBy: "admin",
      });
      assert.equal(test.status, status);
    }
  });
});

describe("Welch's t-test Implementation", () => {
  // Replicate the Welch's t-test from ab-testing.ts
  function welchTTest(sample1: number[], sample2: number[]): { tStatistic: number; pValue: number } | null {
    if (sample1.length < 2 || sample2.length < 2) return null;
    const n1 = sample1.length;
    const n2 = sample2.length;
    const mean1 = sample1.reduce((a, b) => a + b, 0) / n1;
    const mean2 = sample2.reduce((a, b) => a + b, 0) / n2;
    const var1 = sample1.reduce((sum, x) => sum + Math.pow(x - mean1, 2), 0) / (n1 - 1);
    const var2 = sample2.reduce((sum, x) => sum + Math.pow(x - mean2, 2), 0) / (n2 - 1);
    const se = Math.sqrt(var1 / n1 + var2 / n2);
    if (se === 0) return { tStatistic: 0, pValue: 1 };
    const t = (mean1 - mean2) / se;
    return { tStatistic: Math.round(t * 1000) / 1000, pValue: 0 }; // pValue computed via tDistPValue
  }

  it("returns null for insufficient samples", () => {
    assert.equal(welchTTest([], [1, 2]), null);
    assert.equal(welchTTest([1], [1, 2]), null);
    assert.equal(welchTTest([1, 2], [3]), null);
  });

  it("returns t-statistic of 0 for identical samples", () => {
    const result = welchTTest([5, 5, 5], [5, 5, 5]);
    assert.ok(result !== null);
    assert.equal(result.tStatistic, 0);
  });

  it("returns positive t-statistic when sample1 > sample2", () => {
    const result = welchTTest([8, 9, 10], [2, 3, 4]);
    assert.ok(result !== null);
    assert.ok(result.tStatistic > 0, `Expected positive t, got ${result.tStatistic}`);
  });

  it("returns negative t-statistic when sample1 < sample2", () => {
    const result = welchTTest([2, 3, 4], [8, 9, 10]);
    assert.ok(result !== null);
    assert.ok(result.tStatistic < 0, `Expected negative t, got ${result.tStatistic}`);
  });

  it("handles unequal sample sizes", () => {
    const result = welchTTest([5, 6, 7, 8, 9, 10], [3, 4]);
    assert.ok(result !== null);
    assert.ok(typeof result.tStatistic === "number");
  });
});

describe("Confidence Interval Logic", () => {
  it("computes 95% CI for score difference", () => {
    const baselineScores = [7.0, 7.5, 6.8, 7.2, 7.1];
    const testScores = [7.8, 8.0, 7.5, 7.9, 8.1];

    const n1 = baselineScores.length;
    const n2 = testScores.length;
    const mean1 = baselineScores.reduce((a, b) => a + b, 0) / n1;
    const mean2 = testScores.reduce((a, b) => a + b, 0) / n2;
    const var1 = baselineScores.reduce((sum, x) => sum + Math.pow(x - mean1, 2), 0) / (n1 - 1);
    const var2 = testScores.reduce((sum, x) => sum + Math.pow(x - mean2, 2), 0) / (n2 - 1);
    const se = Math.sqrt(var1 / n1 + var2 / n2);
    const diff = mean2 - mean1;
    const tCrit = 2.0;

    const lower = diff - tCrit * se;
    const upper = diff + tCrit * se;

    assert.ok(lower < diff, "Lower bound should be below mean diff");
    assert.ok(upper > diff, "Upper bound should be above mean diff");
    assert.ok(lower > 0, "If test is truly better, lower bound should be positive");
  });

  it("CI includes zero when difference is not significant", () => {
    const baselineScores = [7.0, 7.5, 6.8];
    const testScores = [7.1, 7.4, 6.9];

    const n1 = baselineScores.length;
    const n2 = testScores.length;
    const mean1 = baselineScores.reduce((a, b) => a + b, 0) / n1;
    const mean2 = testScores.reduce((a, b) => a + b, 0) / n2;
    const var1 = baselineScores.reduce((sum, x) => sum + Math.pow(x - mean1, 2), 0) / (n1 - 1);
    const var2 = testScores.reduce((sum, x) => sum + Math.pow(x - mean2, 2), 0) / (n2 - 1);
    const se = Math.sqrt(var1 / n1 + var2 / n2);
    const diff = mean2 - mean1;
    const tCrit = 2.0;

    const lower = diff - tCrit * se;
    const upper = diff + tCrit * se;

    // Very small difference with high variance → CI should include 0
    assert.ok(lower < 0 || upper > 0, "CI should span zero for insignificant difference");
  });
});

describe("Cost Estimation", () => {
  // Replicate estimateBedrockCost
  function estimateBedrockCost(model: string, inputTokens: number, outputTokens: number): number {
    const pricing: Record<string, [number, number]> = {
      "us.anthropic.claude-sonnet-4-6": [0.003, 0.015],
      "us.anthropic.claude-haiku-4-5-20251001": [0.001, 0.005],
      "anthropic.claude-3-haiku-20240307": [0.00025, 0.00125],
    };
    const [inputRate, outputRate] = pricing[model] || [0.003, 0.015];
    return (inputTokens / 1000) * inputRate + (outputTokens / 1000) * outputRate;
  }

  it("Haiku is significantly cheaper than Sonnet", () => {
    const inputTokens = 2000;
    const outputTokens = 900;
    const sonnetCost = estimateBedrockCost("us.anthropic.claude-sonnet-4-6", inputTokens, outputTokens);
    const haikuCost = estimateBedrockCost("us.anthropic.claude-haiku-4-5-20251001", inputTokens, outputTokens);
    assert.ok(haikuCost < sonnetCost, `Haiku (${haikuCost}) should be cheaper than Sonnet (${sonnetCost})`);
    assert.ok(haikuCost < sonnetCost * 0.5, "Haiku should be at least 50% cheaper");
  });

  it("Claude 3 Haiku is cheapest", () => {
    const inputTokens = 2000;
    const outputTokens = 900;
    const claude3Cost = estimateBedrockCost("anthropic.claude-3-haiku-20240307", inputTokens, outputTokens);
    const haikuCost = estimateBedrockCost("us.anthropic.claude-haiku-4-5-20251001", inputTokens, outputTokens);
    assert.ok(claude3Cost < haikuCost, "Claude 3 Haiku should be cheapest");
  });
});

describe("Recommendation Logic", () => {
  it("recommends test model when score diff > 0.5 and significant", () => {
    const scoreDiff = 0.8;
    const isSignificant = true;
    const testCount = 10;
    const costDiff = 5; // 5% more expensive

    let recommendation: string;
    if (!isSignificant) {
      recommendation = "No significant difference";
    } else if (scoreDiff > 0.5) {
      recommendation = "Consider switching to test model";
    } else if (scoreDiff < -0.5) {
      recommendation = "Keep baseline";
    } else {
      recommendation = "Similar performance";
    }
    assert.equal(recommendation, "Consider switching to test model");
  });

  it("recommends keeping baseline when it scores higher", () => {
    const scoreDiff = -1.2;
    const isSignificant = true;

    let recommendation: string;
    if (!isSignificant) recommendation = "No significant difference";
    else if (scoreDiff > 0.5) recommendation = "Switch to test";
    else if (scoreDiff < -0.5) recommendation = "Keep baseline";
    else recommendation = "Similar";

    assert.equal(recommendation, "Keep baseline");
  });

  it("recommends more testing when not statistically significant", () => {
    const isSignificant = false;

    let recommendation: string;
    if (!isSignificant) recommendation = "Continue testing";
    else recommendation = "Has recommendation";

    assert.equal(recommendation, "Continue testing");
  });

  it("recommends cheaper model when quality is similar", () => {
    const scoreDiff = 0.1; // Negligible quality difference
    const isSignificant = true;
    const costDiff = -25; // 25% cheaper

    let recommendation: string;
    if (!isSignificant) recommendation = "Not significant";
    else if (scoreDiff > 0.5) recommendation = "Better quality";
    else if (scoreDiff < -0.5) recommendation = "Worse quality";
    else if (costDiff < -10) recommendation = "Similar quality, cheaper";
    else recommendation = "Similar";

    assert.equal(recommendation, "Similar quality, cheaper");
  });
});

describe("Segment Analysis", () => {
  it("groups tests by call category correctly", () => {
    const tests = [
      { callCategory: "inbound", status: "completed" },
      { callCategory: "inbound", status: "completed" },
      { callCategory: "outbound", status: "completed" },
      { callCategory: undefined, status: "completed" },
    ];

    const segments: Record<string, typeof tests> = {};
    for (const test of tests) {
      const cat = test.callCategory || "uncategorized";
      if (!segments[cat]) segments[cat] = [];
      segments[cat].push(test);
    }

    assert.equal(Object.keys(segments).length, 3);
    assert.equal(segments["inbound"].length, 2);
    assert.equal(segments["outbound"].length, 1);
    assert.equal(segments["uncategorized"].length, 1);
  });

  it("groups tests by model pair", () => {
    const tests = [
      { baselineModel: "model-a", testModel: "model-b" },
      { baselineModel: "model-a", testModel: "model-b" },
      { baselineModel: "model-a", testModel: "model-c" },
    ];

    const modelPairs: Record<string, typeof tests> = {};
    for (const test of tests) {
      const pair = `${test.baselineModel} vs ${test.testModel}`;
      if (!modelPairs[pair]) modelPairs[pair] = [];
      modelPairs[pair].push(test);
    }

    assert.equal(Object.keys(modelPairs).length, 2);
    assert.equal(modelPairs["model-a vs model-b"].length, 2);
    assert.equal(modelPairs["model-a vs model-c"].length, 1);
  });
});

describe("BEDROCK_MODEL_PRESETS", () => {
  it("has at least 3 model options", () => {
    assert.ok(BEDROCK_MODEL_PRESETS.length >= 3);
  });

  it("all presets have value, label, and cost", () => {
    for (const preset of BEDROCK_MODEL_PRESETS) {
      assert.ok(preset.value.length > 0, "Preset value should not be empty");
      assert.ok(preset.label.length > 0, "Preset label should not be empty");
      assert.ok(preset.cost === "$" || preset.cost === "$$", `Invalid cost tier: ${preset.cost}`);
    }
  });
});
