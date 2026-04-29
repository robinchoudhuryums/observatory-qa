/**
 * Drizzle ORM database schema for PostgreSQL.
 *
 * This replaces JSON-file-in-S3 storage with proper relational tables.
 * Audio files remain in S3; everything else lives in PostgreSQL for
 * efficient querying, indexing, and transactional integrity.
 */
import {
  pgTable,
  text,
  varchar,
  timestamp,
  boolean,
  integer,
  real,
  jsonb,
  index,
  uniqueIndex,
  customType,
} from "drizzle-orm/pg-core";

/**
 * Custom pgvector type for storing embeddings.
 * Requires the pgvector extension: CREATE EXTENSION IF NOT EXISTS vector;
 */
const vector = (name: string, dimensions: number) =>
  customType<{ data: number[]; driverData: string }>({
    dataType() {
      return `vector(${dimensions})`;
    },
    toDriver(value: number[]): string {
      return `[${value.join(",")}]`;
    },
    fromDriver(value: string): number[] {
      // pgvector returns "[1,2,3]" format
      return value.slice(1, -1).split(",").map(Number);
    },
  })(name);

// --- ORGANIZATIONS ---
export const organizations = pgTable(
  "organizations",
  {
    id: text("id").primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    slug: varchar("slug", { length: 100 }).notNull(),
    status: varchar("status", { length: 20 }).notNull().default("active"),
    settings: jsonb("settings"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => [uniqueIndex("organizations_slug_idx").on(t.slug)],
);

// --- USERS (database-backed, replaces AUTH_USERS env var) ---
export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    username: varchar("username", { length: 100 }).notNull(),
    passwordHash: text("password_hash").notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    role: varchar("role", { length: 20 }).notNull().default("viewer"),
    isActive: boolean("is_active").notNull().default(true),
    // MFA (TOTP) fields — HIPAA recommended safeguard
    mfaEnabled: boolean("mfa_enabled").notNull().default(false),
    mfaSecret: text("mfa_secret"), // Encrypted TOTP secret (AES-256-GCM)
    mfaBackupCodes: jsonb("mfa_backup_codes").$type<string[]>(), // Hashed backup codes
    // WebAuthn/Passkeys (FIDO2) — stored as JSONB array of credential objects
    webauthnCredentials: jsonb("webauthn_credentials").$type<Array<Record<string, unknown>>>(),
    // Trusted MFA devices — JSONB array of {tokenHash, name, expiresAt}
    mfaTrustedDevices: jsonb("mfa_trusted_devices").$type<Array<Record<string, unknown>>>(),
    // MFA enrollment deadline — per-user deadline when org requires MFA
    mfaEnrollmentDeadline: text("mfa_enrollment_deadline"),
    // Team scope: when set on a manager, limits their view to employees in this subTeam only
    subTeam: varchar("sub_team", { length: 255 }),
    createdAt: timestamp("created_at").defaultNow(),
    lastLoginAt: timestamp("last_login_at"),
  },
  (t) => [uniqueIndex("users_org_username_idx").on(t.orgId, t.username), index("users_org_id_idx").on(t.orgId)],
);

// --- EMPLOYEES ---
export const employees = pgTable(
  "employees",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    name: varchar("name", { length: 255 }).notNull(),
    email: varchar("email", { length: 255 }).notNull(),
    role: varchar("role", { length: 100 }),
    initials: varchar("initials", { length: 5 }),
    status: varchar("status", { length: 20 }).default("Active"),
    subTeam: varchar("sub_team", { length: 255 }),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => [index("employees_org_id_idx").on(t.orgId), uniqueIndex("employees_org_email_idx").on(t.orgId, t.email)],
);

// --- CALLS (universal interaction entity: voice, email, chat, SMS) ---
export const calls = pgTable(
  "calls",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    employeeId: text("employee_id").references(() => employees.id),
    fileName: varchar("file_name", { length: 500 }),
    filePath: text("file_path"),
    status: varchar("status", { length: 30 }).notNull().default("pending"),
    duration: integer("duration"),
    assemblyAiId: varchar("assembly_ai_id", { length: 255 }),
    callCategory: varchar("call_category", { length: 50 }),
    tags: jsonb("tags").$type<string[]>(),
    fileHash: varchar("file_hash", { length: 64 }),
    uploadedAt: timestamp("uploaded_at").defaultNow(),
    // Multi-channel support
    channel: varchar("channel", { length: 20 }).notNull().default("voice"),
    // Email-specific fields
    emailSubject: varchar("email_subject", { length: 1000 }),
    emailFrom: varchar("email_from", { length: 500 }),
    emailTo: varchar("email_to", { length: 500 }),
    emailCc: text("email_cc"),
    emailBody: text("email_body"),
    emailBodyHtml: text("email_body_html"),
    emailMessageId: varchar("email_message_id", { length: 500 }),
    emailThreadId: varchar("email_thread_id", { length: 500 }),
    emailReceivedAt: timestamp("email_received_at"),
    // Chat/SMS fields (future)
    chatPlatform: varchar("chat_platform", { length: 50 }),
    messageCount: integer("message_count"),
  },
  (t) => [
    index("calls_org_id_idx").on(t.orgId),
    index("calls_org_status_idx").on(t.orgId, t.status),
    index("calls_employee_id_idx").on(t.employeeId),
    index("calls_uploaded_at_idx").on(t.uploadedAt),
    index("calls_org_file_hash_idx").on(t.orgId, t.fileHash),
    index("calls_channel_idx").on(t.orgId, t.channel),
    index("calls_email_thread_idx").on(t.orgId, t.emailThreadId),
    index("calls_org_status_uploaded_idx").on(t.orgId, t.status, t.uploadedAt),
    index("calls_org_employee_status_idx").on(t.orgId, t.employeeId, t.status),
    index("calls_assembly_ai_id_idx").on(t.assemblyAiId),
  ],
);

