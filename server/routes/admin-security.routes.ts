/**
 * Admin security & compliance routes: audit logs, WAF management,
 * incident response, breach reports, GDPR/CCPA, vocabulary, MFA recovery.
 *
 * Extracted from admin.ts to keep route files under ~800 lines.
 */
import type { Express } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { requireAuth, requireRole, injectOrgContext, invalidateOrgCache } from "../auth";
import { logger } from "../services/logger";
import { queryAuditLogs, exportAuditLogs, verifyAuditChain, logPhiAccess, auditContext } from "../services/audit-log";
import { safeInt } from "./helpers";
import { errorResponse, ERROR_CODES } from "../services/error-codes";
import { getWafStats, blockIp, unblockIp } from "../middleware/waf";
import { syncSeatUsage } from "./billing";
import { getRedis } from "../services/redis";
import type { OrgSettings } from "@shared/schema";
import {
  declareIncident, advanceIncidentPhase, addTimelineEntry,
  addActionItem, updateActionItem, updateIncident,
  getIncident, listIncidents,
  createBreachReport, updateBreachReport, listBreachReports, getBreachReport,
} from "../services/incident-response";

// ─── Zod schemas for incident/breach endpoints ───────────────────────────────

const incidentCreateSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().min(1).max(5000),
  severity: z.enum(["critical", "high", "medium", "low"]),
  affectedSystems: z.array(z.string().max(200)).max(50).optional(),
  estimatedAffectedRecords: z.number().int().min(0).optional(),
  phiInvolved: z.boolean().optional(),
});

const incidentUpdateSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().min(1).max(5000).optional(),
  severity: z.enum(["critical", "high", "medium", "low"]).optional(),
}).strict();

const timelineEntrySchema = z.object({
  description: z.string().min(1).max(2000),
});

const actionItemCreateSchema = z.object({
  description: z.string().min(1).max(2000),
  assignedTo: z.string().max(255).optional(),
  dueDate: z.string().max(30).optional(),
});

const actionItemUpdateSchema = z.object({
  status: z.enum(["open", "in_progress", "completed"]),
});

const breachReportCreateSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().min(1).max(5000),
  incidentId: z.string().optional(),
  affectedIndividuals: z.number().int().min(0),
  phiTypes: z.array(z.string().max(200)).min(1).max(50),
  correctiveActions: z.array(z.string().max(1000)).max(50).optional(),
});

const breachReportUpdateSchema = z.object({
  notificationStatus: z.enum(["not_required", "pending", "individuals_notified", "hhs_notified", "complete"]).optional(),
  individualsNotifiedAt: z.string().optional(),
  hhsNotifiedAt: z.string().optional(),
  mediaNotifiedAt: z.string().optional(),
  correctiveActions: z.array(z.string().max(1000)).max(50).optional(),
});

