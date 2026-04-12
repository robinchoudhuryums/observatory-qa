/**
 * Billing webhook integration tests.
 *
 * Exercises the subscription lifecycle flows that the Stripe webhook handler
 * triggers — upsert, update, delete — against real MemStorage instances.
 * This validates that the storage layer correctly handles the state transitions
 * the webhook handler depends on, without requiring a real Stripe SDK.
 *
 * Run with: npx tsx --test tests/billing-webhook-integration.test.ts
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { MemStorage } from "../server/storage/memory.js";
import type { Subscription, InsertSubscription } from "../shared/schema.js";

// ============================================================================
// Helpers — simulate webhook handler logic using real storage
// ============================================================================

/**
 * Simulates checkout.session.completed webhook handler logic.
 * Creates a subscription with metered item tracking.
 */
async function simulateCheckoutCompleted(
  storage: MemStorage,
  orgId: string,
  opts: {
    tier: string;
    interval: string;
    stripeCustomerId: string;
    stripeSubscriptionId: string;
    stripeSeatsItemId?: string;
    stripeOverageItemId?: string;
    isTrialing?: boolean;
  },
): Promise<Subscription> {
  return storage.upsertSubscription(orgId, {
    orgId,
    planTier: opts.tier as any,
    status: opts.isTrialing ? "trialing" : "active",
    stripeCustomerId: opts.stripeCustomerId,
    stripeSubscriptionId: opts.stripeSubscriptionId,
    stripePriceId: `price_${opts.tier}_${opts.interval}`,
    stripeSeatsItemId: opts.stripeSeatsItemId,
    stripeOverageItemId: opts.stripeOverageItemId,
    billingInterval: opts.interval as any,
    currentPeriodStart: new Date().toISOString(),
    currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
    cancelAtPeriodEnd: false,
  });
}

/**
 * Simulates customer.subscription.updated webhook handler logic.
 * Syncs tier, status, metered items, and billing interval.
 */
async function simulateSubscriptionUpdated(
  storage: MemStorage,
  orgId: string,
  opts: {
    tier: string;
    status: string;
    interval: string;
    stripeSeatsItemId?: string;
    stripeOverageItemId?: string;
    cancelAtPeriodEnd?: boolean;
  },
): Promise<Subscription | undefined> {
  return storage.updateSubscription(orgId, {
    planTier: opts.tier as any,
    status: opts.status as any,
    billingInterval: opts.interval as any,
    stripeSeatsItemId: opts.stripeSeatsItemId,
    stripeOverageItemId: opts.stripeOverageItemId,
    cancelAtPeriodEnd: opts.cancelAtPeriodEnd ?? false,
    currentPeriodStart: new Date().toISOString(),
    currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
  });
}

/**
 * Simulates customer.subscription.deleted webhook handler logic.
 * Downgrades to free, preserves customer ID, clears metered items.
 */
async function simulateSubscriptionDeleted(
  storage: MemStorage,
  orgId: string,
): Promise<Subscription> {
  const existing = await storage.getSubscription(orgId);
  return storage.upsertSubscription(orgId, {
    orgId,
    planTier: "free",
    status: "canceled",
    stripeCustomerId: existing?.stripeCustomerId,
    stripeSubscriptionId: undefined,
    stripeSeatsItemId: undefined,
    stripeOverageItemId: undefined,
    billingInterval: "monthly",
    cancelAtPeriodEnd: false,
  });
}

/**
 * Simulates invoice.payment_failed webhook handler logic.
 */
async function simulatePaymentFailed(
  storage: MemStorage,
  orgId: string,
): Promise<Subscription | undefined> {
  const sub = await storage.getSubscription(orgId);
  if (!sub) return undefined;
  const pastDueAt = sub.pastDueAt || new Date().toISOString();
  return storage.updateSubscription(orgId, { status: "past_due", pastDueAt });
}

/**
 * Simulates invoice.paid webhook handler logic — reactivates past_due.
 */
async function simulatePaymentSucceeded(
  storage: MemStorage,
  orgId: string,
): Promise<Subscription | undefined> {
  const sub = await storage.getSubscription(orgId);
  if (!sub || sub.status !== "past_due") return sub;
  return storage.updateSubscription(orgId, { status: "active", pastDueAt: undefined });
}

