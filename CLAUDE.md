# Observatory QA — AI-Powered Call Quality Analysis Platform

## Project Overview
Observatory QA is a multi-tenant, HIPAA-compliant SaaS platform for call quality analysis. Organizations upload call recordings, which are transcribed by AssemblyAI and analyzed by AI (AWS Bedrock Claude) for performance scoring, compliance, sentiment analysis, and coaching insights. Includes a RAG knowledge base for grounding AI analysis in each organization's own documentation.

**Product origin**: Evolved from a single-tenant internal tool (CallAnalyzer for UMS) into a multi-tenant SaaS product. The multi-tenant transformation plan is documented in `MULTI_TENANT_TRANSFORMATION_PLAN.md`.

**Healthcare expansion**: The platform is expanding into clinical documentation (AI scribe) and EHR integrations, initially targeting dental practices. The roadmap is documented in `HEALTHCARE_EXPANSION_PLAN.md`.

## Tech Stack
- **Frontend**: React 18 + TypeScript, Vite, TailwindCSS 3, shadcn/ui, Recharts, Wouter (routing), TanStack Query, Framer Motion
- **Backend**: Express.js + TypeScript (ESM), Node.js
- **Database**: PostgreSQL (via Drizzle ORM) — recommended for production SaaS
- **AI Analysis**: AWS Bedrock (Claude Sonnet) via `ai-factory.ts`
- **Transcription**: AssemblyAI
- **RAG**: pgvector for vector similarity search, Amazon Titan Embed V2 for embeddings, BM25 keyword boosting
- **Object Storage**: AWS S3 — for audio files and blob storage
- **Job Queues**: BullMQ (Redis-backed) — audio processing, reanalysis, retention, usage metering, document indexing
- **Sessions & Rate Limiting**: Redis (connect-redis, ioredis) — falls back to in-memory when unavailable
- **Billing**: Stripe (subscriptions, checkout, customer portal, webhooks)
- **Logging**: Pino + Betterstack (@logtail/pino) for structured log aggregation
- **Auth**: Passport.js (local strategy + Google OAuth 2.0 + SAML 2.0 SSO + OIDC SSO), session-based, role-based (viewer/manager/admin), MFA (TOTP + WebAuthn/Passkeys), SCIM 2.0 provisioning
- **Hosting**: EC2 with Caddy (production HIPAA), Render.com (staging/non-PHI)
- **Font**: Poppins (primary), Inter (fallback) — chosen to match Observatory logo typeface

## Local Development Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create a `.env` file (see `.env.example`):
   - **Required**: `ASSEMBLYAI_API_KEY`, `SESSION_SECRET`
   - **Auth users**: `AUTH_USERS` — format: `username:password:role:displayName:orgSlug` (comma-separated for multiple)
   - **Storage backend** (pick one):
     - `STORAGE_BACKEND=postgres` + `DATABASE_URL` — recommended for SaaS (requires PostgreSQL + pgvector extension)
     - `S3_BUCKET` — S3-backed JSON file storage (original single-tenant approach)
     - No config → **in-memory storage (data lost on restart, dev only)**
   - **AI provider**:
     - `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` — for Bedrock (Claude)
   - **Optional**: `REDIS_URL` (enables distributed sessions, rate limiting, job queues), `DATABASE_URL` (PostgreSQL)

3. Start the dev server:
   ```bash
   npm run dev   # Starts on port 5000 (or $PORT) with Vite HMR + tsx watch
   ```

4. (Optional) Start background workers:
   ```bash
   npm run workers   # Requires REDIS_URL — processes async jobs
   ```

## Commands
```bash
npm run dev            # Dev server (tsx watch)
npm run build          # Vite frontend + esbuild backend → dist/
npm run start          # Production server (NODE_ENV=production node dist/index.js)
npm run check          # TypeScript type check
npm run test           # Run tests (tsx --test tests/*.test.ts)
npm run test:coverage  # Run tests with c8 coverage (text + lcov → coverage/)
npm run test:e2e       # Run Playwright E2E tests (requires dev server running)
npm run test:e2e:ui    # Open Playwright interactive UI
npm run lint           # ESLint (server, shared, client)
npm run lint:fix       # ESLint with auto-fix
npm run format         # Prettier write
npm run format:check   # Prettier check (CI uses this)
npm run seed           # Seed data (tsx seed.ts)
npm run workers        # Start BullMQ worker processes (requires REDIS_URL)
npm run workers:build  # Build workers → dist/workers.js
npm run db:generate    # Generate Drizzle migration files
npm run db:migrate     # Run Drizzle migrations (tsx server/db/migrate.ts)
npm run db:push        # Push schema to DB (drizzle-kit push)
npm run db:studio      # Open Drizzle Studio (DB GUI)
npx vite build         # Frontend-only build (quick verification)
```

## Testing
- **Unit tests**: Node.js built-in `test` module via `tsx` — `npm run test`
- **E2E tests**: Playwright (Chromium) — `npm run test:e2e` or `npm run test:e2e:ui`
- **Location**: `tests/` (unit), `tests/e2e/` (E2E)
- **Unit test files** (72 files, 1414 tests):
  - `tests/schema.test.ts` — Zod schema validation (orgId on all entities, organization schemas)
  - `tests/ai-provider.test.ts` — AI provider utilities (parseJsonResponse, buildAnalysisPrompt, smartTruncate)
  - `tests/routes.test.ts` — API route handler tests
  - `tests/auth-routes.test.ts` — Auth route handler tests
  - `tests/multitenant.test.ts` — Cross-org data isolation verification
  - `tests/rbac.test.ts` — Role-based access control
  - `tests/pipeline.test.ts` — Audio processing pipeline
  - `tests/call-pipeline.test.ts` — Call processing pipeline
  - `tests/user-management.test.ts` — User CRUD, invitations
  - `tests/registration.test.ts` — Self-service org registration
  - `tests/api-keys.test.ts` — API key auth
  - `tests/billing.test.ts` — Stripe subscription & quota enforcement
  - `tests/usage.test.ts` — Usage metering
  - `tests/notifications.test.ts` — Webhook notifications
  - `tests/webhook.test.ts` — Webhook delivery
  - `tests/audit-log.test.ts` — HIPAA audit logging
  - `tests/chunker.test.ts` — Document chunking
  - `tests/rag-features.test.ts` — RAG Knowledge Base improvements (versioning, citations, indexing status, URL sources)
  - `tests/clinical-templates.test.ts` — Clinical note templates
  - `tests/clinical-validation.test.ts` — Clinical data validation
  - `tests/clinical-workflow.test.ts` — Clinical documentation workflow
  - `tests/coaching-engine.test.ts` — Coaching recommendation engine
  - `tests/calibration-improvements.test.ts` — Calibration improvements (blind mode, IRR metrics, certification)
  - `tests/ehr.test.ts` — EHR integration adapters
  - `tests/error-codes.test.ts` — Error code system
  - `tests/ab-testing-improvements.test.ts` — A/B testing improvements (t-test, batch, segments, recommendations)
  - `tests/spend-tracking-improvements.test.ts` — Spend tracking improvements (forecasting, anomalies, budget, departments)
  - `tests/gamification-improvements.test.ts` — Gamification improvements (opt-out, recognition badges, effectiveness, teams)
  - `tests/lms-improvements.test.ts` — LMS improvements (prerequisites, deadlines, certificates, coaching recommendations)
  - `tests/revenue-improvements.test.ts` — Revenue improvements (attribution funnel, payer mix, forecasting, EHR sync)
  - `tests/insurance-narrative-improvements.test.ts` — Insurance narrative improvements (outcomes, denial analysis, deadlines, payer templates)
  - `tests/error-handling.test.ts` — Error handling patterns
  - `tests/phi-encryption.test.ts` — PHI field encryption
  - `tests/speaker-detection.test.ts` — Auto speaker role detection (greeting patterns, AI name match, edge cases)
  - `tests/rag-pipeline.test.ts` — RAG pipeline integration (chunking ratios, injection guardrails, chunker safety)
  - `tests/clinical-amendments.test.ts` — Amendment/addendum workflow (schema, persistence, conflict detection, multi-chain, isolation)
  - `tests/lms-prereq-enforce.test.ts` — LMS prerequisites, enforceOrder, deadlines, passing scores
  - `tests/sso.test.ts` — SAML SSO
  - `tests/validation.test.ts` — Input validation
  - `tests/load-simulation.test.ts` — Load simulation (5 orgs × 200 calls, concurrent operations, data isolation)
  - `tests/admin-routes.test.ts` — Admin route handler tests
  - `tests/cross-org-isolation.test.ts` — Deep cross-org data isolation (user, coaching, prompt template, analysis, API key)
  - `tests/calls-routes.test.ts` — Call route handler tests
  - `tests/clinical-routes.test.ts` — Clinical route handler tests
  - `tests/insurance-narratives.test.ts` — Insurance narrative CRUD and workflow
  - `tests/lms.test.ts` — LMS module and path CRUD
  - `tests/marketing.test.ts` — Marketing campaign and attribution CRUD
  - `tests/load-pipeline.test.ts` — Call processing pipeline step sequencing
  - `tests/phi-decryption-failure.test.ts` — PHI decryption failure modes (key rotation, tamper detection)
  - `tests/sync-schema.test.ts` — Auto schema sync table coverage verification
  - `tests/websocket.test.ts` — WebSocket infrastructure
  - `tests/bedrock-rate-limit.test.ts` — Bedrock rate limiting and circuit breaker
  - `tests/health-endpoints.test.ts` — Health check endpoints
  - `tests/http-integration.test.ts` — HTTP-level integration tests
  - `tests/input-validation.test.ts` — Input validation edge cases
  - `tests/external-api-failures.test.ts` — External API failure handling
  - `tests/newer-routes.test.ts` — Newer feature route tests
  - `tests/queue-dlq.test.ts` — Job queue and dead letter queue
  - `tests/upload-errors.test.ts` — Upload error handling
  - `tests/upload-race-condition.test.ts` — Upload race condition prevention
  - `tests/validation-middleware.test.ts` — Validation middleware tests
  - `tests/webhook-retry.test.ts` — Webhook retry logic
  - `tests/audit-fixes.test.ts` — Audit fix verification (prompt injection, PHI redaction, LRU cache, RAG config, upload dedup, output guardrails)
  - `tests/schema-column-coverage.test.ts` — Schema sync column-level validation (Drizzle vs sync-schema DDL)
  - `tests/bedrock-mock.test.ts` — AI provider mock tests (score clamping, error codes, behavior switching)
  - `tests/language-sentiment-skip.test.ts` — Language-aware sentiment skipping (non-English cost optimization, 8 tests)
  - `tests/default-templates.test.ts` — Default industry template seeding (JSON validation, scoring weights, org isolation, 33 tests)
  - `tests/confidence-filter.test.ts` — Confidence as first-class filter (dashboard metrics, data quality breakdown, boundary values, MemStorage, 8 tests)
  - `tests/call-clustering.test.ts` — Call clustering (TF-IDF, cosine similarity, agglomerative clustering, trend detection, 15 tests)
  - `tests/bedrock-batch.test.ts` — Bedrock batch inference (shouldUseBatchMode, isBatchAvailable, org settings validation, 15 tests)
  - `tests/prompt-injection-pipeline.test.ts` — Transcript injection detection + output guardrails + orphan recovery (16 tests)
  - `tests/remaining-adaptations.test.ts` — Performance snapshots, SSRF validation, scheduled reports (21 tests)
  - `tests/rag-ums-adaptations.test.ts` — RAG improvements adapted from ums-knowledge-reference: adaptive query-type weights, confidence reconciliation, domain synonym expansion, table-aware chunking, page tracking, cross-org FAQ patterns, structured short-circuit, query reformulation, response styles (49 tests)
- **E2E test files** (12 specs):
  - `tests/e2e/fixtures.ts` — **Per-worker auth fixtures** (`adminTest`, `viewerTest`) — each worker registers unique org via `/api/auth/register`; falls back to env-var admin
  - `tests/e2e/auth.spec.ts` — Login, landing page
  - `tests/e2e/navigation.spec.ts` — Navigation flows
  - `tests/e2e/rbac.spec.ts` — Role-based access (uses `viewerTest` fixture)
  - `tests/e2e/dashboard.spec.ts` — Dashboard metrics
  - `tests/e2e/upload.spec.ts` — File upload
  - `tests/e2e/coaching.spec.ts` — Coaching sessions
  - `tests/e2e/search.spec.ts` — Call search
  - `tests/e2e/clinical.spec.ts` — Clinical notes
  - `tests/e2e/settings.spec.ts` — User settings
  - `tests/e2e/admin.spec.ts` — Admin panel
  - `tests/e2e/logout.spec.ts` — Logout flow
  - `tests/e2e/api-health.spec.ts` — Health endpoint
  - `tests/e2e/security.spec.ts` — Security boundaries (auth enforcement, RBAC escalation, CSRF, session fixation, rate limiting)
- **E2E auth pattern**: Import `{ adminTest as test, expect } from "./fixtures"` (or `viewerTest`) for authenticated tests. Each Playwright **worker** registers its own unique org via `/api/auth/register` (slug: `e2e-w{workerIndex}-{ts}`), preventing state pollution between parallel spec files. Falls back to env-var `admin:admin123` if registration fails. Tests use `data-testid` selectors for stability.

## Architecture

### Key Directories
```
client/src/pages/            # Route pages (34 pages)
client/src/components/       # UI components
  ui/                        #   shadcn/ui primitives
  dashboard/                 #   Dashboard cards (metrics-overview, sentiment-analysis, performance-card)
  tables/                    #   Data tables (calls-table)
  transcripts/               #   Transcript viewer
  search/                    #   Search components (employee-filter, call-card)
  upload/                    #   File upload (file-upload) with before-unload warning
  audio/                     #   Audio components (audio-waveform: canvas-based amplitude visualization with click-to-seek)
  layout/                    #   Layout (sidebar)
  lib/                       #   Utilities (confirm-dialog, error-boundary)
  branding-provider.tsx      #   Per-org branding context
  owl-loading.tsx            #   Custom owl-themed loading animation (liquid fill CSS)
  onboarding-tour.tsx        #   Interactive product tour (6 steps, localStorage-persistent)
  feedback-widget.tsx        #   Floating feedback button (bottom-right), auto-detects page context
  idle-timeout-overlay.tsx   #   HIPAA session timeout warning overlay (countdown + stay-logged-in)

client/src/hooks/            # Custom React hooks
  use-idle-timeout.ts        #   15-min idle timeout with 2-min warning, auto-logout on expiry

client/src/lib/              # Client utilities
  display-utils.ts           #   toDisplayString() — safe AI response value rendering
  error-reporting.ts         #   Sentry client-side integration + HIPAA PHI sanitization

server/
  index.ts                   # App entry: Express setup, middleware, startup sequence
  auth.ts                    # Passport.js auth, session management, org context middleware
  vite.ts                    # Vite dev server integration + static serving
  utils.ts                   # Shared server utilities
  types.d.ts                 # Express type augmentations
  logger.ts                  # (Legacy) Logger — prefer server/services/logger.ts

server/routes/               # Modular API route files (38 route files)
  index.ts                   #   Route registration orchestrator
  auth.ts                    #   Login/logout/me (trusted-device cookie check, grace period logic)
  registration.ts            #   Self-service org + user registration (supports industryType)
  oauth.ts                   #   Google OAuth 2.0 flow
  sso.ts                     #   SAML 2.0 + OIDC SSO (per-org IDP, IDP-initiated, group-role map, SLO, cert rotation)
  scim.ts                    #   SCIM 2.0 user provisioning (create/update/deactivate/delete, Bearer token auth)
  mfa.ts                     #   MFA: TOTP setup/verify/disable + WebAuthn/Passkeys + trusted devices + email OTP + recovery
  password-reset.ts          #   Forgot-password + reset-password flow
  onboarding.ts              #   Logo upload, reference doc upload, RAG search, branding
  calls.ts                   #   Call CRUD, upload, audio streaming, transcript/sentiment/analysis + clinical notes
  employees.ts               #   Employee CRUD, CSV import
  dashboard.ts               #   Metrics, sentiment distribution, top performers
  reports.ts                 #   Summary/filtered reports, agent profiles
  coaching.ts                #   Coaching session CRUD
  admin.ts                   #   User management, prompt templates, org settings
  access.ts                  #   Access request flow
  api-keys.ts                #   API key CRUD + middleware
  billing.ts                 #   Stripe checkout, portal, webhooks, quota enforcement
  insights.ts                #   Aggregate insights & trends
  export.ts                  #   CSV export for calls, employees, performance data
  health.ts                  #   Health check endpoint
  helpers.ts                 #   Shared route utilities
  clinical.ts                #   Clinical documentation: notes, attestation, style learning, templates
  ehr.ts                     #   EHR integration: patient lookup, appointment sync, note push
  ab-testing.ts              #   A/B model testing: upload, dual-model comparison, cost tracking
  spend-tracking.ts          #   Usage/cost visibility: per-call spend breakdown
  feedback.ts                #   User feedback: submit, list, summary, NPS calculation
  gamification.ts            #   Gamification: leaderboard, badges, employee profiles, points
  insurance-narratives.ts    #   Insurance narrative drafting: prior auth, appeals, medical necessity
  revenue.ts                 #   Revenue tracking: per-call dollar values, conversion status, metrics
  calibration.ts             #   Calibration sessions: multi-evaluator QA alignment, variance tracking
  call-insights.ts           #   Call-level insights and trend analysis
  emails.ts                  #   Email management: templates, send history, email analytics
  live-session.ts            #   Real-time live call session support (AssemblyAI real-time)
  lms.ts                     #   Learning Management System: courses, lessons, AI-generated training
  marketing.ts               #   Lead tracking (renamed from marketing): call source attribution, campaign ROI
  benchmarks.ts              #   QA benchmarking: anonymized cross-org performance percentiles by industry
  patient-journey.ts         #   Patient journey analytics: multi-visit patient tracking, retention, sentiment trends
  super-admin.ts             #   Platform-level admin (cross-org management, SUPER_ADMIN_USERS)
  assemblyai-webhook.ts      #   AssemblyAI transcription webhook receiver (POST /api/webhooks/assemblyai)
  baa.ts                     #   Business Associate Agreement CRUD (HIPAA §164.502(e)), expiry alerts
  clinical-compliance.routes.ts  #   Extracted: amendments, FHIR R4 export, co-signatures
  clinical-analytics.routes.ts   #   Extracted: style learning, population analytics, prefill, custom templates
  admin-security.routes.ts   #   Extracted: audit logs, WAF, incidents, breach reports, GDPR, vocab, MFA recovery

server/services/             # Business logic & integrations (46 files)
  ai-factory.ts              #   AI provider setup (Bedrock, per-org model config, circuit breaker)
  ai-provider.ts             #   AI analysis interface, prompt building, JSON parsing, clinical note generation
  ai-prompts.ts              #   System/user prompt construction for Bedrock Converse API
  ai-types.ts                #   AI response type definitions, flag validation schemas
  bedrock.ts                 #   AWS Bedrock Claude provider (raw REST + SigV4, Converse API, prompt caching, retry with jitter)
  bedrock-batch.ts           #   AWS Bedrock batch inference: pending items → S3 → batch job → poll → complete (50% cost savings)
  assemblyai.ts              #   AssemblyAI transcription + transcript processing. TranscriptionOptions: webhookUrl, wordBoost, piiRedaction, languageDetection. continueAfterTranscription() for webhook/polling dual-path
  assemblyai-realtime.ts     #   AssemblyAI real-time streaming transcription
  call-processing.ts         #   Core audio pipeline: upload → transcribe → analyze → store → notify. Handles polling/webhook/batch modes
  call-clustering.ts         #   TF-IDF cosine similarity topic clustering + trend detection for call pattern discovery
  auto-calibration.ts        #   AI score drift detection over configurable time windows (per-org)
  aws-credentials.ts         #   AWS credential resolution (env vars, instance roles, STS)
  s3.ts                      #   S3 client (raw REST + SigV4, no AWS SDK)
  redis.ts                   #   Redis connection, session store, rate limiter, pub/sub
  queue.ts                   #   BullMQ queue definitions (6 queues: audio-processing, reanalysis, retention, usage, indexing, ehr-note-push)
  websocket.ts               #   WebSocket for real-time call processing updates (org-scoped, Redis pub/sub for multi-instance)
  stripe.ts                  #   Stripe SDK integration
  logger.ts                  #   Pino structured logging + Betterstack transport
  audit-log.ts               #   HIPAA audit logging (PHI access events, tamper-evident hash chain)
  notifications.ts           #   Webhook notifications for flagged calls (Slack/Teams)
  embeddings.ts              #   Amazon Titan Embed V2 via Bedrock (1024-dim vectors), two-tier cache (LRU + Redis)
  rag.ts                     #   RAG orchestrator (chunk → embed → pgvector search → BM25 rerank, adaptive query-type weights, synonym expansion)
  rag-worker.ts              #   In-process RAG indexing fallback (when BullMQ unavailable)
  chunker.ts                 #   Document chunking (sliding window, natural breaks, section detection, table preservation, page tracking)
  phi-encryption.ts          #   AES-256-GCM field-level encryption for PHI data
  email.ts                   #   Transactional email (AWS SES API, SMTP, console fallback)
  error-codes.ts             #   Standardized error codes (OBS-{DOMAIN}-{NUMBER})
  coaching-engine.ts         #   Auto-recommendations and AI coaching plan generation
  clinical-templates.ts      #   Pre-built clinical note templates (10+ specialties, multiple formats)
  clinical-validation.ts     #   Clinical note field validation and completeness scoring
  clinical-extraction.ts     #   Structured data extraction from clinical notes (vitals, medications, allergies)
  style-learning.ts          #   Provider style analysis — auto-detect note preferences from history
  scoring-calibration.ts     #   Cross-evaluator scoring calibration and variance analysis
  sentry.ts                  #   Sentry server-side error tracking with HIPAA PHI sanitization
  telemetry.ts               #   OpenTelemetry setup (traces, metrics — enabled via OTEL_ENABLED=true)
  incident-response.ts       #   Automated incident detection and response workflows
  proactive-alerts.ts        #   Proactive performance/compliance alerting engine
  fhir.ts                    #   FHIR R4 export builder (Composition, DocumentReference, Bundle)
  org-encryption.ts          #   Per-org KMS envelope encryption: getOrgDataKey, encryptFieldForOrg, decryptFieldForOrg
  rag-trace.ts               #   RAG pipeline observability: per-query timing breakdown, confidence metrics, injection audit trail
  faq-analytics.ts           #   FAQ detection from RAG query patterns: query normalization, gap analysis, confidence distribution
  embedding-provider.ts      #   EmbeddingProvider interface for swappable embedding models (default: Titan Embed V2)
  performance-snapshots.ts   #   Longitudinal performance analytics with AI narrative summaries (employee/team/company snapshots)
  scheduled-reports.ts       #   Periodic report generation (weekly/monthly) with top/bottom performer rankings
  cost-estimation.ts         #   Pure math: estimateBedrockCost(), estimateAssemblyAICost() — no external deps
  dashboard-cache.ts         #   Dashboard Redis cache invalidation (extracted from routes/dashboard.ts)
  telephony-ingestion.ts     #   Pluggable telephony auto-ingestion framework (webhook + polling, scaffolded for RingCentral/8x8/Twilio/Five9)

server/middleware/           # Express middleware
  waf.ts                     #   Web Application Firewall (request filtering, bot detection)
  error-handler.ts           #   Global error handler (AppError, asyncHandler wrapper, HIPAA-safe messages)
  tracing.ts                 #   OpenTelemetry request tracing (trace IDs, span attributes)
  correlation-id.ts          #   Per-request correlation ID via AsyncLocalStorage
  validate.ts                #   Zod-based request body/query/params validation middleware

server/utils/                # Shared server utilities
  helpers.ts                 #   Pure utility functions (safeFloat, safeInt, withRetry, parseDateParam, parsePagination) — safe to import from services layer
  url-validation.ts          #   SSRF prevention: blocks private IPs, cloud metadata, non-HTTP protocols (legacy, see also url-validator.ts)
  url-validator.ts           #   Comprehensive SSRF URL validation: protocol enforcement, hostname blocklist, private IP blocking, DNS rebinding prevention
  ai-guardrails.ts           #   Prompt injection detection (25 patterns + NFKD Unicode normalization + HTML entity decoding + comment stripping), output safety checks, 10KB input truncation
  phi-redactor.ts            #   PHI regex scrubber (SSN, phone, email, MRN, addresses, NPI, FHIR UUIDs, encounter IDs; preserves clinical codes)
  request-metrics.ts         #   In-memory per-route latency percentiles (p50/p95/p99, 10-min window)
  lru-cache.ts               #   TTL-aware LRU cache utility (replaces FIFO Map pattern in 3+ locations)

server/scheduled/            # Wall-clock scheduled background tasks
  index.ts                   #   Barrel exports + runAllDailyTasks() orchestrator (single listOrganizations call, per-task error isolation)
  scheduler.ts               #   scheduleDaily(utcHour, fn) and scheduleWeekly(dayOfWeek, utcHour, fn) — setTimeout chains, no drift
  retention.ts               #   Data retention purge (per-org retentionDays)
  trial-downgrade.ts         #   Trial subscription auto-downgrade to free
  quota-alerts.ts            #   Proactive quota usage alerts (80%/100% thresholds)
  weekly-digest.ts           #   Weekly performance/coaching digest to webhook
  audit-chain-verify.ts      #   Nightly HIPAA audit chain integrity verification
  coaching-tasks.ts          #   Coaching automation rules, effectiveness caching, follow-up reminders

server/services/ehr/         # EHR integration adapters (11 files)
  types.ts                   #   IEhrAdapter interface, EhrPatient, EhrAppointment, EhrClinicalNote, EhrTreatmentPlan, EhrHealthStatus
  index.ts                   #   EHR adapter factory (5 adapters: open_dental, eaglesoft, dentrix, fhir_r4, mock)
  open-dental.ts             #   Open Dental adapter (bidirectional: patient lookup, note push, treatment plans)
  eaglesoft.ts               #   Eaglesoft/Patterson eDex adapter (bidirectional with eDex v2+)
  dentrix.ts                 #   Dentrix Ascend / G7 adapter (bidirectional)
  fhir-r4.ts                 #   Generic FHIR R4-compliant server adapter (bidirectional)
  mock.ts                    #   Development/demo adapter (returns fixture data)
  request.ts                 #   Shared HTTP request utilities for EHR adapters
  secrets-manager.ts         #   AWS Secrets Manager credential resolution (falls back to PHI-encrypted apiKey)
  health-monitor.ts          #   Periodic EHR connection health checks (runs in worker process every 15 min)
  appointment-matcher.ts     #   Call-to-appointment matching logic

server/storage/              # Storage abstraction layer
  types.ts                   #   IStorage interface (all methods org-scoped)
  index.ts                   #   Storage backend factory (postgres > S3 > memory)
  cloud.ts                   #   CloudStorage implementation (S3 JSON files)
  memory.ts                  #   MemStorage (in-memory, dev only)

server/db/                   # PostgreSQL (Drizzle ORM)
  schema.ts                  #   Table definitions (20+ tables + pgvector document_chunks)
  index.ts                   #   Database connection initialization
  migrate.ts                 #   Migration runner
  pg-storage.ts              #   PostgresStorage core (org/user/employee/call CRUD, dashboards, search, audio, coaching, refs, subscriptions, RLS helpers)
  pg-storage-features.ts     #   PostgresStorage feature methods via prototype mixin (A/B tests, LMS, gamification, revenue, calibration, marketing, BAA, provider templates, deleteOrg)
  pg-storage-confidence.ts   #   PostgresStorage confidence metrics mixin (overrides getDashboardMetrics/getTopPerformers for avgConfidence, dataQuality breakdown)
  sync-schema.ts             #   Idempotent schema sync on startup (CREATE IF NOT EXISTS)

server/workers/              # BullMQ worker processes (run separately)
  index.ts                   #   Worker entry point — starts all workers + EHR health monitor
  retention.worker.ts        #   Data retention purge (per-org)
  usage.worker.ts            #   Usage event recording
  reanalysis.worker.ts       #   Bulk call re-analysis
  indexing.worker.ts         #   RAG document indexing (chunk + embed)
  ehr-note-push.worker.ts    #   Retry failed EHR note pushes (5 attempts, exponential backoff → DLQ)

shared/schema.ts             # Zod schemas + TypeScript types (shared client/server) — barrel re-export from:
shared/schema/org.ts         #   Organization, user, employee schemas
shared/schema/calls.ts       #   Call, transcript, analysis schemas
shared/schema/billing.ts     #   Billing/subscription schemas, plan definitions
shared/schema/features.ts    #   Feature-specific schemas (selfReview, dispute, callReferral, etc.)
data/dental/                 # Dental-specific reference data
  default-prompt-templates.json  # 5 dental call categories with evaluation criteria
  dental-terminology-reference.md  # CDT codes, insurance terminology, coverage tiers
deploy/ec2/                  # EC2 deployment config (Caddy, systemd, bootstrap script)
tests/                       # Unit tests (27 files, Node test runner)
tests/e2e/                   # Playwright E2E tests (11 spec files)
```

