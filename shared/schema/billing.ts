import { z } from "zod";
import { clinicalNoteSchema } from "./calls";
import type { Call, Transcript, SentimentAnalysis, CallAnalysis } from "./calls";
import type { Employee } from "./org";

// --- ACCESS REQUEST SCHEMAS ---
export const insertAccessRequestSchema = z.object({
  orgId: z.string(),
  name: z.string().min(1),
  email: z.string().email(),
  reason: z.string().optional(),
  requestedRole: z.enum(["viewer", "manager"]).default("viewer"),
});

export const accessRequestSchema = insertAccessRequestSchema.extend({
  id: z.string(),
  orgId: z.string(),
  status: z.enum(["pending", "approved", "denied"]).default("pending"),
  reviewedBy: z.string().optional(),
  reviewedAt: z.string().optional(),
  createdAt: z.string().optional(),
});

export type InsertAccessRequest = z.infer<typeof insertAccessRequestSchema>;
export type AccessRequest = z.infer<typeof accessRequestSchema>;

// --- INVITATION SCHEMAS ---
export const insertInvitationSchema = z.object({
  orgId: z.string(),
  email: z.string().email(),
  role: z.enum(["viewer", "manager", "admin"]).default("viewer"),
  invitedBy: z.string(),
  token: z.string().optional(), // Auto-generated if not provided
  expiresAt: z.string().optional(),
});

export const invitationSchema = insertInvitationSchema.extend({
  id: z.string(),
  orgId: z.string(),
  token: z.string(),
  status: z.enum(["pending", "accepted", "expired", "revoked"]).default("pending"),
  createdAt: z.string().optional(),
  acceptedAt: z.string().optional(),
});

export type InsertInvitation = z.infer<typeof insertInvitationSchema>;
export type Invitation = z.infer<typeof invitationSchema>;

// --- API KEY SCHEMAS ---
export const insertApiKeySchema = z.object({
  orgId: z.string(),
  name: z.string().min(1),
  keyHash: z.string(), // SHA-256 hash of the key (never store plaintext)
  keyPrefix: z.string(), // First 8 chars for display (e.g., "obs_k_ab")
  permissions: z.array(z.string()).default(["read"]), // "read", "write", "admin"
  createdBy: z.string(),
  expiresAt: z.string().optional(),
});

export const apiKeySchema = insertApiKeySchema.extend({
  id: z.string(),
  orgId: z.string(),
  lastUsedAt: z.string().optional(),
  status: z.enum(["active", "revoked"]).default("active"),
  createdAt: z.string().optional(),
});

export type InsertApiKey = z.infer<typeof insertApiKeySchema>;
export type ApiKey = z.infer<typeof apiKeySchema>;

// --- BILLING & SUBSCRIPTION SCHEMAS ---
export const PLAN_TIERS = ["free", "starter", "professional", "enterprise"] as const;
export type PlanTier = (typeof PLAN_TIERS)[number];

export const planLimitsSchema = z.object({
  callsPerMonth: z.number(), // -1 = unlimited
  storageMb: z.number(),
  aiAnalysesPerMonth: z.number(),
  apiCallsPerMonth: z.number(),
  maxUsers: z.number(),
  customPromptTemplates: z.boolean(),
  ragEnabled: z.boolean(),
  ssoEnabled: z.boolean(),
  prioritySupport: z.boolean(),
  clinicalDocumentationEnabled: z.boolean().default(false),
  abTestingEnabled: z.boolean().default(false),
  simulatedCallsEnabled: z.boolean().default(false),
  baseSeats: z.number(), // seats included in base price
  pricePerAdditionalSeatUsd: z.number(), // $/seat/mo for additional seats; 0 = not applicable
  overagePricePerCallUsd: z.number(), // $/call over quota; 0 = hard block at limit
  /** Monthly add-on price for clinical documentation (0 = included or not available) */
  clinicalDocumentationAddOnUsd: z.number().default(0),
});
export type PlanLimits = z.infer<typeof planLimitsSchema>;

/** Static plan definitions — no DB needed for these */
export const PLAN_DEFINITIONS: Record<
  PlanTier,
  {
    name: string;
    description: string;
    monthlyPriceUsd: number;
    yearlyPriceUsd: number;
    trialDays?: number;
    limits: PlanLimits;
    contactSales?: boolean;
  }
