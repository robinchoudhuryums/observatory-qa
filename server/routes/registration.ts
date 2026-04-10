import type { Express } from "express";
import passport from "passport";
import { readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { storage } from "../storage";
import { getDatabase } from "../db";
import { organizations } from "../db/schema";
import { eq } from "drizzle-orm";
import { requireAuth, requireRole, injectOrgContext, hashPassword, validatePasswordComplexity } from "../auth";
import { logger } from "../services/logger";
import { logPhiAccess, auditContext } from "../services/audit-log";
import { randomUUID } from "crypto";
import { enforceUserQuota, syncSeatUsage } from "./billing";
import { asyncHandler } from "../middleware/error-handler";

/**
 * Attempt to delete an organization by ID.
 * Used as a compensating action when user creation fails after org creation,
 * preventing orphaned organizations with no admin user.
 */
async function rollbackOrg(orgId: string): Promise<void> {
  try {
    const db = getDatabase();
    if (db) {
      await db.delete(organizations).where(eq(organizations.id, orgId));
      logger.info({ orgId }, "Rolled back orphaned organization after user creation failure");
    } else {
      // Non-PostgreSQL backend (memory/S3) — log for manual cleanup
      logger.error(
        { orgId },
        "CRITICAL: orphaned org created but cannot auto-rollback (non-postgres backend) — manual cleanup required",
      );
    }
  } catch (rollbackErr) {
    logger.error({ err: rollbackErr, orgId }, "CRITICAL: org rollback failed — orphaned org requires manual cleanup");
  }
}

export function registerRegistrationRoutes(app: Express): void {
  // ==================== SELF-SERVICE REGISTRATION ====================

  /**
   * Register a new organization + admin user.
   * Public endpoint — no auth required.
   */
  app.post("/api/auth/register", asyncHandler(async (req, res, next) => {
      const { orgName, orgSlug, username, password, name, industryType } = req.body;

      // Validate required fields
      if (!orgName || !orgSlug || !username || !password || !name) {
        return res.status(400).json({
          message: "orgName, orgSlug, username, password, and name are required",
        });
      }

      // Validate field lengths to prevent DoS via huge payloads
      if (orgName.length > 200 || orgSlug.length > 100 || username.length > 255 || name.length > 255) {
        return res.status(400).json({ message: "Field length exceeds maximum allowed" });
      }

      // Validate email format for username (used as email in invitations)
      const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!EMAIL_REGEX.test(username)) {
        return res.status(400).json({ message: "Username must be a valid email address" });
      }

      // Validate slug format
      if (!/^[a-z0-9-]+$/.test(orgSlug)) {
        return res.status(400).json({
          message: "Organization slug must be lowercase alphanumeric with hyphens only",
        });
      }

      // Block reserved slugs that could collide with API route prefixes or system paths
      const RESERVED_SLUGS = [
        "api", "admin", "auth", "billing", "health", "static", "assets",
        "login", "logout", "register", "callback", "webhook", "webhooks",
        "sso", "scim", "oauth", "mfa", "system", "super-admin", "internal",
      ];
      if (RESERVED_SLUGS.includes(orgSlug)) {
        return res.status(400).json({
          message: `"${orgSlug}" is a reserved name and cannot be used as an organization slug`,
        });
      }

      // Validate industryType against allowed values
      const VALID_INDUSTRIES = ["general", "dental", "medical", "behavioral_health", "veterinary"];
      if (industryType && !VALID_INDUSTRIES.includes(industryType)) {
        return res.status(400).json({
          message: `Invalid industry type. Must be one of: ${VALID_INDUSTRIES.join(", ")}`,
        });
      }

      // Validate password complexity (HIPAA)
      const pwError = validatePasswordComplexity(password);
      if (pwError) {
        return res.status(400).json({ message: pwError });
      }

      // Check slug uniqueness
      const existingOrg = await storage.getOrganizationBySlug(orgSlug);
      if (existingOrg) {
        return res.status(409).json({ message: "Organization slug already taken" });
      }

      // Username uniqueness will be enforced per-org by the database constraint.
      // No need to check globally — this is a new org being created.

      // Determine default call categories based on industry
      const dentalCategories = [
        "dental_scheduling",
        "dental_insurance",
        "dental_treatment",
        "dental_recall",
        "dental_emergency",
        "dental_encounter",
        "dental_consultation",
      ];
      const medicalCategories = ["inbound", "outbound", "clinical_encounter", "telemedicine"];
      const defaultCategories =
        industryType === "dental" ? dentalCategories : industryType === "medical" ? medicalCategories : undefined;

      // Create the organization
      const org = await storage.createOrganization({
        name: orgName,
        slug: orgSlug,
        status: "trial",
        settings: {
          retentionDays: 90,
          branding: { appName: orgName },
          industryType: industryType || undefined,
          callCategories: defaultCategories,
        },
      });

      // Create the admin user. If this fails we roll back the org so we never
      // leave an organization with no admin (a persistent broken state).
      let user: Awaited<ReturnType<typeof storage.createUser>>;
      try {
        const passwordHash = await hashPassword(password);
        user = await storage.createUser({
          orgId: org.id,
          username,
          passwordHash,
          name,
          role: "admin",
        });
      } catch (userErr) {
        await rollbackOrg(org.id);
        throw userErr;
      }

      logger.info({ orgId: org.id, userId: user.id, username, industryType }, "New organization registered");

      // Sync seat count to Stripe (fire-and-forget — no subscription yet for new orgs, no-op)
      syncSeatUsage(org.id).catch(() => {});

      // Auto-seed default prompt templates based on industry type.
      // Each industry has a curated set of templates in data/<industry>/default-prompt-templates.json.
      // Falls back to "general" templates if the specific industry file is not found.
      {
        const industry = industryType || "general";
        const templateDirs = [industry];
        // Always include general templates as a fallback for industries without their own
        if (industry !== "general") templateDirs.push("general");

        let seeded = false;
        for (const dir of templateDirs) {
          try {
            const templatesPath = join(process.cwd(), "data", dir, "default-prompt-templates.json");
            const rawTemplates = await readFile(templatesPath, "utf-8");
            const templates = JSON.parse(rawTemplates) as Array<{
              callCategory: string;
              name: string;
              evaluationCriteria: string;
              requiredPhrases?: unknown;
              scoringWeights?: unknown;
              additionalInstructions?: string;
            }>;
            for (const tmpl of templates) {
              await storage.createPromptTemplate(org.id, {
                orgId: org.id,
                callCategory: tmpl.callCategory,
                name: tmpl.name,
                evaluationCriteria: tmpl.evaluationCriteria,
                requiredPhrases: tmpl.requiredPhrases as any,
                scoringWeights: tmpl.scoringWeights as any,
                additionalInstructions: tmpl.additionalInstructions || undefined,
                isActive: true,
                isDefault: true,
              });
            }
            logger.info({ orgId: org.id, industry: dir, count: templates.length }, "Auto-seeded default prompt templates");
            seeded = true;
            break; // Use the first matching industry directory
          } catch (seedErr) {
            // File not found for this industry — try next in the fallback chain
            if (dir === industry && templateDirs.length > 1) continue;
            if (!seeded) {
              logger.warn({ err: seedErr, orgId: org.id, industry: dir }, "Failed to seed default templates — continuing without them");
            }
          }
        }
      }

      // Auto-login the new user
      const sessionUser = {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
        orgId: org.id,
        orgSlug: org.slug,
      };

      req.session.regenerate((regenErr) => {
        if (regenErr) return next(regenErr);
        req.login(sessionUser, (loginErr) => {
          if (loginErr) return next(loginErr);
          res.status(201).json({
            organization: { id: org.id, name: org.name, slug: org.slug },
            user: { id: user.id, username: user.username, name: user.name, role: user.role },
          });
        });
      });
    }));

  // ==================== INVITATION ROUTES ====================

  // List invitations for current org (admin/manager only)
  app.get("/api/invitations", requireAuth, requireRole("manager"), injectOrgContext, asyncHandler(async (req, res) => {
      const invitations = await storage.listInvitations(req.orgId!);
      res.json(invitations);
    }));

  // Create invitation (admin/manager only)
  app.post(
    "/api/invitations",
    requireAuth,
    requireRole("manager"),
    injectOrgContext,
    enforceUserQuota(),
    asyncHandler(async (req, res) => {
        const { email, role } = req.body;
        if (!email) {
          return res.status(400).json({ message: "Email is required" });
        }
        if (role && !["viewer", "manager", "admin"].includes(role)) {
          return res.status(400).json({ message: "Invalid role" });
        }

        // Check if user with this email already exists in the org
        const orgUsers = await storage.listUsersByOrg(req.orgId!);
        if (orgUsers.some((u) => u.username === email)) {
          return res.status(409).json({ message: "A user with this email already exists" });
        }

        // Check for existing pending invitation
        const existingInvites = await storage.listInvitations(req.orgId!);
        const pending = existingInvites.find((i) => i.email === email && i.status === "pending");
        if (pending) {
          return res.status(409).json({ message: "An invitation for this email is already pending" });
        }

        const invitation = await storage.createInvitation(req.orgId!, {
          orgId: req.orgId!,
          email,
          role: role || "viewer",
          invitedBy: req.user!.username,
        });

        logPhiAccess({
          ...auditContext(req),
          event: "invitation_sent",
          resourceType: "invitation",
          resourceId: invitation.id,
          detail: `Email: ${email}, Role: ${role || "viewer"}, Invited by: ${req.user!.username}`,
        });
        logger.info({ orgId: req.orgId, email, role: role || "viewer" }, "Invitation created");
        res.status(201).json(invitation);
      }),
  );

  // Accept invitation (public — requires valid token)
  app.post("/api/invitations/accept", asyncHandler(async (req, res, next) => {
      const { token, username, password, name } = req.body;
      if (!token || !username || !password || !name) {
        return res.status(400).json({ message: "token, username, password, and name are required" });
      }

      const pwErr = validatePasswordComplexity(password);
      if (pwErr) {
        return res.status(400).json({ message: pwErr });
      }

      // Find the invitation
      const invitation = await storage.getInvitationByToken(token);
      if (!invitation) {
        return res.status(404).json({ message: "Invalid or expired invitation" });
      }

      if (invitation.status !== "pending") {
        return res.status(400).json({ message: `Invitation has already been ${invitation.status}` });
      }

      // Check expiry
      if (invitation.expiresAt && new Date(invitation.expiresAt) < new Date()) {
        await storage.updateInvitation(invitation.orgId, invitation.id, { status: "expired" });
        return res.status(400).json({ message: "Invitation has expired" });
      }

      // Check username uniqueness within the invitation's org
      const existingUser = await storage.getUserByUsername(username, invitation.orgId);
      if (existingUser) {
        return res.status(409).json({ message: "Username already taken" });
      }

      // Create the user
      const passwordHash = await hashPassword(password);
      const user = await storage.createUser({
        orgId: invitation.orgId,
        username,
        passwordHash,
        name,
        role: invitation.role,
      });

      // Sync seat count to Stripe for the new user (fire-and-forget)
      syncSeatUsage(invitation.orgId).catch(() => {});

      // Mark invitation as accepted
      await storage.updateInvitation(invitation.orgId, invitation.id, {
        status: "accepted",
        acceptedAt: new Date().toISOString(),
      });

      logPhiAccess({
        orgId: invitation.orgId,
        userId: user.id,
        username,
        role: invitation.role,
        ip: req.ip || "unknown",
        userAgent: req.get("user-agent") || "unknown",
        event: "invitation_accepted",
        resourceType: "invitation",
        resourceId: invitation.id,
        detail: `New user: ${username} (${name}), Role: ${invitation.role}, Invited email: ${invitation.email}`,
      });

      // Resolve org for session
      const org = await storage.getOrganization(invitation.orgId);

      logger.info(
        { orgId: invitation.orgId, userId: user.id, username, email: invitation.email },
        "Invitation accepted",
      );

      // Auto-login
      const sessionUser = {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
        orgId: invitation.orgId,
        orgSlug: org?.slug || "default",
      };

      req.session.regenerate((regenErr) => {
        if (regenErr) return next(regenErr);
        req.login(sessionUser, (loginErr) => {
          if (loginErr) return next(loginErr);
          res.status(201).json({
            user: { id: user.id, username: user.username, name: user.name, role: user.role },
          });
        });
      });
  }));

  // Revoke invitation (admin/manager only)
  app.delete("/api/invitations/:id", requireAuth, requireRole("manager"), injectOrgContext, asyncHandler(async (req, res) => {
      logPhiAccess({
        ...auditContext(req),
        event: "invitation_revoked",
        resourceType: "invitation",
        resourceId: req.params.id,
      });
      await storage.deleteInvitation(req.orgId!, req.params.id);
      res.json({ message: "Invitation revoked" });
  }));

  // Get invitation details by token (public — for the accept page)
  app.get("/api/invitations/token/:token", asyncHandler(async (req, res) => {
    const invitation = await storage.getInvitationByToken(req.params.token);
    if (!invitation) {
      return res.status(404).json({ message: "Invalid or expired invitation" });
    }

    // Don't expose sensitive fields, just what the accept form needs
    const org = await storage.getOrganization(invitation.orgId);
    res.json({
      email: invitation.email,
      role: invitation.role,
      orgName: org?.name || "Unknown",
      status: invitation.status,
      expiresAt: invitation.expiresAt,
    });
  }));
}