// --- CALL SHARES (resource-level sharing for external reviewers) ---
export const callShares = pgTable(
  "call_shares",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    callId: text("call_id")
      .notNull()
      .references(() => calls.id, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 128 }).notNull(), // SHA-256 of share token
    tokenPrefix: varchar("token_prefix", { length: 16 }).notNull(), // First 8 chars for display
    viewerLabel: varchar("viewer_label", { length: 255 }), // e.g. "Dr. Smith review"
    expiresAt: timestamp("expires_at").notNull(),
    createdBy: varchar("created_by", { length: 255 }).notNull(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => [
    uniqueIndex("call_shares_token_hash_idx").on(t.tokenHash),
    index("call_shares_org_idx").on(t.orgId),
    index("call_shares_call_idx").on(t.orgId, t.callId),
  ],
);

// --- TRANSCRIPTS ---
export const transcripts = pgTable(
  "transcripts",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    callId: text("call_id")
      .notNull()
      .references(() => calls.id, { onDelete: "cascade" }),
    text: text("text"),
    confidence: varchar("confidence", { length: 20 }),
    words: jsonb("words"),
    corrections: jsonb("corrections"), // Manual word corrections [{wordIndex, original, corrected, correctedBy, correctedAt}]
    correctedText: text("corrected_text"), // Full corrected text built from applying corrections
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => [uniqueIndex("transcripts_call_id_idx").on(t.callId), index("transcripts_org_id_idx").on(t.orgId)],
);