### Frontend Pages
| Page | Route | Description |
|------|-------|-------------|
| `landing.tsx` | `/` | Public landing / marketing page |
| `auth.tsx` | `/auth` | Login + registration forms (supports industry type selection) |
| `onboarding.tsx` | `/onboarding` | Post-registration org setup wizard |
| `invite-accept.tsx` | `/invite/:token` | Accept team invitation |
| `dashboard.tsx` | `/dashboard` | Main dashboard with KPIs |
| `transcripts.tsx` | `/transcripts` | Call list + transcript viewer |
| `upload.tsx` | `/upload` | Audio file upload |
| `employees.tsx` | `/employees` | Employee roster management |
| `coaching.tsx` | `/coaching` | Coaching session management |
| `reports.tsx` | `/reports` | Reports with date filtering |
| `performance.tsx` | `/performance` | Performance metrics & trends |
| `sentiment.tsx` | `/sentiment` | Sentiment analysis views |
| `search.tsx` | `/search` | Full-text call search |
| `insights.tsx` | `/insights` | Aggregate insights & trends |
| `prompt-templates.tsx` | `/prompt-templates` | AI prompt template management |
| `admin.tsx` | `/admin` | User management, org settings |
| `settings.tsx` | `/settings` | User preferences (dark mode, etc.) |
| `clinical-dashboard.tsx` | `/clinical` | Clinical documentation dashboard (metrics, attestation rates, trends) |
| `clinical-notes.tsx` | `/clinical/notes/:callId` | View/edit clinical notes, attestation workflow, consent |
| `clinical-templates.tsx` | `/clinical/templates` | Browse pre-built clinical note templates by specialty/format |
| `clinical-upload.tsx` | `/clinical/upload` | Upload clinical encounter audio for note generation |
| `ab-testing.tsx` | `/ab-testing` | A/B model comparison (upload audio, dual-model analysis, cost tracking) |
| `spend-tracking.tsx` | `/spend-tracking` | Usage & cost visibility (per-call spend breakdown) |
| `feedback.tsx` | `/admin/feedback` | Admin feedback dashboard: NPS, feature ratings, bug reports |
| `gamification.tsx` | `/gamification` | Leaderboard, badges, employee achievement profiles |
| `insurance-narratives.tsx` | `/insurance-narratives` | Insurance letter drafting: prior auth, appeals, medical necessity |
| `revenue.tsx` | `/revenue` | Revenue tracking: per-call dollar values, conversion metrics |
| `calibration.tsx` | `/calibration` | QA calibration sessions: multi-evaluator scoring alignment |
| `learning.tsx` | `/learning` | Learning Management System: courses, lessons, training content |
| `marketing.tsx` | `/marketing` | Lead tracking: call source attribution, campaign ROI |
| `emails.tsx` | `/emails` | Email management: templates, send history, analytics |
| `clinical-live.tsx` | `/clinical/live` | Live clinical session: real-time transcription + note generation |
| `audit-logs.tsx` | `/admin/audit-logs` | HIPAA audit log viewer |
| `not-found.tsx` | `*` | 404 page |

### Multi-Tenant Data Model
Every data entity has an `orgId` field. All storage methods take `orgId` as the first parameter. Data isolation is enforced at the storage layer — no method can access data without specifying the org.

**Schemas in `shared/schema.ts`**:
- `Organization` — id, name, slug, status, industryType, settings (departments, subTeams, branding, AI config, quotas, ehrConfig, providerStylePreferences). SSO settings: `ssoProvider` (saml|oidc), `ssoEntityId`, `ssoSignOnUrl`, `ssoCertificate`, `ssoEnforced`, `ssoGroupRoleMap` (group→role map), `ssoGroupAttribute`, `ssoSessionMaxHours`, `ssoLogoutUrl`, `ssoCertificateExpiry` (auto-computed), `ssoNewCertificate` (rotation dual-cert), `ssoNewCertificateExpiry`. OIDC: `oidcDiscoveryUrl`, `oidcClientId`, `oidcClientSecret`. SCIM: `scimEnabled`, `scimTokenHash`, `scimTokenPrefix`. MFA: `mfaRequired`, `mfaGracePeriodDays` (default 7), `mfaRequiredEnabledAt`.
- `User` — id, orgId, username, passwordHash, name, role, mfaEnabled, mfaSecret (encrypted), mfaBackupCodes[], webauthnCredentials[] (credentialId/publicKey/counter/transports/name), mfaTrustedDevices[] (tokenHash/name/expiresAt), mfaEnrollmentDeadline
- `Employee` — id, orgId, name, email, role, initials, status, subTeam
- `Call` — id, orgId, employeeId, fileName, status, duration, callCategory, tags
- `Transcript` — id, orgId, callId, text, confidence, words[]
- `SentimentAnalysis` — id, orgId, callId, overallSentiment, overallScore, segments[]
- `CallAnalysis` — id, orgId, callId, performanceScore, subScores, summary, topics, feedback, flags, clinicalNote (optional)
- `ClinicalNote` — embedded in CallAnalysis: format (SOAP/DAP/BIRP/HPI/procedure), specialty, subjective, objective, assessment, plan, HPI, ROS, differentialDiagnoses, icd10Codes, cptCodes, cdtCodes, toothNumbers, periodontalFindings, treatmentPhases, providerAttested, attestedBy, editHistory, consentObtained, documentationCompleteness (0-10), clinicalAccuracy (0-10), `amendments[]` — array of post-attestation amendment snapshots (reason, changedBy, timestamp, fieldsChanged), `cosignature` — supervising provider co-signature (signedBy, signedAt, providerName, credentials), `cosignatureRequired` — boolean flag, `structuredData` — extracted vitals (BP, HR, RR, temp, O2sat, pain, weight), medications[], allergies[], `qualityScoreBreakdown` — icd10Specificity, requiredElementsPresent, planDiagnosisAlignment, overallQuality (all 0-10)
- `ABTest` — id, orgId, fileName, baselineModel, testModel, transcriptText, baselineAnalysis, testAnalysis, baselineLatencyMs, testLatencyMs, status, createdBy, `batchId` (text, groups tests in a batch upload)
- `UsageRecord` — id, orgId, callId, type (transcription/ai_analysis/ab-test), services (assemblyai/bedrock cost breakdown), totalEstimatedCost
- `AccessRequest` — id, orgId, name, email, requestedRole, status
- `CoachingSession` — id, orgId, employeeId, callId, category, title, notes, actionPlan, status
- `PromptTemplate` — id, orgId, callCategory, evaluationCriteria, requiredPhrases, scoringWeights
- `Invitation` — id, orgId, email, role, token, status, expiresAt
- `ApiKey` — id, orgId, name, keyHash, keyPrefix, permissions, status
- `Subscription` — id, orgId, planTier, status, stripeCustomerId, billingInterval
- `ReferenceDocument` — id, orgId, name, category, fileName, extractedText, appliesTo, isActive, `version` (integer, monotonically increasing), `previousVersionId` (text, links to prior version), `indexingStatus` (pending/indexing/indexed/failed), `indexingError` (text), `sourceType` (upload/url), `sourceUrl` (text), `retrievalCount` (integer, auto-incremented on RAG retrieval)
- `Feedback` — id, orgId, userId, type (feature_rating/bug_report/suggestion/nps/general), context (page/feature), rating (1-10), comment, metadata, status, adminResponse
- `EmployeeBadge` — id, orgId, employeeId, badgeId, awardedAt, awardedFor. 12 badge definitions: milestone (first_call, ten_calls, hundred_calls), performance (perfect_score, high_performer, consistency_king), improvement (most_improved, comeback_kid), engagement (self_reviewer, coaching_champion), streak (streak_7, streak_30)
- `InsuranceNarrative` — id, orgId, callId, patientName, insurerName, letterType (prior_auth/appeal/predetermination/medical_necessity/peer_to_peer), diagnosisCodes, procedureCodes, clinicalJustification, generatedNarrative, status (draft/finalized/submitted), `outcome` (approved/denied/partial_approval/pending/withdrawn), `outcomeDate`, `outcomeNotes`, `denialCode`, `denialReason`, `submissionDeadline`, `deadlineAcknowledged`, `payerTemplate`, `supportingDocuments` (JSONB checklist array)
- `CallRevenue` — id, orgId, callId, estimatedRevenue, actualRevenue, revenueType (production/collection/scheduled/lost), treatmentValue, scheduledProcedures, conversionStatus (converted/pending/lost/unknown), `attributionStage` (call_identified/appointment_scheduled/appointment_completed/treatment_accepted/payment_collected), `appointmentDate`, `appointmentCompleted`, `treatmentAccepted`, `paymentCollected`, `payerType` (insurance/cash/mixed/unknown), `insuranceCarrier`, `insuranceAmount`, `patientAmount`, `ehrSyncedAt`
- `CalibrationSession` — id, orgId, title, callId, facilitatorId, evaluatorIds, status (scheduled/in_progress/completed), targetScore, consensusNotes, `blindMode` (boolean, evaluators can't see others' scores until session completed)
- `CalibrationEvaluation` — id, orgId, sessionId, evaluatorId, performanceScore, subScores, notes

**Industry types** (set at registration): `general`, `dental`, `medical`, `behavioral_health`, `veterinary`

**Plan tiers** (defined statically in `shared/schema.ts`):
| Plan | Price | Calls/mo | Overage | Storage | Base Seats | RAG | Clinical Docs | SSO |
|------|-------|----------|---------|---------|------------|-----|---------------|-----|
| Free | $0 | 50 | Hard block | 500 MB | 2 | No | No | No |
| Starter | $79/mo | 300 | $0.35/call | 5 GB | 5 (+$15/seat) | Yes | +$49/mo add-on | No |
| Professional | $199/mo | 1,000 | $0.25/call | 20 GB | 10 (+$20/seat) | Yes | Included | No |
| Enterprise | $999/mo | 5,000 | $0.15/call | 500 GB | 25 (+$25/seat) | Yes | Included | Yes |

### Audio Processing Pipeline (server/routes/calls.ts)
1. Upload audio file (multer) — requires active subscription
2. Archive to S3 (non-blocking — continues with warning on failure, tags call `audio_missing` if S3 fails)
3. Send to AssemblyAI for transcription (polling until complete)
4. **Empty transcript guard**: If transcript text is <10 chars, save with `empty_transcript` flag and skip AI analysis (prevents junk results)
5. Load org's custom prompt template by call category (falls back to default)
6. If RAG enabled: retrieve relevant document chunks from pgvector (min relevance score 0.3), inject into AI prompt
7. Send transcript + context to AI provider (Bedrock) for analysis
8. **Validate & normalize AI response**: Type-check all fields, clamp scores to valid ranges (0-10 for performance, 0-1 for sentiment), safe defaults for missing fields
9. **Server-side flag enforcement**: Auto-add `low_score` flag if performance ≤2.0, `exceptional_call` if ≥9.0 (overrides AI)
10. If clinical documentation plan: generate clinical note (SOAP/DAP/BIRP/procedure) with PHI encryption, use lower of AI vs server-computed completeness score
11. Store transcript, sentiment, and analysis (+ clinical note if applicable)
12. Auto-assign call to employee if agent name detected — **only active employees**, skips if ambiguous (multiple matches, no exact full-name match)
13. Track usage with cost estimates (transcription + AI analysis events)
14. Send webhook notification if call flagged
15. WebSocket notification to org clients (orgId required)

**On failure**: Call status → "failed", WebSocket notifies client, uploaded file cleaned up. Errors logged without stack traces (HIPAA). No automatic retry — users re-upload.

### RAG (Retrieval-Augmented Generation) System
Reference documents uploaded by orgs are processed through:
1. **Text extraction** — extracted on upload (PDF/text content)
2. **Chunking** (`chunker.ts`) — sliding window with overlap (400 tokens, 80 token overlap), natural break detection (paragraph > sentence > line via `lastIndexOf`), section header tracking (markdown, ALL CAPS, numbered "1.2.3", colon-suffixed), **table preservation** (pipe/tab-delimited tables kept as single chunks), **page number tracking** (via form feed markers). Configurable `charsPerToken` ratio: 3.5 for medical/dental (clinical codes are dense), 4.0 for general text. Minimum step of 40 chars prevents micro-chunks
3. **Embedding** (`embeddings.ts`) — Amazon Titan Embed V2 via Bedrock (1024 dimensions, raw REST + SigV4). **Two-tier cache**: in-memory LRU (200 entries) + Redis shared cache (1-hour TTL) for multi-instance cost reduction
4. **Storage** — chunks + embeddings stored in `document_chunks` table (pgvector)
5. **Retrieval** (`rag.ts`) — hybrid search: pgvector cosine similarity (HNSW index) + BM25 keyword boosting with log-linear normalization. **Adaptive query-type weights**: queries classified as `template_lookup` (40/60 semantic/keyword), `compliance_question` (55/45), `coaching_question` (75/25), or `general` (70/30). **Domain synonym expansion** per industry vertical (dental, medical, behavioral health, veterinary) for improved BM25 recall on abbreviations. Minimum relevance score threshold (0.3) filters low-quality chunks
6. **Injection** — relevant chunks formatted with XML `<knowledge_source>` tags (prompt injection defense) and injected into the AI analysis prompt
7. **Confidence reconciliation** — retrieval scores reconciled with LLM-stated confidence tags: downgrades overconfident LLM responses when retrieval is weak, upgrades conservative responses when retrieval is strong (`reconcileConfidence()`)
8. **Observability** (`rag-trace.ts`) — per-query traces with timing breakdown (embedding/retrieval/rerank), per-chunk IDs and scores, query type classification, weight tracking, confidence reconciliation status
9. **FAQ analytics** (`faq-analytics.ts`) — per-org query frequency tracking with knowledge base gap detection. **Cross-org anonymized patterns** for platform-level intelligence (requires 3+ orgs asking same question to prevent de-anonymization)

10. **Structured short-circuit** (`rag.ts`) — `classifyQueryRoute()` detects pure metadata queries (template criteria, document counts) and `getStructuredAnswer()` answers directly from the database, skipping the full RAG pipeline (2-4 second savings)
11. **Query reformulation** (`rag.ts`) — `reformulateWithContext()` detects follow-up questions (short + pronoun patterns) and prepends conversation context for standalone embedding/search
12. **Bedrock prompt caching** (`bedrock.ts`) — `cachePoint` block in Converse API system prompt enables up to 90% input token cost reduction on cache hits
13. **Response style configuration** (`rag.ts`) — `RESPONSE_STYLE_CONFIG` with concise (2K tokens, 4 chunks), detailed (4K, 6, default), comprehensive (8K, 10). RAG search endpoint accepts `responseStyle` parameter

RAG requires: PostgreSQL with pgvector extension + AWS credentials for Titan embeddings. Document indexing can run via BullMQ worker or in-process fallback.

### Storage Backend Selection (server/storage/index.ts)
Priority order:
1. `STORAGE_BACKEND=postgres` + `DATABASE_URL` → **PostgresStorage** (Drizzle ORM, recommended)
2. `STORAGE_BACKEND=s3` or `S3_BUCKET` → **CloudStorage** (S3 JSON files)
3. No config → **MemStorage** (in-memory, data lost on restart)

PostgreSQL + S3 hybrid: When using PostgresStorage, set `S3_BUCKET` alongside `DATABASE_URL` for audio blob storage in S3 while structured data lives in PostgreSQL.

### Job Queue System (BullMQ)
Six queues, all Redis-backed with fallback to in-process execution:
| Queue | Purpose | Retries |
|-------|---------|---------|
| `audio-processing` | Transcription + AI analysis pipeline | 2 (exponential backoff) |
| `bulk-reanalysis` | Re-analyze all calls for an org | 1 |
| `data-retention` | Purge expired calls per org policy | 3 |
| `usage-metering` | Track per-org usage events for billing | 3 |
| `document-indexing` | RAG indexing (chunk + embed) | 2 |
| `ehr-note-push` | Retry failed EHR clinical note pushes | 5 (exponential backoff → DLQ) |

Workers run as a separate process: `npm run workers` (dev) or `node dist/workers.js` (prod).

### AI Provider System (server/services/ai-factory.ts)
Uses AWS Bedrock (Claude) for AI analysis. Per-org `bedrockModel` can be configured via org's `OrgSettings`. The provider implements the `AIAnalysisProvider` interface defined in `ai-provider.ts`. Per-org providers are cached to avoid re-creation on every call.

## Systems Map

This section provides a verified dependency map and data flow overview of the codebase. It is maintained by running `/systems-map` and updated via `/sync-docs`.

### Module Dependency Overview (Highest Fan-Out)

These modules are imported by the most consumers. Changes here have the widest blast radius:

| Module | Key Exports | Consumer Count | Notes |
|--------|-------------|----------------|-------|
| `server/storage/index.ts` | `storage`, `initPostgresStorage`, `objectStorage`, `IStorage`, `normalizeAnalysis` | 56 | 38 route files, 9 services, 2 db files, auth.ts, index.ts. Workers access via dynamic `require()`. Scheduled tasks receive storage as a parameter, not via singleton import |
| `shared/schema.ts` (barrel) | Types, Zod schemas, `PLAN_DEFINITIONS`, `CALL_CATEGORIES` | 50+ | Routes, services, storage, client pages. Workers get types indirectly via queue job interfaces |
| `server/auth.ts` | `requireAuth`, `injectOrgContext`, `requireOrgContext`, `requireRole`, `getTeamScopedEmployeeIds`, `sessionMiddleware`, `resolveUserOrgId` | 36 | All authenticated route files + websocket. Applied per-route (not globally in index.ts) |
| `server/services/audit-log.ts` | `logPhiAccess`, `auditContext`, `queryAuditLogs`, `exportAuditLogs`, `verifyAuditChain` | 35 | 32 route files + auth.ts + incident-response.ts + retention.worker.ts |
| `server/services/call-processing.ts` | `processAudioFile`, `continueAfterTranscription`, `invalidateRefDocCache`, `cleanupFile`, `computeConfidence`, `autoAssignEmployee`, `mapClinicalNote` | 2 | routes/calls.ts, routes/assemblyai-webhook.ts. Low consumer count but highest internal complexity (14+ deps) |
| `server/services/phi-encryption.ts` | `encryptField`, `decryptField`, `decryptClinicalNotePhi`, `isPhiEncryptionEnabled`, `encryptMfaSecret`, `decryptMfaSecret` | 12 | Clinical routes (3), calls, mfa, ehr, live-session, pg-storage, call-processing, ehr-note-push worker, ehr/health-monitor, ehr/appointment-matcher |
| `server/services/ai-factory.ts` | `aiProvider`, `getOrgAIProvider`, `getBedrockCircuitState`, `withBedrockProtection`, `acquireBedrockSlot`, `releaseBedrockSlot` | 11 | call-processing, coaching-engine, clinical, call-insights, reports, insurance-narratives, lms, health, admin, live-session, emails |
| `server/services/logger.ts` | `logger` | All | Every server file |

### Key Inter-Module Dependencies

```
call-processing.ts → {assemblyai, ai-factory, rag, phi-encryption, websocket,
                       dashboard-cache, notifications, proactive-alerts, queue,
                       scoring-calibration, clinical-validation, clinical-extraction,
                       cost-estimation, storage, bedrock-batch, ai-prompts}

rag.ts → {chunker, embeddings, db/schema, ai-guardrails, phi-redactor, rag-trace, faq-analytics}

ai-factory.ts → {bedrock, ai-provider, lru-cache}
  ↑ consumed by: call-processing, clinical, call-insights, reports, insurance-narratives,
                  lms, health, admin, live-session, coaching-engine, emails

websocket.ts → {auth (sessionMiddleware, resolveUserOrgId), redis (publishMessage, getSubscriberClient)}
  ↑ consumed by: call-processing, calls, live-session, emails, ab-testing, admin
```

### Data Flow: Call Upload → Analysis Completion

```
1. POST /api/calls/upload [routes/calls.ts]
   ├─ requireAuth → injectOrgContext → requireOrgContext → requireActiveSubscription → enforceQuota
   ├─ handleUpload (multer wrapper with file-size/type error handling)
   ├─ acquireUploadSlot(orgId) — concurrency limiter
   ├─ SHA-256 file hash (streaming) → storage.getCallByFileHash() dedup check
   ├─ acquireUploadLock() — TOCTOU race prevention
   ├─ storage.createCall() → releaseUploadLock() (fire-and-forget)
   ├─ reportCallOverageToStripe() (fire-and-forget, if over quota)
   ├─ processAudioFile() [services/call-processing.ts] (async, fire-and-forget)
   ├─ releaseUploadSlot(orgId)
   └─ res.status(201).json(call) — response returns immediately

2. processAudioFile() [services/call-processing.ts]
   ├─ broadcastCallUpdate("uploading") → WebSocket
   ├─ Step 1: uploadAndArchive()
   │    ├─ assemblyai.uploadAudioFile() → audioUrl
   │    └─ storage.uploadAudio() → S3 archive (non-blocking, continues on failure)
   ├─ Build transcription options from org settings (wordBoost, piiRedaction, webhookUrl)
   ├─ Step 2-3: transcribe()
   │    ├─ assemblyai.transcribeAudio(audioUrl, opts) → transcriptId
   │    ├─ storage.updateCall(assemblyAiId)
   │    ├─ [WEBHOOK MODE] return — webhook handler resumes later
   │    └─ [POLLING MODE] assemblyai.pollTranscript(transcriptId, 60, progressCallback)
   │         └─ Empty transcript guard (<10 chars) → handleEmptyTranscript() → return
   └─ continueAfterTranscription()
        ├─ Empty transcript guard (duplicate for webhook path) → withTransaction() → return
        ├─ [BATCH MODE] shouldUseBatchMode() check
        │    ├─ buildSystemPrompt + buildUserMessage → savePendingBatchItem() → S3
        │    ├─ processTranscriptData() (with null AI analysis)
        │    ├─ storage.withTransaction() → createTranscript + createSentiment + createAnalysis + updateCall
        │    ├─ broadcastCallUpdate("completed", "Queued for batch analysis")
        │    └─ return
        ├─ Step 4: runAiAnalysis()
        │    ├─ loadPromptTemplate() — cached by org+category
        │    │    ├─ storage.getPromptTemplateByCategory() (with LRU cache)
        │    │    ├─ Clinical metadata injection (specialty, noteFormat, provider style prefs)
        │    │    └─ loadReferenceContext()
        │    │         ├─ getCachedRefDocs() — refDocCache / storage.listReferenceDocuments()
        │    │         ├─ storage.getSubscription() → check RAG eligibility (plan tier)
        │    │         ├─ [RAG] searchRelevantChunks() → formatRetrievedContext() → scanAndRedactOutput()
        │    │         └─ [FALLBACK] full-text document injection
        │    └─ withBedrockProtection() → withRetry() → aiProvider.analyzeCallTranscript()
        ├─ Step 5: processTranscriptData() → { transcript, sentiment, analysis }
        │    ├─ computeConfidence() → confidenceScore + factors
        │    ├─ applyScoreCalibration() [services/scoring-calibration.ts]
        │    ├─ [CLINICAL] mapClinicalNote() → extractStructuredDataFromSections()
        │    │    └─ validateAndEncryptClinicalNote() ← PHI ENCRYPTION (AES-256-GCM)
        │    ├─ [NO CLINICAL NOTE EXPECTED] → flag requires_clinical_retry
        │    ├─ enforceServerFlags() (low_score/exceptional_call)
        │    └─ autoAssignEmployee() — match detected agent name to active employees
        ├─ Step 6: storage.withTransaction() ← TRANSACTION BOUNDARY
        │    ├─ storage.createTranscript()
        │    ├─ storage.createSentimentAnalysis()
        │    ├─ storage.createCallAnalysis()
        │    └─ storage.updateCall(status: "completed", employeeId, tags)
        ├─ broadcastCallUpdate("completed") ← WEBSOCKET BROADCAST
        ├─ invalidateDashboardCache()
        └─ postProcessing() (non-blocking, all with withRetry)
             ├─ notifyFlaggedCall() [services/notifications.ts]
             ├─ onCallAnalysisComplete() [services/proactive-alerts.ts] → coaching recommendations
             ├─ recordActivity() [routes/gamification.ts] → gamification points (conditional)
             ├─ trackUsage("transcription") + trackUsage("ai_analysis") [services/queue.ts]
             └─ Usage rollback check (if call marked failed after tracking)

   [ERROR PATH]
   ├─ storage.updateCall(status: "failed") → broadcastCallUpdate("failed")
   └─ enqueueCallRetry() [services/queue.ts] → audio-processing queue (max 2 retries)

   [ASYNC WEBHOOK PATH]
   POST /api/webhooks/assemblyai [routes/assemblyai-webhook.ts]
     → verify X-Assembly-Webhook-Token (timing-safe) → lookup call by assemblyAiId
     → continueAfterTranscription() (same as step 2 above)
```

### Data Flow: RAG Document Indexing

```
1. POST /api/reference-documents [routes/onboarding.ts]
   ├─ multer → text extraction → contentHash dedup
   ├─ storage.createReferenceDocument(indexingStatus: "pending")
   └─ enqueueDocumentIndexing() [services/queue.ts]
        ├─ [WITH REDIS] BullMQ add("index-document") → workers/indexing.worker.ts
        └─ [WITHOUT REDIS] rag-worker.indexDocumentInProcess() (in-process fallback)

2. rag.indexDocument() [services/rag.ts]
   ├─ chunkDocument() [services/chunker.ts] → sliding window, tables, page numbers
   ├─ generateEmbeddingsBatch() [services/embeddings.ts] → Titan V2 (L1 LRU + L2 Redis cache)
   ├─ db.insert(documentChunks) → pgvector(1024) embeddings
   └─ updateIndexingStatus("indexed")
```

### Data Flow: Authentication (Login → Session → Org Context)

```
1. POST /api/auth/login [routes/auth.ts]
   ├─ distributedRateLimit(15min, 5)
   ├─ passport.authenticate("local") [auth.ts LocalStrategy]
   │    ├─ isAccountLocked() → recordFailedAttempt() or clearFailedAttempts()
   │    ├─ getUserByUsername(orgId?) → env users first, then DB
   │    └─ scrypt hash comparison (timing-safe)
   ├─ [MFA] trustedDevice cookie check → or return { requiresMfa: true }
   └─ req.login() → session stored in Redis or MemoryStore

2. Subsequent requests:
   ├─ requireAuth → passport.deserializeUser() → SSO session expiry check
   └─ injectOrgContext → req.orgId from session → org status gate (suspended=403, deleted=410)
```

### Data Flow: Clinical Note Lifecycle

```
1. Generation [services/call-processing.ts]
   ├─ AI returns clinical_note → mapClinicalNote() → extractStructuredData()
   └─ validateAndEncryptClinicalNote() → AES-256-GCM on PHI fields

2. Retrieval [routes/clinical.ts GET]
   ├─ decryptClinicalNotePhi() → HIPAA PHI_DECRYPT audit event
   └─ viewer role → PHI fields redacted

3. Attestation [routes/clinical.ts POST .../attest]
   └─ NPI validation + encryption → providerAttested: true

4. Amendment [routes/clinical-compliance.routes.ts POST .../addendum]
   └─ Version conflict check → SHA-256 amendment chain → clears attestation

5. FHIR Export [routes/clinical-compliance.routes.ts GET .../fhir]
   └─ Requires attestation → decrypt → buildFhirBundle() → application/fhir+json
```

### Auth & Security Surface

**Authentication & authorization:**
- **`requireAuth` + `injectOrgContext`** applied to **36 of 44 route files** (applied per-route, not globally in index.ts)
- **8 files without auth:** 6 intentionally public routes (`auth.ts`, `oauth.ts`, `sso.ts`, `scim.ts`, `password-reset.ts`, `assemblyai-webhook.ts` — each has its own verification) + 2 utility files (`helpers.ts`, `index.ts`)

