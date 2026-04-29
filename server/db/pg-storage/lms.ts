/**
 * PostgresStorage LMS domain: learning modules, paths, progress.
 * Extracted from pg-storage-features.ts. Side-effect import that attaches
 * methods to PostgresStorage.prototype via the shared `P` reference.
 */
import { eq, and } from "drizzle-orm";
import { randomUUID } from "crypto";
import * as tables from "../schema";
import { toISOString, QUERY_HARD_CAP } from "../pg-storage";
import { P, db } from "./_shared";
import type {
  LearningModule,
  InsertLearningModule,
  LearningPath,
  InsertLearningPath,
  LearningProgress,
  InsertLearningProgress,
} from "@shared/schema";

// Row types inferred from Drizzle schema
type LearningModuleRow = typeof tables.learningModules.$inferSelect;
type LearningPathRow = typeof tables.learningPaths.$inferSelect;
type LearningProgressRow = typeof tables.learningProgress.$inferSelect;

// --- LMS: Learning Modules ---
P.createLearningModule = async function (orgId: string, module: InsertLearningModule): Promise<LearningModule> {
  const id = randomUUID();
  const [row] = await db(this)
    .insert(tables.learningModules)
    .values({
      id,
      orgId,
      title: module.title,
      description: module.description || null,
      contentType: module.contentType,
      category: module.category || null,
      content: module.content || null,
      quizQuestions: module.quizQuestions || null,
      estimatedMinutes: module.estimatedMinutes || null,
      difficulty: module.difficulty || null,
      tags: module.tags || null,
      sourceDocumentId: module.sourceDocumentId || null,
      isPublished: module.isPublished ?? false,
      isPlatformContent: module.isPlatformContent ?? false,
      createdBy: module.createdBy,
      sortOrder: module.sortOrder || null,
      prerequisiteModuleIds: module.prerequisiteModuleIds || null,
      passingScore: module.passingScore || null,
    })
    .returning();
  return mapLearningModule(row);
};

P.getLearningModule = async function (orgId: string, id: string): Promise<LearningModule | undefined> {
  const rows = await db(this)
    .select()
    .from(tables.learningModules)
    .where(and(eq(tables.learningModules.orgId, orgId), eq(tables.learningModules.id, id)));
  return rows[0] ? mapLearningModule(rows[0]) : undefined;
};

P.listLearningModules = async function (
  orgId: string,
  filters?: { category?: string; contentType?: string; isPublished?: boolean },
): Promise<LearningModule[]> {
  const conditions = [eq(tables.learningModules.orgId, orgId)];
  if (filters?.category) conditions.push(eq(tables.learningModules.category, filters.category));
  if (filters?.contentType) conditions.push(eq(tables.learningModules.contentType, filters.contentType));
  if (filters?.isPublished !== undefined) conditions.push(eq(tables.learningModules.isPublished, filters.isPublished));
  const rows = await db(this)
    .select()
    .from(tables.learningModules)
    .where(and(...conditions))
    .limit(QUERY_HARD_CAP);
  return rows.map((r) => mapLearningModule(r));
};

P.updateLearningModule = async function (
  orgId: string,
  id: string,
  updates: Partial<LearningModule>,
): Promise<LearningModule | undefined> {
  const setClause: Record<string, unknown> = { updatedAt: new Date() };
  if (updates.title !== undefined) setClause.title = updates.title;
  if (updates.description !== undefined) setClause.description = updates.description;
  if (updates.content !== undefined) setClause.content = updates.content;
  if (updates.category !== undefined) setClause.category = updates.category;
  if (updates.quizQuestions !== undefined) setClause.quizQuestions = updates.quizQuestions;
  if (updates.estimatedMinutes !== undefined) setClause.estimatedMinutes = updates.estimatedMinutes;
  if (updates.difficulty !== undefined) setClause.difficulty = updates.difficulty;
  if (updates.tags !== undefined) setClause.tags = updates.tags;
  if (updates.isPublished !== undefined) setClause.isPublished = updates.isPublished;
  if (updates.sortOrder !== undefined) setClause.sortOrder = updates.sortOrder;
  if (updates.prerequisiteModuleIds !== undefined) setClause.prerequisiteModuleIds = updates.prerequisiteModuleIds;
  if (updates.passingScore !== undefined) setClause.passingScore = updates.passingScore;
  const rows = await db(this)
    .update(tables.learningModules)
    .set(setClause)
    .where(and(eq(tables.learningModules.orgId, orgId), eq(tables.learningModules.id, id)))
    .returning();
  return rows[0] ? mapLearningModule(rows[0]) : undefined;
};