// --- SENTIMENT ANALYSES ---
export const sentimentAnalyses = pgTable(
  "sentiment_analyses",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    callId: text("call_id")
      .notNull()
      .references(() => calls.id, { onDelete: "cascade" }),
    overallSentiment: varchar("overall_sentiment", { length: 20 }),
    overallScore: varchar("overall_score", { length: 20 }),
    segments: jsonb("segments"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => [
    uniqueIndex("sentiments_call_id_idx").on(t.callId),
    index("sentiments_org_id_idx").on(t.orgId),
    index("sentiments_org_sentiment_idx").on(t.orgId, t.overallSentiment),
  ],
);

// --- CALL ANALYSES ---
export const callAnalyses = pgTable(
  "call_analyses",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    callId: text("call_id")
      .notNull()
      .references(() => calls.id, { onDelete: "cascade" }),
    performanceScore: varchar("performance_score", { length: 20 }),
    talkTimeRatio: varchar("talk_time_ratio", { length: 20 }),
    responseTime: varchar("response_time", { length: 20 }),
    keywords: jsonb("keywords").$type<string[]>(),
    topics: jsonb("topics").$type<string[]>(),
    summary: text("summary"),
    actionItems: jsonb("action_items").$type<string[]>(),
    feedback: jsonb("feedback"),
    lemurResponse: jsonb("lemur_response"),
    callPartyType: varchar("call_party_type", { length: 50 }),
    flags: jsonb("flags").$type<string[]>(),
    manualEdits: jsonb("manual_edits"),
    confidenceScore: varchar("confidence_score", { length: 20 }),
    confidenceFactors: jsonb("confidence_factors"),
    subScores: jsonb("sub_scores"),
    detectedAgentName: varchar("detected_agent_name", { length: 255 }),
    clinicalNote: jsonb("clinical_note"),
    speechMetrics: jsonb("speech_metrics"),
    selfReview: jsonb("self_review"),
    scoreDispute: jsonb("score_dispute"),
    patientSummary: text("patient_summary"),
    referralLetter: text("referral_letter"),
    suggestedBillingCodes: jsonb("suggested_billing_codes"),
    scoreRationale: jsonb("score_rationale"),
    promptVersionId: varchar("prompt_version_id", { length: 128 }),
    speakerRoleMap: jsonb("speaker_role_map"),
    detectedLanguage: varchar("detected_language", { length: 10 }),
    ehrPushStatus: jsonb("ehr_push_status"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => [
    uniqueIndex("analyses_call_id_idx").on(t.callId),
    index("analyses_org_id_idx").on(t.orgId),
    index("analyses_performance_idx").on(t.orgId, t.performanceScore),
  ],
);

// --- ACCESS REQUESTS ---
export const accessRequests = pgTable(
  "access_requests",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    name: varchar("name", { length: 255 }).notNull(),
    email: varchar("email", { length: 255 }).notNull(),
    reason: text("reason"),
    requestedRole: varchar("requested_role", { length: 20 }).notNull().default("viewer"),
    status: varchar("status", { length: 20 }).notNull().default("pending"),
    reviewedBy: varchar("reviewed_by", { length: 255 }),
    reviewedAt: timestamp("reviewed_at"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => [index("access_requests_org_id_idx").on(t.orgId), index("access_requests_status_idx").on(t.orgId, t.status)],
);

// --- PROMPT TEMPLATES ---
export const promptTemplates = pgTable(
  "prompt_templates",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    callCategory: varchar("call_category", { length: 50 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    evaluationCriteria: text("evaluation_criteria").notNull(),
    requiredPhrases: jsonb("required_phrases"),
    scoringWeights: jsonb("scoring_weights"),
    additionalInstructions: text("additional_instructions"),
    isActive: boolean("is_active").notNull().default(true),
    isDefault: boolean("is_default").notNull().default(false),
    updatedAt: timestamp("updated_at").defaultNow(),
    updatedBy: varchar("updated_by", { length: 255 }),
  },
  (t) => [
    index("prompt_templates_org_id_idx").on(t.orgId),
    index("prompt_templates_org_category_idx").on(t.orgId, t.callCategory),
  ],
);

// --- COACHING SESSIONS ---
export const coachingSessions = pgTable(
  "coaching_sessions",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id),
    callId: text("call_id").references(() => calls.id),
    assignedBy: varchar("assigned_by", { length: 255 }).notNull(),
    category: varchar("category", { length: 50 }).notNull().default("general"),
    title: varchar("title", { length: 500 }).notNull(),
    notes: text("notes"),
    actionPlan: jsonb("action_plan"),
    status: varchar("status", { length: 20 }).notNull().default("pending"),
    dueDate: timestamp("due_date"),
    createdAt: timestamp("created_at").defaultNow(),
    completedAt: timestamp("completed_at"),
    // Automation
    automatedTrigger: text("automated_trigger"), // set when auto-created by an automation rule
    automationRuleId: text("automation_rule_id"), // which rule triggered this
    // Self-assessment
    selfAssessmentScore: real("self_assessment_score"), // employee's self-rated score (0-10)
    selfAssessmentNotes: text("self_assessment_notes"),
    selfAssessedAt: timestamp("self_assessed_at"),
    // Effectiveness snapshot (cached 30-day pre/post comparison)
    effectivenessSnapshot: jsonb("effectiveness_snapshot"),
    effectivenessCalculatedAt: timestamp("effectiveness_calculated_at"),
    // Template used
    templateId: text("template_id"),
  },
  (t) => [
    index("coaching_org_id_idx").on(t.orgId),
    index("coaching_employee_id_idx").on(t.employeeId),
    index("coaching_status_idx").on(t.orgId, t.status),
  ],
);

// --- COACHING RECOMMENDATIONS (auto-generated) ---
export const coachingRecommendations = pgTable(
  "coaching_recommendations",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id),
    trigger: varchar("trigger", { length: 100 }).notNull(), // e.g. "low_compliance", "negative_sentiment_trend"
    category: varchar("category", { length: 50 }).notNull(),
    title: varchar("title", { length: 500 }).notNull(),
    description: text("description"),
    severity: varchar("severity", { length: 20 }).notNull().default("medium"), // low, medium, high
    callIds: jsonb("call_ids"), // array of call IDs that triggered this
    metrics: jsonb("metrics"), // snapshot of metrics at time of recommendation
    status: varchar("status", { length: 20 }).notNull().default("pending"), // pending, accepted, dismissed
    coachingSessionId: text("coaching_session_id").references(() => coachingSessions.id),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => [
    index("coaching_rec_org_id_idx").on(t.orgId),
    index("coaching_rec_employee_idx").on(t.orgId, t.employeeId),
    index("coaching_rec_status_idx").on(t.orgId, t.status),
  ],
);

// --- COACHING TEMPLATES (reusable action plans) ---
export const coachingTemplates = pgTable(
  "coaching_templates",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    name: varchar("name", { length: 255 }).notNull(),
    category: varchar("category", { length: 50 }).notNull().default("general"),
    description: text("description"),
    // Predefined action plan tasks: [{ task: string }]
    actionPlan: jsonb("action_plan").notNull().default([]),
    tags: jsonb("tags").$type<string[]>().default([]),
    createdBy: varchar("created_by", { length: 255 }).notNull(),
    usageCount: integer("usage_count").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (t) => [
    index("coaching_templates_org_idx").on(t.orgId),
    index("coaching_templates_org_category_idx").on(t.orgId, t.category),
  ],
);

// --- AUTOMATION RULES (auto-create coaching sessions) ---
export const automationRules = pgTable(
  "automation_rules",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    name: varchar("name", { length: 255 }).notNull(),
    isEnabled: boolean("is_enabled").notNull().default(true),
    // Trigger type: consecutive_low_score | trend_decline | flag_recurring | low_sentiment
    triggerType: varchar("trigger_type", { length: 50 }).notNull(),
    // Conditions: { threshold, consecutiveCount, flagType, category, sentimentThreshold, ... }
    conditions: jsonb("conditions").notNull(),
    // Actions: { createSession, notifyManager, sessionTitle, sessionCategory, sessionNotes, templateId }
    actions: jsonb("actions").notNull(),
    createdBy: varchar("created_by", { length: 255 }).notNull(),
    lastTriggeredAt: timestamp("last_triggered_at"),
    triggerCount: integer("trigger_count").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (t) => [
    index("automation_rules_org_idx").on(t.orgId),
    index("automation_rules_org_enabled_idx").on(t.orgId, t.isEnabled),
  ],
);

// --- API KEYS ---
export const apiKeys = pgTable(
  "api_keys",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    name: varchar("name", { length: 255 }).notNull(),
    keyHash: varchar("key_hash", { length: 128 }).notNull(), // SHA-256 hex
    keyPrefix: varchar("key_prefix", { length: 16 }).notNull(), // e.g., "obs_k_ab12cd34"
    permissions: jsonb("permissions").$type<string[]>().notNull(),
    createdBy: varchar("created_by", { length: 255 }).notNull(),
    status: varchar("status", { length: 20 }).notNull().default("active"),
    expiresAt: timestamp("expires_at"),
    lastUsedAt: timestamp("last_used_at"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => [uniqueIndex("api_keys_hash_idx").on(t.keyHash), index("api_keys_org_id_idx").on(t.orgId)],
);

// --- INVITATIONS ---
export const invitations = pgTable(
  "invitations",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    email: varchar("email", { length: 255 }).notNull(),
    role: varchar("role", { length: 20 }).notNull().default("viewer"),
    // Token is stored as SHA-256 hash (never plaintext). The raw token is
    // returned only once at creation time (for the invite URL/email).
    token: varchar("token", { length: 255 }).notNull(),
    // First 8 chars of the raw token for display/identification in admin UI
    tokenPrefix: varchar("token_prefix", { length: 12 }),
    invitedBy: varchar("invited_by", { length: 255 }).notNull(),
    status: varchar("status", { length: 20 }).notNull().default("pending"),
    expiresAt: timestamp("expires_at"),
    acceptedAt: timestamp("accepted_at"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => [
    uniqueIndex("invitations_token_idx").on(t.token),
    index("invitations_org_id_idx").on(t.orgId),
    index("invitations_email_idx").on(t.orgId, t.email),
  ],
);

// --- SUBSCRIPTIONS ---
export const subscriptions = pgTable(
  "subscriptions",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    planTier: varchar("plan_tier", { length: 20 }).notNull().default("free"),
    status: varchar("status", { length: 20 }).notNull().default("active"),
    stripeCustomerId: varchar("stripe_customer_id", { length: 255 }),
    stripeSubscriptionId: varchar("stripe_subscription_id", { length: 255 }),
    stripePriceId: varchar("stripe_price_id", { length: 255 }),
    stripeSeatsItemId: varchar("stripe_seats_item_id", { length: 255 }),
    stripeOverageItemId: varchar("stripe_overage_item_id", { length: 255 }),
    billingInterval: varchar("billing_interval", { length: 10 }).notNull().default("monthly"),
    currentPeriodStart: timestamp("current_period_start"),
    currentPeriodEnd: timestamp("current_period_end"),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    pastDueAt: timestamp("past_due_at"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (t) => [
    uniqueIndex("subscriptions_org_id_idx").on(t.orgId),
    index("subscriptions_stripe_customer_idx").on(t.stripeCustomerId),
    index("subscriptions_stripe_sub_idx").on(t.stripeSubscriptionId),
  ],
);

// --- REFERENCE DOCUMENTS ---
export const referenceDocuments = pgTable(
  "reference_documents",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    name: varchar("name", { length: 255 }).notNull(),
    category: varchar("category", { length: 50 }).notNull(),
    description: text("description"),
    fileName: varchar("file_name", { length: 255 }).notNull(),
    fileSize: integer("file_size").notNull(),
    mimeType: varchar("mime_type", { length: 100 }).notNull(),
    storagePath: text("storage_path").notNull(),
    extractedText: text("extracted_text"),
    appliesTo: jsonb("applies_to"), // string[]
    isActive: boolean("is_active").notNull().default(true),
    uploadedBy: varchar("uploaded_by", { length: 255 }),
    createdAt: timestamp("created_at").defaultNow(),
    version: integer("version").notNull().default(1),
    previousVersionId: text("previous_version_id"),
    indexingStatus: varchar("indexing_status", { length: 20 }).notNull().default("pending"),
    indexingError: text("indexing_error"),
    sourceType: varchar("source_type", { length: 20 }).notNull().default("upload"),
    sourceUrl: text("source_url"),
    retrievalCount: integer("retrieval_count").notNull().default(0),
    contentHash: varchar("content_hash", { length: 64 }), // SHA-256 hex for deduplication
  },
  (t) => [index("ref_docs_org_id_idx").on(t.orgId), index("ref_docs_category_idx").on(t.orgId, t.category)],
);

// --- DOCUMENT CHUNKS (pgvector-powered RAG) ---
export const documentChunks = pgTable(
  "document_chunks",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    documentId: text("document_id")
      .notNull()
      .references(() => referenceDocuments.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    text: text("text").notNull(),
    sectionHeader: varchar("section_header", { length: 500 }),
    tokenCount: integer("token_count").notNull(),
    charStart: integer("char_start").notNull(),
    charEnd: integer("char_end").notNull(),
    embedding: vector("embedding", 1024), // Amazon Titan Embed V2 — 1024 dimensions
    contentHash: varchar("content_hash", { length: 64 }), // SHA-256 of chunk text for deduplication
    retrievalCount: integer("retrieval_count").default(0), // Per-chunk retrieval tracking
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => [index("doc_chunks_org_id_idx").on(t.orgId), index("doc_chunks_document_id_idx").on(t.documentId)],
);

// --- PASSWORD RESET TOKENS ---
export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    id: text("id").primaryKey(),
    // orgId enables RLS-based tenant isolation and cascade deletion when an org is purged.
    // Nullable for backward compatibility with rows created before the column was added.
    orgId: text("org_id").references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 128 }).notNull(), // SHA-256 hashed
    expiresAt: timestamp("expires_at").notNull(),
    usedAt: timestamp("used_at"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => [
    index("password_reset_user_idx").on(t.userId),
    index("password_reset_org_idx").on(t.orgId),
    uniqueIndex("password_reset_token_hash_idx").on(t.tokenHash),
  ],
);

// --- USAGE EVENTS (per-org metering for billing) ---
export const usageEvents = pgTable(
  "usage_events",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    eventType: varchar("event_type", { length: 50 }).notNull(), // 'transcription', 'ai_analysis', 'storage_mb'
    quantity: real("quantity").notNull().default(1),
    metadata: jsonb("metadata"), // e.g., { callId, model, durationSeconds }
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => [index("usage_org_type_idx").on(t.orgId, t.eventType), index("usage_created_at_idx").on(t.createdAt)],
);

// --- A/B TESTS ---
export const abTests = pgTable(
  "ab_tests",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    fileName: varchar("file_name", { length: 500 }).notNull(),
    callCategory: varchar("call_category", { length: 50 }),
    baselineModel: varchar("baseline_model", { length: 255 }).notNull(),
    testModel: varchar("test_model", { length: 255 }).notNull(),
    status: varchar("status", { length: 30 }).notNull().default("processing"),
    transcriptText: text("transcript_text"),
    baselineAnalysis: jsonb("baseline_analysis"),
    testAnalysis: jsonb("test_analysis"),
    baselineLatencyMs: integer("baseline_latency_ms"),
    testLatencyMs: integer("test_latency_ms"),
    notes: text("notes"),
    createdBy: varchar("created_by", { length: 255 }).notNull(),
    createdAt: timestamp("created_at").defaultNow(),
    batchId: text("batch_id"),
  },
  (t) => [index("ab_tests_org_id_idx").on(t.orgId), index("ab_tests_status_idx").on(t.orgId, t.status)],
);

// --- SPEND RECORDS (detailed per-call cost tracking) ---
export const spendRecords = pgTable(
  "spend_records",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    callId: text("call_id").notNull(),
    type: varchar("type", { length: 20 }).notNull(), // 'call' | 'ab-test'
    timestamp: timestamp("timestamp").notNull().defaultNow(),
    userName: varchar("user_name", { length: 255 }).notNull(),
    services: jsonb("services").notNull(), // { assemblyai, bedrock, bedrockSecondary }
    totalEstimatedCost: real("total_estimated_cost").notNull().default(0),
  },
  (t) => [index("spend_records_org_id_idx").on(t.orgId), index("spend_records_timestamp_idx").on(t.orgId, t.timestamp)],
);