> = {
  free: {
    name: "Free",
    description: "Get started with 50 calls/month — no credit card required",
    monthlyPriceUsd: 0,
    yearlyPriceUsd: 0,
    limits: {
      callsPerMonth: 50,
      storageMb: 500,
      aiAnalysesPerMonth: 50,
      apiCallsPerMonth: 1000,
      maxUsers: 2,
      customPromptTemplates: false,
      ragEnabled: false,
      ssoEnabled: false,
      prioritySupport: false,
      clinicalDocumentationEnabled: false,
      abTestingEnabled: false,
      simulatedCallsEnabled: false,
      baseSeats: 2,
      pricePerAdditionalSeatUsd: 0,
      overagePricePerCallUsd: 0, // Hard block at limit (no overage on free)
      clinicalDocumentationAddOnUsd: 0, // Not available
    },
  },
  starter: {
    name: "Starter",
    description: "For growing teams that need smarter call insights",
    monthlyPriceUsd: 79,
    yearlyPriceUsd: 756, // $63/mo billed yearly
    trialDays: 14,
    limits: {
      callsPerMonth: 300,
      storageMb: 5000,
      aiAnalysesPerMonth: 300,
      apiCallsPerMonth: 10000,
      maxUsers: 25,
      customPromptTemplates: true,
      ragEnabled: true,
      ssoEnabled: false,
      prioritySupport: false,
      clinicalDocumentationEnabled: false, // Available as $49/mo add-on
      abTestingEnabled: false,
      simulatedCallsEnabled: false,
      baseSeats: 5,
      pricePerAdditionalSeatUsd: 15,
      overagePricePerCallUsd: 0.35,
      clinicalDocumentationAddOnUsd: 49, // $49/mo add-on (Starter + Clinical = $128/mo)
    },
  },
  professional: {
    name: "Professional",
    description: "Full QA + clinical documentation platform for healthcare teams",
    monthlyPriceUsd: 199,
    yearlyPriceUsd: 1908, // $159/mo billed yearly
    trialDays: 14,
    limits: {
      callsPerMonth: 1000,
      storageMb: 20000,
      aiAnalysesPerMonth: 1000,
      apiCallsPerMonth: 50000,
      maxUsers: -1,
      customPromptTemplates: true,
      ragEnabled: true,
      ssoEnabled: false,
      prioritySupport: true,
      clinicalDocumentationEnabled: true, // Included
      abTestingEnabled: true,
      simulatedCallsEnabled: true,
      baseSeats: 10,
      pricePerAdditionalSeatUsd: 20,
      overagePricePerCallUsd: 0.25,
      clinicalDocumentationAddOnUsd: 0, // Included in base price
    },
  },
  enterprise: {
    name: "Enterprise",
    description: "High-volume QA with SSO, SCIM, and dedicated support",
    monthlyPriceUsd: 999,
    yearlyPriceUsd: 9588, // $799/mo billed yearly
    contactSales: true,
    limits: {
      callsPerMonth: 5000, // Capped (was unlimited) — overage at $0.15/call
      storageMb: 512000,
      aiAnalysesPerMonth: 5000,
      apiCallsPerMonth: -1,
      maxUsers: -1,
      customPromptTemplates: true,
      ragEnabled: true,
      ssoEnabled: true,
      prioritySupport: true,
      clinicalDocumentationEnabled: true, // Included
      abTestingEnabled: true,
      simulatedCallsEnabled: true,
      baseSeats: 25,
      pricePerAdditionalSeatUsd: 25,
      overagePricePerCallUsd: 0.15,
      clinicalDocumentationAddOnUsd: 0, // Included in base price
    },
  },
};

export const subscriptionSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  planTier: z.enum(PLAN_TIERS),
  status: z.enum(["active", "past_due", "canceled", "trialing", "incomplete"]),
  stripeCustomerId: z.string().optional(),
  stripeSubscriptionId: z.string().optional(),
  stripePriceId: z.string().optional(),
  /** Stripe subscription item ID for the metered seat add-on line item */
  stripeSeatsItemId: z.string().optional(),
  /** Stripe subscription item ID for the metered per-call overage line item */
  stripeOverageItemId: z.string().optional(),
  billingInterval: z.enum(["monthly", "yearly"]).default("monthly"),
  currentPeriodStart: z.string().optional(),
  currentPeriodEnd: z.string().optional(),
  cancelAtPeriodEnd: z.boolean().default(false),
  /** ISO timestamp when subscription first went past_due — used to enforce grace period */
  pastDueAt: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});
