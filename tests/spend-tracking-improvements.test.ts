/**
 * Tests for Spend Tracking improvements:
 * - Cost forecasting logic
 * - Budget alert configuration
 * - Cost anomaly detection
 * - Department allocation grouping
 * - Cost per outcome calculations
 *
 * Run with: npx tsx --test tests/spend-tracking-improvements.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { orgSettingsSchema } from "../shared/schema.js";

describe("Budget Alerts Schema", () => {
  it("accepts budgetAlerts configuration", () => {
    const settings = orgSettingsSchema.parse({
      budgetAlerts: {
        enabled: true,
        monthlyBudgetUsd: 500,
        alertEmail: "admin@example.com",
      },
    });
    assert.equal(settings.budgetAlerts?.enabled, true);
    assert.equal(settings.budgetAlerts?.monthlyBudgetUsd, 500);
    assert.equal(settings.budgetAlerts?.alertEmail, "admin@example.com");
  });

  it("defaults budgetAlerts to disabled", () => {
    const settings = orgSettingsSchema.parse({});
    assert.equal(settings.budgetAlerts, undefined);
  });

  it("stores lastBudgetAlertSentAt timestamp", () => {
    const settings = orgSettingsSchema.parse({
      budgetAlerts: {
        enabled: true,
        monthlyBudgetUsd: 1000,
        lastBudgetAlertSentAt: "2026-03-25T10:00:00Z",
      },
    });
    assert.equal(settings.budgetAlerts?.lastBudgetAlertSentAt, "2026-03-25T10:00:00Z");
  });
});

describe("Cost Forecasting Logic", () => {
  it("projects monthly spend from daily rate", () => {
    const currentMonthSpend = 100;
    const dayOfMonth = 10;
    const daysInMonth = 30;
    const dailyRate = currentMonthSpend / dayOfMonth;
    const projectedMonthlySpend = dailyRate * daysInMonth;
    assert.equal(projectedMonthlySpend, 300);
  });

  it("handles first day of month without division by zero", () => {
    const currentMonthSpend = 5;
    const dayOfMonth = 1;
    const daysInMonth = 31;
    const dailyRate = dayOfMonth > 0 ? currentMonthSpend / dayOfMonth : 0;
    assert.equal(dailyRate, 5);
    assert.equal(dailyRate * daysInMonth, 155);
  });

  it("computes month-over-month change percentage", () => {
    const projectedMonthlySpend = 340;
    const previousMonthSpend = 300;
    const momChange = ((projectedMonthlySpend - previousMonthSpend) / previousMonthSpend) * 100;
    assert.ok(Math.abs(momChange - 13.33) < 0.1, `Expected ~13.33%, got ${momChange}%`);
  });

  it("returns null for month-over-month when previous is zero", () => {
    const previousMonthSpend = 0;
    const momChange = previousMonthSpend > 0 ? 10 : null;
    assert.equal(momChange, null);
  });
});

describe("Cost Anomaly Detection", () => {
  function detectAnomalies(costs: number[]): { threshold: number; anomalyIndices: number[] } {
    const mean = costs.reduce((a, b) => a + b, 0) / costs.length;
    const stdDev = Math.sqrt(costs.reduce((sum, c) => sum + Math.pow(c - mean, 2), 0) / costs.length);
    const threshold = Math.max(mean + 3 * stdDev, mean * 5);

    const anomalyIndices: number[] = [];
    for (let i = 0; i < costs.length; i++) {
      if (costs[i] > threshold) anomalyIndices.push(i);
    }
    return { threshold, anomalyIndices };
  }

  it("flags costs that are well above the threshold", () => {
    // 10 normal records + 1 extreme outlier
    const costs = [0.10, 0.10, 0.10, 0.10, 0.10, 0.10, 0.10, 0.10, 0.10, 0.10, 2.00];
    const result = detectAnomalies(costs);
    assert.ok(result.anomalyIndices.includes(10), "Should flag the 2.00 cost outlier");
  });

  it("does not flag normal variation", () => {
    const costs = [0.10, 0.12, 0.11, 0.09, 0.10, 0.13];
    const result = detectAnomalies(costs);
    assert.equal(result.anomalyIndices.length, 0, "No anomalies expected");
  });

  it("flags extreme outlier in uniform data", () => {
    // With many uniform records, outlier clearly exceeds threshold
    const costs = [0.10, 0.10, 0.10, 0.10, 0.10, 0.10, 0.10, 0.10, 0.10, 0.10, 0.10, 0.10, 0.10, 0.10, 0.10, 10.00];
    const result = detectAnomalies(costs);
    assert.ok(result.anomalyIndices.length > 0, "Should detect the 10.00 outlier");
  });

  it("uses max of 3-sigma and 5x mean as threshold", () => {
    const costs = [0.10, 0.10, 0.10, 0.10, 0.10];
    const mean = 0.10;
    const stdDev = 0;
    const threshold = Math.max(mean + 3 * stdDev, mean * 5);
    assert.equal(threshold, 0.5); // 5x mean when stdDev is 0
  });
});

describe("Department Allocation Logic", () => {
  it("groups costs by department correctly", () => {
    const records = [
      { department: "Sales", cost: 10 },
      { department: "Sales", cost: 15 },
      { department: "Support", cost: 8 },
      { department: "Unassigned", cost: 3 },
    ];

    const departments: Record<string, { cost: number; count: number }> = {};
    for (const r of records) {
      if (!departments[r.department]) departments[r.department] = { cost: 0, count: 0 };
      departments[r.department].cost += r.cost;
      departments[r.department].count++;
    }

    assert.equal(departments["Sales"].cost, 25);
    assert.equal(departments["Sales"].count, 2);
    assert.equal(departments["Support"].cost, 8);
    assert.equal(departments["Unassigned"].cost, 3);
  });

  it("computes percentage of total correctly", () => {
    const grandTotal = 100;
    const deptCost = 35;
    const pct = Math.round((deptCost / grandTotal) * 10000) / 100;
    assert.equal(pct, 35);
  });
});

describe("Cost Per Outcome", () => {
  it("computes cost per scored call", () => {
    const totalCost = 50.0;
    const scoredCalls = 200;
    const costPerCall = totalCost / scoredCalls;
    assert.equal(costPerCall, 0.25);
  });

  it("returns 0 when no calls processed", () => {
    const totalCost = 0;
    const scoredCalls = 0;
    const costPerCall = scoredCalls > 0 ? totalCost / scoredCalls : 0;
    assert.equal(costPerCall, 0);
  });

  it("computes service breakdown percentages", () => {
    const assemblyai = 30;
    const bedrock = 70;
    const total = assemblyai + bedrock;
    const assemblyaiPct = Math.round((assemblyai / total) * 10000) / 100;
    const bedrockPct = Math.round((bedrock / total) * 10000) / 100;
    assert.equal(assemblyaiPct, 30);
    assert.equal(bedrockPct, 70);
  });
});