// --- LIVE SESSIONS (real-time clinical recording) ---
export const liveSessions = pgTable(
  "live_sessions",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    createdBy: varchar("created_by", { length: 255 }).notNull(),
    specialty: varchar("specialty", { length: 100 }),
    noteFormat: varchar("note_format", { length: 50 }).notNull().default("soap"),
    encounterType: varchar("encounter_type", { length: 50 }).notNull().default("clinical_encounter"),
    status: varchar("status", { length: 20 }).notNull().default("active"),
    transcriptText: text("transcript_text").default(""),
    draftClinicalNote: jsonb("draft_clinical_note"),
    durationSeconds: integer("duration_seconds").notNull().default(0),
    consentObtained: boolean("consent_obtained").notNull().default(false),
    // HIPAA §164.508: structured consent metadata for audit trail. Added per F-12.
    consentMethod: varchar("consent_method", { length: 20 }),
    consentCapturedAt: timestamp("consent_captured_at"),
    consentCapturedBy: text("consent_captured_by"),
    callId: text("call_id").references(() => calls.id),
    startedAt: timestamp("started_at").defaultNow(),
    endedAt: timestamp("ended_at"),
  },
  (t) => [
    index("live_sessions_org_id_idx").on(t.orgId),
    index("live_sessions_status_idx").on(t.orgId, t.status),
    index("live_sessions_created_by_idx").on(t.orgId, t.createdBy),
  ],
);

