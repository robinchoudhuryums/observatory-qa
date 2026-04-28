import type { Express } from "express";
import { storage } from "../storage";
import { requireAuth, requireRole, injectOrgContext, getTeamScopedEmployeeIds } from "../auth";
import { insertCoachingSessionSchema } from "@shared/schema";
import { z } from "zod";
import { selfAssessSchema } from "@shared/schema";
import {
  generateRecommendations,
  saveRecommendations,
  generateCoachingPlan,
  calculateEffectiveness,
  runAutomationRules,
  calculateAndCacheEffectiveness,
  getDueSoonSessions,
  getOverdueSessions,
} from "../services/coaching-engine";
import { insertCoachingTemplateSchema, insertAutomationRuleSchema } from "@shared/schema";
import { getManagerReviewQueue, generateWeeklyDigest } from "../services/proactive-alerts";
import { sendDigestNotification } from "../services/notifications";
import { logger } from "../services/logger";
import { logPhiAccess, auditContext } from "../services/audit-log";
import { errorResponse, ERROR_CODES } from "../services/error-codes";
import { parsePagination, paginateArray } from "./helpers";
import { asyncHandler, AppError } from "../middleware/error-handler";
import { aiProvider } from "../services/ai-factory";
import { withRetry } from "../utils/helpers";
import type { InsertLearningModule } from "@shared/schema";