P.deleteLearningModule = async function (orgId: string, id: string): Promise<void> {
  await db(this)
    .delete(tables.learningModules)
    .where(and(eq(tables.learningModules.orgId, orgId), eq(tables.learningModules.id, id)));
};

// --- LMS: Learning Paths ---
P.createLearningPath = async function (orgId: string, path: InsertLearningPath): Promise<LearningPath> {
  const id = randomUUID();
  const [row] = await db(this)
    .insert(tables.learningPaths)
    .values({
      id,
      orgId,
      title: path.title,
      description: path.description || null,
      category: path.category || null,
      moduleIds: path.moduleIds,
      isRequired: path.isRequired ?? false,
      assignedTo: path.assignedTo || null,
      estimatedMinutes: path.estimatedMinutes || null,
      createdBy: path.createdBy,
      dueDate: path.dueDate ? new Date(path.dueDate) : null,
      enforceOrder: path.enforceOrder ?? false,
    })
    .returning();
  return mapLearningPath(row);
};

P.getLearningPath = async function (orgId: string, id: string): Promise<LearningPath | undefined> {
  const rows = await db(this)
    .select()
    .from(tables.learningPaths)
    .where(and(eq(tables.learningPaths.orgId, orgId), eq(tables.learningPaths.id, id)));
  return rows[0] ? mapLearningPath(rows[0]) : undefined;
};

P.listLearningPaths = async function (orgId: string): Promise<LearningPath[]> {
  const rows = await db(this).select().from(tables.learningPaths).where(eq(tables.learningPaths.orgId, orgId));
  return rows.map((r) => mapLearningPath(r));
};

P.updateLearningPath = async function (
  orgId: string,
  id: string,
  updates: Partial<LearningPath>,
): Promise<LearningPath | undefined> {
  const setClause: Record<string, unknown> = { updatedAt: new Date() };
  if (updates.title !== undefined) setClause.title = updates.title;
  if (updates.description !== undefined) setClause.description = updates.description;
  if (updates.moduleIds !== undefined) setClause.moduleIds = updates.moduleIds;
  if (updates.isRequired !== undefined) setClause.isRequired = updates.isRequired;
  if (updates.assignedTo !== undefined) setClause.assignedTo = updates.assignedTo;
  if (updates.estimatedMinutes !== undefined) setClause.estimatedMinutes = updates.estimatedMinutes;
  const rows = await db(this)
    .update(tables.learningPaths)
    .set(setClause)
    .where(and(eq(tables.learningPaths.orgId, orgId), eq(tables.learningPaths.id, id)))
    .returning();
  return rows[0] ? mapLearningPath(rows[0]) : undefined;
};

P.deleteLearningPath = async function (orgId: string, id: string): Promise<void> {
  await db(this)
    .delete(tables.learningPaths)
    .where(and(eq(tables.learningPaths.orgId, orgId), eq(tables.learningPaths.id, id)));
};

// --- LMS: Learning Progress ---
P.upsertLearningProgress = async function (orgId: string, progress: InsertLearningProgress): Promise<LearningProgress> {
  // Use INSERT ... ON CONFLICT DO UPDATE to prevent race condition where
  // two concurrent requests both see "no record" and try to insert.
  const id = randomUUID();
  const [row] = await db(this)
    .insert(tables.learningProgress)
    .values({
      id,
      orgId,
      employeeId: progress.employeeId,
      moduleId: progress.moduleId,
      pathId: progress.pathId || null,
      status: progress.status || "not_started",
      quizScore: progress.quizScore ?? null,
      quizAttempts: progress.quizAttempts ?? null,
      timeSpentMinutes: progress.timeSpentMinutes ?? null,
      completedAt: progress.completedAt ? new Date(progress.completedAt) : null,
      notes: progress.notes || null,
    })
    .onConflictDoUpdate({
      target: [tables.learningProgress.orgId, tables.learningProgress.employeeId, tables.learningProgress.moduleId],
      set: {
        ...(progress.status ? { status: progress.status } : {}),
        ...(progress.quizScore !== undefined ? { quizScore: progress.quizScore } : {}),
        ...(progress.quizAttempts !== undefined ? { quizAttempts: progress.quizAttempts } : {}),
        ...(progress.timeSpentMinutes !== undefined ? { timeSpentMinutes: progress.timeSpentMinutes } : {}),
        ...(progress.completedAt ? { completedAt: new Date(progress.completedAt) } : {}),
        ...(progress.notes !== undefined ? { notes: progress.notes } : {}),
        updatedAt: new Date(),
      },
    })
    .returning();
  return mapLearningProgress(row);
};