// --- USER FEEDBACK ---
export const feedbacks = pgTable(
  "feedbacks",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    userId: text("user_id").notNull(),
    type: varchar("type", { length: 30 }).notNull(), // feature_rating, bug_report, suggestion, nps, general
    context: varchar("context", { length: 50 }), // which page/feature
    rating: integer("rating"), // 1-10
    comment: text("comment"),
    metadata: jsonb("metadata"),
    status: varchar("status", { length: 20 }).notNull().default("new"),
    adminResponse: text("admin_response"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => [
    index("feedbacks_org_id_idx").on(t.orgId),
    index("feedbacks_type_idx").on(t.orgId, t.type),
    index("feedbacks_created_at_idx").on(t.orgId, t.createdAt),
  ],
);

// --- GAMIFICATION: EMPLOYEE BADGES ---
export const employeeBadges = pgTable(
  "employee_badges",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id),
    badgeId: varchar("badge_id", { length: 50 }).notNull(),
    awardedAt: timestamp("awarded_at").defaultNow(),
    awardedFor: text("awarded_for"), // callId or event description
    awardedBy: text("awarded_by"), // manager userId for custom badges
    customMessage: text("custom_message"), // manager's message for recognition badges
  },
  (t) => [
    index("employee_badges_org_idx").on(t.orgId),
    index("employee_badges_employee_idx").on(t.orgId, t.employeeId),
    uniqueIndex("employee_badges_unique_idx").on(t.orgId, t.employeeId, t.badgeId),
  ],
);

// --- GAMIFICATION: POINTS/STREAKS ---
export const gamificationProfiles = pgTable(
  "gamification_profiles",
  {
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id),
    totalPoints: integer("total_points").notNull().default(0),
    currentStreak: integer("current_streak").notNull().default(0),
    longestStreak: integer("longest_streak").notNull().default(0),
    lastActivityDate: varchar("last_activity_date", { length: 10 }), // YYYY-MM-DD
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (t) => [
    uniqueIndex("gamification_profiles_pk_idx").on(t.orgId, t.employeeId),
    index("gamification_profiles_points_idx").on(t.orgId, t.totalPoints),
  ],
);

// --- INSURANCE NARRATIVES ---
export const insuranceNarratives = pgTable(
  "insurance_narratives",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    callId: text("call_id").references(() => calls.id),
    patientName: varchar("patient_name", { length: 255 }).notNull(),
    patientDob: varchar("patient_dob", { length: 20 }),
    memberId: varchar("member_id", { length: 100 }),
    insurerName: varchar("insurer_name", { length: 255 }).notNull(),
    insurerAddress: text("insurer_address"),
    letterType: varchar("letter_type", { length: 50 }).notNull(),
    diagnosisCodes: jsonb("diagnosis_codes"),
    procedureCodes: jsonb("procedure_codes"),
    clinicalJustification: text("clinical_justification"),
    priorDenialReference: text("prior_denial_reference"),
    generatedNarrative: text("generated_narrative"),
    status: varchar("status", { length: 20 }).notNull().default("draft"),
    createdBy: varchar("created_by", { length: 255 }).notNull(),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
    outcome: varchar("outcome", { length: 30 }),
    outcomeDate: timestamp("outcome_date"),
    outcomeNotes: text("outcome_notes"),
    denialCode: varchar("denial_code", { length: 30 }),
    denialReason: text("denial_reason"),
    submissionDeadline: timestamp("submission_deadline"),
    deadlineAcknowledged: boolean("deadline_acknowledged"),
    payerTemplate: varchar("payer_template", { length: 50 }),
    supportingDocuments: jsonb("supporting_documents"),
  },
  (t) => [
    index("insurance_narratives_org_idx").on(t.orgId),
    index("insurance_narratives_call_idx").on(t.orgId, t.callId),
    index("insurance_narratives_status_idx").on(t.orgId, t.status),
  ],
);

