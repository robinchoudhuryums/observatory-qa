/**
 * Billing routes: subscription management, Stripe checkout/webhooks, usage/quota.
 */
import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { requireAuth, requireRole, injectOrgContext } from "../auth";
import { logger } from "../services/logger";
import { logPhiAccess, auditContext } from "../services/audit-log";
import {
  getStripe,
  isStripeConfigured,
  getPriceId,
  getSeatPriceId,
  getOveragePriceId,
  getOrCreateCustomer,
  createCheckoutSession,
  createPortalSession,
  constructWebhookEvent,
  reportSeatUsage,
  reportCallOverage,
} from "../services/stripe";
import { sendEmail, buildPaymentFailedEmail, buildTrialEndingEmail, buildQuotaAlertEmail } from "../services/email";
import { PLAN_DEFINITIONS, PLAN_TIERS, type PlanTier, type Subscription } from "@shared/schema";

// ============================================================================
// Quota Enforcement Middleware
// ============================================================================

/**
 * Check if the org has exceeded its plan limits for a given resource.
 * Returns a middleware that blocks requests if quota is exceeded.
 */
export function enforceQuota(eventType: "transcription" | "ai_analysis" | "api_call" | "storage_mb") {
  return async (req: Request, res: Response, next: NextFunction) => {
    const orgId = req.orgId;
    if (!orgId) {
      return res.status(403).json({ message: "Organization context required", code: "ORG_REQUIRED" });
    }

    try {
      const sub = await storage.getSubscription(orgId);
      const tier = (sub?.planTier as PlanTier) || "free";
      const plan = PLAN_DEFINITIONS[tier];
      if (!plan) return next();

      const limitKey = {
        transcription: "callsPerMonth" as const,
        ai_analysis: "aiAnalysesPerMonth" as const,
        api_call: "apiCallsPerMonth" as const,
        storage_mb: "storageMb" as const,
      }[eventType];

      const limit = plan.limits[limitKey];
      if (limit === -1) return next(); // unlimited

      // Get current period usage
      const now = new Date();
      const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const usage = await storage.getUsageSummary(orgId, periodStart);
      const used = usage.find((u) => u.eventType === eventType)?.totalQuantity || 0;

      if (used >= limit) {
        const overagePrice = plan.limits.overagePricePerCallUsd;
        if (overagePrice > 0) {
          // Paid plan: allow overage, flag for usage-based billing
          res.setHeader("X-Quota-Overage", "true");
          res.setHeader("X-Overage-Price-Per-Call", overagePrice.toString());
          (req as any).isOverQuota = true;
          return next();
        }
        return res.status(429).json({
          message: `Plan limit reached: ${used}/${limit} ${eventType} this month`,
          code: "QUOTA_EXCEEDED",
          limit,
          used,
          planTier: tier,
          upgradeUrl: "/settings?tab=billing",
        });
      }

      next();
    } catch (error) {
      logger.error({ err: error }, "Quota check failed — allowing request");
      next(); // Fail open — don't block on quota check errors
    }
  };
}

/**
 * Check max users for org based on plan tier.
 */
export function enforceUserQuota() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const orgId = req.orgId;
    if (!orgId) {
      return res.status(403).json({ message: "Organization context required", code: "ORG_REQUIRED" });
    }

    try {
      const sub = await storage.getSubscription(orgId);
      const tier = (sub?.planTier as PlanTier) || "free";
      const plan = PLAN_DEFINITIONS[tier];
      if (!plan || plan.limits.maxUsers === -1) return next();

      const users = await storage.listUsersByOrg(orgId);
      if (users.length >= plan.limits.maxUsers) {
        return res.status(429).json({
          message: `User limit reached: ${users.length}/${plan.limits.maxUsers} users`,
          code: "USER_QUOTA_EXCEEDED",
          limit: plan.limits.maxUsers,
          used: users.length,
          planTier: tier,
        });
      }

      next();
    } catch (error) {
      next();
    }
  };
}

/**
 * Generic feature gate middleware. Checks if a plan feature is enabled.
 * Use for boolean feature flags like customPromptTemplates, ssoEnabled, etc.
 */