**Middleware stack in `server/index.ts` (order matters):**
- **Correlation ID** (`correlationIdMiddleware`) — per-request UUID via AsyncLocalStorage
- **WAF** (`wafMiddleware`) — SQL injection, XSS, path traversal detection
- **Security headers** — CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy
- **HTTPS enforcement** — HTTP→HTTPS redirect in production
- **CSRF** — double-submit cookie (timing-safe); exemptions for webhooks, API keys, SCIM, SSO callbacks, pre-auth
- **Audit logging** — inline middleware logs all API calls with user/org/method/status/duration (separate from `logPhiAccess`)
- **Rate limiting** — distributed (Redis) with in-memory fallback; per-IP pre-auth, per-IP+orgId for data endpoints
- **Sentry** (`sentryErrorMiddleware`) — captures unhandled errors before global handler
- **Global error handler** (`globalErrorHandler`) — handles AppError + HIPAA-safe generic messages

**PHI touchpoints:**
- **PHI encryption/decryption** in 12 files: clinical routes (3), calls, mfa, ehr, live-session, pg-storage, call-processing, ehr-note-push worker, ehr/health-monitor, ehr/appointment-matcher

### External Service Dependencies

| Service | SDK/Client | Used By |
|---------|-----------|---------|
| AWS Bedrock (Claude) | `@aws-sdk/client-bedrock-runtime` + raw SigV4 | `bedrock.ts`, `ai-factory.ts` |
| AWS Bedrock (batch) | `@aws-sdk/client-bedrock` | `bedrock-batch.ts` |
| AWS S3 | `@aws-sdk/client-s3` | `s3.ts` — audio storage, batch inference I/O |
| AWS SES | `@aws-sdk/client-ses` | `email.ts` |
| AWS KMS | `@aws-sdk/client-kms` | `org-encryption.ts` |
| AWS Credentials | `@aws-sdk/credential-providers` | `aws-credentials.ts` — env vars, instance roles, STS |
| AWS Secrets Manager | Custom REST SigV4 | `ehr/secrets-manager.ts` |
| Amazon Titan Embed V2 | Bedrock Converse (1024-dim) | `embeddings.ts` |
| AssemblyAI | REST API (custom client) | `assemblyai.ts`, `assemblyai-realtime.ts` |
| Stripe | `stripe` SDK | `stripe.ts`, `billing.ts` |
| PostgreSQL + pgvector | `drizzle-orm` + `pg` | `db/*.ts`, `rag.ts` |
| Redis + BullMQ | `ioredis`, `bullmq`, `connect-redis` | Sessions, rate limiting, queues, pub/sub, cache |
| Google OAuth | `passport-google-oauth20` | `routes/oauth.ts` |
| SAML 2.0 SSO | `@node-saml/passport-saml` | `routes/sso.ts` |
| WebAuthn/FIDO2 | `@simplewebauthn/server` v13 | `routes/mfa.ts` |
| TOTP (MFA) | `otplib` | `routes/mfa.ts` |
| SMTP Email | `nodemailer` | `email.ts` (fallback when SES not configured) |
| PDF Parsing | `pdf-parse` | `routes/onboarding.ts` — RAG document text extraction |
| Sentry | `@sentry/node` + `@sentry/react` | `sentry.ts`, `error-reporting.ts` |
| OpenTelemetry | `@opentelemetry/sdk-node` | `telemetry.ts`, `tracing.ts` |
| Betterstack | `@logtail/pino` | `logger.ts` — structured log aggregation |

### Complexity & Risk Rankings

**Highest-complexity subsystems** (most likely to contain hidden issues):
1. `server/services/call-processing.ts` — 14+ service deps, 3 processing branches (real-time, webhook, batch), transaction management
2. `server/db/pg-storage.ts` + mixins — 3-file prototype mixin pattern, 82+ `as any` casts, entire IStorage impl
3. `server/services/rag.ts` — Hybrid search, 4 query types, adaptive weights, synonym expansion, confidence reconciliation
4. `server/auth.ts` — Lockout, sessions, org context, SSO expiry, impersonation, multi-org resolution
5. `server/index.ts` — Rate limiting (distributed + fallback), CSRF, security headers, 10-step startup, graceful shutdown

**Highest-risk subsystems** (most impactful if broken):
1. `server/services/phi-encryption.ts` — Key loss = permanent PHI data loss. Used by 12 files
2. `server/auth.ts` — Auth bypass = full tenant data exposure
3. `server/storage/index.ts` — Storage singleton swap during init. Proxy throws = app dead
4. `server/services/audit-log.ts` — HIPAA compliance depends on hash chain integrity
5. `server/db/sync-schema.ts` — Runs DDL on every startup. Bug = cascading 500s

## API Routes Overview

### Authentication & Registration (public)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/login` | Login (rate limited: 5/15min per IP) |
| POST | `/api/auth/logout` | Logout & clear session |
| GET | `/api/auth/me` | Get current user + org context |
| POST | `/api/auth/register` | Self-service org + admin user registration |
| GET | `/api/auth/google` | Google OAuth redirect |
| GET | `/api/auth/google/callback` | Google OAuth callback |
| POST | `/api/invitations/accept` | Accept team invitation |

### SSO (Enterprise, per-org SAML 2.0)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/auth/sso/check/:orgSlug` | Pre-flight: check if SSO is available for org |
| GET | `/api/auth/sso/:orgSlug` | Initiate SAML login redirect |
| POST | `/api/auth/sso/callback` | SAML Assertion Consumer Service (ACS) |
| GET | `/api/auth/sso/metadata/:orgSlug` | SP metadata for IDP configuration |

### MFA (authenticated)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/mfa/setup` | Generate TOTP secret + QR code |
| POST | `/api/auth/mfa/enable` | Verify code and enable MFA |
| POST | `/api/auth/mfa/verify` | Verify MFA code during login |
| POST | `/api/auth/mfa/disable` | Disable MFA for current user |

### Password Reset (public)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/forgot-password` | Request password reset email |
| POST | `/api/auth/reset-password` | Reset password with token |

### Data Export (authenticated)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/export/calls` | Export calls as CSV |
| GET | `/api/export/employees` | Export employees as CSV |
| GET | `/api/export/performance` | Export performance data as CSV |

### Calls (authenticated, org-scoped)
| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/api/calls` | authenticated | List calls (filtering/pagination) |
| GET | `/api/calls/:id` | authenticated | Get call details |
| POST | `/api/calls/upload` | authenticated | Upload audio (starts pipeline) |
| GET | `/api/calls/:id/audio` | authenticated | Stream audio for playback |
| GET | `/api/calls/:id/transcript` | authenticated | Get transcript |
| GET | `/api/calls/:id/sentiment` | authenticated | Get sentiment analysis |
| GET | `/api/calls/:id/analysis` | authenticated | Get AI analysis |
| PATCH | `/api/calls/:id/analysis` | manager+ | Edit AI analysis |
| PATCH | `/api/calls/:id/assign` | manager+ | Assign call to employee |
| DELETE | `/api/calls/:id` | manager+ | Delete call |

### Employees (authenticated, org-scoped)
| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/api/employees` | authenticated | List org employees |
| POST | `/api/employees` | manager+ | Create employee |
| PATCH | `/api/employees/:id` | manager+ | Update employee |
| POST | `/api/employees/import-csv` | admin | Bulk import from CSV |

### Dashboard & Reports (authenticated, org-scoped)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/dashboard/metrics` | Call metrics & performance |
| GET | `/api/dashboard/sentiment` | Sentiment distribution |
| GET | `/api/dashboard/performers` | Top performers |
| GET | `/api/search` | Full-text search |
| GET | `/api/performance` | Performance metrics |
| GET | `/api/reports/summary` | Summary report |
| GET | `/api/reports/filtered` | Filtered reports (date range) |
| GET | `/api/reports/agent-profile/:id` | Agent profile |
| POST | `/api/reports/agent-summary/:id` | Generate agent summary |
| GET | `/api/insights` | Aggregate insights & trends |

### Coaching (org-scoped)
| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/api/coaching` | manager+ | List coaching sessions |
| GET | `/api/coaching/employee/:id` | authenticated | Coaching for employee |
| POST | `/api/coaching` | manager+ | Create coaching session |
| PATCH | `/api/coaching/:id` | manager+ | Update coaching session |

### Admin & Configuration (org-scoped)
| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/api/admin/users` | admin | List org users |
| POST | `/api/admin/users` | admin | Create user |
| PATCH | `/api/admin/users/:id` | admin | Update user |
| DELETE | `/api/admin/users/:id` | admin | Delete user |
| POST | `/api/admin/invitations` | admin | Send team invitation |
| GET | `/api/prompt-templates` | admin | List prompt templates |
| POST | `/api/prompt-templates` | admin | Create prompt template |
| PATCH | `/api/prompt-templates/:id` | admin | Update prompt template |
| DELETE | `/api/prompt-templates/:id` | admin | Delete prompt template |
| GET | `/api/access-requests` | admin | List access requests |
| PATCH | `/api/access-requests/:id` | admin | Approve/deny request |
| GET | `/api/admin/vocabulary` | admin | Get org's custom vocabulary (word boost list) |
| PUT | `/api/admin/vocabulary` | admin | Update custom vocabulary for transcription |
| GET | `/api/admin/org/export` | admin | GDPR/CCPA data export (all org data, passwords scrubbed) |
| DELETE | `/api/admin/org/purge` | admin | GDPR/CCPA right to erasure (requires confirm: 'PURGE ALL DATA') |

### API Keys (org-scoped)
| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/api/api-keys` | admin | List API keys |
| POST | `/api/api-keys` | admin | Create API key |
| DELETE | `/api/api-keys/:id` | admin | Revoke API key |

### Billing (org-scoped)
| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/api/billing/subscription` | authenticated | Get current subscription |
| GET | `/api/billing/plans` | authenticated | List available plans |
| POST | `/api/billing/checkout` | admin | Create Stripe checkout session |
| POST | `/api/billing/portal` | admin | Create Stripe customer portal session |
| GET | `/api/billing/usage` | authenticated | Get usage summary |
| POST | `/api/billing/webhook` | public | Stripe webhook receiver |

### Onboarding & Knowledge Base (org-scoped)
| Method | Path | Role | Description |
|--------|------|------|-------------|
| POST | `/api/onboarding/logo` | admin | Upload org logo |
| POST | `/api/reference-documents` | admin | Upload reference document |
| GET | `/api/reference-documents` | authenticated | List reference documents (with indexingStatus) |
| GET | `/api/reference-documents/:id` | authenticated | Get document details |
| PATCH | `/api/reference-documents/:id` | admin | Update document metadata |
| DELETE | `/api/reference-documents/:id` | admin | Delete reference document |
| POST | `/api/reference-documents/:id/version` | admin | Create new version (deactivates old, re-indexes) |
| GET | `/api/reference-documents/:id/versions` | authenticated | Get version history chain |
| POST | `/api/reference-documents/:id/reindex` | admin | Re-index document |
| GET | `/api/reference-documents/:id/chunks` | authenticated | Paginated chunk preview |
| POST | `/api/reference-documents/url` | admin | Add web URL as knowledge base source |
| POST | `/api/reference-documents/rag/search` | authenticated | RAG knowledge base search |
| GET | `/api/reference-documents/rag/status` | authenticated | RAG indexing status |
| GET | `/api/reference-documents/rag/analytics` | admin | Knowledge base analytics |

### Clinical Documentation (org-scoped, requires Clinical Documentation plan)
| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/api/clinical/notes/:callId` | authenticated | Get clinical note (PHI decrypted) |
| POST | `/api/clinical/notes/:callId/attest` | manager+ | Provider attestation of note |
| POST | `/api/clinical/notes/:callId/consent` | authenticated | Record patient consent for recording |
| PATCH | `/api/clinical/notes/:callId` | authenticated | Edit note fields (requires re-attestation) |
| GET | `/api/clinical/provider-preferences` | authenticated | Get provider style preferences |
| PATCH | `/api/clinical/provider-preferences` | authenticated | Update note formatting preferences |
| GET | `/api/clinical/metrics` | authenticated | Clinical dashboard metrics (completeness, accuracy, attestation rates) |
| POST | `/api/clinical/style-learning/analyze` | authenticated | AI analysis of provider's note style from history |
| POST | `/api/clinical/style-learning/apply` | authenticated | Apply learned style preferences |
| GET | `/api/clinical/templates` | authenticated | List clinical note templates (filter by specialty/format) |
| GET | `/api/clinical/templates/:id` | authenticated | Get specific template |
| GET | `/api/clinical/notes/:callId/amendments` | authenticated | List amendment history |
| POST | `/api/clinical/notes/:callId/addendum` | manager+ | Add addendum to attested note |
| GET | `/api/clinical/notes/:callId/fhir` | authenticated | Export note as FHIR R4 Bundle (requires attestation) |
| POST | `/api/clinical/notes/:callId/cosign` | manager+ | Co-sign/supervising provider attestation |
| GET | `/api/clinical/analytics/population` | admin | Population-level clinical analytics |
| GET | `/api/clinical/notes/:callId/prefill-suggestions` | authenticated | EHR-prefilled note suggestions |
| GET | `/api/clinical/templates/my` | authenticated | List provider's custom templates |
| POST | `/api/clinical/templates/custom` | manager+ | Create custom provider template |
| PATCH | `/api/clinical/templates/custom/:id` | manager+ | Update custom provider template |
| DELETE | `/api/clinical/templates/custom/:id` | manager+ | Delete custom provider template |
| GET | `/api/clinical/notes/:callId/validate` | authenticated | Validate note completeness |
| POST | `/api/clinical/notes/:callId/feedback` | authenticated | Submit clinical note feedback |

### Transcription Webhooks (public)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/webhooks/assemblyai` | AssemblyAI transcription completion webhook (verified via X-Assembly-Webhook-Token) |

### EHR Integration (org-scoped)
| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/api/ehr/systems` | authenticated | List supported EHR systems |
| GET | `/api/ehr/config` | authenticated | Get org's EHR configuration |
| PUT | `/api/ehr/config` | admin | Configure EHR connection |
| POST | `/api/ehr/test-connection` | admin | Validate EHR credentials |
| GET | `/api/ehr/patients` | authenticated | Search patients (name, DOB, phone) |
| GET | `/api/ehr/patients/:ehrPatientId` | authenticated | Get patient demographics, insurance, allergies |
| GET | `/api/ehr/appointments/today` | authenticated | Today's appointments |
| GET | `/api/ehr/appointments` | authenticated | Appointments for date range |
| POST | `/api/ehr/push-note/:callId` | manager+ | Push attested clinical note to EHR |
| GET | `/api/ehr/patients/:ehrPatientId/treatment-plans` | authenticated | Patient treatment plans (dental) |
| DELETE | `/api/ehr/config` | admin | Disable EHR integration |

### A/B Model Testing (org-scoped, admin only)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/ab-tests` | List all A/B tests |
| GET | `/api/ab-tests/:id` | Get test with results |
| POST | `/api/ab-tests/upload` | Upload audio for dual-model comparison |
| POST | `/api/ab-tests/batch` | Batch upload (up to 50 files) for aggregate comparison |
| GET | `/api/ab-tests/batch/:batchId` | Get batch status and all test results |
| GET | `/api/ab-tests/stats` | Aggregate statistics with Welch's t-test significance |
| GET | `/api/ab-tests/segments` | Segment analysis by call category and model pair |
| GET | `/api/ab-tests/recommend` | Automated model recommendation with per-category breakdown |
| GET | `/api/ab-tests/:id/export` | Export test results as JSON |
| DELETE | `/api/ab-tests/:id` | Delete test |

### Usage & Spend Tracking (org-scoped, admin only)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/usage` | Get usage/cost records (with date filtering, pagination) |
| GET | `/api/usage/forecast` | Cost forecasting: projected monthly spend, daily rate, trend, budget status |
| GET | `/api/usage/cost-per-outcome` | Cost per scored call, per coaching session, per converted call |
| GET | `/api/usage/by-department` | Department/team cost allocation breakdown |
| GET | `/api/usage/anomalies` | Cost anomaly detection (3-sigma + 5x mean threshold) |
| GET | `/api/usage/budget` | Get budget alert configuration |
| PUT | `/api/usage/budget` | Set budget alert threshold and email |

### User Feedback (org-scoped)
| Method | Path | Role | Description |
|--------|------|------|-------------|
| POST | `/api/feedback` | authenticated | Submit feedback (rating, bug, suggestion, NPS) |
| GET | `/api/feedback` | admin | List all org feedback |
| GET | `/api/feedback/summary` | admin | Feedback analytics (NPS score, ratings by feature) |
| PATCH | `/api/feedback/:id` | admin | Update status / add admin response |

### Gamification (org-scoped)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/gamification/leaderboard` | Org leaderboard (filters opted-out employees) |
| GET | `/api/gamification/profile/:employeeId` | Employee gamification profile with badges |
| GET | `/api/gamification/badges` | List all badge definitions |
| GET | `/api/gamification/settings` | Get gamification opt-out settings (admin) |
| PUT | `/api/gamification/settings` | Configure opt-out roles/employees, team competitions (admin) |
| POST | `/api/gamification/recognize` | Award custom recognition badge (manager+) |
| GET | `/api/gamification/team-leaderboard` | Team/department competition leaderboard |
| GET | `/api/gamification/effectiveness` | Badge-performance correlation analysis (admin) |

### Insurance Narratives (org-scoped)
| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/api/insurance-narratives/types` | authenticated | List letter types |
| POST | `/api/insurance-narratives` | manager+ | Create narrative (generates AI letter) |
| GET | `/api/insurance-narratives` | authenticated | List narratives |
| GET | `/api/insurance-narratives/:id` | authenticated | Get specific narrative |
| PATCH | `/api/insurance-narratives/:id` | manager+ | Update narrative/status |
| DELETE | `/api/insurance-narratives/:id` | manager+ | Delete narrative |
| POST | `/api/insurance-narratives/:id/regenerate` | manager+ | Regenerate letter text |
| GET | `/api/insurance-narratives/payer-templates` | authenticated | List payer-specific templates (BCBS, Aetna, UHC, etc.) |
| POST | `/api/insurance-narratives/:id/outcome` | manager+ | Record outcome (approved/denied/partial) with denial code |
| GET | `/api/insurance-narratives/denial-analysis` | manager+ | Denial code frequency analysis with per-insurer approval rates |
| GET | `/api/insurance-narratives/deadlines` | authenticated | Narratives approaching submission deadlines (urgency levels) |
| GET | `/api/insurance-narratives/:id/checklist` | authenticated | Supporting document checklist for letter type |

### Revenue Tracking (org-scoped)
| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/api/revenue/metrics` | authenticated | Revenue summary (totals, conversion rate, avg deal) |
| GET | `/api/revenue` | authenticated | List all call revenue records |
| GET | `/api/revenue/call/:callId` | authenticated | Get revenue for specific call |
| PUT | `/api/revenue/call/:callId` | manager+ | Create/update call revenue (supports attribution + payer fields) |
| GET | `/api/revenue/by-employee` | authenticated | Revenue aggregated by employee |
| GET | `/api/revenue/forecast` | authenticated | Revenue forecasting: pipeline value, conversion projection, monthly run rate |
| GET | `/api/revenue/attribution` | authenticated | Attribution funnel: call → appointment → treatment → payment conversion rates |
| GET | `/api/revenue/payer-mix` | authenticated | Payer mix analysis: insurance vs cash breakdown by carrier and employee |
| POST | `/api/revenue/ehr-sync/:callId` | manager+ | Pull treatment/payment data from EHR into revenue record |
| GET | `/api/revenue/trend` | authenticated | Weekly revenue trend (12 weeks) |