// --- CALL REVENUE TRACKING ---
export const callRevenues = pgTable(
  "call_revenues",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    callId: text("call_id")
      .notNull()
      .references(() => calls.id),
    estimatedRevenue: real("estimated_revenue"),
    actualRevenue: real("actual_revenue"),
    revenueType: varchar("revenue_type", { length: 20 }),
    treatmentValue: real("treatment_value"),
    scheduledProcedures: jsonb("scheduled_procedures"),
    conversionStatus: varchar("conversion_status", { length: 20 }).notNull().default("unknown"),
    notes: text("notes"),
    updatedBy: varchar("updated_by", { length: 255 }),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
    attributionStage: varchar("attribution_stage", { length: 30 }),
    appointmentDate: timestamp("appointment_date"),
    appointmentCompleted: boolean("appointment_completed"),
    treatmentAccepted: boolean("treatment_accepted"),
    paymentCollected: real("payment_collected"),
    payerType: varchar("payer_type", { length: 20 }),
    insuranceCarrier: varchar("insurance_carrier", { length: 255 }),
    insuranceAmount: real("insurance_amount"),
    patientAmount: real("patient_amount"),
    ehrSyncedAt: timestamp("ehr_synced_at"),
    convertedAt: timestamp("converted_at"),
  },
  (t) => [
    index("call_revenues_org_idx").on(t.orgId),
    uniqueIndex("call_revenues_call_idx").on(t.orgId, t.callId),
    index("call_revenues_conversion_idx").on(t.orgId, t.conversionStatus),
  ],
);

// --- CALIBRATION SESSIONS ---
export const calibrationSessions = pgTable(
  "calibration_sessions",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    title: varchar("title", { length: 500 }).notNull(),
    callId: text("call_id")
      .notNull()
      .references(() => calls.id),
    facilitatorId: text("facilitator_id").notNull(),
    evaluatorIds: jsonb("evaluator_ids").$type<string[]>().notNull(),
    scheduledAt: timestamp("scheduled_at"),
    status: varchar("status", { length: 20 }).notNull().default("scheduled"),
    targetScore: real("target_score"),
    consensusNotes: text("consensus_notes"),
    createdAt: timestamp("created_at").defaultNow(),
    completedAt: timestamp("completed_at"),
    blindMode: boolean("blind_mode").notNull().default(false),
  },
  (t) => [
    index("calibration_sessions_org_idx").on(t.orgId),
    index("calibration_sessions_status_idx").on(t.orgId, t.status),
  ],
);

// --- CALIBRATION EVALUATIONS ---
export const calibrationEvaluations = pgTable(
  "calibration_evaluations",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    sessionId: text("session_id")
      .notNull()
      .references(() => calibrationSessions.id, { onDelete: "cascade" }),
    evaluatorId: text("evaluator_id").notNull(),
    performanceScore: real("performance_score").notNull(),
    subScores: jsonb("sub_scores"),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => [
    index("calibration_evals_session_idx").on(t.sessionId),
    uniqueIndex("calibration_evals_unique_idx").on(t.sessionId, t.evaluatorId),
  ],
);

// --- LMS: LEARNING MODULES ---
export const learningModules = pgTable(
  "learning_modules",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    title: varchar("title", { length: 500 }).notNull(),
    description: text("description"),
    contentType: varchar("content_type", { length: 30 }).notNull(),
    category: varchar("category", { length: 50 }),
    content: text("content"), // markdown/HTML
    quizQuestions: jsonb("quiz_questions"),
    estimatedMinutes: integer("estimated_minutes"),
    difficulty: varchar("difficulty", { length: 20 }),
    tags: jsonb("tags").$type<string[]>(),
    sourceDocumentId: text("source_document_id"),
    isPublished: boolean("is_published").notNull().default(false),
    isPlatformContent: boolean("is_platform_content").notNull().default(false),
    createdBy: varchar("created_by", { length: 255 }).notNull(),
    sortOrder: integer("sort_order"),
    prerequisiteModuleIds: jsonb("prerequisite_module_ids").$type<string[]>(),
    passingScore: integer("passing_score"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (t) => [
    index("learning_modules_org_idx").on(t.orgId),
    index("learning_modules_category_idx").on(t.orgId, t.category),
    index("learning_modules_published_idx").on(t.orgId, t.isPublished),
  ],
);

// --- LMS: LEARNING PATHS ---
export const learningPaths = pgTable(
  "learning_paths",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    title: varchar("title", { length: 500 }).notNull(),
    description: text("description"),
    category: varchar("category", { length: 50 }),
    moduleIds: jsonb("module_ids").$type<string[]>().notNull(),
    isRequired: boolean("is_required").notNull().default(false),
    assignedTo: jsonb("assigned_to").$type<string[]>(),
    estimatedMinutes: integer("estimated_minutes"),
    createdBy: varchar("created_by", { length: 255 }).notNull(),
    dueDate: timestamp("due_date"),
    enforceOrder: boolean("enforce_order").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (t) => [index("learning_paths_org_idx").on(t.orgId), index("learning_paths_category_idx").on(t.orgId, t.category)],
);

// --- LMS: EMPLOYEE LEARNING PROGRESS ---
export const learningProgress = pgTable(
  "learning_progress",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id),
    moduleId: text("module_id").notNull(),
    pathId: text("path_id"),
    status: varchar("status", { length: 20 }).notNull().default("not_started"),
    quizScore: integer("quiz_score"),
    quizAttempts: integer("quiz_attempts"),
    quizVersionHash: varchar("quiz_version_hash", { length: 64 }), // SHA-256 of quiz questions at time of attempt
    timeSpentMinutes: integer("time_spent_minutes"),
    completedAt: timestamp("completed_at"),
    notes: text("notes"),
    startedAt: timestamp("started_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (t) => [
    index("learning_progress_org_idx").on(t.orgId),
    index("learning_progress_employee_idx").on(t.orgId, t.employeeId),
    uniqueIndex("learning_progress_unique_idx").on(t.orgId, t.employeeId, t.moduleId),
  ],
);

