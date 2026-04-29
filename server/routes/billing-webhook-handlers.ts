/**
 * Stripe webhook event handlers — one exported async function per event type,
 * plus the small helpers (`resolveTierFromPriceId`, `findItemByKnownPriceId`).
 *
 * Extracted from the inline switch in `routes/billing.ts` so tests can call
 * the actual production code instead of redefining lifecycle logic locally
 * (the prior `simulateCheckoutCompleted` / `simulateSubscriptionUpdated`
 * helpers in `tests/billing-webhook-integration.test.ts` were tautological —
 * they re-implemented the storage calls and so silently passed even when the
 * real handler had a bug).
 *
 * Each handler reads only what it needs from the Stripe event object and
 * applies the resulting state change to `storage`. They are pure with respect
 * to network I/O except where Stripe-side state must be retrieved
 * (`handleCheckoutSessionCompleted` does `stripe.subscriptions.retrieve` and
 * may fire metered seat usage). For testability, the post-retrieve subscription
 * application logic is split out as `applyCheckoutSubscription`.
 */
import type Stripe from "stripe";
import { storage } from "../storage";
import { invalidateOrgCache } from "../auth";
import { logger } from "../services/logger";
import { sendEmail, buildPaymentFailedEmail, buildTrialEndingEmail } from "../services/email";
import { reportSeatUsage } from "../services/stripe";
import { PLAN_DEFINITIONS, type PlanTier } from "@shared/schema";

/** Grace period after a payment failure before hard-blocking the account (days). */
export const DUNNING_GRACE_PERIOD_DAYS = 7;

/** Stripe webhook idempotency TTL — events older than this are no longer deduplicated. */
export const WEBHOOK_DEDUP_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Find a Stripe subscription item whose `price.id` matches one of the given
 * known price IDs. Used to reliably distinguish seats vs overage metered
 * items (rather than by position).
 */
export function findItemByKnownPriceId(
  items: Array<{ id?: string; price?: { id?: string } }>,
  knownIds: (string | undefined)[],
): { id: string } | undefined {
  const validIds = knownIds.filter(Boolean) as string[];
  return items.find((i) => i.price?.id !== undefined && validIds.includes(i.price.id)) as { id: string } | undefined;
}

/** Reverse-lookup a plan tier from a Stripe price ID. */
export function resolveTierFromPriceId(priceId?: string): PlanTier {
  if (!priceId) return "free";

  const priceMap: Record<string, PlanTier> = {};
  const starterM = process.env.STRIPE_PRICE_STARTER_MONTHLY;
  const starterY = process.env.STRIPE_PRICE_STARTER_YEARLY;
  const proM = process.env.STRIPE_PRICE_PROFESSIONAL_MONTHLY;
  const proY = process.env.STRIPE_PRICE_PROFESSIONAL_YEARLY;
  const entM = process.env.STRIPE_PRICE_ENTERPRISE_MONTHLY;
  const entY = process.env.STRIPE_PRICE_ENTERPRISE_YEARLY;

  if (starterM) priceMap[starterM] = "starter";
  if (starterY) priceMap[starterY] = "starter";
  if (proM) priceMap[proM] = "professional";
  if (proY) priceMap[proY] = "professional";
  if (entM) priceMap[entM] = "enterprise";
  if (entY) priceMap[entY] = "enterprise";

  const resolved = priceMap[priceId];
  if (!resolved) {
    logger.error({ priceId }, "Unknown Stripe price ID — cannot resolve to plan tier, defaulting to free");
    return "free";
  }
  return resolved;
}

/** Map Stripe subscription statuses to internal subscription statuses. */
const STRIPE_STATUS_MAP: Record<string, string> = {
  active: "active",
  past_due: "past_due",
  canceled: "canceled",
  trialing: "trialing",
  incomplete: "incomplete",
};

// ─── Per-event handlers ─────────────────────────────────────────────────────

/**
 * Apply a freshly-retrieved Stripe subscription object to storage. Pulled out
 * of `handleCheckoutSessionCompleted` so tests can exercise the storage shape
 * without standing up a Stripe client.
 *
 * Returns the metered-item IDs so the caller can decide whether to fire the
 * initial seat-usage report (which itself needs a real `stripe` client).
 */
