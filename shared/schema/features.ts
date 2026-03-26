import { z } from "zod";

// --- USER FEEDBACK SCHEMAS ---
export const FEEDBACK_TYPES = ["feature_rating", "bug_report", "suggestion", "nps", "general"] as const;
export type FeedbackType = (typeof FEEDBACK_TYPES)[number];

export const FEEDBACK_CONTEXTS = [
  "dashboard", "transcripts", "upload", "coaching", "clinical", "search",
  "reports", "insights", "ab_testing", "spend_tracking", "ehr", "general",
] as const;
export type FeedbackContext = (typeof FEEDBACK_CONTEXTS)[number];

export const insertFeedbackSchema = z.object({
  orgId: z.string(),
  userId: z.string(),
  type: z.enum(FEEDBACK_TYPES),
  context: z.enum(FEEDBACK_CONTEXTS).optional(),
  rating: z.number().min(1).max(10).optional(), // 1-10 for feature ratings, 0-10 for NPS
  comment: z.string().max(2000).optional(),
  metadata: z.record(z.unknown()).optional(), // page, feature name, browser, etc.
});

export const feedbackSchema = insertFeedbackSchema.extend({
  id: z.string(),
  status: z.enum(["new", "reviewed", "actioned", "dismissed"]).default("new"),
  adminResponse: z.string().optional(),
  createdAt: z.string().optional(),
});

export type InsertFeedback = z.infer<typeof insertFeedbackSchema>;
export type Feedback = z.infer<typeof feedbackSchema>;

// --- GAMIFICATION SCHEMAS ---
export const BADGE_DEFINITIONS = [
  // Performance badges
  { id: "first_call", name: "First Call", description: "Processed your first call", icon: "phone", category: "milestone" },
  { id: "ten_calls", name: "10 Calls", description: "Processed 10 calls", icon: "phone-forwarded", category: "milestone" },
  { id: "hundred_calls", name: "Century", description: "Processed 100 calls", icon: "trophy", category: "milestone" },
  { id: "perfect_score", name: "Perfect 10", description: "Achieved a perfect 10.0 score", icon: "star", category: "performance" },
  { id: "high_performer", name: "High Performer", description: "5+ calls with score above 9.0", icon: "award", category: "performance" },
  { id: "consistency_king", name: "Consistency King", description: "10 consecutive calls above 8.0", icon: "target", category: "performance" },
  // Improvement badges
  { id: "most_improved", name: "Most Improved", description: "Improved avg score by 2+ points in a month", icon: "trending-up", category: "improvement" },
  { id: "comeback_kid", name: "Comeback Kid", description: "Recovered from below 5.0 to above 8.0", icon: "refresh-cw", category: "improvement" },
  // Engagement badges
  { id: "self_reviewer", name: "Self Reviewer", description: "Completed 5 self-reviews", icon: "clipboard-check", category: "engagement" },
  { id: "coaching_champion", name: "Coaching Champion", description: "Completed 10 coaching sessions", icon: "book-open", category: "engagement" },
  { id: "streak_7", name: "Weekly Warrior", description: "7-day activity streak", icon: "flame", category: "streak" },
  { id: "streak_30", name: "Monthly Maven", description: "30-day activity streak", icon: "zap", category: "streak" },
] as const;

export type BadgeDefinition = typeof BADGE_DEFINITIONS[number];
export type BadgeId = typeof BADGE_DEFINITIONS[number]["id"];

export const employeeBadgeSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  employeeId: z.string(),
  badgeId: z.string(),
  awardedAt: z.string(),
  awardedFor: z.string().optional(), // specific call/event that triggered
});

export type EmployeeBadge = z.infer<typeof employeeBadgeSchema>;

export const gamificationProfileSchema = z.object({
  employeeId: z.string(),
  totalPoints: z.number(),
  currentStreak: z.number(),
  longestStreak: z.number(),
  badges: z.array(employeeBadgeSchema),
  level: z.number(), // computed: points / 100
  rank: z.number().optional(), // position in org leaderboard
});

export type GamificationProfile = z.infer<typeof gamificationProfileSchema>;

export const leaderboardEntrySchema = z.object({
  employeeId: z.string(),
  employeeName: z.string(),
  totalPoints: z.number(),
  currentStreak: z.number(),
  badgeCount: z.number(),
  avgPerformanceScore: z.number(),
  totalCalls: z.number(),
  rank: z.number(),
});

export type LeaderboardEntry = z.infer<typeof leaderboardEntrySchema>;

