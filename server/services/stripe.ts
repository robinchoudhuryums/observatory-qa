/**
 * Stripe integration for subscription billing.
 *
 * Required environment variables:
 * - STRIPE_SECRET_KEY: Stripe API secret key
 * - STRIPE_WEBHOOK_SECRET: Webhook signing secret for verifying events
 *
 * Flat-rate subscription prices (one per plan × billing interval):
 * - STRIPE_PRICE_STARTER_MONTHLY / STRIPE_PRICE_STARTER_YEARLY
 * - STRIPE_PRICE_PROFESSIONAL_MONTHLY / STRIPE_PRICE_PROFESSIONAL_YEARLY
 * - STRIPE_PRICE_ENTERPRISE_MONTHLY / STRIPE_PRICE_ENTERPRISE_YEARLY
 *
 * Metered seat add-on prices (usage_type=metered, billed for seats above base):
 * - STRIPE_PRICE_STARTER_SEATS    ($12/seat/mo above 5 base seats)
 * - STRIPE_PRICE_PROFESSIONAL_SEATS ($18/seat/mo above 10 base seats)
 *
 * Enterprise seats are negotiated per contract — no metered price configured here.
 */
import Stripe from "stripe";
import { logger } from "./logger";
import type { PlanTier } from "@shared/schema";

let stripeClient: Stripe | null = null;

export function getStripe(): Stripe | null {
  if (stripeClient) return stripeClient;

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    logger.info("[STRIPE] Not configured (set STRIPE_SECRET_KEY)");
    return null;
  }

  stripeClient = new Stripe(secretKey, { apiVersion: "2025-02-24.acacia" as any });
  logger.info("[STRIPE] Initialized");
  return stripeClient;
}

export function isStripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

/** Map plan tier + interval to a flat-rate Stripe Price ID */
export function getPriceId(tier: PlanTier, interval: "monthly" | "yearly"): string | null {
  const priceMap: Record<string, string | undefined> = {
    "starter_monthly": process.env.STRIPE_PRICE_STARTER_MONTHLY,
    "starter_yearly": process.env.STRIPE_PRICE_STARTER_YEARLY,
    "professional_monthly": process.env.STRIPE_PRICE_PROFESSIONAL_MONTHLY,
    "professional_yearly": process.env.STRIPE_PRICE_PROFESSIONAL_YEARLY,
    "enterprise_monthly": process.env.STRIPE_PRICE_ENTERPRISE_MONTHLY,
    "enterprise_yearly": process.env.STRIPE_PRICE_ENTERPRISE_YEARLY,
  };
  return priceMap[`${tier}_${interval}`] || null;
}

/**
 * Map plan tier to its metered seat add-on Price ID.
 * These prices must be configured in Stripe as usage_type=metered.
 * Returns null for tiers without a seat add-on (free, enterprise).
 */
export function getSeatPriceId(tier: PlanTier): string | null {
  const seatPriceMap: Record<string, string | undefined> = {
    "starter": process.env.STRIPE_PRICE_STARTER_SEATS,
    "professional": process.env.STRIPE_PRICE_PROFESSIONAL_SEATS,
  };
  return seatPriceMap[tier] || null;
}

/**
 * Report the current count of additional seats to Stripe for metered billing.
 * Uses action="set" to replace any prior usage record for this period.
 * @param subscriptionItemId  The Stripe subscription item ID for the seat add-on line
 * @param additionalSeats     Seats above the plan's base seat count (clamped to ≥0)
 */
export async function reportSeatUsage(
  stripe: Stripe,
  subscriptionItemId: string,
  additionalSeats: number,
): Promise<void> {
  await stripe.subscriptionItems.createUsageRecord(subscriptionItemId, {
    quantity: Math.max(0, additionalSeats),
    timestamp: Math.floor(Date.now() / 1000),
    action: "set",
  });
}

/** Create or retrieve a Stripe customer for an org */
export async function getOrCreateCustomer(
  stripe: Stripe,
  orgId: string,
  orgName: string,
  email: string,
  existingCustomerId?: string,
): Promise<string> {
  if (existingCustomerId) {
    try {
      const customer = await stripe.customers.retrieve(existingCustomerId);
      if (!customer.deleted) return existingCustomerId;
    } catch {
      // Customer deleted or invalid — create new one
    }
  }

  const customer = await stripe.customers.create({
    name: orgName,
    email,
    metadata: { orgId },
  });

  return customer.id;
}

/**
 * Create a Stripe Checkout session for subscription.
 * @param seatPriceId  Optional metered price ID for additional seats.
 *                     When provided, it is added as a second line item with no
 *                     up-front quantity — seat usage is reported via reportSeatUsage().
 */
export async function createCheckoutSession(
  stripe: Stripe,
  customerId: string,
  priceId: string,
  orgId: string,
  successUrl: string,
  cancelUrl: string,
  seatPriceId?: string,
): Promise<string> {
  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
    { price: priceId, quantity: 1 },
  ];

  if (seatPriceId) {
    // Metered item — Stripe manages quantity via usage records; no quantity here
    lineItems.push({ price: seatPriceId });
  }

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    line_items: lineItems,
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { orgId },
    subscription_data: { metadata: { orgId } },
  });

  return session.url!;
}

/** Create a Stripe Customer Portal session for self-service */
export async function createPortalSession(
  stripe: Stripe,
  customerId: string,
  returnUrl: string,
): Promise<string> {
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });

  return session.url;
}

/** Verify and parse a Stripe webhook event */
export function constructWebhookEvent(
  stripe: Stripe,
  body: Buffer,
  signature: string,
): Stripe.Event {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    throw new Error("STRIPE_WEBHOOK_SECRET not configured");
  }
  return stripe.webhooks.constructEvent(body, signature, webhookSecret);
}