export function requirePlanFeature(feature: keyof import("@shared/schema").PlanLimits, errorMessage?: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const orgId = req.orgId;
    if (!orgId) {
      return res.status(403).json({ message: "Organization context required", code: "ORG_REQUIRED" });
    }

    try {
      const sub = await storage.getSubscription(orgId);
      const tier = (sub?.planTier as PlanTier) || "free";
      const plan = PLAN_DEFINITIONS[tier];
      if (!plan) return next();

      if (!plan.limits[feature]) {
        return res.status(403).json({
          message: errorMessage || `This feature requires a plan upgrade`,
          code: "PLAN_FEATURE_REQUIRED",
          feature,
          currentPlan: tier,
          upgradeUrl: "/settings?tab=billing",
        });
      }
      next();
    } catch (err) {
      logger.warn({ err }, "Plan feature check failed, failing open");
      next(); // Fail open
    }
  };
}

/** Grace period after a payment failure before hard-blocking the account (days) */
const DUNNING_GRACE_PERIOD_DAYS = 7;

/**
 * Middleware to block requests when subscription is past_due or canceled.
 * Allows read-only access (GET) but blocks mutations.
 * Implements a 7-day grace period for past_due: mutations are allowed during
 * the grace window with a warning header, then hard-blocked after.
 */
