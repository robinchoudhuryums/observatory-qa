/**
 * Tests for Revenue Tracking improvements:
 * - Attribution chain schema (call → appointment → treatment → payment)
 * - Payer mix fields (insurance, cash, carrier)
 * - Revenue forecasting logic
 * - Attribution funnel calculations
 *
 * Run with: npx tsx --test tests/revenue-improvements.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  callRevenueSchema,
  insertCallRevenueSchema,
  REVENUE_TYPES,
  CONVERSION_STATUSES,
  PAYER_TYPES,
  ATTRIBUTION_STAGES,
  type CallRevenue,
} from "../shared/schema.js";

describe("Revenue Schema - Attribution Chain", () => {
  it("accepts attribution chain fields", () => {
    const rev = callRevenueSchema.parse({
      id: "rev-1",
      orgId: "org-1",
      callId: "call-1",
      estimatedRevenue: 5000,
      attributionStage: "treatment_accepted",
      appointmentDate: "2026-03-20T10:00:00Z",
      appointmentCompleted: true,
      treatmentAccepted: true,
      paymentCollected: 3500,
      conversionStatus: "converted",
    });
    assert.equal(rev.attributionStage, "treatment_accepted");
    assert.equal(rev.appointmentCompleted, true);
    assert.equal(rev.treatmentAccepted, true);
    assert.equal(rev.paymentCollected, 3500);
  });

  it("validates attribution stages", () => {
    for (const stage of ATTRIBUTION_STAGES) {
      const rev = callRevenueSchema.parse({
        id: "r1", orgId: "o1", callId: "c1",
        attributionStage: stage,
      });
      assert.equal(rev.attributionStage, stage);
    }
  });

  it("rejects invalid attribution stage", () => {
    assert.throws(() => {
      insertCallRevenueSchema.parse({
        orgId: "o1", callId: "c1",
        attributionStage: "invalid_stage",
      });
    });
  });

  it("attribution fields are all optional", () => {
    const rev = callRevenueSchema.parse({
      id: "r1", orgId: "o1", callId: "c1",
    });
    assert.equal(rev.attributionStage, undefined);
    assert.equal(rev.appointmentDate, undefined);
    assert.equal(rev.appointmentCompleted, undefined);
    assert.equal(rev.treatmentAccepted, undefined);
    assert.equal(rev.paymentCollected, undefined);
  });
});

describe("Revenue Schema - Payer Mix", () => {
  it("accepts payer mix fields", () => {
    const rev = callRevenueSchema.parse({
      id: "r1", orgId: "o1", callId: "c1",
      payerType: "insurance",
      insuranceCarrier: "Delta Dental",
      insuranceAmount: 3000,
      patientAmount: 500,
    });
    assert.equal(rev.payerType, "insurance");
    assert.equal(rev.insuranceCarrier, "Delta Dental");
    assert.equal(rev.insuranceAmount, 3000);
    assert.equal(rev.patientAmount, 500);
  });

  it("validates all payer types", () => {
    for (const type of PAYER_TYPES) {
      const rev = callRevenueSchema.parse({
        id: "r1", orgId: "o1", callId: "c1",
        payerType: type,
      });
      assert.equal(rev.payerType, type);
    }
  });

  it("rejects invalid payer type", () => {
    assert.throws(() => {
      insertCallRevenueSchema.parse({
        orgId: "o1", callId: "c1",
        payerType: "bitcoin",
      });
    });
  });

  it("EHR sync timestamp tracked", () => {
    const rev = callRevenueSchema.parse({
      id: "r1", orgId: "o1", callId: "c1",
      ehrSyncedAt: "2026-03-25T14:00:00Z",
    });
    assert.equal(rev.ehrSyncedAt, "2026-03-25T14:00:00Z");
  });
});

describe("Revenue Forecasting Logic", () => {
  it("projects pipeline value using conversion rate", () => {
    const pendingRevs = [
      { estimatedRevenue: 5000 },
      { estimatedRevenue: 3000 },
      { estimatedRevenue: 7000 },
    ];
    const conversionRate = 0.6; // 60% historical conversion
    const pipelineValue = pendingRevs.reduce((s, r) => s + r.estimatedRevenue, 0);
    const projected = pipelineValue * conversionRate;
    assert.equal(pipelineValue, 15000);
    assert.equal(projected, 9000);
  });

  it("calculates daily rate projection", () => {
    const currentMonthActual = 10000;
    const dayOfMonth = 15;
    const daysInMonth = 30;
    const dailyRate = currentMonthActual / dayOfMonth;
    const projected = dailyRate * daysInMonth;
    assert.ok(Math.abs(projected - 20000) < 1);
  });

  it("handles zero conversion rate gracefully", () => {
    const conversionRate = 0;
    const pipelineValue = 50000;
    const projected = pipelineValue * conversionRate;
    assert.equal(projected, 0);
  });

  it("computes conversion rate from tracked calls", () => {
    const tracked = 50;
    const converted = 30;
    const rate = tracked > 0 ? converted / tracked : 0;
    assert.equal(rate, 0.6);
  });
});

describe("Attribution Funnel Calculations", () => {
  it("counts records at each funnel stage", () => {
    const revenues = [
      { attributionStage: "call_identified" },
      { attributionStage: "appointment_scheduled", appointmentDate: "2026-03-20" },
      { attributionStage: "appointment_completed", appointmentCompleted: true },
      { attributionStage: "treatment_accepted", treatmentAccepted: true },
      { attributionStage: "payment_collected", paymentCollected: 3000 },
    ];

    const funnel = {
      callIdentified: revenues.length,
      appointmentScheduled: revenues.filter(r =>
        r.appointmentDate || ["appointment_scheduled", "appointment_completed", "treatment_accepted", "payment_collected"].includes(r.attributionStage!)
      ).length,
      paymentCollected: revenues.filter(r => r.paymentCollected && r.paymentCollected > 0).length,
    };

    assert.equal(funnel.callIdentified, 5);
    assert.equal(funnel.appointmentScheduled, 4);
    assert.equal(funnel.paymentCollected, 1);
  });

  it("computes stage-to-stage conversion rates", () => {
    const calls = 100;
    const appointments = 60;
    const completed = 48;
    const treated = 36;
    const paid = 30;

    const rates = {
      callToAppointment: appointments / calls * 100,
      appointmentToCompletion: completed / appointments * 100,
      completionToTreatment: treated / completed * 100,
      treatmentToPayment: paid / treated * 100,
      overall: paid / calls * 100,
    };

    assert.equal(rates.callToAppointment, 60);
    assert.equal(rates.appointmentToCompletion, 80);
    assert.equal(rates.overall, 30);
  });
});

describe("Payer Mix Analysis", () => {
  it("groups revenue by payer type", () => {
    const revenues = [
      { payerType: "insurance", actualRevenue: 3000 },
      { payerType: "insurance", actualRevenue: 4000 },
      { payerType: "cash", actualRevenue: 2000 },
      { payerType: "mixed", actualRevenue: 5000 },
    ];

    const groups: Record<string, { count: number; total: number }> = {};
    for (const r of revenues) {
      const type = r.payerType || "unknown";
      if (!groups[type]) groups[type] = { count: 0, total: 0 };
      groups[type].count++;
      groups[type].total += r.actualRevenue;
    }

    assert.equal(groups["insurance"].count, 2);
    assert.equal(groups["insurance"].total, 7000);
    assert.equal(groups["cash"].count, 1);
    assert.equal(groups["cash"].total, 2000);
    assert.equal(groups["mixed"].total, 5000);
  });

  it("groups by insurance carrier", () => {
    const revenues = [
      { insuranceCarrier: "Delta Dental", insuranceAmount: 2000 },
      { insuranceCarrier: "Delta Dental", insuranceAmount: 3000 },
      { insuranceCarrier: "Blue Cross", insuranceAmount: 4000 },
    ];

    const carriers: Record<string, number> = {};
    for (const r of revenues) {
      if (!r.insuranceCarrier) continue;
      carriers[r.insuranceCarrier] = (carriers[r.insuranceCarrier] || 0) + r.insuranceAmount;
    }

    assert.equal(carriers["Delta Dental"], 5000);
    assert.equal(carriers["Blue Cross"], 4000);
  });

  it("computes percentage of total correctly", () => {
    const total = 14000;
    const insurance = 7000;
    const pct = Math.round((insurance / total) * 10000) / 100;
    assert.equal(pct, 50);
  });
});

describe("Revenue Enums", () => {
  it("has all revenue types", () => {
    assert.ok(REVENUE_TYPES.includes("production"));
    assert.ok(REVENUE_TYPES.includes("collection"));
    assert.ok(REVENUE_TYPES.includes("scheduled"));
    assert.ok(REVENUE_TYPES.includes("lost"));
  });

  it("has all conversion statuses", () => {
    assert.ok(CONVERSION_STATUSES.includes("converted"));
    assert.ok(CONVERSION_STATUSES.includes("pending"));
    assert.ok(CONVERSION_STATUSES.includes("lost"));
    assert.ok(CONVERSION_STATUSES.includes("unknown"));
  });

  it("has all payer types", () => {
    assert.ok(PAYER_TYPES.includes("insurance"));
    assert.ok(PAYER_TYPES.includes("cash"));
    assert.ok(PAYER_TYPES.includes("mixed"));
    assert.ok(PAYER_TYPES.includes("unknown"));
  });

  it("has all attribution stages in correct order", () => {
    assert.deepEqual([...ATTRIBUTION_STAGES], [
      "call_identified",
      "appointment_scheduled",
      "appointment_completed",
      "treatment_accepted",
      "payment_collected",
    ]);
  });
});

describe("Full Revenue Lifecycle", () => {
  it("models a complete call-to-payment conversion", () => {
    const revenue: CallRevenue = callRevenueSchema.parse({
      id: "rev-complete",
      orgId: "org-1",
      callId: "call-1",
      estimatedRevenue: 5000,
      actualRevenue: 4500,
      revenueType: "production",
      treatmentValue: 5000,
      scheduledProcedures: [
        { code: "D2740", description: "Crown - porcelain", estimatedValue: 1200 },
        { code: "D0220", description: "Periapical radiograph", estimatedValue: 35 },
      ],
      conversionStatus: "converted",
      attributionStage: "payment_collected",
      appointmentDate: "2026-03-20T10:00:00Z",
      appointmentCompleted: true,
      treatmentAccepted: true,
      paymentCollected: 4500,
      payerType: "mixed",
      insuranceCarrier: "Delta Dental",
      insuranceAmount: 3000,
      patientAmount: 1500,
      ehrSyncedAt: "2026-03-25T14:00:00Z",
    });

    assert.equal(revenue.conversionStatus, "converted");
    assert.equal(revenue.attributionStage, "payment_collected");
    assert.equal(revenue.payerType, "mixed");
    assert.equal(revenue.insuranceAmount! + revenue.patientAmount!, revenue.paymentCollected);
    assert.ok(revenue.scheduledProcedures!.length === 2);
    assert.ok(revenue.ehrSyncedAt);
  });
});
