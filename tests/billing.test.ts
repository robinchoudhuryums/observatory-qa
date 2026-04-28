/**
 * Tests for billing schemas, plan definitions, and quota logic.
 * Run with: npx tsx --test tests/billing.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  subscriptionSchema,
  insertSubscriptionSchema,
  planLimitsSchema,
  PLAN_DEFINITIONS,
  PLAN_TIERS,
  type PlanTier,
} from "../shared/schema.js";

describe("PLAN_DEFINITIONS", () => {
  it("has entries for all plan tiers", () => {
    for (const tier of PLAN_TIERS) {
      assert.ok(PLAN_DEFINITIONS[tier], `Missing definition for tier: ${tier}`);
    }
  });

  it("free plan has $0 pricing", () => {
    assert.strictEqual(PLAN_DEFINITIONS.free.monthlyPriceUsd, 0);
    assert.strictEqual(PLAN_DEFINITIONS.free.yearlyPriceUsd, 0);
  });

  it("starter plan costs more than free", () => {
    assert.ok(PLAN_DEFINITIONS.starter.monthlyPriceUsd > 0);
    assert.ok(PLAN_DEFINITIONS.starter.yearlyPriceUsd > 0);
  });

  it("enterprise plan costs more than professional", () => {
    assert.ok(PLAN_DEFINITIONS.enterprise.monthlyPriceUsd > PLAN_DEFINITIONS.professional.monthlyPriceUsd);
  });

  it("yearly pricing offers a discount over monthly", () => {
    const starterMonthlyAnnual = PLAN_DEFINITIONS.starter.monthlyPriceUsd * 12;
    assert.ok(PLAN_DEFINITIONS.starter.yearlyPriceUsd < starterMonthlyAnnual);

    const entMonthlyAnnual = PLAN_DEFINITIONS.enterprise.monthlyPriceUsd * 12;
    assert.ok(PLAN_DEFINITIONS.enterprise.yearlyPriceUsd < entMonthlyAnnual);
  });

  it("enterprise plan has high call cap with overage pricing", () => {
    assert.ok(PLAN_DEFINITIONS.enterprise.limits.callsPerMonth >= 5000, "Enterprise should have at least 5000 calls/mo");
    assert.ok(PLAN_DEFINITIONS.enterprise.limits.overagePricePerCallUsd > 0, "Enterprise should have overage pricing");
  });

  it("free plan has limited calls", () => {
    assert.ok(PLAN_DEFINITIONS.free.limits.callsPerMonth > 0);
    assert.ok(PLAN_DEFINITIONS.free.limits.callsPerMonth < 100);
  });

  it("starter plan has more limits than free", () => {
    assert.ok(PLAN_DEFINITIONS.starter.limits.callsPerMonth > PLAN_DEFINITIONS.free.limits.callsPerMonth);
    assert.ok(PLAN_DEFINITIONS.starter.limits.maxUsers > PLAN_DEFINITIONS.free.limits.maxUsers);
    assert.ok(PLAN_DEFINITIONS.starter.limits.storageMb > PLAN_DEFINITIONS.free.limits.storageMb);
  });

  it("enterprise has SSO enabled, free does not", () => {
    assert.strictEqual(PLAN_DEFINITIONS.enterprise.limits.ssoEnabled, true);
    assert.strictEqual(PLAN_DEFINITIONS.free.limits.ssoEnabled, false);
  });

  it("each plan has all required limit fields", () => {
    const requiredFields = [
      "callsPerMonth", "storageMb", "aiAnalysesPerMonth",
      "apiCallsPerMonth", "maxUsers", "customPromptTemplates",
      "ssoEnabled", "prioritySupport",
    ];
    for (const tier of PLAN_TIERS) {
      const limits = PLAN_DEFINITIONS[tier].limits;
      for (const field of requiredFields) {
        assert.ok(
          field in limits,
          `Plan ${tier} missing limit field: ${field}`,
        );
      }
    }
  });
});

describe("planLimitsSchema", () => {
  it("validates correct limits object", () => {
    const result = planLimitsSchema.safeParse({
      callsPerMonth: 100,
      storageMb: 500,
      aiAnalysesPerMonth: 100,
      apiCallsPerMonth: 1000,
      maxUsers: 5,
      customPromptTemplates: false,
      ragEnabled: false,
      ssoEnabled: false,
      prioritySupport: false,
      baseSeats: 3,
      pricePerAdditionalSeatUsd: 12,
      overagePricePerCallUsd: 0,
    });
    assert.ok(result.success);
  });

  it("validates unlimited (-1) values", () => {
    const result = planLimitsSchema.safeParse({
      callsPerMonth: -1,
      storageMb: -1,
      aiAnalysesPerMonth: -1,
      apiCallsPerMonth: -1,
      maxUsers: -1,
      customPromptTemplates: true,
      ragEnabled: true,
      ssoEnabled: true,
      prioritySupport: true,
      baseSeats: 25,
      pricePerAdditionalSeatUsd: 25,
      overagePricePerCallUsd: 0.50,
    });
    assert.ok(result.success);
  });

  it("rejects missing required fields", () => {
    const result = planLimitsSchema.safeParse({ callsPerMonth: 100 });
    assert.ok(!result.success);
  });
});

describe("subscriptionSchema", () => {
  it("validates a full subscription record", () => {
    const result = subscriptionSchema.safeParse({
      id: "sub-123",
      orgId: "org-456",
      planTier: "starter",
      status: "active",
      stripeCustomerId: "cus_abc",
      stripeSubscriptionId: "sub_def",
      billingInterval: "monthly",
      currentPeriodStart: "2026-03-01T00:00:00Z",
      currentPeriodEnd: "2026-04-01T00:00:00Z",
      cancelAtPeriodEnd: false,
    });
    assert.ok(result.success);
    assert.strictEqual(result.data.planTier, "starter");
  });

  it("validates all plan tiers", () => {
    for (const tier of PLAN_TIERS) {
      const result = subscriptionSchema.safeParse({
        id: "sub-1",
        orgId: "org-1",
        planTier: tier,
        status: "active",
      });
      assert.ok(result.success, `Tier ${tier} should be valid`);
    }
  });

  it("validates all status values", () => {
    const statuses = ["active", "past_due", "canceled", "trialing", "incomplete"];
    for (const status of statuses) {
      const result = subscriptionSchema.safeParse({
        id: "sub-1",
        orgId: "org-1",
        planTier: "free",
        status,
      });
      assert.ok(result.success, `Status ${status} should be valid`);
    }
  });

  it("rejects invalid plan tier", () => {
    const result = subscriptionSchema.safeParse({
      id: "sub-1",
      orgId: "org-1",
      planTier: "ultra",
      status: "active",
    });
    assert.ok(!result.success);
  });

  it("rejects invalid status", () => {
    const result = subscriptionSchema.safeParse({
      id: "sub-1",
      orgId: "org-1",
      planTier: "free",
      status: "expired",
    });
    assert.ok(!result.success);
  });

  it("defaults billingInterval to monthly", () => {
    const result = subscriptionSchema.safeParse({
      id: "sub-1",
      orgId: "org-1",
      planTier: "starter",
      status: "active",
    });
    assert.ok(result.success);
    assert.strictEqual(result.data.billingInterval, "monthly");
  });

  it("defaults cancelAtPeriodEnd to false", () => {
    const result = subscriptionSchema.safeParse({
      id: "sub-1",
      orgId: "org-1",
      planTier: "starter",
      status: "active",
    });
    assert.ok(result.success);
    assert.strictEqual(result.data.cancelAtPeriodEnd, false);
  });
});

describe("insertSubscriptionSchema", () => {
  it("does not require id, createdAt, updatedAt", () => {
    const result = insertSubscriptionSchema.safeParse({
      orgId: "org-1",
      planTier: "professional",
      status: "active",
      billingInterval: "yearly",
    });
    assert.ok(result.success);
  });
});

describe("Professional plan", () => {
  it("professional plan tier exists in PLAN_TIERS", () => {
    assert.ok(PLAN_TIERS.includes("professional"));
  });

  it("professional plan has clinical documentation enabled", () => {
    assert.strictEqual(PLAN_DEFINITIONS.professional.limits.clinicalDocumentationEnabled, true);
  });

  it("professional plan has RAG enabled", () => {
    assert.strictEqual(PLAN_DEFINITIONS.professional.limits.ragEnabled, true);
  });

  it("professional plan has reasonable pricing", () => {
    assert.ok(PLAN_DEFINITIONS.professional.monthlyPriceUsd > 0);
    assert.ok(PLAN_DEFINITIONS.professional.yearlyPriceUsd < PLAN_DEFINITIONS.professional.monthlyPriceUsd * 12);
  });

  it("non-clinical paid plans do NOT have clinical documentation", () => {
    assert.strictEqual(PLAN_DEFINITIONS.free.limits.clinicalDocumentationEnabled, false);
    assert.strictEqual(PLAN_DEFINITIONS.starter.limits.clinicalDocumentationEnabled, false);
  });

  it("professional plan subscription validates correctly", () => {
    const result = subscriptionSchema.safeParse({
      id: "sub-professional",
      orgId: "org-1",
      planTier: "professional",
      status: "active",
      billingInterval: "monthly",
    });
    assert.ok(result.success);
    assert.strictEqual(result.data.planTier, "professional");
  });
});

describe("Plan limit semantics (production PLAN_DEFINITIONS)", () => {
  it("free plan has a finite, non-zero call cap (so quota enforcement triggers)", () => {
    const limit = PLAN_DEFINITIONS.free.limits.callsPerMonth;
    assert.ok(limit > 0, "free should allow some calls");
    assert.ok(limit !== -1, "free must NOT be unlimited");
  });

  it("enterprise plan has a high or unlimited (-1) call cap", () => {
    const limit = PLAN_DEFINITIONS.enterprise.limits.callsPerMonth;
    // Enterprise uses overage pricing rather than a hard cap; either large or unlimited is acceptable.
    assert.ok(limit === -1 || limit >= 5000);
  });

  it("paid plans have a higher call cap than free", () => {
    const free = PLAN_DEFINITIONS.free.limits.callsPerMonth;
    for (const tier of ["starter", "professional", "enterprise"] as PlanTier[]) {
      const limit = PLAN_DEFINITIONS[tier].limits.callsPerMonth;
      const isHigher = limit === -1 || limit > free;
      assert.ok(isHigher, `${tier} should allow more calls than free`);
    }
  });
});

describe("Price ID resolution (production getPriceId)", () => {
  it("returns null for free tier on both intervals", async () => {
    const { getPriceId } = await import("../server/services/stripe.js");
    assert.strictEqual(getPriceId("free", "monthly"), null);
    assert.strictEqual(getPriceId("free", "yearly"), null);
  });

  it("looks up the env-var slot for the requested tier+interval", async () => {
    const { getPriceId } = await import("../server/services/stripe.js");
    const SENTINEL = "price_test_sentinel_starter_monthly";
    const prev = process.env.STRIPE_PRICE_STARTER_MONTHLY;
    process.env.STRIPE_PRICE_STARTER_MONTHLY = SENTINEL;
    try {
      assert.strictEqual(getPriceId("starter", "monthly"), SENTINEL);
      // Different interval must NOT pick up the monthly env slot
      assert.notStrictEqual(getPriceId("starter", "yearly"), SENTINEL);
    } finally {
      if (prev === undefined) delete process.env.STRIPE_PRICE_STARTER_MONTHLY;
      else process.env.STRIPE_PRICE_STARTER_MONTHLY = prev;
    }
  });

  it("returns null when the env slot is unset", async () => {
    const { getPriceId } = await import("../server/services/stripe.js");
    const prev = process.env.STRIPE_PRICE_PROFESSIONAL_YEARLY;
    delete process.env.STRIPE_PRICE_PROFESSIONAL_YEARLY;
    try {
      assert.strictEqual(getPriceId("professional", "yearly"), null);
    } finally {
      if (prev !== undefined) process.env.STRIPE_PRICE_PROFESSIONAL_YEARLY = prev;
    }
  });
});