// --- MARKETING CAMPAIGNS ---
export const marketingCampaigns = pgTable(
  "marketing_campaigns",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    name: varchar("name", { length: 500 }).notNull(),
    source: varchar("source", { length: 50 }).notNull(),
    medium: varchar("medium", { length: 50 }),
    startDate: timestamp("start_date"),
    endDate: timestamp("end_date"),
    budget: real("budget"),
    trackingCode: varchar("tracking_code", { length: 255 }),
    isActive: boolean("is_active").notNull().default(true),
    notes: text("notes"),
    createdBy: varchar("created_by", { length: 255 }).notNull(),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (t) => [
    index("marketing_campaigns_org_idx").on(t.orgId),
    index("marketing_campaigns_source_idx").on(t.orgId, t.source),
  ],
);

// --- CALL ATTRIBUTION ---
export const callAttributions = pgTable(
  "call_attributions",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    callId: text("call_id")
      .notNull()
      .references(() => calls.id, { onDelete: "cascade" }),
    source: varchar("source", { length: 50 }).notNull(),
    campaignId: text("campaign_id").references(() => marketingCampaigns.id),
    medium: varchar("medium", { length: 50 }),
    isNewPatient: boolean("is_new_patient"),
    referrerName: varchar("referrer_name", { length: 255 }),
    detectionMethod: varchar("detection_method", { length: 30 }),
    confidence: real("confidence"),
    notes: text("notes"),
    attributedBy: varchar("attributed_by", { length: 255 }),
    // UTM parameter tracking
    utmSource: varchar("utm_source", { length: 255 }),
    utmMedium: varchar("utm_medium", { length: 255 }),
    utmCampaign: varchar("utm_campaign", { length: 255 }),
    utmContent: varchar("utm_content", { length: 255 }),
    utmTerm: varchar("utm_term", { length: 255 }),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => [
    index("call_attributions_org_idx").on(t.orgId),
    uniqueIndex("call_attributions_call_idx").on(t.orgId, t.callId),
    index("call_attributions_source_idx").on(t.orgId, t.source),
    index("call_attributions_campaign_idx").on(t.orgId, t.campaignId),
  ],
);

// --- BAA Tracking (Business Associate Agreements — HIPAA §164.502(e)) ---
// NOTE: The canonical BAA table is `business_associate_agreements` (created by sync-schema.ts).
// The old `baa_records` Drizzle definition was removed as dead code — it was never referenced
// by any routes or storage methods. All BAA operations use raw SQL via pg-storage-features.ts.

// --- AUDIT LOGS (append-only, tamper-evident, HIPAA compliance) ---
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    event: varchar("event", { length: 100 }).notNull(),
    userId: text("user_id"),
    username: varchar("username", { length: 100 }),
    role: varchar("role", { length: 20 }),
    resourceType: varchar("resource_type", { length: 50 }).notNull(),
    resourceId: text("resource_id"),
    ip: varchar("ip", { length: 45 }),
    userAgent: text("user_agent"),
    detail: text("detail"),
    // Tamper-evident hash chain: SHA-256(prevHash + entryData)
    // If any row is modified or deleted, the chain breaks and verification fails
    integrityHash: varchar("integrity_hash", { length: 64 }),
    prevHash: varchar("prev_hash", { length: 64 }),
    sequenceNum: integer("sequence_num"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => [
    index("audit_logs_org_idx").on(t.orgId, t.createdAt),
    index("audit_logs_event_idx").on(t.orgId, t.event),
    index("audit_logs_user_idx").on(t.orgId, t.userId),
    index("audit_logs_sequence_idx").on(t.orgId, t.sequenceNum),
  ],
);

// --- PROVIDER TEMPLATES (custom clinical note templates per provider) ---
export const providerTemplates = pgTable(
  "provider_templates",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    userId: text("user_id").notNull(), // template owner
    name: varchar("name", { length: 255 }).notNull(),
    specialty: varchar("specialty", { length: 100 }),
    format: varchar("format", { length: 50 }),
    category: varchar("category", { length: 100 }),
    description: text("description"),
    sections: jsonb("sections"), // { subjective, objective, assessment, plan, ... }
    defaultCodes: jsonb("default_codes"), // ICD/CPT/CDT codes
    tags: jsonb("tags"), // string[]
    isDefault: boolean("is_default").default(false), // show as default for this specialty
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (t) => [
    index("provider_templates_org_user_idx").on(t.orgId, t.userId),
    index("provider_templates_org_specialty_idx").on(t.orgId, t.specialty),
  ],
);