### Calibration Sessions (org-scoped)
| Method | Path | Role | Description |
|--------|------|------|-------------|
| POST | `/api/calibration` | manager+ | Create calibration session (supports `blindMode: true`) |
| GET | `/api/calibration` | manager+ | List sessions with stats |
| GET | `/api/calibration/:id` | manager+ | Get session with evaluations (blind mode hides others' scores until completed) |
| POST | `/api/calibration/:id/evaluate` | authenticated | Submit evaluation (evaluators only) |
| POST | `/api/calibration/:id/complete` | manager+ | Complete session (set consensus, reveals blind scores) |
| DELETE | `/api/calibration/:id` | manager+ | Delete session |
| GET | `/api/calibration/:id/export` | manager+ | Export calibration report as CSV |
| GET | `/api/calibration/analytics` | manager+ | Variance trends, IRR metrics (Krippendorff's alpha, ICC), evaluator certification |
| GET | `/api/calibration/suggest-calls` | manager+ | Automated call selection for calibration (borderline, flagged, recent) |
| GET | `/api/calibration/certifications` | manager+ | Evaluator certification status with consistency scores and trends |

### Live Sessions (org-scoped, requires Clinical Documentation plan)
| Method | Path | Role | Description |
|--------|------|------|-------------|
| POST | `/api/live-sessions` | authenticated | Start real-time clinical session (AssemblyAI streaming) |
| GET | `/api/live-sessions/:id` | authenticated | Get session status + transcript |
| GET | `/api/live-sessions/:id/audio` | authenticated | Stream live audio |
| POST | `/api/live-sessions/:id/draft-note` | authenticated | Draft clinical note during session |
| PATCH | `/api/live-sessions/:id/pause` | authenticated | Pause session |
| PATCH | `/api/live-sessions/:id/stop` | authenticated | Stop session |

### LMS — Learning Management System (org-scoped)
| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/api/lms/modules` | authenticated | List learning modules |
| POST | `/api/lms/modules` | manager+ | Create module (supports prerequisiteModuleIds, passingScore) |
| GET | `/api/lms/modules/:id` | authenticated | Get module content |
| POST | `/api/lms/modules/generate` | manager+ | AI-generate module from call analysis |
| GET | `/api/lms/modules/:id/prerequisites` | authenticated | Check prerequisite completion for employee |
| GET | `/api/lms/modules/:id/certificate` | authenticated | Generate completion certificate data |
| POST | `/api/lms/modules/:id/submit-quiz` | authenticated | Submit quiz answers (uses module passingScore) |
| GET | `/api/lms/paths` | authenticated | List learning paths |
| POST | `/api/lms/paths` | manager+ | Create learning path (supports dueDate, enforceOrder) |
| GET | `/api/lms/paths/:id` | authenticated | Get learning path |
| GET | `/api/lms/paths/:id/deadlines` | manager+ | Deadline status for all assigned employees |
| GET | `/api/lms/progress` | authenticated | User progress |
| GET | `/api/lms/progress/:employeeId` | authenticated | Employee progress |
| GET | `/api/lms/stats` | manager+ | LMS statistics |
| GET | `/api/lms/coaching-recommendations` | authenticated | Recommend modules based on coaching/weak areas |
| GET | `/api/lms/knowledge-search` | authenticated | Search knowledge base |

### Lead Tracking / Call Source Attribution (org-scoped)
| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/api/marketing/campaigns` | authenticated | List campaigns |
| POST | `/api/marketing/campaigns` | manager+ | Create campaign |
| GET | `/api/marketing/campaigns/:id` | authenticated | Get campaign details |
| GET | `/api/marketing/metrics` | authenticated | Campaign metrics |
| GET | `/api/marketing/sources` | authenticated | Traffic source breakdown |
| GET | `/api/marketing/attribution/:callId` | authenticated | Call-level attribution |

### QA Benchmarking (org-scoped, anonymized cross-org)
| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/api/benchmarks` | authenticated | Org scores vs anonymized industry percentiles |
| GET | `/api/benchmarks/trends` | authenticated | Monthly percentile rank trend (last 12 months) |

### Patient Journey Analytics (org-scoped, PHI-protected)
| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/api/patient-journeys` | manager+ | List multi-visit patient journeys with call history |
| GET | `/api/patient-journeys/insights` | manager+ | Retention rate, sentiment trends, revenue comparison |

### Email Management (org-scoped)
| Method | Path | Role | Description |
|--------|------|------|-------------|
| POST | `/api/emails/submit` | manager+ | Submit email |
| POST | `/api/emails/bulk-submit` | admin | Bulk submit emails |
| GET | `/api/emails/threads` | authenticated | Email threads |
| GET | `/api/emails/stats` | admin | Email analytics |

### Super Admin (platform-level, requires SUPER_ADMIN_USERS)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/super-admin/organizations` | List all organizations |
| POST | `/api/super-admin/organizations` | Create organization |
| GET | `/api/super-admin/organizations/:id` | Get organization details |
| POST | `/api/super-admin/organizations/:id/impersonate` | Impersonate organization |
| GET | `/api/super-admin/stats` | Platform-wide statistics |
| GET | `/api/super-admin/usage` | Per-org resource usage dashboard (calls, cost, employees) |
| POST | `/api/super-admin/organizations/:id/rotate-key` | Rotate org's KMS data encryption key |

### BAA Management (admin only, HIPAA §164.502(e))
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/admin/baa` | List all BAAs for the org |
| GET | `/api/admin/baa/:id` | Get a single BAA |
| POST | `/api/admin/baa` | Create a new BAA record |
| PATCH | `/api/admin/baa/:id` | Update a BAA |
| DELETE | `/api/admin/baa/:id` | Soft-delete (status → terminated) |
| GET | `/api/admin/baa/expiring` | BAAs nearing expiry (sorted by urgency) |
| GET | `/api/admin/baa/vendor-types` | List vendor type enum values |

### Health
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check (DB, Redis, storage status) |

## Role-Based Access Control

Role hierarchy: **admin (3) > manager (2) > viewer (1)**. Enforced via `requireRole()` middleware in `server/auth.ts`.

| Role | Capabilities |
|------|-------------|
| **viewer** | Read-only: dashboards, reports, transcripts, call playback, team data, RAG search |
| **manager** | Everything viewer can do, plus: assign calls, edit AI analysis, manage employees, create coaching sessions, export reports, delete calls |
| **admin** | Full control: manage users, send invitations, approve access requests, bulk CSV import, prompt template CRUD, reference doc upload, API key management, billing, org settings |

## Authentication
Two user sources, checked in order:
1. **ENV users** — `AUTH_USERS` env var, format: `username:password:role:displayName:orgSlug`
2. **Database users** — created via admin UI, self-registration, or invitation acceptance

Plus optional **Google OAuth 2.0** (requires `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`).

Plus **SAML 2.0 SSO** (Enterprise plan) — per-org IDP configuration stored in org settings (`ssoProvider`, `ssoSignOnUrl`, `ssoCertificate`). Uses `@node-saml/passport-saml` with MultiSamlStrategy. Pre-flight validation endpoint prevents redirect errors for invalid org slugs.

Plus **MFA** (TOTP) — opt-in per user, can be required per org (`mfaRequired` in org settings). Uses TOTP with backup codes.

Plus **API key auth** — header `X-API-Key: obs_k_...` for programmatic access. Keys are hashed (SHA-256), never stored in plaintext.

On startup, env-var orgSlugs are resolved to orgIds. If an org doesn't exist for a slug, it's auto-created (backward compatibility).

## Environment Variables
```
# ─── Required ──────────────────────────────────────────────────────────
ASSEMBLYAI_API_KEY              # Transcription service
SESSION_SECRET                  # Cookie signing (random string, persist across restarts)

# ─── Authentication ───────────────────────────────────────────────────
AUTH_USERS                      # Format: user:pass:role:name:orgSlug (comma-separated)
DEFAULT_ORG_SLUG                # Default org for users without explicit orgSlug (default: "default")

# ─── Storage Backend (pick one) ───────────────────────────────────────
STORAGE_BACKEND                 # "postgres" or "s3" (auto-detects if unset)
DATABASE_URL                    # PostgreSQL connection string (required for postgres backend)
DB_SSL_REJECT_UNAUTHORIZED      # Set to "false" for managed DBs with self-signed certs (default: true)
S3_BUCKET                       # S3 bucket name (also used for audio blobs alongside postgres)

# ─── Redis ────────────────────────────────────────────────────────────
REDIS_URL                       # Redis connection (sessions, rate limiting, job queues)
                                # Without this: in-memory fallback (single-instance only)
REQUIRE_REDIS                   # Set to "true" to fail startup without Redis (production safety)

# ─── AI Analysis (AWS Bedrock) ───────────────────────────────────────
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
AWS_REGION                      # Default: us-east-1
AWS_SESSION_TOKEN               # Optional, for IAM roles/STS
BEDROCK_MODEL                   # Default: us.anthropic.claude-sonnet-4-6

# ─── Billing ─────────────────────────────────────────────────────────
STRIPE_SECRET_KEY               # Stripe API secret
STRIPE_WEBHOOK_SECRET           # Stripe webhook signing secret
STRIPE_PRICE_STARTER_MONTHLY    # Price ID for Starter monthly ($79)
STRIPE_PRICE_STARTER_YEARLY     # Price ID for Starter yearly ($756)
STRIPE_PRICE_PROFESSIONAL_MONTHLY # Price ID for Professional monthly ($199)
STRIPE_PRICE_PROFESSIONAL_YEARLY  # Price ID for Professional yearly ($1908)
STRIPE_PRICE_ENTERPRISE_MONTHLY # Price ID for Enterprise monthly ($999)
STRIPE_PRICE_ENTERPRISE_YEARLY  # Price ID for Enterprise yearly ($9588)
STRIPE_PRICE_CLINICAL_ADDON_MONTHLY # Price ID for Clinical Documentation add-on ($49/mo, Starter only)

# ─── Google OAuth ────────────────────────────────────────────────────
GOOGLE_CLIENT_ID                # OAuth client ID
GOOGLE_CLIENT_SECRET            # OAuth client secret
GOOGLE_CALLBACK_URL             # Callback URL (default: /api/auth/google/callback)

# ─── Logging ─────────────────────────────────────────────────────────
BETTERSTACK_SOURCE_TOKEN        # Betterstack log aggregation (optional)
LOG_LEVEL                       # Pino level: debug, info, warn, error (default: info in prod)

# ─── Notifications ───────────────────────────────────────────────────
WEBHOOK_URL                     # Slack/Teams webhook for flagged call notifications
WEBHOOK_EVENTS                  # Event types to notify (default: low_score,agent_misconduct,exceptional_call)
WEBHOOK_COACHING_URL            # Coaching notifications webhook
WEBHOOK_DIGEST_URL              # Digest notifications webhook
WEBHOOK_PLATFORM                # Webhook platform: slack or teams

# ─── Email (pick one) ────────────────────────────────────────────────
EMAIL_PROVIDER                  # "ses" for AWS SES API (uses existing AWS creds); omit for SMTP
SES_REGION                      # SES region override (default: AWS_REGION or us-east-1)
SES_FROM_ADDRESS                # SES sender (alternative to SMTP_FROM, must be SES-verified)
SMTP_HOST                       # SMTP server hostname (for SMTP transport)
SMTP_PORT                       # SMTP server port (default: 587)
SMTP_USER                       # SMTP authentication username
SMTP_PASS                       # SMTP authentication password
SMTP_FROM                       # Sender email address

# ─── Error Tracking (Sentry) ────────────────────────────────────────
SENTRY_DSN                      # Server-side Sentry DSN (Node.js errors)
VITE_SENTRY_DSN                 # Client-side Sentry DSN (browser errors, must use VITE_ prefix)
APP_VERSION                     # Release version tag for Sentry (default: "dev")

# ─── CDN ─────────────────────────────────────────────────────────────
CDN_ORIGIN                      # CDN domain (e.g. https://cdn.observatory-qa.com)
                                # Sets Vite base URL + CSP headers for CDN asset serving

# ─── PHI Encryption ─────────────────────────────────────────────────
PHI_ENCRYPTION_KEY              # 64-char hex for AES-256-GCM field-level encryption

# ─── Transcription Webhooks ──────────────────────────────────────────
ASSEMBLYAI_WEBHOOK_SECRET       # Webhook token for AssemblyAI callbacks (falls back to SESSION_SECRET)

# ─── KMS Encryption ──────────────────────────────────────────────────
AWS_KMS_KEY_ID                  # AWS KMS CMK ARN for per-org envelope encryption (optional)

# ─── OpenTelemetry ───────────────────────────────────────────────────
OTEL_ENABLED                    # Set to "true" to enable OpenTelemetry traces + metrics
OTEL_EXPORTER_OTLP_ENDPOINT     # OTLP exporter endpoint (e.g. http://localhost:4318)

# ─── Super Admin ─────────────────────────────────────────────────────
SUPER_ADMIN_USERS               # Platform-level admin users (format: username:password, comma-separated)

# ─── Score Calibration ──────────────────────────────────────────────
SCORE_CALIBRATION_ENABLED       # Enable AI score distribution normalization
SCORE_CALIBRATION_CENTER        # Target score center (default: 5.0)
SCORE_CALIBRATION_SPREAD        # Target score spread
SCORE_LOW_THRESHOLD             # Low score threshold for flagging
SCORE_HIGH_THRESHOLD            # High score threshold for flagging

# ─── Application ─────────────────────────────────────────────────────
APP_BASE_URL                    # Application base URL (for email links, e.g. https://app.observatory-qa.com)
REANALYSIS_CONCURRENCY          # Concurrent reanalysis jobs (default: 3)

# ─── Optional ────────────────────────────────────────────────────────
PORT                            # Server port (default: 5000)
RETENTION_DAYS                  # Default retention policy (default: 90, overridden per-org)
DISABLE_SECURE_COOKIE           # Set to skip secure cookie flag (for non-TLS dev)
TRUST_PROXY                     # Set to "0" to disable trust proxy in production (default: enabled)
```

## Database Schema (PostgreSQL)

20+ tables defined in `server/db/schema.ts`, auto-synced on startup by `server/db/sync-schema.ts`:

| Table | Key Indexes | Notes |
|-------|-------------|-------|
| `organizations` | unique on `slug` | Org settings stored as JSONB (includes SSO config, MFA policy) |
| `users` | unique on `(org_id, username)` | Per-org username uniqueness (composite index). Passwords hashed with scrypt. MFA fields: `mfa_enabled`, `mfa_secret`, `mfa_backup_codes`, `webauthn_credentials` (JSONB), `mfa_trusted_devices` (JSONB), `mfa_enrollment_deadline` |
| `employees` | unique on `(org_id, email)` | Per-org employee roster |
| `calls` | index on `(org_id, status)`, `uploaded_at` | Links to employee. `file_hash` for dedup, `call_category`, `tags` (JSONB) |
| `transcripts` | unique on `call_id` | Cascade delete with call. `corrections` JSONB, `corrected_text` TEXT for manual transcript corrections |
| `sentiment_analyses` | unique on `call_id` | Cascade delete with call |
| `call_analyses` | unique on `call_id`, index on `(org_id, performance_score)` | Cascade delete. `confidence_factors` (JSONB incl. `aiAnalysisCompleted`), `sub_scores`, `detected_agent_name`, `manual_edits` |
| `access_requests` | index on `(org_id, status)` | |
| `prompt_templates` | index on `(org_id, call_category)` | Per-org evaluation criteria |
| `coaching_sessions` | index on `(org_id, status)`, `employee_id` | |
| `coaching_recommendations` | index on `org_id` | Auto-generated coaching recommendations |
| `api_keys` | unique on `key_hash` | SHA-256 hashed, never plaintext |
| `invitations` | unique on `token` | Expirable team invitations |
| `subscriptions` | unique on `org_id` | Stripe integration |
| `reference_documents` | index on `(org_id, category)` | RAG source documents. Versioning: `version`, `previous_version_id`. Indexing: `indexing_status`, `indexing_error`. Sources: `source_type` (upload/url), `source_url`. Analytics: `retrieval_count` |
| `document_chunks` | index on `org_id`, `document_id` | pgvector(1024) embeddings |
| `usage_events` | index on `(org_id, event_type)`, `created_at` | Billing metering |
| `password_reset_tokens` | unique on `token` | Expirable reset tokens |
| `audit_logs` | index on `(org_id, event_type)`, `created_at` | Tamper-evident with `integrity_hash`, `prev_hash`, `sequence_num` |
| `ab_tests` | index on `org_id` | Dual-model comparison results, latency, cost |
| `usage_records` | index on `(org_id, type)`, `timestamp` | Per-call cost tracking (AssemblyAI + Bedrock spend) |
| `feedbacks` | index on `(org_id, type)`, `created_at` | User feedback: ratings, bug reports, NPS, suggestions |
| `employee_badges` | unique on `(org_id, employee_id, badge_id)` | Gamification badge awards |
| `gamification_profiles` | unique on `(org_id, employee_id)`, index on `total_points` | Points, streaks, last activity |
| `insurance_narratives` | index on `(org_id, status)`, `(org_id, call_id)` | Prior auth and appeal letter drafts |
| `call_revenues` | unique on `(org_id, call_id)`, index on `conversion_status` | Per-call revenue/conversion tracking |
| `calibration_sessions` | index on `(org_id, status)` | Multi-evaluator QA alignment sessions |
| `calibration_evaluations` | unique on `(session_id, evaluator_id)` | Individual evaluator scores, cascade delete with session |
| `provider_templates` | index on `(org_id, user_id)`, `(org_id, specialty)` | Per-provider custom clinical note templates. JSONB sections, defaultCodes, tags |
| `mfa_recovery_requests` | index on `(org_id, status)`, `user_id` | Emergency MFA bypass: user requests → email-verified → admin approves → time-limited use token (15 min). Cascade delete with user/org. |
| `security_incidents` | index on `(org_id, phase)` | HIPAA breach tracking: severity, phase lifecycle, timeline, action items, breach notification deadline. RLS-protected |
| `breach_reports` | index on `(org_id, notification_status)` | HIPAA §164.408: affected individuals count, PHI types, 60-day notification deadline, notification status tracking, corrective actions |
| `business_associate_agreements` | index on `(org_id, status)`, `(expires_at)` | HIPAA §164.502(e): vendor BAA tracking with expiry dates, renewal reminders, PHI categories, signatory info. RLS-protected |

Requires pgvector extension: `CREATE EXTENSION IF NOT EXISTS vector;`

### Auto Schema Sync (server/db/sync-schema.ts)
On startup, `syncSchema(db)` runs idempotent SQL to create all tables and add missing columns using `CREATE TABLE IF NOT EXISTS` and `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`. This eliminates the need for `drizzle-kit push` (a devDependency) in production and prevents cascading 500 errors from missing tables/columns after deploys.

## HIPAA Compliance

| Feature | Location | Details |
|---------|----------|---------|
| **Account lockout** | `server/auth.ts` | 5 failed attempts → 15-min lockout per username |
| **Structured audit logging** | `server/services/audit-log.ts` | `[HIPAA_AUDIT]` JSON — user, org, resource type, timestamps |
| **API access audit** | `server/index.ts` | Middleware logs all API calls with user, org, method, status, duration |
| **Rate limiting** | `server/index.ts` | Login: 5/15min per IP. Data endpoints: org-scoped keys (IP + orgId). Redis-backed (distributed) or in-memory fallback |
| **Session fixation prevention** | `server/routes/mfa.ts` | `req.session.regenerate()` before `req.login()` after MFA verification |
| **Session destruction on logout** | `server/routes/auth.ts` | `req.session.destroy()` + `res.clearCookie("connect.sid")` — clears server-side session data |
| **Plan enforcement gates** | `server/routes/billing.ts` | `requirePlanFeature()`, `enforceUserQuota()`, `enforceQuota()`, `requireActiveSubscription()` middlewares — reject missing orgId |
| **PHI audit coverage** | Multiple route files | `logPhiAccess()` on sentiment, analysis, clinical, coaching, reports, insights, EHR endpoints |
| **Security headers** | `server/index.ts` | CSP, HSTS, X-Frame-Options, X-Content-Type-Options, X-XSS-Protection, Referrer-Policy, Permissions-Policy |
| **Session timeout** | `server/auth.ts` | 15-min rolling idle timeout, httpOnly + sameSite=lax + secure (prod) |
| **HTTPS enforcement** | `server/index.ts` | HTTP → HTTPS redirect in production |
| **Per-org data retention** | `server/index.ts` + workers | Auto-purges calls per org's `retentionDays` setting (default 90) |
| **Error logging** | Throughout | Pino structured logs — never log PHI (patient names, transcripts, call content) |
| **Encryption at rest** | Infrastructure | EBS encryption (EC2), S3 SSE, PostgreSQL disk encryption |
| **Encryption in transit** | Infrastructure | Caddy auto-TLS (EC2), Render managed TLS |
| **Tenant isolation** | `server/storage/` | All storage methods require orgId — cross-org access structurally impossible. Per-org username uniqueness (composite index). WebSocket broadcasts require orgId. Rate limit keys include org context for authenticated routes |
| **MFA** | `server/routes/mfa.ts` | TOTP + WebAuthn/Passkeys (FIDO2, phishing-resistant). Per-org enforcement with 7-day grace period (`mfaGracePeriodDays`). Trusted devices (30-day cookie, hashed token). Email OTP fallback for non-admin. Emergency recovery (email-verified + admin-approved bypass). |
| **SCIM provisioning** | `server/routes/scim.ts` | SCIM 2.0 automated user lifecycle. Bearer token per org (SHA-256 hashed). Create/deactivate/delete via IDP. Enterprise plan only. |
| **SSO session management** | `server/routes/sso.ts` + `server/auth.ts` | Per-org `ssoSessionMaxHours` forces SAML/OIDC re-auth. `ssoLoginAt` stamped on session. SLO (Single Logout) terminates session on IDP logout. Error code `OBS-AUTH-006`. |
| **PHI encryption** | `server/services/phi-encryption.ts` | AES-256-GCM application-level encryption for sensitive fields. **Throws in production** if `PHI_ENCRYPTION_KEY` is not set — PHI must never be stored unencrypted. Dev mode logs a warning and allows plaintext for local development |
| **PHI decryption audit** | `server/services/phi-encryption.ts` | `decryptClinicalNotePhi()` accepts audit context and logs `[HIPAA_AUDIT] PHI_DECRYPT` events with userId, orgId, resourceId, and field count. All callers in `calls.ts` and `clinical.ts` pass audit context |
| **Tamper-evident audit** | `server/services/audit-log.ts` | `audit_logs` table with SHA-256 integrity hashes and sequence numbers. Per-org promise-chain mutex serializes concurrent writes to prevent sequence number race conditions |
| **PostgreSQL RLS** | `server/db/sync-schema.ts` | `ENABLE/FORCE ROW LEVEL SECURITY` on all 27 tenant-scoped tables. `org_isolation` policies using `current_setting('app.org_id')`. DO-block idempotency for PG15 compatibility. `app.bypass_rls` session var for schema-sync and super-admin operations |
| **Per-org KMS encryption** | `server/services/org-encryption.ts` | Envelope encryption: AWS KMS generates per-org DEK, encrypted DEK stored in org settings, 5-min cache (keys zeroed on eviction), `enc_v2_{orgPrefix}:` format. Falls back to shared `PHI_ENCRYPTION_KEY` when `AWS_KMS_KEY_ID` not set |
| **GDPR/CCPA compliance** | `server/routes/admin.ts` | `GET /api/admin/org/export` (right to access), `DELETE /api/admin/org/purge` (right to erasure with confirmation). `deleteOrgData()` in all storage backends |
| **Org suspension gate** | `server/auth.ts` | `injectOrgContext` checks org `status` field: suspended → 403 `OBS-ORG-SUSPENDED`, deleted → 410 `OBS-ORG-DELETED`. Org status lookup failure → 503 in production (fail-closed). SSO session check failures now deny with 503 `OBS-AUTH-007` instead of silently allowing |
| **Timing-safe token comparison** | `assemblyai-webhook.ts`, `scim.ts` | All secret token comparisons use `crypto.timingSafeEqual()` to prevent timing-based attacks on webhook secrets and SCIM bearer tokens |
| **Sentry PHI redaction** | `server/services/sentry.ts` | Uses shared `redactPhi()` for selective PHI scrubbing in error messages, request bodies, and exception values. Preserves debugging context while removing SSN, phone, email, MRN patterns |
| **FAQ analytics PHI safety** | `server/services/faq-analytics.ts` | Sample queries stored in FAQ analytics are PHI-redacted via `redactPhi()` before persistence |
| **WAF log safety** | `server/middleware/waf.ts` | WAF violation logs use `req.path` (no query string) to prevent logging PHI from query parameters |
| **Idle timeout** | `client/src/hooks/use-idle-timeout.ts` | 15-min idle timeout with 2-min warning countdown. "Stay Logged In" button resets the timer. Logout clears session storage only (preserves user preferences in localStorage) |
| **Breach notification** | `server/services/incident-response.ts` | HIPAA §164.404 compliant breach notification: `sendBreachNotificationEmails()` sends templated notification to affected individuals, auto-updates breach report status, logs to audit trail. 60-day deadline tracked per §164.408 |
| **Incident persistence** | `server/db/schema.ts` | `security_incidents` and `breach_reports` tables with RLS policies. All creates/updates persisted to PostgreSQL with in-memory fallback |
| **Minimum necessary access** | `server/routes/clinical.ts` | Viewer role sees redacted PHI fields on clinical notes (subjective, objective, assessment, plan stripped). Managers/admins see full content for clinical workflows |

## Key Design Decisions
- **AWS SDK v3**: S3 (`@aws-sdk/client-s3`), Bedrock (`@aws-sdk/client-bedrock-runtime`), SES (`@aws-sdk/client-ses`), and Titan Embed use the modular AWS SDK v3. Credential resolution (`@aws-sdk/credential-providers`) supports env vars and EC2 instance metadata (IMDSv2)
- **Hybrid storage**: PostgreSQL for structured data + S3 for audio blobs. The IStorage interface abstracts this — CloudStorage (S3 JSON files) still works as an alternative backend
- **RAG as a plan feature**: RAG is gated by plan tier (`ragEnabled` in plan limits). Free tier doesn't include it
- **Graceful degradation**: Every infrastructure dependency (Redis, PostgreSQL, S3, Bedrock, Stripe) has a fallback or graceful failure mode. The app runs with just `ASSEMBLYAI_API_KEY` and `SESSION_SECRET` (in-memory storage, no AI analysis, no billing). When Bedrock fails, calls complete with default scores and the UI shows clear feedback
- **Auto schema sync**: `server/db/sync-schema.ts` runs idempotent DDL on startup, eliminating the need for migration tooling in production
- **Custom prompt templates**: Per-org, per-call-category evaluation criteria with required phrases and scoring weights
- **Dark mode**: Toggle in settings; Recharts dark mode fixes use `!important` in `index.css` (`.dark .recharts-*`)
- **Hooks ordering**: All React hooks in `transcript-viewer.tsx` MUST be called before early returns (isLoading/!call guards)
- **Clinical notes as embedded data**: Clinical notes are stored as a JSONB field within `call_analyses`, not a separate table — simplifies the data model and keeps notes tightly coupled with analysis
- **EHR adapter pattern**: `server/services/ehr/` uses an adapter interface (`IEhrAdapter`) so new EHR systems can be added without touching route logic. Per-org EHR config is stored in org settings
- **Style learning recency weighting**: Provider style analysis uses exponential decay (30-day half-life) to prefer recent notes, requires minimum 3 attested notes
- **A/B testing cost tracking**: Each A/B test records estimated costs for both models, enabling data-driven model selection decisions
- **Industry-aware registration**: Orgs set `industryType` at registration (general/dental/medical/behavioral_health/veterinary) which influences default prompt templates and available features
- **Billing enforcement gates**: Plan feature gating (`requirePlanFeature`), quota enforcement (`enforceQuota`, `enforceUserQuota`), and active subscription checks (`requireActiveSubscription`) are applied as middleware on write routes. All reject requests with missing `orgId` (403). On database errors, all four gates **fail closed** (return 503) rather than allowing the request through — this prevents billing bypass during transient DB outages but means users see errors during DB hiccups
- **AI response hardening**: `parseJsonResponse()` validates every field type, clamps scores to valid ranges, and provides safe defaults. `normalizeAnalysis()` also clamps on the read path. Server-side flag enforcement overrides AI-set flags
- **Per-org username uniqueness**: Usernames are unique within an org (composite index `orgId + username`), not globally. `getUserByUsername()` accepts optional `orgId` for scoped lookups. OAuth/SSO flows without org context search globally
- **Org-scoped rate limiting**: Authenticated data routes include `orgId` in rate limit keys so tenants sharing an IP (corporate networks) don't affect each other. Pre-auth routes (login, register) use IP-only keys
- **Search scope**: `searchCalls()` searches transcripts, analysis summaries, and topics (not just transcripts). Uses PostgreSQL full-text search (`plainto_tsquery` + GIN tsvector indexes) for queries >=2 chars, falls back to ILIKE for single-char queries. Set-based deduplication across result sources
- **PostgreSQL RLS for defense-in-depth**: Row-Level Security policies enforce tenant isolation at the database layer — even if application code has a bug, the DB rejects cross-org queries. `withBypassRls()` and `withOrgContext()` helpers in pg-storage.ts manage the `app.bypass_rls` and `app.org_id` session settings
- **KMS envelope encryption**: Per-org DEKs are generated by AWS KMS and stored encrypted in org settings. Actual PHI encryption uses the DEK (AES-256-GCM), not the master key — enabling efficient rotation. Format prefix (`enc_v1:` vs `enc_v2_{prefix}:`) allows per-field routing to the correct key
- **Dual-path transcription**: When `APP_BASE_URL` is set, AssemblyAI uses webhooks; otherwise polls. `continueAfterTranscription()` in call-processing.ts handles steps 4–15 of the pipeline for both paths
- **SCIM token architecture**: SCIM bearer tokens are never stored in plaintext — SHA-256 hash stored in org settings. `generateScimToken()` returns plaintext once (shown to admin), hash + prefix for storage. Token lookup scans `listOrganizations()` for hash match (suitable for current scale; add a DB index for high volume).
- **OIDC without a library**: OIDC is implemented using native `fetch` (discovery + token exchange) and Node.js `crypto` for RS256/ES256 JWT signature verification via JWKS. No `openid-client` dependency. `isoBase64URL` from `@simplewebauthn/server/helpers` handles encoding.
- **IDP-initiated SAML**: `validateInResponseTo: "IfPresent"` in `@node-saml/passport-saml` accepts assertions without a prior AuthnRequest. A second per-org ACS endpoint (`POST /api/auth/sso/callback/:orgSlug`) embeds the orgSlug in the URL so no RelayState is required. SP metadata advertises both ACS URLs.
- **Certificate rotation dual-cert**: The `ssoNewCertificate` field allows a second IDP cert to be valid alongside `ssoCertificate` during the rotation window. `parseCertExpiry()` decodes the DER `notAfter` field directly from the PEM without any X.509 library. Expiry is auto-computed and stored on settings save.
- **WebAuthn storage**: WebAuthn credentials (credentialId, COSE public key, sign counter) are stored as a JSONB array on the `users` row (`webauthn_credentials`). `@simplewebauthn/server` v13 is used; registration challenge is stored in the session (`req.session.webauthnChallenge`). Public keys are base64url-encoded for JSON storage.
- **Trusted device cookies**: After successful MFA, `trustDevice: true` in the request body generates a random 32-byte token. SHA-256(token) is stored in `user.mfaTrustedDevices[]` with a 30-day expiry. The cookie `mfa_td` holds `{userId}:{token}`. On login, the trusted device check runs before the MFA challenge — if valid, MFA is skipped for this device.
- **MFA grace period**: When an org first enables `mfaRequired`, `mfaRequiredEnabledAt` is stamped. Each user without MFA gets an `mfaEnrollmentDeadline` = `mfaRequiredEnabledAt + mfaGracePeriodDays` (default 7). During the grace period, login succeeds with `mfaSetupRequired: true`. After the deadline, login is rejected with a specific error code. Reminder emails are sent at 7, 3, and 1 day before the deadline.
- **Email OTP for non-admins**: A 6-digit OTP (10-minute TTL, 3 attempts max) is sent to the user's username/email. Restricted to viewer/manager roles — admin users must use TOTP or WebAuthn. Stored in an in-memory map keyed by userId (TTL too short to warrant DB overhead).
- **MFA recovery flow**: User submits a recovery request; server sends a time-limited verification token to the user's email. Admin sees pending requests in the admin panel and approves or denies. On approval, a use-token (15-min TTL) is emailed to the user, which completes login and clears MFA — forcing re-enrollment. All steps are HIPAA-audit-logged. Table: `mfa_recovery_requests`.

## CI/CD Pipeline

### GitHub Actions (`.github/workflows/ci.yml`)
Automated pipeline runs on push to `main` and all PRs:

| Job | Description | Gate |
|-----|-------------|------|
| **Lint & Format** | ESLint (zero-warning policy) + Prettier check | Blocks build |
| **Type Check & Tests** | `tsc` + unit tests with c8 coverage | Blocks build |
| **Security Audit** | `npm audit --audit-level=high` + secret scanning (AWS keys, private keys, API tokens) | Blocks deploy |
| **Build** | Vite frontend + esbuild backend, artifact verified | Requires lint + test |
| **Docker** | Multi-stage build, pushes to GHCR on main | Requires lint + test |
| **E2E Tests** | Playwright Chromium against production build | Requires build |
| **Quality Gate** | Explicit gate requiring all above jobs | Blocks all deploys |
| **Deploy Staging** | Auto on main push via Render deploy hook + health check | Requires quality gate |
| **Deploy Production** | Manual only (`workflow_dispatch`), GitHub Environment approval | Requires quality gate |

### Nightly CI (`.github/workflows/nightly.yml`)
Runs every night at 2 AM UTC (also manually triggerable):
- Full test suite with c8 coverage
- TypeScript type check
- ESLint warning count tracking
- `npm audit` security scan
- Secret scanning
- Build verification + schema sync validation
- Creates a GitHub issue with label `nightly-failure` if any check fails

### Weekly Dependency Check (`.github/workflows/dependency-check.yml`)
Runs every Monday at 8 AM UTC (also manually triggerable):
- `npm audit` at all severity levels with detailed breakdown
- `npm outdated` for stale packages
- License compliance check (scans for GPL/AGPL/SSPL in production dependencies)
- Creates a GitHub issue with label `dependency-review` summarizing findings

### Automated PR Review (`.github/workflows/pr-review.yml`)
Runs on all pull requests:
- Lint + type check + unit tests
- ESLint warning regression detection (compares PR against main branch)
- Secret scanning on changed files only
- PR size check (warns if > 500 lines changed, fails if > 2000)
- Auto-labels PRs based on changed files (`security`, `frontend`, `backend`, `database`, `tests`, `ci-cd`, `docs`)
- Posts PR comment with results summary

### Docker
- **Dockerfile**: Multi-stage (builder → production), non-root user, tini init, health check via `fetch()`
- **docker-compose.yml**: App + workers + PostgreSQL 16 (pgvector) + Redis 7
- **docker-compose.prod.yml**: Blue-green deployment overrides with memory limits and log rotation
- **`.dockerignore`**: Excludes tests, docs, dev files

## Deployment

### EC2 (Production HIPAA) — `deploy/ec2/`
```
Internet → Caddy (:443, auto TLS) → Node.js (:5000) → PostgreSQL + S3 + Bedrock + AssemblyAI
```
- EC2 t3.micro + Caddy for TLS + systemd for process management
- IAM instance role for S3 + Bedrock (no hardcoded AWS keys)
- **Auto-rollback**: deploy.sh saves previous SHA before deploy; if health check fails, automatically rolls back to previous version, rebuilds, and restarts
- **Pre-flight validation**: required env vars (`DATABASE_URL`, `ASSEMBLYAI_API_KEY`, `SESSION_SECRET`, `PHI_ENCRYPTION_KEY`) are hard-checked before deploy in production; use `--force` to skip
- Estimated ~$13/month (after free tier)
- See `deploy/ec2/README.md` for full setup guide

### Render.com (Staging / Non-PHI)
- Build: `npm run build`, Start: `npm run start`
- Env vars in Render dashboard
- IaC via `render.yaml` (web + worker + Redis + PostgreSQL)
- URL: `https://observatory-qa-product.onrender.com`
- Uses Neon PostgreSQL (external), Render Redis
- **Required env vars**: `ASSEMBLYAI_API_KEY`, `SESSION_SECRET`, `DATABASE_URL`, `STORAGE_BACKEND=postgres`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `S3_BUCKET` (for audio storage), `REDIS_URL`
- **Port**: Render expects port 10000 — set `PORT=10000`

### Build Output
- Frontend: `dist/client/` (Vite)
- Backend: `dist/index.js` (esbuild)
- Workers: `dist/workers.js` (esbuild)

Server serves both API and static frontend from the same process.

## Startup Sequence (server/index.ts)
1. Initialize Redis (sessions, rate limiting, pub/sub)
2. Initialize PostgreSQL storage (if configured) — runs `syncSchema(db)` to auto-create/update tables
3. Initialize BullMQ job queues
4. Set up auth (load env users, resolve org IDs, create orgs if needed)
5. Register all API routes
6. Set up Vite (dev) or serve static files (prod)
7. Start HTTP server
8. Set up WebSocket
9. Schedule background tasks (`server/scheduled/`) — wall-clock aligned via `scheduleDaily`/`scheduleWeekly`
10. Register graceful shutdown handlers (close queues, Redis, DB, cancel scheduled tasks)

## Common Gotchas
- **API list endpoints return raw arrays**: All GET endpoints that return collections (`/api/calls`, `/api/employees`, `/api/access-requests`, `/api/coaching`, `/api/prompt-templates`, `/api/admin/users`, `/api/api-keys`, `/api/feedback`) return raw `T[]` arrays. Do NOT wrap responses in pagination objects (`{ data, total, limit, offset, hasMore }`) — all frontend consumers expect raw arrays and will crash if they receive wrapper objects (`.filter()` / `.map()` on non-arrays causes ErrorBoundary). The `paginateArray()` helper in `server/routes/helpers.ts` exists but is currently unused
- **CSRF cookie respects `DISABLE_SECURE_COOKIE`**: Both the session cookie and CSRF cookie check `process.env.DISABLE_SECURE_COOKIE` before setting `secure: true`. Without this, the CSRF cookie won't be sent over HTTP in development/testing
- **ErrorBoundary logs error name+message**: `componentDidCatch` logs `error.name` and `error.message` to console (safe for HIPAA — framework errors don't contain PHI). Full stack traces only logged in non-production. Check browser console for "UI error boundary triggered:" when debugging render crashes
- AI responses may contain objects where strings are expected — always use `toDisplayString()` on frontend and `normalizeStringArray()` in `server/storage/types.ts` when rendering/storing AI data
- **AI analysis failure is graceful**: When Bedrock is unavailable (bad credentials, region, permissions), calls still complete with default scores (5.0, neutral sentiment). The `confidenceFactors.aiAnalysisCompleted` flag tracks this. The UI shows an amber banner and hides fake scores when this happens
- **`AI_PROVIDER` env var is NOT used** — the code always uses Bedrock exclusively. Don't be confused by legacy comments referencing multiple providers
- **AWS Bedrock 403 errors**: Usually means invalid credentials, missing `bedrock:InvokeModel` IAM permission, or model not enabled in the target region. Remove `AWS_SESSION_TOKEN` unless using temporary STS credentials
- The same IAM user is shared across multiple projects — IAM policy covers S3, Bedrock, and Textract
- Recharts uses inline styles that override CSS; dark mode fixes use `!important`
- TanStack Query key format: `["/api/calls", callId]` — used for caching
- In-memory storage loses all data on restart — only use for dev without cloud credentials
- `AUTH_USERS` format changed from `user:pass:role:name` to `user:pass:role:name:orgSlug` — the 5th field is optional (defaults to `DEFAULT_ORG_SLUG`)
- Stripe webhook endpoint needs raw body (`express.raw()`) — configured before `express.json()` in `server/index.ts`
- pgvector extension must be installed manually: `CREATE EXTENSION IF NOT EXISTS vector;`
- Workers must run as a separate process in production (`npm run workers`). Without Redis, job processing falls back to in-process execution
- When adding new storage methods: update `IStorage` interface in `types.ts`, then implement in `memory.ts`, `cloud.ts`, and `pg-storage.ts`
- **Schema sync on startup**: `sync-schema.ts` auto-creates tables/columns, so `drizzle-kit push` is not needed in production. Schema changes should be added to both `schema.ts` (for Drizzle) and `sync-schema.ts` (for runtime sync)
- **SSO pre-flight validation**: Always use `/api/auth/sso/check/:orgSlug` before redirecting to `/api/auth/sso/:orgSlug` — prevents users seeing raw JSON error pages for invalid org slugs
- **Font**: App uses Poppins (loaded via Google Fonts in `index.css`), chosen to match the Observatory logo typeface. Defined in `--font-sans` CSS variable
- **Landing page wave animation**: Uses SVG SMIL `<animate>` elements on `<linearGradient>` stops for a traveling spark effect. CSS only handles `wave-drift` for gentle positional movement
- **Clinical note PHI encryption**: PHI fields (subjective, objective, assessment, HPI) are encrypted with AES-256-GCM before storage and decrypted on retrieval in clinical routes. `encryptField()` **throws in production** if `PHI_ENCRYPTION_KEY` is not set — never stores plaintext PHI in production. `decryptClinicalNotePhi()` accepts an optional `PhiDecryptionContext` for HIPAA audit logging of every decryption event
- **EHR adapters**: Open Dental uses developer key + customer key auth; Eaglesoft uses eDex API with X-API-Key header. Config stored in `org.settings.ehrConfig`
- **Document versioning is a linked list**: Each `ReferenceDocument` has `previousVersionId` pointing to its predecessor. Creating a new version deactivates the old one (`isActive: false`) and purges its chunks. Version history is reconstructed by walking `previousVersionId` chain + scanning for forward references
- **RAG citations flow through return values**: `loadReferenceContext()` returns `{ documents, citations }`, `loadPromptTemplate()` returns `{ template, citations }`, and `runAiAnalysis()` returns `{ aiAnalysis, citations }`. Citations are threaded per-call through the return chain (no module-global state). Attached to `confidenceFactors.ragCitations[]` in the analysis
- **Web URL sources use native fetch**: No Cheerio/Puppeteer dependency — HTML is stripped via regex (script/style/nav/footer/header tags removed, then all tags stripped). Sufficient for most documentation pages. 15-second timeout prevents hanging on slow servers
- **Blind calibration is route-level enforcement**: `blindMode` is stored on the session, but score visibility is enforced in the GET endpoint — if `blindMode && status !== "completed"`, only the requesting user's evaluation is returned. This avoids needing separate database queries or access control tables
- **Evaluator certification thresholds**: Certified = 5+ sessions with avgDeviation < 1.0 from consensus. Probationary = 3+ sessions with avgDeviation < 2.0. Flagged = 3+ sessions with avgDeviation >= 2.0. Trend detection compares last 3 deviations vs prior 3 (±0.3 threshold)
- **IRR metrics are computed on-the-fly**: Krippendorff's alpha and ICC are calculated per-request, not stored. For orgs with < 100 completed sessions, this is fast enough. Consider caching in org settings for larger volumes
- **Automated call selection is heuristic-based**: Calibration value scoring uses weighted criteria (borderline AI scores = 5 points, manual edits = 4, recency = 3, etc.) rather than ML. This is transparent and explainable to QA managers
- **A/B test statistical significance uses Welch's t-test**: Handles unequal sample sizes and variances. P-value approximated via Abramowitz & Stegun normal CDF complement. 95% CI uses t-critical ≈ 2.0 (conservative for small samples). Tests with p < 0.05 marked as significant
- **A/B batch tests share a batchId**: Each file in a batch creates a separate ABTest record linked by `batchId` (UUID). Files are processed in parallel (async). Batch status endpoint aggregates counts across all records
- **A/B recommendations require 3+ completed tests per model pair**: Below this threshold, the system advises "continue testing". At 10+ tests, confidence is "high". Cost and latency comparisons included in recommendation text
- **Clinical templates are in-memory**: `clinical-templates.ts` is a static library of pre-built templates, not database-stored. Templates cover 10+ specialties across SOAP, DAP, BIRP, and procedure note formats
- **A/B tests run models in parallel**: Uses `Promise.allSettled()` so one model failure doesn't block the other
- When adding new storage methods for A/B tests or usage records: update `IStorage` interface in `types.ts`, then implement in `memory.ts`, `cloud.ts`, and `pg-storage.ts`
- **`getUserByUsername()` signature**: Accepts optional `orgId` parameter. When adding new callers, pass `orgId` when available (admin, registration, SSO login). OAuth and password-reset may not have org context — global lookup is acceptable there
- **Username uniqueness is per-org**: The DB unique index is on `(orgId, username)`, not global `username`. Same email can exist in multiple orgs. The old global index was dropped in `sync-schema.ts` migration
- **WebSocket `broadcastCallUpdate()` requires `orgId`**: The `orgId` parameter is mandatory (not optional). All callers in calls.ts, admin.ts, and ab-testing.ts already pass it
- **Quota/plan middleware rejects missing `orgId`**: `enforceQuota()`, `enforceUserQuota()`, `requirePlanFeature()`, and `requireActiveSubscription()` return 403 if `req.orgId` is missing — they do NOT silently allow requests without org context
- **Billing gates fail closed on DB errors**: `enforceQuota()`, `enforceUserQuota()`, `requirePlanFeature()`, and `requireActiveSubscription()` return 503 (not next()) when the database is unreachable. This is intentional — failing open would allow free accounts to access paid features during outages
- **WAF uses recursive URL decoding**: `scanRequest()` in `waf.ts` decodes URLs up to 3 times to catch double/triple-encoded payloads (e.g., `%252e%252e` → `%2e%2e` → `..`). The loop exits early when decoding produces no change
- **Prompt injection detection strips zero-width Unicode**: `normalizeForDetection()` in `ai-guardrails.ts` strips zero-width spaces (U+200B), zero-width joiners (U+200D), soft hyphens (U+00AD), and other invisible characters before pattern matching. This prevents attackers from splitting keywords with invisible chars
- **Audit log timestamp is application-set**: `persistAuditEntry()` explicitly sets `createdAt` to the application-level timestamp used for hash computation (not PostgreSQL's `defaultNow()`). This ensures `verifyAuditChain()` can recompute matching hashes. Pre-existing entries may have mismatched timestamps
- **FHIR export decrypts nested cosignature NPI**: `decryptClinicalNotePhi()` decrypts both top-level PHI fields and nested `cosignature.cosignedNpi`. The cosigner NPI is included in the FHIR Practitioner resource as an additional identifier with type "Cosigner NPI"
- **EHR prefill surfaces lookup failures**: The prefill endpoint returns `ehrLookupFailed: true` and `ehrLookupError` when EHR patient data retrieval fails, instead of silently returning empty allergies/medications. Frontend should display a warning banner when this flag is present
- **Daily task orchestrator is error-isolated**: Each task in `runAllDailyTasks()` is wrapped in its own try-catch. A failure in one task (e.g., audit chain verification) does not prevent other tasks (e.g., retention purge, quota alerts) from running
- **AI response validation**: `parseJsonResponse()` in `ai-provider.ts` clamps `performanceScore` to 0-10, sentiment scores to 0-1, sub-scores to 0-10, and validates all field types. Missing fields get safe defaults (5.0 for scores, "neutral" for sentiment). `normalizeAnalysis()` in `storage/types.ts` also clamps on read
- **Empty transcript handling**: If transcript text is <10 characters, the pipeline saves the call with `empty_transcript` flag, low confidence, and skips AI analysis entirely — prevents generating junk analysis from silence/noise
- **Employee auto-assignment safety**: Only considers active employees. If multiple employees match the detected name, prefers exact full-name match; skips assignment if ambiguous (logs the ambiguity)
- **speakerRoleMap schema change**: Changed from `z.object({ agentSpeaker: z.string() })` to `z.record(z.string(), z.string())` to support proper speaker label → role mapping (e.g., `{ A: "agent", B: "customer" }`). Old `{ agentSpeaker: "A" }` format was a logic error — the property name was always the literal string "agentSpeaker" instead of using the value as a key
- **Filler word detection uses bigrams**: `computeSpeechMetrics()` now detects two-word filler phrases ("you know", "i mean", etc.) via a bigram pass before single-word matching. Words matched as part of a bigram are excluded from the single-word pass to avoid double-counting
- **Speaker role detection priority**: `detectSpeakerRolesFromTranscript()` runs before org config and hardcoded defaults. Priority: (1) AI-detected agent name + self-introduction context, (2) greeting pattern scoring (agent phrases vs customer phrases), (3) `org.settings.defaultSpeakerRoles`, (4) `{ A: "agent", B: "customer" }`. Returns `null` for inconclusive detection (fewer than 5 words, single speaker, no pattern matches)
- **Prerequisite order in paths** — `enforceOrder` field on `LearningPath` signals that modules must be completed sequentially (index N requires index N-1 completed); combined with per-module `prerequisiteModuleIds` for flexible gating
- **`toDisplayString()` handles nested objects**: Checks arrays first (before object path), then `text`, `name`, `task`, `label`, `value`, `description`, `message` keys for wrapped strings, caps JSON fallback at 500 chars
- **Duplicate upload returns 409**: `POST /api/calls/upload` returns `409 { duplicate: true, existingCallId }` when file hash matches an existing call. Frontend should handle this status code and show the user a link to the existing call instead of a generic error
- **RLS bypass required for schema-sync**: `syncSchema()` sets `app.bypass_rls = 'true'` at the session level before creating tables/policies, since RLS would otherwise block DDL operations. All pgvector and super-admin cross-org queries must use `withBypassRls()`
- **Org status gate adds latency**: `injectOrgContext` now does an async org status lookup on every authenticated request. For high-traffic deployments, consider a short-lived org status cache (TTL ~30s is already used in some implementations)
- **GDPR purge is irreversible**: `deleteOrgData()` deletes employees, calls, and users but preserves the org record (status=deleted) for audit trail. The session is destroyed immediately after purge. Backups should be the recovery path
- **AssemblyAI webhook verification**: `POST /api/webhooks/assemblyai` checks `X-Assembly-Webhook-Token` header against `ASSEMBLYAI_WEBHOOK_SECRET` (falls back to `SESSION_SECRET`). Register this endpoint as the webhook URL in your AssemblyAI account
- **SCIM `listOrganizations()` scan**: SCIM auth scans all orgs to match the token hash. This is fine at current scale. For >1000 orgs, add a dedicated `scim_token_hash` index on the `organizations` table.
- **OIDC state map is in-memory**: OIDC `state` → `{ orgSlug, nonce, expiresAt }` entries expire after 10 minutes and are purged every 5 minutes. In a multi-instance deployment, OIDC state must be moved to Redis (otherwise state from one instance won't be found by another).
- **JWKS cache is in-memory per instance**: The `jwksCache` Map caches IDP public keys for 1 hour. Multi-instance deployments each maintain their own cache — this is fine since JWKS is public.
- **WebAuthn rpID must match origin**: The `rpID` (relying party ID) in WebAuthn is derived from the hostname (e.g. `observatory-qa.com`). It must match what the browser sees. In development, `localhost` works. Behind a reverse proxy, ensure the correct hostname is used. The `expectedOrigin` (full URL) must also match exactly.
- **WebAuthn challenge stored in session**: `req.session.webauthnChallenge` holds the current registration or authentication challenge. Sessions must be persistent (Redis or DB-backed) across the two WebAuthn round-trips. In-memory sessions will lose the challenge.
- **Trusted device cookie `mfa_td`**: The cookie stores `{userId}:{base64url-token}` and is `httpOnly`, `sameSite=lax`, `secure` in production. Clearing this cookie or changing devices always prompts for MFA. `mfaTrustedDevices` entries are pruned on each login (expired ones removed automatically).
- **MFA grace period deadline is per-user**: `mfaEnrollmentDeadline` is set on each user when the org enables `mfaRequired`. Users created *after* `mfaRequiredEnabledAt` have a deadline of `createdAt + mfaGracePeriodDays`. Admins are NOT subject to the grace period — they must enable MFA immediately.
- **Email OTP is viewer/manager only**: Admin accounts cannot use email OTP as a fallback. This is intentional — email OTP is lower security than TOTP/WebAuthn and admins have higher privilege. If an admin loses their TOTP device, they must use the recovery flow (email verification + admin approval from another admin or super-admin).
- **OBS-AUTH-006**: New error code returned when an SSO user's session exceeds `ssoSessionMaxHours`. The response includes `requiresSso: true` so the frontend can redirect directly to `/api/auth/sso/{orgSlug}` instead of the generic login page.
- **OBS-AUTH-008 login ambiguity**: When a username exists in multiple orgs, login returns 409 with `{ errorCode: "OBS-AUTH-008", orgSlugs: [...] }`. The frontend shows an org selector and re-submits with `{ username, password, orgSlug }`. The strategy uses `getOrganizationBySlug()` (not `listOrganizations()`) for the scoped lookup. Call sites that intentionally skip org-scoping (password-reset, OAuth, IDP-initiated SAML) are NOT affected — they still use `getUserByUsername()` without orgId.
- **Cost estimation functions in `server/services/cost-estimation.ts`**: `estimateBedrockCost()` and `estimateAssemblyAICost()` are pure math functions with no external deps. Previously duplicated in routes/ab-testing.ts and imported by call-processing.ts and emails.ts from routes. Now canonical location is the service module; routes/ab-testing.ts imports from there.
- **Utility functions in `server/utils/helpers.ts`**: `safeFloat`, `safeInt`, `withRetry`, `parseDateParam`, `parsePagination` moved from routes/helpers.ts to server/utils/helpers.ts. `routes/helpers.ts` re-exports them for backward compatibility — existing route-file imports are unchanged. Services import directly from `../utils/helpers`.
- **Scheduled tasks use wall-clock UTC alignment**: `scheduleDaily(utcHour, fn)` and `scheduleWeekly(dayOfWeek, utcHour, fn)` in `server/scheduled/scheduler.ts` use setTimeout chains that recompute the delay after each run. Daily tasks run at 2:00 UTC, weekly digest at Monday 8:00 UTC. No setInterval drift.
- **`APP_URL` is not used**: The canonical env var is `APP_BASE_URL`. `APP_URL` was previously referenced in 3 locations and has been replaced.
- **Team scoping returns null for no restriction**: `getTeamScopedEmployeeIds()` returns `null` (not an empty Set) when there is no restriction — null means "unrestricted", an empty Set means "access to zero employees". Always check `if (teamIds !== null)` before filtering.
- **Call share token only returned at creation**: `POST /api/calls/:id/shares` returns the full 48-hex token once. Subsequent `GET /api/calls/:id/shares` only returns `tokenPrefix` (first 8 chars) for display. This mirrors the API key pattern.
- **Call shares in cloud.ts use in-memory token lookup**: `getCallShareByToken()` in CloudStorage searches an in-memory Map populated at `createCallShare()` time. In multi-instance deployments, replace with a dedicated S3 index or move to PostgreSQL.
- **`checkApiKeyScope()` is a no-op for session auth**: The middleware checks `req.apiKeyScopes` and returns `next()` immediately if it's undefined — which it is for all session-authenticated requests. This means scope checks are additive, not breaking, for existing session-based flows.
- **`GET /api/coaching/my` match priority**: Matches caller's employee record first by email (exact match on `employee.email === user.username`), then by display name (`employee.name === user.name`). If multiple name matches exist, returns 409 to avoid returning the wrong employee's sessions.

## In-Progress Work (resume here in a new session)

### Branch: `claude/audit-and-prioritize-GydTL`

#### ✅ Completed & committed: Comprehensive codebase audit & fixes (13 commits)
Full audit of 108K LOC across 360 files with priority-ordered ratings and fixes. ~60 files changed, 1,468 tests passing.

**Commit 1 — Server-side security & cleanup (`9041a0e`):**
- **CSRF bypass fix** — changed from checking any `x-api-key` header to requiring `Bearer obs_k_` prefix; added CSRF exemptions for SCIM, SSO callback, AssemblyAI webhook
- **WAF crash fix** — wrapped `decodeURIComponent` in try-catch for malformed percent-encoding
- **Dead code removal** — removed unused `SESSION_ABSOLUTE_MAX_MS` local declaration in `setupAuth()`
- **LRU cache** — replaced FIFO orgCache Map with proper `LruCache` utility in `auth.ts`
- **Pagination fix** — applied unused `parsePagination` limit/offset to coaching endpoint response

**Commit 2 — Tenant isolation fixes (`6adbe8d`):**
- **Missing `injectOrgContext` on marketing routes** — all 13 routes were bypassing org suspension/deletion checks
- **Missing `injectOrgContext` on LMS routes** — all 16 routes had the same tenant isolation bypass
- **AssemblyAI webhook empty-token bypass** — now rejects requests when no secret is configured (was silently accepting all payloads)
- **SSO session cache optimization** — `requireAuth` SSO check now uses `getCachedOrganization()` instead of direct DB call

**Commit 3 — Client-side fixes (`378ffa7`):**
- **CSRF cookie name mismatch** — `file-upload.tsx` was reading `csrf_token` (underscore) but server sets `csrf-token` (hyphen); XHR uploads had no CSRF protection
- **Idle timeout warning bypass** — any mouse movement dismissed the 2-min warning; now requires explicit "Stay Logged In" click (HIPAA compliance)
- **ErrorBoundary wrong route** — "Go to Dashboard" button navigated to `/dashboard` which doesn't exist (dashboard is at `/`)

**Commit 4 — CLAUDE.md documentation (`666c03b`):**
- Documented audit findings, remaining issues, and ratings

**Commit 5 — CI/CD fixes (`9e7b12e`):**
- **E2E credential alignment** — CI workflow and Playwright config now use matching credentials
- **Docker port binding** — PostgreSQL and Redis bound to `127.0.0.1` only (was `0.0.0.0`)
- **Security gates Docker builds** — security job now required before Docker image push

**Commit 6 — Data loss fixes (`a3225d7`):**
- **Analysis mapper** — added 6 missing fields (speechMetrics, selfReview, scoreDispute, patientSummary, referralLetter, suggestedBillingCodes) that existed in DB but were never returned on read
- **updateUser** — now handles mfaEnabled, mfaSecret, mfaBackupCodes, subTeam, webauthnCredentials, mfaTrustedDevices, mfaEnrollmentDeadline (was only name, role, passwordHash)
- **Automation rule bug** — removed dead setClause code where name update incorrectly overwrote is_enabled
- **DB SSL** — `rejectUnauthorized` now defaults to `true` (was `false`, defeating TLS)

**Commit 7 — Schema drift fixes (`b5d3903`):**
- **5 missing analysis columns** — scoreRationale, promptVersionId, speakerRoleMap, detectedLanguage, ehrPushStatus added to Drizzle + sync-schema + mapper + create/update
- **deleteOrgData completeness** — added 11 missing tables to GDPR right-to-erasure
- **Dead BAA table** — removed unused `baaRecords` Drizzle definition
- **ICD-10 regex** — insurance narrative schema now accepts U-codes (COVID-19)

**Commit 8 — Code quality + roadmap (`f3e7e10`):**
- **promptTemplateCache** — replaced unbounded Map with LruCache (500 entries, 5-min TTL)
- **Feedback pagination** — applied parsePagination limit/offset to response
- **Users Drizzle schema** — added 3 missing columns (webauthnCredentials, mfaTrustedDevices, mfaEnrollmentDeadline)
- **Improvement backlog** — expanded all categories with effort/impact estimates and sprint assignments

**Commit 9 — Rate limit + session invalidation (`d663ae6`):**
- **Rate limit key normalization** — UUID segments in `req.path` replaced with `:id` placeholder so PHI rate limits apply per-endpoint-class, not per-call-ID
- **Session invalidation after password reset** — new `invalidateUserSessions()` utility scans Redis sessions and destroys all for the target user; called from both password-reset and admin password-change flows
- **Admin.ts refactor** — 30 lines of inline Redis SCAN code replaced with 4-line utility call

**Commit 10 — Transaction support (`083fa2d`):**
- **IStorage.withTransaction** — new interface method implemented in all 3 backends (PostgresStorage: real Drizzle tx with db-swap pattern; MemStorage/CloudStorage: no-op wrappers)
- **Call processing pipeline** — transcript + sentiment + analysis + status update wrapped in atomic transaction (main, batch, and empty-transcript paths)
- **Live session** — createCall + createTranscript + createSentimentAnalysis wrapped in transaction

**Commit 11 — Invitation hashing + CSRF protection (`58d98c1`):**
- **Invitation token hashing** — SHA-256 before storage (matching API key/password reset pattern); tokenPrefix column for admin display; backward-compatible plaintext fallback for 7-day expiry window
- **csrfFetch utility** — drop-in fetch() replacement that auto-attaches CSRF token + credentials
- **CSRF migration** — 15 client files (40+ fetch calls) migrated from raw fetch() to csrfFetch()

**Commit 12 — asyncHandler Phase 1 (`197d9c8`):**
- **coaching.ts** — 29 catch blocks → 1 (gamification side-effect preserved)
- **onboarding.ts** — 28 catch blocks → 13 (file cleanup, S3/RAG error handling preserved)
- **mfa.ts** — 21 catch blocks → 2 (session callbacks, WebAuthn verification preserved)
- **Net: -284 lines** of boilerplate eliminated, 62 catch blocks removed

#### Remaining issues identified (not yet fixed)
**P1 (High):**
- Super-admin N+1 queries (300+ DB queries per request for 100 orgs)
- `checkAndAwardBadges` loads ALL org calls into memory for badge checks
- Analytics routes load unbounded datasets (OOM risk for large orgs)

**P1 (Client):**
- `AudioRecorder` cleanup stale closure doesn't revoke blob URL on unmount

**P2 (Medium):**
- ~380 `as any` casts across 68 server files (82 in pg-storage.ts alone)
- 290 ESLint `no-unused-vars` warnings
- ~330 remaining catch blocks across 26 route files for asyncHandler Phase 2
- Duplicate URL validation utilities (`url-validation.ts` + `url-validator.ts`)
- Live session Maps have no hard cap (7 unbounded Maps)
- `request-metrics.ts` unbounded key growth (each UUID creates a new key)
- Missing `htmlFor`/`id` pairing on multiple form labels (a11y)
- `useIsMobile` returns false on first render causing layout shift on mobile

### Branch: `claude/evaluate-qa-rag-integration-MrMze`

#### ✅ Completed & committed: RAG improvements adapted from ums-knowledge-reference
Cross-repository evaluation: identified patterns from the single-tenant UMS Knowledge Reference RAG tool that can improve Observatory QA's multi-tenant RAG subsystem. Implemented 12 improvements (bidirectional):

- **Adaptive query-type weights** (`rag.ts`) — `classifyQueryType()` classifies RAG queries into 4 types (template_lookup, compliance_question, coaching_question, general) with type-specific semantic/keyword weight balances. Auto-applied in `searchRelevantChunks()` unless caller overrides
- **Confidence score reconciliation** (`rag.ts`) — `reconcileConfidence()` cross-checks LLM confidence tags against retrieval effective scores. Enhanced `computeConfidence()`: 65/35 top/avg blending (was 60/40), single-result 15% penalty, thresholds recalibrated to 0.42/0.30/0.15
- **RAG trace observability** (`rag-trace.ts`) — `RagTrace` interface expanded with `queryType`, `semanticWeight`, `keywordWeight`, `retrievedChunkIds[]`, `retrievalScores[]`, `confidenceReconciled`, `inputTokens`, `outputTokens` for per-query debugging
- **Domain synonym expansion** (`rag.ts`) — 5 industry-specific synonym maps (dental: 13 groups, medical: 16, behavioral health: 13, veterinary: 8, general: 10). Bidirectional lookup via `expandQueryWithSynonyms()`. Only single-token synonyms appended to reduce BM25 noise
- **Table-aware chunking** (`chunker.ts`) — Tables (pipe/tab-delimited, ≥2 rows) preserved as single chunks to maintain row/column relationships. Tables >3x chunk size split normally. `preserveTables` option (default: true)
- **Page number tracking** (`chunker.ts`) — `pageNumber` field on `DocumentChunk`. Form feed markers (`\f`) map char offsets to 1-indexed page numbers. Enhanced section header detection: numbered sections ("1.2.3 Title") and colon-suffixed headers ("Coverage Criteria:")
- **Embedding Redis cache** (`embeddings.ts`) — Two-tier cache: L1 in-memory LRU + L2 Redis (1-hour TTL, `emb:titan:` prefix). Redis promotion to L1 on hit. Fire-and-forget writes. Graceful fallback when Redis unavailable
- **Cross-org FAQ patterns** (`faq-analytics.ts`) — `getCrossOrgFaqPatterns()` aggregates query patterns across all tenants with 3-org minimum for anonymization. Surfaces common knowledge gaps for platform intelligence
- **Structured reference short-circuit** (`rag.ts`, `onboarding.ts`) — `classifyQueryRoute()` detects pure metadata queries (template lookups, document counts) and answers directly from the database, saving 2-4 seconds and Bedrock costs. Falls through to RAG if structured answer not found
- **Query reformulation** (`rag.ts`) — `reformulateWithContext()` detects follow-up questions (short queries with pronouns) and prepends conversation context for standalone embedding/search
- **Bedrock prompt caching** (`bedrock.ts`) — `cachePoint` block in Converse API system prompt enables Bedrock to cache system prompt prefix across requests, reducing input token costs by up to 90%
- **Response style configuration** (`rag.ts`, `onboarding.ts`) — `RESPONSE_STYLE_CONFIG` with concise (2K tokens, 4 chunks), detailed (4K, 6 chunks), and comprehensive (8K, 10 chunks) presets. RAG search endpoint accepts `responseStyle` parameter
- **49 tests** (`tests/rag-ums-adaptations.test.ts`) — query classification, adaptive weights, confidence reconciliation, synonym expansion, table preservation, page tracking, cross-org FAQ, query routing, reformulation, response styles

### Branch: `claude/codebase-audit-evaluation-MhG8w`

#### ✅ Completed & committed: Comprehensive codebase audit
- Full audit of ~80K LOC codebase: security, HIPAA, code quality, testing, UI/UX, architecture, pricing/viability
- Ratings and priority rankings for all 19 categories (see audit report in conversation history)
- ~67 improvement backlog items added to CLAUDE.md, with priority ordering

#### ✅ Completed & committed: P0 Security & data integrity fixes
- **Prompt injection hardening** — HTML entity decoding (`&lt;system&gt;`), comment stripping (`<!-- -->`), input truncation (10KB ReDoS prevention), 4 new tag patterns (`</knowledge_source>`, `<human>`, `<tool_result>`, `<function_result>`)
- **PHI redaction gaps** — NPI numbers (labeled + contextual), FHIR resource UUIDs (`Patient/uuid`), encounter/visit IDs
- **PHI decryption failure handling** — isolated try/catch returns 503 + `OBS-PHI-001` + audit event instead of generic 500
- **MFA recovery token race** — atomic claim pattern with rollback on failure
- **Empty embedding corruption** — `generateEmbeddingsBatch()` returns null (not `[]`) for failed chunks; pgvector `IS NOT NULL` filter excludes them

#### ✅ Completed & committed: P1 Performance, security & reliability fixes
- **LRU cache utility** (`server/utils/lru-cache.ts`) — TTL-aware LRU replaces FIFO pattern in 3 locations (embeddingCache, refDocCache, orgProviderCache)
- **Upload deduplication lock** — in-memory hash lock set prevents TOCTOU race on concurrent duplicate uploads
- **RAG config clamping** — topK [1,100], weights [0,1], multiplier [1,10]
- **Session secret fail-fast** — production startup fails on "dev-secret" or <32 chars
- **API key staleness warning** — keys >90 days get `X-API-Key-Warning` header + warn log

#### ✅ Completed & committed: CI/CD improvements
- **Coverage thresholds** — `c8 --check-coverage --lines 70 --functions 60 --branches 55`
- **Docker push to GHCR** — main merges push images with SHA + latest tags; PR builds validate only
- **Schema column validation** — TypeScript test replaces grep-only CI check; compares columns per table (45 tests)
- **Build artifact retention** — increased from 1 day to 7 days
- **npm audit fix** — resolved high-severity lodash vulnerability
- **Lint budget** — updated from 253 to 275 (pre-existing vars exposed by asyncHandler conversions)

#### ✅ Completed & committed: Code quality & architecture improvements
- **Global error handler** — `globalErrorHandler` registered as final Express middleware; handles `AppError` + HIPAA-safe generic messages
- **asyncHandler adoption** — 11 route files converted (employees, access, health, benchmarks, dashboard, insights, feedback, export, spend-tracking, patient-journey, marketing); ~43 catch blocks eliminated
- **asyncHandler type widened** — `Promise<void | unknown>` to accommodate `return res.json()` patterns
- **Team scoping TOCTOU fix** — pre-compute scope before fetch; return 404 instead of 403
- **N+1 query fix** — `analyzeAndStoreEditPatterns` uses batch-loaded `call.analysis` instead of 500 individual queries
- **UUID validation** — added `validateUUIDParam` to 7 critical PHI call routes + employee update

#### ✅ Completed & committed: Large file decomposition
- **clinical.ts** — 1,928→1,194 lines (-38%); extracted `clinical-compliance.routes.ts` (283 lines: amendments, FHIR, cosign) + `clinical-analytics.routes.ts` (312 lines: style learning, population analytics, prefill, custom templates)
- **admin.ts** — 1,380→625 lines (-55%); extracted `admin-security.routes.ts` (770 lines: audit logs, WAF, incidents, breach reports, GDPR, vocabulary, MFA recovery)
- **pg-storage.ts** — 3,795→2,279 lines (-40%); extracted `pg-storage-features.ts` (1,580 lines via prototype mixin: A/B tests, LMS, gamification, revenue, calibration, marketing, provider templates, deleteOrg)

#### ✅ Completed & committed: UI/UX improvements
- **ProtectedRoute stale permissions** — `staleTime: Infinity` → 60s for server-side role change reflection
- **WebSocket reconnection loop** — `connect` stored in ref to break useEffect dependency
- **Sidebar ARIA labels** — `aria-label` added to all 6 collapsible section toggles
- **Dashboard auto-refresh** — `staleTime: 30s` + `refetchInterval: 60s` for live monitoring feel

#### ✅ Completed & committed: Testing improvements (+118 tests, 1,179→1,297)
- **Audit fix tests** (`tests/audit-fixes.test.ts`, 52 tests) — prompt injection (HTML entities, comments, tags, ReDoS), PHI redaction (NPI, FHIR UUIDs, encounter IDs), LRU cache (eviction, TTL, prune), RAG config clamping, upload dedup lock, output guardrails
- **Schema column coverage** (`tests/schema-column-coverage.test.ts`, 45 tests) — per-table column comparison between schema.ts and sync-schema.ts; CI gate
- **AI provider mocks** (`tests/bedrock-mock.test.ts`, 20 tests) — MockBedrockProvider with switchable behaviors (success, rate_limit, timeout, server_error, unavailable, empty_response, malformed_json); score clamping, default fields, error codes
- **E2E test isolation** — per-worker org registration via `/api/auth/register` (slug: `e2e-w{workerIndex}-{ts}`); falls back to env-var admin

#### ✅ Completed & committed: HIPAA compliance improvements
- **Automated breach detection** — PHI access velocity (50/10min) and breadth (20 unique resources/10min) tracking with auto-incident creation via `declareIncident()`
- **BAA management system** — `business_associate_agreements` table + CRUD routes (`/api/admin/baa`) + expiry alerting + vendor type enum + RLS policy

### Branch: `claude/audit-codebase-review-AcjWE`

#### ✅ Completed & committed: Revenue Tracking improvements
- **Attribution funnel fix** — rewrote funnel logic to use `attributionStage` as single source of truth with strict stage ordering; a record at stage N is counted for all prior stages (funnel monotonicity). Eliminates overcounting from redundant OR chains on legacy boolean fields
- **Weekly trend fix** — fixed week boundary calculation to use Monday-aligned 7-day buckets. Previous logic produced variable-sized buckets depending on day of week
- **EHR sync validation** — all numeric values from EHR adapter (totalFee, totalInsurance, totalPatient) validated with `safeNum()`: must be finite, non-negative. Prevents NaN/null from corrupting revenue data
- **Carrier name normalization** — insurance carrier names title-cased on aggregation ("DELTA DENTAL" / "delta dental" → "Delta Dental") to prevent fragmented payer reports
- **Payer mix carrier fix** — carrier breakdown now uses `insuranceAmount` only (was falling back to `actualRevenue`, which includes patient portion — double-counting insurance revenue)
- **Forecast confidence** — forecast response now includes `forecastConfidence` ("low"/"moderate"/"high" based on day of month), `daysElapsed`, `daysRemaining`. Low confidence before day 7 warns users that early-month projections are unreliable

#### ✅ Completed & committed: RBAC improvements
- **Email submit role gate** — POST `/api/emails/submit` now requires manager+ role (viewers could submit emails)
- **Live session role gate** — POST `/api/live-sessions` now requires manager+ role (viewers could start clinical recordings)
- **Call detail team scoping** — GET `/api/calls/:id` now checks team boundary (managers with subTeam could access any call by direct ID)
- **Coaching detail team scoping** — GET `/api/coaching/employee/:employeeId` now checks team boundary before returning sessions

#### ✅ Completed & committed: A/B Testing improvements
- **p-value fix** — simplified tDistPValue() Cornish-Fisher approximation: removed unused intermediate variable, eliminated redundant sqrt(df) multiply/divide that cancelled out. Result is cleaner and mathematically equivalent
- **Paired score comparison** — stats computation now requires BOTH baseline and test scores present (was independently pushing nulls, causing array length mismatches and skewed t-test)
- **df-aware confidence interval** — replaced hardcoded tCrit=2.0 with lookup table based on degrees of freedom (df>120→1.96, df>30→2.0, df>10→2.23, df>5→2.57, else→3.18). Actual 95% CI was closer to 93% for small samples

#### ✅ Completed & committed: Gamification improvements
- **Opt-out filtering gaps fixed** — profile endpoint now checks opt-out before returning data (was leaking full profile for opted-out employees); recognition endpoint now checks role-based opt-out (was only checking employee ID); team leaderboard now filters opted-out employees/roles (was including everyone)
- **Team leaderboard top performer fix** — was overwriting topPerformer with ANY employee with points > 0 (last one wins); now tracks actual highest-points employee per team
- **NaN protection** — badge award logic now filters NaN scores from performance calculations (corrupted analysis data could skew badge eligibility)

#### ✅ Completed & committed: Calibration Session improvements
- **Flagged status consistency** — analytics endpoint now includes "flagged" certification status (3+ sessions, avgDeviation >= 2.0) matching the certifications endpoint. Type definition updated to include all 4 statuses
- **ICC formula fix** — replaced abandoned mean-absolute-deviation formula with proper variance-based ICC using sample variance (Bessel's correction) and normalized against theoretical max variance on 0-10 scale
- **Duplicate evaluator check** — session creation rejects duplicate evaluatorIds with 400 error
- **targetScore validation** — session completion validates targetScore is 0-10 (was accepting any value)

#### ✅ Completed & committed: Insurance Narrative improvements
- **Code format validation** — ICD-10 (`/^[A-TV-Z]\d{2}(\.\d{1,4})?$/`) and CPT/CDT (`/^\d{5}[A-Z]?$|^D\d{4}$/`) regex validation added to insurance narrative schema (was accepting any string)
- **Approval rate fix** — rewrote overall approval rate to use `approvedCount / decidedCount` (was checking `approved > 0` first, returning 0 instead of computing rate when no approvals exist)
- **Partial approval tracking** — insurer stats now track `partialApproval` count separately (was silently dropped from statistics)
- **Deadline calculation fix** — changed `Math.ceil` to `Math.floor` for accurate day count (11 hours remaining was reported as 1 day instead of 0)
- **Denial code required** — outcome endpoint now requires `denialCode` when outcome is `denied` or `partial_approval` (was optional, causing incomplete denial analysis data)
- **Regeneration guard** — POST `/:id/regenerate` now rejects narratives with recorded outcomes (audit trail integrity — prevents changing submitted letters)

#### ✅ Completed & committed: Lead Tracking improvements
- **ESM fix** — replaced CommonJS `require("@shared/schema")` with proper ESM import in `/api/marketing/sources` endpoint (was crashing at runtime in ESM module)
- **Source validation** — campaign creation and attribution now validate `source` against the `MARKETING_SOURCES` enum; returns 400 with valid sources list on mismatch
- **Attribution update fix** — PUT `/api/marketing/attribution/:callId` now preserves `detectionMethod` and `confidence` from existing record when updating (was dropping these fields)
- **Auto source detection** — new `GET /api/marketing/detect-source/:callId` analyzes transcript text for source mentions ("found you on Google", "my dentist referred me", "saw your ad on Facebook") using 12 pattern groups; returns suggestions with confidence scores without auto-creating attribution
- **Source→funnel pipeline visibility** — metrics endpoint now includes per-source `funnel` object showing how leads progress: `call_identified → appointment_scheduled → appointment_completed → treatment_accepted → payment_collected`. Uses same monotonic stage logic as revenue attribution
- **Campaign delete 404** — DELETE `/api/marketing/campaigns/:id` now returns 404 for non-existent campaigns (was returning 200 success)
- **Schema validation** — campaign budget enforces `min(0)` (prevents negative budgets corrupting ROI); attribution confidence enforces `min(0).max(1)`

#### ✅ Completed & committed: LMS improvements
- **Prerequisite gating** — `prerequisiteModuleIds` field on `LearningModule`; `GET /api/lms/modules/:id/prerequisites?employeeId=X` checks which prerequisites are met/unmet; returns `{ met, prerequisites, unmetPrerequisites }` for UI to block access to locked modules
- **Circular dependency detection** — `detectPrerequisiteCycle()` uses DFS to detect cycles before module creation/update; returns 400 with cycle path if found; validates prerequisite modules exist
- **Prerequisite enforcement on quiz** — `POST /api/lms/modules/:id/submit-quiz` checks all prerequisites are completed before allowing quiz submission; returns 403 `OBS-LMS-PREREQ-INCOMPLETE`
- **Completion certificates** — `GET /api/lms/modules/:id/certificate?employeeId=X` returns structured certificate data (employeeName, moduleName, completedAt, quizScore, organizationName, certificateId, difficulty); requires module status = "completed"; client-side PDF rendering
- **Configurable passing scores** — `passingScore` field on `LearningModule` (0-100, default 70 if not set); quiz submission endpoint uses module-specific passing score instead of hardcoded 70; response includes `passingScore` field
- **Deadline enforcement** — `dueDate` (ISO timestamp) and `enforceOrder` (boolean) fields on `LearningPath`; `GET /api/lms/paths/:id/deadlines` returns per-employee status: completed/overdue/at_risk/on_track with percentComplete, daysRemaining, counts
- **enforceOrder enforcement** — progress updates check if previous module in path is completed before allowing start of next; returns 403 `OBS-LMS-ENFORCE-ORDER` with `blockedBy` module ID
- **Deadline blocking** — progress updates and quiz submissions reject with 403 `OBS-LMS-DEADLINE-PASSED` when path deadline has passed
- **Coaching-tied recommendations** — `GET /api/lms/coaching-recommendations?employeeId=X&coachingSessionId=Y` analyzes employee's weak sub-score areas (compliance, customerExperience, communication, resolution < 7.0), matches coaching session category/notes keywords, and ranks uncompleted published modules by relevance; returns top 5 with reasons
- **Coaching recommendation fixes** — fixed dead regex for camelCase→space conversion (was calling `.toLowerCase()` before `.replace()`); increased weak area threshold from 2 to 3 data points for statistical reliability

#### ✅ Completed & committed: Clinical Documentation improvements
- **NPI encryption** — `attestedNpi` and `cosignedNpi` added to PHI_FIELDS for AES-256-GCM encryption; NPI now encrypted on attestation and co-signature; removed from amendment snapshot (PHI should not be in non-PHI snapshots)
- **NPI format validation** — schema enforces `/^\d{10}$/` regex on both `attestedNpi` and `cosignedNpi` fields
- **Medical code format validation** — ICD-10 codes enforce `/^[A-TV-Z]\d{2}(\.\d{1,4})?$/`; CPT codes enforce `/^\d{5}[A-Z]?$/`; CDT codes enforce `/^D\d{4}$/` in the clinical note schema
- **Cosignature role bypass fix** — tightened role check condition: undefined `currentUserRole` now correctly returns 403 instead of skipping the check entirely
- **Clinical notes `cn` variable scope** — moved derivation before function definitions that reference it (was defined after early returns, causing fragile closure capture)
- **Amendment workflow tests** — 11 tests in `tests/clinical-amendments.test.ts` covering schema validation (amendment/addendum types), amendment persistence with attestation clearing, addendum persistence preserving attestation, multi-amendment chains, optimistic locking version tracking, non-PHI snapshot validation, and cross-org isolation
- **Addendum conflict detection** — addendum endpoint now checks `req.body.version` against current version (409 conflict if mismatch); increments version on addendum to prevent concurrent overwrites
- **Cosignature version tracking** — cosignature endpoint increments note version, ensuring downstream conflict detection catches concurrent edits

#### ✅ Completed & committed: RAG Feature improvements
- **Chunker O(n^2) fix** — replaced greedy regex `[\s\S]*[.!?]\s+` in `findNaturalBreak()` with `lastIndexOf()` calls (O(n) per chunk instead of O(n^2)); enforced minimum step size of 40 chars to prevent infinite micro-chunks when overlap ≈ chunk size
- **BM25/semantic score clamping** — semantic scores clamped to [0,1] (pgvector cosine can return negatives), BM25 scores clamped to ≥0, combined scores clamped to ≥0 after NaN guard
- **Prompt injection: throw instead of silent empty** — `searchRelevantChunks()` now throws `RAG_INJECTION_BLOCKED` error instead of returning `[]`; RAG search endpoint returns HTTP 400 with user-friendly message; callers can distinguish "no results" from "blocked"
- **Unicode homoglyph defense** — `detectPromptInjection()` now applies NFKD normalization + diacritical mark stripping before pattern matching (defeats "ìgnórè prëvíóüs ìnstrûctíons" attacks)
- **Expanded injection patterns** — added `<instructions>`, `<prompt>`, `<context>`, `<user>`, `<assistant>` tags; added "act as if you", "do not follow" phrases; unified tag patterns with `<\/?tag\b` to catch attributes and self-closing variants
- **Embedding validation** — logs warning when input is truncated (was silent); validates embedding values are finite numbers (no NaN/Infinity that would corrupt pgvector)
- **Configurable charsPerToken** — `ChunkOptions.charsPerToken` allows per-industry token estimation (dental/medical=3.5, behavioral_health=3.8, general=4.0); `getCharsPerTokenForIndustry()` helper maps industry type to ratio; `indexDocument()` accepts optional `chunkOptions` for callers to pass org-specific config
- **Batch embedding with progress** — `generateEmbeddingsBatch()` now accepts `concurrency` and `onProgress` callback for large document uploads; structured log output with batch/total counts
- **RAG pipeline integration tests** — 12 tests in `tests/rag-pipeline.test.ts` covering industry-specific chunking, Unicode homoglyph injection, tag injection with attributes, legitimate query allowlisting, micro-chunk prevention, and overlap clamping

#### ✅ Completed & committed: Call Analysis feature improvements
- **speakerRoleMap fix** (CRITICAL) — was creating `{ agentSpeaker: "A" }` (property named "agentSpeaker") instead of `{ A: "agent", B: "customer" }` (speaker label → role mapping). Fixed in `assemblyai.ts` and updated `shared/schema/calls.ts` to `z.record(z.string(), z.string())`
- **Filler word detection overhaul** — expanded from 12 to 18 single-word fillers (added "ah", "er", "erm", "hm", "okay", "ok", "literally", "essentially"); added bigram detection for multi-word phrases ("you know", "i mean", "sort of", "kind of") which were previously impossible to match since words are tokenized individually
- **Circuit breaker race condition** — moved `halfOpenProbeInFlight = true` into `getCircuitDecision()` so probe slot claim is atomic with the decision (no gap between check and set)
- **Post-processing retry** — flagged call notifications and coaching recommendations now use `withRetry()` (2 retries, 1s base delay) instead of bare fire-and-forget; dashboard cache invalidation logs errors instead of silently swallowing
- **Sentiment normalization** — extracted `normalizeSentiment()` helper in assemblyai.ts; validates against "positive"/"negative" enum, defaults to "neutral"
- **Full-text search via tsvector** — `searchCalls()` in pg-storage.ts now uses `plainto_tsquery()` with existing GIN tsvector indexes on transcripts and analysis summaries (was using ILIKE which bypassed the indexes). Falls back to ILIKE for single-character queries
- **Configurable speaker roles per-org** — added `defaultSpeakerRoles` to OrgSettings (e.g., `{ A: "customer", B: "agent" }` for IVR-routed calls). `processTranscriptData()` accepts optional org override, defaults to `{ A: "agent", B: "customer" }`
- **Failed call retry queue** — `enqueueCallRetry()` enqueues failed calls to the audio-processing queue with 30s/60s delay (max 2 retries). After retries exhausted, moves to dead letter queue for admin review. `continueAfterTranscription()` error handler now auto-enqueues retries when Redis is available
- **Auto speaker role detection** — `detectSpeakerRolesFromTranscript()` analyzes the first ~60 words per speaker to identify agent vs customer. Priority: (1) AI-detected agent name matched against self-introduction patterns ("my name is X", "this is X with/from"), (2) greeting patterns ("thank you for calling", "how can I help"), (3) org `defaultSpeakerRoles` config, (4) default A=agent/B=customer. 10 unit tests in `tests/speaker-detection.test.ts`

#### ✅ Completed & committed: UI/UX & Design improvements
- **display-utils.ts fix** — moved `Array.isArray()` check before generic object property extraction (arrays were falling through to object path)
- **Dashboard flag filtering** — consistent `some()` usage for all flag checks; NaN protection on `performanceScore` parsing; added loading skeleton for trend chart while data is fetching
- **Upload page a11y** — added `role="tablist"`, `role="tab"` with `aria-selected`, `role="tabpanel"` with `id`/`aria-controls` for tab navigation; added `aria-label` to select fields
- **Error boundary recovery** — added `role="alert"` and `aria-live="assertive"` for screen reader announcement; added "Go to Dashboard" button as alternative recovery; `autoFocus` on primary action
- **Duplicate upload fix** — changed response from 200 to 409 with `{ duplicate: true, existingCallId }` message; also fixed upload slot leak (was never released on duplicate detection)
- **Idle timeout** — already had `role="alertdialog"`, `aria-modal`, `aria-label` (well implemented)

#### ✅ Completed & committed: DevOps & Infrastructure hardening
- **Node.js version pinning** — `engines` field in package.json (>=20.0.0), `.nvmrc` file for nvm/fnm users
- **Missing dev dependencies** — added `eslint`, `typescript-eslint`, `c8` to devDependencies (were used in scripts but not declared)
- **Docker healthcheck fix** — replaced CommonJS `require('http')` with native `fetch()` for ESM compatibility in Dockerfile and docker-compose.yml
- **CI secret scanning** — GitHub Actions now scans for AWS keys, private keys, and API tokens in source files
- **CI test coverage** — unit test job now runs c8 coverage (text + lcov), uploads coverage report as artifact
- **CI schema validation** — build job validates that `sync-schema.ts` covers all `pgTable()` definitions in `schema.ts`, warns on missing tables
- **Test fixes** — fixed all 20 pre-existing test failures (method name mismatches, schema field gaps, incorrect test expectations)

#### ✅ Completed & committed: HIPAA Compliance hardening
- **PHI encryption enforcement** — `encryptField()` now throws in production if `PHI_ENCRYPTION_KEY` is not set; dev mode logs a warning and allows plaintext for local development
- **PHI decryption audit logging** — `decryptClinicalNotePhi()` accepts `PhiDecryptionContext` (userId, orgId, resourceId, resourceType) and logs `[HIPAA_AUDIT] PHI_DECRYPT` events; all callers in `calls.ts` and `clinical.ts` pass audit context
- **Audit log hash chain race condition fix** — per-org promise-chain mutex (`withChainLock()`) serializes concurrent `persistAuditEntry()` calls, preventing two entries from computing the same sequence number
- **FAQ analytics PHI redaction** — sample queries stored in FAQ analytics are now PHI-redacted via `redactPhi()` before persistence (both initial entries and updates)
- **Auth deserialize error logging** — session deserialization `catch` block now logs the error with `logger.error()` instead of silently returning false
- **Org suspension check failure handling** — SSO session check failures now deny with 503 `OBS-AUTH-007` instead of silently allowing the request through
- **Sentry selective PHI redaction** — replaced blanket `event.request.data = "[REDACTED]"` with `redactPhi()` for selective scrubbing of error messages, request bodies, and exception values; preserves debugging context while removing PHI patterns
- **WAF log PHI safety** — documented that WAF violation logs use `req.path` (no query string) to prevent logging PHI from query parameters
- **Idle timeout "Stay Logged In" fix** — `useIdleTimeout()` hook now exposes `stayLoggedIn()` method that resets the idle timer; `IdleTimeoutOverlay` wires the button to this handler instead of a no-op; logout only clears `sessionStorage` (preserves user preferences in `localStorage`)

### Branch: `claude/audit-observatory-project-Axt5D`

#### ✅ Completed & committed: SSO improvements
- **SCIM 2.0** (`server/routes/scim.ts`) — full Users CRUD, ServiceProviderConfig, Schemas; Bearer token per org
- **OIDC SSO** (`server/routes/sso.ts`) — discovery, auth URL, code exchange, RS256/ES256 JWT verification via JWKS
- **Group-to-role mapping** — `ssoGroupRoleMap` + `ssoGroupAttribute` in org settings; role synced on every SSO login
- **IDP-initiated SAML** — `validateInResponseTo:"IfPresent"`; per-org ACS at `POST /api/auth/sso/callback/:orgSlug`
- **SSO session limits** — `ssoSessionMaxHours` enforced in `requireAuth`; `ssoLoginAt` stamped on session
- **SLO** — `POST /api/auth/sso/logout` + `GET /api/auth/sso/logout`
- **Cert rotation** — `parseCertExpiry()` decodes DER notAfter; dual-cert via `ssoNewCertificate`; `GET /api/auth/sso/cert-status/:orgSlug`
- **Admin SCIM token management** — `GET/POST/DELETE /api/admin/scim/token`

#### ✅ Completed & committed: MFA improvements
- **WebAuthn/Passkeys** (FIDO2) — registration options/verify, authentication options/verify (`@simplewebauthn/server` v13); credentials stored as JSONB array on user row (`webauthn_credentials`)
- **Trusted devices** — `POST /api/auth/mfa/verify` with `trustDevice: true` sets `mfa_td` cookie (30-day); SHA-256(token) stored in `user.mfaTrustedDevices[]`; trusted device check in login bypasses MFA challenge
- **Trusted device management** — `GET /api/auth/mfa/trusted-devices`, `DELETE /api/auth/mfa/trusted-devices/:tokenPrefix`, `DELETE /api/auth/mfa/trusted-devices` (revoke all)
- **Email OTP** (viewer/manager only) — `POST /api/auth/mfa/email-otp/send` (6-digit, 10-min TTL, 3 attempts max) + `POST /api/auth/mfa/email-otp/verify`; in-memory Map keyed by userId
- **MFA grace period** — `mfaEnrollmentDeadline` per user; org-wide `mfaGracePeriodDays` (default 7); grace period status returned from `GET /api/auth/mfa/status`; after deadline, login rejected
- **Emergency recovery flow** — `POST /api/auth/mfa/recovery/request` → email verification token → admin approves via `POST /api/admin/mfa/recovery/:id/approve` → use-token (15-min TTL) emailed → `POST /api/auth/mfa/recovery/:useToken/use` clears MFA + completes login; all steps HIPAA-audit-logged; stored in `mfa_recovery_requests` table
- **WebAuthn credentials management** — `GET /api/auth/mfa/webauthn/credentials`, `DELETE /api/auth/mfa/webauthn/credentials/:credentialId`

#### ✅ Completed & committed: Coaching Engine improvements
- **AI coaching plan generation** — `generateCoachingPlan(orgId, employeeId)` uses Bedrock to draft structured action plans from call history; callable from `POST /api/coaching/:id/generate-plan`
- **Effectiveness tracking** — `CoachingSession` extended with `effectivenessScore`, `preScore`, `postScore`, `completedActions`, `totalActions`; `GET /api/coaching/analytics` returns improvement rate, average effectiveness, completion rate
- **Self-assessment workflow** — `POST /api/coaching/:id/self-assess` allows employees to rate and comment on their own coaching sessions
- **Coaching templates** — `coaching_templates` table; `GET/POST /api/coaching/templates`, `PATCH/DELETE /api/coaching/templates/:id`; templates are org-scoped blueprints for recurring coaching scenarios
- **Automation rules** — `automation_rules` table; `GET/POST /api/coaching/automation-rules`, `PATCH/DELETE /api/coaching/automation-rules/:id`; rules trigger coaching sessions when conditions are met (e.g. score < threshold, compliance flag)
- **Auto-recommendations** (`server/services/coaching-engine.ts`) — engine evaluates calls against automation rules and creates recommended coaching sessions

#### ✅ Completed & committed: RBAC improvements
- **Department/team scoping** — `subTeam` field on `User`; `getTeamScopedEmployeeIds(orgId, user)` returns `Set<string> | null` (null = no restriction); applied to `GET /api/calls`, `GET /api/employees`, `GET /api/coaching`
- **Resource-level call sharing** — `call_shares` table with 48-hex token (SHA-256 hashed); `POST /api/calls/:id/shares` (manager+, 1h–30d TTL), `GET /api/calls/:id/shares`, `DELETE /api/calls/:id/shares/:shareId`; public `GET /api/shared-calls/:token` endpoint strips `clinicalNote` PHI before returning
- **API key resource scopes** — `permissions[]` accepts `"calls:read"`, `"employees:read"`, etc. alongside broad `read`/`write`/`admin`; `checkApiKeyScope(scope)` middleware factory enforces per-route; `write` implies `read`, `admin` implies both; `req.apiKeyScopes` only set for keys with zero broad permissions
- **Viewer coaching self-service** — `GET /api/coaching/my` auto-discovers the caller's employee record by email/username then name fallback; no employee ID required

#### ✅ Completed & committed: RAG Knowledge Base improvements
- **Document versioning** — `version` (integer), `previousVersionId` (text), `indexingStatus` (pending/indexing/indexed/failed), `indexingError` (text) fields on `ReferenceDocument` schema + DB; `POST /api/reference-documents/:id/version` creates a new version (deactivates old, purges old chunks, re-indexes new); `GET /api/reference-documents/:id/versions` returns version chain history
- **Citation tracking** — when RAG chunks are injected into analysis prompt, chunk IDs are stored in `confidenceFactors.ragCitations[]` (chunkId, documentId, documentName, chunkIndex, score); returned in `GET /api/calls/:id/analysis` response via existing confidenceFactors JSONB
- **Indexing status tracking** — `indexingStatus` (pending→indexing→indexed/failed) and `indexingError` surfaced in `GET /api/reference-documents` response; `indexDocument()` auto-updates status on success/failure; worker `on("failed")` handler also updates status; `POST /api/reference-documents/:id/reindex` resets status before re-enqueueing
- **Chunk preview** — `GET /api/reference-documents/:id/chunks?limit=20&offset=0` returns paginated chunks with text, sectionHeader, tokenCount, charStart/charEnd, hasEmbedding flag, total count
- **Knowledge base analytics** — `GET /api/reference-documents/rag/analytics` (admin) returns totalDocuments, totalChunks, indexedDocuments, failedDocuments, pendingDocuments, mostRetrievedDocs (top 10 by retrievalCount), avgChunksPerDocument; `retrievalCount` field on `reference_documents` auto-incremented on each RAG retrieval
- **Web URL sources** — `POST /api/reference-documents/url` (admin) accepts `{ url, name?, category?, description?, appliesTo? }`, fetches page via `fetch()` (15s timeout), strips HTML (script/style/nav/footer/header tags), extracts text (50K char cap), creates doc with `sourceType: "url"` + `sourceUrl`, enqueues RAG indexing; validates HTTP/HTTPS only, rejects non-text content types

#### ✅ Completed & committed: Calibration Session improvements
- **Blind calibration** — `blindMode` (boolean) on `CalibrationSession`; when active, `GET /api/calibration/:id` only returns the requesting user's own evaluation until session is completed; aggregate stats (variance, IRR) also hidden during blind phase; `evaluationCount`/`expectedEvaluations` still visible so evaluators know submission progress
- **Inter-rater reliability metrics** — `computeKrippendorffAlpha()` and `computeICC()` (Intraclass Correlation Coefficient) added to session detail and analytics endpoints; Krippendorff's alpha measures agreement accounting for chance; ICC measures absolute agreement across raters; both returned as -1 to 1 / 0 to 1 values
- **Automated call selection** — `GET /api/calibration/suggest-calls?limit=10` scores calls by calibration value: borderline AI scores (4-6, +5), manual edits (+4), flagged calls (+3), recency within 14 days (+3), low outlier scores (+3), high outlier scores (+2); excludes already-calibrated calls; returns sorted suggestions with reasons
- **Calibration report export** — `GET /api/calibration/:id/export` returns CSV with session metadata, scores summary (AI, consensus, average, std dev, Krippendorff's alpha, ICC), evaluator breakdown (score, deviation, sub-scores, notes), and consensus notes
- **Evaluator certification** — `GET /api/calibration/certifications` returns per-evaluator certification status: `certified` (5+ sessions, avgDeviation < 1.0), `probationary` (3+ sessions, avgDeviation < 2.0), `flagged` (3+ sessions, avgDeviation >= 2.0), `needs_calibration` (< 3 sessions); includes `consistencyScore` (0-1), `trendDirection` (improving/declining/stable based on last 3 vs prior 3 deviations), `lastSessionDate`

#### ✅ Completed & committed: A/B Model Testing improvements
- **Statistical significance** — Welch's t-test computes p-value and confidence level for score differences between models; 95% confidence interval for mean score difference; `GET /api/ab-tests/stats` returns `significance` (tStatistic, degreesOfFreedom, pValue, isSignificant, confidenceLevel) and `confidenceInterval` (lower, upper, level)
- **Batch testing** — `POST /api/ab-tests/batch` accepts up to 50 audio files via multipart upload; creates individual ABTest records with shared `batchId` (UUID); each file processed asynchronously in parallel; `GET /api/ab-tests/batch/:batchId` returns batch status (completed/processing/failed counts) and all test results
- **Automated recommendation** — `GET /api/ab-tests/recommend` analyzes completed tests per model pair; generates natural-language recommendations based on score difference significance, cost comparison, and latency; includes per-category recommendations (e.g., "use Model B for compliance calls"); confidence levels: high (10+ tests), moderate (3-9), low (not significant)
- **Segment analysis** — `GET /api/ab-tests/segments` breaks down results by call category and model pair; each segment gets its own aggregate stats with t-test significance; reveals where each model excels (e.g., "Haiku is 0.8 points better for inbound calls but 0.3 worse for outbound")
- **Aggregate stats** — `GET /api/ab-tests/stats` with optional filters (batchId, baselineModel, testModel); returns avg scores, sub-score breakdown (compliance, customerExperience, communication, resolution), cost comparison (percent diff), latency comparison, Welch's t-test results, 95% CI

#### ✅ Completed & committed: Spend Tracking improvements
- **Cost forecasting** — `GET /api/usage/forecast` returns currentMonthSpend, projectedMonthlySpend (daily rate × days in month), dailyRate, last7Days trend (daily cost + count), previousMonthSpend, monthOverMonthChange percentage, daysRemaining, budgetStatus (if configured)
- **Cost per outcome** — `GET /api/usage/cost-per-outcome` returns costPerScoredCall, costPerCoachingSession (total call cost / coaching sessions triggered), costPerConvertedCall (total call cost / converted calls from revenue tracking), serviceBreakdown (assemblyai/bedrock split with percentages)
- **Budget alerts** — `budgetAlerts` object in OrgSettings: `monthlyBudgetUsd`, `alertEmail`, `enabled`; `GET/PUT /api/usage/budget` for configuration; forecast endpoint returns `budgetStatus` (percentUsed, isOverBudget, projectedOverBudget) when budget is configured
- **Department allocation** — `GET /api/usage/by-department` maps callId → call → employee → subTeam; returns per-department breakdown: totalCost, callCount, avgCostPerCall, employeeCount, percentOfTotal; sorted by cost descending
- **Cost anomaly detection** — `GET /api/usage/anomalies` flags records > max(mean + 3σ, 5× mean); also flags unusually long audio (3× average and > 300s), multiple AI invocations on single call; returns anomaly details with multiplier, reason, and stats (mean, stdDev, threshold)

#### ✅ Completed & committed: Gamification improvements
- **Opt-out mechanism** — `gamification` object in OrgSettings: `enabled` (global toggle), `optedOutRoles` (e.g., `["viewer"]` for clinical settings), `optedOutEmployeeIds` (individual opt-out); leaderboard endpoint filters out opted-out employees/roles; `GET/PUT /api/gamification/settings` for admin configuration
- **Team competitions** — `GET /api/gamification/team-leaderboard` groups employees by `subTeam`, computes per-team: totalPoints, memberCount, avgPointsPerMember, totalBadges, topPerformer; requires `teamCompetitionsEnabled: true` in gamification settings; sorted by total points
- **Manager-awarded recognition badges** — `POST /api/gamification/recognize` (manager+) accepts `employeeId`, `badgeId`, `message`, optional `callId`; creates badge with `custom_` prefix, `awardedBy` (manager userId), `customMessage`; awards 30 bonus points; respects opt-out settings; `awardedBy` and `customMessage` fields added to `employee_badges` table
- **Effectiveness measurement** — `GET /api/gamification/effectiveness` (admin) computes Pearson correlation between badge count and avg performance score across all employees; returns correlation coefficient, natural-language interpretation, comparison of high-badge (3+) vs low-badge employees (avg score difference)
- **Opt-out in leaderboard** — Leaderboard returns empty array when gamification disabled globally; filters employees by optedOutRoles (matching employee.role) and optedOutEmployeeIds before ranking

#### ✅ Completed & committed: LMS improvements
- **Prerequisite gating** — `prerequisiteModuleIds` field on `LearningModule`; `GET /api/lms/modules/:id/prerequisites?employeeId=X` checks which prerequisites are met/unmet; returns `{ met, prerequisites, unmetPrerequisites }` for UI to block access to locked modules
- **Completion certificates** — `GET /api/lms/modules/:id/certificate?employeeId=X` returns structured certificate data (employeeName, moduleName, completedAt, quizScore, organizationName, certificateId, difficulty); requires module status = "completed"; client-side PDF rendering
- **Configurable passing scores** — `passingScore` field on `LearningModule` (0-100, default 70 if not set); quiz submission endpoint uses module-specific passing score instead of hardcoded 70; response includes `passingScore` field
- **Deadline enforcement** — `dueDate` (ISO timestamp) and `enforceOrder` (boolean) fields on `LearningPath`; `GET /api/lms/paths/:id/deadlines` returns per-employee status: completed/overdue/at_risk/on_track with percentComplete, daysRemaining, counts
- **Coaching-tied recommendations** — `GET /api/lms/coaching-recommendations?employeeId=X&coachingSessionId=Y` analyzes employee's weak sub-score areas (compliance, customerExperience, communication, resolution < 7.0), matches coaching session category/notes keywords, and ranks uncompleted published modules by relevance; returns top 5 with reasons
- **Prerequisite order in paths** — `enforceOrder` field on `LearningPath` signals that modules must be completed sequentially (index N requires index N-1 completed); combined with per-module `prerequisiteModuleIds` for flexible gating

#### ✅ Completed & committed: Revenue Tracking improvements
- **Revenue forecasting** — `GET /api/revenue/forecast` returns currentMonth spend (estimated + actual), pipeline value (pending calls × historical conversion rate), projectedConversion, monthly run rate (dailyRate × daysInMonth), historical conversion rate and avg deal value
- **Attribution funnel** — `GET /api/revenue/attribution` tracks the full conversion chain: call_identified → appointment_scheduled → appointment_completed → treatment_accepted → payment_collected; returns counts at each stage, stage-to-stage conversion rates, overall conversion rate, and revenue by stage (estimated → scheduled → collected)
- **Payer mix analysis** — `GET /api/revenue/payer-mix` returns: overall breakdown by payerType (insurance/cash/mixed/unknown) with counts and revenue totals; per-carrier breakdown sorted by revenue; per-employee payer split; schema adds `payerType`, `insuranceCarrier`, `insuranceAmount`, `patientAmount` fields to CallRevenue
- **EHR revenue sync** — `POST /api/revenue/ehr-sync/:callId` pulls treatment plan data from configured EHR (Open Dental/Eaglesoft) using `ehrPatientId`; maps treatment plan fees → treatmentValue, insurance/patient splits → payerType, plan status → attributionStage/conversionStatus; stores `ehrSyncedAt` timestamp; scheduled procedures extracted from plan phases
- **Attribution chain schema** — new fields on `CallRevenue`: `attributionStage` (5-stage funnel enum), `appointmentDate`, `appointmentCompleted`, `treatmentAccepted`, `paymentCollected`, `payerType`, `insuranceCarrier`, `insuranceAmount`, `patientAmount`, `ehrSyncedAt`; all fields added to DB sync, Drizzle schema, pg-storage mapping

#### ✅ Completed & committed: Insurance Narrative improvements
- **Payer-specific templates** — 7 templates (BCBS, Aetna, UHC, Cigna, Delta Dental, MetLife, generic) with required fields, preferred format guidance, and submission tips; `GET /api/insurance-narratives/payer-templates`
- **Outcome tracking** — `POST /api/insurance-narratives/:id/outcome` records approved/denied/partial_approval/pending/withdrawn with outcomeDate, outcomeNotes, and denial details
- **Denial code analysis** — `GET /api/insurance-narratives/denial-analysis` with per-code frequency, affected insurers/letter types, overall and per-insurer approval rates
- **Deadline tracking** — `submissionDeadline` + `deadlineAcknowledged` fields; `GET /api/insurance-narratives/deadlines` returns urgency (overdue/critical/warning/on_track) for all pending narratives
- **Supporting document checklists** — per-letter-type checklist generation (appeals need EOB + peer-reviewed literature, prior auths need radiographs + treatment plan); `GET /api/insurance-narratives/:id/checklist` with completion rate tracking

#### ✅ Completed & committed: QA Benchmarking (new feature)
- **Anonymized cross-org benchmarks** — `GET /api/benchmarks` computes performance percentiles (p25/p50/p75/p90) across all active orgs, segmented by industryType; includes sub-scores (compliance, customerExperience, communication, resolution), sentiment rates, and flag rates; 1-hour cache; requires 3+ orgs per industry
- **Org percentile rank** — each org sees where they stand relative to industry peers (e.g., "73rd percentile for dental practices"); zero org-identifiable data exposed
- **Monthly trend** — `GET /api/benchmarks/trends` returns avg performance score per month for last 12 months

#### ✅ Completed & committed: Patient Journey Analytics (new feature)
- **Multi-visit patient tracking** — `GET /api/patient-journeys` connects calls from the same patient using name matching from revenue records, clinical notes, and AI analysis summaries; shows chronological call history with scores, sentiment, revenue, and employee per touchpoint
- **Retention insights** — `GET /api/patient-journeys/insights` computes retention rate, avg visits per returning patient, avg days between visits, sentiment improvement on return visits, and revenue comparison (multi-visit vs single-visit patients with revenue multiplier)
- **PHI-protected** — all queries audit-logged via logPhiAccess, manager+ role required

#### ✅ Completed & committed: UMS Knowledge Base Port (cross-cutting improvements)
- **Security** — SSRF prevention on all outbound URL fetches (reference docs, SSO OIDC, SIEM webhooks), timing-safe CSRF comparison, account lockout timing disclosure prevention, CRLF injection prevention in emails, prompt injection detection in RAG, embedding dimension validation, frontend idle timeout (15-min + 2-min warning)
- **RAG quality** — IDF-enhanced BM25, dynamic normalization, section header re-ranking, medical-term-aware tokenizer (ICD-10/CPT/CDT/HCPCS preserved), NaN guards, blended confidence scoring, conversation history validation
- **Observability** — per-request correlation IDs via AsyncLocalStorage, auto-injected into Pino logger, PHI redaction on audit log details, per-route request metrics (p50/p95/p99) via /api/health/metrics, RAG trace logging with timing breakdown, FAQ analytics with knowledge base gap detection
- **Content integrity** — SHA-256 content-hash deduplication on reference document uploads (409 on duplicate), prompt cache status logging on Bedrock

#### Product positioning change: Marketing → Lead Tracking
- Renamed sidebar label, page title, and CLAUDE.md references
- API paths (`/api/marketing/*`) unchanged for backward compatibility
- Positioned as "where do calls come from?" rather than a marketing attribution product

### Branch: `claude/audit-observatory-codebase-0eONS` (PR #47)

#### ✅ Completed (prior sessions): Security, DB, CI/CD, Clinical, RAG, Call Analysis, HIPAA, LMS, Lead Tracking, Code Cleanup
See earlier sections in this file for full details of prior work on this branch. Summary: timing-safe comparisons, webhook replay prevention, org status fail-closed, unbounded query caps, JSONB GIN indexes, DEK cache security, schema validation, CI workflows, E2E security tests, ICD-10/CPT fixes, FHIR expansion, HNSW vector index, BM25 fix, embedding retry, RAG XML framing, talk time ratio fix, confidence scoring, incident persistence, breach notifications, LMS quiz validation, UTM capture, logger consolidation, dead code removal.

#### ✅ Completed & committed: Comprehensive codebase audit fixes (current session — 47 fixes across 15 commits)

**Security fixes (P0-P1):**
- **CSV injection** — `export.ts`: prefix formula characters (`=`, `+`, `-`, `@`, tab, CR) with single quote to prevent Excel/Sheets formula execution
- **Chunker regex lastIndex** — `chunker.ts`: reset `pattern.lastIndex = 0` on global regex in `findSectionHeader()` (was missing section headers after first pattern)
- **Transcript audit trail** — `transcript-viewer.tsx`: replaced hardcoded `"Manager"` with actual user from `/api/auth/me` for HIPAA-compliant correction audit
- **PHI decryption buffer** — `phi-encryption.ts`: validate buffer length >= IV + authTag before slicing (prevents silent corruption from truncated payloads)
- **Email CRLF injection** — `email.ts`: sanitize `to` field + add `sanitizeParam()` for plaintext template variables (userName, resetUrl, orgName)
- **API key scope mixing** — `api-keys.ts`: reject creation of keys mixing broad (`admin`) and scoped (`calls:read`) permissions (was silently ignoring scopes)
- **Flag validation** — `ai-types.ts`: tighten custom AI flags from "any string <100 chars" to `/^[a-z0-9][a-z0-9_-]*(?::[a-z0-9_-]+)?$/`
- **Webhook secret whitespace** — `assemblyai-webhook.ts`: trim both expected and received tokens before comparison

**Security fixes (P2-P3):**
- **Redis KEYS → SCAN** — `admin.ts`: replace blocking `redis.keys("sess:*")` with non-blocking `redis.scan()` in batches of 100 for session invalidation
- **Clinical print XSS** — `clinical-notes.tsx`: replace `innerHTML` with `cloneNode(true)` in print window
- **Speaker detection i18n** — `assemblyai.ts`: `[\w]+` → `[^\s,.]+` so accented/international names match
- **Zod validation on incidents/breach** — `admin-security.routes.ts`: 7 Zod schemas for all incident/breach/action-item endpoints (severity enum, numeric bounds, max lengths)
- **Admin rate limiting** — `index.ts`: `distributedRateLimit(60s, 60)` on `/api/admin/*`, `(60s, 30)` on `/api/super-admin/*`
- **Upload JSON.parse safety** — `upload.tsx`: `.catch(() => ({}))` fallback on error response parsing

**Performance fixes:**
- **Gamification upsert** — `pg-storage-features.ts`: `INSERT ON CONFLICT DO UPDATE` replaces check-then-act race condition
- **Leaderboard N+1** — `pg-storage-features.ts`: batch badge counts via `GROUP BY` (21 queries → 2)
- **Export OOM** — `pg-storage.ts` + `export.ts`: push `limit` to DB query instead of post-slicing (50K hard cap)
- **Assembly AI ID index** — `schema.ts` + `sync-schema.ts`: new index for webhook handler lookup
- **Dashboard metrics** — `pg-storage.ts`: single LEFT JOIN query replaces 3 correlated subqueries
- **Topics search** — `pg-storage.ts` + `sync-schema.ts`: `to_tsvector` + GIN index replaces `ILIKE` on JSONB text cast
- **Learning progress UNIQUE** — `sync-schema.ts`: unique index on `(org_id, employee_id, module_id)` for upsert
- **LMS progress upsert** — `pg-storage-features.ts`: `INSERT ON CONFLICT DO UPDATE` replaces race-prone select-then-insert

**Data integrity & correctness:**
- **Org cache invalidation** — `admin.ts`, `super-admin.ts`, `admin-security.routes.ts`, `billing.ts`, `ehr.ts`, `clinical.ts`, `clinical-analytics.routes.ts`: `invalidateOrgCache()` after security-critical `updateOrganization()` call sites (closes authorization bypass after suspension/deletion). Note: some non-security settings updates (gamification, onboarding branding, spend-tracking budget) do not invalidate cache — settings changes take effect after 30s TTL
- **Upload lock release** — `helpers.ts` + `calls.ts`: explicit `releaseUploadLock()` after `createCall()` success (was waiting for 30s TTL)
- **MemStorage audio cap** — `memory.ts`: 200-entry FIFO cap on audioFiles Map (prevents OOM in dev)
- **Auto-assignment** — `call-processing.ts`: require explicit `status === "Active"` (missing status no longer treated as active)
- **Talk time ratio** — `assemblyai.ts`: fall back to first speaker when no "agent" role in role map (was returning 0%)
- **Unlabeled speaker tracking** — `assemblyai.ts`: expose `unlabeledSpeakerPercent` when >10% words lack speaker labels
- **Pipeline storage resilience** — `call-processing.ts`: `Promise.allSettled` for transcript/sentiment/analysis writes (partial failure doesn't lose all results)

**RAG improvements:**
- **Score normalization** — `rag.ts`: divide by weight sum so custom configs produce [0,1] scores
- **FAQ NaN guard** — `faq-analytics.ts`: skip recording when confidenceScore is NaN/Infinity
- **Double PHI redaction removed** — `rag-trace.ts`: eliminated redundant `redactPhi()` (caller already redacts)
- **Embedding jitter** — `embeddings.ts`: random 0-500ms jitter on retry backoff (prevents thundering herd)
- **Degradation detection** — `rag.ts`: warns when 0 candidates returned because all chunks have NULL embeddings

**Clinical documentation improvements:**
- **Viewer PHI filtering expanded** — `clinical.ts`: redact ICD-10/CPT/CDT codes, structuredData, editHistory, toothNumbers, periodontalFindings, treatmentPhases (not just text fields)
- **Cosign NPI validation** — `clinical-compliance.routes.ts`: `/^\d{10}$/` check (was validated on attestation but not cosignature)
- **Vital signs range validation** — `clinical-extraction.ts`: discard values outside physiological ranges (BP, HR, RR, Temp, SpO2, BMI)
- **Style learning decryption context** — `clinical-analytics.routes.ts`: report skipped decryption failures in response
- **FHIR subject fallback** — `fhir.ts`: placeholder `{ display: "Unknown patient" }` when no EHR link (US Core requires subject)
- **Amendment decryption audit** — `clinical-compliance.routes.ts`: log each failure + fire `phi_decryption_failure` audit event

**UI/UX improvements:**
- **Dashboard a11y** — `dashboard.tsx`: `aria-expanded`, `aria-controls`, descriptive `aria-label` on flagged calls toggle
- **Transcript keyboard nav** — `transcript-viewer.tsx`: `role="button"`, `tabIndex`, Enter/Space handler on correctable words
- **Upload details a11y** — `file-upload.tsx`: `aria-label` + `aria-controls` on details toggle
- **Correction toast** — `transcript-viewer.tsx`: toast notifications on save success/failure + JSON.parse safety
- **SSO slug a11y** — `auth.tsx`: `aria-label` on organization slug input

**Bedrock reliability:**
- **generateText retry** — `bedrock.ts`: 2 retries with exponential backoff + jitter for transient failures (429, 5xx, timeout). All callers benefit automatically

## Future Plans / Roadmap
See `HEALTHCARE_EXPANSION_PLAN.md` for the full 4-phase healthcare expansion roadmap.

- **Phase 1 (done)**: Dental practice QA — dental call categories, prompt templates, CDT code reference, clinical note generation
- **Phase 2 (in progress)**: Clinical documentation add-on — AI scribe, style learning, multi-format notes (SOAP/DAP/BIRP), provider attestation workflow
- **Phase 3 (planned)**: EHR integration — Open Dental (bidirectional), Eaglesoft (read-focused), Dentrix (future). Routes and adapters are scaffolded
- **Phase 4 (planned)**: Expand verticals — urgent care, behavioral health, dermatology, ophthalmology, veterinary
- **QA + Docs bundle pricing**: The Professional plan now bundles QA + Clinical Documentation at $199/mo. Clinical Documentation is available as a $49/mo add-on for Starter plans
- **Super-admin role**: Platform-level admin (not org-scoped) for managing all organizations — `SUPER_ADMIN_USERS` env var
- **PostgreSQL migration**: Move remaining S3-only deployments to PostgreSQL for better query performance and transactional integrity
- **Spanish language support**: Multilingual clinical note generation

### Call Analyzer Adaptation Roadmap
Patterns adapted from the single-tenant Call Analyzer (assemblyai_tool) for multi-tenant SaaS:

| Phase | Feature | Status | Notes |
|-------|---------|--------|-------|
| 1 | **Language-aware sentiment skipping** | ✅ Done | `claude/review-qa-assemblyai-integration-5NlvX` — Non-English audio skips AssemblyAI sentiment_analysis (~12% cost savings). Upload API accepts optional `language` field; also reads org `primaryLanguage` setting. 8 tests |
| 2 | **Default industry templates** | ✅ Done | `claude/review-qa-assemblyai-integration-5NlvX` — 19 templates across 5 verticals (general/4, dental/5, medical/4, behavioral_health/3, veterinary/3). `is_default` column on prompt_templates. Auto-seeded on org creation with industry fallback to general. `POST /api/prompt-templates/reset-defaults` route. 33 tests |
| 3 | **Confidence as first-class filter** | ✅ Done | `claude/review-qa-assemblyai-integration-5NlvX` — Dashboard metrics include avgConfidence + dataQuality breakdown (high/medium/low/none). Top performers include avgConfidence. `GET /api/dashboard/low-confidence` endpoint. Insights summary includes avgConfidence + lowConfidenceRate. Weekly digest includes dataQuality stats. 8 tests |
| 4 | **Call clustering / pattern discovery** | ✅ Done | `claude/review-qa-assemblyai-integration-5NlvX` — TF-IDF cosine similarity on topics/keywords/summary terms. Agglomerative clustering with trend detection (rising/stable/declining). `GET /api/insights/clusters` endpoint with days/minSize/maxClusters/employeeId params. No schema changes (uses existing analysis data). 15 tests |
| 5 | **Bedrock batch inference mode** | ✅ Done | `claude/review-qa-assemblyai-integration-5NlvX` — Per-org `batchMode` setting (realtime/batch/hybrid). Pending items saved to S3, `GET /api/batch/status` and `POST /api/batch/flush` admin routes. Pipeline branches in `continueAfterTranscription` with graceful fallback to realtime. `@aws-sdk/client-bedrock` for job management. 15 tests |

### UMS Knowledge Reference RAG Adaptation Roadmap
Patterns adapted from the ums-knowledge-reference RAG tool for Observatory QA's multi-tenant SaaS context:

| Priority | Feature | Status | Notes |
|----------|---------|--------|-------|
| HIGH | **Adaptive query-type weights** | ✅ Done | `claude/evaluate-qa-rag-integration-MrMze` — Queries classified as `template_lookup` (40/60 S/K), `compliance_question` (55/45), `coaching_question` (75/25), `general` (70/30). `classifyQueryType()` and `getAdaptiveWeights()` in rag.ts. Weights auto-applied in `searchRelevantChunks()` |
| HIGH | **Confidence score reconciliation** | ✅ Done | `claude/evaluate-qa-rag-integration-MrMze` — `reconcileConfidence()` cross-checks LLM-stated confidence (`[CONFIDENCE: HIGH/PARTIAL/LOW]` tag) against retrieval effective score. Downgrades overconfident LLM when retrieval < 0.30, upgrades conservative LLM when retrieval ≥ 0.42. Enhanced `computeConfidence()`: 65/35 top/avg blending (was 60/40), single-result 15% penalty |
| HIGH | **RAG trace observability** | ✅ Done | `claude/evaluate-qa-rag-integration-MrMze` — Enhanced `RagTrace` interface: `queryType`, `semanticWeight`, `keywordWeight`, `retrievedChunkIds[]`, `retrievalScores[]`, `confidenceReconciled`, `inputTokens`, `outputTokens`. Per-query debugging now shows which chunks were used and why |
| MEDIUM | **Domain synonym expansion** | ✅ Done | `claude/evaluate-qa-rag-integration-MrMze` — 5 industry synonym maps (dental: 13 groups, medical: 16, behavioral health: 13, veterinary: 8, general: 10). Bidirectional lookup. `expandQueryWithSynonyms()` boosts BM25 recall on abbreviations (e.g., "cpap" ↔ "c-pap", "crown" ↔ "cap"). Only single-token synonyms appended to avoid noise |
| MEDIUM | **Table-aware chunking** | ✅ Done | `claude/evaluate-qa-rag-integration-MrMze` — Tables (pipe/tab-delimited) detected and preserved as single chunks. Tables >3x chunk size fall back to normal splitting. `preserveTables` option (default: true). Tables extracted before sliding window, then non-table segments chunked normally |
| MEDIUM | **Page number tracking** | ✅ Done | `claude/evaluate-qa-rag-integration-MrMze` — `pageNumber` field on `DocumentChunk`. Form feed (`\f`) markers map char offsets to page numbers (1-indexed). PDFs with page markers get citations like "Page 3, Section: Coverage Criteria" |
| MEDIUM | **Embedding Redis cache** | ✅ Done | `claude/evaluate-qa-rag-integration-MrMze` — Two-tier cache: L1 in-memory LRU (200 entries, same instance) + L2 Redis (1-hour TTL, shared across instances). Redis promotion to L1 on hit. Fire-and-forget Redis writes. Graceful fallback when Redis unavailable |
| MEDIUM | **Cross-org FAQ patterns** | ✅ Done | `claude/evaluate-qa-rag-integration-MrMze` — `getCrossOrgFaqPatterns()` aggregates query patterns across all tenants. Requires 3+ orgs asking same question for anonymization. Surfaces common knowledge gaps for platform-level intelligence (informing default templates, onboarding suggestions) |
| MEDIUM | **Structured reference short-circuit** | ✅ Done | `claude/evaluate-qa-rag-integration-MrMze` — `classifyQueryRoute()` detects pure metadata queries (template lookups, document counts) and `getStructuredAnswer()` answers directly from DB. Saves 2-4 seconds and Bedrock costs. Falls through to RAG if not found |
| MEDIUM | **Query reformulation** | ✅ Done | `claude/evaluate-qa-rag-integration-MrMze` — `reformulateWithContext()` detects follow-up questions via pronoun/reference patterns (short + "that/this/it/them/also/more") and prepends conversation context. Last 4 turns verbatim, older summarized |
| MEDIUM | **Bedrock prompt caching** | ✅ Done | `claude/evaluate-qa-rag-integration-MrMze` — `cachePoint` block in Converse API system prompt enables Bedrock to cache system prompt prefix across requests, reducing input token costs by up to 90%. Token logging tracks cache hit/miss/write status |
| MEDIUM | **Response style configuration** | ✅ Done | `claude/evaluate-qa-rag-integration-MrMze` — `RESPONSE_STYLE_CONFIG` with concise (2K tokens, 4 chunks), detailed (4K, 6 chunks, default), comprehensive (8K, 10 chunks). RAG search endpoint accepts `responseStyle` parameter. Adapted from UMS's STYLE_CONFIG pattern |

## Improvement Backlog (Multi-Sprint)

Longer-term improvements identified during codebase audits. Work on these incrementally across sessions. Mark items `✅ Done` as they're completed, with the branch/session where they were done.

### Clinical Documentation / Medical Scribe
| Priority | Item | Notes |
|----------|------|-------|
| HIGH | **HL7v2 ADT integration** | New protocol adapter, MSH/PID/PV1 message parsing, TCP/MLLP transport. Required for hospital EHR integration beyond dental |
| HIGH | **Clinical decision support alerts** | Rules engine for drug interactions, allergy cross-reference, contraindication warnings during note generation |
| ✅ Done | **Structured data auto-extraction at generation time** | `claude/audit-observatory-codebase-0eONS` — `extractStructuredDataFromSections()` now runs during pipeline before encryption; vitals/meds/allergies stored on note creation |
| ✅ Done | **Clinical note retry on AI failure** | `claude/audit-observatory-codebase-0eONS` — when AI returns no `clinical_note`, call gets `requires_clinical_retry` flag for admin review |
| ✅ Done | **Amendment chain integrity** | `claude/audit-observatory-codebase-0eONS` — SHA-256 hash chain on amendments; each amendment's `integrityHash` includes previous hash for tamper detection |
| ✅ Done | **Cosignature version conflict detection** | `claude/audit-observatory-codebase-0eONS` — cosign endpoint verifies no post-attestation amendments exist; optimistic locking via version check |
| ✅ Done | **ICD-10/diagnosis linkage** | `claude/audit-observatory-codebase-0eONS` — `linkedDiagnosis` and `isPrimary` fields; FHIR export shows linkage |
| ✅ Done | **Amendment subtypes** | `claude/audit-observatory-codebase-0eONS` — `section_completion` type auto-detected |
| ✅ Done | **Batch clinical note revalidation** | `claude/audit-observatory-codebase-0eONS` — `POST /api/clinical/notes/batch-revalidate` (max 200 notes) |
| ✅ Done | **Vital signs range validation** | `claude/audit-codebase-ZbYgc` — physiological range checks on extracted BP, HR, RR, Temp, SpO2, BMI |
| ✅ Done | **Cosign NPI validation** | `claude/audit-codebase-ZbYgc` — `/^\d{10}$/` regex on cosignature NPI (was only on attestation) |
| ✅ Done | **Viewer PHI filtering expanded** | `claude/audit-codebase-ZbYgc` — redact codes, structuredData, editHistory, dental fields for viewer role |
| ✅ Done | **FHIR subject fallback** | `claude/audit-codebase-ZbYgc` — placeholder patient display text when no EHR link |
| ✅ Done | **Amendment decryption audit** | `claude/audit-codebase-ZbYgc` — per-failure logging + HIPAA audit event |

### Call Analysis
| Priority | Item | Notes |
|----------|------|-------|
| ✅ Done | **Upload deduplication lock** | `claude/audit-codebase-ZbYgc` — Redis SET NX lock with explicit release after createCall; in-memory fallback |
| ✅ Done | **Confidence-based prompt adjustment** | `claude/audit-observatory-codebase-0eONS` — low-confidence transcripts inject [UNCLEAR] guidance |
| ✅ Done | **Prompt template caching** | `claude/audit-observatory-codebase-0eONS` — 5-min TTL cache by orgId:category |
| ✅ Done | **Per-call cost attribution** | `claude/audit-observatory-codebase-0eONS` — actual Bedrock token counts from response metadata |
| ✅ Done | **Pipeline storage resilience** | `claude/audit-codebase-ZbYgc` — Promise.allSettled for transcript/sentiment/analysis writes |
| ✅ Done | **Flag validation tightened** | `claude/audit-codebase-ZbYgc` — custom flags restricted to safe alphanumeric pattern |
| ✅ Done | **Auto-assignment safety** | `claude/audit-codebase-ZbYgc` — require explicit Active status; handle missing agent in role map |
| ✅ Done | **Unlabeled speaker tracking** | `claude/audit-codebase-ZbYgc` — expose unlabeledSpeakerPercent when >10% words lack labels |

### RAG Knowledge Base
| Priority | Item | Notes |
|----------|------|-------|
| ✅ Done | **Chunk deduplication** | `claude/audit-observatory-codebase-0eONS` — content hash per chunk, reuse embeddings for identical text |
| ✅ Done | **Semantic deduplication of results** | `claude/audit-observatory-codebase-0eONS` — 85% text overlap filter |
| ✅ Done | **PDF extraction timeout** | `claude/audit-observatory-codebase-0eONS` — 5s Promise.race with regex fallback |
| ✅ Done | **Chunk-level retrieval tracking** | `claude/audit-observatory-codebase-0eONS` — retrieval_count column on document_chunks |
| ✅ Done | **pgvector availability check** | `claude/audit-observatory-codebase-0eONS` — startup validation logs version or warning |
| ✅ Done | **Score normalization** | `claude/audit-codebase-ZbYgc` — divide by weight sum so custom configs produce [0,1] scores |
| ✅ Done | **FAQ NaN guard** | `claude/audit-codebase-ZbYgc` — skip recording when confidenceScore is NaN/Infinity |
| ✅ Done | **Embedding retry jitter** | `claude/audit-codebase-ZbYgc` — random 0-500ms jitter prevents thundering herd |
| ✅ Done | **Silent degradation detection** | `claude/audit-codebase-ZbYgc` — warns when all chunks have NULL embeddings |

### HIPAA Compliance
| Priority | Item | Notes |
|----------|------|-------|
| ✅ Done | **BAA management system** | `claude/codebase-audit-evaluation-MhG8w` — `business_associate_agreements` table + CRUD routes + expiry alerting. Tracks vendor, signatory, PHI categories, expiry dates, renewal reminders |
| ✅ Done | **Automated breach detection** | `claude/codebase-audit-evaluation-MhG8w` — PHI access velocity (50/10min) and breadth (20 unique resources/10min) tracking with auto-incident creation via `declareIncident()` |
| ✅ Done | **S3/backup lifecycle purging** | `claude/audit-observatory-codebase-0eONS` — retention worker now purges orphaned S3 audio files |
| ✅ Done | **PHI access reporting UI** | `claude/audit-observatory-codebase-0eONS` — `GET /api/admin/phi-access-report` with user summary, date range |
| MEDIUM | **Audit log chain state memory** | Per-org `chainLocks` Map can hold 10K+ pending promises under load; no cleanup of completed entries. Move to Redis for multi-instance |
| ✅ Done | **Key escrow for PHI encryption** | `claude/audit-observatory-codebase-0eONS` — documented AWS Secrets Manager backup + rotation procedure |

### LMS / Learning
| Priority | Item | Notes |
|----------|------|-------|
| ✅ Done | **Progress upsert race condition** | `claude/audit-codebase-ZbYgc` — `INSERT ON CONFLICT DO UPDATE` + unique constraint in sync-schema |
| ✅ Done | **Quiz question versioning** | `claude/audit-observatory-codebase-0eONS` — SHA-256 hash stored with progress |
| ✅ Done | **N+1 query in path progress** | `claude/audit-observatory-codebase-0eONS` — batch-fetch via listLearningModules |
| ✅ Done | **Learning path assignment notifications** | `claude/audit-observatory-codebase-0eONS` — email + audit log |
| ✅ Done | **Bulk progress operations** | `claude/audit-observatory-codebase-0eONS` — bulk complete/reset/assign (max 200) |
| ✅ Done | **Stats endpoint optimization** | `claude/audit-observatory-codebase-0eONS` — SQL-level COUNT/AVG FILTER aggregation |

### Lead Tracking
| Priority | Item | Notes |
|----------|------|-------|
| ✅ Done | **UTM parameter capture** | `claude/audit-observatory-codebase-0eONS` — utmSource/Medium/Campaign/Content/Term fields, auto-mapping, 0.95 confidence |
| MEDIUM | **CRM webhook integration** | No outbound webhooks to Salesforce/HubSpot when call-to-appointment conversion is tracked |
| ✅ Done | **Cohort conversion analysis** | `claude/audit-observatory-codebase-0eONS` — `GET /api/marketing/cohort` with monthly cohorts, per-source breakdown |
| ✅ Done | **Time-to-convert metrics** | `claude/audit-observatory-codebase-0eONS` — `convertedAt` field, auto-set on conversion, `daysToConvert` in API |

### Architecture / Code Quality
| Priority | Item | Effort | Impact | Notes |
|----------|------|--------|--------|-------|
| HIGH | **Storage layer type safety** | 5 days | High — eliminates ~200 `as any` casts | `pg-storage.ts` has 82 `as any` casts, mostly from untyped Drizzle query results. Fix: add generic return types to all IStorage methods; update mapAnalysis/mapUser/mapEmployee to use typed row objects. Eliminates the #1 source of type unsafety. Sprint 1 priority |
| HIGH | **asyncHandler adoption Phase 2 (server routes)** | 2 days | Medium — eliminates ~330 remaining catch blocks | Phase 1 done: coaching (29→1), onboarding (28→13), mfa (21→2). Phase 2 targets by catch count: admin.ts (21), ehr.ts (20), billing.ts (20), clinical.ts (19), lms.ts (18), emails.ts (17), ab-testing.ts (16), live-session.ts (15), + 18 smaller files. Convert in batches of 4-5 via parallel agents. Sprint 2 |
| ✅ Done | **Call processing transaction wrapper** | — | — | `claude/audit-and-prioritize-GydTL` — added `withTransaction` to IStorage (PostgresStorage: real Drizzle tx; MemStorage/CloudStorage: no-op). Wrapped main pipeline, batch mode, empty transcript, and live session writes |
| MEDIUM | **Consolidate URL validation utilities** | 0.5 days | Low — reduces confusion | `url-validation.ts` (used by 3 files) and `url-validator.ts` (used only by tests) have overlapping SSRF checks. Merge the best checks from both into `url-validation.ts`, update the 15 test imports in `remaining-adaptations.test.ts`, delete `url-validator.ts`. Sprint 2 |
| MEDIUM | **Large file decomposition (remaining)** | 3 days | Medium — improves navigability | 14 files still >1000 LOC. Server: `memory.ts` (1.6K → split by domain), `sync-schema.ts` (1.5K → split by table group), `rag.ts` (1.3K → extract synonym/query modules), `call-processing.ts` (1.2K → extract pipeline steps). Client: `transcript-viewer.tsx` (1.3K → extract correction UI), `clinical-notes.tsx` (1.2K → extract print/amendment), `reports.tsx` (1.2K → extract chart sections). Sprint 2-3 |
| MEDIUM | **MemStorage parity with PostgresStorage** | 2 days | Medium — prevents dev/prod divergence | Key behavioral gaps: `searchCalls` only searches transcript text (PG also searches summaries+topics), `getTopPerformers` has no min-calls threshold (PG requires 5), `deleteOrgData` misses ~15 collections, `deleteExpiredCallShares` ignores orgId. Fix the 4 highest-impact gaps. Sprint 2 |
| ✅ Done | **Rate limit key normalization** | — | — | `claude/audit-and-prioritize-GydTL` — UUID segments replaced with `:id` placeholder; PHI rate limits now apply per-endpoint-class |
| ✅ Done | **Inline schema centralization** | — | — | `claude/audit-observatory-codebase-0eONS` — selfReview, dispute, resolveDispute, callReferral, selfAssess schemas moved to `shared/schema/features.ts` |
| ✅ Done | **Team scoping TOCTOU fix** | — | — | `claude/codebase-audit-evaluation-MhG8w` — pre-compute team scope before fetch; return 404 instead of 403 |
| ✅ Done | **promptTemplateCache LRU** | — | — | `claude/audit-and-prioritize-GydTL` — replaced unbounded Map with LruCache (500 entries, 5-min TTL) |
| ✅ Done | **orgCache LRU** | — | — | `claude/audit-and-prioritize-GydTL` — replaced FIFO Map with LruCache in auth.ts |
| ✅ Done | **Feedback pagination** | — | — | `claude/audit-and-prioritize-GydTL` — applied parsePagination limit/offset |
| ✅ Done | **Coaching pagination** | — | — | `claude/audit-and-prioritize-GydTL` — applied parsePagination limit/offset |
| ✅ Done | **Users Drizzle schema sync** | — | — | `claude/audit-and-prioritize-GydTL` — added webauthnCredentials, mfaTrustedDevices, mfaEnrollmentDeadline to Drizzle |
| ✅ Done | **Analysis schema sync** | — | — | `claude/audit-and-prioritize-GydTL` — added 5 missing columns + wired 11 fields into create/update/mapper |
| ✅ Done | **deleteOrgData completeness** | — | — | `claude/audit-and-prioritize-GydTL` — added 11 missing tables to GDPR deletion |
| ✅ Done | **Dead BAA table removal** | — | — | `claude/audit-and-prioritize-GydTL` — removed unused baaRecords Drizzle definition |
| LOW | **290 ESLint `no-unused-vars` warnings** | 1 day | Low — reduces CI noise | Spread across ~100 files, mostly unused function params. Prefix with `_` or remove. Can be done incrementally. Sprint 3+ |
| LOW | **OIDC state persistence** | 1 day | Low until multi-instance | OIDC state map is in-memory. Multi-instance deployments need Redis-backed state. Only relevant when scaling to >1 server. Sprint 3+ |
| LOW | **UUID validation on remaining routes** | 1 day | Low — defense-in-depth | validateUUIDParam added to critical PHI routes. ~30 non-PHI routes still missing. Add incrementally. Sprint 3+ |
| LOW | **Scores as VARCHAR→NUMERIC migration** | 2 days | Medium — eliminates parse/cast overhead | performanceScore, confidenceScore, talkTimeRatio, responseTime stored as VARCHAR(20) but always used as numbers. Would require Drizzle migration + update all comparison/sort code. High risk, defer unless performance bottleneck proven. Sprint 4+ |

### Security
| Priority | Item | Effort | Impact | Notes |
|----------|------|--------|--------|-------|
| ✅ Done | **Session invalidation after password reset** | — | — | `claude/audit-and-prioritize-GydTL` — new `invalidateUserSessions()` utility in redis.ts; called from password-reset and admin password-change; refactored admin.ts from 30 lines inline to 4-line utility call |
| ✅ Done | **Invitation token hashing** | — | — | `claude/audit-and-prioritize-GydTL` — SHA-256 hash before storage; tokenPrefix for admin display; backward-compatible plaintext fallback for 7-day expiry window |
| ✅ Done | **CSRF on direct fetch() calls** | — | — | `claude/audit-and-prioritize-GydTL` — new `csrfFetch()` utility in queryClient.ts; migrated 15 client files (40+ fetch calls) from raw fetch() to csrfFetch() |
| MEDIUM | **Account lockout eviction** | 0.5 days | Medium — brute-force mitigation gap | `loginAttempts` map evicts oldest entry when full; attacker floods with unique usernames to evict target's lockout tracking. Fix: use username hash + IP composite key, or move to Redis sorted set. Sprint 2 |
| MEDIUM | **Session absolute max configurable** | 0.5 days | Medium — NIST compliance | 8-hour absolute max exceeds NIST 4-6h recommendation for healthcare. Make configurable per-org via org settings (default 6h). Sprint 2 |
| MEDIUM | **CSP `unsafe-inline` for styles** | 5 days | Medium — prevents CSS injection | Required by Recharts inline styles + Framer Motion transforms. Fix: extract Recharts styles to CSS classes, use Framer Motion's CSS transform option. Large effort due to chart component refactoring. Sprint 3+ |
| ✅ Done | **CSRF bypass via x-api-key** | — | — | `claude/audit-and-prioritize-GydTL` — now requires `Bearer obs_k_` prefix |
| ✅ Done | **Tenant isolation on marketing/LMS** | — | — | `claude/audit-and-prioritize-GydTL` — added injectOrgContext to 29 routes |
| ✅ Done | **Webhook empty-token bypass** | — | — | `claude/audit-and-prioritize-GydTL` — rejects when no secret configured |
| ✅ Done | **DB SSL certificate verification** | — | — | `claude/audit-and-prioritize-GydTL` — rejectUnauthorized now defaults to true |
| ✅ Done | **Prompt injection hardening** | — | — | `claude/codebase-audit-evaluation-MhG8w` — HTML entities, comments, tags, ReDoS prevention |
| ✅ Done | **Org cache invalidation** | — | — | `claude/audit-codebase-ZbYgc` — all 7 updateOrganization sites |
| ✅ Done | **Session secret fail-fast** | — | — | `claude/codebase-audit-evaluation-MhG8w` |
| LOW | **Error message information disclosure** | 1 day | Low | Some routes expose underlying error messages. Audit all `catch` blocks for message leakage. Sprint 3+ |

### RAG Knowledge Base (continued)
| Priority | Item | Notes |
|----------|------|-------|
| ✅ Done | **Empty embedding arrays corrupt pgvector** | `claude/codebase-audit-evaluation-MhG8w` — failed chunks stored as null; existing IS NOT NULL filter excludes them |
| ✅ Done | **BM25 normalization overflow** | `claude/audit-codebase-ZbYgc` — score normalization divides by weight sum; combined score stays in [0,1] |
| ✅ Done | **Embedding cache FIFO→LRU** | `claude/codebase-audit-evaluation-MhG8w` — new LruCache utility used for embedding, refDoc, and orgProvider caches |
| ✅ Done | **Silent RAG degradation** | `claude/audit-codebase-ZbYgc` — warns when 0 candidates returned because all chunks have NULL embeddings |
| LOW | **AI provider cache invalidation** | `orgProviderCache` in `ai-factory.ts` never invalidated when org changes `bedrockModel`; stale model used until restart |

### Call Analysis (continued)
| Priority | Item | Notes |
|----------|------|-------|
| ✅ Done | **Ref doc cache FIFO→LRU** | `claude/codebase-audit-evaluation-MhG8w` — uses shared LruCache utility |
| ✅ Done | **analyzeAndStoreEditPatterns N+1 fix** | `claude/codebase-audit-evaluation-MhG8w` — uses call.analysis from CallWithDetails (already batch-loaded) instead of 500 individual queries |

### Testing
| Priority | Item | Effort | Impact | Notes |
|----------|------|--------|--------|-------|
| HIGH | **Tautological test cleanup** | 2 days | High — false confidence elimination | `rbac.test.ts`, `input-validation.test.ts`, `billing.test.ts`, `webhook-retry.test.ts` redefine constants locally instead of importing from production code. Tests pass even if production changes. Fix: import from source modules and test actual behavior. Sprint 1 |
| HIGH | **Stripe webhook verification tests** | 1 day | High — critical billing path untested | No tests for webhook signature verification, subscription lifecycle events, or idempotency. Fix: add tests using Stripe's test webhooks with mock signatures. Sprint 1 |
| MEDIUM | **HTTP integration test suite** | 3 days | High — fills unit↔E2E gap | No HTTP-level tests against real Express server. Gap between mocked unit tests and browser E2E. Fix: add supertest-based tests that start the Express app against MemStorage, covering auth flows, CSRF, rate limiting, org isolation. Sprint 2 |
| MEDIUM | **E2E against PostgreSQL** | 2 days | Medium — catches PG-specific bugs | E2E runs against MemStorage. Race conditions, RLS, transaction behavior untested. Fix: docker-compose test profile with PG + pgvector. Sprint 2-3 |
| MEDIUM | **Rate limiter enforcement tests** | 0.5 days | Medium — security validation | Rate limiting is only tested for header presence (E2E relaxes to 500 limit). No test proves actual blocking behavior. Fix: unit test the in-memory rate limiter with real request counts. Sprint 2 |
| ✅ Done | **E2E credential alignment** | — | — | `claude/audit-and-prioritize-GydTL` — aligned CI and Playwright config to same credentials |
| ✅ Done | **Coverage thresholds** | — | — | `claude/codebase-audit-evaluation-MhG8w` — lines 70%, functions 60%, branches 55% |
| ✅ Done | **E2E test isolation** | — | — | `claude/codebase-audit-evaluation-MhG8w` — per-worker org registration |
| ✅ Done | **AI provider mocks** | — | — | `claude/codebase-audit-evaluation-MhG8w` — MockBedrockProvider with 6 behaviors |

### DevOps / Infrastructure
| Priority | Item | Effort | Impact | Notes |
|----------|------|--------|--------|-------|
| HIGH | **Move in-memory state to Redis** | 3 days | High — enables multi-instance | 7+ in-memory Maps lose state on restart/across instances: OIDC state (mfa.ts), email OTP (mfa.ts), live sessions (live-session.ts), loginAttempts (auth.ts), rateLimitMap (index.ts). Fix: use Redis with TTL keys. Required before horizontal scaling. Sprint 1-2 |
| HIGH | **Pin CI actions to SHA** | 0.5 days | High — supply chain security | Main CI workflow uses floating tags (`@v4`). Nightly/PR-review correctly pin SHAs. Fix: pin all actions to SHA digests. Sprint 1 |
| HIGH | **Backup script PHI safety** | 0.5 days | High — HIPAA compliance | `deploy/ec2/backup.sh` stores dumps in `/tmp` (world-readable) before S3 upload. Fix: use `mktemp -d` with 700 permissions, cleanup on exit trap. Sprint 1 |
| MEDIUM | **Dependency audit on PRs** | 0.5 days | Medium — vulnerability detection | Weekly-only check; critical vulns can ship for days. Fix: add `npm audit --audit-level=high` to PR review workflow. Sprint 2 |
| MEDIUM | **Container image scanning** | 1 day | Medium — supply chain security | No SAST/DAST or container scanning. Fix: add Trivy scan on Docker build step. Sprint 2 |
| MEDIUM | **Canary deployment** | 3 days | Medium — reduces deployment risk | All production traffic switches immediately. Fix: add health-check gated traffic shifting in deploy.sh (10% → 50% → 100% with rollback). Sprint 3 |
| ✅ Done | **Docker ports bound to localhost** | — | — | `claude/audit-and-prioritize-GydTL` — PostgreSQL/Redis no longer exposed on 0.0.0.0 |
| ✅ Done | **Security gates Docker builds** | — | — | `claude/audit-and-prioritize-GydTL` — security job now required for Docker push |
| ✅ Done | **Docker image push** | — | — | `claude/codebase-audit-evaluation-MhG8w` — GHCR on main merges |
| ✅ Done | **Schema sync validation** | — | — | `claude/codebase-audit-evaluation-MhG8w` — TypeScript test gate |

### UI/UX
| Priority | Item | Effort | Impact | Notes |
|----------|------|--------|--------|-------|
| HIGH | **Progressive disclosure by plan tier** | 2 days | High — reduces cognitive overload | 34 sidebar items overwhelm new users. Show only relevant features per plan tier (Free: dashboard/upload/transcripts/settings; Starter adds coaching/reports/insights; Professional adds clinical/calibration; Enterprise adds admin/SSO/audit). Sprint 1 |
| HIGH | **Accessibility audit with axe-core** | 2 days | Medium — compliance + usability | Missing `htmlFor`/`id` pairing on auth.tsx, invite-accept.tsx, settings tabs. Mobile sidebar lacks focus trap. 404 page uses hardcoded colors instead of theme. Fix: add axe-core to E2E, fix all critical/serious violations. Sprint 1-2 |
| MEDIUM | **AudioRecorder blob URL leak** | 0.5 days | Low — memory leak | Cleanup effect uses stale closure for `audioUrl`. Fix: use ref to track latest URL for unmount cleanup. Sprint 2 |
| MEDIUM | **`useIsMobile` SSR flash** | 0.5 days | Low — mobile UX | Returns `false` on first render causing layout shift. Fix: initialize with synchronous `window.innerWidth` check. Sprint 2 |
| MEDIUM | **Keyboard shortcuts in contenteditable** | 0.5 days | Low — editor UX | Shortcuts fire in contenteditable elements and open modals. Fix: check `contenteditable` attr and `[role=dialog]` ancestors. Sprint 2 |
| MEDIUM | **Replace native `confirm()` with ConfirmDialog** | 0.5 days | Low — UX consistency | ApiKeysTab.tsx and UsersTab.tsx use browser `confirm()`. Rest of app uses ConfirmDialog component. Sprint 2 |
| MEDIUM | **ScriptProcessorNode deprecation** | 2 days | Medium — clinical recording reliability | `clinical-live.tsx` uses deprecated `createScriptProcessor()` which runs on main thread. Migrate to AudioWorklet for production reliability. Sprint 3 |
| ✅ Done | **Idle timeout warning bypass** | — | — | `claude/audit-and-prioritize-GydTL` — requires explicit click, not just mouse movement |
| ✅ Done | **ErrorBoundary dashboard link** | — | — | `claude/audit-and-prioritize-GydTL` — fixed route from `/dashboard` to `/` |
| ✅ Done | **CSRF cookie name mismatch** | — | — | `claude/audit-and-prioritize-GydTL` — `file-upload.tsx` now reads `csrf-token` (hyphen) |
| ✅ Done | **Dashboard query freshness** | — | — | `claude/codebase-audit-evaluation-MhG8w` |
| ✅ Done | **Upload progress tracking** | — | — | `claude/audit-observatory-codebase-0eONS` |
| LOW | **Onboarding wizard step validation** | 1 day | Medium — prevents incomplete setup | Users can proceed through steps without completing required fields. Sprint 3+ |
| LOW | **File upload dropzone maxSize** | 0.5 days | Low | `react-dropzone` has no `maxSize` in config; validation only in callback. Sprint 3+ |
| LOW | **Large page decomposition** | 2 days | Low | `clinical-notes.tsx` (1.2K), `reports.tsx` (1.2K) could be split into sub-components. Sprint 3+ |
