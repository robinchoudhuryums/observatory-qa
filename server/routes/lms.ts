/**
 * LMS (Learning Management System) routes.
 *
 * Features:
 * - Learning modules: articles, quizzes, AI-generated content from reference docs
 * - Learning paths: ordered sequences of modules
 * - Employee progress tracking
 * - AI-powered module generation from uploaded reference documents
 * - RAG-powered knowledge base search for employees
 */
import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { requireAuth, requireRole, injectOrgContext } from "../auth";
import { aiProvider } from "../services/ai-factory";
import { logger } from "../services/logger";
import { withRetry, validateUUIDParam } from "./helpers";
import { errorResponse, ERROR_CODES } from "../services/error-codes";
import type { LearningModule, InsertLearningModule } from "@shared/schema";

/**
 * Detect circular dependencies in module prerequisites.
 * Uses DFS with visited/inStack tracking (standard cycle detection).
 * Returns the cycle path if found, or null if no cycle.
 */
async function detectPrerequisiteCycle(
  orgId: string,
  moduleId: string,
  prerequisiteModuleIds: string[],
): Promise<string[] | null> {
  // Build adjacency map: moduleId → prerequisiteModuleIds
  const allModules = await storage.listLearningModules(orgId);
  const prereqMap = new Map<string, string[]>();
  for (const m of allModules) {
    prereqMap.set(m.id, Array.isArray(m.prerequisiteModuleIds) ? m.prerequisiteModuleIds as string[] : []);
  }
  // Apply the proposed change
  prereqMap.set(moduleId, prerequisiteModuleIds);

  // DFS cycle detection
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const path: string[] = [];

  function dfs(id: string): boolean {
    if (inStack.has(id)) return true; // Cycle found
    if (visited.has(id)) return false;
    visited.add(id);
    inStack.add(id);
    path.push(id);
    for (const prereq of prereqMap.get(id) || []) {
      if (dfs(prereq)) return true;
    }
    inStack.delete(id);
    path.pop();
    return false;
  }

  if (dfs(moduleId)) return path;
  return null;
}

/**
 * Check if a learning path's deadline has passed.
 * Returns { overdue: boolean, daysRemaining: number } or null if no deadline.
 */
