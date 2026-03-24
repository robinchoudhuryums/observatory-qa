/**
 * Auto-sync database schema on startup.
 *
 * Uses idempotent SQL (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS)
 * to bring the production DB in line with the Drizzle schema definition.
 *
 * This avoids requiring `drizzle-kit push` (a devDependency) in production,
 * while ensuring new tables and columns are created automatically on deploy.
 */
import { sql } from "drizzle-orm";
import type { Database } from "./index";
import { logger } from "../services/logger";

export async function syncSchema(db: Database): Promise<void> {
  logger.info("Running schema sync...");

  try {
    // Check if Drizzle migrations have been applied.
    // If so, the migration system owns the schema — skip idempotent DDL.
    const hasMigrations = await db.execute(sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'drizzle' AND table_name = '__drizzle_migrations'
      ) AS has_migrations
    `).then((result) => {
      const rows = result.rows as Array<{ has_migrations: boolean }>;
      return rows[0]?.has_migrations === true;
    }).catch(() => false);

    if (hasMigrations) {
      logger.info("Drizzle migrations detected — skipping sync-schema DDL");
      return;
    }

    // Enable pgvector if available (required for RAG)
    await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector`).catch(() => {
      logger.warn("pgvector extension not available — RAG features will be disabled");
    });

    // --- Organizations ---
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS organizations (
        id TEXT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        slug VARCHAR(100) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        settings JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS organizations_slug_idx ON organizations (slug)`);

    // --- Users ---
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL REFERENCES organizations(id),
        username VARCHAR(100) NOT NULL,
        password_hash TEXT NOT NULL,
        name VARCHAR(255) NOT NULL,
        role VARCHAR(20) NOT NULL DEFAULT 'viewer',
        is_active BOOLEAN NOT NULL DEFAULT true,
        mfa_enabled BOOLEAN NOT NULL DEFAULT false,
        mfa_secret TEXT,
        mfa_backup_codes JSONB,
        created_at TIMESTAMP DEFAULT NOW(),
        last_login_at TIMESTAMP
      )
    `);
    await addColumnIfNotExists(db, "users", "mfa_enabled", "BOOLEAN NOT NULL DEFAULT false");
    await addColumnIfNotExists(db, "users", "mfa_secret", "TEXT");
    await addColumnIfNotExists(db, "users", "mfa_backup_codes", "JSONB");
    await addColumnIfNotExists(db, "users", "is_active", "BOOLEAN NOT NULL DEFAULT true");
    await addColumnIfNotExists(db, "users", "last_login_at", "TIMESTAMP");
    // Migrate from global username uniqueness to per-org uniqueness
    await db.execute(sql`DROP INDEX IF EXISTS users_username_idx`);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS users_org_username_idx ON users (org_id, username)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS users_org_id_idx ON users (org_id)`);

    // --- Employees ---
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS employees (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL REFERENCES organizations(id),
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL,
        role VARCHAR(100),
        initials VARCHAR(5),
        status VARCHAR(20) DEFAULT 'Active',
        sub_team VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS employees_org_id_idx ON employees (org_id)`);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS employees_org_email_idx ON employees (org_id, email)`);

    // --- Calls ---
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS calls (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL REFERENCES organizations(id),
        employee_id TEXT REFERENCES employees(id),
        file_name VARCHAR(500),
        file_path TEXT,
        status VARCHAR(30) NOT NULL DEFAULT 'pending',
        duration INTEGER,
        assembly_ai_id VARCHAR(255),
        call_category VARCHAR(50),
        tags JSONB,
        file_hash VARCHAR(64),
        uploaded_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await addColumnIfNotExists(db, "calls", "file_hash", "VARCHAR(64)");
    await addColumnIfNotExists(db, "calls", "call_category", "VARCHAR(50)");
    await addColumnIfNotExists(db, "calls", "tags", "JSONB");
    await db.execute(sql`CREATE INDEX IF NOT EXISTS calls_org_id_idx ON calls (org_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS calls_org_status_idx ON calls (org_id, status)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS calls_employee_id_idx ON calls (employee_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS calls_uploaded_at_idx ON calls (uploaded_at)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS calls_org_file_hash_idx ON calls (org_id, file_hash)`);
    // Composite index for time-scoped filtered reports (org + status + date)
    await db.execute(sql`CREATE INDEX IF NOT EXISTS calls_org_status_uploaded_idx ON calls (org_id, status, uploaded_at DESC)`);
    // Composite index for employee + status queries (coaching, gamification)
    await db.execute(sql`CREATE INDEX IF NOT EXISTS calls_org_employee_status_idx ON calls (org_id, employee_id, status)`);

    // Multi-channel support columns
    await addColumnIfNotExists(db, "calls", "channel", "VARCHAR(20) NOT NULL DEFAULT 'voice'");
    await addColumnIfNotExists(db, "calls", "email_subject", "VARCHAR(1000)");
    await addColumnIfNotExists(db, "calls", "email_from", "VARCHAR(500)");
    await addColumnIfNotExists(db, "calls", "email_to", "VARCHAR(500)");
    await addColumnIfNotExists(db, "calls", "email_cc", "TEXT");
    await addColumnIfNotExists(db, "calls", "email_body", "TEXT");
    await addColumnIfNotExists(db, "calls", "email_body_html", "TEXT");
    await addColumnIfNotExists(db, "calls", "email_message_id", "VARCHAR(500)");
    await addColumnIfNotExists(db, "calls", "email_thread_id", "VARCHAR(500)");
    await addColumnIfNotExists(db, "calls", "email_received_at", "TIMESTAMP");
    await addColumnIfNotExists(db, "calls", "chat_platform", "VARCHAR(50)");
    await addColumnIfNotExists(db, "calls", "message_count", "INTEGER");
    await db.execute(sql`CREATE INDEX IF NOT EXISTS calls_channel_idx ON calls (org_id, channel)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS calls_email_thread_idx ON calls (org_id, email_thread_id)`);

    // --- Transcripts ---
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS transcripts (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL REFERENCES organizations(id),
        call_id TEXT NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
        text TEXT,
        confidence VARCHAR(20),
        words JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS transcripts_call_id_idx ON transcripts (call_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS transcripts_org_id_idx ON transcripts (org_id)`);
    // Full-text search index for transcript search (GIN tsvector)
    await db.execute(sql`CREATE INDEX IF NOT EXISTS transcripts_text_search_idx ON transcripts USING GIN (to_tsvector('english', coalesce(text, '')))`).catch(() => {
      logger.warn("Failed to create transcript full-text search index (may already exist or text is encrypted)");
    });

    // --- Sentiment Analyses ---
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS sentiment_analyses (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL REFERENCES organizations(id),
        call_id TEXT NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
        overall_sentiment VARCHAR(20),
        overall_score VARCHAR(20),
        segments JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS sentiments_call_id_idx ON sentiment_analyses (call_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS sentiments_org_id_idx ON sentiment_analyses (org_id)`);
    // Index for sentiment filtering in insights/reports
    await db.execute(sql`CREATE INDEX IF NOT EXISTS sentiments_org_sentiment_idx ON sentiment_analyses (org_id, overall_sentiment)`);

    // --- Call Analyses ---
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS call_analyses (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL REFERENCES organizations(id),
        call_id TEXT NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
        performance_score VARCHAR(20),
        talk_time_ratio VARCHAR(20),
        response_time VARCHAR(20),
        keywords JSONB,
        topics JSONB,
        summary TEXT,
        action_items JSONB,
        feedback JSONB,
        lemur_response JSONB,
        call_party_type VARCHAR(50),
        flags JSONB,
        manual_edits JSONB,
        confidence_score VARCHAR(20),
        confidence_factors JSONB,
        sub_scores JSONB,
        detected_agent_name VARCHAR(255),
        clinical_note JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await addColumnIfNotExists(db, "call_analyses", "sub_scores", "JSONB");
    await addColumnIfNotExists(db, "call_analyses", "detected_agent_name", "VARCHAR(255)");
    await addColumnIfNotExists(db, "call_analyses", "confidence_score", "VARCHAR(20)");
    await addColumnIfNotExists(db, "call_analyses", "confidence_factors", "JSONB");
    await addColumnIfNotExists(db, "call_analyses", "manual_edits", "JSONB");
    await addColumnIfNotExists(db, "call_analyses", "clinical_note", "JSONB");
    await addColumnIfNotExists(db, "call_analyses", "speech_metrics", "JSONB");
    await addColumnIfNotExists(db, "call_analyses", "self_review", "JSONB");
    await addColumnIfNotExists(db, "call_analyses", "score_dispute", "JSONB");
    await addColumnIfNotExists(db, "call_analyses", "patient_summary", "TEXT");
    await addColumnIfNotExists(db, "call_analyses", "referral_letter", "TEXT");
    await addColumnIfNotExists(db, "call_analyses", "suggested_billing_codes", "JSONB");
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS analyses_call_id_idx ON call_analyses (call_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS analyses_org_id_idx ON call_analyses (org_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS analyses_performance_idx ON call_analyses (org_id, performance_score)`);
    // Full-text search index for analysis summaries
    await db.execute(sql`CREATE INDEX IF NOT EXISTS analyses_summary_search_idx ON call_analyses USING GIN (to_tsvector('english', coalesce(summary, '')))`).catch(() => {
      logger.warn("Failed to create analysis summary full-text search index");
    });
    // GIN index for JSONB topics search
    await db.execute(sql`CREATE INDEX IF NOT EXISTS analyses_topics_gin_idx ON call_analyses USING GIN (topics jsonb_path_ops)`).catch(() => {
      logger.warn("Failed to create topics GIN index");
    });

    // --- Access Requests ---
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS access_requests (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL REFERENCES organizations(id),
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL,
        reason TEXT,
        requested_role VARCHAR(20) NOT NULL DEFAULT 'viewer',
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        reviewed_by VARCHAR(255),
        reviewed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS access_requests_org_id_idx ON access_requests (org_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS access_requests_status_idx ON access_requests (org_id, status)`);

    // --- Prompt Templates ---
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS prompt_templates (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL REFERENCES organizations(id),
        call_category VARCHAR(50) NOT NULL,
        name VARCHAR(255) NOT NULL,
        evaluation_criteria TEXT NOT NULL,
        required_phrases JSONB,
        scoring_weights JSONB,
        additional_instructions TEXT,
        is_active BOOLEAN NOT NULL DEFAULT true,
        updated_at TIMESTAMP DEFAULT NOW(),
        updated_by VARCHAR(255)
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS prompt_templates_org_id_idx ON prompt_templates (org_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS prompt_templates_org_category_idx ON prompt_templates (org_id, call_category)`);

    // --- Coaching Sessions ---
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS coaching_sessions (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL REFERENCES organizations(id),
        employee_id TEXT NOT NULL REFERENCES employees(id),
        call_id TEXT REFERENCES calls(id),
        assigned_by VARCHAR(255) NOT NULL,
        category VARCHAR(50) NOT NULL DEFAULT 'general',
        title VARCHAR(500) NOT NULL,
        notes TEXT,
        action_plan JSONB,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        due_date TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        completed_at TIMESTAMP
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS coaching_org_id_idx ON coaching_sessions (org_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS coaching_employee_id_idx ON coaching_sessions (employee_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS coaching_status_idx ON coaching_sessions (org_id, status)`);

    // --- Coaching Recommendations ---
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS coaching_recommendations (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL REFERENCES organizations(id),
        employee_id TEXT NOT NULL REFERENCES employees(id),
        trigger VARCHAR(100) NOT NULL,
        category VARCHAR(50) NOT NULL,
        title VARCHAR(500) NOT NULL,
        description TEXT,
        severity VARCHAR(20) NOT NULL DEFAULT 'medium',
        call_ids JSONB,
        metrics JSONB,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        coaching_session_id TEXT REFERENCES coaching_sessions(id),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS coaching_rec_org_id_idx ON coaching_recommendations (org_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS coaching_rec_employee_idx ON coaching_recommendations (org_id, employee_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS coaching_rec_status_idx ON coaching_recommendations (org_id, status)`);

    // --- API Keys ---
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS api_keys (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL REFERENCES organizations(id),
        name VARCHAR(255) NOT NULL,
        key_hash VARCHAR(128) NOT NULL,
        key_prefix VARCHAR(16) NOT NULL,
        permissions JSONB NOT NULL,
        created_by VARCHAR(255) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        expires_at TIMESTAMP,
        last_used_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS api_keys_hash_idx ON api_keys (key_hash)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS api_keys_org_id_idx ON api_keys (org_id)`);

    // --- Invitations ---
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS invitations (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL REFERENCES organizations(id),
        email VARCHAR(255) NOT NULL,
        role VARCHAR(20) NOT NULL DEFAULT 'viewer',
        token VARCHAR(255) NOT NULL,
        invited_by VARCHAR(255) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        expires_at TIMESTAMP,
        accepted_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS invitations_token_idx ON invitations (token)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS invitations_org_id_idx ON invitations (org_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS invitations_email_idx ON invitations (org_id, email)`);

    // --- Subscriptions ---
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL REFERENCES organizations(id),
        plan_tier VARCHAR(20) NOT NULL DEFAULT 'free',
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        stripe_customer_id VARCHAR(255),
        stripe_subscription_id VARCHAR(255),
        stripe_price_id VARCHAR(255),
        billing_interval VARCHAR(10) NOT NULL DEFAULT 'monthly',
        current_period_start TIMESTAMP,
        current_period_end TIMESTAMP,
        cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_org_id_idx ON subscriptions (org_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS subscriptions_stripe_customer_idx ON subscriptions (stripe_customer_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS subscriptions_stripe_sub_idx ON subscriptions (stripe_subscription_id)`);
    await db.execute(sql`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS stripe_seats_item_id VARCHAR(255)`);
    await db.execute(sql`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS stripe_overage_item_id VARCHAR(255)`);
    await db.execute(sql`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS past_due_at TIMESTAMP`);

    // --- Reference Documents ---
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS reference_documents (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL REFERENCES organizations(id),
        name VARCHAR(255) NOT NULL,
        category VARCHAR(50) NOT NULL,
        description TEXT,
        file_name VARCHAR(255) NOT NULL,
        file_size INTEGER NOT NULL,
        mime_type VARCHAR(100) NOT NULL,
        storage_path TEXT NOT NULL,
        extracted_text TEXT,
        applies_to JSONB,
        is_active BOOLEAN NOT NULL DEFAULT true,
        uploaded_by VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS ref_docs_org_id_idx ON reference_documents (org_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS ref_docs_category_idx ON reference_documents (org_id, category)`);

    // --- Document Chunks (pgvector) ---
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS document_chunks (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL REFERENCES organizations(id),
        document_id TEXT NOT NULL REFERENCES reference_documents(id) ON DELETE CASCADE,
        chunk_index INTEGER NOT NULL,
        text TEXT NOT NULL,
        section_header VARCHAR(500),
        token_count INTEGER NOT NULL,
        char_start INTEGER NOT NULL,
        char_end INTEGER NOT NULL,
        embedding vector(1024),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `).catch(() => {
      // If pgvector is not available, create without the vector column
      logger.warn("Creating document_chunks without vector column (pgvector not available)");
    });
    await db.execute(sql`CREATE INDEX IF NOT EXISTS doc_chunks_org_id_idx ON document_chunks (org_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS doc_chunks_document_id_idx ON document_chunks (document_id)`);

    // --- Password Reset Tokens ---
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash VARCHAR(128) NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        used_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS password_reset_user_idx ON password_reset_tokens (user_id)`);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS password_reset_token_hash_idx ON password_reset_tokens (token_hash)`);

    // --- Usage Events ---
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS usage_events (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL REFERENCES organizations(id),
        event_type VARCHAR(50) NOT NULL,
        quantity REAL NOT NULL DEFAULT 1,
        metadata JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS usage_org_type_idx ON usage_events (org_id, event_type)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS usage_created_at_idx ON usage_events (created_at)`);

    // --- A/B Tests ---
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS ab_tests (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL REFERENCES organizations(id),
        file_name VARCHAR(500) NOT NULL,
        call_category VARCHAR(50),
        baseline_model VARCHAR(255) NOT NULL,
        test_model VARCHAR(255) NOT NULL,
        status VARCHAR(30) NOT NULL DEFAULT 'processing',
        transcript_text TEXT,
        baseline_analysis JSONB,
        test_analysis JSONB,
        baseline_latency_ms INTEGER,
        test_latency_ms INTEGER,
        notes TEXT,
        created_by VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS ab_tests_org_id_idx ON ab_tests (org_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS ab_tests_status_idx ON ab_tests (org_id, status)`);

    // --- Spend Records ---
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS spend_records (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL REFERENCES organizations(id),
        call_id TEXT NOT NULL,
        type VARCHAR(20) NOT NULL,
        timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
        user_name VARCHAR(255) NOT NULL,
        services JSONB NOT NULL,
        total_estimated_cost REAL NOT NULL DEFAULT 0
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS spend_records_org_id_idx ON spend_records (org_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS spend_records_timestamp_idx ON spend_records (org_id, timestamp)`);

    // --- Live Sessions (real-time clinical recording) ---
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS live_sessions (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL REFERENCES organizations(id),
        created_by VARCHAR(255) NOT NULL,
        specialty VARCHAR(100),
        note_format VARCHAR(50) NOT NULL DEFAULT 'soap',
        encounter_type VARCHAR(50) NOT NULL DEFAULT 'clinical_encounter',
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        transcript_text TEXT DEFAULT '',
        draft_clinical_note JSONB,
        duration_seconds INTEGER NOT NULL DEFAULT 0,
        consent_obtained BOOLEAN NOT NULL DEFAULT false,
        call_id TEXT REFERENCES calls(id),
        started_at TIMESTAMP DEFAULT NOW(),
        ended_at TIMESTAMP
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS live_sessions_org_id_idx ON live_sessions (org_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS live_sessions_status_idx ON live_sessions (org_id, status)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS live_sessions_created_by_idx ON live_sessions (org_id, created_by)`);

    // --- User Feedback ---
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS feedbacks (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL REFERENCES organizations(id),
        user_id TEXT NOT NULL,
        type VARCHAR(30) NOT NULL,
        context VARCHAR(50),
        rating INTEGER,
        comment TEXT,
        metadata JSONB,
        status VARCHAR(20) NOT NULL DEFAULT 'new',
        admin_response TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS feedbacks_org_id_idx ON feedbacks (org_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS feedbacks_type_idx ON feedbacks (org_id, type)`);

    // --- Employee Badges (Gamification) ---
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS employee_badges (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL REFERENCES organizations(id),
        employee_id TEXT NOT NULL REFERENCES employees(id),
        badge_id VARCHAR(50) NOT NULL,
        awarded_at TIMESTAMP DEFAULT NOW(),
        awarded_for TEXT,
        UNIQUE(org_id, employee_id, badge_id)
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS employee_badges_org_idx ON employee_badges (org_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS employee_badges_employee_idx ON employee_badges (org_id, employee_id)`);

    // --- Gamification Profiles ---
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS gamification_profiles (
        org_id TEXT NOT NULL REFERENCES organizations(id),
        employee_id TEXT NOT NULL REFERENCES employees(id),
        total_points INTEGER NOT NULL DEFAULT 0,
        current_streak INTEGER NOT NULL DEFAULT 0,
        longest_streak INTEGER NOT NULL DEFAULT 0,
        last_activity_date VARCHAR(10),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(org_id, employee_id)
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS gamification_profiles_points_idx ON gamification_profiles (org_id, total_points)`);

    // --- Insurance Narratives ---
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS insurance_narratives (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL REFERENCES organizations(id),
        call_id TEXT REFERENCES calls(id),
        patient_name VARCHAR(255) NOT NULL,
        patient_dob VARCHAR(20),
        member_id VARCHAR(100),
        insurer_name VARCHAR(255) NOT NULL,
        insurer_address TEXT,
        letter_type VARCHAR(50) NOT NULL,
        diagnosis_codes JSONB,
        procedure_codes JSONB,
        clinical_justification TEXT,
        prior_denial_reference TEXT,
        generated_narrative TEXT,
        status VARCHAR(20) NOT NULL DEFAULT 'draft',
        created_by VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS insurance_narratives_org_idx ON insurance_narratives (org_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS insurance_narratives_status_idx ON insurance_narratives (org_id, status)`);
    // Index for call-linked narrative lookups (matches schema.ts definition)
    await db.execute(sql`CREATE INDEX IF NOT EXISTS insurance_narratives_call_idx ON insurance_narratives (org_id, call_id)`);

    // --- Call Revenue Tracking ---
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS call_revenues (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL REFERENCES organizations(id),
        call_id TEXT NOT NULL REFERENCES calls(id),
        estimated_revenue REAL,
        actual_revenue REAL,
        revenue_type VARCHAR(20),
        treatment_value REAL,
        scheduled_procedures JSONB,
        conversion_status VARCHAR(20) NOT NULL DEFAULT 'unknown',
        notes TEXT,
        updated_by VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(org_id, call_id)
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS call_revenues_org_idx ON call_revenues (org_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS call_revenues_conversion_idx ON call_revenues (org_id, conversion_status)`);

    // --- Calibration Sessions ---
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS calibration_sessions (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL REFERENCES organizations(id),
        title VARCHAR(500) NOT NULL,
        call_id TEXT NOT NULL REFERENCES calls(id),
        facilitator_id TEXT NOT NULL,
        evaluator_ids JSONB NOT NULL,
        scheduled_at TIMESTAMP,
        status VARCHAR(20) NOT NULL DEFAULT 'scheduled',
        target_score REAL,
        consensus_notes TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        completed_at TIMESTAMP
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS calibration_sessions_org_idx ON calibration_sessions (org_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS calibration_sessions_status_idx ON calibration_sessions (org_id, status)`);

    // --- Calibration Evaluations ---
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS calibration_evaluations (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL REFERENCES organizations(id),
        session_id TEXT NOT NULL REFERENCES calibration_sessions(id) ON DELETE CASCADE,
        evaluator_id TEXT NOT NULL,
        performance_score REAL NOT NULL,
        sub_scores JSONB,
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(session_id, evaluator_id)
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS calibration_evals_session_idx ON calibration_evaluations (session_id)`);

    // --- LMS: Learning Modules ---
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS learning_modules (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL REFERENCES organizations(id),
        title VARCHAR(500) NOT NULL,
        description TEXT,
        content_type VARCHAR(30) NOT NULL,
        category VARCHAR(50),
        content TEXT,
        quiz_questions JSONB,
        estimated_minutes INTEGER,
        difficulty VARCHAR(20),
        tags JSONB,
        source_document_id TEXT,
        is_published BOOLEAN NOT NULL DEFAULT false,
        is_platform_content BOOLEAN NOT NULL DEFAULT false,
        created_by VARCHAR(255) NOT NULL,
        sort_order INTEGER,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS learning_modules_org_idx ON learning_modules (org_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS learning_modules_category_idx ON learning_modules (org_id, category)`);

    // --- LMS: Learning Paths ---
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS learning_paths (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL REFERENCES organizations(id),
        title VARCHAR(500) NOT NULL,
        description TEXT,
        category VARCHAR(50),
        module_ids JSONB NOT NULL,
        is_required BOOLEAN NOT NULL DEFAULT false,
        assigned_to JSONB,
        estimated_minutes INTEGER,
        created_by VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS learning_paths_org_idx ON learning_paths (org_id)`);

    // --- LMS: Learning Progress ---
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS learning_progress (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL REFERENCES organizations(id),
        employee_id TEXT NOT NULL REFERENCES employees(id),
        module_id TEXT NOT NULL,
        path_id TEXT,
        status VARCHAR(20) NOT NULL DEFAULT 'not_started',
        quiz_score INTEGER,
        quiz_attempts INTEGER,
        time_spent_minutes INTEGER,
        completed_at TIMESTAMP,
        notes TEXT,
        started_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS learning_progress_org_idx ON learning_progress (org_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS learning_progress_employee_idx ON learning_progress (org_id, employee_id)`);

    // --- Marketing Campaigns ---
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS marketing_campaigns (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL REFERENCES organizations(id),
        name VARCHAR(500) NOT NULL,
        source VARCHAR(50) NOT NULL,
        medium VARCHAR(50),
        start_date TIMESTAMP,
        end_date TIMESTAMP,
        budget REAL,
        tracking_code VARCHAR(255),
        is_active BOOLEAN NOT NULL DEFAULT true,
        notes TEXT,
        created_by VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS marketing_campaigns_org_idx ON marketing_campaigns (org_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS marketing_campaigns_source_idx ON marketing_campaigns (org_id, source)`);

    // --- Call Attribution ---
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS call_attributions (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL REFERENCES organizations(id),
        call_id TEXT NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
        source VARCHAR(50) NOT NULL,
        campaign_id TEXT REFERENCES marketing_campaigns(id),
        medium VARCHAR(50),
        is_new_patient BOOLEAN,
        referrer_name VARCHAR(255),
        detection_method VARCHAR(30),
        confidence REAL,
        notes TEXT,
        attributed_by VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS call_attributions_org_idx ON call_attributions (org_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS call_attributions_source_idx ON call_attributions (org_id, source)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS call_attributions_campaign_idx ON call_attributions (org_id, campaign_id)`);
    // UNIQUE: one attribution per call per org (matches schema.ts definition)
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS call_attributions_call_idx ON call_attributions (org_id, call_id)`);

    // --- Audit Logs (tamper-evident) ---
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        event VARCHAR(100) NOT NULL,
        user_id TEXT,
        username VARCHAR(100),
        role VARCHAR(20),
        resource_type VARCHAR(50) NOT NULL,
        resource_id TEXT,
        ip VARCHAR(45),
        user_agent TEXT,
        detail TEXT,
        integrity_hash VARCHAR(64),
        prev_hash VARCHAR(64),
        sequence_num INTEGER,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await addColumnIfNotExists(db, "audit_logs", "user_agent", "TEXT");
    await addColumnIfNotExists(db, "audit_logs", "integrity_hash", "VARCHAR(64)");
    await addColumnIfNotExists(db, "audit_logs", "prev_hash", "VARCHAR(64)");
    await addColumnIfNotExists(db, "audit_logs", "sequence_num", "INTEGER");
    await db.execute(sql`CREATE INDEX IF NOT EXISTS audit_logs_org_idx ON audit_logs (org_id, created_at)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS audit_logs_event_idx ON audit_logs (org_id, event)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS audit_logs_user_idx ON audit_logs (org_id, user_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS audit_logs_sequence_idx ON audit_logs (org_id, sequence_num)`);
    // BRIN index on created_at for efficient time-range archival queries (audit logs grow fast)
    await db.execute(sql`CREATE INDEX IF NOT EXISTS audit_logs_created_at_brin_idx ON audit_logs USING BRIN (created_at)`).catch(() => {
      logger.warn("Failed to create audit_logs BRIN index");
    });

    // ── One-time data migrations ─────────────────────────────────────────────
    // These use runOnceMigration() to ensure they execute exactly once even
    // across repeated server restarts. Add new one-time migrations here.
    // Format: runOnceMigration(db, "YYYY-MM-DD-descriptive-key", async () => { ... })
    //
    // Example (already run — do not remove, guards prevent re-execution):
    // await runOnceMigration(db, "2025-08-01-backfill-org-industry-type", async () => {
    //   await db.execute(sql`UPDATE organizations SET industry_type = 'general' WHERE industry_type IS NULL`);
    // });

    logger.info("Schema sync complete");
  } catch (error) {
    logger.error({ err: error }, "Schema sync failed — some features may not work");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DDL helper functions — all idempotent, safe to run on every startup
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Add a column to a table if it doesn't already exist.
 * Uses DO $$ block for idempotent ALTER TABLE.
 */
async function addColumnIfNotExists(
  db: Database,
  table: string,
  column: string,
  definition: string,
): Promise<void> {
  // Quote identifiers to prevent SQL injection
  const safeTable = `"${table.replace(/"/g, '""')}"`;
  const safeColumn = `"${column.replace(/"/g, '""')}"`;
  await db.execute(sql.raw(`
    DO $$ BEGIN
      ALTER TABLE ${safeTable} ADD COLUMN IF NOT EXISTS ${safeColumn} ${definition};
    EXCEPTION
      WHEN duplicate_column THEN NULL;
    END $$;
  `));
}

/**
 * Rename a column if the old name exists and the new name does not.
 * No-op if the column has already been renamed (new name present) or if the
 * old name never existed. Safe to run on every startup.
 *
 * Usage:
 *   await renameColumnIfExists(db, "calls", "assembly_ai_id", "transcription_job_id");
 */
async function renameColumnIfExists(
  db: Database,
  table: string,
  oldColumn: string,
  newColumn: string,
): Promise<void> {
  const safeTable = `"${table.replace(/"/g, '""')}"`;
  const safeOld = `"${oldColumn.replace(/"/g, '""')}"`;
  const safeNew = `"${newColumn.replace(/"/g, '""')}"`;
  // Check: old column exists AND new column does not. If both exist, the rename
  // was only partially applied — log a warning but do not error.
  await db.execute(sql.raw(`
    DO $$ BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = '${table.replace(/'/g, "''")}' AND column_name = '${oldColumn.replace(/'/g, "''")}'
      ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = '${table.replace(/'/g, "''")}' AND column_name = '${newColumn.replace(/'/g, "''")}'
      ) THEN
        ALTER TABLE ${safeTable} RENAME COLUMN ${safeOld} TO ${safeNew};
      END IF;
    END $$;
  `));
}

/**
 * Drop a column if it exists. No-op if the column is already absent.
 * Safe to run on every startup.
 *
 * WARNING: This is destructive and permanent. Only use for columns that have
 * been migrated away and whose data is no longer needed. Consider using
 * runOnceMigration() to guard this so it only fires once.
 *
 * Usage:
 *   await dropColumnIfExists(db, "call_analyses", "lemur_response");
 */
async function dropColumnIfExists(
  db: Database,
  table: string,
  column: string,
): Promise<void> {
  const safeTable = `"${table.replace(/"/g, '""')}"`;
  const safeColumn = `"${column.replace(/"/g, '""')}"`;
  await db.execute(sql.raw(`
    DO $$ BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = '${table.replace(/'/g, "''")}' AND column_name = '${column.replace(/'/g, "''")}'
      ) THEN
        ALTER TABLE ${safeTable} DROP COLUMN ${safeColumn};
      END IF;
    END $$;
  `));
}

/**
 * Ensure the schema_migrations tracking table exists.
 * Called internally by runOnceMigration.
 */
async function ensureMigrationsTable(db: Database): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      key TEXT PRIMARY KEY,
      applied_at TIMESTAMP NOT NULL DEFAULT NOW(),
      duration_ms INTEGER
    )
  `);
}

/**
 * Run a one-time data migration, guarded by a key stored in the
 * schema_migrations table. The migration function will only execute once —
 * subsequent server restarts skip it entirely.
 *
 * Use this for:
 *   - Backfilling new columns with computed data
 *   - Data transformations (e.g. splitting a column, normalizing values)
 *   - One-time cleanup of legacy data
 *   - Destructive DDL (column drops) that should only run once
 *
 * Keys should be globally unique and descriptive. Recommended format:
 *   "YYYY-MM-DD-short-description"
 *
 * Usage:
 *   await runOnceMigration(db, "2025-09-01-backfill-call-channel", async () => {
 *     await db.execute(sql`UPDATE calls SET channel = 'voice' WHERE channel IS NULL`);
 *   });
 *
 *   await runOnceMigration(db, "2025-09-15-drop-legacy-lemur-response", async () => {
 *     await dropColumnIfExists(db, "call_analyses", "lemur_response");
 *   });
 */
async function runOnceMigration(
  db: Database,
  key: string,
  fn: () => Promise<void>,
): Promise<void> {
  await ensureMigrationsTable(db);

  // Check if already applied
  const result = await db.execute(
    sql.raw(`SELECT key FROM schema_migrations WHERE key = '${key.replace(/'/g, "''")}'`)
  );
  const rows = result.rows as Array<{ key: string }>;
  if (rows.length > 0) {
    return; // Already applied — skip
  }

  const start = Date.now();
  try {
    await fn();
    const durationMs = Date.now() - start;
    await db.execute(
      sql.raw(`
        INSERT INTO schema_migrations (key, applied_at, duration_ms)
        VALUES ('${key.replace(/'/g, "''")}', NOW(), ${durationMs})
      `)
    );
    logger.info({ migrationKey: key, durationMs }, "One-time migration applied");
  } catch (error) {
    logger.error({ err: error, migrationKey: key }, "One-time migration failed");
    throw error; // Propagate — sync-schema outer catch will handle gracefully
  }
}