// --- INSURANCE NARRATIVE SCHEMAS ---
export const INSURANCE_LETTER_TYPES = [
  { value: "prior_auth", label: "Prior Authorization Request", description: "Request pre-approval for planned treatment" },
  { value: "appeal", label: "Insurance Appeal", description: "Appeal a denied claim with clinical justification" },
  { value: "predetermination", label: "Predetermination of Benefits", description: "Estimate insurance coverage before treatment" },
  { value: "medical_necessity", label: "Medical Necessity Letter", description: "Justify clinical need for specific treatment" },
  { value: "peer_to_peer", label: "Peer-to-Peer Review Summary", description: "Summary for peer-to-peer review with insurer" },
] as const;

export type InsuranceLetterType = typeof INSURANCE_LETTER_TYPES[number]["value"];

export const insertInsuranceNarrativeSchema = z.object({
  orgId: z.string(),
  callId: z.string().optional(), // linked clinical encounter
  patientName: z.string(),
  patientDob: z.string().optional(),
  memberId: z.string().optional(),
  insurerName: z.string(),
  insurerAddress: z.string().optional(),
  letterType: z.string(),
  diagnosisCodes: z.array(z.object({ code: z.string(), description: z.string() })).optional(),
  procedureCodes: z.array(z.object({ code: z.string(), description: z.string() })).optional(),
  clinicalJustification: z.string().optional(), // pulled from clinical note or manual
  priorDenialReference: z.string().optional(), // for appeals
  generatedNarrative: z.string().optional(), // AI-generated letter
  status: z.enum(["draft", "finalized", "submitted"]).default("draft"),
  createdBy: z.string(),
});

