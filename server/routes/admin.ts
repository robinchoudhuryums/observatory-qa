import type { Express } from "express";
import { storage } from "../storage";
import {
  requireAuth,
  requireRole,
  injectOrgContext,
  hashPassword,
  validatePasswordComplexity,
  invalidateOrgCache,
} from "../auth";
import { aiProvider } from "../services/ai-factory";
import { assemblyAIService } from "../services/assemblyai";
import { broadcastCallUpdate } from "../services/websocket";
import { insertPromptTemplateSchema, orgSettingsSchema, PLAN_DEFINITIONS, type OrgSettings } from "@shared/schema";
import { logger } from "../services/logger";
import { logPhiAccess, auditContext } from "../services/audit-log";
import { safeInt, withRetry } from "./helpers";
import { enqueueReanalysis } from "../services/queue";
import { requirePlanFeature, enforceUserQuota, syncSeatUsage } from "./billing";
import { errorResponse, ERROR_CODES } from "../services/error-codes";
import { parsePagination, paginateArray } from "./helpers";
import { asyncHandler } from "../middleware/error-handler";
import { getRedis, invalidateUserSessions } from "../services/redis";
import { generateScimToken } from "./scim";
import { parseCertExpiry } from "./sso";
import { registerAdminSecurityRoutes } from "./admin-security.routes";