// --- Security Incidents (HIPAA breach tracking) ---
export const securityIncidents = pgTable(
  "security_incidents",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    title: varchar("title", { length: 500 }).notNull(),
    description: text("description").notNull(),
    severity: varchar("severity", { length: 20 }).notNull(), // critical, high, medium, low
    phase: varchar("phase", { length: 30 }).notNull().default("detection"),
    declaredAt: timestamp("declared_at").notNull().defaultNow(),
    declaredBy: text("declared_by").notNull(),
    closedAt: timestamp("closed_at"),
    affectedSystems: jsonb("affected_systems").default([]),
    estimatedAffectedRecords: integer("estimated_affected_records").default(0),
    phiInvolved: boolean("phi_involved").default(false),
    timeline: jsonb("timeline").default([]),
    actionItems: jsonb("action_items").default([]),
    breachNotification: varchar("breach_notification", { length: 30 }).default("not_required"),
    breachNotificationDeadline: timestamp("breach_notification_deadline"),
    containedAt: timestamp("contained_at"),
    eradicatedAt: timestamp("eradicated_at"),
    recoveredAt: timestamp("recovered_at"),
    rootCause: text("root_cause"),
    lessonsLearned: text("lessons_learned"),
  },
  (t) => [
    index("security_incidents_org_idx").on(t.orgId),
    index("security_incidents_org_phase_idx").on(t.orgId, t.phase),
  ],
);

// --- Breach Reports (HIPAA §164.408 notification tracking) ---
export const breachReports = pgTable(
  "breach_reports",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    incidentId: text("incident_id").references(() => securityIncidents.id),
    title: varchar("title", { length: 500 }).notNull(),
    description: text("description").notNull(),
    discoveredAt: timestamp("discovered_at").notNull().defaultNow(),
    reportedBy: text("reported_by").notNull(),
    affectedIndividuals: integer("affected_individuals").notNull().default(0),
    phiTypes: jsonb("phi_types").default([]), // e.g., ["names", "medical_records", "ssn"]
    notificationStatus: varchar("notification_status", { length: 30 }).notNull().default("pending"),
    notificationDeadline: timestamp("notification_deadline").notNull(),
    individualsNotifiedAt: timestamp("individuals_notified_at"),
    hhsNotifiedAt: timestamp("hhs_notified_at"),
    mediaNotifiedAt: timestamp("media_notified_at"),
    correctiveActions: jsonb("corrective_actions").default([]),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (t) => [
    index("breach_reports_org_idx").on(t.orgId),
    index("breach_reports_org_status_idx").on(t.orgId, t.notificationStatus),
  ],
);

// --- BUSINESS ASSOCIATE AGREEMENTS (HIPAA §164.502(e)) ---
export const businessAssociateAgreements = pgTable(
  "business_associate_agreements",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    vendorName: varchar("vendor_name", { length: 255 }).notNull(),
    vendorType: varchar("vendor_type", { length: 100 }).notNull(), // cloud_provider, transcription, ai_analysis, ehr, email, etc.
    description: text("description"),
    contactName: varchar("contact_name", { length: 255 }),
    contactEmail: varchar("contact_email", { length: 255 }),
    status: varchar("status", { length: 30 }).notNull().default("active"), // active, expired, terminated, pending
    signedAt: timestamp("signed_at"),
    expiresAt: timestamp("expires_at"),
    renewalReminderDays: integer("renewal_reminder_days").default(30), // days before expiry to alert
    signedBy: varchar("signed_by", { length: 255 }), // org-side signatory
    vendorSignatory: varchar("vendor_signatory", { length: 255 }),
    documentUrl: text("document_url"), // link to signed BAA PDF (S3 or external)
    notes: text("notes"),
    phiCategories: jsonb("phi_categories").default([]), // e.g., ["audio", "transcripts", "clinical_notes"]
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (t) => [
    index("baa_org_idx").on(t.orgId),
    index("baa_org_status_idx").on(t.orgId, t.status),
    index("baa_expiry_idx").on(t.expiresAt),
  ],
);

// --- SIMULATED CALLS (synthetic/training calls generated via TTS) ---
// Multi-tenant lift of CA's single-tenant simulated_calls table: every row
// carries org_id and references organizations(id). sent_to_analysis_call_id
// links a generated call to the analysis Call row created when the audio is
// fed back through the regular pipeline.
export const simulatedCalls = pgTable(
  "simulated_calls",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    title: varchar("title", { length: 500 }).notNull(),
    scenario: text("scenario"),
    qualityTier: varchar("quality_tier", { length: 50 }),
    equipment: varchar("equipment", { length: 255 }),
    status: varchar("status", { length: 30 }).notNull().default("pending"),
    script: jsonb("script").notNull(),
    config: jsonb("config").notNull(),
    audioS3Key: varchar("audio_s3_key", { length: 500 }),
    audioFormat: varchar("audio_format", { length: 20 }).default("mp3"),
    durationSeconds: integer("duration_seconds"),
    ttsCharCount: integer("tts_char_count").default(0),
    estimatedCost: real("estimated_cost").default(0),
    error: text("error"),
    createdBy: varchar("created_by", { length: 255 }).notNull(),
    sentToAnalysisCallId: text("sent_to_analysis_call_id"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (t) => [
    index("simulated_calls_org_idx").on(t.orgId),
    index("simulated_calls_org_status_idx").on(t.orgId, t.status),
    index("simulated_calls_org_created_idx").on(t.orgId, t.createdAt),
  ],
);

export { performanceSnapshots } from "@shared/schema/snapshots";
export { scheduledReports, scheduledReportConfigs } from "@shared/schema/scheduled-reports";
export { callTags, annotations } from "@shared/schema/call-tags";
export { scoringCorrections } from "@shared/schema/scoring-corrections";