export type Subscription = z.infer<typeof subscriptionSchema>;

export const insertSubscriptionSchema = subscriptionSchema
  .omit({ id: true, createdAt: true, updatedAt: true })
  .partial({ cancelAtPeriodEnd: true });
export type InsertSubscription = z.infer<typeof insertSubscriptionSchema>;

// --- REFERENCE DOCUMENT SCHEMAS ---
export const REFERENCE_DOC_CATEGORIES = [
  "employee_handbook",
  "process_manual",
  "product_manual",
  "compliance_guide",
  "training_material",
  "script_template",
  "faq",
  "other",
] as const;
export type ReferenceDocCategory = (typeof REFERENCE_DOC_CATEGORIES)[number];

export const INDEXING_STATUSES = ["pending", "indexing", "indexed", "failed"] as const;
export type IndexingStatus = (typeof INDEXING_STATUSES)[number];

export const referenceDocumentSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  name: z.string().min(1),
  category: z.enum(REFERENCE_DOC_CATEGORIES),
  description: z.string().optional(),
  fileName: z.string(),
  fileSize: z.number(), // bytes
  mimeType: z.string(),
  storagePath: z.string(), // S3/cloud path
  /** Extracted text content (for injection into AI prompts) */
  extractedText: z.string().optional(),
  /** Which call categories should include this doc in analysis */
  appliesTo: z.array(z.string()).optional(), // e.g., ["inbound", "outbound"] or empty for all
  isActive: z.boolean().default(true),
  uploadedBy: z.string().optional(),
  createdAt: z.string().optional(),
  /** Document version number (monotonically increasing) */
  version: z.number().int().default(1),
  /** ID of the document this version replaces (null for first version) */
  previousVersionId: z.string().optional(),
  /** RAG indexing status */
  indexingStatus: z.enum(INDEXING_STATUSES).default("pending"),
  /** Error message if indexing failed */
  indexingError: z.string().optional(),
  /** Source type: "upload" for file uploads, "url" for web crawled content */
  sourceType: z.enum(["upload", "url"]).default("upload"),
  /** Source URL when sourceType is "url" */
  sourceUrl: z.string().optional(),
  /** Number of times this document's chunks have been retrieved in RAG queries */
  retrievalCount: z.number().int().default(0),
  /** SHA-256 content hash for deduplication */
  contentHash: z.string().max(64).optional(),
});
export type ReferenceDocument = z.infer<typeof referenceDocumentSchema>;

export const insertReferenceDocumentSchema = referenceDocumentSchema.omit({ id: true, createdAt: true }).extend({
  // Make new fields optional for insert (they have DB/app-level defaults)
  version: z.number().int().optional(),
  previousVersionId: z.string().optional(),
  indexingStatus: z.enum(INDEXING_STATUSES).optional(),
  indexingError: z.string().optional(),
  sourceType: z.enum(["upload", "url"]).optional(),
  sourceUrl: z.string().optional(),
  retrievalCount: z.number().int().optional(),
  contentHash: z.string().max(64).optional(),
});
export type InsertReferenceDocument = z.infer<typeof insertReferenceDocumentSchema>;

// --- PROMPT TEMPLATE SCHEMAS ---
export const promptTemplateSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  callCategory: z.string(),
  name: z.string(),
  evaluationCriteria: z.string(),
  requiredPhrases: z
    .array(
      z.object({
        phrase: z.string(),
        label: z.string(),
        severity: z.enum(["required", "recommended"]).default("required"),
      }),
    )
    .optional(),
  scoringWeights: z
    .object({
      compliance: z.number().min(0).max(100).default(25),
      customerExperience: z.number().min(0).max(100).default(25),
      communication: z.number().min(0).max(100).default(25),
      resolution: z.number().min(0).max(100).default(25),
    })
    .optional(),
  additionalInstructions: z.string().optional(),
  isActive: z.boolean().default(true),
  isDefault: z.boolean().default(false),
  updatedAt: z.string().optional(),
  updatedBy: z.string().optional(),
});

export const insertPromptTemplateSchema = promptTemplateSchema.omit({ id: true });

export type PromptTemplate = z.infer<typeof promptTemplateSchema>;
export type InsertPromptTemplate = z.infer<typeof insertPromptTemplateSchema>;