P.getLearningProgress = async function (
  orgId: string,
  employeeId: string,
  moduleId: string,
): Promise<LearningProgress | undefined> {
  const rows = await db(this)
    .select()
    .from(tables.learningProgress)
    .where(
      and(
        eq(tables.learningProgress.orgId, orgId),
        eq(tables.learningProgress.employeeId, employeeId),
        eq(tables.learningProgress.moduleId, moduleId),
      ),
    );
  return rows[0] ? mapLearningProgress(rows[0]) : undefined;
};

P.getEmployeeLearningProgress = async function (orgId: string, employeeId: string): Promise<LearningProgress[]> {
  const rows = await db(this)
    .select()
    .from(tables.learningProgress)
    .where(and(eq(tables.learningProgress.orgId, orgId), eq(tables.learningProgress.employeeId, employeeId)));
  return rows.map((r) => mapLearningProgress(r));
};

P.getModuleCompletionStats = async function (
  orgId: string,
  moduleId: string,
): Promise<{ total: number; completed: number; inProgress: number; avgScore: number }> {
  const rows = await db(this)
    .select()
    .from(tables.learningProgress)
    .where(and(eq(tables.learningProgress.orgId, orgId), eq(tables.learningProgress.moduleId, moduleId)));
  const completed = rows.filter((r) => r.status === "completed");
  const scores = completed.filter((r) => r.quizScore != null).map((r) => r.quizScore!);
  return {
    total: rows.length,
    completed: completed.length,
    inProgress: rows.filter((r) => r.status === "in_progress").length,
    avgScore: scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0,
  };
};

function mapLearningModule(r: LearningModuleRow): LearningModule {
  return {
    id: r.id,
    orgId: r.orgId,
    title: r.title,
    description: r.description || undefined,
    contentType: r.contentType,
    category: r.category || undefined,
    content: r.content || undefined,
    quizQuestions: r.quizQuestions as LearningModule["quizQuestions"],
    estimatedMinutes: r.estimatedMinutes || undefined,
    difficulty: (r.difficulty || undefined) as LearningModule["difficulty"],
    tags: (r.tags as string[]) || undefined,
    sourceDocumentId: r.sourceDocumentId || undefined,
    isPublished: r.isPublished,
    isPlatformContent: r.isPlatformContent,
    createdBy: r.createdBy,
    sortOrder: r.sortOrder || undefined,
    prerequisiteModuleIds: (r.prerequisiteModuleIds as string[]) || undefined,
    passingScore: r.passingScore || undefined,
    createdAt: toISOString(r.createdAt),
    updatedAt: toISOString(r.updatedAt),
  };
}

function mapLearningPath(r: LearningPathRow): LearningPath {
  return {
    id: r.id,
    orgId: r.orgId,
    title: r.title,
    description: r.description || undefined,
    category: r.category || undefined,
    moduleIds: r.moduleIds as string[],
    isRequired: r.isRequired,
    assignedTo: (r.assignedTo as string[]) || undefined,
    estimatedMinutes: r.estimatedMinutes || undefined,
    createdBy: r.createdBy,
    dueDate: toISOString(r.dueDate),
    enforceOrder: r.enforceOrder ?? false,
    createdAt: toISOString(r.createdAt),
    updatedAt: toISOString(r.updatedAt),
  };
}

function mapLearningProgress(r: LearningProgressRow): LearningProgress {
  return {
    id: r.id,
    orgId: r.orgId,
    employeeId: r.employeeId,
    moduleId: r.moduleId,
    pathId: r.pathId || undefined,
    status: r.status as LearningProgress["status"],
    quizScore: r.quizScore || undefined,
    quizAttempts: r.quizAttempts || undefined,
    timeSpentMinutes: r.timeSpentMinutes || undefined,
    completedAt: toISOString(r.completedAt),
    notes: r.notes || undefined,
    startedAt: toISOString(r.startedAt),
    updatedAt: toISOString(r.updatedAt),
  };
}
