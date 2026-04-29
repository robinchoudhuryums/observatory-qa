/**
 * Billing webhook integration tests.
 *
 * Exercises the subscription lifecycle flows against the **real** webhook
 * event handlers exported from `server/routes/billing-webhook-handlers.ts`.
 *
 * Earlier this file had local `simulateCheckoutCompleted`, `simulateSubscriptionUpdated`,
 * etc. helpers that re-implemented the storage calls. Those tests passed
 * even when the real production handler had a bug, because the real handler
 * was never exercised. The handlers are now exported from production code
 * and called directly here.
 *
 * Run with: npx tsx --test tests/billing-webhook-integration.test.ts
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { storage } from "../server/storage/index.js";
import {
  applyCheckoutSubscription,
  handleSubscriptionUpdated,
  handleSubscriptionDeleted,
  handleInvoicePaymentFailed,
  handleInvoicePaid,
} from "../server/routes/billing-webhook-handlers.js";

// ── Test env: stable price IDs so tier/metered lookup works ─────────────────
process.env.STRIPE_PRICE_STARTER_MONTHLY ??= "price_starter_m_test";
process.env.STRIPE_PRICE_STARTER_YEARLY ??= "price_starter_y_test";
process.env.STRIPE_PRICE_PROFESSIONAL_MONTHLY ??= "price_pro_m_test";
process.env.STRIPE_PRICE_PROFESSIONAL_YEARLY ??= "price_pro_y_test";
process.env.STRIPE_PRICE_ENTERPRISE_MONTHLY ??= "price_ent_m_test";
process.env.STRIPE_PRICE_ENTERPRISE_YEARLY ??= "price_ent_y_test";
process.env.STRIPE_PRICE_STARTER_SEATS ??= "price_starter_seats_test";
process.env.STRIPE_PRICE_PROFESSIONAL_SEATS ??= "price_pro_seats_test";
process.env.STRIPE_PRICE_STARTER_OVERAGE ??= "price_starter_overage_test";
process.env.STRIPE_PRICE_PROFESSIONAL_OVERAGE ??= "price_pro_overage_test";
process.env.STRIPE_PRICE_ENTERPRISE_OVERAGE ??= "price_ent_overage_test";

// ── Stripe event shape builders ─────────────────────────────────────────────

interface FakeSubItem {
  id: string;
  price: { id: string; recurring: { interval: "month" | "year"; usage_type: "licensed" | "metered" } };
}

function flatItem(tier: "starter" | "professional" | "enterprise", interval: "monthly" | "yearly"): FakeSubItem {
  const env = `STRIPE_PRICE_${tier.toUpperCase()}_${interval === "monthly" ? "MONTHLY" : "YEARLY"}`;
  return {
    id: `si_${tier}_flat`,
    price: {
      id: process.env[env]!,
      recurring: { interval: interval === "yearly" ? "year" : "month", usage_type: "licensed" },
    },
  };
}

function meteredItem(id: string, priceEnv: string, interval: "monthly" | "yearly"): FakeSubItem {
  return {
    id,
    price: {
      id: process.env[priceEnv]!,
      recurring: { interval: interval === "yearly" ? "year" : "month", usage_type: "metered" },
    },
  };
}

function buildSubscription(opts: {
  id: string;
  customerId: string;
  orgId: string;
  tier: "starter" | "professional" | "enterprise";
  interval: "monthly" | "yearly";
  status?: "active" | "trialing" | "past_due" | "canceled";
  withSeats?: { itemId: string; priceEnv: string };
  withOverage?: { itemId: string; priceEnv: string };
  cancelAtPeriodEnd?: boolean;
}): any {
  const items: FakeSubItem[] = [flatItem(opts.tier, opts.interval)];
  if (opts.withSeats) items.push(meteredItem(opts.withSeats.itemId, opts.withSeats.priceEnv, opts.interval));
  if (opts.withOverage) items.push(meteredItem(opts.withOverage.itemId, opts.withOverage.priceEnv, opts.interval));

  const now = Math.floor(Date.now() / 1000);
  return {
    id: opts.id,
    customer: opts.customerId,
    metadata: { orgId: opts.orgId },
    status: opts.status || "active",
    items: { data: items },
    current_period_start: now,
    current_period_end: now + 30 * 24 * 3600,
    cancel_at_period_end: opts.cancelAtPeriodEnd || false,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

let testCounter = 0;
async function freshOrg(prefix = "org-billing"): Promise<string> {
  const slug = `${prefix}-${++testCounter}-${Date.now()}`;
  const org = await storage.createOrganization({ name: "Test Org", slug, status: "active" } as any);
  return org.id;
}

describe("Billing webhook integration: subscription lifecycle (real handlers)", () => {
  beforeEach(async () => {
    // Each test gets its own orgId; we don't need to reset shared singleton state.
  });

  it("checkout creates subscription with all metered items", async () => {
    const orgId = await freshOrg();

    const sub = buildSubscription({
      id: "sub_test123",
      customerId: "cus_test123",
      orgId,
      tier: "starter",
      interval: "monthly",
      withSeats: { itemId: "si_seats_123", priceEnv: "STRIPE_PRICE_STARTER_SEATS" },
      withOverage: { itemId: "si_overage_123", priceEnv: "STRIPE_PRICE_STARTER_OVERAGE" },
    });

    await applyCheckoutSubscription(orgId, sub, "cus_test123");

    const stored = await storage.getSubscription(orgId);
    assert.ok(stored);
    assert.strictEqual(stored!.planTier, "starter");
    assert.strictEqual(stored!.status, "active");
    assert.strictEqual(stored!.stripeCustomerId, "cus_test123");
    assert.strictEqual(stored!.stripeSubscriptionId, "sub_test123");
    assert.strictEqual(stored!.stripeSeatsItemId, "si_seats_123");
    assert.strictEqual(stored!.stripeOverageItemId, "si_overage_123");
    assert.strictEqual(stored!.billingInterval, "monthly");
    assert.strictEqual(stored!.cancelAtPeriodEnd, false);
  });

  it("checkout with trial sets trialing status", async () => {
    const orgId = await freshOrg();

    const sub = buildSubscription({
      id: "sub_trial",
      customerId: "cus_trial",
      orgId,
      tier: "professional",
      interval: "yearly",
      status: "trialing",
    });

    await applyCheckoutSubscription(orgId, sub, "cus_trial");

    const stored = await storage.getSubscription(orgId);
    assert.strictEqual(stored!.status, "trialing");
    assert.strictEqual(stored!.planTier, "professional");
    assert.strictEqual(stored!.billingInterval, "yearly");
  });

  it("update syncs metered item IDs when subscription changes", async () => {
    const orgId = await freshOrg();

    // Initial: starter
    await applyCheckoutSubscription(
      orgId,
      buildSubscription({
        id: "sub_upgrade",
        customerId: "cus_upgrade",
        orgId,
        tier: "starter",
        interval: "monthly",
        withSeats: { itemId: "si_old_seats", priceEnv: "STRIPE_PRICE_STARTER_SEATS" },
        withOverage: { itemId: "si_old_overage", priceEnv: "STRIPE_PRICE_STARTER_OVERAGE" },
      }),
      "cus_upgrade",
    );

    // Upgrade event with new metered IDs
    await handleSubscriptionUpdated(
      buildSubscription({
        id: "sub_upgrade",
        customerId: "cus_upgrade",
        orgId,
        tier: "professional",
        interval: "monthly",
        withSeats: { itemId: "si_new_seats", priceEnv: "STRIPE_PRICE_PROFESSIONAL_SEATS" },
        withOverage: { itemId: "si_new_overage", priceEnv: "STRIPE_PRICE_PROFESSIONAL_OVERAGE" },
      }),
    );

    const updated = await storage.getSubscription(orgId);
    assert.ok(updated);
    assert.strictEqual(updated!.planTier, "professional");
    assert.strictEqual(updated!.stripeSeatsItemId, "si_new_seats");
    assert.strictEqual(updated!.stripeOverageItemId, "si_new_overage");
    assert.strictEqual(updated!.stripeCustomerId, "cus_upgrade", "customer ID preserved");
  });

  it("update handles missing metered items (enterprise custom billing)", async () => {
    const orgId = await freshOrg();

    await applyCheckoutSubscription(
      orgId,
      buildSubscription({ id: "sub_ent", customerId: "cus_ent", orgId, tier: "enterprise", interval: "yearly" }),
      "cus_ent",
    );

    await handleSubscriptionUpdated(
      buildSubscription({ id: "sub_ent", customerId: "cus_ent", orgId, tier: "enterprise", interval: "yearly" }),
    );

    const updated = await storage.getSubscription(orgId);
    assert.strictEqual(updated!.planTier, "enterprise");
    assert.strictEqual(updated!.stripeSeatsItemId, undefined);
    assert.strictEqual(updated!.stripeOverageItemId, undefined);
  });

  it("deletion preserves customer ID, suspends org, and clears metered items", async () => {
    const orgId = await freshOrg();

    await applyCheckoutSubscription(
      orgId,
      buildSubscription({
        id: "sub_cancel",
        customerId: "cus_cancel",
        orgId,
        tier: "professional",
        interval: "monthly",
        withSeats: { itemId: "si_cancel_seats", priceEnv: "STRIPE_PRICE_PROFESSIONAL_SEATS" },
        withOverage: { itemId: "si_cancel_overage", priceEnv: "STRIPE_PRICE_PROFESSIONAL_OVERAGE" },
      }),
      "cus_cancel",
    );

    await handleSubscriptionDeleted(
      buildSubscription({
        id: "sub_cancel",
        customerId: "cus_cancel",
        orgId,
        tier: "professional",
        interval: "monthly",
      }),
    );

    const deleted = await storage.getSubscription(orgId);
    assert.strictEqual(deleted!.planTier, "free");
    assert.strictEqual(deleted!.status, "canceled");
    assert.strictEqual(deleted!.stripeCustomerId, "cus_cancel", "customer ID must be preserved");
    assert.strictEqual(deleted!.stripeSubscriptionId, undefined);
    assert.strictEqual(deleted!.stripeSeatsItemId, undefined);
    assert.strictEqual(deleted!.stripeOverageItemId, undefined);

    // Org should now be suspended (real handler does this; old simulator did not)
    const org = await storage.getOrganization(orgId);
    assert.strictEqual(org!.status, "suspended", "org must be suspended on subscription deletion");
  });

  it("deletion with no prior subscription still creates a free record using the event customer", async () => {
    const orgId = await freshOrg();

    await handleSubscriptionDeleted(
      buildSubscription({ id: "sub_orphan", customerId: "cus_orphan", orgId, tier: "starter", interval: "monthly" }),
    );

    const deleted = await storage.getSubscription(orgId);
    assert.ok(deleted);
    assert.strictEqual(deleted!.planTier, "free");
    assert.strictEqual(deleted!.status, "canceled");
    // Real handler falls back to the event's `customer` field when no prior sub existed
    assert.strictEqual(deleted!.stripeCustomerId, "cus_orphan");
  });

  it("payment failure sets past_due with timestamp", async () => {
    const orgId = await freshOrg();
    await applyCheckoutSubscription(
      orgId,
      buildSubscription({
        id: "sub_pastdue",
        customerId: "cus_pastdue",
        orgId,
        tier: "starter",
        interval: "monthly",
      }),
      "cus_pastdue",
    );

    const before = Date.now();
    await handleInvoicePaymentFailed({ customer: "cus_pastdue" } as any);

    const failed = await storage.getSubscription(orgId);
    assert.strictEqual(failed!.status, "past_due");
    assert.ok(failed!.pastDueAt);
    const pastDueTime = new Date(failed!.pastDueAt!).getTime();
    assert.ok(pastDueTime >= before - 1000 && pastDueTime <= Date.now() + 1000);
  });

  it("repeated payment failures do not reset pastDueAt", async () => {
    const orgId = await freshOrg();
    await applyCheckoutSubscription(
      orgId,
      buildSubscription({ id: "sub_retry", customerId: "cus_retry", orgId, tier: "starter", interval: "monthly" }),
      "cus_retry",
    );

    await handleInvoicePaymentFailed({ customer: "cus_retry" } as any);
    const first = await storage.getSubscription(orgId);
    const firstPastDueAt = first!.pastDueAt;

    // Wait briefly to ensure a different timestamp would be generated if reset
    await new Promise((r) => setTimeout(r, 5));

    await handleInvoicePaymentFailed({ customer: "cus_retry" } as any);
    const second = await storage.getSubscription(orgId);
    assert.strictEqual(second!.pastDueAt, firstPastDueAt, "pastDueAt preserved on retry");
  });

  it("payment success reactivates past_due subscription", async () => {
    const orgId = await freshOrg();
    await applyCheckoutSubscription(
      orgId,
      buildSubscription({
        id: "sub_recover",
        customerId: "cus_recover",
        orgId,
        tier: "professional",
        interval: "monthly",
      }),
      "cus_recover",
    );

    await handleInvoicePaymentFailed({ customer: "cus_recover" } as any);
    assert.strictEqual((await storage.getSubscription(orgId))!.status, "past_due");

    await handleInvoicePaid({ customer: "cus_recover" } as any);
    const recovered = await storage.getSubscription(orgId);
    assert.strictEqual(recovered!.status, "active");
    assert.strictEqual(recovered!.pastDueAt, undefined, "pastDueAt cleared on recovery");
  });

  it("payment success on non-past-due subscription is a no-op", async () => {
    const orgId = await freshOrg();
    await applyCheckoutSubscription(
      orgId,
      buildSubscription({ id: "sub_noop", customerId: "cus_noop", orgId, tier: "starter", interval: "monthly" }),
      "cus_noop",
    );

    await handleInvoicePaid({ customer: "cus_noop" } as any);
    const result = await storage.getSubscription(orgId);
    assert.strictEqual(result!.status, "active"); // unchanged
  });

  it("full lifecycle: checkout → update → payment fail → recover → cancel", async () => {
    const orgId = await freshOrg();

    // 1. Starter checkout
    await applyCheckoutSubscription(
      orgId,
      buildSubscription({
        id: "sub_lifecycle",
        customerId: "cus_lifecycle",
        orgId,
        tier: "starter",
        interval: "monthly",
        withSeats: { itemId: "si_life_seats", priceEnv: "STRIPE_PRICE_STARTER_SEATS" },
        withOverage: { itemId: "si_life_overage", priceEnv: "STRIPE_PRICE_STARTER_OVERAGE" },
      }),
      "cus_lifecycle",
    );
    let sub = await storage.getSubscription(orgId);
    assert.strictEqual(sub!.planTier, "starter");

    // 2. Upgrade
    await handleSubscriptionUpdated(
      buildSubscription({
        id: "sub_lifecycle",
        customerId: "cus_lifecycle",
        orgId,
        tier: "professional",
        interval: "monthly",
        withSeats: { itemId: "si_life_seats_v2", priceEnv: "STRIPE_PRICE_PROFESSIONAL_SEATS" },
        withOverage: { itemId: "si_life_overage_v2", priceEnv: "STRIPE_PRICE_PROFESSIONAL_OVERAGE" },
      }),
    );
    sub = await storage.getSubscription(orgId);
    assert.strictEqual(sub!.planTier, "professional");
    assert.strictEqual(sub!.stripeSeatsItemId, "si_life_seats_v2");

    // 3. Payment fails
    await handleInvoicePaymentFailed({ customer: "cus_lifecycle" } as any);
    sub = await storage.getSubscription(orgId);
    assert.strictEqual(sub!.status, "past_due");

    // 4. Payment recovers
    await handleInvoicePaid({ customer: "cus_lifecycle" } as any);
    sub = await storage.getSubscription(orgId);
    assert.strictEqual(sub!.status, "active");
    assert.strictEqual(sub!.pastDueAt, undefined);

    // 5. Cancel
    await handleSubscriptionDeleted(
      buildSubscription({
        id: "sub_lifecycle",
        customerId: "cus_lifecycle",
        orgId,
        tier: "professional",
        interval: "monthly",
      }),
    );
    sub = await storage.getSubscription(orgId);
    assert.strictEqual(sub!.planTier, "free");
    assert.strictEqual(sub!.status, "canceled");
    assert.strictEqual(sub!.stripeCustomerId, "cus_lifecycle");
    assert.strictEqual(sub!.stripeSubscriptionId, undefined);
    assert.strictEqual(sub!.stripeSeatsItemId, undefined);
    assert.strictEqual(sub!.stripeOverageItemId, undefined);
  });

  it("re-subscription after cancellation reuses customer ID", async () => {
    const orgId = await freshOrg();

    await applyCheckoutSubscription(
      orgId,
      buildSubscription({ id: "sub_first", customerId: "cus_resub", orgId, tier: "starter", interval: "monthly" }),
      "cus_resub",
    );
    await handleSubscriptionDeleted(
      buildSubscription({ id: "sub_first", customerId: "cus_resub", orgId, tier: "starter", interval: "monthly" }),
    );
    let sub = await storage.getSubscription(orgId);
    assert.strictEqual(sub!.stripeCustomerId, "cus_resub");

    await applyCheckoutSubscription(
      orgId,
      buildSubscription({
        id: "sub_second",
        customerId: "cus_resub",
        orgId,
        tier: "professional",
        interval: "yearly",
        withSeats: { itemId: "si_resub_seats", priceEnv: "STRIPE_PRICE_PROFESSIONAL_SEATS" },
      }),
      "cus_resub",
    );
    sub = await storage.getSubscription(orgId);
    assert.strictEqual(sub!.planTier, "professional");
    assert.strictEqual(sub!.stripeCustomerId, "cus_resub");
    assert.strictEqual(sub!.stripeSubscriptionId, "sub_second");
    assert.strictEqual(sub!.stripeSeatsItemId, "si_resub_seats");
  });

  it("update on org with no orgId in event metadata is a no-op", async () => {
    // Real handler short-circuits when event.metadata.orgId is missing
    await handleSubscriptionUpdated({
      id: "sub_no_meta",
      customer: "cus_no_meta",
      metadata: {},
      status: "active",
      items: { data: [flatItem("starter", "monthly")] },
      current_period_start: Math.floor(Date.now() / 1000),
      current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 3600,
      cancel_at_period_end: false,
    } as any);
    // No throw, no error — pass
    assert.ok(true);
  });

  it("cancel-at-period-end flag is correctly stored and cleared", async () => {
    const orgId = await freshOrg();

    await applyCheckoutSubscription(
      orgId,
      buildSubscription({
        id: "sub_cancelend",
        customerId: "cus_cancelend",
        orgId,
        tier: "starter",
        interval: "monthly",
      }),
      "cus_cancelend",
    );

    await handleSubscriptionUpdated(
      buildSubscription({
        id: "sub_cancelend",
        customerId: "cus_cancelend",
        orgId,
        tier: "starter",
        interval: "monthly",
        cancelAtPeriodEnd: true,
      }),
    );
    let sub = await storage.getSubscription(orgId);
    assert.strictEqual(sub!.cancelAtPeriodEnd, true);

    await handleSubscriptionUpdated(
      buildSubscription({
        id: "sub_cancelend",
        customerId: "cus_cancelend",
        orgId,
        tier: "starter",
        interval: "monthly",
        cancelAtPeriodEnd: false,
      }),
    );
    sub = await storage.getSubscription(orgId);
    assert.strictEqual(sub!.cancelAtPeriodEnd, false);
  });
});