export function registerAdminRoutes(app: Express): void {
  // ==================== PROMPT TEMPLATE ROUTES (admin only) ====================

  app.get(
    "/api/prompt-templates",
    requireAuth,
    injectOrgContext,
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const templates = await storage.getAllPromptTemplates(req.orgId!);
      res.json(templates);
    }),
  );

  app.post(
    "/api/prompt-templates",
    requireAuth,
    injectOrgContext,
    requireRole("admin"),
    requirePlanFeature("customPromptTemplates", "Custom prompt templates require a Pro or Enterprise plan"),
    asyncHandler(async (req, res) => {
      const parsed = insertPromptTemplateSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ message: "Invalid template data", errors: parsed.error.flatten() });
        return;
      }
      const template = await storage.createPromptTemplate(req.orgId!, {
        ...parsed.data,
        updatedBy: req.user?.username,
      });
      logPhiAccess({
        ...auditContext(req),
        event: "prompt_template_created",
        resourceType: "prompt_template",
        resourceId: template.id,
        detail: `Category: ${parsed.data.callCategory || "default"}, Created by: ${req.user?.username}`,
      });
      res.status(201).json(template);
    }),
  );

  app.patch(
    "/api/prompt-templates/:id",
    requireAuth,
    injectOrgContext,
    requireRole("admin"),
    requirePlanFeature("customPromptTemplates", "Custom prompt templates require a Pro or Enterprise plan"),
    asyncHandler(async (req, res) => {
      // Validate the update: allow only known template fields
      const { updatedBy: _ignore, id: _ignoreId, ...bodyWithoutMeta } = req.body;
      const templateUpdateParsed = insertPromptTemplateSchema.partial().safeParse(bodyWithoutMeta);
      if (!templateUpdateParsed.success) {
        res.status(400).json({ message: "Invalid template data", errors: templateUpdateParsed.error.flatten() });
        return;
      }
      const updated = await storage.updatePromptTemplate(req.orgId!, req.params.id, {
        ...templateUpdateParsed.data,
        updatedBy: req.user?.username,
      });
      if (!updated) {
        res.status(404).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Template not found"));
        return;
      }
      logPhiAccess({
        ...auditContext(req),
        event: "prompt_template_updated",
        resourceType: "prompt_template",
        resourceId: req.params.id,
        detail: `Fields changed: ${Object.keys(templateUpdateParsed.data).join(", ")}, Updated by: ${req.user?.username}`,
      });
      res.json(updated);
    }),
  );

  app.delete(
    "/api/prompt-templates/:id",
    requireAuth,
    injectOrgContext,
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      logPhiAccess({
        ...auditContext(req),
        event: "prompt_template_deleted",
        resourceType: "prompt_template",
        resourceId: req.params.id,
      });
      await storage.deletePromptTemplate(req.orgId!, req.params.id);
      res.json({ message: "Template deleted" });
    }),
  );

  // Reset prompt templates to industry defaults — deletes all existing templates
  // and re-seeds from the default template files for the org's industry type.
  app.post(
    "/api/prompt-templates/reset-defaults",
    requireAuth,
    injectOrgContext,
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const orgId = req.orgId!;
      const org = await storage.getOrganization(orgId);
      const industry = (org?.settings as any)?.industryType || "general";

      // Delete all existing templates for this org
      const existing = await storage.getAllPromptTemplates(orgId);
      for (const tmpl of existing) {
        await storage.deletePromptTemplate(orgId, tmpl.id);
      }

      // Re-seed from industry defaults (with general fallback)
      const { readFile } = await import("fs/promises");
      const { join } = await import("path");
      const templateDirs = [industry];
      if (industry !== "general") templateDirs.push("general");

      let seeded = 0;
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
            await storage.createPromptTemplate(orgId, {
              orgId,
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
          seeded = templates.length;
          break;
        } catch {
          if (dir === industry && templateDirs.length > 1) continue;
        }
      }

      logPhiAccess({
        ...auditContext(req),
        event: "prompt_templates_reset_to_defaults",
        resourceType: "prompt_template",
        detail: `Deleted ${existing.length} templates, seeded ${seeded} defaults (industry: ${industry})`,
      });
      const newTemplates = await storage.getAllPromptTemplates(orgId);
      res.json({ message: "Templates reset to defaults", count: seeded, templates: newTemplates });
    }),
  );

  // Bulk re-analysis: re-analyze recent calls using updated prompt template
  app.post(
    "/api/calls/reanalyze",
    requireAuth,
    injectOrgContext,
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const { callCategory, limit: maxCalls } = req.body;
      if (!callCategory || typeof callCategory !== "string") {
        res.status(400).json({ message: "callCategory is required" });
        return;
      }

      if (!aiProvider.isAvailable) {
        res.status(503).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "AI provider not configured"));
        return;
      }

      const reanalysisLimit = Math.min(safeInt(maxCalls, 10), 50);
      const allCalls = await storage.getCallsWithDetails(req.orgId!, { status: "completed" });

      // Filter to calls matching the category
      const targetCalls = allCalls
        .filter((c) => c.callCategory === callCategory && c.transcript?.text)
        .slice(0, reanalysisLimit);

      if (targetCalls.length === 0) {
        res.json({ message: "No matching calls found", queued: 0 });
        return;
      }

      // Load the prompt template for this category
      let promptTemplate = undefined;
      const tmpl = await storage.getPromptTemplateByCategory(req.orgId!, callCategory);
      if (tmpl) {
        promptTemplate = {
          evaluationCriteria: tmpl.evaluationCriteria,
          requiredPhrases: tmpl.requiredPhrases,
          scoringWeights: tmpl.scoringWeights,
          additionalInstructions: tmpl.additionalInstructions,
        };
      }

      const orgId = req.orgId!;
      const queued = targetCalls.length;
      const callIds = targetCalls.map((c) => c.id);

      // Try BullMQ queue first; fall back to in-process execution
      const enqueued = await enqueueReanalysis({
        orgId,
        callIds,
        requestedBy: req.user?.username || "unknown",
      });

      if (enqueued) {
        res.json({ message: `Re-analysis queued for ${queued} calls`, queued });
        return;
      }

      // Fallback: in-process execution (no Redis)
      res.json({ message: `Re-analysis started for ${queued} calls (in-process)`, queued });

      (async () => {
        let succeeded = 0;
        let failed = 0;
        for (const call of targetCalls) {
          try {
            const transcriptText = call.transcript!.text!;
            const aiAnalysis = await withRetry(
              () => aiProvider.analyzeCallTranscript(transcriptText, call.id, callCategory, promptTemplate),
              { retries: 1, baseDelay: 2000, label: `reanalyze ${call.id}` },
            );

            const { analysis } = assemblyAIService.processTranscriptData(
              { id: "", status: "completed", text: transcriptText, words: call.transcript?.words as any },
              aiAnalysis,
              call.id,
              req.orgId!,
            );

            if (aiAnalysis.sub_scores) {
              analysis.subScores = {
                compliance: aiAnalysis.sub_scores.compliance ?? 0,
                customerExperience: aiAnalysis.sub_scores.customer_experience ?? 0,
                communication: aiAnalysis.sub_scores.communication ?? 0,
                resolution: aiAnalysis.sub_scores.resolution ?? 0,
              };
            }
            if (aiAnalysis.detected_agent_name) {
              analysis.detectedAgentName = aiAnalysis.detected_agent_name;
            }

            await storage.createCallAnalysis(orgId, { ...analysis, callId: call.id });
            succeeded++;
          } catch (error) {
            logger.error({ err: error, callId: call.id }, "Reanalysis failed for call");
            failed++;
          }
        }
        logger.info({ succeeded, failed, total: queued }, "Reanalysis complete");
        broadcastCallUpdate("bulk", "reanalysis_complete", { succeeded, failed, total: queued }, orgId);
      })().catch((err) => logger.error({ err }, "Bulk re-analysis failed"));
    }),
  );

  // ============================================================
  // USER MANAGEMENT (database-backed, admin only)
  // ============================================================

  // List all users in the current organization (paginated)
  app.get(
    "/api/users",
    requireAuth,
    requireRole("admin"),
    injectOrgContext,
    asyncHandler(async (req, res) => {
      const { limit, offset } = parsePagination(req.query);
      const users = await storage.listUsersByOrg(req.orgId!);
      // Return users without password hashes
      const sanitized = users.map((u) => ({
        id: u.id,
        username: u.username,
        name: u.name,
        role: u.role,
        orgId: u.orgId,
        createdAt: u.createdAt,
      }));
      res.json(sanitized);
    }),
  );

  // Create a new user (admin only)
  app.post(
    "/api/users",
    requireAuth,
    requireRole("admin"),
    injectOrgContext,
    enforceUserQuota(),
    asyncHandler(async (req, res) => {
      const { username, password, name, role } = req.body;
      if (!username || !password || !name) {
        return res
          .status(400)
          .json(errorResponse(ERROR_CODES.VALIDATION_ERROR, "username, password, and name are required"));
      }
      // Validate field lengths
      if (username.length > 255 || name.length > 255) {
        return res
          .status(400)
          .json(errorResponse(ERROR_CODES.VALIDATION_ERROR, "Field length exceeds maximum allowed"));
      }
      // Validate email format for username
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(username)) {
        return res
          .status(400)
          .json(errorResponse(ERROR_CODES.VALIDATION_ERROR, "Username must be a valid email address"));
      }
      if (!["viewer", "manager", "admin"].includes(role || "viewer")) {
        return res.status(400).json(errorResponse(ERROR_CODES.VALIDATION_ERROR, "Invalid role"));
      }

      // HIPAA: Enforce password complexity
      const complexityError = validatePasswordComplexity(password);
      if (complexityError) {
        return res.status(400).json({ message: complexityError });
      }

      // Check if username already exists within this org
      const existing = await storage.getUserByUsername(username, req.orgId!);
      if (existing) {
        return res.status(409).json({ message: "Username already exists" });
      }

      const passwordHash = await hashPassword(password);

      const user = await storage.createUser({
        orgId: req.orgId!,
        username,
        passwordHash,
        name,
        role: role || "viewer",
      });

      logPhiAccess({
        ...auditContext(req),
        event: "create_user",
        resourceType: "user",
        resourceId: user.id,
        detail: `Created user ${username} with role ${role || "viewer"}`,
      });
      logger.info({ userId: user.id, username, org: req.orgId }, "User created");
      syncSeatUsage(req.orgId!); // non-blocking: update metered seat count in Stripe
      res.status(201).json({ id: user.id, username: user.username, name: user.name, role: user.role });
    }),
  );

  // Update user (admin only)
  app.patch(
    "/api/users/:id",
    requireAuth,
    requireRole("admin"),
    injectOrgContext,
    asyncHandler(async (req, res) => {
      const { name, role, password } = req.body;

      if (role && !["viewer", "manager", "admin"].includes(role)) {
        return res.status(400).json({ message: "Invalid role" });
      }

      const updates: Record<string, unknown> = {};
      if (name) updates.name = name;
      if (role) updates.role = role;

      // Hash new password if provided (with HIPAA complexity enforcement)
      if (password) {
        const complexityError = validatePasswordComplexity(password);
        if (complexityError) {
          return res.status(400).json({ message: complexityError });
        }
        updates.passwordHash = await hashPassword(password);
      }

      const updated = await storage.updateUser(req.orgId!, req.params.id, updates as any);
      if (!updated) {
        return res.status(404).json(errorResponse(ERROR_CODES.ADMIN_USER_NOT_FOUND, "User not found"));
      }

      // HIPAA: If password was changed, invalidate all sessions for the target user.
      if (password) {
        const sessionsInvalidated = await invalidateUserSessions(req.params.id);
        if (sessionsInvalidated > 0) {
          logger.info(
            { targetUserId: req.params.id, sessionsInvalidated },
            "Invalidated sessions after password change",
          );
        }
      }

      logPhiAccess({
        ...auditContext(req),
        event: "update_user",
        resourceType: "user",
        resourceId: req.params.id,
        detail: `Updated fields: ${Object.keys(updates)
          .filter((k) => k !== "passwordHash")
          .join(", ")}${password ? " [password changed]" : ""}`,
      });

      logger.info({ userId: req.params.id, org: req.orgId }, "User updated");
      res.json({ id: updated.id, username: updated.username, name: updated.name, role: updated.role });
    }),
  );

  // Delete user (admin only)
  app.delete(
    "/api/users/:id",
    requireAuth,
    requireRole("admin"),
    injectOrgContext,
    asyncHandler(async (req, res) => {
      // Prevent self-deletion
      if (req.params.id === req.user!.id) {
        return res.status(400).json({ message: "Cannot delete your own account" });
      }

      const user = await storage.getUser(req.params.id);
      if (!user || user.orgId !== req.orgId) {
        return res.status(404).json(errorResponse(ERROR_CODES.ADMIN_USER_NOT_FOUND, "User not found"));
      }

      await storage.deleteUser(req.orgId!, req.params.id);
      logPhiAccess({
        ...auditContext(req),
        event: "delete_user",
        resourceType: "user",
        resourceId: req.params.id,
        detail: `Deleted user ${user.username}`,
      });
      logger.info({ userId: req.params.id, org: req.orgId }, "User deleted");
      syncSeatUsage(req.orgId!); // non-blocking: update metered seat count in Stripe
      res.json({ message: "User deleted" });
    }),
  );

  // ============================================================
  // ORGANIZATION MANAGEMENT (admin only)
  // ============================================================

  // Get current org details
  app.get(
    "/api/organization",
    requireAuth,
    injectOrgContext,
    asyncHandler(async (req, res) => {
      const org = await storage.getOrganization(req.orgId!);
      if (!org) return res.status(404).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Organization not found"));
      res.json(org);
    }),
  );

  // Update org settings (admin only)
  app.patch(
    "/api/organization/settings",
    requireAuth,
    requireRole("admin"),
    injectOrgContext,
    asyncHandler(async (req, res) => {
      const org = await storage.getOrganization(req.orgId!);
      if (!org) return res.status(404).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Organization not found"));

      const parsed = orgSettingsSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid settings", errors: parsed.error.flatten() });
      }

      // Gate SSO / SCIM configuration to Enterprise plan
      const ssoFields = [
        "ssoProvider",
        "ssoSignOnUrl",
        "ssoCertificate",
        "ssoEntityId",
        "ssoEnforced",
        "ssoGroupRoleMap",
        "ssoGroupAttribute",
        "ssoSessionMaxHours",
        "ssoLogoutUrl",
        "ssoNewCertificate",
        "oidcDiscoveryUrl",
        "oidcClientId",
        "oidcClientSecret",
        "scimEnabled",
      ] as const;
      const isSettingSso = ssoFields.some((f) => f in parsed.data && (parsed.data as Record<string, unknown>)[f]);
      if (isSettingSso) {
        const sub = await storage.getSubscription(req.orgId!);
        const tier = (sub?.planTier as import("@shared/schema").PlanTier) || "free";
        const plan = PLAN_DEFINITIONS[tier];
        if (!plan?.limits.ssoEnabled) {
          return res.status(403).json({
            message: "SSO and SCIM require an Enterprise plan",
            code: "PLAN_FEATURE_REQUIRED",
            feature: "ssoEnabled",
            currentPlan: tier,
            upgradeUrl: "/settings?tab=billing",
          });
        }
      }

      // Auto-compute certificate expiry dates when certs are set
      const data = parsed.data as Record<string, unknown>;
      if (typeof data.ssoCertificate === "string" && data.ssoCertificate) {
        const expiry = parseCertExpiry(data.ssoCertificate);
        if (expiry) data.ssoCertificateExpiry = expiry;
      }
      if (typeof data.ssoNewCertificate === "string" && data.ssoNewCertificate) {
        const expiry = parseCertExpiry(data.ssoNewCertificate);
        if (expiry) data.ssoNewCertificateExpiry = expiry;
      }
      // If new cert is being cleared, also clear its expiry
      if (data.ssoNewCertificate === null || data.ssoNewCertificate === "") {
        data.ssoNewCertificate = undefined;
        data.ssoNewCertificateExpiry = undefined;
      }

      const updatedSettings = { ...(org.settings || {}), ...parsed.data } as OrgSettings;

      // When mfaRequired is first enabled: stamp mfaRequiredEnabledAt and apply enrollment deadlines to existing users
      const wasMfaRequired = (org.settings as any)?.mfaRequired === true;
      const isMfaRequired = (parsed.data as any)?.mfaRequired === true;
      if (!wasMfaRequired && isMfaRequired) {
        (updatedSettings as any).mfaRequiredEnabledAt = new Date().toISOString();
        const graceDays = (updatedSettings as any).mfaGracePeriodDays ?? 7;
        const deadline = new Date(Date.now() + graceDays * 24 * 60 * 60 * 1000).toISOString();
        // Stamp each existing non-MFA user with an enrollment deadline
        const users = await storage.listUsersByOrg(req.orgId!);
        await Promise.all(
          users
            .filter((u) => !u.mfaEnabled && !(u as any).mfaEnrollmentDeadline)
            .map((u) => storage.updateUser(req.orgId!, u.id, { mfaEnrollmentDeadline: deadline } as any)),
        );
        logger.info(
          { orgId: req.orgId, deadline, graceDays },
          "MFA enforcement enabled — enrollment deadlines applied",
        );
      }

      const updated = await storage.updateOrganization(req.orgId!, { settings: updatedSettings });
      invalidateOrgCache(req.orgId!);

      // Audit log for HIPAA — track all org configuration changes
      const changedFields = Object.keys(parsed.data);
      logPhiAccess({
        ...auditContext(req),
        event: "org_settings_update",
        resourceType: "organization",
        resourceId: req.orgId!,
        detail: JSON.stringify({ changedFields }),
      });
      logger.info({ org: req.orgId, changedFields }, "Organization settings updated");
      res.json(updated);
    }),
  );

  // ============================================================
  // SCIM TOKEN MANAGEMENT (admin only, Enterprise)
  // ============================================================

  // Get SCIM token status (prefix and whether SCIM is enabled)
  app.get(
    "/api/admin/scim/token",
    requireAuth,
    requireRole("admin"),
    injectOrgContext,
    requirePlanFeature("ssoEnabled"),
    asyncHandler(async (req, res) => {
      const org = await storage.getOrganization(req.orgId!);
      if (!org) return res.status(404).json({ message: "Organization not found" });
      const settings = org.settings as OrgSettings | undefined;
      res.json({
        scimEnabled: settings?.scimEnabled || false,
        hasToken: !!settings?.scimTokenHash,
        tokenPrefix: settings?.scimTokenPrefix || null,
        // Service endpoint for IDP configuration
        scimBaseUrl: `${req.protocol}://${req.headers.host}/api/scim/v2`,
      });
    }),
  );

  // Generate / rotate SCIM bearer token (token shown exactly once)
  app.post(
    "/api/admin/scim/token/rotate",
    requireAuth,
    requireRole("admin"),
    injectOrgContext,
    requirePlanFeature("ssoEnabled"),
    asyncHandler(async (req, res) => {
      const org = await storage.getOrganization(req.orgId!);
      if (!org) return res.status(404).json({ message: "Organization not found" });

      const { token, hash, prefix } = generateScimToken();

      const updatedSettings: OrgSettings = {
        ...((org.settings || {}) as OrgSettings),
        scimEnabled: true,
        scimTokenHash: hash,
        scimTokenPrefix: prefix,
      };
      await storage.updateOrganization(req.orgId!, { settings: updatedSettings });
      invalidateOrgCache(req.orgId!);

      logPhiAccess({
        ...auditContext(req),
        event: "org_settings_update",
        resourceType: "organization",
        resourceId: req.orgId!,
        detail: "SCIM token rotated",
      });

      logger.info({ orgId: req.orgId, prefix }, "SCIM token rotated");

      // Return the plaintext token exactly once — it cannot be recovered after this
      res.json({
        token,
        prefix,
        message: "Store this token securely — it will not be shown again.",
        scimBaseUrl: `${req.protocol}://${req.headers.host}/api/scim/v2`,
      });
    }),
  );

  // Disable SCIM (revoke token, disable provisioning)
  app.delete(
    "/api/admin/scim/token",
    requireAuth,
    requireRole("admin"),
    injectOrgContext,
    requirePlanFeature("ssoEnabled"),
    asyncHandler(async (req, res) => {
      const org = await storage.getOrganization(req.orgId!);
      if (!org) return res.status(404).json({ message: "Organization not found" });

      const updatedSettings: OrgSettings = {
        ...((org.settings || {}) as OrgSettings),
        scimEnabled: false,
        scimTokenHash: undefined,
        scimTokenPrefix: undefined,
      };
      await storage.updateOrganization(req.orgId!, { settings: updatedSettings });
      invalidateOrgCache(req.orgId!);

      logPhiAccess({
        ...auditContext(req),
        event: "org_settings_update",
        resourceType: "organization",
        resourceId: req.orgId!,
        detail: "SCIM token revoked, provisioning disabled",
      });

      res.json({ message: "SCIM provisioning disabled and token revoked." });
    }),
  );

  // Audit logs, WAF, incidents, breach reports, GDPR, vocabulary, MFA recovery
  // → delegated to admin-security.routes.ts
  registerAdminSecurityRoutes(app);

  // ── PHI Access Report ───────────────────────────────────────────────────
  // Answers: "Who accessed what PHI in the last N days?"
  // Required by HIPAA for audit/compliance reviews and breach investigations.
  app.get(
    "/api/admin/phi-access-report",
    requireAuth,
    requireRole("admin"),
    injectOrgContext,
    asyncHandler(async (req, res) => {
      const { queryAuditLogs } = await import("../services/audit-log");
      const days = Math.min(Math.max(parseInt(req.query.days as string) || 30, 1), 365);
      const userId = req.query.userId as string | undefined;
      const resourceType = req.query.resourceType as string | undefined;
      const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      const result = await queryAuditLogs({
        orgId: req.orgId!,
        from,
        userId,
        resourceType,
        limit: 200,
      });

      // Aggregate by user for summary view
      const byUser = new Map<
        string,
        { userId: string; username: string; accessCount: number; resourceTypes: Set<string>; lastAccess: string }
      >();
      for (const entry of result.entries) {
        const uid = entry.userId || "unknown";
        const existing = byUser.get(uid);
        if (existing) {
          existing.accessCount++;
          if (entry.resourceType) existing.resourceTypes.add(entry.resourceType);
          if (entry.timestamp && entry.timestamp > existing.lastAccess) existing.lastAccess = entry.timestamp;
        } else {
          byUser.set(uid, {
            userId: uid,
            username: entry.username || uid,
            accessCount: 1,
            resourceTypes: new Set(entry.resourceType ? [entry.resourceType] : []),
            lastAccess: entry.timestamp || "",
          });
        }
      }

      const userSummary = Array.from(byUser.values())
        .map((u) => ({ ...u, resourceTypes: Array.from(u.resourceTypes) }))
        .sort((a, b) => b.accessCount - a.accessCount);

      logPhiAccess({
        ...auditContext(req),
        event: "view_phi_access_report",
        resourceType: "audit_logs",
        detail: `PHI access report for last ${days} days`,
      });

      res.json({
        period: { days, from: from.toISOString(), to: new Date().toISOString() },
        totalEvents: result.total,
        returnedEvents: result.entries.length,
        userSummary,
        recentEvents: result.entries.slice(0, 50),
      });
    }),
  );

  // ── BAA Management (Business Associate Agreements — HIPAA §164.502(e)) ────

  /** List all BAA records for the organization */
  app.get(
    "/api/admin/baa",
    requireAuth,
    requireRole("admin"),
    injectOrgContext,
    asyncHandler(async (req, res) => {
      const { getDatabase } = await import("../db/index");
      const db = getDatabase();
      if (!db) return res.json([]);

      const { businessAssociateAgreements: baaRecords } = await import("../db/schema");
      const { eq, desc } = await import("drizzle-orm");
      const rows = await db
        .select()
        .from(baaRecords)
        .where(eq(baaRecords.orgId, req.orgId!))
        .orderBy(desc(baaRecords.createdAt));

      const now = Date.now();
      const enriched = rows.map((r) => ({
        ...r,
        isExpiringSoon: r.expiresAt ? new Date(r.expiresAt).getTime() - now < 60 * 24 * 60 * 60 * 1000 : false,
        isExpired: r.expiresAt ? new Date(r.expiresAt).getTime() < now : false,
      }));

      res.json(enriched);
    }),
  );

  /** Create a new BAA record */
  app.post(
    "/api/admin/baa",
    requireAuth,
    requireRole("admin"),
    injectOrgContext,
    asyncHandler(async (req, res) => {
      const { getDatabase } = await import("../db/index");
      const db = getDatabase();
      if (!db) return res.status(503).json({ message: "Database not available" });

      const { businessAssociateAgreements: baaRecords } = await import("../db/schema");
      const { randomUUID } = await import("crypto");

      const {
        vendorName,
        vendorType,
        signedDate,
        expiryDate,
        signedBy,
        vendorSignatory,
        description,
        contactName,
        contactEmail,
        notes,
        documentUrl,
        phiCategories,
        renewalReminderDays,
      } = req.body;
      if (!vendorName || !vendorType) {
        return res.status(400).json({ message: "vendorName and vendorType are required" });
      }

      const [row] = await db
        .insert(baaRecords)
        .values({
          id: randomUUID(),
          orgId: req.orgId!,
          vendorName,
          vendorType,
          description: description || null,
          contactName: contactName || null,
          contactEmail: contactEmail || null,
          signedAt: signedDate ? new Date(signedDate) : null,
          expiresAt: expiryDate ? new Date(expiryDate) : null,
          renewalReminderDays: renewalReminderDays ?? 30,
          status: "active",
          signedBy: signedBy || null,
          vendorSignatory: vendorSignatory || null,
          notes: notes || null,
          documentUrl: documentUrl || null,
          phiCategories: phiCategories || [],
        })
        .returning();

      logPhiAccess({
        ...auditContext(req),
        event: "baa_created",
        resourceType: "baa_record",
        resourceId: row.id,
        detail: `BAA created for vendor: ${vendorName} (${vendorType})`,
      });

      res.status(201).json(row);
    }),
  );

  /** Update a BAA record */
  app.patch(
    "/api/admin/baa/:id",
    requireAuth,
    requireRole("admin"),
    injectOrgContext,
    asyncHandler(async (req, res) => {
      const { getDatabase } = await import("../db/index");
      const db = getDatabase();
      if (!db) return res.status(503).json({ message: "Database not available" });

      const { businessAssociateAgreements: baaRecords } = await import("../db/schema");
      const { eq, and } = await import("drizzle-orm");

      const updateFields: Record<string, unknown> = {};
      // Map request body fields to actual DB column names
      const fieldMap: Record<string, string> = {
        vendorName: "vendorName",
        vendorType: "vendorType",
        description: "description",
        contactName: "contactName",
        contactEmail: "contactEmail",
        status: "status",
        signedBy: "signedBy",
        vendorSignatory: "vendorSignatory",
        notes: "notes",
        documentUrl: "documentUrl",
        phiCategories: "phiCategories",
        renewalReminderDays: "renewalReminderDays",
        // Accept legacy field names from existing clients
        signedDate: "signedAt",
        expiryDate: "expiresAt",
      };
      const dateFields = new Set(["signedAt", "expiresAt"]);
      for (const [bodyKey, dbKey] of Object.entries(fieldMap)) {
        if (req.body[bodyKey] !== undefined) {
          if (dateFields.has(dbKey) && req.body[bodyKey]) {
            updateFields[dbKey] = new Date(req.body[bodyKey]);
          } else {
            updateFields[dbKey] = req.body[bodyKey];
          }
        }
      }
      updateFields.updatedAt = new Date();

      const rows = await db
        .update(baaRecords)
        .set(updateFields)
        .where(and(eq(baaRecords.id, req.params.id), eq(baaRecords.orgId, req.orgId!)))
        .returning();

      if (rows.length === 0) return res.status(404).json({ message: "BAA record not found" });

      logPhiAccess({
        ...auditContext(req),
        event: "baa_updated",
        resourceType: "baa_record",
        resourceId: req.params.id,
      });

      res.json(rows[0]);
    }),
  );

  /** Delete a BAA record */
  app.delete(
    "/api/admin/baa/:id",
    requireAuth,
    requireRole("admin"),
    injectOrgContext,
    asyncHandler(async (req, res) => {
      const { getDatabase } = await import("../db/index");
      const db = getDatabase();
      if (!db) return res.status(503).json({ message: "Database not available" });

      const { businessAssociateAgreements: baaRecords } = await import("../db/schema");
      const { eq, and } = await import("drizzle-orm");

      const rows = await db
        .delete(baaRecords)
        .where(and(eq(baaRecords.id, req.params.id), eq(baaRecords.orgId, req.orgId!)))
        .returning();

      if (rows.length === 0) return res.status(404).json({ message: "BAA record not found" });

      logPhiAccess({
        ...auditContext(req),
        event: "baa_deleted",
        resourceType: "baa_record",
        resourceId: req.params.id,
        detail: `BAA deleted for vendor: ${rows[0].vendorName}`,
      });

      res.json({ message: "BAA record deleted" });
    }),
  );

  // ==================== BATCH INFERENCE MANAGEMENT ====================

  /**
   * Get batch mode status and pending items for the org.
   */
  app.get(
    "/api/batch/status",
    requireAuth,
    injectOrgContext,
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const { isBatchAvailable, listPendingItems } = await import("../services/bedrock-batch");
      const org = await storage.getOrganization(req.orgId!);
      const settings = org?.settings as any;

      const pendingItems = await listPendingItems(req.orgId!);

      res.json({
        batchMode: settings?.batchMode || "realtime",
        batchAvailable: isBatchAvailable(),
        pendingCount: pendingItems.length,
        pendingItems: pendingItems.map((item) => ({
          callId: item.callId,
          callCategory: item.callCategory,
          timestamp: item.timestamp,
        })),
      });
    }),
  );

  /**
   * Flush pending batch items — immediately submit a batch job for all pending items.
   */
  app.post(
    "/api/batch/flush",
    requireAuth,
    injectOrgContext,
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const { listPendingItems, createBatchInput, submitBatchJob, cleanupPendingItems, isBatchAvailable } =
        await import("../services/bedrock-batch");

      if (!isBatchAvailable()) {
        return res
          .status(503)
          .json({ message: "Batch inference not configured (missing S3_BUCKET or BEDROCK_BATCH_ROLE_ARN)" });
      }

      const orgId = req.orgId!;
      const items = await listPendingItems(orgId);

      if (items.length === 0) {
        return res.json({ message: "No pending items to flush", jobId: null });
      }

      const org = await storage.getOrganization(orgId);
      const model = (org?.settings as any)?.bedrockModel;
      const { s3Uri, batchId } = await createBatchInput(orgId, items, model);
      const job = await submitBatchJob(
        orgId,
        s3Uri,
        batchId,
        items.map((i) => i.callId),
        model,
      );

      await cleanupPendingItems(
        orgId,
        items.map((i) => i.callId),
      );

      logPhiAccess({
        ...auditContext(req),
        event: "batch_inference_flushed",
        resourceType: "batch_job",
        detail: `Submitted batch job ${job.jobId} with ${items.length} calls`,
      });

      res.json({
        message: `Batch job submitted with ${items.length} calls`,
        jobId: job.jobId,
        callCount: items.length,
      });
    }),
  );
}