// --- BEDROCK MODEL PRESETS (for A/B testing and admin model selection) ---
export const BEDROCK_MODEL_PRESETS = [
  { value: "us.anthropic.claude-sonnet-4-6", label: "Claude Sonnet 4.6 (Current)", cost: "$$" },
  { value: "us.anthropic.claude-sonnet-4-20250514", label: "Claude Sonnet 4", cost: "$$" },
  { value: "us.anthropic.claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", cost: "$" },
  { value: "anthropic.claude-3-haiku-20240307", label: "Claude 3 Haiku (Cheapest)", cost: "$" },
  { value: "anthropic.claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet v2", cost: "$$" },
] as const;

// --- A/B MODEL TEST SCHEMAS ---
export const AB_TEST_STATUSES = ["processing", "analyzing", "completed", "partial", "failed"] as const;

export const insertABTestSchema = z.object({
  orgId: z.string(),
  fileName: z.string(),
  callCategory: z.string().optional(),
  baselineModel: z.string(),
  testModel: z.string(),
  status: z.enum(AB_TEST_STATUSES).default("processing"),
  transcriptText: z.string().optional(),
  baselineAnalysis: z.record(z.unknown()).optional(),
  testAnalysis: z.record(z.unknown()).optional(),
  baselineLatencyMs: z.number().optional(),
  testLatencyMs: z.number().optional(),
  notes: z.string().optional(),
  createdBy: z.string(),
  /** Batch ID for grouping multiple tests together */
  batchId: z.string().optional(),
});

export const abTestSchema = insertABTestSchema.extend({
  id: z.string(),
  createdAt: z.string().optional(),
});

export type InsertABTest = z.infer<typeof insertABTestSchema>;
export type ABTest = z.infer<typeof abTestSchema>;

// --- SPEND TRACKING / USAGE RECORD SCHEMAS ---
export const usageRecordSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  callId: z.string(),
  type: z.enum(["call", "ab-test"]),
  timestamp: z.string(),
  user: z.string(),
  services: z.object({
    assemblyai: z
      .object({
        durationSeconds: z.number().default(0),
        estimatedCost: z.number().default(0),
      })
      .optional(),
    bedrock: z
      .object({
        model: z.string(),
        estimatedInputTokens: z.number().default(0),
        estimatedOutputTokens: z.number().default(0),
        estimatedCost: z.number().default(0),
        latencyMs: z.number().optional(),
      })
      .optional(),
    bedrockSecondary: z
      .object({
        model: z.string(),
        estimatedInputTokens: z.number().default(0),
        estimatedOutputTokens: z.number().default(0),
        estimatedCost: z.number().default(0),
        latencyMs: z.number().optional(),
      })
      .optional(),
  }),
  totalEstimatedCost: z.number(),
});

export type UsageRecord = z.infer<typeof usageRecordSchema>;

// --- LIVE SESSION SCHEMAS (real-time clinical recording) ---
export const LIVE_SESSION_STATUSES = ["active", "paused", "completed", "failed"] as const;
export type LiveSessionStatus = (typeof LIVE_SESSION_STATUSES)[number];

/** How patient recording consent was captured. HIPAA §164.508 documentation. */
export const CONSENT_METHODS = ["verbal", "written", "electronic"] as const;
export type ConsentMethod = (typeof CONSENT_METHODS)[number];

export const insertLiveSessionSchema = z.object({
  orgId: z.string(),
  createdBy: z.string(),
  specialty: z.string().optional(),
  noteFormat: z.string().optional(),
  encounterType: z.string().optional(),
  status: z.enum(LIVE_SESSION_STATUSES).optional(),
  /** Accumulated final transcript segments */
  transcriptText: z.string().optional(),
  /** Latest draft clinical note (regenerated periodically) */
  draftClinicalNote: clinicalNoteSchema.optional(),
  /** Duration in seconds of accumulated audio */
  durationSeconds: z.number().optional(),
  /** Patient consent for recording (boolean kept for backward compat) */
  consentObtained: z.boolean().optional(),
  /** How consent was captured — required when consentObtained is true */
  consentMethod: z.enum(CONSENT_METHODS).optional(),
  /** Timestamp when consent was captured (ISO). Defaults to session start. */
  consentCapturedAt: z.string().optional(),
  /** User ID of the provider who captured the consent */
  consentCapturedBy: z.string().optional(),
  /** Associated call ID (created on session end for permanent storage) */
  callId: z.string().optional(),
  /** Timestamp when patient revoked consent (ISO). HIPAA §164.508 right to revoke. */
  consentRevokedAt: z.string().optional(),
  /** User ID of the provider who processed the revocation */
  consentRevokedBy: z.string().optional(),
});

