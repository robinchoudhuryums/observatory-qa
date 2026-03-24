import { z } from "zod";
import { clinicalNoteSchema } from "./calls";
import type { Call, Employee, Transcript, SentimentAnalysis, CallAnalysis } from "./calls";

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
  baseSeats: z.number(),                    // seats included in base price
  pricePerAdditionalSeatUsd: z.number(),    // $/seat/mo for additional seats; 0 = not applicable
  overagePricePerCallUsd: z.number(),       // $/call over quota; 0 = hard block at limit
});
export type PlanLimits = z.infer<typeof planLimitsSchema>;

/** Static plan definitions — no DB needed for these */
export const PLAN_DEFINITIONS: Record<PlanTier, { name: string; description: string; monthlyPriceUsd: number; yearlyPriceUsd: number; limits: PlanLimits; contactSales?: boolean }> = {
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
      maxUsers: 3,
      customPromptTemplates: false,
      ragEnabled: false,
      ssoEnabled: false,
      prioritySupport: false,
      clinicalDocumentationEnabled: false,
      abTestingEnabled: false,
      baseSeats: 3,
      pricePerAdditionalSeatUsd: 0,
      overagePricePerCallUsd: 0,
    },
  },
  starter: {
    name: "Starter",
    description: "For growing teams that need smarter call insights",
    monthlyPriceUsd: 79,
    yearlyPriceUsd: 756, // $63/mo billed yearly
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
      clinicalDocumentationEnabled: false,
      abTestingEnabled: false,
      baseSeats: 5,
      pricePerAdditionalSeatUsd: 12,
      overagePricePerCallUsd: 0.35,
    },
  },
  professional: {
    name: "Professional",
    description: "Full QA platform with clinical documentation for healthcare teams",
    monthlyPriceUsd: 149,
    yearlyPriceUsd: 1428, // $119/mo billed yearly
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
      clinicalDocumentationEnabled: true,
      abTestingEnabled: true,
      baseSeats: 10,
      pricePerAdditionalSeatUsd: 18,
      overagePricePerCallUsd: 0.25,
    },
  },
  enterprise: {
    name: "Enterprise",
    description: "Unlimited scale, SSO, and dedicated support for large organizations",
    monthlyPriceUsd: 999,
    yearlyPriceUsd: 9588, // $799/mo billed yearly
    contactSales: true,
    limits: {
      callsPerMonth: -1,
      storageMb: 512000,
      aiAnalysesPerMonth: -1,
      apiCallsPerMonth: -1,
      maxUsers: -1,
      customPromptTemplates: true,
      ragEnabled: true,
      ssoEnabled: true,
      prioritySupport: true,
      clinicalDocumentationEnabled: true,
      abTestingEnabled: true,
      baseSeats: 25,
      pricePerAdditionalSeatUsd: 25,
      overagePricePerCallUsd: 0.10,
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
  billingInterval: z.enum(["monthly", "yearly"]).default("monthly"),
  currentPeriodStart: z.string().optional(),
  currentPeriodEnd: z.string().optional(),
  cancelAtPeriodEnd: z.boolean().default(false),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});
export type Subscription = z.infer<typeof subscriptionSchema>;

export const insertSubscriptionSchema = subscriptionSchema.omit({ id: true, createdAt: true, updatedAt: true }).partial({ cancelAtPeriodEnd: true });
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
});
export type ReferenceDocument = z.infer<typeof referenceDocumentSchema>;

export const insertReferenceDocumentSchema = referenceDocumentSchema.omit({ id: true, createdAt: true });
export type InsertReferenceDocument = z.infer<typeof insertReferenceDocumentSchema>;

// --- PROMPT TEMPLATE SCHEMAS ---
export const promptTemplateSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  callCategory: z.string(),
  name: z.string(),
  evaluationCriteria: z.string(),
  requiredPhrases: z.array(z.object({
    phrase: z.string(),
    label: z.string(),
    severity: z.enum(["required", "recommended"]).default("required"),
  })).optional(),
  scoringWeights: z.object({
    compliance: z.number().min(0).max(100).default(25),
    customerExperience: z.number().min(0).max(100).default(25),
    communication: z.number().min(0).max(100).default(25),
    resolution: z.number().min(0).max(100).default(25),
  }).optional(),
  additionalInstructions: z.string().optional(),
  isActive: z.boolean().default(true),
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
export const insertABTestSchema = z.object({
  orgId: z.string(),
  fileName: z.string(),
  callCategory: z.string().optional(),
  baselineModel: z.string(),
  testModel: z.string(),
  status: z.enum(["processing", "analyzing", "completed", "partial", "failed"]).default("processing"),
  transcriptText: z.string().optional(),
  baselineAnalysis: z.record(z.unknown()).optional(),
  testAnalysis: z.record(z.unknown()).optional(),
  baselineLatencyMs: z.number().optional(),
  testLatencyMs: z.number().optional(),
  notes: z.string().optional(),
  createdBy: z.string(),
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
    assemblyai: z.object({
      durationSeconds: z.number().default(0),
      estimatedCost: z.number().default(0),
    }).optional(),
    bedrock: z.object({
      model: z.string(),
      estimatedInputTokens: z.number().default(0),
      estimatedOutputTokens: z.number().default(0),
      estimatedCost: z.number().default(0),
      latencyMs: z.number().optional(),
    }).optional(),
    bedrockSecondary: z.object({
      model: z.string(),
      estimatedInputTokens: z.number().default(0),
      estimatedOutputTokens: z.number().default(0),
      estimatedCost: z.number().default(0),
      latencyMs: z.number().optional(),
    }).optional(),
  }),
  totalEstimatedCost: z.number(),
});

export type UsageRecord = z.infer<typeof usageRecordSchema>;

// --- LIVE SESSION SCHEMAS (real-time clinical recording) ---
export const LIVE_SESSION_STATUSES = ["active", "paused", "completed", "failed"] as const;
export type LiveSessionStatus = typeof LIVE_SESSION_STATUSES[number];

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
  /** Patient consent for recording */
  consentObtained: z.boolean().optional(),
  /** Associated call ID (created on session end for permanent storage) */
  callId: z.string().optional(),
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
    description: "Full access. Manage users, approve access requests, bulk import, delete calls, and configure system settings.",
  },
  {
    value: "super_admin" as const,
    label: "Super Administrator",
    description: "Platform-level admin. Can manage ALL organizations, view platform-wide stats, and impersonate org admins for debugging.",
  },
] as const;

export type UserRole = typeof USER_ROLES[number]["value"];

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
  actionPlan: z.array(z.object({
    task: z.string(),
    completed: z.boolean().default(false),
  })).optional(),
  status: z.enum(["pending", "in_progress", "completed", "dismissed"]).default("pending"),
  dueDate: z.string().optional(),
});

export const coachingSessionSchema = insertCoachingSessionSchema.extend({
  id: z.string(),
  orgId: z.string(),
  createdAt: z.string().optional(),
  completedAt: z.string().optional(),
});

export type InsertCoachingSession = z.infer<typeof insertCoachingSessionSchema>;
export type CoachingSession = z.infer<typeof coachingSessionSchema>;

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
  avgTranscriptionTime: number;
  avgPerformanceScore: number;
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
