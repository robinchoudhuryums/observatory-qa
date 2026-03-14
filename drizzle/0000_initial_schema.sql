-- Initial schema migration generated from server/db/schema.ts
-- Creates all tables for the CallAnalyzer multi-tenant platform.

CREATE TABLE IF NOT EXISTS "organizations" (
  "id" text PRIMARY KEY NOT NULL,
  "name" varchar(255) NOT NULL,
  "slug" varchar(100) NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'active',
  "settings" jsonb,
  "created_at" timestamp DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "organizations_slug_idx" ON "organizations" ("slug");

CREATE TABLE IF NOT EXISTS "users" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL REFERENCES "organizations"("id"),
  "username" varchar(100) NOT NULL,
  "password_hash" text NOT NULL,
  "name" varchar(255) NOT NULL,
  "role" varchar(20) NOT NULL DEFAULT 'viewer',
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp DEFAULT now(),
  "last_login_at" timestamp
);

CREATE UNIQUE INDEX IF NOT EXISTS "users_username_idx" ON "users" ("username");
CREATE INDEX IF NOT EXISTS "users_org_id_idx" ON "users" ("org_id");

CREATE TABLE IF NOT EXISTS "employees" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL REFERENCES "organizations"("id"),
  "name" varchar(255) NOT NULL,
  "email" varchar(255) NOT NULL,
  "role" varchar(100),
  "initials" varchar(5),
  "status" varchar(20) DEFAULT 'Active',
  "sub_team" varchar(255),
  "created_at" timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "employees_org_id_idx" ON "employees" ("org_id");
CREATE UNIQUE INDEX IF NOT EXISTS "employees_org_email_idx" ON "employees" ("org_id", "email");

CREATE TABLE IF NOT EXISTS "calls" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL REFERENCES "organizations"("id"),
  "employee_id" text REFERENCES "employees"("id"),
  "file_name" varchar(500),
  "file_path" text,
  "status" varchar(30) NOT NULL DEFAULT 'pending',
  "duration" integer,
  "assembly_ai_id" varchar(255),
  "call_category" varchar(50),
  "tags" jsonb,
  "uploaded_at" timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "calls_org_id_idx" ON "calls" ("org_id");
CREATE INDEX IF NOT EXISTS "calls_org_status_idx" ON "calls" ("org_id", "status");
CREATE INDEX IF NOT EXISTS "calls_employee_id_idx" ON "calls" ("employee_id");
CREATE INDEX IF NOT EXISTS "calls_uploaded_at_idx" ON "calls" ("uploaded_at");

CREATE TABLE IF NOT EXISTS "transcripts" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL REFERENCES "organizations"("id"),
  "call_id" text NOT NULL REFERENCES "calls"("id") ON DELETE CASCADE,
  "text" text,
  "confidence" varchar(20),
  "words" jsonb,
  "created_at" timestamp DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "transcripts_call_id_idx" ON "transcripts" ("call_id");
CREATE INDEX IF NOT EXISTS "transcripts_org_id_idx" ON "transcripts" ("org_id");

CREATE TABLE IF NOT EXISTS "sentiment_analyses" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL REFERENCES "organizations"("id"),
  "call_id" text NOT NULL REFERENCES "calls"("id") ON DELETE CASCADE,
  "overall_sentiment" varchar(20),
  "overall_score" varchar(20),
  "segments" jsonb,
  "created_at" timestamp DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "sentiments_call_id_idx" ON "sentiment_analyses" ("call_id");
CREATE INDEX IF NOT EXISTS "sentiments_org_id_idx" ON "sentiment_analyses" ("org_id");

CREATE TABLE IF NOT EXISTS "call_analyses" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL REFERENCES "organizations"("id"),
  "call_id" text NOT NULL REFERENCES "calls"("id") ON DELETE CASCADE,
  "performance_score" varchar(20),
  "talk_time_ratio" varchar(20),
  "response_time" varchar(20),
  "keywords" jsonb,
  "topics" jsonb,
  "summary" text,
  "action_items" jsonb,
  "feedback" jsonb,
  "lemur_response" jsonb,
  "call_party_type" varchar(50),
  "flags" jsonb,
  "manual_edits" jsonb,
  "confidence_score" varchar(20),
  "confidence_factors" jsonb,
  "sub_scores" jsonb,
  "detected_agent_name" varchar(255),
  "created_at" timestamp DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "analyses_call_id_idx" ON "call_analyses" ("call_id");
CREATE INDEX IF NOT EXISTS "analyses_org_id_idx" ON "call_analyses" ("org_id");
CREATE INDEX IF NOT EXISTS "analyses_performance_idx" ON "call_analyses" ("org_id", "performance_score");

CREATE TABLE IF NOT EXISTS "access_requests" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL REFERENCES "organizations"("id"),
  "name" varchar(255) NOT NULL,
  "email" varchar(255) NOT NULL,
  "reason" text,
  "requested_role" varchar(20) NOT NULL DEFAULT 'viewer',
  "status" varchar(20) NOT NULL DEFAULT 'pending',
  "reviewed_by" varchar(255),
  "reviewed_at" timestamp,
  "created_at" timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "access_requests_org_id_idx" ON "access_requests" ("org_id");
CREATE INDEX IF NOT EXISTS "access_requests_status_idx" ON "access_requests" ("org_id", "status");

CREATE TABLE IF NOT EXISTS "prompt_templates" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL REFERENCES "organizations"("id"),
  "call_category" varchar(50) NOT NULL,
  "name" varchar(255) NOT NULL,
  "evaluation_criteria" text NOT NULL,
  "required_phrases" jsonb,
  "scoring_weights" jsonb,
  "additional_instructions" text,
  "is_active" boolean NOT NULL DEFAULT true,
  "updated_at" timestamp DEFAULT now(),
  "updated_by" varchar(255)
);

CREATE INDEX IF NOT EXISTS "prompt_templates_org_id_idx" ON "prompt_templates" ("org_id");
CREATE INDEX IF NOT EXISTS "prompt_templates_org_category_idx" ON "prompt_templates" ("org_id", "call_category");

CREATE TABLE IF NOT EXISTS "coaching_sessions" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL REFERENCES "organizations"("id"),
  "employee_id" text NOT NULL REFERENCES "employees"("id"),
  "call_id" text REFERENCES "calls"("id"),
  "assigned_by" varchar(255) NOT NULL,
  "category" varchar(50) NOT NULL DEFAULT 'general',
  "title" varchar(500) NOT NULL,
  "notes" text,
  "action_plan" jsonb,
  "status" varchar(20) NOT NULL DEFAULT 'pending',
  "due_date" timestamp,
  "created_at" timestamp DEFAULT now(),
  "completed_at" timestamp
);

CREATE INDEX IF NOT EXISTS "coaching_org_id_idx" ON "coaching_sessions" ("org_id");
CREATE INDEX IF NOT EXISTS "coaching_employee_id_idx" ON "coaching_sessions" ("employee_id");
CREATE INDEX IF NOT EXISTS "coaching_status_idx" ON "coaching_sessions" ("org_id", "status");

CREATE TABLE IF NOT EXISTS "usage_events" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL REFERENCES "organizations"("id"),
  "event_type" varchar(50) NOT NULL,
  "quantity" real NOT NULL DEFAULT 1,
  "metadata" jsonb,
  "created_at" timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "usage_org_type_idx" ON "usage_events" ("org_id", "event_type");
CREATE INDEX IF NOT EXISTS "usage_created_at_idx" ON "usage_events" ("created_at");