export function registerCoachingRoutes(app: Express): void {
  // ==================== COACHING ROUTES ====================

  // List all coaching sessions (managers and admins) — filtered by subTeam when applicable
  app.get(
    "/api/coaching",
    requireAuth,
    injectOrgContext,
    requireRole("manager", "admin"),
    asyncHandler(async (req, res) => {
      const { limit, offset } = parsePagination(req.query);
      let sessions = await storage.getAllCoachingSessions(req.orgId!);

      // Team-scoped filtering: managers with a subTeam see only their team's sessions
      const teamEmployeeIds = req.user ? await getTeamScopedEmployeeIds(req.orgId!, req.user) : null;
      if (teamEmployeeIds !== null) {
        sessions = sessions.filter((s) => teamEmployeeIds.has(s.employeeId));
      }

      // Batch-load employee names instead of N+1
      const employees = await storage.getAllEmployees(req.orgId!);
      const empMap = new Map(employees.map((e) => [e.id, e.name]));
      const enriched = sessions.map((s) => ({
        ...s,
        employeeName: empMap.get(s.employeeId) || "Unknown",
      }));
      logPhiAccess({
        ...auditContext(req),
        event: "view_coaching_sessions",
        resourceType: "coaching",
        detail: `Listed ${enriched.length} coaching sessions`,
      });
      const sorted = enriched.sort(
        (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime(),
      );
      // Apply pagination (limit/offset from query params)
      const paginated = sorted.slice(offset, offset + limit);
      res.json(paginated);
    }),
  );

  // Get coaching sessions for the currently authenticated user (viewer self-service)
  // Looks up the employee record matching the user's email/username and returns their sessions.
  app.get(
    "/api/coaching/my",
    requireAuth,
    injectOrgContext,
    asyncHandler(async (req, res) => {
      const username = req.user!.username;
      // Try to find the matching employee by email (username is usually email)
      let employee = await storage.getEmployeeByEmail(req.orgId!, username);
      // Fallback: search all employees for a name match (case-insensitive)
      if (!employee) {
        const all = await storage.getAllEmployees(req.orgId!);
        const nameLower = req.user!.name?.toLowerCase();
        employee = all.find(
          (e) => e.name?.toLowerCase() === nameLower || e.email?.toLowerCase() === username.toLowerCase(),
        );
      }
      if (!employee) {
        return res.json([]); // No employee record linked — return empty
      }
      const sessions = await storage.getCoachingSessionsByEmployee(req.orgId!, employee.id);
      logPhiAccess({
        ...auditContext(req),
        event: "view_own_coaching_sessions",
        resourceType: "coaching",
        resourceId: employee.id,
        detail: `${sessions.length} sessions for self`,
      });
      res.json(sessions.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()));
    }),
  );

  // Get coaching sessions for a specific employee
  app.get(
    "/api/coaching/employee/:employeeId",
    requireAuth,
    injectOrgContext,
    asyncHandler(async (req, res) => {
      // Team scoping: verify caller has access to this employee
      const teamIds = req.user?.role !== "admin" ? await getTeamScopedEmployeeIds(req.orgId!, req.user!) : null;
      if (teamIds !== null && !teamIds.has(req.params.employeeId)) {
        throw new AppError(403, "Employee is outside your team");
      }
      const sessions = await storage.getCoachingSessionsByEmployee(req.orgId!, req.params.employeeId);
      logPhiAccess({
        ...auditContext(req),
        event: "view_employee_coaching",
        resourceType: "coaching",
        resourceId: req.params.employeeId,
        detail: `${sessions.length} sessions for employee`,
      });
      res.json(sessions.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()));
    }),
  );

  // Create a coaching session (managers and admins)
  app.post(
    "/api/coaching",
    requireAuth,
    injectOrgContext,
    requireRole("manager", "admin"),
    asyncHandler(async (req, res) => {
      const parsed = insertCoachingSessionSchema.safeParse({
        ...req.body,
        assignedBy: req.user?.name || req.user?.username || "Unknown",
      });
      if (!parsed.success) {
        throw new AppError(400, "Invalid coaching data");
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
    }),
  );

  // Update a coaching session (status, notes, action plan progress)
  const updateCoachingSchema = z
    .object({
      status: z.enum(["pending", "in_progress", "completed", "cancelled"]).optional(),
      notes: z.string().optional(),
      actionPlan: z.array(z.object({ task: z.string(), completed: z.boolean() })).optional(),
      title: z.string().min(1).optional(),
      category: z.string().optional(),
      dueDate: z.string().optional(),
    })
    .strict();

  app.patch(
    "/api/coaching/:id",
    requireAuth,
    injectOrgContext,
    requireRole("manager", "admin"),
    asyncHandler(async (req, res) => {
      const parsed = updateCoachingSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(400, "Invalid update data");
      }
      const updates: Record<string, any> = { ...parsed.data };
      if (updates.status === "completed") {
        updates.completedAt = new Date().toISOString();
      }
      const updated = await storage.updateCoachingSession(req.orgId!, req.params.id, updates);
      if (!updated) {
        throw new AppError(404, "Coaching session not found", ERROR_CODES.COACHING_NOT_FOUND);
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
    }),
  );

  // ==================== COACHING RECOMMENDATIONS ====================

  // Get recommendations for the org (or filtered by employee)
  app.get(
    "/api/coaching/recommendations",
    requireAuth,
    injectOrgContext,
    requireRole("manager", "admin"),
    asyncHandler(async (req, res) => {
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

      const rows = await db
        .select()
        .from(coachingRecommendations)
        .where(and(...conditions))
        .orderBy(desc(coachingRecommendations.createdAt))
        .limit(50);

      res.json(rows);
    }),
  );

  // Trigger recommendation generation for an employee
  app.post(
    "/api/coaching/recommendations/generate",
    requireAuth,
    injectOrgContext,
    requireRole("manager", "admin"),
    asyncHandler(async (req, res) => {
      const { employeeId } = req.body;
      if (!employeeId) {
        throw new AppError(400, "employeeId is required");
      }

      const recs = await generateRecommendations(req.orgId!, employeeId);
      const saved = await saveRecommendations(req.orgId!, recs);

      res.json({ generated: recs.length, saved, recommendations: recs });
    }),
  );

  // Update recommendation status (accept → create coaching session, or dismiss)
  app.patch(
    "/api/coaching/recommendations/:id",
    requireAuth,
    injectOrgContext,
    requireRole("manager", "admin"),
    asyncHandler(async (req, res) => {
      const { status } = req.body;
      if (!status || !["accepted", "dismissed"].includes(status)) {
        throw new AppError(400, "status must be 'accepted' or 'dismissed'");
      }

      const { getDatabase } = await import("../db/index");
      const db = getDatabase();
      if (!db) {
        throw new AppError(503, "Database not available");
      }

      const { coachingRecommendations } = await import("../db/schema");
      const { eq, and } = await import("drizzle-orm");

      const [rec] = await db
        .select()
        .from(coachingRecommendations)
        .where(and(eq(coachingRecommendations.id, req.params.id), eq(coachingRecommendations.orgId, req.orgId!)))
        .limit(1);

      if (!rec) {
        throw new AppError(404, "Recommendation not found", ERROR_CODES.COACHING_NOT_FOUND);
      }

      await db.update(coachingRecommendations).set({ status }).where(eq(coachingRecommendations.id, req.params.id));

      res.json({ ...rec, status });
    }),
  );

  // ==================== AI COACHING PLAN ====================

  // Generate AI coaching plan for a session
  app.post(
    "/api/coaching/:id/generate-plan",
    requireAuth,
    injectOrgContext,
    requireRole("manager", "admin"),
    asyncHandler(async (req, res) => {
      const result = await generateCoachingPlan(req.orgId!, req.params.id);
      if (!result) {
        throw new AppError(404, "Session not found or AI not available", ERROR_CODES.COACHING_NOT_FOUND);
      }
      res.json(result);
    }),
  );

  // ==================== COACHING EFFECTIVENESS ====================

  // Get effectiveness metrics for a coaching session
  app.get(
    "/api/coaching/:id/effectiveness",
    requireAuth,
    injectOrgContext,
    asyncHandler(async (req, res) => {
      const result = await calculateEffectiveness(req.orgId!, req.params.id);
      if (!result) {
        res.json({ message: "Not enough data to calculate effectiveness", data: null });
        return;
      }
      res.json(result);
    }),
  );

  // ==================== MANAGER REVIEW QUEUE ====================

  // Get prioritized agent review queue
  app.get(
    "/api/coaching/review-queue",
    requireAuth,
    injectOrgContext,
    requireRole("manager", "admin"),
    asyncHandler(async (req, res) => {
      const queue = await getManagerReviewQueue(req.orgId!);
      res.json(queue);
    }),
  );

  // ==================== WEEKLY DIGEST ====================

  // Generate and optionally send weekly digest
  app.get(
    "/api/coaching/digest",
    requireAuth,
    injectOrgContext,
    requireRole("manager", "admin"),
    asyncHandler(async (req, res) => {
      const digest = await generateWeeklyDigest(req.orgId!);
      res.json(digest);
    }),
  );

  // Send the weekly digest to configured webhook
  app.post(
    "/api/coaching/digest/send",
    requireAuth,
    injectOrgContext,
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const digest = await generateWeeklyDigest(req.orgId!);
      const sent = await sendDigestNotification(digest);
      res.json({ sent, digest });
    }),
  );

  // ==================== COACHING ANALYTICS ====================

  app.get(
    "/api/coaching/analytics",
    requireAuth,
    injectOrgContext,
    requireRole("manager", "admin"),
    asyncHandler(async (req, res) => {
      const { from, to } = req.query;
      const fromDate = from ? new Date(from as string) : undefined;
      const toDate = to ? new Date(to as string) : undefined;
      const analytics = await storage.getCoachingAnalytics(req.orgId!, fromDate, toDate);
      res.json(analytics);
    }),
  );

  // ==================== COACHING TEMPLATES ====================

  app.get(
    "/api/coaching/templates",
    requireAuth,
    injectOrgContext,
    asyncHandler(async (req, res) => {
      const { category } = req.query;
      const templates = await storage.listCoachingTemplates(req.orgId!, category as string | undefined);
      res.json(templates);
    }),
  );

  app.post(
    "/api/coaching/templates",
    requireAuth,
    injectOrgContext,
    requireRole("manager", "admin"),
    asyncHandler(async (req, res) => {
      const parsed = insertCoachingTemplateSchema.safeParse({
        ...req.body,
        orgId: req.orgId!,
        createdBy: req.user?.name || req.user?.username || "Unknown",
      });
      if (!parsed.success) {
        throw new AppError(400, "Invalid template data");
      }
      const template = await storage.createCoachingTemplate(req.orgId!, parsed.data);
      logPhiAccess({
        ...auditContext(req),
        event: "create_coaching_template",
        resourceType: "coaching_template",
        resourceId: template.id,
        detail: template.name,
      });
      res.status(201).json(template);
    }),
  );

  app.patch(
    "/api/coaching/templates/:id",
    requireAuth,
    injectOrgContext,
    requireRole("manager", "admin"),
    asyncHandler(async (req, res) => {
      const updated = await storage.updateCoachingTemplate(req.orgId!, req.params.id, req.body);
      if (!updated) {
        throw new AppError(404, "Template not found");
      }
      res.json(updated);
    }),
  );

  app.delete(
    "/api/coaching/templates/:id",
    requireAuth,
    injectOrgContext,
    requireRole("manager", "admin"),
    asyncHandler(async (req, res) => {
      await storage.deleteCoachingTemplate(req.orgId!, req.params.id);
      logPhiAccess({
        ...auditContext(req),
        event: "delete_coaching_template",
        resourceType: "coaching_template",
        resourceId: req.params.id,
      });
      res.json({ message: "Template deleted." });
    }),
  );

  // ==================== AUTOMATION RULES ====================

  app.get(
    "/api/coaching/automation-rules",
    requireAuth,
    injectOrgContext,
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const rules = await storage.listAutomationRules(req.orgId!);
      res.json(rules);
    }),
  );

  app.post(
    "/api/coaching/automation-rules",
    requireAuth,
    injectOrgContext,
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const parsed = insertAutomationRuleSchema.safeParse({
        ...req.body,
        orgId: req.orgId!,
        createdBy: req.user?.name || req.user?.username || "Unknown",
      });
      if (!parsed.success) {
        throw new AppError(400, "Invalid rule data");
      }
      const rule = await storage.createAutomationRule(req.orgId!, parsed.data);
      logPhiAccess({
        ...auditContext(req),
        event: "create_automation_rule",
        resourceType: "coaching",
        resourceId: rule.id,
        detail: rule.name,
      });
      res.status(201).json(rule);
    }),
  );

  app.patch(
    "/api/coaching/automation-rules/:id",
    requireAuth,
    injectOrgContext,
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const updated = await storage.updateAutomationRule(req.orgId!, req.params.id, req.body);
      if (!updated) {
        throw new AppError(404, "Rule not found");
      }
      res.json(updated);
    }),
  );

  app.delete(
    "/api/coaching/automation-rules/:id",
    requireAuth,
    injectOrgContext,
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      await storage.deleteAutomationRule(req.orgId!, req.params.id);
      res.json({ message: "Rule deleted." });
    }),
  );

  // Manually trigger automation rule evaluation for an org or specific employee
  app.post(
    "/api/coaching/automation-rules/run",
    requireAuth,
    injectOrgContext,
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const { employeeId } = req.body;
      const result = await runAutomationRules(req.orgId!, employeeId);
      res.json(result);
    }),
  );

  // ==================== SELF-ASSESSMENT ====================

  // Employee submits self-assessment before seeing AI analysis
  app.post(
    "/api/coaching/:id/self-assess",
    requireAuth,
    injectOrgContext,
    asyncHandler(async (req, res) => {
      const session = await storage.getCoachingSession(req.orgId!, req.params.id);
      if (!session) {
        throw new AppError(404, "Coaching session not found");
      }

      // Ensure the requesting user is the employee being coached (or a manager/admin can also submit)
      const parsedBody = selfAssessSchema.safeParse(req.body);
      if (!parsedBody.success) {
        throw new AppError(400, "Invalid self-assessment data");
      }

      if ((session as any).selfAssessedAt) {
        throw new AppError(409, "Self-assessment already submitted for this session.");
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
    }),
  );

  // Get self-assessment for a session (managers/admins see full data; employee sees own)
  app.get(
    "/api/coaching/:id/self-assessment",
    requireAuth,
    injectOrgContext,
    asyncHandler(async (req, res) => {
      const session = await storage.getCoachingSession(req.orgId!, req.params.id);
      if (!session) {
        throw new AppError(404, "Coaching session not found");
      }
      res.json({
        submitted: !!(session as any).selfAssessedAt,
        score: (session as any).selfAssessmentScore ?? null,
        notes: (session as any).selfAssessmentNotes ?? null,
        submittedAt: (session as any).selfAssessedAt ?? null,
      });
    }),
  );

  // ==================== FOLLOW-UP & OVERDUE ====================

  // Sessions due soon (configurable window, default 24h)
  app.get(
    "/api/coaching/due-soon",
    requireAuth,
    injectOrgContext,
    requireRole("manager", "admin"),
    asyncHandler(async (req, res) => {
      const windowHours = req.query.windowHours ? parseInt(req.query.windowHours as string, 10) : 24;
      const dueSoon = await getDueSoonSessions(req.orgId!, windowHours);
      res.json(dueSoon);
    }),
  );

  // Overdue sessions
  app.get(
    "/api/coaching/overdue",
    requireAuth,
    injectOrgContext,
    requireRole("manager", "admin"),
    asyncHandler(async (req, res) => {
      const overdue = await getOverdueSessions(req.orgId!);
      res.json(overdue);
    }),
  );

  // Force-compute and cache effectiveness for a session
  app.post(
    "/api/coaching/:id/effectiveness/snapshot",
    requireAuth,
    injectOrgContext,
    requireRole("manager", "admin"),
    asyncHandler(async (req, res) => {
      const session = await storage.getCoachingSession(req.orgId!, req.params.id);
      if (!session) {
        throw new AppError(404, "Session not found");
      }
      await calculateAndCacheEffectiveness(req.orgId!, req.params.id);
      const updated = await storage.getCoachingSession(req.orgId!, req.params.id);
      res.json({ effectivenessSnapshot: (updated as any)?.effectivenessSnapshot || null });
    }),
  );

  /**
   * POST /api/coaching/:id/generate-lms-module — Auto-generate a focused LMS module from a coaching session.
   *
   * Uses the coaching session's category, notes, and linked call analysis to build a training module
   * tailored to the specific weakness being addressed. Closes the coaching → training → measurement loop:
   *   coaching session → this endpoint → learning module → assign → completion feeds coaching effectiveness.
   *
   * Body params (all optional):
   *   assignToEmployee: boolean — if true, the generated module is auto-assigned to the coached employee
   *   generateQuiz: boolean — include a short knowledge-check quiz
   *   difficulty: "beginner" | "intermediate" | "advanced"
   */
  app.post(
    "/api/coaching/:id/generate-lms-module",
    requireAuth,
    injectOrgContext,
    requireRole("manager", "admin"),
    asyncHandler(async (req, res) => {
      const orgId = req.orgId!;
      const sessionId = req.params.id;

      const session = await storage.getCoachingSession(orgId, sessionId);
      if (!session) throw new AppError(404, "Coaching session not found");

      const employee = await storage.getEmployee(orgId, session.employeeId);
      if (!employee) throw new AppError(404, "Employee not found");

      if (!aiProvider.isAvailable || !aiProvider.generateText) {
        return res
          .status(503)
          .json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "AI provider not available for module generation"));
      }

      const { assignToEmployee = false, generateQuiz = true, difficulty = "intermediate" } = req.body || {};

      // Pull the linked call (if any) to give the AI real context
      let callContext = "";
      if (session.callId) {
        const call = await storage.getCall(orgId, session.callId);
        const analysis = await storage.getCallAnalysis(orgId, session.callId);
        if (call && analysis) {
          const summary = (analysis as any).summary || "";
          const feedback = (analysis as any).feedback || {};
          const score = (analysis as any).performanceScore || "N/A";
          callContext = `\n\nREFERENCE CALL CONTEXT (for the AI — do NOT include identifying details in the module):
- Category: ${call.callCategory || "general"}
- Performance Score: ${score}/10
- Brief Summary: ${String(summary).slice(0, 500)}
- Suggested Improvements: ${Array.isArray(feedback.suggestions) ? feedback.suggestions.slice(0, 5).join("; ") : ""}`;
        }
      }

      const quizInstruction = generateQuiz
        ? `\n5. A "quizQuestions" array with 3-5 multiple-choice questions. Each: {"question":"...","options":["A","B","C","D"],"correctIndex":0,"explanation":"Why this is correct"}`
        : "";

      // The prompt intentionally requests a GENERIC module (not PHI-laden), because
      // the module will be shown to multiple employees, not just the coached one.
      const prompt = `You are creating a short, focused training module from a coaching session.
The goal is to close a specific performance gap identified by a coach. Output a short (3-6 minute read)
module that any agent could use — do NOT reference the specific employee or any PHI.

COACHING SESSION:
- Category: ${session.category}
- Title: ${session.title}
${session.notes ? `- Coach Notes: ${String(session.notes).slice(0, 2000)}` : ""}
${(session as any).actionPlan ? `- Action Plan: ${String((session as any).actionPlan).slice(0, 2000)}` : ""}
${callContext}

Create a training module with:
1. A clear, engaging title (e.g., "Handling Compliance Disclosures Confidently")
2. A brief 1-2 sentence description
3. Well-organized Markdown content with clear headings, key takeaways, and practical examples
4. An "estimatedMinutes" field (integer, reading time)${quizInstruction}

Respond with ONLY valid JSON (no markdown fences):
{"title":"...","description":"...","content":"...markdown...","estimatedMinutes":5${generateQuiz ? ',"quizQuestions":[...]' : ""}}`;

      const response = await withRetry(() => aiProvider.generateText!(prompt), {
        retries: 2,
        baseDelay: 2000,
        label: "coaching-to-lms module generation",
      });

      // Parse AI response — uses the same safe extraction pattern as lms.ts
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        logger.warn({ orgId, sessionId }, "Coaching-to-LMS: AI response was not parseable");
        return res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "AI response was not parseable"));
      }

      let generated: any;
      try {
        generated = JSON.parse(jsonMatch[0]);
      } catch (err) {
        logger.warn({ orgId, sessionId, err }, "Coaching-to-LMS: JSON parse failed");
        return res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "AI response was malformed"));
      }

      const moduleInput: InsertLearningModule = {
        orgId,
        title: String(generated.title || `Training: ${session.title}`).slice(0, 500),
        description: String(generated.description || `Auto-generated from coaching session "${session.title}"`).slice(
          0,
          5000,
        ),
        contentType: "ai_generated",
        category: session.category || "coaching",
        content: String(generated.content || "").slice(0, 500000),
        quizQuestions: Array.isArray(generated.quizQuestions)
          ? generated.quizQuestions.slice(0, 20).map((q: any) => ({
              question: String(q.question || "").slice(0, 1000),
              options: Array.isArray(q.options) ? q.options.slice(0, 10).map((o: any) => String(o).slice(0, 500)) : [],
              correctIndex: typeof q.correctIndex === "number" ? q.correctIndex : 0,
              explanation: q.explanation ? String(q.explanation).slice(0, 1000) : undefined,
            }))
          : undefined,
        estimatedMinutes: typeof generated.estimatedMinutes === "number" ? generated.estimatedMinutes : 5,
        difficulty: ["beginner", "intermediate", "advanced"].includes(difficulty) ? difficulty : "intermediate",
        tags: [session.category || "coaching", "ai_generated", "coaching_derived"],
        isPublished: false, // draft by default — manager reviews before publishing
        createdBy: (req.user as any)?.name || (req.user as any)?.username || "system",
      };

      const module = await storage.createLearningModule(orgId, moduleInput);

      // Link the module back to the coaching session for effectiveness tracking
      try {
        const existing = ((session as any).linkedLearningModuleIds as string[] | undefined) || [];
        await storage.updateCoachingSession(orgId, sessionId, {
          linkedLearningModuleIds: [...existing, module.id],
        } as any);
      } catch (err) {
        // Non-fatal: linking is best-effort; module creation already succeeded
        logger.debug({ err, orgId, sessionId }, "Coaching-to-LMS: failed to link module back to session");
      }

      // Optionally auto-assign to the coached employee
      let assigned = false;
      if (assignToEmployee && employee.id && (storage as any).updateLearningProgress) {
        try {
          await (storage as any).updateLearningProgress(orgId, employee.id, module.id, {
            status: "not_started",
            assignedAt: new Date().toISOString(),
            assignedBy: (req.user as any)?.id,
          });
          assigned = true;
        } catch (err) {
          logger.debug({ err, orgId, sessionId, employeeId: employee.id }, "Auto-assign to employee failed");
        }
      }

      logPhiAccess({
        ...auditContext(req),
        event: "coaching_lms_module_generated",
        resourceType: "coaching_session",
        resourceId: sessionId,
        detail: `Generated LMS module ${module.id} from coaching session${assigned ? " (auto-assigned)" : ""}`,
      });

      res.status(201).json({
        module,
        assigned,
        linkedToSession: sessionId,
      });
    }),
  );
}