export const liveSessionSchema = insertLiveSessionSchema.extend({
  id: z.string(),
  startedAt: z.string().optional(),
  endedAt: z.string().optional(),
});

export type InsertLiveSession = z.infer<typeof insertLiveSessionSchema>;
export type LiveSession = z.infer<typeof liveSessionSchema>;

// --- ROLE DEFINITIONS ---
// Role hierarchy: super_admin (4) > admin (3) > manager (2) > viewer (1)
// super_admin is a platform-level role configured via the SUPER_ADMIN_USERS env var
// Format: username:password:displayName (comma-separated for multiple)
// Super admins are NOT scoped to any single org — they can manage ALL organizations.
export const USER_ROLES = [
  {
    value: "viewer" as const,
    label: "Viewer",
    description: "View-only access to dashboards, reports, transcripts, and team data. Cannot edit or delete anything.",
  },
  {
    value: "manager" as const,
    label: "Manager / QA",
    description: "Everything a Viewer can do, plus: assign calls, edit analysis, manage employees, and export reports.",
  },
  {
    value: "admin" as const,
    label: "Administrator",
    description:
      "Full access. Manage users, approve access requests, bulk import, delete calls, and configure system settings.",
  },
  {
    value: "super_admin" as const,
    label: "Super Administrator",
    description:
      "Platform-level admin. Can manage ALL organizations, view platform-wide stats, and impersonate org admins for debugging.",
  },
] as const;

export type UserRole = (typeof USER_ROLES)[number]["value"];

// --- COACHING SESSION SCHEMAS ---
export const COACHING_CATEGORIES = [
  { value: "compliance", label: "Compliance" },
  { value: "customer_experience", label: "Customer Experience" },
  { value: "communication", label: "Communication" },
  { value: "resolution", label: "Resolution" },
  { value: "general", label: "General" },
] as const;

export const insertCoachingSessionSchema = z.object({
  orgId: z.string(),
  employeeId: z.string(),
  callId: z.string().optional(),
  assignedBy: z.string(),
  category: z.string().default("general"),
  title: z.string(),
  notes: z.string().optional(),
  actionPlan: z
    .array(
      z.object({
        task: z.string(),
        completed: z.boolean().default(false),
      }),
    )
    .optional(),
  status: z.enum(["pending", "in_progress", "completed", "dismissed"]).default("pending"),
  dueDate: z.string().optional(),
});

export const coachingSessionSchema = insertCoachingSessionSchema.extend({
  id: z.string(),
  orgId: z.string(),
  createdAt: z.string().optional(),
  completedAt: z.string().optional(),
  // Automation
  automatedTrigger: z.string().optional().nullable(),
  automationRuleId: z.string().optional().nullable(),
  // Self-assessment
  selfAssessmentScore: z.number().optional().nullable(),
  selfAssessmentNotes: z.string().optional().nullable(),
  selfAssessedAt: z.string().optional().nullable(),
  // Effectiveness snapshot
  effectivenessSnapshot: z.any().optional().nullable(),
  effectivenessCalculatedAt: z.string().optional().nullable(),
  // Template
  templateId: z.string().optional().nullable(),
});

export type InsertCoachingSession = z.infer<typeof insertCoachingSessionSchema>;
export type CoachingSession = z.infer<typeof coachingSessionSchema>;

// --- COACHING TEMPLATES ---
export const insertCoachingTemplateSchema = z.object({
  orgId: z.string(),
  name: z.string().min(1),
  category: z.string().default("general"),
  description: z.string().optional(),
  actionPlan: z.array(z.object({ task: z.string() })).default([]),
  tags: z.array(z.string()).default([]),
  createdBy: z.string(),
});