export function registerAdminSecurityRoutes(app: Express): void {
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
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="audit-logs-${new Date().toISOString().slice(0, 10)}.json"`,
        );
        return res.json({ exportedAt: new Date().toISOString(), orgId: req.orgId, count: rows.length, entries: rows });
      }

      // CSV format
      const headers = [
        "timestamp",
        "event",
        "username",
        "role",
        "resourceType",
        "resourceId",
        "ip",
        "userAgent",
        "detail",
      ];
      const csvRows = rows.map((r) =>
        headers
          .map((h) => {
            const val = String((r as unknown as Record<string, unknown>)[h] ?? "");
            return `"${val.replace(/"/g, '""')}"`;
          })
          .join(","),
      );
      const csv = [headers.join(","), ...csvRows].join("\n");

      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="audit-logs-${new Date().toISOString().slice(0, 10)}.csv"`,
      );
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
    if (!incident) {
      res.status(404).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Incident not found"));
      return;
    }
    res.json(incident);
  });

  app.post("/api/admin/incidents", requireAuth, requireRole("admin"), injectOrgContext, (req, res) => {
    const parsed = incidentCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Invalid incident data", errors: parsed.error.flatten() });
      return;
    }
    const incident = declareIncident(req.orgId!, {
      ...parsed.data,
      declaredBy: req.user!.username,
    });
    res.status(201).json(incident);
  });

  app.post("/api/admin/incidents/:id/advance", requireAuth, requireRole("admin"), injectOrgContext, (req, res) => {
    const incident = advanceIncidentPhase(req.orgId!, req.params.id, req.user!.username);
    if (!incident) {
      res.status(404).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Incident not found"));
      return;
    }
    res.json(incident);
  });

  app.post("/api/admin/incidents/:id/timeline", requireAuth, requireRole("admin"), injectOrgContext, (req, res) => {
    const parsed = timelineEntrySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Invalid timeline entry", errors: parsed.error.flatten() });
      return;
    }
    const incident = addTimelineEntry(req.orgId!, req.params.id, parsed.data.description, req.user!.username);
    if (!incident) {
      res.status(404).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Incident not found"));
      return;
    }
    res.json(incident);
  });

  app.patch("/api/admin/incidents/:id", requireAuth, requireRole("admin"), injectOrgContext, (req, res) => {
    const parsed = incidentUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Invalid update data", errors: parsed.error.flatten() });
      return;
    }
    const incident = updateIncident(req.orgId!, req.params.id, parsed.data);
    if (!incident) {
      res.status(404).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Incident not found"));
      return;
    }
    res.json(incident);
  });

  app.post("/api/admin/incidents/:id/action-items", requireAuth, requireRole("admin"), injectOrgContext, (req, res) => {
    const parsed = actionItemCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Invalid action item data", errors: parsed.error.flatten() });
      return;
    }
    const incident = addActionItem(req.orgId!, req.params.id, parsed.data);
    if (!incident) {
      res.status(404).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Incident not found"));
      return;
    }
    res.json(incident);
  });

  app.patch(
    "/api/admin/incidents/:incidentId/action-items/:itemId",
    requireAuth,
    requireRole("admin"),
    injectOrgContext,
    (req, res) => {
      const parsed = actionItemUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ message: "Invalid status", errors: parsed.error.flatten() });
        return;
      }
      const incident = updateActionItem(req.orgId!, req.params.incidentId, req.params.itemId, parsed.data.status);
      if (!incident) {
        res.status(404).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Incident or action item not found"));
        return;
      }
      res.json(incident);
    },
  );

  // ==================== BREACH REPORTS ====================

  app.get("/api/admin/breach-reports", requireAuth, requireRole("admin"), injectOrgContext, (req, res) => {
    res.json(listBreachReports(req.orgId!));
  });

  app.get("/api/admin/breach-reports/:id", requireAuth, requireRole("admin"), injectOrgContext, (req, res) => {
    const report = getBreachReport(req.orgId!, req.params.id);
    if (!report) {
      res.status(404).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Breach report not found"));
      return;
    }
    res.json(report);
  });

  app.post("/api/admin/breach-reports", requireAuth, requireRole("admin"), injectOrgContext, (req, res) => {
    const parsed = breachReportCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Invalid breach report data", errors: parsed.error.flatten() });
      return;
    }
    const report = createBreachReport(req.orgId!, {
      ...parsed.data,
      reportedBy: req.user!.username,
    });
    res.status(201).json(report);
  });

  app.patch("/api/admin/breach-reports/:id", requireAuth, requireRole("admin"), injectOrgContext, (req, res) => {
    const parsed = breachReportUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Invalid update data", errors: parsed.error.flatten() });
      return;
    }
    const report = updateBreachReport(req.orgId!, req.params.id, parsed.data);
    if (!report) {
      res.status(404).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Breach report not found"));
      return;
    }
    res.json(report);
  });
  // ==================== EDIT PATTERN INSIGHTS ====================

  app.get(
    "/api/admin/edit-insights",
    requireAuth,
    injectOrgContext,
    requireRole("manager", "admin"),
    async (req, res) => {
      try {
        const org = await storage.getOrganization(req.orgId!);
        const insights = (org?.settings as any)?.editPatternInsights || null;
        res.json({ insights });
      } catch (error) {
        res.status(500).json({ message: "Failed to fetch edit insights" });
      }
    },
  );

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
      const [users, employees, calls, coaching, promptTemplates, apiKeysList, invitesList, subscription] =
        await Promise.all([
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
        calls.slice(0, 1000).map(async (call) => {
          // Cap at 1000 to prevent timeout
          const [transcript, analysis] = await Promise.allSettled([
            storage.getTranscript(orgId, call.id),
            storage.getCallAnalysis(orgId, call.id),
          ]);
          return {
            ...call,
            transcript: transcript.status === "fulfilled" ? transcript.value?.text : undefined,
            analysis:
              analysis.status === "fulfilled"
                ? analysis.value
                  ? {
                      performanceScore: analysis.value.performanceScore,
                      summary: analysis.value.summary,
                      flags: analysis.value.flags,
                    }
                  : undefined
                : undefined,
          };
        }),
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
        users: users.map((u) => ({
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
        apiKeys: apiKeysList.map((k) => ({
          id: k.id,
          name: k.name,
          keyPrefix: k.keyPrefix,
          permissions: k.permissions,
          status: k.status,
          createdAt: k.createdAt,
          // Exclude: keyHash
        })),
        invitations: invitesList.map((i) => ({
          id: i.id,
          email: i.email,
          role: i.role,
          status: i.status,
          createdAt: i.createdAt,
          expiresAt: i.expiresAt,
          // Exclude: token
        })),
        subscription: subscription
          ? {
              planTier: subscription.planTier,
              status: subscription.status,
              billingInterval: subscription.billingInterval,
              currentPeriodEnd: subscription.currentPeriodEnd,
              // Exclude: stripeCustomerId, stripeSubscriptionId
            }
          : null,
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
      invalidateOrgCache(orgId);

      // 2. Bulk delete all org data (transactional in PostgreSQL, best-effort otherwise)
      const deletionResult = await storage.deleteOrgData(orgId);

      logger.info({ orgId, ...deletionResult }, "GDPR data purge complete — org record retained for audit trail");

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
      invalidateOrgCache(req.orgId!);

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
        calls: calls.map((c: any) => ({
          id: c.id,
          fileName: c.fileName,
          status: c.status,
          uploadedAt: c.uploadedAt,
          duration: c.duration,
        })),
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

  // ==================== MFA RECOVERY APPROVAL (admin) ====================
  // Admins review and approve/deny emergency MFA bypass requests from users

  // List pending/email_verified recovery requests for this org
  app.get("/api/admin/mfa/recovery", requireAuth, injectOrgContext, requireRole("admin"), async (req, res) => {
    try {
      const recoveryStore: Map<string, any> | undefined = (app as any).__mfaRecoveryStore;
      if (!recoveryStore) return res.json({ requests: [] });

      const orgId = req.orgId!;
      const requests: any[] = [];
      for (const [tokenHash, record] of Array.from(recoveryStore)) {
        if (record.orgId !== orgId) continue;
        if (record.status !== "pending" && record.status !== "email_verified") continue;
        const user = await storage.getUser(record.userId).catch(() => null);
        requests.push({
          tokenPrefix: tokenHash.substring(0, 16),
          userId: record.userId,
          username: user?.username,
          name: user?.name,
          role: user?.role,
          emailVerified: record.emailVerified,
          status: record.status,
          createdAt: new Date(record.createdAt).toISOString(),
        });
      }

      res.json({ requests });
    } catch (err) {
      logger.error({ err }, "Failed to list MFA recovery requests");
      res.status(500).json({ message: "Failed to list recovery requests" });
    }
  });

  // Approve a recovery request — generates a short-lived one-time use token
  app.post(
    "/api/admin/mfa/recovery/:tokenPrefix/approve",
    requireAuth,
    injectOrgContext,
    requireRole("admin"),
    async (req, res) => {
      try {
        const { tokenPrefix } = req.params;
        const recoveryStore: Map<string, any> | undefined = (app as any).__mfaRecoveryStore;
        if (!recoveryStore) return res.status(404).json({ message: "Recovery request not found" });

        const orgId = req.orgId!;
        let foundKey: string | undefined;
        let record: any;
        for (const [k, v] of Array.from(recoveryStore)) {
          if (
            k.startsWith(tokenPrefix) &&
            v.orgId === orgId &&
            (v.status === "pending" || v.status === "email_verified")
          ) {
            foundKey = k;
            record = v;
            break;
          }
        }

        if (!foundKey || !record) return res.status(404).json({ message: "Recovery request not found" });

        const { randomBytes, createHash } = await import("crypto");
        const useToken = randomBytes(32).toString("hex");
        const useTokenHash = createHash("sha256").update(useToken).digest("hex");
        record.status = "approved";
        record.useTokenHash = useTokenHash;
        record.useTokenExpiresAt = Date.now() + 30 * 60 * 1000; // 30-minute window
        record.approvedBy = req.user!.id;
        recoveryStore.set(foundKey, record);

        logPhiAccess({
          ...auditContext(req),
          event: "mfa_recovery_approved",
          resourceType: "auth",
          detail: `MFA recovery approved for user ${record.userId}`,
        });

        // Notify the user via email
        const user = await storage.getUser(record.userId).catch(() => null);
        if (user?.username?.includes("@")) {
          const { sendEmail } = await import("../services/email");
          const loginLink = `${process.env.APP_BASE_URL || ""}/mfa-recovery/complete?useToken=${useToken}`;
          await sendEmail({
            to: user.username,
            subject: "MFA Recovery Approved — Observatory QA",
            text: `Your MFA recovery request has been approved.\n\nUse this one-time link to log in (expires in 30 minutes):\n${loginLink}\n\nAfter logging in, please re-enroll in MFA immediately.`,
            html: `<p>Your MFA recovery request has been approved.</p><p><a href="${loginLink}">Click here to log in</a> (expires in 30 minutes).</p><p>After logging in, please re-enroll in MFA immediately.</p>`,
          }).catch(() => {});
        }

        res.json({ message: "Recovery request approved. User will be notified via email." });
      } catch (err) {
        logger.error({ err }, "Failed to approve MFA recovery request");
        res.status(500).json({ message: "Failed to approve recovery request" });
      }
    },
  );

  // Deny a recovery request
  app.post(
    "/api/admin/mfa/recovery/:tokenPrefix/deny",
    requireAuth,
    injectOrgContext,
    requireRole("admin"),
    async (req, res) => {
      try {
        const { tokenPrefix } = req.params;
        const recoveryStore: Map<string, any> | undefined = (app as any).__mfaRecoveryStore;
        if (!recoveryStore) return res.status(404).json({ message: "Recovery request not found" });

        const orgId = req.orgId!;
        let foundKey: string | undefined;
        let record: any;
        for (const [k, v] of Array.from(recoveryStore)) {
          if (
            k.startsWith(tokenPrefix) &&
            v.orgId === orgId &&
            (v.status === "pending" || v.status === "email_verified")
          ) {
            foundKey = k;
            record = v;
            break;
          }
        }

        if (!foundKey || !record) return res.status(404).json({ message: "Recovery request not found" });

        record.status = "denied";
        recoveryStore.set(foundKey, record);

        logPhiAccess({
          ...auditContext(req),
          event: "mfa_recovery_denied",
          resourceType: "auth",
          detail: `MFA recovery denied for user ${record.userId}`,
        });

        res.json({ message: "Recovery request denied." });
      } catch (err) {
        logger.error({ err }, "Failed to deny MFA recovery request");
        res.status(500).json({ message: "Failed to deny recovery request" });
      }
    },
  );
}
