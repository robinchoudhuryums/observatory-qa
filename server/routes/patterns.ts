/**
 * Pattern subscriptions — manager-tracked alerts on recurring call clusters.
 *
 * Phase 3 of the Orrery redesign. UI lives in
 * `client/src/components/orrery/overlays/TrackPatternPopover.tsx`.
 *
 * Endpoints (all auth + org-scoped):
 *   GET    /api/patterns/subscriptions       — list subscriptions for current org
 *   POST   /api/patterns/subscribe           — create
 *   DELETE /api/patterns/subscribe/:id       — remove
 *
 * Storage methods (listPatternSubscriptions / createPatternSubscription /
 * deletePatternSubscription) are optional on IStorage — backends without
 * persistence return 503. PostgresStorage implements them via the
 * `pattern_subscriptions` table (sync-schema.ts).
 *
 * Notification delivery itself lives in the existing webhook pipeline and
 * isn't implemented here yet — subscriptions are stored but inert until the
 * digest worker is wired up (follow-on).
 */
import type { Express } from "express";
import { randomUUID } from "crypto";
import { storage } from "../storage";
import { requireAuth, injectOrgContext, requireRole } from "../auth";
import { asyncHandler } from "../middleware/error-handler";
import { logPhiAccess, auditContext } from "../services/audit-log";
import { logger } from "../services/logger";
import {
  insertPatternSubscriptionSchema,
  PATTERN_TRIGGER_KINDS,
} from "@shared/schema";

function patternSubscriptionsSupported(): boolean {
  return (
    typeof (storage as any).listPatternSubscriptions === "function" &&
    typeof (storage as any).createPatternSubscription === "function" &&
    typeof (storage as any).deletePatternSubscription === "function"
  );
}

export function registerPatternRoutes(app: Express): void {
  // List pattern subscriptions for the current org. Returns raw array per
  // INV-01. Filters out expired subscriptions client-side so UI doesn't
  // need to know the expiry rule.
  app.get(
    "/api/patterns/subscriptions",
    requireAuth,
    injectOrgContext,
    asyncHandler(async (req, res) => {
      const orgId = req.orgId!;
      if (!patternSubscriptionsSupported()) {
        return res.status(503).json({
          message: "Pattern subscriptions require PostgreSQL storage.",
        });
      }
      const all = await (storage as any).listPatternSubscriptions(orgId);
      const now = Date.now();
      const active = all.filter((s: any) => {
        if (!s.expiresAt) return true;
        const t = new Date(s.expiresAt).getTime();
        return Number.isFinite(t) && t > now;
      });
      logPhiAccess({
        ...auditContext(req),
        event: "list_pattern_subscriptions",
        resourceType: "pattern_subscription",
        detail: `${active.length} active`,
      });
      res.json(active);
    }),
  );

  // Create a subscription. Manager-only — viewers can browse patterns but
  // not opt into alerts (consistent with /api/coaching which is manager+).
  app.post(
    "/api/patterns/subscribe",
    requireAuth,
    injectOrgContext,
    requireRole("manager"),
    asyncHandler(async (req, res) => {
      const orgId = req.orgId!;
      if (!patternSubscriptionsSupported()) {
        return res.status(503).json({
          message: "Pattern subscriptions require PostgreSQL storage.",
        });
      }

      // Validate body.
      const parsed = insertPatternSubscriptionSchema.safeParse({
        ...req.body,
        orgId,
        createdBy: (req.user as any)?.id,
      });
      if (!parsed.success) {
        return res.status(400).json({
          message: "Invalid subscription",
          errors: parsed.error.flatten(),
        });
      }
      const sub = parsed.data;

      // Defensive guard — the Zod enum already enforces this, but a stray
      // payload from an old client could slip through if the enum drifted.
      if (!PATTERN_TRIGGER_KINDS.includes(sub.triggerKind)) {
        return res.status(400).json({ message: "Unknown triggerKind" });
      }

      // Sanity-check expiresAt: must be a valid future ISO timestamp.
      if (sub.expiresAt) {
        const t = new Date(sub.expiresAt).getTime();
        if (!Number.isFinite(t) || t <= Date.now()) {
          return res.status(400).json({ message: "expiresAt must be a future ISO timestamp" });
        }
      }

      try {
        const created = await (storage as any).createPatternSubscription(orgId, {
          id: randomUUID(),
          ...sub,
        });
        logPhiAccess({
          ...auditContext(req),
          event: "create_pattern_subscription",
          resourceType: "pattern_subscription",
          resourceId: created.id,
          detail: `patternKey=${sub.patternKey}, trigger=${sub.triggerKind}`,
        });
        res.status(201).json(created);
      } catch (error: any) {
        logger.error({ err: error, orgId }, "Failed to create pattern subscription");
        res.status(500).json({ message: "Failed to create subscription" });
      }
    }),
  );

  // Delete a subscription. Manager-only.
  app.delete(
    "/api/patterns/subscribe/:id",
    requireAuth,
    injectOrgContext,
    requireRole("manager"),
    asyncHandler(async (req, res) => {
      const orgId = req.orgId!;
      const id = req.params.id;
      if (!patternSubscriptionsSupported()) {
        return res.status(503).json({
          message: "Pattern subscriptions require PostgreSQL storage.",
        });
      }
      try {
        await (storage as any).deletePatternSubscription(orgId, id);
        logPhiAccess({
          ...auditContext(req),
          event: "delete_pattern_subscription",
          resourceType: "pattern_subscription",
          resourceId: id,
        });
        res.status(204).end();
      } catch (error: any) {
        logger.error({ err: error, orgId, id }, "Failed to delete pattern subscription");
        res.status(500).json({ message: "Failed to delete subscription" });
      }
    }),
  );
}