// ============================================================================
// Tests
// ============================================================================

describe("Billing webhook integration: subscription lifecycle", () => {
  let storage: MemStorage;
  const ORG_ID = "org-billing-test";

  beforeEach(async () => {
    storage = new MemStorage();
    await storage.createOrganization({
      name: "Billing Test Org",
      slug: "billing-test",
      status: "active",
    });
  });

  it("checkout creates subscription with all metered items", async () => {
    const sub = await simulateCheckoutCompleted(storage, ORG_ID, {
      tier: "starter",
      interval: "monthly",
      stripeCustomerId: "cus_test123",
      stripeSubscriptionId: "sub_test123",
      stripeSeatsItemId: "si_seats_123",
      stripeOverageItemId: "si_overage_123",
    });

    assert.strictEqual(sub.planTier, "starter");
    assert.strictEqual(sub.status, "active");
    assert.strictEqual(sub.stripeCustomerId, "cus_test123");
    assert.strictEqual(sub.stripeSubscriptionId, "sub_test123");
    assert.strictEqual(sub.stripeSeatsItemId, "si_seats_123");
    assert.strictEqual(sub.stripeOverageItemId, "si_overage_123");
    assert.strictEqual(sub.billingInterval, "monthly");
    assert.strictEqual(sub.cancelAtPeriodEnd, false);
  });

  it("checkout with trial sets trialing status", async () => {
    const sub = await simulateCheckoutCompleted(storage, ORG_ID, {
      tier: "professional",
      interval: "yearly",
      stripeCustomerId: "cus_trial",
      stripeSubscriptionId: "sub_trial",
      isTrialing: true,
    });

    assert.strictEqual(sub.status, "trialing");
    assert.strictEqual(sub.planTier, "professional");
    assert.strictEqual(sub.billingInterval, "yearly");
  });

  it("update syncs metered item IDs when subscription changes", async () => {
    // Create initial subscription
    await simulateCheckoutCompleted(storage, ORG_ID, {
      tier: "starter",
      interval: "monthly",
      stripeCustomerId: "cus_upgrade",
      stripeSubscriptionId: "sub_upgrade",
      stripeSeatsItemId: "si_old_seats",
      stripeOverageItemId: "si_old_overage",
    });

    // Upgrade to professional — new metered items
    const updated = await simulateSubscriptionUpdated(storage, ORG_ID, {
      tier: "professional",
      status: "active",
      interval: "monthly",
      stripeSeatsItemId: "si_new_seats",
      stripeOverageItemId: "si_new_overage",
    });

    assert.ok(updated);
    assert.strictEqual(updated!.planTier, "professional");
    assert.strictEqual(updated!.stripeSeatsItemId, "si_new_seats");
    assert.strictEqual(updated!.stripeOverageItemId, "si_new_overage");
    // Customer ID preserved from original checkout
    assert.strictEqual(updated!.stripeCustomerId, "cus_upgrade");
  });

  it("update handles missing metered items (enterprise custom billing)", async () => {
    await simulateCheckoutCompleted(storage, ORG_ID, {
      tier: "enterprise",
      interval: "yearly",
      stripeCustomerId: "cus_ent",
      stripeSubscriptionId: "sub_ent",
    });

    const updated = await simulateSubscriptionUpdated(storage, ORG_ID, {
      tier: "enterprise",
      status: "active",
      interval: "yearly",
      // No metered items — enterprise has custom billing
    });

    assert.ok(updated);
    assert.strictEqual(updated!.planTier, "enterprise");
    assert.strictEqual(updated!.stripeSeatsItemId, undefined);
    assert.strictEqual(updated!.stripeOverageItemId, undefined);
  });

  it("deletion preserves customer ID and clears metered items", async () => {
    await simulateCheckoutCompleted(storage, ORG_ID, {
      tier: "professional",
      interval: "monthly",
      stripeCustomerId: "cus_cancel",
      stripeSubscriptionId: "sub_cancel",
      stripeSeatsItemId: "si_cancel_seats",
      stripeOverageItemId: "si_cancel_overage",
    });

    const deleted = await simulateSubscriptionDeleted(storage, ORG_ID);

    assert.strictEqual(deleted.planTier, "free");
    assert.strictEqual(deleted.status, "canceled");
    assert.strictEqual(deleted.stripeCustomerId, "cus_cancel", "customer ID must be preserved");
    assert.strictEqual(deleted.stripeSubscriptionId, undefined, "subscription ID must be cleared");
    assert.strictEqual(deleted.stripeSeatsItemId, undefined, "seats item must be cleared");
    assert.strictEqual(deleted.stripeOverageItemId, undefined, "overage item must be cleared");
    assert.strictEqual(deleted.cancelAtPeriodEnd, false);
  });

  it("deletion of non-existent subscription creates free record", async () => {
    const deleted = await simulateSubscriptionDeleted(storage, ORG_ID);
    assert.strictEqual(deleted.planTier, "free");
    assert.strictEqual(deleted.status, "canceled");
    assert.strictEqual(deleted.stripeCustomerId, undefined);
  });

  it("payment failure sets past_due with timestamp", async () => {
    await simulateCheckoutCompleted(storage, ORG_ID, {
      tier: "starter",
      interval: "monthly",
      stripeCustomerId: "cus_pastdue",
      stripeSubscriptionId: "sub_pastdue",
    });

    const before = Date.now();
    const failed = await simulatePaymentFailed(storage, ORG_ID);
    assert.ok(failed);
    assert.strictEqual(failed!.status, "past_due");
    assert.ok(failed!.pastDueAt, "pastDueAt should be set");
    const pastDueTime = new Date(failed!.pastDueAt!).getTime();
    assert.ok(pastDueTime >= before - 1000 && pastDueTime <= Date.now() + 1000, "pastDueAt should be recent");
  });

  it("repeated payment failures do not reset pastDueAt", async () => {
    await simulateCheckoutCompleted(storage, ORG_ID, {
      tier: "starter",
      interval: "monthly",
      stripeCustomerId: "cus_retry",
      stripeSubscriptionId: "sub_retry",
    });

    // First failure
    const first = await simulatePaymentFailed(storage, ORG_ID);
    const firstPastDueAt = first!.pastDueAt;

    // Second failure — pastDueAt should NOT be reset
    const second = await simulatePaymentFailed(storage, ORG_ID);
    assert.strictEqual(second!.pastDueAt, firstPastDueAt, "pastDueAt preserved on retry");
  });

  it("payment success reactivates past_due subscription", async () => {
    await simulateCheckoutCompleted(storage, ORG_ID, {
      tier: "professional",
      interval: "monthly",
      stripeCustomerId: "cus_recover",
      stripeSubscriptionId: "sub_recover",
    });

    // Payment fails
    await simulatePaymentFailed(storage, ORG_ID);
    const pastDue = await storage.getSubscription(ORG_ID);
    assert.strictEqual(pastDue!.status, "past_due");

    // Payment succeeds
    const recovered = await simulatePaymentSucceeded(storage, ORG_ID);
    assert.ok(recovered);
    assert.strictEqual(recovered!.status, "active");
    assert.strictEqual(recovered!.pastDueAt, undefined, "pastDueAt cleared on recovery");
  });

  it("payment success on non-past-due subscription is a no-op", async () => {
    await simulateCheckoutCompleted(storage, ORG_ID, {
      tier: "starter",
      interval: "monthly",
      stripeCustomerId: "cus_noop",
      stripeSubscriptionId: "sub_noop",
    });

    const result = await simulatePaymentSucceeded(storage, ORG_ID);
    assert.ok(result);
    assert.strictEqual(result!.status, "active"); // unchanged
  });

  it("full lifecycle: checkout → update → payment fail → recover → cancel", async () => {
    // 1. Checkout (starter)
    await simulateCheckoutCompleted(storage, ORG_ID, {
      tier: "starter",
      interval: "monthly",
      stripeCustomerId: "cus_lifecycle",
      stripeSubscriptionId: "sub_lifecycle",
      stripeSeatsItemId: "si_life_seats",
      stripeOverageItemId: "si_life_overage",
    });
    let sub = await storage.getSubscription(ORG_ID);
    assert.strictEqual(sub!.planTier, "starter");
    assert.strictEqual(sub!.status, "active");

    // 2. Upgrade to professional
    await simulateSubscriptionUpdated(storage, ORG_ID, {
      tier: "professional",
      status: "active",
      interval: "monthly",
      stripeSeatsItemId: "si_life_seats_v2",
      stripeOverageItemId: "si_life_overage_v2",
    });
    sub = await storage.getSubscription(ORG_ID);
    assert.strictEqual(sub!.planTier, "professional");
    assert.strictEqual(sub!.stripeSeatsItemId, "si_life_seats_v2");

    // 3. Payment fails
    await simulatePaymentFailed(storage, ORG_ID);
    sub = await storage.getSubscription(ORG_ID);
    assert.strictEqual(sub!.status, "past_due");
    assert.ok(sub!.pastDueAt);

    // 4. Payment recovers
    await simulatePaymentSucceeded(storage, ORG_ID);
    sub = await storage.getSubscription(ORG_ID);
    assert.strictEqual(sub!.status, "active");
    assert.strictEqual(sub!.pastDueAt, undefined);

    // 5. Cancel subscription
    await simulateSubscriptionDeleted(storage, ORG_ID);
    sub = await storage.getSubscription(ORG_ID);
    assert.strictEqual(sub!.planTier, "free");
    assert.strictEqual(sub!.status, "canceled");
    assert.strictEqual(sub!.stripeCustomerId, "cus_lifecycle", "customer ID preserved");
    assert.strictEqual(sub!.stripeSubscriptionId, undefined);
    assert.strictEqual(sub!.stripeSeatsItemId, undefined);
    assert.strictEqual(sub!.stripeOverageItemId, undefined);
  });

  it("re-subscription after cancellation reuses customer ID", async () => {
    // Initial subscription
    await simulateCheckoutCompleted(storage, ORG_ID, {
      tier: "starter",
      interval: "monthly",
      stripeCustomerId: "cus_resub",
      stripeSubscriptionId: "sub_first",
    });

    // Cancel
    await simulateSubscriptionDeleted(storage, ORG_ID);
    let sub = await storage.getSubscription(ORG_ID);
    assert.strictEqual(sub!.stripeCustomerId, "cus_resub");

    // Re-subscribe (same customer, new subscription)
    await simulateCheckoutCompleted(storage, ORG_ID, {
      tier: "professional",
      interval: "yearly",
      stripeCustomerId: "cus_resub", // same customer
      stripeSubscriptionId: "sub_second", // new sub
      stripeSeatsItemId: "si_resub_seats",
    });
    sub = await storage.getSubscription(ORG_ID);
    assert.strictEqual(sub!.planTier, "professional");
    assert.strictEqual(sub!.status, "active");
    assert.strictEqual(sub!.stripeCustomerId, "cus_resub");
    assert.strictEqual(sub!.stripeSubscriptionId, "sub_second");
    assert.strictEqual(sub!.stripeSeatsItemId, "si_resub_seats");
  });

  it("update on non-existent subscription returns undefined", async () => {
    const result = await simulateSubscriptionUpdated(storage, "org-nonexistent", {
      tier: "starter",
      status: "active",
      interval: "monthly",
    });
    assert.strictEqual(result, undefined);
  });

  it("cancel-at-period-end flag is correctly stored and cleared", async () => {
    await simulateCheckoutCompleted(storage, ORG_ID, {
      tier: "starter",
      interval: "monthly",
      stripeCustomerId: "cus_cancelend",
      stripeSubscriptionId: "sub_cancelend",
    });

    // User initiates cancel-at-period-end
    await simulateSubscriptionUpdated(storage, ORG_ID, {
      tier: "starter",
      status: "active",
      interval: "monthly",
      cancelAtPeriodEnd: true,
    });
    let sub = await storage.getSubscription(ORG_ID);
    assert.strictEqual(sub!.cancelAtPeriodEnd, true);

    // User reverses cancellation
    await simulateSubscriptionUpdated(storage, ORG_ID, {
      tier: "starter",
      status: "active",
      interval: "monthly",
      cancelAtPeriodEnd: false,
    });
    sub = await storage.getSubscription(ORG_ID);
    assert.strictEqual(sub!.cancelAtPeriodEnd, false);
  });
});