export async function applyCheckoutSubscription(
  orgId: string,
  subData: Stripe.Subscription,
  customerId: string,
): Promise<{ tier: PlanTier; stripeSeatsItemId?: string; stripeOverageItemId?: string }> {
  const items: Stripe.SubscriptionItem[] = subData.items?.data || [];

  const flatItem = items.find((i) => i.price?.recurring?.usage_type !== "metered") || items[0];
  const seatsItem = findItemByKnownPriceId(items, [
    process.env.STRIPE_PRICE_STARTER_SEATS,
    process.env.STRIPE_PRICE_PROFESSIONAL_SEATS,
  ]);
  const overageItem = findItemByKnownPriceId(items, [
    process.env.STRIPE_PRICE_STARTER_OVERAGE,
    process.env.STRIPE_PRICE_PROFESSIONAL_OVERAGE,
    process.env.STRIPE_PRICE_ENTERPRISE_OVERAGE,
  ]);

  const priceId = flatItem?.price?.id;
  const tier = resolveTierFromPriceId(priceId);
  const interval = flatItem?.price?.recurring?.interval === "year" ? "yearly" : "monthly";
  const stripeSeatsItemId = seatsItem?.id;
  const stripeOverageItemId = overageItem?.id;
  const isTrialing = subData.status === "trialing";

  // Stripe types lag the API; subscription period fields exist at runtime.
  const subAny = subData as unknown as { current_period_start: number; current_period_end: number };

  await storage.upsertSubscription(orgId, {
    orgId,
    planTier: tier,
    status: isTrialing ? "trialing" : "active",
    stripeCustomerId: customerId,
    stripeSubscriptionId: subData.id,
    stripePriceId: priceId,
    stripeSeatsItemId,
    stripeOverageItemId,
    billingInterval: interval,
    currentPeriodStart: new Date(subAny.current_period_start * 1000).toISOString(),
    currentPeriodEnd: new Date(subAny.current_period_end * 1000).toISOString(),
    cancelAtPeriodEnd: false,
  });
  logger.info(
    {
      orgId,
      tier,
      interval,
      hasSeatMeter: !!stripeSeatsItemId,
      hasOverageMeter: !!stripeOverageItemId,
      isTrialing,
    },
    "Subscription activated via checkout",
  );

  return { tier, stripeSeatsItemId, stripeOverageItemId };
}

/**
 * Full `checkout.session.completed` flow: retrieves the subscription from
 * Stripe, persists it via `applyCheckoutSubscription`, and reports the
 * initial metered seat usage (best-effort).
 */
export async function handleCheckoutSessionCompleted(stripe: Stripe, session: Stripe.Checkout.Session): Promise<void> {
  const orgId = session.metadata?.orgId;
  if (!orgId) return;
  if (!session.subscription) return;

  const stripeSub = await stripe.subscriptions.retrieve(session.subscription as string);
  const { tier, stripeSeatsItemId } = await applyCheckoutSubscription(orgId, stripeSub, session.customer as string);

  if (stripeSeatsItemId) {
    try {
      const plan = PLAN_DEFINITIONS[tier];
      const users = await storage.listUsersByOrg(orgId);
      const additionalSeats = Math.max(0, users.length - plan.limits.baseSeats);
      await reportSeatUsage(stripe, stripeSeatsItemId, additionalSeats);
      logger.info({ orgId, additionalSeats }, "Initial seat usage reported");
    } catch (err) {
      logger.warn({ err, orgId }, "Failed to report initial seat usage (non-fatal)");
    }
  }
}

export async function handleSubscriptionUpdated(stripeSub: Stripe.Subscription): Promise<void> {
  const orgId = stripeSub.metadata?.orgId;
  if (!orgId) return;

  const subItems: Stripe.SubscriptionItem[] = stripeSub.items?.data || [];
  const flatItem = subItems.find((i) => i.price?.recurring?.usage_type !== "metered") || subItems[0];
  const priceId = flatItem?.price?.id;
  const tier = resolveTierFromPriceId(priceId);
  const interval = flatItem?.price?.recurring?.interval === "year" ? "yearly" : "monthly";

  const updSeatsItem = findItemByKnownPriceId(subItems, [
    process.env.STRIPE_PRICE_STARTER_SEATS,
    process.env.STRIPE_PRICE_PROFESSIONAL_SEATS,
  ]);
  const updOverageItem = findItemByKnownPriceId(subItems, [
    process.env.STRIPE_PRICE_STARTER_OVERAGE,
    process.env.STRIPE_PRICE_PROFESSIONAL_OVERAGE,
    process.env.STRIPE_PRICE_ENTERPRISE_OVERAGE,
  ]);

  const subAny = stripeSub as unknown as {
    status: string;
    current_period_start: number;
    current_period_end: number;
    cancel_at_period_end?: boolean;
  };

  await storage.updateSubscription(orgId, {
    planTier: tier,
    status: (STRIPE_STATUS_MAP[subAny.status] || subAny.status) as
      | "active"
      | "past_due"
      | "canceled"
      | "trialing"
      | "incomplete",
    stripePriceId: priceId,
    stripeSeatsItemId: updSeatsItem?.id || undefined,
    stripeOverageItemId: updOverageItem?.id || undefined,
    billingInterval: interval,
    currentPeriodStart: new Date(subAny.current_period_start * 1000).toISOString(),
    currentPeriodEnd: new Date(subAny.current_period_end * 1000).toISOString(),
    cancelAtPeriodEnd: subAny.cancel_at_period_end || false,
  });
  logger.info(
    { orgId, tier, status: subAny.status, hasSeatMeter: !!updSeatsItem, hasOverageMeter: !!updOverageItem },
    "Subscription updated",
  );
}

