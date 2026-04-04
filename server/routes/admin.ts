import type { Express } from "express";
import { storage } from "../storage";
import { requireAuth, requireRole, injectOrgContext, hashPassword, validatePasswordComplexity } from "../auth";
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
import { getRedis } from "../services/redis";
import { generateScimToken } from "./scim";
import { parseCertExpiry } from "./sso";
import { registerAdminSecurityRoutes } from "./admin-security.routes";

export function registerAdminRoutes(app: Express): void {
  // ==================== PROMPT TEMPLATE ROUTES (admin only) ====================

  app.get("/api/prompt-templates", requireAuth, injectOrgContext, requireRole("admin"), async (req, res) => {
    try {
      const templates = await storage.getAllPromptTemplates(req.orgId!);
      res.json(templates);
    } catch (error) {
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to fetch prompt templates"));
    }
  });

  app.post(
    "/api/prompt-templates",
    requireAuth,
    injectOrgContext,
    requireRole("admin"),
    requirePlanFeature("customPromptTemplates", "Custom prompt templates require a Pro or Enterprise plan"),
    async (req, res) => {
      try {
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
      } catch (error) {
        res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to create prompt template"));
      }
    },
  );

  app.patch(
    "/api/prompt-templates/:id",
    requireAuth,
    injectOrgContext,
    requireRole("admin"),
    requirePlanFeature("customPromptTemplates", "Custom prompt templates require a Pro or Enterprise plan"),
    async (req, res) => {
      try {
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
      } catch (error) {
        res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to update prompt template"));
      }
    },
  );

  app.delete("/api/prompt-templates/:id", requireAuth, injectOrgContext, requireRole("admin"), async (req, res) => {
    try {
      logPhiAccess({
        ...auditContext(req),
        event: "prompt_template_deleted",
        resourceType: "prompt_template",
        resourceId: req.params.id,
      });
      await storage.deletePromptTemplate(req.orgId!, req.params.id);
      res.json({ message: "Template deleted" });
    } catch (error) {
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to delete template"));
    }
  });

  // Bulk re-analysis: re-analyze recent calls using updated prompt template
  app.post("/api/calls/reanalyze", requireAuth, injectOrgContext, requireRole("admin"), async (req, res) => {
    try {
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
    } catch (error) {
      logger.error({ err: error }, "Failed to start re-analysis");
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to start re-analysis"));
    }
  });

  // ============================================================
  // USER MANAGEMENT (database-backed, admin only)
  // ============================================================

  // List all users in the current organization (paginated)
  app.get("/api/users", requireAuth, requireRole("admin"), injectOrgContext, async (req, res) => {
    try {
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
    } catch (error) {
      logger.error({ err: error }, "Failed to list users");
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to list users"));
    }
  });

  // Create a new user (admin only)
  app.post("/api/users", requireAuth, requireRole("admin"), injectOrgContext, enforceUserQuota(), async (req, res) => {
    try {
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
    } catch (error) {
      logger.error({ err: error }, "Failed to create user");
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to create user"));
    }
  });

  // Update user (admin only)
  app.patch("/api/users/:id", requireAuth, requireRole("admin"), injectOrgContext, async (req, res) => {
    try {
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
      // Uses SCAN instead of KEYS to avoid blocking Redis on large session stores.
      if (password) {
        const redis = getRedis();
        if (redis) {
          try {
            let cursor = "0";
            let deleted = 0;
            do {
              const [nextCursor, keys] = await redis.scan(cursor, "MATCH", "sess:*", "COUNT", 100);
              cursor = nextCursor;
              for (const key of keys) {
                try {
                  const sessionData = await redis.get(key);
                  if (sessionData) {
                    const parsed = JSON.parse(sessionData);
                    if (parsed?.passport?.user === req.params.id) {
                      await redis.del(key);
                      deleted++;
                    }
                  }
                } catch {
                  /* skip unparseable sessions */
                }
              }
            } while (cursor !== "0");
            logger.info({ targetUserId: req.params.id, sessionsInvalidated: deleted }, "Invalidated sessions after password change");
          } catch (err) {
            logger.warn({ err, targetUserId: req.params.id }, "Failed to invalidate sessions after password change");
          }
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
    } catch (error) {
      logger.error({ err: error }, "Failed to update user");
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to update user"));
    }
  });

  // Delete user (admin only)
  app.delete("/api/users/:id", requireAuth, requireRole("admin"), injectOrgContext, async (req, res) => {
    try {
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
    } catch (error) {
      logger.error({ err: error }, "Failed to delete user");
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to delete user"));
    }
  });

  // ============================================================
  // ORGANIZATION MANAGEMENT (admin only)
  // ============================================================

  // Get current org details
  app.get("/api/organization", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const org = await storage.getOrganization(req.orgId!);
      if (!org) return res.status(404).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Organization not found"));
      res.json(org);
    } catch (error) {
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to fetch organization"));
    }
  });

  // Update org settings (admin only)
  app.patch("/api/organization/settings", requireAuth, requireRole("admin"), injectOrgContext, async (req, res) => {
    try {
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
    } catch (error) {
      logger.error({ err: error }, "Failed to update organization settings");
      res.status(500).json(errorResponse(ERROR_CODES.ADMIN_SETTINGS_FAILED, "Failed to update settings"));
    }
  });

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
    async (req, res) => {
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
    },
  );

  // Generate / rotate SCIM bearer token (token shown exactly once)
  app.post(
    "/api/admin/scim/token/rotate",
    requireAuth,
    requireRole("admin"),
    injectOrgContext,
    requirePlanFeature("ssoEnabled"),
    async (req, res) => {
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
    },
  );

  // Disable SCIM (revoke token, disable provisioning)
  app.delete(
    "/api/admin/scim/token",
    requireAuth,
    requireRole("admin"),
    injectOrgContext,
    requirePlanFeature("ssoEnabled"),
    async (req, res) => {
      const org = await storage.getOrganization(req.orgId!);
      if (!org) return res.status(404).json({ message: "Organization not found" });

      const updatedSettings: OrgSettings = {
        ...((org.settings || {}) as OrgSettings),
        scimEnabled: false,
        scimTokenHash: undefined,
        scimTokenPrefix: undefined,
      };
      await storage.updateOrganization(req.orgId!, { settings: updatedSettings });

      logPhiAccess({
        ...auditContext(req),
        event: "org_settings_update",
        resourceType: "organization",
        resourceId: req.orgId!,
        detail: "SCIM token revoked, provisioning disabled",
      });

      res.json({ message: "SCIM provisioning disabled and token revoked." });
    },
  );


  // Audit logs, WAF, incidents, breach reports, GDPR, vocabulary, MFA recovery
  // → delegated to admin-security.routes.ts
  registerAdminSecurityRoutes(app);

  // ── PHI Access Report ───────────────────────────────────────────────────
  // Answers: "Who accessed what PHI in the last N days?"
  // Required by HIPAA for audit/compliance reviews and breach investigations.
  app.get("/api/admin/phi-access-report", requireAuth, requireRole("admin"), injectOrgContext, async (req, res) => {
    try {
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
      const byUser = new Map<string, { userId: string; username: string; accessCount: number; resourceTypes: Set<string>; lastAccess: string }>();
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
    } catch (error) {
      logger.error({ err: error }, "Failed to generate PHI access report");
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to generate PHI access report"));
    }
  });

  // ── BAA Management (Business Associate Agreements — HIPAA §164.502(e)) ────

  /** List all BAA records for the organization */
  app.get("/api/admin/baa", requireAuth, requireRole("admin"), injectOrgContext, async (req, res) => {
    try {
      const { getDatabase } = await import("../db/index");
      const db = getDatabase();
      if (!db) return res.json([]);

      const { baaRecords } = await import("../db/schema");
      const { eq, desc } = await import("drizzle-orm");
      const rows = await db
        .select()
        .from(baaRecords)
        .where(eq(baaRecords.orgId, req.orgId!))
        .orderBy(desc(baaRecords.createdAt));

      const now = Date.now();
      const enriched = rows.map((r) => ({
        ...r,
        isExpiringSoon: r.expiryDate ? new Date(r.expiryDate).getTime() - now < 60 * 24 * 60 * 60 * 1000 : false,
        isExpired: r.expiryDate ? new Date(r.expiryDate).getTime() < now : false,
      }));

      res.json(enriched);
    } catch (error) {
      logger.error({ err: error }, "Failed to list BAA records");
      res.status(500).json({ message: "Failed to list BAA records" });
    }
  });

  /** Create a new BAA record */
  app.post("/api/admin/baa", requireAuth, requireRole("admin"), injectOrgContext, async (req, res) => {
    try {
      const { getDatabase } = await import("../db/index");
      const db = getDatabase();
      if (!db) return res.status(503).json({ message: "Database not available" });

      const { baaRecords } = await import("../db/schema");
      const { randomUUID } = await import("crypto");

      const { vendorName, vendorType, signedDate, expiryDate, renewalDate, signatoryName, signatoryTitle, notes, documentUrl, phiCategories } = req.body;
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
          signedDate: signedDate ? new Date(signedDate) : null,
          expiryDate: expiryDate ? new Date(expiryDate) : null,
          renewalDate: renewalDate ? new Date(renewalDate) : null,
          status: "active",
          signatoryName: signatoryName || null,
          signatoryTitle: signatoryTitle || null,
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
    } catch (error) {
      logger.error({ err: error }, "Failed to create BAA record");
      res.status(500).json({ message: "Failed to create BAA record" });
    }
  });

  /** Update a BAA record */
  app.patch("/api/admin/baa/:id", requireAuth, requireRole("admin"), injectOrgContext, async (req, res) => {
    try {
      const { getDatabase } = await import("../db/index");
      const db = getDatabase();
      if (!db) return res.status(503).json({ message: "Database not available" });

      const { baaRecords } = await import("../db/schema");
      const { eq, and } = await import("drizzle-orm");

      const updateFields: Record<string, unknown> = {};
      const allowedFields = [
        "vendorName", "vendorType", "signedDate", "expiryDate", "renewalDate",
        "status", "signatoryName", "signatoryTitle", "notes", "documentUrl", "phiCategories",
      ];
      for (const field of allowedFields) {
        if (req.body[field] !== undefined) {
          if (["signedDate", "expiryDate", "renewalDate"].includes(field) && req.body[field]) {
            updateFields[field] = new Date(req.body[field]);
          } else {
            updateFields[field] = req.body[field];
          }
        }
      }
      updateFields.updatedAt = new Date();
      updateFields.lastReviewedAt = new Date();
      updateFields.lastReviewedBy = req.user?.name || req.user?.username;

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
    } catch (error) {
      logger.error({ err: error }, "Failed to update BAA record");
      res.status(500).json({ message: "Failed to update BAA record" });
    }
  });

  /** Delete a BAA record */
  app.delete("/api/admin/baa/:id", requireAuth, requireRole("admin"), injectOrgContext, async (req, res) => {
    try {
      const { getDatabase } = await import("../db/index");
      const db = getDatabase();
      if (!db) return res.status(503).json({ message: "Database not available" });

      const { baaRecords } = await import("../db/schema");
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
    } catch (error) {
      logger.error({ err: error }, "Failed to delete BAA record");
      res.status(500).json({ message: "Failed to delete BAA record" });
    }
  });
}