export const coachingTemplateSchema = insertCoachingTemplateSchema.extend({
  id: z.string(),
  usageCount: z.number().default(0),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type InsertCoachingTemplate = z.infer<typeof insertCoachingTemplateSchema>;
export type CoachingTemplate = z.infer<typeof coachingTemplateSchema>;

// --- AUTOMATION RULES ---
export const automationRuleConditionsSchema = z.object({
  threshold: z.number().optional(), // e.g. 6.0 — score below this triggers
  consecutiveCount: z.number().optional(), // e.g. 3 — consecutive calls required
  flagType: z.string().optional(), // for flag_recurring trigger
  category: z.string().optional(), // scope to a specific call category
  sentimentThreshold: z.number().optional(), // 0-1 sentiment score threshold
  lookbackDays: z.number().optional(), // rolling window (default 30)
});

export const automationRuleActionsSchema = z.object({
  createSession: z.boolean().default(true),
  notifyManager: z.boolean().default(true),
  sessionTitle: z.string().optional(),
  sessionCategory: z.string().default("general"),
  sessionNotes: z.string().optional(),
  templateId: z.string().optional(),
});

export const insertAutomationRuleSchema = z.object({
  orgId: z.string(),
  name: z.string().min(1),
  isEnabled: z.boolean().default(true),
  triggerType: z.enum(["consecutive_low_score", "trend_decline", "flag_recurring", "low_sentiment"]),
  conditions: automationRuleConditionsSchema,
  actions: automationRuleActionsSchema,
  createdBy: z.string(),
});

export const automationRuleSchema = insertAutomationRuleSchema.extend({
  id: z.string(),
  lastTriggeredAt: z.string().optional().nullable(),
  triggerCount: z.number().default(0),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type InsertAutomationRule = z.infer<typeof insertAutomationRuleSchema>;
export type AutomationRule = z.infer<typeof automationRuleSchema>;
export type AutomationRuleConditions = z.infer<typeof automationRuleConditionsSchema>;
export type AutomationRuleActions = z.infer<typeof automationRuleActionsSchema>;

// --- COACHING ANALYTICS ---
export type CoachingAnalytics = {
  totalSessions: number;
  completedSessions: number;
  dismissedSessions: number;
  pendingSessions: number;
  completionRate: number; // 0-1
  avgTimeToCloseHours: number | null;
  sessionsByCategory: Record<string, number>;
  sessionsByManager: Record<string, { total: number; completed: number; rate: number }>;
  improvementByCategory: Record<string, { before: number; after: number; delta: number; count: number }>;
  topCoachingTopics: Array<{ topic: string; count: number }>;
  overdueCount: number;
  automatedCount: number; // sessions created by automation rules
};

// --- COACHING RECOMMENDATIONS ---
export type CoachingRecommendationRecord = {
  id: string;
  orgId: string;
  employeeId: string;
  trigger: string;
  category: string;
  title: string;
  description?: string | null;
  severity: string;
  callIds?: string[] | null;
  metrics?: Record<string, unknown> | null;
  status: string;
  coachingSessionId?: string | null;
  createdAt?: string | null;
};

// --- COMBINED TYPES ---
export type CallWithDetails = Call & {
  employee?: Employee;
  transcript?: Transcript;
  sentiment?: SentimentAnalysis;
  analysis?: CallAnalysis;
};

/** Lightweight call summary for reporting — excludes transcript text/words to reduce memory */
export type CallSummary = Call & {
  employee?: Employee;
  sentiment?: SentimentAnalysis;
  analysis?: CallAnalysis;
};

export type DashboardMetrics = {
  totalCalls: number;
  avgSentiment: number;
  avgPerformanceScore: number;
  /** Average confidence score across all analyzed calls (0-1). Null if no calls have confidence data. */
  avgConfidence?: number | null;
  /** Data quality breakdown: count of calls by confidence level. */
  dataQuality?: {
    highConfidence: number; // >= 0.7
    mediumConfidence: number; // >= 0.4 and < 0.7
    lowConfidence: number; // < 0.4
    noConfidence: number; // null/missing confidence score
  };
};

export type SentimentDistribution = {
  positive: number;
  neutral: number;
  negative: number;
};

export type TopPerformer = {
  id: string;
  name: string;
  role?: string;
  avgPerformanceScore: number | null;
  totalCalls: number;
  /** Average confidence score for this performer's calls. */
  avgConfidence?: number | null;
};

/** Audit log entry shape for the audit log viewer */
export type AuditEntry = {
  timestamp?: string;
  event: string;
  orgId?: string;
  userId?: string;
  username?: string;
  role?: string;
  resourceType: string;
  resourceId?: string;
  ip?: string;
  userAgent?: string;
  detail?: string;
};

/** Authenticated user shape returned by /api/auth/me and stored in session */
export type AuthUser = {
  id: string;
  username: string;
  name: string;
  role: string;
  orgId: string;
  orgSlug: string;
  mfaEnabled?: boolean;
};