export async function handleSubscriptionDeleted(stripeSub: Stripe.Subscription): Promise<void> {
  const orgId = stripeSub.metadata?.orgId;
  if (!orgId) return;

  const existingSub = await storage.getSubscription(orgId);
  await storage.upsertSubscription(orgId, {
    orgId,
    planTier: "free",
    status: "canceled",
    stripeCustomerId: existingSub?.stripeCustomerId || (stripeSub.customer as string),
    stripeSubscriptionId: undefined,
    stripeSeatsItemId: undefined,
    stripeOverageItemId: undefined,
    billingInterval: "monthly",
    cancelAtPeriodEnd: false,
  });
  // Suspend org access on cancellation — enforced by injectOrgContext gate.
  await storage.updateOrganization(orgId, { status: "suspended" } as { status: "suspended" });
  invalidateOrgCache(orgId);
  logger.info({ orgId }, "Subscription canceled — org suspended, reverted to free");
}

export async function handleInvoicePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
  const customerId = invoice.customer as string | undefined;
  if (!customerId) return;

  const sub = await storage.getSubscriptionByStripeCustomerId(customerId);
  if (!sub) return;

  // Only set pastDueAt on the first failure (don't reset on retries).
  const pastDueAt = sub.pastDueAt || new Date().toISOString();
  await storage.updateSubscription(sub.orgId, { status: "past_due", pastDueAt });
  logger.warn({ orgId: sub.orgId, pastDueAt }, "Invoice payment failed — status set to past_due");

  try {
    const org = await storage.getOrganization(sub.orgId);
    const adminUsers = await storage.listUsersByOrg(sub.orgId);
    const admin = adminUsers.find((u) => u.role === "admin");
    if (admin?.username && org) {
      const baseUrl = process.env.APP_BASE_URL || "https://app.observatory-qa.com";
      const email = buildPaymentFailedEmail(org.name, DUNNING_GRACE_PERIOD_DAYS, baseUrl);
      email.to = admin.username;
      await sendEmail(email);
    }
  } catch (emailErr) {
    logger.warn({ err: emailErr, orgId: sub.orgId }, "Failed to send payment failed email (non-fatal)");
  }
}

export async function handleInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
  const customerId = invoice.customer as string | undefined;
  if (!customerId) return;

  const sub = await storage.getSubscriptionByStripeCustomerId(customerId);
  if (sub && sub.status === "past_due") {
    await storage.updateSubscription(sub.orgId, { status: "active", pastDueAt: undefined });
    logger.info({ orgId: sub.orgId }, "Invoice paid — subscription re-activated from past_due");
  }
}

export async function handleTrialWillEnd(stripeSub: Stripe.Subscription): Promise<void> {
  const orgId = stripeSub.metadata?.orgId;
  if (!orgId) return;
  const subAny = stripeSub as unknown as { trial_end?: number };
  if (!subAny.trial_end) return;

  const trialEnd = new Date(subAny.trial_end * 1000);
  logger.info({ orgId, trialEnd: trialEnd.toISOString() }, "Trial ending soon");

  try {
    const org = await storage.getOrganization(orgId);
    const adminUsers = await storage.listUsersByOrg(orgId);
    const admin = adminUsers.find((u) => u.role === "admin");
    if (admin?.username && org) {
      const baseUrl = process.env.APP_BASE_URL || "https://app.observatory-qa.com";
      const email = buildTrialEndingEmail(org.name, trialEnd, baseUrl);
      email.to = admin.username;
      await sendEmail(email);
    }
  } catch (emailErr) {
    logger.warn({ err: emailErr, orgId }, "Failed to send trial ending email (non-fatal)");
  }
}