function checkPathDeadline(path: { dueDate?: string | null }): { overdue: boolean; daysRemaining: number } | null {
  if (!path.dueDate) return null;
  const due = new Date(path.dueDate);
  if (isNaN(due.getTime())) return null;
  const daysRemaining = Math.ceil((due.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
  return { overdue: daysRemaining < 0, daysRemaining };
}

export function registerLmsRoutes(app: Express): void {

  // --- Learning Modules ---

  /** GET /api/lms/modules — List all learning modules for the org */
  app.get("/api/lms/modules", requireAuth, async (req: Request, res: Response) => {
    const orgId = req.orgId;
    if (!orgId) return res.status(403).json({ message: "Organization context required" });

    const { category, contentType, published } = req.query;
    const modules = await storage.listLearningModules(orgId, {
      category: category as string | undefined,
      contentType: contentType as string | undefined,
      isPublished: published === "true" ? true : published === "false" ? false : undefined,
    });
    res.json(modules);
  });

  /** GET /api/lms/modules/:id — Get a specific module */
  app.get("/api/lms/modules/:id", requireAuth, validateUUIDParam(), async (req: Request, res: Response) => {
    const orgId = req.orgId;
    if (!orgId) return res.status(403).json({ message: "Organization context required" });

    const module = await storage.getLearningModule(orgId, req.params.id);
    if (!module) return res.status(404).json({ message: "Module not found" });
    res.json(module);
  });

  /** POST /api/lms/modules — Create a new learning module */
  app.post("/api/lms/modules", requireAuth, requireRole("manager"), async (req: Request, res: Response) => {
    const orgId = req.orgId;
    if (!orgId) return res.status(403).json({ message: "Organization context required" });

    const { title, description, contentType, category, content, quizQuestions, estimatedMinutes, difficulty, tags, isPublished, prerequisiteModuleIds, passingScore } = req.body;
    if (!title || !contentType) return res.status(400).json({ message: "title and contentType are required" });

    // Validate prerequisites exist and don't create cycles
    if (Array.isArray(prerequisiteModuleIds) && prerequisiteModuleIds.length > 0) {
      for (const prereqId of prerequisiteModuleIds) {
        const prereq = await storage.getLearningModule(orgId, prereqId);
        if (!prereq) return res.status(400).json({ message: `Prerequisite module ${prereqId} not found` });
      }
    }

    const module = await storage.createLearningModule(orgId, {
      orgId,
      title,
      description,
      contentType,
      category,
      content,
      quizQuestions,
      estimatedMinutes,
      difficulty,
      tags,
      isPublished: isPublished ?? false,
      createdBy: (req.user as any)?.name || "unknown",
      prerequisiteModuleIds: Array.isArray(prerequisiteModuleIds) ? prerequisiteModuleIds : undefined,
      passingScore: typeof passingScore === "number" ? passingScore : undefined,
    });

    // Check for circular dependencies after creation (module now has an ID)
    if (Array.isArray(prerequisiteModuleIds) && prerequisiteModuleIds.length > 0) {
      const cycle = await detectPrerequisiteCycle(orgId, module.id, prerequisiteModuleIds);
      if (cycle) {
        // Remove the module we just created to avoid leaving orphaned data
        await storage.deleteLearningModule(orgId, module.id);
        return res.status(400).json({
          message: "Circular dependency detected in prerequisites",
          cycle: cycle.map(id => id.slice(0, 8)), // Truncate IDs for readability
        });
      }
    }

    res.status(201).json(module);
  });

  /** PATCH /api/lms/modules/:id — Update a module */
  app.patch("/api/lms/modules/:id", requireAuth, requireRole("manager"), validateUUIDParam(), async (req: Request, res: Response) => {
    const orgId = req.orgId;
    if (!orgId) return res.status(403).json({ message: "Organization context required" });

    // Validate prerequisites if being changed
    if (Array.isArray(req.body.prerequisiteModuleIds)) {
      for (const prereqId of req.body.prerequisiteModuleIds) {
        if (prereqId === req.params.id) return res.status(400).json({ message: "Module cannot be a prerequisite of itself" });
        const prereq = await storage.getLearningModule(orgId, prereqId);
        if (!prereq) return res.status(400).json({ message: `Prerequisite module ${prereqId} not found` });
      }
      const cycle = await detectPrerequisiteCycle(orgId, req.params.id, req.body.prerequisiteModuleIds);
      if (cycle) {
        return res.status(400).json({
          message: "Circular dependency detected in prerequisites",
          cycle: cycle.map(id => id.slice(0, 8)),
        });
      }
    }

    const updated = await storage.updateLearningModule(orgId, req.params.id, req.body);
    if (!updated) return res.status(404).json({ message: "Module not found" });
    res.json(updated);
  });

  /** DELETE /api/lms/modules/:id — Delete a module */
  app.delete("/api/lms/modules/:id", requireAuth, requireRole("manager"), validateUUIDParam(), async (req: Request, res: Response) => {
    const orgId = req.orgId;
    if (!orgId) return res.status(403).json({ message: "Organization context required" });

    await storage.deleteLearningModule(orgId, req.params.id);
    res.json({ message: "Module deleted" });
  });

  /**
   * POST /api/lms/modules/generate — AI-generate a learning module from a reference document.
   * Takes a reference document ID and generates structured learning content.
   */
  app.post("/api/lms/modules/generate", requireAuth, requireRole("manager"), async (req: Request, res: Response) => {
    const orgId = req.orgId;
    if (!orgId) return res.status(403).json({ message: "Organization context required" });

    const { documentId, category, difficulty, generateQuiz } = req.body;
    if (!documentId) return res.status(400).json({ message: "documentId is required" });

    try {
      // Load the reference document
      const doc = await storage.getReferenceDocument(orgId, documentId);
      if (!doc) return res.status(404).json({ message: "Reference document not found" });
      if (!doc.extractedText || doc.extractedText.length < 50) {
        return res.status(400).json({ message: "Document has insufficient text content for module generation" });
      }

      if (!aiProvider.isAvailable || !aiProvider.generateText) {
        return res.status(503).json({ message: "AI provider not available for module generation" });
      }

      const docText = doc.extractedText.slice(0, 30000); // Cap text length
      const quizInstruction = generateQuiz
        ? `\n\nAlso generate a "quiz" section with 5-8 multiple-choice questions testing key concepts. Format each question as:
{"question":"...","options":["A","B","C","D"],"correctIndex":0,"explanation":"Why this is correct"}`
        : "";

      const prompt = `You are creating a training module from a company document. Convert the following document into structured learning content.

DOCUMENT: "${doc.name}" (${doc.category})
---
${docText}
---

Create a training module with:
1. A clear, engaging title (not just the document name)
2. A brief description (1-2 sentences)
3. Well-organized content in Markdown format with:
   - Clear headings and sections
   - Key takeaways highlighted
   - Practical examples where possible
   - A summary section at the end
4. An estimated reading/completion time in minutes${quizInstruction}

Respond with ONLY valid JSON (no markdown fences):
{"title":"...","description":"...","content":"...markdown content...","estimatedMinutes":0${generateQuiz ? ',"quizQuestions":[...]' : ''}}`;

      const response = await withRetry(
        () => aiProvider.generateText!(prompt),
        { retries: 2, baseDelay: 2000, label: "LMS module generation" }
      );

      // Parse AI response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "AI response was not parseable"));
      }
      const generated = JSON.parse(jsonMatch[0]);

      // Create the module
      const module = await storage.createLearningModule(orgId, {
        orgId,
        title: generated.title || `Training: ${doc.name}`,
        description: generated.description || `Auto-generated from ${doc.name}`,
        contentType: "ai_generated",
        category: category || "general",
        content: generated.content || "",
        quizQuestions: generated.quizQuestions || undefined,
        estimatedMinutes: generated.estimatedMinutes || 10,
        difficulty: difficulty || "intermediate",
        tags: [doc.category, "ai_generated"],
        sourceDocumentId: documentId,
        isPublished: false, // Draft by default
        createdBy: (req.user as any)?.name || "system",
      });

      res.status(201).json(module);
    } catch (error) {
      logger.error({ err: error }, "Failed to generate learning module");
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to generate learning module"));
    }
  });

  // --- Learning Paths ---

  /** GET /api/lms/paths — List all learning paths */
  app.get("/api/lms/paths", requireAuth, async (req: Request, res: Response) => {
    const orgId = req.orgId;
    if (!orgId) return res.status(403).json({ message: "Organization context required" });

    const paths = await storage.listLearningPaths(orgId);
    res.json(paths);
  });

  /** GET /api/lms/paths/:id — Get a learning path with modules */
  app.get("/api/lms/paths/:id", requireAuth, validateUUIDParam(), async (req: Request, res: Response) => {
    const orgId = req.orgId;
    if (!orgId) return res.status(403).json({ message: "Organization context required" });

    const path = await storage.getLearningPath(orgId, req.params.id);
    if (!path) return res.status(404).json({ message: "Path not found" });

    // Load modules for this path
    const modules = await Promise.all(
      path.moduleIds.map(mid => storage.getLearningModule(orgId, mid))
    );

    res.json({
      ...path,
      modules: modules.filter(Boolean),
    });
  });

  /** POST /api/lms/paths — Create a learning path */
  app.post("/api/lms/paths", requireAuth, requireRole("manager"), async (req: Request, res: Response) => {
    const orgId = req.orgId;
    if (!orgId) return res.status(403).json({ message: "Organization context required" });

    const { title, description, category, moduleIds, isRequired, assignedTo, estimatedMinutes } = req.body;
    if (!title || !moduleIds || !Array.isArray(moduleIds)) {
      return res.status(400).json({ message: "title and moduleIds are required" });
    }

    const path = await storage.createLearningPath(orgId, {
      orgId,
      title,
      description,
      category,
      moduleIds,
      isRequired: isRequired ?? false,
      assignedTo,
      estimatedMinutes,
      createdBy: (req.user as any)?.name || "unknown",
    });
    res.status(201).json(path);
  });

  /** PATCH /api/lms/paths/:id — Update a learning path */
  app.patch("/api/lms/paths/:id", requireAuth, requireRole("manager"), validateUUIDParam(), async (req: Request, res: Response) => {
    const orgId = req.orgId;
    if (!orgId) return res.status(403).json({ message: "Organization context required" });

    const updated = await storage.updateLearningPath(orgId, req.params.id, req.body);
    if (!updated) return res.status(404).json({ message: "Path not found" });
    res.json(updated);
  });

  /** DELETE /api/lms/paths/:id — Delete a learning path */
  app.delete("/api/lms/paths/:id", requireAuth, requireRole("manager"), validateUUIDParam(), async (req: Request, res: Response) => {
    const orgId = req.orgId;
    if (!orgId) return res.status(403).json({ message: "Organization context required" });

    await storage.deleteLearningPath(orgId, req.params.id);
    res.json({ message: "Path deleted" });
  });

  // --- Employee Progress ---

  /** GET /api/lms/progress/:employeeId — Get an employee's learning progress */
  app.get("/api/lms/progress/:employeeId", requireAuth, validateUUIDParam("employeeId"), async (req: Request, res: Response) => {
    const orgId = req.orgId;
    if (!orgId) return res.status(403).json({ message: "Organization context required" });

    const progress = await storage.getEmployeeLearningProgress(orgId, req.params.employeeId);
    res.json(progress);
  });

  /** POST /api/lms/progress — Update learning progress (start, complete, quiz score) */
  app.post("/api/lms/progress", requireAuth, async (req: Request, res: Response) => {
    const orgId = req.orgId;
    if (!orgId) return res.status(403).json({ message: "Organization context required" });

    const { employeeId, moduleId, pathId, status, quizScore, quizAttempts, timeSpentMinutes, notes } = req.body;
    if (!employeeId || !moduleId) return res.status(400).json({ message: "employeeId and moduleId are required" });

    // Enforce path deadline if module is part of a path
    if (pathId) {
      const path = await storage.getLearningPath(orgId, pathId);
      if (path) {
        const deadline = checkPathDeadline(path as { dueDate?: string | null });
        if (deadline?.overdue) {
          return res.status(403).json({
            message: "This learning path's deadline has passed. Contact your manager for an extension.",
            code: "OBS-LMS-DEADLINE-PASSED",
            dueDate: path.dueDate,
          });
        }

        // Enforce sequential order if path requires it
        if (path.enforceOrder && status === "in_progress") {
          const moduleIds = Array.isArray(path.moduleIds) ? path.moduleIds as string[] : [];
          const moduleIndex = moduleIds.indexOf(moduleId);
          if (moduleIndex > 0) {
            const prevModuleId = moduleIds[moduleIndex - 1];
            const prevProgress = await storage.getLearningProgress(orgId, employeeId, prevModuleId);
            if (!prevProgress || prevProgress.status !== "completed") {
              return res.status(403).json({
                message: "Complete the previous module first. This learning path requires sequential completion.",
                code: "OBS-LMS-ENFORCE-ORDER",
                blockedBy: prevModuleId,
              });
            }
          }
        }
      }
    }

    const progress = await storage.upsertLearningProgress(orgId, {
      orgId,
      employeeId,
      moduleId,
      pathId,
      status: status || "in_progress",
      quizScore,
      quizAttempts,
      timeSpentMinutes,
      completedAt: status === "completed" ? new Date().toISOString() : undefined,
      notes,
    });
    res.json(progress);
  });

  /**
   * POST /api/lms/modules/:id/submit-quiz — Submit quiz answers for grading.
   * Returns score, per-question results, and updates progress.
   */
  app.post("/api/lms/modules/:id/submit-quiz", requireAuth, validateUUIDParam(), async (req: Request, res: Response) => {
    const orgId = req.orgId;
    if (!orgId) return res.status(403).json({ message: "Organization context required" });

    const { employeeId, answers } = req.body;
    if (!employeeId || !Array.isArray(answers)) {
      return res.status(400).json(errorResponse(ERROR_CODES.VALIDATION_ERROR, "employeeId and answers array are required"));
    }

    try {
      const module = await storage.getLearningModule(orgId, req.params.id);
      if (!module) return res.status(404).json({ message: "Module not found" });
      if (!module.quizQuestions || module.quizQuestions.length === 0) {
        return res.status(400).json({ message: "This module does not have quiz questions" });
      }

      // Check prerequisites before allowing quiz submission
      const prereqs = Array.isArray(module.prerequisiteModuleIds) ? module.prerequisiteModuleIds as string[] : [];
      if (prereqs.length > 0) {
        for (const prereqId of prereqs) {
          const prereqProgress = await storage.getLearningProgress(orgId, employeeId, prereqId);
          if (!prereqProgress || prereqProgress.status !== "completed") {
            return res.status(403).json({
              message: "Complete all prerequisite modules before taking this quiz.",
              code: "OBS-LMS-PREREQ-INCOMPLETE",
              unmetPrerequisite: prereqId,
            });
          }
        }
      }

      const questions = module.quizQuestions as Array<{ question: string; options: string[]; correctIndex: number; explanation?: string }>;

      // Grade each answer
      const results = questions.map((q, i) => {
        const userAnswer = answers[i] ?? -1;
        const correct = userAnswer === q.correctIndex;
        return {
          questionIndex: i,
          question: q.question,
          userAnswer,
          correctIndex: q.correctIndex,
          correct,
          explanation: q.explanation,
        };
      });

      const correctCount = results.filter(r => r.correct).length;
      const score = Math.round((correctCount / questions.length) * 100);
      const passingScore = (module.passingScore as number) || 70;

      // Get existing progress to track attempts
      const existing = await storage.getLearningProgress(orgId, employeeId, module.id);
      const attempts = (existing?.quizAttempts || 0) + 1;

      // Update progress with quiz results
      const progress = await storage.upsertLearningProgress(orgId, {
        orgId,
        employeeId,
        moduleId: module.id,
        status: score >= passingScore ? "completed" : "in_progress",
        quizScore: score,
        quizAttempts: attempts,
        completedAt: score >= passingScore ? new Date().toISOString() : undefined,
      });

      res.json({
        score,
        passed: score >= passingScore,
        passingScore,
        correctCount,
        totalQuestions: questions.length,
        results,
        attempts,
        progress,
      });
    } catch (error) {
      logger.error({ err: error }, "Failed to grade quiz");
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to grade quiz"));
    }
  });

  /**
   * GET /api/lms/paths/:id/progress/:employeeId — Get an employee's progress through a learning path.
   * Returns the path with per-module completion status.
   */
  app.get("/api/lms/paths/:id/progress/:employeeId", requireAuth, async (req: Request, res: Response) => {
    const orgId = req.orgId;
    if (!orgId) return res.status(403).json({ message: "Organization context required" });

    try {
      const path = await storage.getLearningPath(orgId, req.params.id);
      if (!path) return res.status(404).json({ message: "Path not found" });

      const allProgress = await storage.getEmployeeLearningProgress(orgId, req.params.employeeId);
      const progressMap = new Map(allProgress.map(p => [p.moduleId, p]));

      // Load modules with progress
      const modules = await Promise.all(
        path.moduleIds.map(async (mid) => {
          const mod = await storage.getLearningModule(orgId, mid);
          if (!mod) return null;
          return { ...mod, progress: progressMap.get(mid) || null };
        })
      );

      const validModules = modules.filter(Boolean);
      const completedCount = validModules.filter((m: any) => m.progress?.status === "completed").length;

      res.json({
        ...path,
        modules: validModules,
        completedCount,
        totalModules: validModules.length,
        percentComplete: validModules.length > 0 ? Math.round((completedCount / validModules.length) * 100) : 0,
      });
    } catch (error) {
      logger.error({ err: error }, "Failed to get path progress");
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to get path progress"));
    }
  });

  /** GET /api/lms/stats — LMS analytics overview */
  app.get("/api/lms/stats", requireAuth, async (req: Request, res: Response) => {
    const orgId = req.orgId;
    if (!orgId) return res.status(403).json({ message: "Organization context required" });

    try {
      const [modules, paths, employees] = await Promise.all([
        storage.listLearningModules(orgId),
        storage.listLearningPaths(orgId),
        storage.getAllEmployees(orgId),
      ]);

      const publishedModules = modules.filter(m => m.isPublished);
      const aiGenerated = modules.filter(m => m.contentType === "ai_generated");

      // Batch-load progress for employees (parallel, capped at 50)
      const progressArrays = await Promise.all(
        employees.slice(0, 50).map(emp => storage.getEmployeeLearningProgress(orgId, emp.id))
      );
      const allProgress = progressArrays.flat();
      const totalCompletions = allProgress.filter(p => p.status === "completed").length;
      const totalInProgress = allProgress.filter(p => p.status === "in_progress").length;
      const avgQuizScore = allProgress.filter(p => p.quizScore != null).length > 0
        ? Math.round(allProgress.filter(p => p.quizScore != null).reduce((sum, p) => sum + (p.quizScore || 0), 0) / allProgress.filter(p => p.quizScore != null).length)
        : null;

      res.json({
        totalModules: modules.length,
        publishedModules: publishedModules.length,
        aiGeneratedModules: aiGenerated.length,
        totalPaths: paths.length,
        totalCompletions,
        totalInProgress,
        avgQuizScore,
        totalEmployeesLearning: new Set(allProgress.map(p => p.employeeId)).size,
        modulesByCategory: modules.reduce((acc, m) => {
          const cat = m.category || "general";
          acc[cat] = (acc[cat] || 0) + 1;
          return acc;
        }, {} as Record<string, number>),
        modulesByType: modules.reduce((acc, m) => {
          acc[m.contentType] = (acc[m.contentType] || 0) + 1;
          return acc;
        }, {} as Record<string, number>),
      });
    } catch (error) {
      logger.error({ err: error }, "Failed to get LMS stats");
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to get LMS statistics"));
    }
  });

  /**
   * GET /api/lms/modules/:id/prerequisites — Check if employee has met prerequisites.
   */
  app.get("/api/lms/modules/:id/prerequisites", requireAuth, validateUUIDParam(), async (req: Request, res: Response) => {
    const orgId = req.orgId;
    if (!orgId) return res.status(403).json({ message: "Organization context required" });

    const { employeeId } = req.query;
    if (!employeeId || typeof employeeId !== "string") {
      return res.status(400).json({ message: "employeeId query param is required" });
    }

    try {
      const module = await storage.getLearningModule(orgId, req.params.id);
      if (!module) return res.status(404).json({ message: "Module not found" });

      const prereqs = (module.prerequisiteModuleIds || []) as string[];
      if (prereqs.length === 0) {
        return res.json({ met: true, prerequisites: [], unmetPrerequisites: [] });
      }

      const employeeProgress = await storage.getEmployeeLearningProgress(orgId, employeeId);
      const completedModuleIds = new Set(
        employeeProgress.filter(p => p.status === "completed").map(p => p.moduleId)
      );

      const unmet: Array<{ moduleId: string; title: string }> = [];
      const metList: Array<{ moduleId: string; title: string }> = [];

      for (const prereqId of prereqs) {
        const prereqModule = await storage.getLearningModule(orgId, prereqId);
        const title = prereqModule?.title || "Unknown Module";
        if (completedModuleIds.has(prereqId)) {
          metList.push({ moduleId: prereqId, title });
        } else {
          unmet.push({ moduleId: prereqId, title });
        }
      }

      res.json({
        met: unmet.length === 0,
        prerequisites: metList,
        unmetPrerequisites: unmet,
      });
    } catch (error) {
      logger.error({ err: error }, "Failed to check prerequisites");
      res.status(500).json({ message: "Failed to check prerequisites" });
    }
  });

  /**
   * GET /api/lms/paths/:id/deadlines — Check deadline status for all assigned employees.
   */
  app.get("/api/lms/paths/:id/deadlines", requireAuth, requireRole("manager"), validateUUIDParam(), async (req: Request, res: Response) => {
    const orgId = req.orgId;
    if (!orgId) return res.status(403).json({ message: "Organization context required" });

    try {
      const path = await storage.getLearningPath(orgId, req.params.id);
      if (!path) return res.status(404).json({ message: "Path not found" });
      if (!path.dueDate) return res.json({ hasDueDate: false, employees: [] });

      const dueDate = new Date(path.dueDate);
      const now = new Date();
      const isOverdue = now > dueDate;
      const daysRemaining = Math.max(0, Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));

      // Get assigned employees
      const employees = await storage.getAllEmployees(orgId);
      const assignedEmployees = path.assignedTo && path.assignedTo.length > 0
        ? employees.filter(e => path.assignedTo!.includes(e.id))
        : employees;

      const employeeStatuses = await Promise.all(assignedEmployees.map(async (emp) => {
        const progress = await storage.getEmployeeLearningProgress(orgId, emp.id);
        const pathProgress = progress.filter(p => path.moduleIds.includes(p.moduleId));
        const completedCount = pathProgress.filter(p => p.status === "completed").length;
        const percentComplete = path.moduleIds.length > 0
          ? Math.round((completedCount / path.moduleIds.length) * 100)
          : 0;

        return {
          employeeId: emp.id,
          employeeName: emp.name,
          completedModules: completedCount,
          totalModules: path.moduleIds.length,
          percentComplete,
          status: percentComplete === 100 ? "completed" as const
            : isOverdue ? "overdue" as const
            : daysRemaining <= 3 ? "at_risk" as const
            : "on_track" as const,
        };
      }));

      res.json({
        hasDueDate: true,
        dueDate: path.dueDate,
        isOverdue,
        daysRemaining,
        employees: employeeStatuses,
        completedCount: employeeStatuses.filter(e => e.status === "completed").length,
        overdueCount: employeeStatuses.filter(e => e.status === "overdue").length,
        atRiskCount: employeeStatuses.filter(e => e.status === "at_risk").length,
      });
    } catch (error) {
      logger.error({ err: error }, "Failed to get deadline status");
      res.status(500).json({ message: "Failed to get deadline status" });
    }
  });

  /**
   * GET /api/lms/modules/:id/certificate — Generate completion certificate data.
   * Returns structured data for certificate rendering (client generates PDF).
   */
  app.get("/api/lms/modules/:id/certificate", requireAuth, validateUUIDParam(), async (req: Request, res: Response) => {
    const orgId = req.orgId;
    if (!orgId) return res.status(403).json({ message: "Organization context required" });

    const { employeeId } = req.query;
    if (!employeeId || typeof employeeId !== "string") {
      return res.status(400).json({ message: "employeeId query param is required" });
    }

    try {
      const [module, employee, progress, org] = await Promise.all([
        storage.getLearningModule(orgId, req.params.id),
        storage.getEmployee(orgId, employeeId),
        storage.getLearningProgress(orgId, employeeId, req.params.id),
        storage.getOrganization(orgId),
      ]);

      if (!module) return res.status(404).json({ message: "Module not found" });
      if (!employee) return res.status(404).json({ message: "Employee not found" });
      if (!progress || progress.status !== "completed") {
        return res.status(400).json({ message: "Module must be completed to generate certificate" });
      }

      res.json({
        certificate: {
          employeeName: employee.name,
          moduleName: module.title,
          moduleCategory: module.category,
          completedAt: progress.completedAt,
          quizScore: progress.quizScore,
          organizationName: org?.name || "Organization",
          difficulty: module.difficulty,
          estimatedMinutes: module.estimatedMinutes,
          certificateId: `CERT-${progress.id.slice(0, 8).toUpperCase()}`,
          issuedAt: new Date().toISOString(),
        },
      });
    } catch (error) {
      logger.error({ err: error }, "Failed to generate certificate");
      res.status(500).json({ message: "Failed to generate certificate" });
    }
  });

  /**
   * GET /api/lms/coaching-recommendations — Recommend modules based on coaching session topics.
   */
  app.get("/api/lms/coaching-recommendations", requireAuth, async (req: Request, res: Response) => {
    const orgId = req.orgId;
    if (!orgId) return res.status(403).json({ message: "Organization context required" });

    const { employeeId, coachingSessionId } = req.query;
    if (!employeeId || typeof employeeId !== "string") {
      return res.status(400).json({ message: "employeeId query param is required" });
    }

    try {
      // Get published modules
      const modules = await storage.listLearningModules(orgId, { isPublished: true });
      const employeeProgress = await storage.getEmployeeLearningProgress(orgId, employeeId);
      const completedModuleIds = new Set(employeeProgress.filter(p => p.status === "completed").map(p => p.moduleId));

      // Get coaching context if session ID provided
      let coachingCategory: string | undefined;
      let coachingNotes: string | undefined;
      if (coachingSessionId && typeof coachingSessionId === "string") {
        try {
          const session = await storage.getCoachingSession(orgId, coachingSessionId);
          coachingCategory = session?.category || undefined;
          coachingNotes = session?.notes || undefined;
        } catch { /* non-critical */ }
      }

      // Get the employee's recent call analyses for weak areas
      const calls = await storage.getCallSummaries(orgId, { status: "completed" });
      const empCalls = calls.filter(c => c.employeeId === employeeId).slice(-10);
      const subScores: Record<string, number[]> = { compliance: [], customerExperience: [], communication: [], resolution: [] };

      for (const call of empCalls) {
        const analysis = call.analysis;
        if (!analysis?.subScores) continue;
        for (const [key, arr] of Object.entries(subScores)) {
          const val = (analysis.subScores as any)?.[key];
          if (typeof val === "number") arr.push(val);
        }
      }

      // Find weak areas (avg sub-score < 7.0, requiring 3+ data points for reliability)
      const weakAreas: string[] = [];
      for (const [key, scores] of Object.entries(subScores)) {
        if (scores.length >= 3) {
          const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
          if (avg < 7.0) weakAreas.push(key);
        }
      }

      // Score and rank modules by relevance
      const scored = modules
        .filter(m => !completedModuleIds.has(m.id))
        .map(m => {
          let relevance = 0;
          const reasons: string[] = [];
          const mText = `${m.title} ${m.description || ""} ${m.category || ""} ${(m.tags || []).join(" ")}`.toLowerCase();

          // Match coaching category
          if (coachingCategory && mText.includes(coachingCategory.toLowerCase())) {
            relevance += 5;
            reasons.push(`Matches coaching category: ${coachingCategory}`);
          }

          // Match coaching notes keywords
          if (coachingNotes) {
            const keywords = coachingNotes.toLowerCase().split(/\s+/).filter(w => w.length > 4);
            const matches = keywords.filter(kw => mText.includes(kw)).length;
            if (matches > 0) {
              relevance += Math.min(matches, 3);
              reasons.push(`Matches coaching notes keywords (${matches})`);
            }
          }

          // Match weak areas — convert camelCase to space-separated for broader matching
          // e.g., "customerExperience" → "customer experience"
          for (const area of weakAreas) {
            const areaSpaced = area.replace(/([A-Z])/g, " $1").toLowerCase().trim();
            if (mText.includes(areaSpaced) || mText.includes(area.toLowerCase())) {
              relevance += 4;
              reasons.push(`Addresses weak area: ${area}`);
            }
          }

          // Compliance modules always relevant for low compliance scores
          if (weakAreas.includes("compliance") && (m.category === "compliance" || mText.includes("compliance"))) {
            relevance += 3;
          }

          // Category relevance
          if (m.category === "call_handling" && weakAreas.includes("communication")) {
            relevance += 2;
            reasons.push("Call handling for communication improvement");
          }
          if (m.category === "customer_service" && weakAreas.includes("customerExperience")) {
            relevance += 2;
            reasons.push("Customer service for experience improvement");
          }

          return { module: m, relevance, reasons };
        })
        .filter(s => s.relevance > 0)
        .sort((a, b) => b.relevance - a.relevance)
        .slice(0, 5);

      res.json({
        recommendations: scored.map(s => ({
          moduleId: s.module.id,
          title: s.module.title,
          description: s.module.description,
          category: s.module.category,
          contentType: s.module.contentType,
          difficulty: s.module.difficulty,
          estimatedMinutes: s.module.estimatedMinutes,
          relevanceScore: s.relevance,
          reasons: s.reasons,
        })),
        weakAreas,
        coachingCategory,
      });
    } catch (error) {
      logger.error({ err: error }, "Failed to get coaching recommendations");
      res.status(500).json({ message: "Failed to get coaching recommendations" });
    }
  });

  /** GET /api/lms/knowledge-search — Search the knowledge base (RAG) for employees */
  app.get("/api/lms/knowledge-search", requireAuth, async (req: Request, res: Response) => {
    const orgId = req.orgId;
    if (!orgId) return res.status(403).json({ message: "Organization context required" });

    const query = req.query.q as string;
    if (!query || query.trim().length < 3) {
      return res.status(400).json({ message: "Search query must be at least 3 characters" });
    }

    try {
      // Search published modules
      const modules = await storage.listLearningModules(orgId, { isPublished: true });
      const matches = modules.filter(m => {
        const searchText = `${m.title} ${m.description || ""} ${m.content || ""} ${(m.tags || []).join(" ")}`.toLowerCase();
        return query.toLowerCase().split(" ").every(term => searchText.includes(term));
      }).slice(0, 10);

      // Also search reference documents (RAG)
      let ragResults: Array<{ text: string; documentName: string; relevance: number }> = [];
      if (process.env.DATABASE_URL) {
        try {
          const { searchRelevantChunks, formatRetrievedContext } = await import("../services/rag");
          const { getDatabase } = await import("../db/index");
          const db = getDatabase();
          if (db) {
            const refDocs = await storage.listReferenceDocuments(orgId);
            const docIds = refDocs.filter(d => d.isActive).map(d => d.id);
            if (docIds.length > 0) {
              const chunks = await searchRelevantChunks(db as any, orgId, query, docIds, { topK: 5 });
              ragResults = chunks.map(c => ({
                text: c.text.slice(0, 500),
                documentName: refDocs.find(d => d.id === c.documentId)?.name || "Unknown",
                relevance: c.score,
              }));
            }
          }
        } catch (ragErr) {
          logger.warn({ err: ragErr }, "RAG search failed in LMS knowledge search");
        }
      }

      res.json({
        modules: matches,
        knowledgeBase: ragResults,
        totalResults: matches.length + ragResults.length,
      });
    } catch (error) {
      logger.error({ err: error }, "Failed to search LMS knowledge base");
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Knowledge search failed"));
    }
  });
}