export function requireActiveSubscription() {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Allow GET requests (read-only) and auth routes
    if (req.method === "GET") return next();

    const orgId = req.orgId;
    if (!orgId) {
      return res.status(403).json({ message: "Organization context required", code: "ORG_REQUIRED" });
    }

    try {
      const sub = await storage.getSubscription(orgId);
      if (!sub) return next(); // Free tier, no subscription record

      if (sub.status === "past_due") {
        // Calculate grace period: allow access for DUNNING_GRACE_PERIOD_DAYS after first failure
        const gracePeriodMs = DUNNING_GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000;
        const pastDueAt = sub.pastDueAt ? new Date(sub.pastDueAt) : null;
        const graceExpiry = pastDueAt ? new Date(pastDueAt.getTime() + gracePeriodMs) : null;
        const inGracePeriod = graceExpiry ? Date.now() < graceExpiry.getTime() : true; // fail open if no timestamp

        if (inGracePeriod) {
          const daysLeft = graceExpiry
            ? Math.max(0, Math.ceil((graceExpiry.getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
            : DUNNING_GRACE_PERIOD_DAYS;
          res.setHeader("X-Subscription-Warning", "past_due");
          res.setHeader("X-Grace-Period-Days-Left", daysLeft.toString());
          return next();
        }

        return res.status(402).json({
          message:
            "Your subscription payment is past due and your grace period has expired. Please update your payment method.",
          code: "SUBSCRIPTION_PAST_DUE",
          status: sub.status,
          portalUrl: "/settings?tab=billing",
        });
      }

      if (sub.status === "canceled" || sub.status === "incomplete") {
        return res.status(403).json({
          message: "Your subscription is inactive. Please resubscribe to continue.",
          code: "SUBSCRIPTION_INACTIVE",
          status: sub.status,
          upgradeUrl: "/settings?tab=billing",
        });
      }

      next();
    } catch (err) {
      logger.warn({ err }, "Active subscription check failed, failing open");
      next(); // Fail open
    }
  };
}

// ============================================================================
// Seat Billing Sync
// ============================================================================

/**
 * Sync metered seat usage to Stripe. Called whenever users are added or removed.
 * Calculates seats above the plan's base allotment and reports to Stripe with
 * action="set" so only the current count is billed (not additive).
 * Non-blocking — failures are logged but do not surface to the caller.
 */
export async function syncSeatUsage(orgId: string): Promise<void> {
  const stripe = getStripe();
  if (!stripe) return;

  try {
    const sub = await storage.getSubscription(orgId);
    if (!sub?.stripeSeatsItemId) return; // no metered seat add-on on this subscription

    const tier = (sub.planTier as PlanTier) || "free";
    const plan = PLAN_DEFINITIONS[tier];
    if (!plan) return;

    const users = await storage.listUsersByOrg(orgId);
    const additionalSeats = Math.max(0, users.length - plan.limits.baseSeats);

    await reportSeatUsage(stripe, sub.stripeSeatsItemId, additionalSeats);
    logger.info({ orgId, additionalSeats, totalUsers: users.length }, "Seat usage synced");
  } catch (err) {
    logger.warn({ err, orgId }, "Seat usage sync failed (non-fatal)");
  }
}

/**
 * Report one overage call to Stripe. Called from the upload handler when
 * enforceQuota has set isOverQuota=true. Non-blocking — failures are logged only.
 */
export async function reportCallOverageToStripe(orgId: string): Promise<void> {
  const stripe = getStripe();
  if (!stripe) return;

  try {
    const sub = await storage.getSubscription(orgId);
    if (!sub?.stripeOverageItemId) return; // no overage meter on this subscription
    await reportCallOverage(stripe, sub.stripeOverageItemId);
    logger.info({ orgId }, "Call overage reported to Stripe");
  } catch (err) {
    logger.warn({ err, orgId }, "Call overage Stripe report failed (non-fatal)");
  }
}

// ============================================================================
// Billing Routes
// ============================================================================

export function registerBillingRoutes(app: Express): void {
  // --- Plan info (public) ---
  app.get("/api/billing/plans", (_req, res) => {
    const plans = PLAN_TIERS.map((tier) => ({
      tier,
      ...PLAN_DEFINITIONS[tier],
      stripeConfigured: isStripeConfigured() && !!getPriceId(tier, "monthly"),
    }));
    res.json(plans);
  });

  // --- Current subscription (authenticated) ---
  app.get("/api/billing/subscription", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const sub = await storage.getSubscription(req.orgId!);
      const tier = (sub?.planTier as PlanTier) || "free";
      const plan = PLAN_DEFINITIONS[tier];

      // Determine billing period bounds (use Stripe period if available, else calendar month)
      const now = new Date();
      const periodStart = sub?.currentPeriodStart
        ? new Date(sub.currentPeriodStart)
        : new Date(now.getFullYear(), now.getMonth(), 1);
      const periodEnd = sub?.currentPeriodEnd
        ? new Date(sub.currentPeriodEnd)
        : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

      const usage = await storage.getUsageSummary(req.orgId!, periodStart);
      const usageMap: Record<string, number> = {};
      for (const u of usage) {
        usageMap[u.eventType] = u.totalQuantity;
      }

      const callsThisMonth = usageMap["transcription"] || 0;
      const callLimit = plan.limits.callsPerMonth; // -1 = unlimited

      // --- Usage forecast ---
      const daysElapsed = Math.max(1, (now.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24));
      const totalDays = Math.max(1, (periodEnd.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24));
      const daysRemaining = Math.max(0, Math.ceil((periodEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
      const dailyCallRate = callsThisMonth / daysElapsed;
      const projectedCallsEom = Math.round(dailyCallRate * totalDays);
      const daysUntilCallQuotaExceeded =
        callLimit > 0 && dailyCallRate > 0
          ? Math.max(0, Math.floor((callLimit - callsThisMonth) / dailyCallRate))
          : null;

      // --- Grace period info for past_due ---
      let gracePeriodDaysLeft: number | null = null;
      if (sub?.status === "past_due" && sub.pastDueAt) {
        const gracePeriodMs = DUNNING_GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000;
        const graceExpiry = new Date(new Date(sub.pastDueAt).getTime() + gracePeriodMs);
        gracePeriodDaysLeft = Math.max(0, Math.ceil((graceExpiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
      }

      // --- Spend alert check (rate-limited to once per 24h) ---
      const org = await storage.getOrganization(req.orgId!);
      const alerts = org?.settings?.billingAlerts;
      if (alerts?.enabled && callLimit > 0) {
        const usagePct = Math.round((callsThisMonth / callLimit) * 100);
        const lastSent = alerts.lastQuotaAlertSentAt ? new Date(alerts.lastQuotaAlertSentAt) : null;
        const cooldownPassed = !lastSent || now.getTime() - lastSent.getTime() > 24 * 60 * 60 * 1000;
        if (cooldownPassed && usagePct >= (alerts.quotaThresholdPct ?? 80)) {
          const alertEmail = alerts.alertEmail || req.user!.username;
          const warnings = [{ label: "Calls", used: callsThisMonth, limit: callLimit, pct: usagePct }];
          const emailPayload = buildQuotaAlertEmail(org!.name, warnings, usagePct >= 100, req.get("origin") || "");
          emailPayload.to = alertEmail;
          sendEmail(emailPayload).catch((err) => logger.warn({ err, orgId: req.orgId }, "Quota alert email failed"));
          // Update lastQuotaAlertSentAt in org settings (fire-and-forget)
          const updatedSettings = {
            ...org!.settings,
            billingAlerts: { ...alerts, lastQuotaAlertSentAt: now.toISOString() },
          };
          storage.updateOrganization(req.orgId!, { settings: updatedSettings as any }).catch(() => {});
        }
      }

      res.json({
        subscription: sub || { planTier: "free", status: "active", billingInterval: "monthly" },
        plan,
        usage: {
          callsThisMonth,
          aiAnalysesThisMonth: usageMap["ai_analysis"] || 0,
          apiCallsThisMonth: usageMap["api_call"] || 0,
          storageMbUsed: usageMap["storage_mb"] || 0,
        },
        forecast: {
          projectedCallsEom,
          daysUntilCallQuotaExceeded,
          daysRemaining,
        },
        gracePeriodDaysLeft,
        stripeConfigured: isStripeConfigured(),
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to get subscription" });
    }
  });

  // --- Usage history (authenticated) ---
  app.get("/api/billing/usage", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const { months = "6" } = req.query;
      const numMonths = Math.min(parseInt(months as string) || 6, 12);

      const history: Array<{ month: string; usage: Record<string, number> }> = [];
      const now = new Date();

      for (let i = 0; i < numMonths; i++) {
        const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59);
        const usage = await storage.getUsageSummary(req.orgId!, start, end);

        const usageMap: Record<string, number> = {};
        for (const u of usage) usageMap[u.eventType] = u.totalQuantity;

        history.push({
          month: start.toISOString().slice(0, 7), // "2026-03"
          usage: usageMap,
        });
      }

      res.json(history.reverse()); // Chronological order
    } catch (error) {
      res.status(500).json({ message: "Failed to get usage history" });
    }
  });

  // --- Stripe Checkout (admin only) ---
  app.post("/api/billing/checkout", requireAuth, requireRole("admin"), injectOrgContext, async (req, res) => {
    const stripe = getStripe();
    if (!stripe) {
      return res.status(503).json({ message: "Stripe not configured" });
    }

    try {
      const { tier, interval = "monthly" } = req.body;
      if (!tier || !PLAN_TIERS.includes(tier)) {
        return res.status(400).json({ message: "Invalid plan tier" });
      }
      if (tier === "free") {
        return res.status(400).json({ message: "Cannot checkout for free plan" });
      }
      if (tier === "enterprise") {
        return res.status(400).json({
          message: "Enterprise plan requires contacting sales",
          code: "CONTACT_SALES_REQUIRED",
          contactUrl: "mailto:sales@observatory-qa.com",
        });
      }

      const priceId = getPriceId(tier as PlanTier, interval);
      if (!priceId) {
        return res.status(400).json({ message: `No Stripe price configured for ${tier}/${interval}` });
      }

      // Get or create Stripe customer
      const org = await storage.getOrganization(req.orgId!);
      const existingSub = await storage.getSubscription(req.orgId!);

      const customerId = await getOrCreateCustomer(
        stripe,
        req.orgId!,
        org?.name || "Unknown",
        req.user!.username,
        existingSub?.stripeCustomerId,
      );

      // Save customer ID if new
      if (!existingSub?.stripeCustomerId) {
        await storage.upsertSubscription(req.orgId!, {
          orgId: req.orgId!,
          planTier: existingSub?.planTier || "free",
          status: existingSub?.status || "active",
          stripeCustomerId: customerId,
          billingInterval: interval,
        });
      }

      const baseUrl = `${req.protocol}://${req.get("host")}`;
      const seatPriceId = getSeatPriceId(tier as PlanTier) ?? undefined;
      const overagePriceId = getOveragePriceId(tier as PlanTier) ?? undefined;
      const trialDays =
        existingSub?.planTier === "free" || !existingSub
          ? (PLAN_DEFINITIONS[tier as PlanTier].trialDays ?? undefined)
          : undefined; // No trial for existing paid subscribers
      const checkoutUrl = await createCheckoutSession(
        stripe,
        customerId,
        priceId,
        req.orgId!,
        `${baseUrl}/settings?tab=billing&checkout=success`,
        `${baseUrl}/settings?tab=billing&checkout=canceled`,
        seatPriceId,
        overagePriceId,
        trialDays,
      );

      logPhiAccess({
        ...auditContext(req),
        event: "billing_checkout_initiated",
        resourceType: "subscription",
        resourceId: req.orgId!,
        detail: `Plan: ${tier}, Interval: ${interval}`,
      });
      logger.info({ orgId: req.orgId, tier, interval }, "Checkout session created");
      res.json({ url: checkoutUrl });
    } catch (error) {
      logger.error({ err: error }, "Checkout session creation failed");
      res.status(500).json({ message: "Failed to create checkout session" });
    }
  });

  // --- Stripe Customer Portal (admin only) ---
  app.post("/api/billing/portal", requireAuth, requireRole("admin"), injectOrgContext, async (req, res) => {
    const stripe = getStripe();
    if (!stripe) {
      return res.status(503).json({ message: "Stripe not configured" });
    }

    try {
      const sub = await storage.getSubscription(req.orgId!);
      if (!sub?.stripeCustomerId) {
        return res.status(400).json({ message: "No Stripe customer found — subscribe first" });
      }

      const baseUrl = `${req.protocol}://${req.get("host")}`;
      const portalUrl = await createPortalSession(stripe, sub.stripeCustomerId, `${baseUrl}/settings?tab=billing`);

      res.json({ url: portalUrl });
    } catch (error) {
      logger.error({ err: error }, "Portal session creation failed");
      res.status(500).json({ message: "Failed to create portal session" });
    }
  });

  // --- Downgrade to free (admin only) ---
  app.post("/api/billing/downgrade", requireAuth, requireRole("admin"), injectOrgContext, async (req, res) => {
    try {
      const sub = await storage.getSubscription(req.orgId!);

      // Cancel Stripe subscription if exists
      const stripe = getStripe();
      if (stripe && sub?.stripeSubscriptionId) {
        try {
          await stripe.subscriptions.update(sub.stripeSubscriptionId, {
            cancel_at_period_end: true,
          });
          await storage.updateSubscription(req.orgId!, { cancelAtPeriodEnd: true });
          return res.json({ message: "Subscription will cancel at period end" });
        } catch (err) {
          logger.error({ err }, "Failed to cancel Stripe subscription");
        }
      }

      // No Stripe — just downgrade immediately (preserve customer ID for re-subscription)
      await storage.upsertSubscription(req.orgId!, {
        orgId: req.orgId!,
        planTier: "free",
        status: "active",
        billingInterval: "monthly",
        stripeCustomerId: sub?.stripeCustomerId,
      });

      logPhiAccess({
        ...auditContext(req),
        event: "billing_plan_downgraded",
        resourceType: "subscription",
        resourceId: req.orgId!,
        detail: `From: ${sub?.planTier || "unknown"}, To: free`,
      });
      logger.info({ orgId: req.orgId }, "Downgraded to free plan");
      res.json({ message: "Downgraded to free plan" });
    } catch (error) {
      res.status(500).json({ message: "Failed to downgrade" });
    }
  });

  // --- Mid-cycle plan upgrade (admin only) ---
  // Uses stripe.subscriptions.update() + proration instead of a new checkout session.
  // Only applicable when the org already has an active Stripe subscription.
  app.post("/api/billing/upgrade", requireAuth, requireRole("admin"), injectOrgContext, async (req, res) => {
    const stripe = getStripe();
    if (!stripe) {
      return res.status(503).json({ message: "Stripe not configured" });
    }

    try {
      const { tier, interval = "monthly" } = req.body;
      if (!tier || !PLAN_TIERS.includes(tier)) {
        return res.status(400).json({ message: "Invalid plan tier" });
      }
      if (tier === "free") {
        return res.status(400).json({ message: "Use /api/billing/downgrade to cancel" });
      }
      if (tier === "enterprise") {
        return res
          .status(400)
          .json({ message: "Enterprise plan requires contacting sales", code: "CONTACT_SALES_REQUIRED" });
      }

      const sub = await storage.getSubscription(req.orgId!);
      if (!sub?.stripeSubscriptionId || (sub.status !== "active" && sub.status !== "trialing")) {
        // No active subscription — fall back to checkout flow
        return res.status(400).json({
          message: "No active Stripe subscription found. Use /api/billing/checkout to subscribe.",
          code: "NO_ACTIVE_SUBSCRIPTION",
        });
      }

      const newPriceId = getPriceId(tier as PlanTier, interval);
      if (!newPriceId) {
        return res.status(400).json({ message: `No Stripe price configured for ${tier}/${interval}` });
      }

      // Retrieve current Stripe subscription to find existing item IDs
      const stripeSub = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId);
      const currentItems: any[] = (stripeSub as any).items?.data || [];
      const flatItem = currentItems.find((i: any) => i.price?.recurring?.usage_type !== "metered");
      const meteredItems = currentItems.filter((i: any) => i.price?.recurring?.usage_type === "metered");

      const newSeatPriceId = getSeatPriceId(tier as PlanTier);
      const newOveragePriceId = getOveragePriceId(tier as PlanTier);

      // Build items array: update flat-rate price, replace metered items
      const items: any[] = [];
      if (flatItem) {
        items.push({ id: flatItem.id, price: newPriceId });
      } else {
        items.push({ price: newPriceId, quantity: 1 });
      }
      // Remove old metered items; add new ones for the target tier
      for (const item of meteredItems) {
        items.push({ id: item.id, deleted: true });
      }
      if (newSeatPriceId) items.push({ price: newSeatPriceId });
      if (newOveragePriceId) items.push({ price: newOveragePriceId });

      const updatedSub = await stripe.subscriptions.update(sub.stripeSubscriptionId, {
        items,
        proration_behavior: "create_prorations",
        metadata: { orgId: req.orgId! },
      });

      // Extract new item IDs from the updated subscription
      const updatedItems: any[] = (updatedSub as any).items?.data || [];
      const newFlatItem = updatedItems.find((i: any) => i.price?.recurring?.usage_type !== "metered");
      const newSeatsItem = newSeatPriceId ? updatedItems.find((i: any) => i.price?.id === newSeatPriceId) : null;
      const newOverageItem = newOveragePriceId
        ? updatedItems.find((i: any) => i.price?.id === newOveragePriceId)
        : null;

      await storage.updateSubscription(req.orgId!, {
        planTier: tier as PlanTier,
        stripePriceId: newFlatItem?.price?.id,
        stripeSeatsItemId: newSeatsItem?.id || undefined,
        stripeOverageItemId: newOverageItem?.id || undefined,
        billingInterval: interval as "monthly" | "yearly",
        currentPeriodStart: new Date((updatedSub as any).current_period_start * 1000).toISOString(),
        currentPeriodEnd: new Date((updatedSub as any).current_period_end * 1000).toISOString(),
      });

      logPhiAccess({
        ...auditContext(req),
        event: "billing_plan_upgraded",
        resourceType: "subscription",
        resourceId: req.orgId!,
        detail: `From: ${sub.planTier}, To: ${tier}, Interval: ${interval}`,
      });
      logger.info(
        { orgId: req.orgId, from: sub.planTier, to: tier, interval },
        "Plan upgraded mid-cycle with proration",
      );

      // Sync seat usage to new tier
      await syncSeatUsage(req.orgId!);

      res.json({ success: true, planTier: tier, interval });
    } catch (error) {
      logger.error({ err: error }, "Mid-cycle upgrade failed");
      res.status(500).json({ message: "Failed to upgrade subscription" });
    }
  });

  // --- Billing alert configuration (admin only) ---
  app.patch("/api/billing/alerts", requireAuth, requireRole("admin"), injectOrgContext, async (req, res) => {
    try {
      const { enabled, quotaThresholdPct, alertEmail } = req.body;
      const org = await storage.getOrganization(req.orgId!);
      if (!org) return res.status(404).json({ message: "Organization not found" });

      const updatedSettings = {
        ...org.settings,
        billingAlerts: {
          enabled: enabled ?? org.settings?.billingAlerts?.enabled ?? false,
          quotaThresholdPct: quotaThresholdPct ?? org.settings?.billingAlerts?.quotaThresholdPct ?? 80,
          alertEmail: alertEmail ?? org.settings?.billingAlerts?.alertEmail,
          lastQuotaAlertSentAt: org.settings?.billingAlerts?.lastQuotaAlertSentAt,
        },
      };
      await storage.updateOrganization(req.orgId!, { settings: updatedSettings as any });
      logger.info({ orgId: req.orgId, enabled, quotaThresholdPct }, "Billing alerts updated");
      res.json({ success: true, billingAlerts: updatedSettings.billingAlerts });
    } catch (error) {
      res.status(500).json({ message: "Failed to update billing alerts" });
    }
  });

  // --- Seat usage sync (admin only) ---
  app.post("/api/billing/seats/sync", requireAuth, requireRole("admin"), injectOrgContext, async (req, res) => {
    const stripe = getStripe();
    if (!stripe) {
      return res.status(503).json({ message: "Stripe not configured" });
    }

    try {
      const sub = await storage.getSubscription(req.orgId!);
      if (!sub?.stripeSeatsItemId) {
        return res.status(400).json({
          message:
            "No metered seat add-on found on this subscription. Ensure STRIPE_PRICE_<TIER>_SEATS is configured and subscription was created with a seat price.",
        });
      }

      const tier = (sub.planTier as PlanTier) || "free";
      const plan = PLAN_DEFINITIONS[tier];
      const users = await storage.listUsersByOrg(req.orgId!);
      const additionalSeats = Math.max(0, users.length - plan.limits.baseSeats);

      await reportSeatUsage(stripe, sub.stripeSeatsItemId, additionalSeats);
      logger.info({ orgId: req.orgId, additionalSeats, totalUsers: users.length }, "Seat usage manually synced");

      res.json({
        totalUsers: users.length,
        baseSeats: plan.limits.baseSeats,
        additionalSeats,
        reportedToStripe: true,
      });
    } catch (error) {
      logger.error({ err: error }, "Failed to sync seat usage");
      res.status(500).json({ message: "Failed to sync seat usage" });
    }
  });

  // --- Stripe Webhook (unauthenticated — verified by signature) ---
  // NOTE: This route must use raw body parsing. The caller must configure
  // express.raw() for this path BEFORE express.json() middleware.
  app.post("/api/billing/webhook", async (req, res) => {
    const stripe = getStripe();
    if (!stripe) {
      return res.status(503).json({ message: "Stripe not configured" });
    }

    const sig = req.headers["stripe-signature"];
    if (!sig) {
      return res.status(400).json({ message: "Missing Stripe signature" });
    }

    let event;
    try {
      event = constructWebhookEvent(stripe, req.body, sig as string);
    } catch (err) {
      logger.error({ err }, "Webhook signature verification failed");
      return res.status(400).json({ message: "Invalid webhook signature" });
    }

    try {
      switch (event.type) {
        case "checkout.session.completed": {
          const session = event.data.object as any;
          const orgId = session.metadata?.orgId;
          if (!orgId) break;

          // Retrieve full subscription from Stripe
          if (session.subscription) {
            const stripeSub = await stripe.subscriptions.retrieve(session.subscription as string);
            const subData = stripeSub as any;
            const items: any[] = subData.items?.data || [];

            // The flat-rate item is the one whose price is NOT metered
            const flatItem = items.find((i: any) => i.price?.recurring?.usage_type !== "metered") || items[0];
            // Identify metered items by matching against known price env vars
            const seatsItem = findItemByKnownPriceId(items, [
              process.env.STRIPE_PRICE_STARTER_SEATS,
              process.env.STRIPE_PRICE_PROFESSIONAL_SEATS,
            ]);
            const overageItem = findItemByKnownPriceId(items, [
              process.env.STRIPE_PRICE_STARTER_OVERAGE,
              process.env.STRIPE_PRICE_PROFESSIONAL_OVERAGE,
            ]);

            const priceId = flatItem?.price?.id;
            const tier = resolveTierFromPriceId(priceId);
            const interval = flatItem?.price?.recurring?.interval === "year" ? "yearly" : "monthly";
            const stripeSeatsItemId = seatsItem?.id;
            const stripeOverageItemId = overageItem?.id;
            const isTrialing = subData.status === "trialing";

            await storage.upsertSubscription(orgId, {
              orgId,
              planTier: tier,
              status: isTrialing ? "trialing" : "active",
              stripeCustomerId: session.customer as string,
              stripeSubscriptionId: stripeSub.id,
              stripePriceId: priceId,
              stripeSeatsItemId,
              stripeOverageItemId,
              billingInterval: interval,
              currentPeriodStart: new Date(subData.current_period_start * 1000).toISOString(),
              currentPeriodEnd: new Date(subData.current_period_end * 1000).toISOString(),
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

            // Report initial seat count for metered billing
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
          break;
        }

        case "customer.subscription.updated": {
          const stripeSub = event.data.object as any;
          const orgId = stripeSub.metadata?.orgId;
          if (!orgId) break;

          const priceId = stripeSub.items?.data?.[0]?.price?.id;
          const tier = resolveTierFromPriceId(priceId);
          const interval = stripeSub.items?.data?.[0]?.price?.recurring?.interval === "year" ? "yearly" : "monthly";

          const statusMap: Record<string, string> = {
            active: "active",
            past_due: "past_due",
            canceled: "canceled",
            trialing: "trialing",
            incomplete: "incomplete",
          };

          await storage.updateSubscription(orgId, {
            planTier: tier,
            status: (statusMap[stripeSub.status] || stripeSub.status) as any,
            stripePriceId: priceId,
            billingInterval: interval as any,
            currentPeriodStart: new Date(stripeSub.current_period_start * 1000).toISOString(),
            currentPeriodEnd: new Date(stripeSub.current_period_end * 1000).toISOString(),
            cancelAtPeriodEnd: stripeSub.cancel_at_period_end || false,
          });
          logger.info({ orgId, tier, status: stripeSub.status }, "Subscription updated");
          break;
        }

        case "customer.subscription.deleted": {
          const stripeSub = event.data.object as any;
          const orgId = stripeSub.metadata?.orgId;
          if (!orgId) break;

          await storage.upsertSubscription(orgId, {
            orgId,
            planTier: "free",
            status: "canceled",
            billingInterval: "monthly",
            cancelAtPeriodEnd: false,
          });
          // Suspend org access on subscription cancellation — enforced by injectOrgContext gate.
          // Admins can contact support to reactivate or resubscribe.
          await storage.updateOrganization(orgId, { status: "suspended" } as any);
          logger.info({ orgId }, "Subscription canceled — org suspended, reverted to free");
          break;
        }

        case "invoice.payment_failed": {
          const invoice = event.data.object as any;
          const customerId = invoice.customer;
          if (!customerId) break;

          const sub = await storage.getSubscriptionByStripeCustomerId(customerId);
          if (sub) {
            const now = new Date();
            // Only set pastDueAt on the first failure (don't reset on retries)
            const pastDueAt = sub.pastDueAt || now.toISOString();
            await storage.updateSubscription(sub.orgId, { status: "past_due", pastDueAt });
            logger.warn({ orgId: sub.orgId, pastDueAt }, "Invoice payment failed — status set to past_due");

            // Send dunning email to admin
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
          break;
        }

        case "invoice.paid": {
          const invoice = event.data.object as any;
          const customerId = invoice.customer;
          if (!customerId) break;

          // Re-activate subscription if it was past_due, clear pastDueAt
          const sub = await storage.getSubscriptionByStripeCustomerId(customerId);
          if (sub && sub.status === "past_due") {
            await storage.updateSubscription(sub.orgId, { status: "active", pastDueAt: undefined });
            logger.info({ orgId: sub.orgId }, "Invoice paid — subscription re-activated from past_due");
          }
          break;
        }

        case "customer.subscription.trial_will_end": {
          const stripeSub = event.data.object as any;
          const orgId = stripeSub.metadata?.orgId;
          if (orgId) {
            const trialEnd = new Date(stripeSub.trial_end * 1000);
            logger.info({ orgId, trialEnd: trialEnd.toISOString() }, "Trial ending soon");
            // Send trial ending email to admin
            try {
              const org = await storage.getOrganization(orgId);
              const adminUsers = await storage.listUsersByOrg(orgId);
              const admin = adminUsers.find((u: any) => u.role === "admin");
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
          break;
        }

        default:
          logger.debug({ type: event.type }, "Unhandled Stripe event");
      }

      res.json({ received: true });
    } catch (error) {
      logger.error({ err: error, type: event.type }, "Webhook processing error");
      res.status(500).json({ message: "Webhook processing failed" });
    }
  });
}

/**
 * Find a Stripe subscription item whose price.id matches one of the given known price IDs.
 * Used to reliably distinguish seats vs overage metered items (rather than by position).
 */
function findItemByKnownPriceId(items: any[], knownIds: (string | undefined)[]): any | undefined {
  const validIds = knownIds.filter(Boolean) as string[];
  return items.find((i: any) => validIds.includes(i.price?.id));
}

/** Reverse-lookup a plan tier from a Stripe price ID */
function resolveTierFromPriceId(priceId?: string): PlanTier {
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
