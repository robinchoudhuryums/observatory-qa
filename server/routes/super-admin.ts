import type { Express } from "express";
import { storage } from "../storage";
import { requireAuth, requireSuperAdmin, unlockAccount, invalidateOrgCache } from "../auth";
import { logger } from "../services/logger";
import { logPhiAccess, auditContext } from "../services/audit-log";
import { invalidateOrgDek } from "../services/org-encryption";
import { PLAN_DEFINITIONS } from "@shared/schema";
import { asyncHandler } from "../middleware/error-handler";

/**
 * Super-admin routes — platform-level administration.
 * All routes require super_admin role (configured via SUPER_ADMIN_USERS env var).
 * These routes are NOT org-scoped — they operate across all organizations.
 */
export function registerSuperAdminRoutes(app: Express): void {
  // ==================== PLATFORM-WIDE STATS ====================

  /**
   * GET /api/super-admin/stats
   * Platform-wide statistics: total orgs, users, calls, active subscriptions.
   */
  app.get("/api/super-admin/stats", requireAuth, requireSuperAdmin, asyncHandler(async (_req, res) => {
      const orgs = await storage.listOrganizations();

      let totalUsers = 0;
      let totalCalls = 0;
      let activeSubscriptions = 0;

      for (const org of orgs) {
        const [userCount, callCount, subscription] = await Promise.all([
          storage.countUsersByOrg(org.id),
          storage.countCallsByOrg(org.id),
          storage.getSubscription(org.id),
        ]);
        totalUsers += userCount;
        totalCalls += callCount;
        if (subscription && subscription.status === "active") {
          activeSubscriptions++;
        }
      }

      const orgsByStatus = {
        active: orgs.filter((o) => o.status === "active").length,
        suspended: orgs.filter((o) => o.status === "suspended").length,
        trial: orgs.filter((o) => o.status === "trial").length,
      };

      res.json({
        totalOrganizations: orgs.length,
        totalUsers,
        totalCalls,
        activeSubscriptions,
        orgsByStatus,
      });
    }));

  // ==================== ORGANIZATION MANAGEMENT ====================

  /**
   * GET /api/super-admin/organizations
   * List all organizations with stats (user count, call count, subscription status).
   */
  app.get("/api/super-admin/organizations", requireAuth, requireSuperAdmin, asyncHandler(async (_req, res) => {
      const orgs = await storage.listOrganizations();

      const orgsWithStats = await Promise.all(
        orgs.map(async (org) => {
          const [userCount, callCount, subscription] = await Promise.all([
            storage.countUsersByOrg(org.id),
            storage.countCallsByOrg(org.id),
            storage.getSubscription(org.id),
          ]);

          return {
            id: org.id,
            name: org.name,
            slug: org.slug,
            status: org.status,
            createdAt: org.createdAt,
            settings: {
              industryType: org.settings?.industryType,
              retentionDays: org.settings?.retentionDays,
            },
            stats: {
              userCount,
              callCount,
              subscriptionStatus: subscription?.status || "none",
              planTier: subscription?.planTier || "free",
            },
          };
        }),
      );

      res.json(orgsWithStats);
    }));

  /**
   * GET /api/super-admin/organizations/:id
   * Get detailed information about a specific organization.
   */
  app.get("/api/super-admin/organizations/:id", requireAuth, requireSuperAdmin, asyncHandler(async (req, res) => {
      const org = await storage.getOrganization(req.params.id);
      if (!org) {
        return res.status(404).json({ message: "Organization not found" });
      }

      const [users, userCount, callCount, callsByStatus, subscription] = await Promise.all([
        storage.listUsersByOrg(org.id),
        storage.countUsersByOrg(org.id),
        storage.countCallsByOrg(org.id),
        storage.countCallsByOrgAndStatus(org.id),
        storage.getSubscription(org.id),
      ]);

      res.json({
        ...org,
        stats: {
          userCount,
          callCount,
          callsByStatus,
          subscriptionStatus: subscription?.status || "none",
          planTier: subscription?.planTier || "free",
          billingInterval: subscription?.billingInterval,
          currentPeriodEnd: subscription?.currentPeriodEnd,
        },
        users: users.map((u) => ({
          id: u.id,
          username: u.username,
          name: u.name,
          role: u.role,
          createdAt: u.createdAt,
        })),
      });
    }));

  /**
   * PATCH /api/super-admin/organizations/:id
   * Update an organization's status or settings (super admin only).
   */
  app.patch("/api/super-admin/organizations/:id", requireAuth, requireSuperAdmin, asyncHandler(async (req, res) => {
      const org = await storage.getOrganization(req.params.id);
      if (!org) {
        return res.status(404).json({ message: "Organization not found" });
      }

      const { status, settings, name } = req.body;
      const updates: Record<string, unknown> = {};

      if (status && ["active", "suspended", "trial", "deleted"].includes(status)) {
        updates.status = status;
      }
      if (name && typeof name === "string") {
        updates.name = name;
      }
      if (settings && typeof settings === "object") {
        // Merge with existing settings
        updates.settings = { ...(org.settings || {}), ...settings };
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ message: "No valid fields to update" });
      }

      const updated = await storage.updateOrganization(req.params.id, updates as any);
      invalidateOrgCache(req.params.id);

      // Audit log
      logPhiAccess({
        ...auditContext(req),
        event: "super_admin_org_update",
        resourceType: "organization",
        resourceId: req.params.id,
        detail: JSON.stringify({ changedFields: Object.keys(updates) }),
      });

      logger.info(
        { orgId: req.params.id, changedFields: Object.keys(updates), superAdmin: req.user?.username },
        "Super admin updated organization",
      );
      res.json(updated);
    }));

  /**
   * POST /api/super-admin/organizations/:id/impersonate
   * Set session to act as an admin of the target organization.
   * This is a session-level flag — it does NOT permanently change the user.
   * Use DELETE /api/super-admin/impersonate to stop impersonating.
   */
  app.post("/api/super-admin/organizations/:id/impersonate", requireAuth, requireSuperAdmin, asyncHandler(async (req, res) => {
      const org = await storage.getOrganization(req.params.id);
      if (!org) {
        return res.status(404).json({ message: "Organization not found" });
      }

      const session = req.session as any;
      session.impersonatingOrgId = org.id;
      session.originalOrgId = req.user!.orgId;
      session.impersonationStartedAt = Date.now();

      // Audit log — impersonation is a sensitive action
      logPhiAccess({
        ...auditContext(req),
        event: "super_admin_impersonate_start",
        resourceType: "organization",
        resourceId: org.id,
        detail: `Super admin ${req.user!.username} started impersonating org "${org.name}" (${org.slug})`,
      });

      logger.warn(
        { superAdmin: req.user?.username, targetOrg: org.slug, orgId: org.id },
        "Super admin started org impersonation",
      );
      res.json({
        message: `Now impersonating organization "${org.name}" (${org.slug})`,
        orgId: org.id,
        orgSlug: org.slug,
        orgName: org.name,
      });
    }));

  /**
   * DELETE /api/super-admin/impersonate
   * Stop impersonating an organization and return to the super admin's own context.
   */
  app.delete("/api/super-admin/impersonate", requireAuth, requireSuperAdmin, asyncHandler(async (req, res) => {
      const session = req.session as any;
      const wasImpersonating = session.impersonatingOrgId;

      if (!wasImpersonating) {
        return res.status(400).json({ message: "Not currently impersonating any organization" });
      }

      // Audit log
      logPhiAccess({
        ...auditContext(req),
        event: "super_admin_impersonate_stop",
        resourceType: "organization",
        resourceId: wasImpersonating,
        detail: `Super admin ${req.user!.username} stopped impersonating org ${wasImpersonating}`,
      });

      delete session.impersonatingOrgId;
      delete session.originalOrgId;
      delete session.impersonationStartedAt;

      logger.info(
        { superAdmin: req.user?.username, previousOrgId: wasImpersonating },
        "Super admin stopped org impersonation",
      );
      res.json({ message: "Stopped impersonating organization" });
    }));

  /**
   * POST /api/super-admin/unlock-account
   * Break-glass: immediately clear a locked-out account so the user can log in.
   * Use when an org admin is locked out and cannot wait for the 15-minute auto-expiry.
   * Requires: super_admin role. Every invocation is written to the tamper-evident audit log.
   */
  app.post("/api/super-admin/unlock-account", requireAuth, requireSuperAdmin, asyncHandler(async (req, res) => {
      const { username } = req.body as { username?: string };
      if (!username || typeof username !== "string") {
        return res.status(400).json({ message: "username is required", code: "OBS-VALID-001" });
      }

      await unlockAccount(username);

      logPhiAccess({
        ...auditContext(req),
        event: "emergency_account_unlock",
        resourceType: "user",
        detail: `Super admin unlocked account: ${username}`,
      });

      logger.warn(
        { superAdmin: req.user?.username, unlockedUsername: username },
        "Super admin performed emergency account unlock",
      );
      res.json({ message: `Account '${username}' unlocked successfully` });
    }));

  // ==================== TENANT USAGE DASHBOARD ====================

  /**
   * GET /api/super-admin/usage
   * Per-org resource consumption aggregates for cost visibility and capacity planning.
   * Uses efficient SQL aggregates for PostgreSQL backends; falls back to per-org queries otherwise.
   */
  app.get("/api/super-admin/usage", requireAuth, requireSuperAdmin, asyncHandler(async (_req, res) => {
      const orgs = await storage.listOrganizations();

      const orgsWithUsage = await Promise.all(
        orgs.map(async (org) => {
          const [usageSummary, subscription] = await Promise.all([
            storage.getOrgUsageSummary(org.id),
            storage.getSubscription(org.id),
          ]);

          const plan = subscription ? PLAN_DEFINITIONS[subscription.planTier as keyof typeof PLAN_DEFINITIONS] : null;
          const callLimit = plan?.limits?.callsPerMonth ?? 50;
          const overageCount = Math.max(0, usageSummary.totalCalls - callLimit);

          return {
            orgId: org.id,
            orgName: org.name,
            orgSlug: org.slug,
            status: org.status,
            planTier: subscription?.planTier || "free",
            callCount: usageSummary.totalCalls,
            completedCallCount: usageSummary.completedCalls,
            totalTranscriptionSeconds: usageSummary.totalDurationSeconds,
            userCount: await storage.countUsersByOrg(org.id),
            employeeCount: usageSummary.employeeCount,
            estimatedStorageMb: Math.round((usageSummary.totalDurationSeconds * 0.5) / 1024), // rough estimate: 0.5 KB/s
            totalEstimatedCostUsd: Math.round(usageSummary.totalEstimatedCostUsd * 100) / 100,
            quotaUsed: {
              calls: usageSummary.totalCalls,
              limit: callLimit,
              overageCount,
            },
            subscription: subscription
              ? {
                  status: subscription.status,
                  planTier: subscription.planTier,
                  billingInterval: subscription.billingInterval,
                }
              : null,
          };
        }),
      );

      const platformTotals = {
        totalOrgs: orgs.length,
        totalCalls: orgsWithUsage.reduce((sum, o) => sum + o.callCount, 0),
        totalTranscriptionHours: Math.round(
          orgsWithUsage.reduce((sum, o) => sum + o.totalTranscriptionSeconds, 0) / 3600,
        ),
        totalEstimatedCostUsd:
          Math.round(orgsWithUsage.reduce((sum, o) => sum + o.totalEstimatedCostUsd, 0) * 100) / 100,
        totalUsers: orgsWithUsage.reduce((sum, o) => sum + o.userCount, 0),
      };

      logger.info({ superAdmin: "super_admin", orgCount: orgs.length }, "Super admin fetched platform usage dashboard");
      res.json({
        generatedAt: new Date().toISOString(),
        orgs: orgsWithUsage,
        platformTotals,
      });
    }));

  // ==================== PER-ORG KEY ROTATION ====================

  /**
   * POST /api/super-admin/organizations/:id/rotate-key
   * Rotate the per-org KMS data encryption key (DEK).
   * Evicts the cached DEK so the next PHI access generates a new DEK via KMS.
   * For full rotation: also clears the stored encrypted DEK so a fresh one is generated.
   */
  app.post("/api/super-admin/organizations/:id/rotate-key", requireAuth, requireSuperAdmin, asyncHandler(async (req, res) => {
      const org = await storage.getOrganization(req.params.id);
      if (!org) {
        return res.status(404).json({ message: "Organization not found" });
      }

      // Evict the in-memory DEK cache for this org
      invalidateOrgDek(org.id);

      // Clear the stored encrypted DEK in org settings so a fresh DEK is generated on next access
      const currentSettings = (org.settings || {}) as Record<string, unknown>;
      delete currentSettings.encryptedDataKey;
      await storage.updateOrganization(org.id, { settings: currentSettings as any });
      invalidateOrgCache(org.id);

      logPhiAccess({
        ...auditContext(req),
        event: "org_key_rotation",
        resourceType: "organization",
        resourceId: org.id,
        detail: `Super admin ${req.user?.username} rotated encryption key for org "${org.name}" (${org.slug})`,
      });

      logger.warn(
        { superAdmin: req.user?.username, orgId: org.id, orgSlug: org.slug },
        "Super admin rotated per-org DEK — next PHI access will generate a new key via KMS",
      );

      res.json({
        success: true,
        message: "Key rotated — next PHI access will generate a new DEK via KMS",
        orgId: org.id,
      });
    }));
}