export const insuranceNarrativeSchema = insertInsuranceNarrativeSchema.extend({
  id: z.string(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type InsertInsuranceNarrative = z.infer<typeof insertInsuranceNarrativeSchema>;
export type InsuranceNarrative = z.infer<typeof insuranceNarrativeSchema>;

// --- REVENUE TRACKING SCHEMAS ---
export const insertCallRevenueSchema = z.object({
  orgId: z.string(),
  callId: z.string(),
  estimatedRevenue: z.number().optional(), // dollar value estimated from call
  actualRevenue: z.number().optional(), // confirmed revenue (entered manually or from EHR)
  revenueType: z.enum(["production", "collection", "scheduled", "lost"]).optional(),
  treatmentValue: z.number().optional(), // total treatment plan value discussed
  scheduledProcedures: z.array(z.object({
    code: z.string(),
    description: z.string(),
    estimatedValue: z.number(),
  })).optional(),
  conversionStatus: z.enum(["converted", "pending", "lost", "unknown"]).default("unknown"),
  notes: z.string().optional(),
  updatedBy: z.string().optional(),
});

export const callRevenueSchema = insertCallRevenueSchema.extend({
  id: z.string(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type InsertCallRevenue = z.infer<typeof insertCallRevenueSchema>;
export type CallRevenue = z.infer<typeof callRevenueSchema>;

// --- CALIBRATION SESSION SCHEMAS ---
export const CALIBRATION_STATUSES = ["scheduled", "in_progress", "completed"] as const;

export const insertCalibrationSessionSchema = z.object({
  orgId: z.string(),
  title: z.string(),
  callId: z.string(), // the call being evaluated
  facilitatorId: z.string(), // user who created/leads the session
  evaluatorIds: z.array(z.string()), // users participating
  scheduledAt: z.string().optional(),
  status: z.enum(CALIBRATION_STATUSES).default("scheduled"),
  targetScore: z.number().min(0).max(10).optional(), // "correct" score after discussion
  consensusNotes: z.string().optional(),
  /** Blind mode: evaluators cannot see others' scores until session is completed */
  blindMode: z.boolean().default(false),
});

export const calibrationSessionSchema = insertCalibrationSessionSchema.extend({
  id: z.string(),
  createdAt: z.string().optional(),
  completedAt: z.string().optional(),
});

export type InsertCalibrationSession = z.infer<typeof insertCalibrationSessionSchema>;
export type CalibrationSession = z.infer<typeof calibrationSessionSchema>;

export const insertCalibrationEvaluationSchema = z.object({
  orgId: z.string(),
  sessionId: z.string(),
  evaluatorId: z.string(),
  performanceScore: z.number().min(0).max(10),
  subScores: z.object({
    compliance: z.number().min(0).max(10).optional(),
    customerExperience: z.number().min(0).max(10).optional(),
    communication: z.number().min(0).max(10).optional(),
    resolution: z.number().min(0).max(10).optional(),
  }).optional(),
  notes: z.string().optional(),
});

export const calibrationEvaluationSchema = insertCalibrationEvaluationSchema.extend({
  id: z.string(),
  createdAt: z.string().optional(),
});

export type InsertCalibrationEvaluation = z.infer<typeof insertCalibrationEvaluationSchema>;
export type CalibrationEvaluation = z.infer<typeof calibrationEvaluationSchema>;

/** Calibration session with evaluations attached */
export type CalibrationSessionWithEvaluations = CalibrationSession & {
  evaluations: CalibrationEvaluation[];
  scoreVariance?: number; // standard deviation of evaluator scores
  call?: import("./calls").Call;
};

// --- LMS (LEARNING MANAGEMENT SYSTEM) SCHEMAS ---

export const LMS_CONTENT_TYPES = [
  { value: "article", label: "Article", description: "Text-based learning content" },
  { value: "quiz", label: "Quiz", description: "Knowledge assessment" },
  { value: "video", label: "Video", description: "Video learning content" },
  { value: "document", label: "Document", description: "Uploaded reference document" },
  { value: "ai_generated", label: "AI-Generated Module", description: "Auto-generated from reference docs" },
] as const;

export type LmsContentType = typeof LMS_CONTENT_TYPES[number]["value"];

export const LMS_CATEGORIES = [
  { value: "onboarding", label: "New Hire Onboarding" },
  { value: "compliance", label: "Compliance & HIPAA" },
  { value: "product_knowledge", label: "Product Knowledge" },
  { value: "call_handling", label: "Call Handling & Scripts" },
  { value: "insurance_basics", label: "Insurance Fundamentals" },
  { value: "clinical_terminology", label: "Clinical Terminology" },
  { value: "dental_codes", label: "Dental Codes & Procedures" },
  { value: "customer_service", label: "Customer Service Skills" },
  { value: "software_training", label: "Software & Tools Training" },
  { value: "leadership", label: "Leadership & Coaching" },
  { value: "general", label: "General Knowledge" },
] as const;

export type LmsCategory = typeof LMS_CATEGORIES[number]["value"];

// --- Learning Module (the content unit) ---
export const insertLearningModuleSchema = z.object({
  orgId: z.string(),
  title: z.string().min(1),
  description: z.string().optional(),
  contentType: z.string(), // article, quiz, video, document, ai_generated
  category: z.string().optional(),
  content: z.string().optional(), // markdown/HTML body for articles
  quizQuestions: z.array(z.object({
    question: z.string(),
    options: z.array(z.string()),
    correctIndex: z.number(),
    explanation: z.string().optional(),
  })).optional(),
  estimatedMinutes: z.number().optional(),
  difficulty: z.enum(["beginner", "intermediate", "advanced"]).optional(),
  tags: z.array(z.string()).optional(),
  sourceDocumentId: z.string().optional(), // reference doc this was generated from
  isPublished: z.boolean().optional(),
  isPlatformContent: z.boolean().optional(), // true = Observatory-curated content
  createdBy: z.string(),
  sortOrder: z.number().optional(),
});

export const learningModuleSchema = insertLearningModuleSchema.extend({
  id: z.string(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type InsertLearningModule = z.infer<typeof insertLearningModuleSchema>;
export type LearningModule = z.infer<typeof learningModuleSchema>;

// --- Learning Path (ordered sequence of modules) ---
export const insertLearningPathSchema = z.object({
  orgId: z.string(),
  title: z.string().min(1),
  description: z.string().optional(),
  category: z.string().optional(),
  moduleIds: z.array(z.string()), // ordered list of module IDs
  isRequired: z.boolean().optional(), // required for all employees
  assignedTo: z.array(z.string()).optional(), // specific employee IDs (empty = all)
  estimatedMinutes: z.number().optional(), // total estimated time
  createdBy: z.string(),
});

export const learningPathSchema = insertLearningPathSchema.extend({
  id: z.string(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type InsertLearningPath = z.infer<typeof insertLearningPathSchema>;
export type LearningPath = z.infer<typeof learningPathSchema>;

// --- Employee Learning Progress ---
export const insertLearningProgressSchema = z.object({
  orgId: z.string(),
  employeeId: z.string(),
  moduleId: z.string(),
  pathId: z.string().optional(), // which learning path this is part of
  status: z.enum(["not_started", "in_progress", "completed"]).default("not_started"),
  quizScore: z.number().optional(), // 0-100 for quiz modules
  quizAttempts: z.number().optional(),
  timeSpentMinutes: z.number().optional(),
  completedAt: z.string().optional(),
  notes: z.string().optional(), // employee notes/reflections
});

export const learningProgressSchema = insertLearningProgressSchema.extend({
  id: z.string(),
  startedAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type InsertLearningProgress = z.infer<typeof insertLearningProgressSchema>;
export type LearningProgress = z.infer<typeof learningProgressSchema>;

/** Learning module with progress for a specific employee */
export type LearningModuleWithProgress = LearningModule & {
  progress?: LearningProgress;
};

/** Learning path with all modules and their progress */
export type LearningPathWithModules = LearningPath & {
  modules: LearningModuleWithProgress[];
  completedCount: number;
  totalModules: number;
};

// --- MARKETING ATTRIBUTION SCHEMAS ---

export const MARKETING_SOURCES = [
  { value: "google_ads", label: "Google Ads", icon: "search" },
  { value: "facebook_ads", label: "Facebook/Meta Ads", icon: "share-2" },
  { value: "instagram", label: "Instagram", icon: "camera" },
  { value: "website", label: "Website", icon: "globe" },
  { value: "google_organic", label: "Google Organic", icon: "search" },
  { value: "yelp", label: "Yelp", icon: "star" },
  { value: "referral_patient", label: "Patient Referral", icon: "users" },
  { value: "referral_doctor", label: "Doctor Referral", icon: "user-plus" },
  { value: "walk_in", label: "Walk-In", icon: "map-pin" },
  { value: "phone_directory", label: "Phone Directory", icon: "phone" },
  { value: "direct_mail", label: "Direct Mail", icon: "mail" },
  { value: "email_campaign", label: "Email Campaign", icon: "mail" },
  { value: "sms_campaign", label: "SMS Campaign", icon: "message-square" },
  { value: "insurance_portal", label: "Insurance Portal", icon: "shield" },
  { value: "community_event", label: "Community Event", icon: "calendar" },
  { value: "social_organic", label: "Social Media (Organic)", icon: "share" },
  { value: "returning_patient", label: "Returning Patient", icon: "repeat" },
  { value: "unknown", label: "Unknown / Not Asked", icon: "help-circle" },
  { value: "other", label: "Other", icon: "more-horizontal" },
] as const;

export type MarketingSourceType = typeof MARKETING_SOURCES[number]["value"];

// Marketing campaign for grouping attribution data
export const insertMarketingCampaignSchema = z.object({
  orgId: z.string(),
  name: z.string().min(1),
  source: z.string(), // from MARKETING_SOURCES
  medium: z.string().optional(), // e.g., "cpc", "organic", "social", "referral"
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  budget: z.number().optional(), // total campaign budget in dollars
  trackingCode: z.string().optional(), // UTM or tracking phone number
  isActive: z.boolean().optional(),
  notes: z.string().optional(),
  createdBy: z.string(),
});

export const marketingCampaignSchema = insertMarketingCampaignSchema.extend({
  id: z.string(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type InsertMarketingCampaign = z.infer<typeof insertMarketingCampaignSchema>;
export type MarketingCampaign = z.infer<typeof marketingCampaignSchema>;

// Attribution record — links a call to its marketing source
export const insertCallAttributionSchema = z.object({
  orgId: z.string(),
  callId: z.string(),
  source: z.string(), // from MARKETING_SOURCES
  campaignId: z.string().optional(), // linked campaign
  medium: z.string().optional(),
  isNewPatient: z.boolean().optional(),
  referrerName: z.string().optional(), // for referral sources
  detectionMethod: z.enum(["manual", "ai_detected", "tracking_number", "utm"]).optional(),
  confidence: z.number().optional(), // 0-1 for AI-detected
  notes: z.string().optional(),
  attributedBy: z.string().optional(),
});

export const callAttributionSchema = insertCallAttributionSchema.extend({
  id: z.string(),
  createdAt: z.string().optional(),
});

export type InsertCallAttribution = z.infer<typeof insertCallAttributionSchema>;
export type CallAttribution = z.infer<typeof callAttributionSchema>;

/** Marketing metrics aggregated by source */
export type MarketingSourceMetrics = {
  source: string;
  totalCalls: number;
  newPatients: number;
  convertedCalls: number; // calls with revenue
  totalRevenue: number;
  avgPerformanceScore: number;
  costPerLead: number | null; // budget / totalCalls (if campaign has budget)
  roi: number | null; // (revenue - budget) / budget
};
