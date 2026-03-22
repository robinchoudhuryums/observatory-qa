import type { Express } from "express";
import passport from "passport";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { storage } from "../storage";
import { requireAuth, requireRole, injectOrgContext, hashPassword, validatePasswordComplexity } from "../auth";
import { logger } from "../services/logger";
import { logPhiAccess, auditContext } from "../services/audit-log";
import { randomUUID } from "crypto";
import { enforceUserQuota } from "./billing";

export function registerRegistrationRoutes(app: Express): void {
  // ==================== SELF-SERVICE REGISTRATION ====================

  /**
   * Register a new organization + admin user.
   * Public endpoint — no auth required.
   */
  app.post("/api/auth/register", async (req, res, next) => {
    try {
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
        "dental_scheduling", "dental_insurance", "dental_treatment",
        "dental_recall", "dental_emergency", "dental_encounter", "dental_consultation",
      ];
      const healthcareCategories = ["inbound", "outbound", "clinical_encounter", "telemedicine"];
      const defaultCategories = industryType === "dental" ? dentalCategories
        : industryType === "healthcare" ? healthcareCategories
        : undefined;

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

      // Create the admin user
      const passwordHash = await hashPassword(password);
      const user = await storage.createUser({
        orgId: org.id,
        username,
        passwordHash,
        name,
        role: "admin",
      });

      logger.info({ orgId: org.id, userId: user.id, username, industryType }, "New organization registered");

      // Auto-seed default prompt templates based on industry type
      if (industryType === "dental") {
        try {
          const templatesPath = join(process.cwd(), "data", "dental", "default-prompt-templates.json");
          const rawTemplates = readFileSync(templatesPath, "utf-8");
          const templates = JSON.parse(rawTemplates) as Array<{
            callCategory: string; name: string; evaluationCriteria: string;
            requiredPhrases?: unknown; scoringWeights?: unknown; additionalInstructions?: string;
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
            });
          }
          logger.info({ orgId: org.id, count: templates.length }, "Auto-seeded dental prompt templates");
        } catch (seedErr) {
          logger.warn({ err: seedErr, orgId: org.id }, "Failed to seed dental templates — continuing without them");
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
    } catch (error) {
      logger.error({ err: error }, "Registration failed");
      res.status(500).json({ message: "Registration failed" });
    }
  });

  // ==================== INVITATION ROUTES ====================

  // List invitations for current org (admin/manager only)
  app.get("/api/invitations", requireAuth, requireRole("manager"), injectOrgContext, async (req, res) => {
    try {
      const invitations = await storage.listInvitations(req.orgId!);
      res.json(invitations);
    } catch (error) {
      res.status(500).json({ message: "Failed to list invitations" });
    }
  });

  // Create invitation (admin/manager only)
  app.post("/api/invitations", requireAuth, requireRole("manager"), injectOrgContext, enforceUserQuota(), async (req, res) => {
    try {
      const { email, role } = req.body;
      if (!email) {
        return res.status(400).json({ message: "Email is required" });
      }
      if (role && !["viewer", "manager", "admin"].includes(role)) {
        return res.status(400).json({ message: "Invalid role" });
      }

      // Check if user with this email already exists in the org
      const orgUsers = await storage.listUsersByOrg(req.orgId!);
      if (orgUsers.some(u => u.username === email)) {
        return res.status(409).json({ message: "A user with this email already exists" });
      }

      // Check for existing pending invitation
      const existingInvites = await storage.listInvitations(req.orgId!);
      const pending = existingInvites.find(i => i.email === email && i.status === "pending");
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
    } catch (error) {
      logger.error({ err: error }, "Failed to create invitation");
      res.status(500).json({ message: "Failed to create invitation" });
    }
  });

  // Accept invitation (public — requires valid token)
  app.post("/api/invitations/accept", async (req, res, next) => {
    try {
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

      logger.info({ orgId: invitation.orgId, userId: user.id, username, email: invitation.email }, "Invitation accepted");

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
    } catch (error) {
      logger.error({ err: error }, "Failed to accept invitation");
      res.status(500).json({ message: "Failed to accept invitation" });
    }
  });

  // Revoke invitation (admin/manager only)
  app.delete("/api/invitations/:id", requireAuth, requireRole("manager"), injectOrgContext, async (req, res) => {
    try {
      logPhiAccess({
        ...auditContext(req),
        event: "invitation_revoked",
        resourceType: "invitation",
        resourceId: req.params.id,
      });
      await storage.deleteInvitation(req.orgId!, req.params.id);
      res.json({ message: "Invitation revoked" });
    } catch (error) {
      res.status(500).json({ message: "Failed to revoke invitation" });
    }
  });

  // Get invitation details by token (public — for the accept page)
  app.get("/api/invitations/token/:token", async (req, res) => {
    try {
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
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch invitation details" });
    }
  });
}
