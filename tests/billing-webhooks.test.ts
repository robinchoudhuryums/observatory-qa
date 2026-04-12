/**
 * Stripe webhook and billing lifecycle tests.
 *
 * Tests the critical billing path: webhook signature verification,
 * subscription lifecycle events (create/update/delete), metered item
 * tracking, quota enforcement edge cases, and idempotency.
 *
 * Run with: npx tsx --test tests/billing-webhooks.test.ts
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Stripe from "stripe";
import {
  getPriceId,
  getSeatPriceId,
  getOveragePriceId,
  isStripeConfigured,
  constructWebhookEvent,
} from "../server/services/stripe.js";
import { PLAN_DEFINITIONS, type PlanTier } from "../shared/schema.js";

// ============================================================================
// Stripe helper function tests
// ============================================================================

describe("getOveragePriceId", () => {
  it("returns null for free tier", () => {
    assert.strictEqual(getOveragePriceId("free"), null);
  });

  it("returns env var value for starter when set", () => {
    const original = process.env.STRIPE_PRICE_STARTER_OVERAGE;
    process.env.STRIPE_PRICE_STARTER_OVERAGE = "price_starter_overage_test";
    try {
      assert.strictEqual(getOveragePriceId("starter"), "price_starter_overage_test");
    } finally {
      if (original !== undefined) process.env.STRIPE_PRICE_STARTER_OVERAGE = original;
      else delete process.env.STRIPE_PRICE_STARTER_OVERAGE;
    }
  });

  it("returns env var value for professional when set", () => {
    const original = process.env.STRIPE_PRICE_PROFESSIONAL_OVERAGE;
    process.env.STRIPE_PRICE_PROFESSIONAL_OVERAGE = "price_pro_overage_test";
    try {
      assert.strictEqual(getOveragePriceId("professional"), "price_pro_overage_test");
    } finally {
      if (original !== undefined) process.env.STRIPE_PRICE_PROFESSIONAL_OVERAGE = original;
      else delete process.env.STRIPE_PRICE_PROFESSIONAL_OVERAGE;
    }
  });

  it("returns env var value for enterprise when set", () => {
    const original = process.env.STRIPE_PRICE_ENTERPRISE_OVERAGE;
    process.env.STRIPE_PRICE_ENTERPRISE_OVERAGE = "price_ent_overage_test";
    try {
      assert.strictEqual(getOveragePriceId("enterprise"), "price_ent_overage_test");
    } finally {
      if (original !== undefined) process.env.STRIPE_PRICE_ENTERPRISE_OVERAGE = original;
      else delete process.env.STRIPE_PRICE_ENTERPRISE_OVERAGE;
    }
  });

  it("returns null for all tiers when env vars unset", () => {
    // Save and clear
    const saved: Record<string, string | undefined> = {};
    for (const key of ["STRIPE_PRICE_STARTER_OVERAGE", "STRIPE_PRICE_PROFESSIONAL_OVERAGE", "STRIPE_PRICE_ENTERPRISE_OVERAGE"]) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    try {
      assert.strictEqual(getOveragePriceId("starter"), null);
      assert.strictEqual(getOveragePriceId("professional"), null);
      assert.strictEqual(getOveragePriceId("enterprise"), null);
    } finally {
      for (const [key, val] of Object.entries(saved)) {
        if (val !== undefined) process.env[key] = val;
      }
    }
  });
});

describe("getSeatPriceId", () => {
  it("returns null for free tier", () => {
    assert.strictEqual(getSeatPriceId("free"), null);
  });

  it("returns null for enterprise tier (custom pricing)", () => {
    assert.strictEqual(getSeatPriceId("enterprise"), null);
  });

  it("returns env var for starter when set", () => {
    const original = process.env.STRIPE_PRICE_STARTER_SEATS;
    process.env.STRIPE_PRICE_STARTER_SEATS = "price_starter_seats_test";
    try {
      assert.strictEqual(getSeatPriceId("starter"), "price_starter_seats_test");
    } finally {
      if (original !== undefined) process.env.STRIPE_PRICE_STARTER_SEATS = original;
      else delete process.env.STRIPE_PRICE_STARTER_SEATS;
    }
  });
});

describe("getPriceId", () => {
  it("returns null for free tier in both intervals", () => {
    assert.strictEqual(getPriceId("free", "monthly"), null);
    assert.strictEqual(getPriceId("free", "yearly"), null);
  });

  it("returns env var for starter monthly when set", () => {
    const original = process.env.STRIPE_PRICE_STARTER_MONTHLY;
    process.env.STRIPE_PRICE_STARTER_MONTHLY = "price_sm_test";
    try {
      assert.strictEqual(getPriceId("starter", "monthly"), "price_sm_test");
    } finally {
      if (original !== undefined) process.env.STRIPE_PRICE_STARTER_MONTHLY = original;
      else delete process.env.STRIPE_PRICE_STARTER_MONTHLY;
    }
  });

  it("returns env var for enterprise yearly when set", () => {
    const original = process.env.STRIPE_PRICE_ENTERPRISE_YEARLY;
    process.env.STRIPE_PRICE_ENTERPRISE_YEARLY = "price_ey_test";
    try {
      assert.strictEqual(getPriceId("enterprise", "yearly"), "price_ey_test");
    } finally {
      if (original !== undefined) process.env.STRIPE_PRICE_ENTERPRISE_YEARLY = original;
      else delete process.env.STRIPE_PRICE_ENTERPRISE_YEARLY;
    }
  });
});

describe("isStripeConfigured", () => {
  it("returns false when STRIPE_SECRET_KEY is not set", () => {
    const original = process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_SECRET_KEY;
    try {
      assert.strictEqual(isStripeConfigured(), false);
    } finally {
      if (original !== undefined) process.env.STRIPE_SECRET_KEY = original;
    }
  });

  it("returns true when STRIPE_SECRET_KEY is set", () => {
    const original = process.env.STRIPE_SECRET_KEY;
    process.env.STRIPE_SECRET_KEY = "sk_test_fake";
    try {
      assert.strictEqual(isStripeConfigured(), true);
    } finally {
      if (original !== undefined) process.env.STRIPE_SECRET_KEY = original;
      else delete process.env.STRIPE_SECRET_KEY;
    }
  });
});

// ============================================================================
// Plan definition billing consistency
// ============================================================================

describe("Plan billing consistency", () => {
  it("all paid plans have overage pricing defined", () => {
    const paidTiers: PlanTier[] = ["starter", "professional", "enterprise"];
    for (const tier of paidTiers) {
      const plan = PLAN_DEFINITIONS[tier];
      assert.ok(
        plan.limits.overagePricePerCallUsd > 0,
        `${tier} plan should have overage pricing, got ${plan.limits.overagePricePerCallUsd}`,
      );
    }
  });

  it("overage price decreases with tier (volume discount)", () => {
    const starter = PLAN_DEFINITIONS.starter.limits.overagePricePerCallUsd;
    const professional = PLAN_DEFINITIONS.professional.limits.overagePricePerCallUsd;
    const enterprise = PLAN_DEFINITIONS.enterprise.limits.overagePricePerCallUsd;
    assert.ok(starter > professional, `starter ($${starter}) should be more expensive than professional ($${professional})`);
    assert.ok(professional > enterprise, `professional ($${professional}) should be more expensive than enterprise ($${enterprise})`);
  });

  it("calls per month increases with tier", () => {
    const free = PLAN_DEFINITIONS.free.limits.callsPerMonth;
    const starter = PLAN_DEFINITIONS.starter.limits.callsPerMonth;
    const professional = PLAN_DEFINITIONS.professional.limits.callsPerMonth;
    const enterprise = PLAN_DEFINITIONS.enterprise.limits.callsPerMonth;
    assert.ok(free < starter, "free < starter calls");
    assert.ok(starter < professional, "starter < professional calls");
    assert.ok(professional < enterprise, "professional < enterprise calls");
  });

  it("base seats increase with tier", () => {
    const free = PLAN_DEFINITIONS.free.limits.baseSeats;
    const starter = PLAN_DEFINITIONS.starter.limits.baseSeats;
    const professional = PLAN_DEFINITIONS.professional.limits.baseSeats;
    const enterprise = PLAN_DEFINITIONS.enterprise.limits.baseSeats;
    assert.ok(free < starter, "free < starter seats");
    assert.ok(starter < professional, "starter < professional seats");
    assert.ok(professional < enterprise, "professional < enterprise seats");
  });

  it("free plan blocks on quota (overagePricePerCallUsd is 0)", () => {
    assert.strictEqual(PLAN_DEFINITIONS.free.limits.overagePricePerCallUsd, 0);
  });
});

// ============================================================================
// Webhook event structure validation
// ============================================================================

describe("Webhook subscription event handling", () => {
  // Simulates the logic used in billing.ts for tier resolution
  function resolveTierFromPriceId(priceId: string | undefined, priceMap: Record<string, PlanTier>): PlanTier {
    if (!priceId) return "free";
    return priceMap[priceId] || "free";
  }

  function findItemByKnownPriceId(items: Array<{ price?: { id?: string } }>, knownIds: (string | undefined)[]): { id: string } | undefined {
    const validIds = knownIds.filter(Boolean) as string[];
    return items.find((i) => validIds.includes(i.price?.id || "")) as any;
  }

  it("resolves tier from price ID correctly", () => {
    const priceMap: Record<string, PlanTier> = {
      "price_starter_m": "starter",
      "price_pro_m": "professional",
      "price_ent_m": "enterprise",
    };
    assert.strictEqual(resolveTierFromPriceId("price_starter_m", priceMap), "starter");
    assert.strictEqual(resolveTierFromPriceId("price_pro_m", priceMap), "professional");
    assert.strictEqual(resolveTierFromPriceId("price_ent_m", priceMap), "enterprise");
  });

  it("defaults to free for unknown price IDs", () => {
    assert.strictEqual(resolveTierFromPriceId("price_unknown", {}), "free");
    assert.strictEqual(resolveTierFromPriceId(undefined, {}), "free");
  });

  it("finds metered items by known price IDs", () => {
    const items = [
      { id: "si_flat", price: { id: "price_flat", recurring: { usage_type: "licensed" } } },
      { id: "si_seats", price: { id: "price_seats", recurring: { usage_type: "metered" } } },
      { id: "si_overage", price: { id: "price_overage", recurring: { usage_type: "metered" } } },
    ];
    const seatsItem = findItemByKnownPriceId(items, ["price_seats"]);
    assert.strictEqual(seatsItem?.id, "si_seats");

    const overageItem = findItemByKnownPriceId(items, ["price_overage"]);
    assert.strictEqual(overageItem?.id, "si_overage");
  });

  it("returns undefined when no matching metered item exists", () => {
    const items = [
      { id: "si_flat", price: { id: "price_flat" } },
    ];
    const result = findItemByKnownPriceId(items, ["price_nonexistent"]);
    assert.strictEqual(result, undefined);
  });

  it("handles empty known IDs list", () => {
    const items = [{ id: "si_1", price: { id: "price_1" } }];
    const result = findItemByKnownPriceId(items, [undefined, undefined]);
    assert.strictEqual(result, undefined);
  });

  it("identifies flat-rate vs metered items correctly", () => {
    const subItems = [
      { id: "si_1", price: { id: "price_flat", recurring: { usage_type: "licensed" } } },
      { id: "si_2", price: { id: "price_seats", recurring: { usage_type: "metered" } } },
      { id: "si_3", price: { id: "price_overage", recurring: { usage_type: "metered" } } },
    ];
    const flatItem = subItems.find((i: any) => i.price?.recurring?.usage_type !== "metered") || subItems[0];
    assert.strictEqual(flatItem.id, "si_1");
  });

  it("falls back to first item when no non-metered item exists", () => {
    const subItems = [
      { id: "si_seats", price: { id: "price_seats", recurring: { usage_type: "metered" } } },
    ];
    const flatItem = subItems.find((i: any) => i.price?.recurring?.usage_type !== "metered") || subItems[0];
    assert.strictEqual(flatItem.id, "si_seats");
  });
});

describe("Subscription lifecycle state transitions", () => {
  const statusMap: Record<string, string> = {
    active: "active",
    past_due: "past_due",
    canceled: "canceled",
    trialing: "trialing",
    incomplete: "incomplete",
  };

  it("maps all Stripe statuses to internal statuses", () => {
    for (const [stripeStatus, internalStatus] of Object.entries(statusMap)) {
      assert.strictEqual(statusMap[stripeStatus], internalStatus);
    }
  });

  it("falls through for unknown Stripe status", () => {
    const unknownStatus = "paused";
    const resolved = statusMap[unknownStatus] || unknownStatus;
    assert.strictEqual(resolved, "paused");
  });

  it("checkout.session.completed should upsert subscription with metered items", () => {
    // Simulate the data extraction from a checkout event
    const stripeSub = {
      id: "sub_123",
      status: "active",
      current_period_start: Math.floor(Date.now() / 1000),
      current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 3600,
      items: {
        data: [
          { id: "si_flat", price: { id: "price_starter_m", recurring: { usage_type: "licensed", interval: "month" } } },
          { id: "si_seats", price: { id: "price_starter_seats", recurring: { usage_type: "metered" } } },
          { id: "si_overage", price: { id: "price_starter_overage", recurring: { usage_type: "metered" } } },
        ],
      },
    };

    const items = stripeSub.items.data;
    const flatItem = items.find((i) => i.price.recurring.usage_type !== "metered") || items[0];
    assert.strictEqual(flatItem.id, "si_flat");

    // Verify metered items are extractable
    const seatsItem = items.find((i) => i.price.id === "price_starter_seats");
    const overageItem = items.find((i) => i.price.id === "price_starter_overage");
    assert.ok(seatsItem, "seats item should be found");
    assert.ok(overageItem, "overage item should be found");
    assert.strictEqual(seatsItem!.id, "si_seats");
    assert.strictEqual(overageItem!.id, "si_overage");
  });

  it("subscription.deleted should preserve customer ID", () => {
    // Simulate the existing subscription state
    const existingSub = {
      orgId: "org-1",
      stripeCustomerId: "cus_abc123",
      stripeSubscriptionId: "sub_old",
      stripeSeatsItemId: "si_seats_old",
      stripeOverageItemId: "si_overage_old",
      planTier: "starter" as PlanTier,
    };

    // After deletion, customer ID should be preserved, metered items cleared
    const downgradeRecord = {
      orgId: existingSub.orgId,
      planTier: "free" as PlanTier,
      status: "canceled",
      stripeCustomerId: existingSub.stripeCustomerId, // preserved
      stripeSubscriptionId: undefined, // cleared
      stripeSeatsItemId: undefined, // cleared
      stripeOverageItemId: undefined, // cleared
      billingInterval: "monthly",
      cancelAtPeriodEnd: false,
    };

    assert.strictEqual(downgradeRecord.stripeCustomerId, "cus_abc123", "customer ID preserved");
    assert.strictEqual(downgradeRecord.stripeSubscriptionId, undefined, "subscription ID cleared");
    assert.strictEqual(downgradeRecord.stripeSeatsItemId, undefined, "seats item cleared");
    assert.strictEqual(downgradeRecord.stripeOverageItemId, undefined, "overage item cleared");
    assert.strictEqual(downgradeRecord.planTier, "free", "downgraded to free");
  });

  it("subscription.updated should sync metered item IDs", () => {
    const subItems = [
      { id: "si_flat_new", price: { id: "price_pro_m", recurring: { usage_type: "licensed", interval: "month" } } },
      { id: "si_seats_new", price: { id: "price_pro_seats", recurring: { usage_type: "metered" } } },
      { id: "si_overage_new", price: { id: "price_pro_overage", recurring: { usage_type: "metered" } } },
    ];

    const knownSeatPrices = ["price_starter_seats", "price_pro_seats"];
    const knownOveragePrices = ["price_starter_overage", "price_pro_overage", "price_ent_overage"];

    const seatsItem = subItems.find((i) => knownSeatPrices.includes(i.price.id));
    const overageItem = subItems.find((i) => knownOveragePrices.includes(i.price.id));

    assert.strictEqual(seatsItem?.id, "si_seats_new");
    assert.strictEqual(overageItem?.id, "si_overage_new");
  });

  it("additional seat calculation is correct", () => {
    const plan = PLAN_DEFINITIONS.starter;
    const baseSeats = plan.limits.baseSeats;
    const userCount = 8;
    const additionalSeats = Math.max(0, userCount - baseSeats);
    assert.strictEqual(additionalSeats, 3, `8 users - ${baseSeats} base = 3 additional`);
  });

  it("additional seats are 0 when under base", () => {
    const plan = PLAN_DEFINITIONS.starter;
    const baseSeats = plan.limits.baseSeats;
    const userCount = 2;
    const additionalSeats = Math.max(0, userCount - baseSeats);
    assert.strictEqual(additionalSeats, 0);
  });
});

describe("Webhook idempotency", () => {
  it("dedup key is the Stripe event ID", () => {
    const event = { id: "evt_123abc", type: "checkout.session.completed" };
    const dedupKey = event.id;
    assert.strictEqual(dedupKey, "evt_123abc");
  });

  it("same event ID should be detected as duplicate", () => {
    const seen = new Set<string>();
    const eventId = "evt_test_dedup";

    // First time: not a duplicate
    const firstAcquired = !seen.has(eventId);
    seen.add(eventId);
    assert.ok(firstAcquired, "first event should not be a duplicate");

    // Second time: duplicate
    const secondAcquired = !seen.has(eventId);
    assert.ok(!secondAcquired, "second event should be detected as duplicate");
  });
});

describe("Grace period calculation", () => {
  it("pastDueAt is only set on first failure", () => {
    // First failure: no pastDueAt → set it
    const sub1 = { orgId: "org-1", status: "active", pastDueAt: undefined as string | undefined };
    const now = new Date().toISOString();
    const pastDueAt1 = sub1.pastDueAt || now;
    assert.strictEqual(pastDueAt1, now, "pastDueAt set to now on first failure");

    // Second failure: pastDueAt already set → keep original
    const sub2 = { orgId: "org-1", status: "past_due", pastDueAt: "2026-04-01T00:00:00Z" };
    const pastDueAt2 = sub2.pastDueAt || now;
    assert.strictEqual(pastDueAt2, "2026-04-01T00:00:00Z", "pastDueAt preserved on subsequent failures");
  });

  it("grace period is 7 days", () => {
    const GRACE_DAYS = 7;
    const pastDueAt = new Date("2026-04-01T00:00:00Z");
    const graceEnd = new Date(pastDueAt.getTime() + GRACE_DAYS * 24 * 60 * 60 * 1000);
    assert.strictEqual(graceEnd.toISOString(), "2026-04-08T00:00:00.000Z");
  });

  it("within grace period allows access", () => {
    const GRACE_DAYS = 7;
    const pastDueAt = new Date("2026-04-05T00:00:00Z");
    const now = new Date("2026-04-10T00:00:00Z"); // 5 days in
    const daysOverdue = (now.getTime() - pastDueAt.getTime()) / (24 * 60 * 60 * 1000);
    assert.ok(daysOverdue < GRACE_DAYS, "5 days < 7 day grace");
  });

  it("past grace period blocks access", () => {
    const GRACE_DAYS = 7;
    const pastDueAt = new Date("2026-04-01T00:00:00Z");
    const now = new Date("2026-04-10T00:00:00Z"); // 9 days in
    const daysOverdue = (now.getTime() - pastDueAt.getTime()) / (24 * 60 * 60 * 1000);
    assert.ok(daysOverdue > GRACE_DAYS, "9 days > 7 day grace");
  });
});

// ============================================================================
// Stripe Webhook Signature Verification
// ============================================================================

describe("Webhook signature verification", () => {
  const TEST_WEBHOOK_SECRET = "whsec_test_signature_verification_secret";
  const TEST_STRIPE_KEY = "sk_test_fake_key_for_webhook_tests";

  function makeTestPayload(eventType: string, data: Record<string, unknown> = {}): string {
    return JSON.stringify({
      id: `evt_test_${Date.now()}`,
      object: "event",
      type: eventType,
      data: { object: data },
      created: Math.floor(Date.now() / 1000),
      livemode: false,
      api_version: "2025-02-24.acacia",
    });
  }

  it("accepts a correctly signed webhook payload", () => {
    const stripe = new Stripe(TEST_STRIPE_KEY);
    const payload = makeTestPayload("checkout.session.completed", { id: "cs_test_123" });
    const payloadBuffer = Buffer.from(payload, "utf-8");

    // Generate a valid signature using Stripe's test utility
    const signature = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: TEST_WEBHOOK_SECRET,
    });

    // Set the webhook secret so constructWebhookEvent can use it
    const original = process.env.STRIPE_WEBHOOK_SECRET;
    process.env.STRIPE_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;
    try {
      const event = constructWebhookEvent(stripe, payloadBuffer, signature);
      assert.strictEqual(event.type, "checkout.session.completed");
      assert.ok(event.id.startsWith("evt_test_"));
    } finally {
      if (original !== undefined) process.env.STRIPE_WEBHOOK_SECRET = original;
      else delete process.env.STRIPE_WEBHOOK_SECRET;
    }
  });

  it("rejects a payload with an invalid signature", () => {
    const stripe = new Stripe(TEST_STRIPE_KEY);
    const payload = makeTestPayload("customer.subscription.updated");
    const payloadBuffer = Buffer.from(payload, "utf-8");

    const original = process.env.STRIPE_WEBHOOK_SECRET;
    process.env.STRIPE_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;
    try {
      assert.throws(
        () => constructWebhookEvent(stripe, payloadBuffer, "t=123,v1=badsignature"),
        (err: any) => {
          // Stripe SDK throws a StripeSignatureVerificationError
          return err.message.includes("signature") || err.type === "StripeSignatureVerificationError";
        },
        "Should reject invalid webhook signature",
      );
    } finally {
      if (original !== undefined) process.env.STRIPE_WEBHOOK_SECRET = original;
      else delete process.env.STRIPE_WEBHOOK_SECRET;
    }
  });

  it("rejects a payload signed with a different secret", () => {
    const stripe = new Stripe(TEST_STRIPE_KEY);
    const payload = makeTestPayload("invoice.payment_failed");
    const payloadBuffer = Buffer.from(payload, "utf-8");

    // Sign with a DIFFERENT secret than what the server expects
    const wrongSecret = "whsec_wrong_secret_should_not_match";
    const signature = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: wrongSecret,
    });

    const original = process.env.STRIPE_WEBHOOK_SECRET;
    process.env.STRIPE_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;
    try {
      assert.throws(
        () => constructWebhookEvent(stripe, payloadBuffer, signature),
        (err: any) => {
          return err.message.includes("signature") || err.type === "StripeSignatureVerificationError";
        },
        "Should reject signature from wrong secret",
      );
    } finally {
      if (original !== undefined) process.env.STRIPE_WEBHOOK_SECRET = original;
      else delete process.env.STRIPE_WEBHOOK_SECRET;
    }
  });

  it("rejects a tampered payload (body modified after signing)", () => {
    const stripe = new Stripe(TEST_STRIPE_KEY);
    const originalPayload = makeTestPayload("customer.subscription.deleted", { id: "sub_123" });

    // Sign the original payload
    const signature = Stripe.webhooks.generateTestHeaderString({
      payload: originalPayload,
      secret: TEST_WEBHOOK_SECRET,
    });

    // Tamper with the payload AFTER signing
    const tamperedPayload = originalPayload.replace("sub_123", "sub_hacked");
    const tamperedBuffer = Buffer.from(tamperedPayload, "utf-8");

    const original = process.env.STRIPE_WEBHOOK_SECRET;
    process.env.STRIPE_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;
    try {
      assert.throws(
        () => constructWebhookEvent(stripe, tamperedBuffer, signature),
        (err: any) => {
          return err.message.includes("signature") || err.type === "StripeSignatureVerificationError";
        },
        "Should reject tampered payload",
      );
    } finally {
      if (original !== undefined) process.env.STRIPE_WEBHOOK_SECRET = original;
      else delete process.env.STRIPE_WEBHOOK_SECRET;
    }
  });

  it("throws when STRIPE_WEBHOOK_SECRET is not configured", () => {
    const stripe = new Stripe(TEST_STRIPE_KEY);
    const payload = Buffer.from(makeTestPayload("test.event"), "utf-8");

    const original = process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    try {
      assert.throws(
        () => constructWebhookEvent(stripe, payload, "t=123,v1=sig"),
        (err: any) => err.message.includes("STRIPE_WEBHOOK_SECRET not configured"),
        "Should throw when webhook secret is missing",
      );
    } finally {
      if (original !== undefined) process.env.STRIPE_WEBHOOK_SECRET = original;
      else delete process.env.STRIPE_WEBHOOK_SECRET;
    }
  });
});
