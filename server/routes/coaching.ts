import type { Express } from "express";
import { storage } from "../storage";
import { requireAuth, requireRole, injectOrgContext } from "../auth";
import { insertCoachingSessionSchema } from "@shared/schema";
import { z } from "zod";
import {
  generateRecommendations, saveRecommendations, generateCoachingPlan, calculateEffectiveness,
  runAutomationRules, calculateAndCacheEffectiveness, getDueSoonSessions, getOverdueSessions,
} from "../services/coaching-engine";
import { insertCoachingTemplateSchema, insertAutomationRuleSchema } from "@shared/schema";
import { getManagerReviewQueue, generateWeeklyDigest } from "../services/proactive-alerts";
import { sendDigestNotification } from "../services/notifications";
import { logger } from "../services/logger";
import { logPhiAccess, auditContext } from "../services/audit-log";
import { errorResponse, ERROR_CODES } from "../services/error-codes";
import { parsePagination, paginateArray } from "./helpers";

export function registerCoachingRoutes(app: Express): void {
  // ==================== COACHING ROUTES ====================

  // List all coaching sessions (managers and admins)
  app.get("/api/coaching", requireAuth, injectOrgContext, requireRole("manager", "admin"), async (req, res) => {
    try {
      const { limit, offset } = parsePagination(req.query);
      const sessions = await storage.getAllCoachingSessions(req.orgId!);
      // Batch-load employee names instead of N+1
      const empIds = Array.from(new Set(sessions.map(s => s.employeeId).filter(Boolean)));
      const employees = await storage.getAllEmployees(req.orgId!);
      const empMap = new Map(employees.map(e => [e.id, e.name]));
      const enriched = sessions.map(s => ({
        ...s,
        employeeName: empMap.get(s.employeeId) || "Unknown",
      }));
      logPhiAccess({
        ...auditContext(req),
        event: "view_coaching_sessions",
        resourceType: "coaching",
        detail: `Listed ${enriched.length} coaching sessions`,
      });
      const sorted = enriched.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
      res.json(sorted);
    } catch (error) {
      logger.error({ err: error }, "Failed to fetch coaching sessions");
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to fetch coaching sessions"));
    }
  });

  // Get coaching sessions for a specific employee
  app.get("/api/coaching/employee/:employeeId", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const sessions = await storage.getCoachingSessionsByEmployee(req.orgId!, req.params.employeeId);
      logPhiAccess({
        ...auditContext(req),
        event: "view_employee_coaching",
        resourceType: "coaching",
        resourceId: req.params.employeeId,
        detail: `${sessions.length} sessions for employee`,
      });
      res.json(sessions.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()));
    } catch (error) {
      logger.error({ err: error }, "Failed to fetch employee coaching sessions");
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to fetch coaching sessions"));
    }
  });

  // Create a coaching session (managers and admins)
  app.post("/api/coaching", requireAuth, injectOrgContext, requireRole("manager", "admin"), async (req, res) => {
    try {
      const parsed = insertCoachingSessionSchema.safeParse({
        ...req.body,
        assignedBy: req.user?.name || req.user?.username || "Unknown",
      });
      if (!parsed.success) {
        res.status(400).json({ message: "Invalid coaching data", errors: parsed.error.flatten() });
        return;
      }
      const session = await storage.createCoachingSession(req.orgId!, parsed.data);
      logPhiAccess({
        ...auditContext(req),
        event: "create_coaching_session",
        resourceType: "coaching",
        resourceId: session.id,
        detail: `Created coaching session for employee ${session.employeeId}`,
      });
      res.status(201).json(session);
    } catch (error) {
      logger.error({ err: error }, "Failed to create coaching session");
      res.status(500).json(errorResponse(ERROR_CODES.COACHING_CREATE_FAILED, "Failed to create coaching session"));
    }
  });

  // Update a coaching session (status, notes, action plan progress)
  const updateCoachingSchema = z.object({
    status: z.enum(["pending", "in_progress", "completed", "cancelled"]).optional(),
    notes: z.string().optional(),
    actionPlan: z.array(z.object({ task: z.string(), completed: z.boolean() })).optional(),
    title: z.string().min(1).optional(),
    category: z.string().optional(),
    dueDate: z.string().optional(),
  }).strict();

  app.patch("/api/coaching/:id", requireAuth, injectOrgContext, requireRole("manager", "admin"), async (req, res) => {
    try {
      const parsed = updateCoachingSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ message: "Invalid update data", errors: parsed.error.flatten() });
        return;
      }
      const updates: Record<string, any> = { ...parsed.data };
      if (updates.status === "completed") {
        updates.completedAt = new Date().toISOString();
      }
      const updated = await storage.updateCoachingSession(req.orgId!, req.params.id, updates);
      if (!updated) {
        res.status(404).json(errorResponse(ERROR_CODES.COACHING_NOT_FOUND, "Coaching session not found"));
        return;
      }
      logPhiAccess({
        ...auditContext(req),
        event: "update_coaching_session",
        resourceType: "coaching",
        resourceId: req.params.id,
        detail: `Updated fields: ${Object.keys(parsed.data).join(", ")}`,
      });

      // Gamification: award points when coaching session completed
      if (updates.status === "completed" && updated.employeeId) {
        try {
          const { recordActivity } = await import("./gamification");
          await recordActivity(req.orgId!, updated.employeeId, "coaching_completed");
        } catch (err) {
          logger.warn({ err, sessionId: req.params.id }, "Failed to update gamification for coaching completion");
        }
      }

      res.json(updated);
    } catch (error) {
      logger.error({ err: error }, "Failed to update coaching session");
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to update coaching session"));
    }
  });

  // ==================== COACHING RECOMMENDATIONS ====================

  // Get recommendations for the org (or filtered by employee)
  app.get("/api/coaching/recommendations", requireAuth, injectOrgContext, requireRole("manager", "admin"), async (req, res) => {
    try {
      const { getDatabase } = await import("../db/index");
      const db = getDatabase();
      if (!db) {
        res.json([]);
        return;
      }

      const { coachingRecommendations } = await import("../db/schema");
      const { eq, and, desc } = await import("drizzle-orm");

      const conditions = [eq(coachingRecommendations.orgId, req.orgId!)];
      const employeeId = req.query.employeeId as string | undefined;
      if (employeeId) {
        conditions.push(eq(coachingRecommendations.employeeId, employeeId));
      }
      const status = req.query.status as string | undefined;
      if (status) {
        conditions.push(eq(coachingRecommendations.status, status));
      }

      const rows = await db.select().from(coachingRecommendations)
        .where(and(...conditions))
        .orderBy(desc(coachingRecommendations.createdAt))
        .limit(50);

      res.json(rows);
    } catch (error) {
      logger.error({ err: error }, "Failed to fetch coaching recommendations");
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to fetch recommendations"));
    }
  });

  // Trigger recommendation generation for an employee
  app.post("/api/coaching/recommendations/generate", requireAuth, injectOrgContext, requireRole("manager", "admin"), async (req, res) => {
    try {
      const { employeeId } = req.body;
      if (!employeeId) {
        res.status(400).json({ message: "employeeId is required" });
        return;
      }

      const recs = await generateRecommendations(req.orgId!, employeeId);
      const saved = await saveRecommendations(req.orgId!, recs);

      res.json({ generated: recs.length, saved, recommendations: recs });
    } catch (error) {
      logger.error({ err: error }, "Failed to generate recommendations");
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to generate recommendations"));
    }
  });

  // Update recommendation status (accept → create coaching session, or dismiss)
  app.patch("/api/coaching/recommendations/:id", requireAuth, injectOrgContext, requireRole("manager", "admin"), async (req, res) => {
    try {
      const { status } = req.body;
      if (!status || !["accepted", "dismissed"].includes(status)) {
        res.status(400).json({ message: "status must be 'accepted' or 'dismissed'" });
        return;
      }

      const { getDatabase } = await import("../db/index");
      const db = getDatabase();
      if (!db) {
        res.status(503).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Database not available"));
        return;
      }

      const { coachingRecommendations } = await import("../db/schema");
      const { eq, and } = await import("drizzle-orm");

      const [rec] = await db.select().from(coachingRecommendations)
        .where(and(
          eq(coachingRecommendations.id, req.params.id),
          eq(coachingRecommendations.orgId, req.orgId!),
        ))
        .limit(1);

      if (!rec) {
        res.status(404).json(errorResponse(ERROR_CODES.COACHING_NOT_FOUND, "Recommendation not found"));
        return;
      }

      await db.update(coachingRecommendations)
        .set({ status })
        .where(eq(coachingRecommendations.id, req.params.id));

      res.json({ ...rec, status });
    } catch (error) {
      logger.error({ err: error }, "Failed to update recommendation");
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to update recommendation"));
    }
  });

  // ==================== AI COACHING PLAN ====================

  // Generate AI coaching plan for a session
  app.post("/api/coaching/:id/generate-plan", requireAuth, injectOrgContext, requireRole("manager", "admin"), async (req, res) => {
    try {
      const result = await generateCoachingPlan(req.orgId!, req.params.id);
      if (!result) {
        res.status(404).json(errorResponse(ERROR_CODES.COACHING_NOT_FOUND, "Session not found or AI not available"));
        return;
      }
      res.json(result);
    } catch (error) {
      logger.error({ err: error }, "Failed to generate coaching plan");
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to generate coaching plan"));
    }
  });

  // ==================== COACHING EFFECTIVENESS ====================

  // Get effectiveness metrics for a coaching session
  app.get("/api/coaching/:id/effectiveness", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const result = await calculateEffectiveness(req.orgId!, req.params.id);
      if (!result) {
        res.json({ message: "Not enough data to calculate effectiveness", data: null });
        return;
      }
      res.json(result);
    } catch (error) {
      logger.error({ err: error }, "Failed to calculate coaching effectiveness");
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to calculate effectiveness"));
    }
  });

  // ==================== MANAGER REVIEW QUEUE ====================

  // Get prioritized agent review queue
  app.get("/api/coaching/review-queue", requireAuth, injectOrgContext, requireRole("manager", "admin"), async (req, res) => {
    try {
      const queue = await getManagerReviewQueue(req.orgId!);
      res.json(queue);
    } catch (error) {
      logger.error({ err: error }, "Failed to get review queue");
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to get review queue"));
    }
  });

  // ==================== WEEKLY DIGEST ====================

  // Generate and optionally send weekly digest
  app.get("/api/coaching/digest", requireAuth, injectOrgContext, requireRole("manager", "admin"), async (req, res) => {
    try {
      const digest = await generateWeeklyDigest(req.orgId!);
      res.json(digest);
    } catch (error) {
      logger.error({ err: error }, "Failed to generate digest");
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to generate digest"));
    }
  });

  // Send the weekly digest to configured webhook
  app.post("/api/coaching/digest/send", requireAuth, injectOrgContext, requireRole("admin"), async (req, res) => {
    try {
      const digest = await generateWeeklyDigest(req.orgId!);
      const sent = await sendDigestNotification(digest);
      res.json({ sent, digest });
    } catch (error) {
      logger.error({ err: error }, "Failed to send digest");
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to send digest"));
    }
  });

  // ==================== COACHING ANALYTICS ====================

  app.get("/api/coaching/analytics", requireAuth, injectOrgContext, requireRole("manager", "admin"), async (req, res) => {
    try {
      const { from, to } = req.query;
      const fromDate = from ? new Date(from as string) : undefined;
      const toDate = to ? new Date(to as string) : undefined;
      const analytics = await storage.getCoachingAnalytics(req.orgId!, fromDate, toDate);
      res.json(analytics);
    } catch (error) {
      logger.error({ err: error }, "Failed to get coaching analytics");
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to get coaching analytics"));
    }
  });

  // ==================== COACHING TEMPLATES ====================

  app.get("/api/coaching/templates", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const { category } = req.query;
      const templates = await storage.listCoachingTemplates(req.orgId!, category as string | undefined);
      res.json(templates);
    } catch (error) {
      logger.error({ err: error }, "Failed to list coaching templates");
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to list coaching templates"));
    }
  });

  app.post("/api/coaching/templates", requireAuth, injectOrgContext, requireRole("manager", "admin"), async (req, res) => {
    try {
      const parsed = insertCoachingTemplateSchema.safeParse({
        ...req.body,
        orgId: req.orgId!,
        createdBy: req.user?.name || req.user?.username || "Unknown",
      });
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid template data", errors: parsed.error.flatten() });
      }
      const template = await storage.createCoachingTemplate(req.orgId!, parsed.data);
      logPhiAccess({ ...auditContext(req), event: "create_coaching_template", resourceType: "coaching_template", resourceId: template.id, detail: template.name });
      res.status(201).json(template);
    } catch (error) {
      logger.error({ err: error }, "Failed to create coaching template");
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to create coaching template"));
    }
  });

  app.patch("/api/coaching/templates/:id", requireAuth, injectOrgContext, requireRole("manager", "admin"), async (req, res) => {
    try {
      const updated = await storage.updateCoachingTemplate(req.orgId!, req.params.id, req.body);
      if (!updated) return res.status(404).json({ message: "Template not found" });
      res.json(updated);
    } catch (error) {
      logger.error({ err: error }, "Failed to update coaching template");
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to update coaching template"));
    }
  });

  app.delete("/api/coaching/templates/:id", requireAuth, injectOrgContext, requireRole("manager", "admin"), async (req, res) => {
    try {
      await storage.deleteCoachingTemplate(req.orgId!, req.params.id);
      logPhiAccess({ ...auditContext(req), event: "delete_coaching_template", resourceType: "coaching_template", resourceId: req.params.id });
      res.json({ message: "Template deleted." });
    } catch (error) {
      logger.error({ err: error }, "Failed to delete coaching template");
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to delete coaching template"));
    }
  });

  // ==================== AUTOMATION RULES ====================

  app.get("/api/coaching/automation-rules", requireAuth, injectOrgContext, requireRole("admin"), async (req, res) => {
    try {
      const rules = await storage.listAutomationRules(req.orgId!);
      res.json(rules);
    } catch (error) {
      logger.error({ err: error }, "Failed to list automation rules");
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to list automation rules"));
    }
  });

  app.post("/api/coaching/automation-rules", requireAuth, injectOrgContext, requireRole("admin"), async (req, res) => {
    try {
      const parsed = insertAutomationRuleSchema.safeParse({
        ...req.body,
        orgId: req.orgId!,
        createdBy: req.user?.name || req.user?.username || "Unknown",
      });
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid rule data", errors: parsed.error.flatten() });
      }
      const rule = await storage.createAutomationRule(req.orgId!, parsed.data);
      logPhiAccess({ ...auditContext(req), event: "create_automation_rule", resourceType: "coaching", resourceId: rule.id, detail: rule.name });
      res.status(201).json(rule);
    } catch (error) {
      logger.error({ err: error }, "Failed to create automation rule");
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to create automation rule"));
    }
  });

  app.patch("/api/coaching/automation-rules/:id", requireAuth, injectOrgContext, requireRole("admin"), async (req, res) => {
    try {
      const updated = await storage.updateAutomationRule(req.orgId!, req.params.id, req.body);
      if (!updated) return res.status(404).json({ message: "Rule not found" });
      res.json(updated);
    } catch (error) {
      logger.error({ err: error }, "Failed to update automation rule");
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to update automation rule"));
    }
  });

  app.delete("/api/coaching/automation-rules/:id", requireAuth, injectOrgContext, requireRole("admin"), async (req, res) => {
    try {
      await storage.deleteAutomationRule(req.orgId!, req.params.id);
      res.json({ message: "Rule deleted." });
    } catch (error) {
      logger.error({ err: error }, "Failed to delete automation rule");
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to delete automation rule"));
    }
  });

  // Manually trigger automation rule evaluation for an org or specific employee
  app.post("/api/coaching/automation-rules/run", requireAuth, injectOrgContext, requireRole("admin"), async (req, res) => {
    try {
      const { employeeId } = req.body;
      const result = await runAutomationRules(req.orgId!, employeeId);
      res.json(result);
    } catch (error) {
      logger.error({ err: error }, "Failed to run automation rules");
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to run automation rules"));
    }
  });

  // ==================== SELF-ASSESSMENT ====================

  const selfAssessSchema = z.object({
    score: z.number().min(0).max(10),
    notes: z.string().optional(),
  });

  // Employee submits self-assessment before seeing AI analysis
  app.post("/api/coaching/:id/self-assess", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const session = await storage.getCoachingSession(req.orgId!, req.params.id);
      if (!session) return res.status(404).json({ message: "Coaching session not found" });

      // Ensure the requesting user is the employee being coached (or a manager/admin can also submit)
      const parsedBody = selfAssessSchema.safeParse(req.body);
      if (!parsedBody.success) {
        return res.status(400).json({ message: "Invalid self-assessment data", errors: parsedBody.error.flatten() });
      }

      if ((session as any).selfAssessedAt) {
        return res.status(409).json({ message: "Self-assessment already submitted for this session." });
      }

      const updated = await storage.updateCoachingSession(req.orgId!, req.params.id, {
        selfAssessmentScore: parsedBody.data.score,
        selfAssessmentNotes: parsedBody.data.notes,
        selfAssessedAt: new Date().toISOString(),
      } as any);

      logPhiAccess({
        ...auditContext(req),
        event: "self_assessment_submitted",
        resourceType: "coaching",
        resourceId: req.params.id,
        detail: `Self-assessment score: ${parsedBody.data.score}`,
      });

      res.json(updated);
    } catch (error) {
      logger.error({ err: error }, "Failed to submit self-assessment");
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to submit self-assessment"));
    }
  });

  // Get self-assessment for a session (managers/admins see full data; employee sees own)
  app.get("/api/coaching/:id/self-assessment", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const session = await storage.getCoachingSession(req.orgId!, req.params.id);
      if (!session) return res.status(404).json({ message: "Coaching session not found" });
      res.json({
        submitted: !!(session as any).selfAssessedAt,
        score: (session as any).selfAssessmentScore ?? null,
        notes: (session as any).selfAssessmentNotes ?? null,
        submittedAt: (session as any).selfAssessedAt ?? null,
      });
    } catch (error) {
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to get self-assessment"));
    }
  });

  // ==================== FOLLOW-UP & OVERDUE ====================

  // Sessions due soon (configurable window, default 24h)
  app.get("/api/coaching/due-soon", requireAuth, injectOrgContext, requireRole("manager", "admin"), async (req, res) => {
    try {
      const windowHours = req.query.windowHours ? parseInt(req.query.windowHours as string, 10) : 24;
      const dueSoon = await getDueSoonSessions(req.orgId!, windowHours);
      res.json(dueSoon);
    } catch (error) {
      logger.error({ err: error }, "Failed to get due-soon sessions");
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to get due-soon sessions"));
    }
  });

  // Overdue sessions
  app.get("/api/coaching/overdue", requireAuth, injectOrgContext, requireRole("manager", "admin"), async (req, res) => {
    try {
      const overdue = await getOverdueSessions(req.orgId!);
      res.json(overdue);
    } catch (error) {
      logger.error({ err: error }, "Failed to get overdue sessions");
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to get overdue sessions"));
    }
  });

  // Force-compute and cache effectiveness for a session
  app.post("/api/coaching/:id/effectiveness/snapshot", requireAuth, injectOrgContext, requireRole("manager", "admin"), async (req, res) => {
    try {
      const session = await storage.getCoachingSession(req.orgId!, req.params.id);
      if (!session) return res.status(404).json({ message: "Session not found" });
      await calculateAndCacheEffectiveness(req.orgId!, req.params.id);
      const updated = await storage.getCoachingSession(req.orgId!, req.params.id);
      res.json({ effectivenessSnapshot: (updated as any)?.effectivenessSnapshot || null });
    } catch (error) {
      logger.error({ err: error }, "Failed to compute effectiveness snapshot");
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to compute effectiveness snapshot"));
    }
  });
}
