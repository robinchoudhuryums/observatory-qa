import type { Express } from "express";
import { storage } from "../storage";
import { requireAuth, requireRole, injectOrgContext, hashPassword, validatePasswordComplexity } from "../auth";
import { aiProvider } from "../services/ai-factory";
import { assemblyAIService } from "../services/assemblyai";
import { broadcastCallUpdate } from "../services/websocket";
import { insertPromptTemplateSchema, orgSettingsSchema, PLAN_DEFINITIONS, type OrgSettings } from "@shared/schema";
import { logger } from "../services/logger";
import { queryAuditLogs, exportAuditLogs, verifyAuditChain, logPhiAccess, auditContext } from "../services/audit-log";
import { safeInt, withRetry } from "./helpers";
import { enqueueReanalysis } from "../services/queue";
import { getWafStats, blockIp, unblockIp } from "../middleware/waf";
import { requirePlanFeature, enforceUserQuota, syncSeatUsage } from "./billing";
import { errorResponse, ERROR_CODES } from "../services/error-codes";
import { parsePagination, paginateArray } from "./helpers";
import { getRedis } from "../services/redis";
import {
  declareIncident, advanceIncidentPhase, addTimelineEntry, addActionItem,
  updateActionItem, updateIncident, getIncident, listIncidents,
  createBreachReport, updateBreachReport, listBreachReports, getBreachReport,
} from "../services/incident-response";

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

  app.post("/api/prompt-templates", requireAuth, injectOrgContext, requireRole("admin"), requirePlanFeature("customPromptTemplates", "Custom prompt templates require a Pro or Enterprise plan"), async (req, res) => {
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
  });

  app.patch("/api/prompt-templates/:id", requireAuth, injectOrgContext, requireRole("admin"), requirePlanFeature("customPromptTemplates", "Custom prompt templates require a Pro or Enterprise plan"), async (req, res) => {
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
  });

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
        .filter(c => c.callCategory === callCategory && c.transcript?.text)
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
      const callIds = targetCalls.map(c => c.id);

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
              { retries: 1, baseDelay: 2000, label: `reanalyze ${call.id}` }
            );

            const { analysis } = assemblyAIService.processTranscriptData(
              { id: "", status: "completed", text: transcriptText, words: call.transcript?.words as any },
              aiAnalysis,
              call.id,
              req.orgId!
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
      })().catch(err => logger.error({ err }, "Bulk re-analysis failed"));
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
      const sanitized = users.map(u => ({
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
        return res.status(400).json(errorResponse(ERROR_CODES.VALIDATION_ERROR, "username, password, and name are required"));
      }
      // Validate field lengths
      if (username.length > 255 || name.length > 255) {
        return res.status(400).json(errorResponse(ERROR_CODES.VALIDATION_ERROR, "Field length exceeds maximum allowed"));
      }
      // Validate email format for username
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(username)) {
        return res.status(400).json(errorResponse(ERROR_CODES.VALIDATION_ERROR, "Username must be a valid email address"));
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

      // HIPAA: If password was changed, invalidate all sessions for the target user
      if (password) {
        const redis = getRedis();
        if (redis) {
          try {
            const sessionKeys = await redis.keys("sess:*");
            for (const key of sessionKeys) {
              const sessionData = await redis.get(key);
              if (sessionData) {
                try {
                  const parsed = JSON.parse(sessionData);
                  if (parsed?.passport?.user === req.params.id) {
                    await redis.del(key);
                  }
                } catch { /* skip unparseable sessions */ }
              }
            }
            logger.info({ targetUserId: req.params.id }, "Invalidated sessions after password change");
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
        detail: `Updated fields: ${Object.keys(updates).filter(k => k !== "passwordHash").join(", ")}${password ? " [password changed]" : ""}`,
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

      // Gate SSO configuration to Enterprise plan
      const ssoFields = ["ssoProvider", "ssoSignOnUrl", "ssoCertificate", "ssoEntityId", "ssoEnforced"] as const;
      const isSettingSso = ssoFields.some(f => f in parsed.data && (parsed.data as Record<string, unknown>)[f]);
      if (isSettingSso) {
        const sub = await storage.getSubscription(req.orgId!);
        const tier = (sub?.planTier as import("@shared/schema").PlanTier) || "free";
        const plan = PLAN_DEFINITIONS[tier];
        if (!plan?.limits.ssoEnabled) {
          return res.status(403).json({
            message: "SSO requires an Enterprise plan",
            code: "PLAN_FEATURE_REQUIRED",
            feature: "ssoEnabled",
            currentPlan: tier,
            upgradeUrl: "/settings?tab=billing",
          });
        }
      }

      const updatedSettings = { ...(org.settings || {}), ...parsed.data } as OrgSettings;
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
  // AUDIT LOG VIEWER (admin only)
  // ============================================================

  app.get("/api/admin/audit-logs", requireAuth, requireRole("admin"), injectOrgContext, async (req, res) => {
    try {
      const { event, userId, username, resourceType, from, to, page, limit } = req.query;
      const pageNum = Math.max(1, safeInt(page, 1));
      const pageLimit = Math.min(safeInt(limit, 50), 200);

      const result = await queryAuditLogs({
        orgId: req.orgId!,
        event: event as string | undefined,
        userId: userId as string | undefined,
        username: username as string | undefined,
        resourceType: resourceType as string | undefined,
        from: from ? new Date(from as string) : undefined,
        to: to ? new Date(to as string) : undefined,
        limit: pageLimit,
        offset: (pageNum - 1) * pageLimit,
      });

      res.json({
        entries: result.entries,
        total: result.total,
        page: pageNum,
        pageSize: pageLimit,
        totalPages: Math.ceil(result.total / pageLimit),
      });
    } catch (error) {
      logger.error({ err: error }, "Failed to fetch audit logs");
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to fetch audit logs"));
    }
  });

  // Export audit logs for HIPAA auditors (full date range, no page cap)
  app.get("/api/admin/audit-logs/export", requireAuth, requireRole("admin"), injectOrgContext, async (req, res) => {
    try {
      const { event, userId, username, resourceType, from, to, format } = req.query;
      const exportFormat = (format as string) === "json" ? "json" : "csv";

      const fromDate = from ? new Date(from as string) : undefined;
      const toDate = to ? new Date(to as string) : undefined;

      // Log that an export was performed (HIPAA: audit the auditor)
      logPhiAccess({
        ...auditContext(req),
        event: "audit_log_export",
        resourceType: "audit_logs",
        detail: `Exported audit logs: format=${exportFormat}, from=${from || "all"}, to=${to || "now"}`,
      });

      const rows = await exportAuditLogs({
        orgId: req.orgId!,
        event: event as string | undefined,
        userId: userId as string | undefined,
        username: username as string | undefined,
        resourceType: resourceType as string | undefined,
        from: fromDate,
        to: toDate,
      });

      if (exportFormat === "json") {
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Content-Disposition", `attachment; filename="audit-logs-${new Date().toISOString().slice(0, 10)}.json"`);
        return res.json({ exportedAt: new Date().toISOString(), orgId: req.orgId, count: rows.length, entries: rows });
      }

      // CSV format
      const headers = ["timestamp", "event", "username", "role", "resourceType", "resourceId", "ip", "userAgent", "detail"];
      const csvRows = rows.map(r => headers.map(h => {
        const val = String((r as unknown as Record<string, unknown>)[h] ?? "");
        return `"${val.replace(/"/g, '""')}"`;
      }).join(","));
      const csv = [headers.join(","), ...csvRows].join("\n");

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="audit-logs-${new Date().toISOString().slice(0, 10)}.csv"`);
      res.send(csv);
    } catch (error) {
      logger.error({ err: error }, "Failed to export audit logs");
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to export audit logs"));
    }
  });

  // Verify audit log integrity (tamper detection)
  app.get("/api/admin/audit-logs/verify", requireAuth, requireRole("admin"), injectOrgContext, async (req, res) => {
    try {
      const result = await verifyAuditChain(req.orgId!);
      res.json({
        ...result,
        message: result.valid
          ? `Audit chain verified: ${result.checkedCount} entries, no tampering detected.`
          : `Audit chain BROKEN at sequence ${result.brokenAt}. Possible tampering detected.`,
      });
    } catch (error) {
      logger.error({ err: error }, "Failed to verify audit chain");
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to verify audit chain integrity"));
    }
  });

  // ==================== WAF ADMIN ROUTES ====================

  app.get("/api/admin/waf-stats", requireAuth, requireRole("admin"), (_req, res) => {
    res.json(getWafStats());
  });

  app.post("/api/admin/waf/block-ip", requireAuth, requireRole("admin"), (req, res) => {
    const { ip } = req.body;
    if (!ip || typeof ip !== "string") {
      res.status(400).json({ message: "IP address is required" });
      return;
    }
    blockIp(ip);
    res.json({ success: true, message: `IP ${ip} blocked` });
  });

  app.post("/api/admin/waf/unblock-ip", requireAuth, requireRole("admin"), (req, res) => {
    const { ip } = req.body;
    if (!ip || typeof ip !== "string") {
      res.status(400).json({ message: "IP address is required" });
      return;
    }
    unblockIp(ip);
    res.json({ success: true, message: `IP ${ip} unblocked` });
  });

  // ==================== SECURITY INCIDENTS ====================

  app.get("/api/admin/incidents", requireAuth, requireRole("admin"), injectOrgContext, (req, res) => {
    res.json(listIncidents(req.orgId!));
  });

  app.get("/api/admin/incidents/:id", requireAuth, requireRole("admin"), injectOrgContext, (req, res) => {
    const incident = getIncident(req.orgId!, req.params.id);
    if (!incident) { res.status(404).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Incident not found")); return; }
    res.json(incident);
  });

  app.post("/api/admin/incidents", requireAuth, requireRole("admin"), injectOrgContext, (req, res) => {
    const { title, description, severity, affectedSystems, estimatedAffectedRecords, phiInvolved } = req.body;
    if (!title || !description || !severity) {
      res.status(400).json({ message: "title, description, and severity are required" });
      return;
    }
    const incident = declareIncident(req.orgId!, {
      title, description, severity,
      declaredBy: req.user!.username,
      affectedSystems, estimatedAffectedRecords, phiInvolved,
    });
    res.status(201).json(incident);
  });

  app.post("/api/admin/incidents/:id/advance", requireAuth, requireRole("admin"), injectOrgContext, (req, res) => {
    const incident = advanceIncidentPhase(req.orgId!, req.params.id, req.user!.username);
    if (!incident) { res.status(404).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Incident not found")); return; }
    res.json(incident);
  });

  app.post("/api/admin/incidents/:id/timeline", requireAuth, requireRole("admin"), injectOrgContext, (req, res) => {
    const { description } = req.body;
    if (!description) { res.status(400).json({ message: "description is required" }); return; }
    const incident = addTimelineEntry(req.orgId!, req.params.id, description, req.user!.username);
    if (!incident) { res.status(404).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Incident not found")); return; }
    res.json(incident);
  });

  app.patch("/api/admin/incidents/:id", requireAuth, requireRole("admin"), injectOrgContext, (req, res) => {
    const incident = updateIncident(req.orgId!, req.params.id, req.body);
    if (!incident) { res.status(404).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Incident not found")); return; }
    res.json(incident);
  });

  app.post("/api/admin/incidents/:id/action-items", requireAuth, requireRole("admin"), injectOrgContext, (req, res) => {
    const { description, assignedTo, dueDate } = req.body;
    if (!description) { res.status(400).json({ message: "description is required" }); return; }
    const incident = addActionItem(req.orgId!, req.params.id, { description, assignedTo, dueDate });
    if (!incident) { res.status(404).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Incident not found")); return; }
    res.json(incident);
  });

  app.patch("/api/admin/incidents/:incidentId/action-items/:itemId", requireAuth, requireRole("admin"), injectOrgContext, (req, res) => {
    const { status } = req.body;
    if (!status) { res.status(400).json({ message: "status is required" }); return; }
    const incident = updateActionItem(req.orgId!, req.params.incidentId, req.params.itemId, status);
    if (!incident) { res.status(404).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Incident or action item not found")); return; }
    res.json(incident);
  });

  // ==================== BREACH REPORTS ====================

  app.get("/api/admin/breach-reports", requireAuth, requireRole("admin"), injectOrgContext, (req, res) => {
    res.json(listBreachReports(req.orgId!));
  });

  app.get("/api/admin/breach-reports/:id", requireAuth, requireRole("admin"), injectOrgContext, (req, res) => {
    const report = getBreachReport(req.orgId!, req.params.id);
    if (!report) { res.status(404).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Breach report not found")); return; }
    res.json(report);
  });

  app.post("/api/admin/breach-reports", requireAuth, requireRole("admin"), injectOrgContext, (req, res) => {
    const { title, description, incidentId, affectedIndividuals, phiTypes, correctiveActions } = req.body;
    if (!title || !description || affectedIndividuals === undefined || !phiTypes?.length) {
      res.status(400).json({ message: "title, description, affectedIndividuals, and phiTypes are required" });
      return;
    }
    const report = createBreachReport(req.orgId!, {
      title, description, incidentId,
      reportedBy: req.user!.username,
      affectedIndividuals, phiTypes, correctiveActions,
    });
    res.status(201).json(report);
  });

  app.patch("/api/admin/breach-reports/:id", requireAuth, requireRole("admin"), injectOrgContext, (req, res) => {
    const report = updateBreachReport(req.orgId!, req.params.id, req.body);
    if (!report) { res.status(404).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Breach report not found")); return; }
    res.json(report);
  });

  // ==================== EDIT PATTERN INSIGHTS ====================

  app.get("/api/admin/edit-insights", requireAuth, injectOrgContext, requireRole("manager", "admin"), async (req, res) => {
    try {
      const org = await storage.getOrganization(req.orgId!);
      const insights = (org?.settings as any)?.editPatternInsights || null;
      res.json({ insights });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch edit insights" });
    }
  });

  // ==================== GDPR/CCPA COMPLIANCE ====================

  /**
   * GET /api/admin/org/export
   * Data portability — GDPR Article 20 / CCPA.
   * Returns all org data as a structured JSON download (no secrets, no audio binaries).
   */
  app.get("/api/admin/org/export", requireAuth, injectOrgContext, requireRole("admin"), async (req, res) => {
    const orgId = req.orgId!;
    try {
      const org = await storage.getOrganization(orgId);
      if (!org) {
        res.status(404).json({ message: "Organization not found" });
        return;
      }

      logPhiAccess({
        ...auditContext(req),
        event: "gdpr_data_export",
        resourceType: "organization",
        resourceId: orgId,
        detail: `Admin ${req.user?.username} exported all org data (GDPR Article 20)`,
      });

      // Fetch all org data in parallel (no secrets, no password hashes, no MFA secrets)
      const [users, employees, calls, coaching, promptTemplates, apiKeysList, invitesList, subscription] = await Promise.all([
        storage.listUsersByOrg(orgId),
        storage.getAllEmployees(orgId),
        storage.getAllCalls(orgId),
        storage.getAllCoachingSessions(orgId),
        storage.getAllPromptTemplates(orgId),
        storage.listApiKeys(orgId),
        storage.listInvitations(orgId),
        storage.getSubscription(orgId),
      ]);

      // Fetch transcripts and analyses for calls (best-effort)
      const callDetails = await Promise.all(
        calls.slice(0, 1000).map(async (call) => { // Cap at 1000 to prevent timeout
          const [transcript, analysis] = await Promise.allSettled([
            storage.getTranscript(orgId, call.id),
            storage.getCallAnalysis(orgId, call.id),
          ]);
          return {
            ...call,
            transcript: transcript.status === "fulfilled" ? transcript.value?.text : undefined,
            analysis: analysis.status === "fulfilled" ? analysis.value ? {
              performanceScore: analysis.value.performanceScore,
              summary: analysis.value.summary,
              flags: analysis.value.flags,
            } : undefined : undefined,
          };
        })
      );

      const exportData = {
        exportedAt: new Date().toISOString(),
        exportVersion: "1.0",
        organization: {
          id: org.id,
          name: org.name,
          slug: org.slug,
          status: org.status,
          createdAt: org.createdAt,
          settings: {
            industryType: org.settings?.industryType,
            retentionDays: org.settings?.retentionDays,
            // Exclude secrets: SSO cert, EHR API keys, encryption keys
          },
        },
        users: users.map(u => ({
          id: u.id,
          username: u.username,
          name: u.name,
          role: u.role,
          createdAt: u.createdAt,
          // Exclude: passwordHash, mfaSecret, mfaBackupCodes
        })),
        employees,
        calls: callDetails,
        coachingSessions: coaching,
        promptTemplates,
        apiKeys: apiKeysList.map(k => ({
          id: k.id,
          name: k.name,
          keyPrefix: k.keyPrefix,
          permissions: k.permissions,
          status: k.status,
          createdAt: k.createdAt,
          // Exclude: keyHash
        })),
        invitations: invitesList.map(i => ({
          id: i.id,
          email: i.email,
          role: i.role,
          status: i.status,
          createdAt: i.createdAt,
          expiresAt: i.expiresAt,
          // Exclude: token
        })),
        subscription: subscription ? {
          planTier: subscription.planTier,
          status: subscription.status,
          billingInterval: subscription.billingInterval,
          currentPeriodEnd: subscription.currentPeriodEnd,
          // Exclude: stripeCustomerId, stripeSubscriptionId
        } : null,
      };

      const filename = `observatory-export-${org.slug}-${new Date().toISOString().split("T")[0]}.json`;
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Content-Type", "application/json");
      res.setHeader("X-Export-Warning", "Large datasets may be truncated at 1000 records per collection");
      res.json(exportData);
    } catch (error) {
      logger.error({ err: error, orgId }, "Failed to export org data");
      res.status(500).json({ message: "Failed to export organization data" });
    }
  });

  /**
   * DELETE /api/admin/org/purge
   * Right to erasure — GDPR Article 17 / CCPA.
   * Permanently deletes all org data. Requires explicit confirmation phrase.
   * Org record is retained with status "deleted" for audit trail.
   */
  app.delete("/api/admin/org/purge", requireAuth, injectOrgContext, requireRole("admin"), async (req, res) => {
    const orgId = req.orgId!;
    try {
      const { confirmation, reason } = req.body as { confirmation?: string; reason?: string };

      if (confirmation !== "PURGE ALL DATA") {
        res.status(400).json({
          message: "Confirmation required. Set body.confirmation to exactly: PURGE ALL DATA",
          code: "OBS-GDPR-001",
        });
        return;
      }

      if (!reason || typeof reason !== "string" || reason.trim().length < 10) {
        res.status(400).json({
          message: "A reason (at least 10 characters) is required for audit trail",
          code: "OBS-GDPR-002",
        });
        return;
      }

      const org = await storage.getOrganization(orgId);
      if (!org) {
        res.status(404).json({ message: "Organization not found" });
        return;
      }

      logPhiAccess({
        ...auditContext(req),
        event: "gdpr_data_purge",
        resourceType: "organization",
        resourceId: orgId,
        detail: `Admin ${req.user?.username} initiated GDPR erasure. Reason: ${reason.trim()}`,
      });

      logger.warn(
        { orgId, adminUser: req.user?.username, reason: reason.trim() },
        "GDPR data purge initiated — deleting all org data",
      );

      // 1. Mark org as deleted immediately to block further API access
      await storage.updateOrganization(orgId, { status: "deleted" } as any);

      // 2. Bulk delete all org data (transactional in PostgreSQL, best-effort otherwise)
      const deletionResult = await storage.deleteOrgData(orgId);

      logger.info(
        { orgId, ...deletionResult },
        "GDPR data purge complete — org record retained for audit trail",
      );

      res.json({
        success: true,
        deletedAt: new Date().toISOString(),
        deletionCounts: deletionResult,
        message: "Organization data purged. Org record retained for audit trail.",
      });
    } catch (error) {
      logger.error({ err: error, orgId }, "GDPR data purge failed");
      res.status(500).json({ message: "Data purge failed. Please contact support." });
    }
  });

  // ==================== CUSTOM VOCABULARY (WORD BOOST) ====================

  app.get("/api/admin/vocabulary", requireAuth, injectOrgContext, requireRole("admin"), async (req, res) => {
    try {
      const org = await storage.getOrganization(req.orgId!);
      const vocabulary: string[] = (org?.settings as any)?.customVocabulary || [];
      res.json({ vocabulary });
    } catch (error) {
      logger.error({ err: error, orgId: req.orgId }, "Failed to fetch custom vocabulary");
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to fetch custom vocabulary"));
    }
  });

  app.put("/api/admin/vocabulary", requireAuth, injectOrgContext, requireRole("admin"), async (req, res) => {
    try {
      const { vocabulary } = req.body;
      if (!Array.isArray(vocabulary)) {
        res.status(400).json({ message: "vocabulary must be an array of strings" });
        return;
      }
      const cleaned = vocabulary
        .filter((v: unknown) => typeof v === "string" && v.trim().length > 0)
        .map((v: string) => v.trim())
        .slice(0, 500); // Safety cap

      const org = await storage.getOrganization(req.orgId!);
      if (!org) {
        res.status(404).json({ message: "Organization not found" });
        return;
      }

      await storage.updateOrganization(req.orgId!, {
        settings: { ...(org.settings as any), customVocabulary: cleaned },
      });

      logger.info({ orgId: req.orgId, wordCount: cleaned.length }, "Custom vocabulary updated");
      res.json({ vocabulary: cleaned, count: cleaned.length });
    } catch (error) {
      logger.error({ err: error, orgId: req.orgId }, "Failed to update custom vocabulary");
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to update custom vocabulary"));
    }
  });

  // ── GDPR/CCPA: Organisation data export (Right to Access) ────────────────
  app.get("/api/admin/org/export", requireAuth, injectOrgContext, requireRole("admin"), async (req, res) => {
    try {
      const orgId = req.orgId!;
      const [org, employees, calls, users] = await Promise.all([
        storage.getOrganization(orgId),
        storage.getAllEmployees(orgId),
        storage.getAllCalls(orgId),
        storage.listUsersByOrg(orgId),
      ]);

      // Scrub password hashes from user export
      const safeUsers = users.map(({ passwordHash: _ph, mfaSecret: _ms, mfaBackupCodes: _mb, ...u }: any) => u);

      res.json({
        exportedAt: new Date().toISOString(),
        organization: org,
        users: safeUsers,
        employees,
        callCount: calls.length,
        calls: calls.map((c: any) => ({ id: c.id, fileName: c.fileName, status: c.status, uploadedAt: c.uploadedAt, duration: c.duration })),
      });
    } catch (err) {
      logger.error({ err }, "Org data export failed");
      res.status(500).json({ message: "Export failed" });
    }
  });

  // ── GDPR/CCPA: Organisation data purge (Right to Erasure) ────────────────
  app.delete("/api/admin/org/purge", requireAuth, injectOrgContext, requireRole("admin"), async (req, res) => {
    try {
      const orgId = req.orgId!;
      const { confirm } = req.body;
      if (confirm !== "DELETE_ALL_DATA") {
        return res.status(400).json({ message: "Must send { confirm: 'DELETE_ALL_DATA' } to confirm purge" });
      }

      const result = await storage.deleteOrgData(orgId);
      logger.warn({ orgId, ...result }, "Org data purged (GDPR/CCPA right to erasure)");

      // Destroy the current session — org is now deleted
      req.session.destroy(() => {});
      res.json({ message: "All organisation data purged", ...result });
    } catch (err) {
      logger.error({ err }, "Org data purge failed");
      res.status(500).json({ message: "Purge failed" });
    }
  });
}
