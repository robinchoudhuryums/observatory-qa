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
npx tsx server/db/migrate-audit-chain.ts  # One-time: recompute audit log hash chain (run after F37 deploy)
npx vite build         # Frontend-only build (quick verification)
```

## Testing
- **Unit tests**: Node.js built-in `test` module via `tsx` — `npm run test`
- **E2E tests**: Playwright (Chromium) — `npm run test:e2e` or `npm run test:e2e:ui`
- **Location**: `tests/` (unit), `tests/e2e/` (E2E)
- **Unit test files** (82 files, 1623 tests):
  - `tests/schema.test.ts` — Zod schema validation (orgId on all entities, organization schemas)
  - `tests/ai-provider.test.ts` — AI provider utilities (parseJsonResponse, buildAnalysisPrompt, smartTruncate)
  - `tests/routes.test.ts` — API route handler tests
  - `tests/auth-routes.test.ts` — Auth route handler tests
  - `tests/auto-calibration.test.ts` — Auto-calibration drift detection
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
  - `tests/ehr-open-dental.test.ts` — Open Dental EHR adapter (error classification, patient/allergy/medication parsing, appointment procedure parsing, treatment plan fees, status mapping, duration patterns, 32 tests)
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
  - `tests/mfa.test.ts` — MFA logic: TOTP generation/verification, backup codes, rate limiting, trusted device tokens, grace period (27 tests)
  - `tests/validation.test.ts` — Input validation
  - `tests/load-simulation.test.ts` — Load simulation (5 orgs × 200 calls, concurrent operations, data isolation)
  - `tests/login-ambiguity.test.ts` — Multi-org login ambiguity (OBS-AUTH-008)
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
  - `tests/waf.test.ts` — WAF middleware: SQL injection, XSS, path traversal, suspicious user agents, anomaly scoring, IP blocking (28 tests)
  - `tests/webhook-retry.test.ts` — Webhook retry logic
  - `tests/audit-fixes.test.ts` — Audit fix verification (prompt injection, PHI redaction, LRU cache, RAG config, upload dedup, output guardrails)
  - `tests/schema-column-coverage.test.ts` — Schema sync column-level validation (Drizzle vs sync-schema DDL)
  - `tests/bedrock-mock.test.ts` — AI provider mock tests (score clamping, error codes, behavior switching)
  - `tests/language-sentiment-skip.test.ts` — Language-aware sentiment skipping (non-English cost optimization, 8 tests)
  - `tests/default-templates.test.ts` — Default industry template seeding (JSON validation, scoring weights, org isolation, 33 tests)
  - `tests/confidence-filter.test.ts` — Confidence as first-class filter (dashboard metrics, data quality breakdown, boundary values, MemStorage, 8 tests)
  - `tests/call-clustering.test.ts` — Call clustering (TF-IDF, cosine similarity, agglomerative clustering, trend detection, 15 tests)
  - `tests/bedrock-batch.test.ts` — Bedrock batch inference (shouldUseBatchMode, isBatchAvailable, org settings validation, 15 tests)
  - `tests/billing-webhooks.test.ts` — Stripe webhook lifecycle (overage pricing, metered item sync, subscription state transitions, idempotency, grace period, webhook signature verification, 43 tests)
  - `tests/billing-webhook-integration.test.ts` — Billing webhook integration against MemStorage (subscription lifecycle, metered item tracking, payment failure/recovery, re-subscription, 14 tests)
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

server/routes/               # Modular API route files (44 route files)
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
  coaching.ts                #   Coaching session CRUD, AI coaching plan generation, automation rules, templates, self-assessment, LMS module generation bridge
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
  calibration.ts             #   Calibration sessions: multi-evaluator QA alignment, variance tracking, IRR analytics, evaluator certification, multi-session QA audit packet export
  call-insights.ts           #   Call-level insights and trend analysis
  emails.ts                  #   Email management: templates, send history, email analytics
  live-session.ts            #   Real-time live clinical session (AssemblyAI real-time), manual draft notes, opt-in continuous clinical-scribe auto-drafting
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
  ai-factory.ts              #   AI provider setup (Bedrock, per-org model config, per-org circuit breaker with global fallback)
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
  index.ts                   #   Barrel exports + runAllDailyTasks() orchestrator (single listOrganizations call, per-task error isolation + per-task timeouts)
  scheduler.ts               #   scheduleDaily(utcHour, fn) and scheduleWeekly(dayOfWeek, utcHour, fn) — setTimeout chains, no drift
  retention.ts               #   Data retention purge (per-org retentionDays)
  trial-downgrade.ts         #   Trial subscription auto-downgrade to free
  quota-alerts.ts            #   Proactive quota usage alerts (80%/100% thresholds)
  weekly-digest.ts           #   Weekly performance/coaching digest to webhook
  audit-chain-verify.ts      #   Nightly HIPAA audit chain integrity verification
  coaching-tasks.ts          #   Coaching automation rules, effectiveness caching, follow-up reminders
  post-processing-reconciliation.ts  #   Daily reconciliation: finds completed calls with missing usage records and re-tracks them

server/services/ehr/         # EHR integration adapters (11 files)
  types.ts                   #   IEhrAdapter interface, EhrPatient, EhrAppointment, EhrClinicalNote, EhrTreatmentPlan, EhrHealthStatus, EhrError class, classifyEhrError()
  index.ts                   #   EHR adapter factory (5 adapters: open_dental, eaglesoft, dentrix, fhir_r4, mock)
  open-dental.ts             #   Open Dental adapter (bidirectional: patient lookup, note push, treatment plans with procedure-level fees, appointment creation)
  eaglesoft.ts               #   Eaglesoft/Patterson eDex adapter (bidirectional with eDex v2+)
  dentrix.ts                 #   Dentrix Ascend / G7 adapter (bidirectional)
  fhir-r4.ts                 #   Generic FHIR R4-compliant server adapter (bidirectional, classifyEhrError for typed error handling)
  mock.ts                    #   Development/demo adapter (returns fixture data)
  request.ts                 #   Shared HTTP request utilities for EHR adapters (includes SSRF URL validation via validateUrl)
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
  migrate-audit-chain.ts     #   One-time audit hash chain recomputation (run after F37 timestamp fix deploy)
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
- `ClinicalNote` — embedded in CallAnalysis: format (SOAP/DAP/BIRP/HPI/procedure), specialty, subjective, objective, assessment, plan, HPI, ROS, differentialDiagnoses, icd10Codes, cptCodes, cdtCodes, toothNumbers, periodontalFindings, treatmentPhases, providerAttested, attestedBy, editHistory, consentObtained, documentationCompleteness (0-10), clinicalAccuracy (0-10), `amendments[]` — array of post-attestation amendment snapshots (reason, changedBy, timestamp, fieldsChanged), `cosignature` — supervising provider co-signature (cosignedBy, cosignedById, cosignedNpi, cosignedAt, role, acknowledgedAddendaCount), `cosignatureRequired` — boolean flag, `structuredData` — extracted vitals (BP, HR, RR, temp, O2sat, pain, weight), medications[], allergies[], `qualityScoreBreakdown` — icd10Specificity, requiredElementsPresent, planDiagnosisAlignment, overallQuality (all 0-10)
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
5. **Retrieval** (`rag.ts`) — hybrid search: pgvector cosine similarity (HNSW index) + BM25 keyword boosting with IDF from candidate corpus and log-linear normalization. **Adaptive query-type weights**: queries classified as `template_lookup` (40/60 semantic/keyword), `compliance_question` (55/45), `coaching_question` (75/25), or `general` (70/30). **Domain synonym expansion** per industry vertical (dental, medical, behavioral health, veterinary) for improved BM25 recall on abbreviations. Minimum relevance score threshold (0.3) filters low-quality chunks
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
| `server/storage/index.ts` | `storage`, `initPostgresStorage`, `objectStorage`, `IStorage`, `normalizeAnalysis` | 56 | 44 route files, 9 services, 2 db files, auth.ts, index.ts. Workers access via dynamic `require()`. Scheduled tasks receive storage as a parameter, not via singleton import |
| `shared/schema.ts` (barrel) | Types, Zod schemas, `PLAN_DEFINITIONS`, `CALL_CATEGORIES` | 50+ | Routes, services, storage, client pages. Workers get types indirectly via queue job interfaces |
| `server/auth.ts` | `requireAuth`, `injectOrgContext`, `requireOrgContext`, `requireRole`, `getTeamScopedEmployeeIds`, `sessionMiddleware`, `resolveUserOrgId`, `ROLE_HIERARCHY` | 36 | All authenticated route files + websocket + tests. Applied per-route (not globally in index.ts) |
| `server/services/audit-log.ts` | `logPhiAccess`, `auditContext`, `queryAuditLogs`, `exportAuditLogs`, `verifyAuditChain` | 35 | 32 route files + auth.ts + incident-response.ts + retention.worker.ts |
| `server/services/call-processing.ts` | `processAudioFile`, `continueAfterTranscription`, `invalidateRefDocCache`, `cleanupFile`, `computeConfidence`, `autoAssignEmployee`, `mapClinicalNote` | 2 | routes/calls.ts, routes/assemblyai-webhook.ts. Low consumer count but highest internal complexity (14+ deps) |
| `server/services/phi-encryption.ts` | `encryptField`, `decryptField`, `decryptClinicalNotePhi`, `isPhiEncryptionEnabled`, `encryptMfaSecret`, `decryptMfaSecret` | 12 | Clinical routes (3), calls, mfa, ehr, live-session, pg-storage, call-processing, ehr-note-push worker, ehr/health-monitor, ehr/appointment-matcher |
| `server/services/ai-factory.ts` | `aiProvider`, `getOrgAIProvider`, `getBedrockCircuitState`, `withBedrockProtection`, `acquireBedrockSlot`, `releaseBedrockSlot` | 11 | call-processing, coaching-engine, clinical, call-insights, reports, insurance-narratives, lms, health, admin, live-session, emails. Circuit breaker is per-org (threshold 5) with global fallback (threshold 15) |
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
        └─ postProcessing() (wrapped in try/catch — errors logged but NEVER mark the call as failed or trigger retries; individual steps use withRetry)
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
| GET | `/api/coaching/my` | authenticated | Get caller's own coaching sessions (auto-resolved by email/name) |
| GET | `/api/coaching/employee/:id` | authenticated | Coaching for employee |
| POST | `/api/coaching` | manager+ | Create coaching session |
| PATCH | `/api/coaching/:id` | manager+ | Update coaching session |
| POST | `/api/coaching/:id/generate-plan` | manager+ | AI-generate structured coaching action plan from call history |
| POST | `/api/coaching/:id/generate-lms-module` | manager+ | Auto-generate an LMS module from the coaching session (body: `assignToEmployee?`, `generateQuiz?`, `difficulty?`) |
| POST | `/api/coaching/:id/self-assess` | authenticated | Employee self-assessment of a coaching session |
| GET | `/api/coaching/:id/self-assessment` | authenticated | Read self-assessment |
| GET | `/api/coaching/:id/effectiveness` | authenticated | Compute pre/post coaching effectiveness |
| POST | `/api/coaching/:id/effectiveness/snapshot` | manager+ | Cache effectiveness snapshot |
| GET | `/api/coaching/templates` | authenticated | List coaching templates |
| POST | `/api/coaching/templates` | manager+ | Create coaching template |
| PATCH | `/api/coaching/templates/:id` | manager+ | Update coaching template |
| DELETE | `/api/coaching/templates/:id` | manager+ | Delete coaching template |
| GET | `/api/coaching/automation-rules` | admin | List automation rules |
| POST | `/api/coaching/automation-rules` | admin | Create automation rule |
| PATCH | `/api/coaching/automation-rules/:id` | admin | Update automation rule |
| DELETE | `/api/coaching/automation-rules/:id` | admin | Delete automation rule |
| POST | `/api/coaching/automation-rules/run` | admin | Run automation rules now |
| GET | `/api/coaching/digest` | manager+ | Preview weekly coaching digest |
| POST | `/api/coaching/digest/send` | admin | Send weekly coaching digest |
| GET | `/api/coaching/overdue` | manager+ | List overdue coaching sessions |

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
| PATCH | `/api/clinical/notes/:callId` | authenticated | Edit note fields (requires `version` for conflict detection; attested notes also require re-attestation) |
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
| POST | `/api/clinical/notes/:callId/cosign` | manager+ | Co-sign/supervising provider attestation. Body supports optional `acknowledgedAddenda: true` — required when post-attestation addenda exist (409 `OBS-CLINICAL-COSIGN-ADDENDA` otherwise). `acknowledgedAddendaCount` is captured in the cosignature record and audit log for compliance trail |
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
| GET | `/api/calibration/audit-packet` | manager+ | Multi-session QA audit packet with org-wide Krippendorff α, ICC, evaluator certification summary, and per-session breakdowns (query: `startDate`, `endDate`, `format=json\|csv`; default window 90 days) |

### Live Sessions (org-scoped, requires Clinical Documentation plan)
| Method | Path | Role | Description |
|--------|------|------|-------------|
| POST | `/api/live-sessions` | manager+ | Start real-time clinical session (AssemblyAI streaming). **Required**: `consentObtained: true` and `consentMethod` ("verbal" \| "written" \| "electronic") — returns 400 `OBS-CLINICAL-CONSENT-METHOD-REQUIRED` otherwise. Consent is persisted with `consentCapturedAt` + `consentCapturedBy` and a HIPAA `clinical_consent_obtained` audit event. Body also supports `continuousDraftMode: true` to enable server-side auto-drafting of the clinical note every 3 new final segments or 20s elapsed (whichever first). WebSocket `draft_note` events carry `autoDrafted: true` when generated automatically |
| GET | `/api/live-sessions/:id` | authenticated | Get session status + transcript |
| GET | `/api/live-sessions/:id/audio` | authenticated | Stream live audio |
| POST | `/api/live-sessions/:id/draft-note` | authenticated | Draft clinical note during session |
| PATCH | `/api/live-sessions/:id/pause` | authenticated | Pause session |
| PATCH | `/api/live-sessions/:id/stop` | authenticated | Stop session |
| POST | `/api/live-sessions/:id/revoke-consent` | authenticated | Revoke patient consent mid-session. Immediately stops recording, closes AssemblyAI connection, marks session with revocation metadata, logs HIPAA audit event. HIPAA §164.508 right to revoke |

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
BEDROCK_GLOBAL_CIRCUIT_THRESHOLD # Global circuit breaker threshold (default: 15 consecutive failures across all orgs)

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
STRIPE_PRICE_ENTERPRISE_OVERAGE # Price ID for Enterprise per-call overage ($0.15/call over 5000/mo)

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
| `password_reset_tokens` | unique on `token_hash`, index on `user_id`, `org_id` | Expirable reset tokens (1h TTL). SHA-256 hashed. `org_id` column for RLS tenant isolation; pre-auth store/consume wrap queries in a transaction with `set_config('app.bypass_rls', 'true', true)`. RLS-protected (`org_isolation` policy). |
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
| `mfa_recovery_requests` | index on `(org_id, status)`, `user_id` | Emergency MFA bypass: user requests → email-verified → admin approves → time-limited use token (15 min). Cascade delete with user/org. RLS-protected (`org_isolation` policy). |
| `security_incidents` | index on `(org_id, phase)` | HIPAA breach tracking: severity, phase lifecycle, timeline, action items, breach notification deadline. RLS-protected |
| `breach_reports` | index on `(org_id, notification_status)` | HIPAA §164.408: affected individuals count, PHI types, 60-day notification deadline, notification status tracking, corrective actions |
| `business_associate_agreements` | index on `(org_id, status)`, `(expires_at)` | HIPAA §164.502(e): vendor BAA tracking with expiry dates, renewal reminders, PHI categories, signatory info. RLS-protected |

Requires pgvector extension: `CREATE EXTENSION IF NOT EXISTS vector;`

### Auto Schema Sync (server/db/sync-schema.ts)
On startup, `syncSchema(db)` runs idempotent SQL to create all tables and add missing columns using `CREATE TABLE IF NOT EXISTS` and `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`. This eliminates the need for `drizzle-kit push` (a devDependency) in production and prevents cascading 500 errors from missing tables/columns after deploys. Runs on a **dedicated pg client** acquired via `getPool().connect()` and destroyed with `client.release(true)` when sync completes — this isolates the `app.bypass_rls` session setting from the pool so RLS is actually enforced on normal requests.

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
- **Email OTP for non-admins**: A 6-digit OTP (10-minute TTL, 3 attempts max) is sent to the user's username/email. Restricted to viewer/manager roles — admin users must use TOTP or WebAuthn. Stored via Redis ephemeral API (`ephemeralSet`/`ephemeralGet`/`ephemeralDel` from `redis.ts`) keyed by userId — multi-instance safe when Redis is configured, in-memory fallback otherwise.
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
- **Post-deploy migration**: After deploying the F37 audit timestamp fix, run `npx tsx server/db/migrate-audit-chain.ts` once to recompute pre-existing audit hash chains using stored `createdAt` timestamps. Idempotent — safe to run multiple times. Requires `DATABASE_URL`
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
- **Billing grace period fails closed on missing data**: `requireActiveSubscription()` defaults `inGracePeriod` to `false` when `pastDueAt` is null (e.g., old subscription records without the field). Past-due accounts with no timestamp are denied write access rather than granted indefinite free access
- **Billing checkout/portal uses `APP_BASE_URL`**: Stripe redirect URLs use `process.env.APP_BASE_URL` with fallback to `req.protocol + req.get("host")`. Set `APP_BASE_URL` in production to prevent Host header injection in Stripe redirects
- **WAF uses recursive URL decoding**: `scanRequest()` in `waf.ts` decodes URLs up to 3 times to catch double/triple-encoded payloads (e.g., `%252e%252e` → `%2e%2e` → `..`). The loop exits early when decoding produces no change
- **Prompt injection detection strips zero-width Unicode**: `normalizeForDetection()` in `ai-guardrails.ts` strips zero-width spaces (U+200B), zero-width joiners (U+200D), soft hyphens (U+00AD), and other invisible characters before pattern matching. This prevents attackers from splitting keywords with invisible chars
- **Audit log timestamp is application-set**: `persistAuditEntry()` explicitly sets `createdAt` to the application-level timestamp used for hash computation (not PostgreSQL's `defaultNow()`). This ensures `verifyAuditChain()` can recompute matching hashes. Pre-existing entries may have mismatched timestamps
- **FHIR export decrypts nested cosignature NPI**: `decryptClinicalNotePhi()` decrypts both top-level PHI fields and nested `cosignature.cosignedNpi`. The cosigner NPI is included in the FHIR Practitioner resource as an additional identifier with type "Cosigner NPI"
- **EHR prefill surfaces lookup failures**: The prefill endpoint returns `ehrLookupFailed: true` and `ehrLookupError` when EHR patient data retrieval fails, instead of silently returning empty allergies/medications. Frontend should display a warning banner when this flag is present
- **Daily task orchestrator is error- and timeout-isolated**: Each task in `runAllDailyTasks()` is wrapped in its own try-catch AND a `Promise.race` timeout (10 min default, 30 min for retention). A task that throws OR hangs does not prevent other tasks from running. Timeouts reject with `ScheduledTaskTimeoutError` so logs distinguish them from thrown errors. Note: JavaScript can't cancel promises, so a hung task's work continues in the background — only the orchestrator moves on
- **Breach notification is idempotent**: `sendBreachNotificationEmails()` checks `notificationStatus` before sending. If individuals have already been notified, it returns 0 and logs a warning. This prevents duplicate HIPAA notifications on retry or accidental re-invocation
- **Registration blocks reserved org slugs**: Slugs like "api", "admin", "auth", "sso", "webhook" and 12 other system names are rejected during registration to prevent route collisions
- **Invitation acceptance is rate-limited**: `POST /api/invitations/accept` has a 10-per-15-min rate limit per IP to prevent token brute-force
- **Account lockout is Redis-backed**: Login attempt tracking uses `ephemeralSet`/`ephemeralGet`/`ephemeralDel` from `redis.ts` (Redis with in-memory fallback). Records auto-expire via TTL — no manual eviction or cleanup interval needed. Lockout state persists across server restarts and works across multiple instances when Redis is configured
- **Stripe webhook events are deduplicated atomically**: The billing webhook handler tracks processed event IDs via `ephemeralSetNx` from `redis.ts` (Redis `SET NX PX`, 24h TTL, in-memory fallback). Single atomic call — no TOCTOU window between check and set. Multi-instance safe when Redis is configured
- **Google OAuth auto-provisioning requires Workspace `hd` claim**: `server/routes/oauth.ts` auto-provisions users when their Google email matches an org's `settings.emailDomain`, but ONLY when (1) `profile.emails[0].verified === true` and (2) `profile._json.hd === emailDomain`. The `hd` claim is Google Workspace's hosted-domain identifier — it's only set when the account is managed by that tenant. Consumer Gmail accounts have no `hd` and are rejected. This prevents domain-squatting account takeover. Orgs with multiple Workspace domains mapped to one Observatory org must use invitation-based onboarding for the secondary domains. Existing-user login path is unchanged — only new-user auto-provisioning is gated.
- **MFA rate limiting is keyed by userId, not sessionId**: `isMfaLocked`/`recordMfaAttempt`/`clearMfaAttempts` in `routes/mfa.ts` rate-limit MFA verification attempts (TOTP, backup codes, WebAuthn, email OTP) by the target `userId` from the request body. Keyed by userId so attackers can't rotate session cookies to get a fresh rate-limit window — the userId is by definition the target they're attacking. Backed by Redis `INCR` + `PEXPIRE` via `ephemeralIncrement` from `redis.ts` (in-memory counter fallback). Multi-instance safe when Redis is configured. 5 attempts per 15-minute window; the window does NOT reset on each attempt (attackers can't slide the window indefinitely).
- **Reanalysis worker processes in streaming chunks**: The bulk reanalysis worker fetches and processes calls in 200-call chunks, discarding each chunk before fetching the next, to prevent OOM on large orgs. Progress reporting is approximate for the "all calls" path. **When the AI provider is unavailable, the worker throws** (not silently returns success) so BullMQ marks the job as failed and retries. After max retries, the job moves to the dead letter queue for admin review
- **Circuit breaker is per-org with global fallback**: `withBedrockProtection()` in `ai-factory.ts` checks two circuit breakers: (1) per-org breaker (5 consecutive failures opens, 60s reset) and (2) global breaker (15 consecutive failures opens). One org's rate limits or Bedrock errors only affect that org's circuit. Platform-wide outages trip the global breaker. `getBedrockCircuitState(orgId?)` returns both per-org and global state. Per-org breakers auto-cleaned every 5 min when idle. Env: `BEDROCK_CIRCUIT_THRESHOLD` (per-org, default 5), `BEDROCK_GLOBAL_CIRCUIT_THRESHOLD` (global, default 15), `BEDROCK_CIRCUIT_RESET_MS` (reset window, default 60000)
- **AI response validation**: `parseJsonResponse()` in `ai-types.ts` extracts JSON using a **balanced-brace walker** with string-literal awareness (not a greedy regex), so AI responses that contain `{example}`-style placeholders in a preamble before the real JSON block parse correctly. Tries markdown code fences, then full-text parse, then each balanced `{...}` candidate in source order until one parses. Clamps `performanceScore` to 0-10, sentiment scores to 0-1, sub-scores to 0-10, and validates all field types. Missing fields get safe defaults (5.0 for scores, "neutral" for sentiment). **Sub-score fields** (`compliance`, `customerExperience`, `communication`, `resolution`) are set to `undefined` (not 0) when the AI omits them — this prevents false 0/10 scores from appearing in the UI. `normalizeAnalysis()` in `storage/types.ts` also clamps on read
- **Empty transcript handling**: If transcript text is <10 characters, the pipeline saves the call with `empty_transcript` flag, low confidence, and skips AI analysis entirely — prevents generating junk analysis from silence/noise
- **Employee auto-assignment safety**: Only considers active employees. If multiple employees match the detected name, prefers exact full-name match; skips assignment if ambiguous (logs the ambiguity)
- **speakerRoleMap schema change**: Changed from `z.object({ agentSpeaker: z.string() })` to `z.record(z.string(), z.string())` to support proper speaker label → role mapping (e.g., `{ A: "agent", B: "customer" }`). Old `{ agentSpeaker: "A" }` format was a logic error — the property name was always the literal string "agentSpeaker" instead of using the value as a key
- **Filler word detection uses bigrams**: `computeSpeechMetrics()` now detects two-word filler phrases ("you know", "i mean", etc.) via a bigram pass before single-word matching. Words matched as part of a bigram are excluded from the single-word pass to avoid double-counting
- **Speaker role detection priority**: `detectSpeakerRolesFromTranscript()` runs before org config and hardcoded defaults. Priority: (1) AI-detected agent name + self-introduction context, (2) greeting pattern scoring (agent phrases vs customer phrases), (3) `org.settings.defaultSpeakerRoles`, (4) `{ A: "agent", B: "customer" }`. Returns `null` for inconclusive detection (fewer than 5 words, single speaker, no pattern matches)
- **Prerequisite order in paths** — `enforceOrder` field on `LearningPath` signals that modules must be completed sequentially (index N requires index N-1 completed); combined with per-module `prerequisiteModuleIds` for flexible gating
- **`toDisplayString()` handles nested objects**: Checks arrays first (before object path), then `text`, `name`, `task`, `label`, `value`, `description`, `message` keys for wrapped strings, caps JSON fallback at 500 chars
- **Duplicate upload returns 409**: `POST /api/calls/upload` returns `409 { duplicate: true, existingCallId }` when file hash matches an existing call. Frontend should handle this status code and show the user a link to the existing call instead of a generic error
- **RLS bypass scoped to a dedicated connection in schema-sync**: `syncSchema()` acquires a dedicated pg client via `getPool().connect()`, builds a drizzle instance bound to that client, sets `app.bypass_rls='true'` on it (session-level), runs all DDL, and destroys the client with `client.release(true)` in a finally block. This prevents the bypass from leaking back to the pool and silently disabling RLS on subsequent requests. Runtime RLS enforcement now actually works for all policies, including the auth-adjacent tables added in F-01. All pgvector and super-admin cross-org queries still use `withBypassRls()` (transaction-local)
- **Org status gate adds latency**: `injectOrgContext` now does an async org status lookup on every authenticated request. For high-traffic deployments, consider a short-lived org status cache (TTL ~30s is already used in some implementations)
- **GDPR purge is irreversible**: `deleteOrgData()` deletes employees, calls, and users but preserves the org record (status=deleted) for audit trail. The session is destroyed immediately after purge. Backups should be the recovery path
- **AssemblyAI webhook verification**: `POST /api/webhooks/assemblyai` checks `X-Assembly-Webhook-Token` header against `ASSEMBLYAI_WEBHOOK_SECRET` (falls back to `SESSION_SECRET`). Register this endpoint as the webhook URL in your AssemblyAI account
- **SCIM `listOrganizations()` scan**: SCIM auth scans all orgs to match the token hash. This is fine at current scale. For >1000 orgs, add a dedicated `scim_token_hash` index on the `organizations` table.
- **OIDC state uses Redis when available**: OIDC `state` → `{ orgSlug, nonce }` is stored via `ephemeralSet`/`ephemeralConsume` from `redis.ts`, which uses Redis when available and falls back to in-memory. 10-minute TTL. Multi-instance safe when Redis is configured.
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
- **Check WORK_LOG.md before auditing**: Detailed branch history of all completed audit and implementation work is in `WORK_LOG.md`. Check it before starting new audit sessions to avoid re-investigating resolved issues. The critical invariants from past fixes are captured in the Invariant Library (INV-01 through INV-23) below.

## Open Follow-On Items

Active items from prior audit cycles. Check `WORK_LOG.md` for full context on each.
Items marked ✅ were completed in a later session.

### P2 — Code Quality (non-blocking)
- ~379 `as any` casts across 68 server files (the 82 in pg-storage.ts have been refactored away via typed mappers)
- 250 ESLint `no-unused-vars` warnings
- ~105 remaining catch blocks across 29 route files — confirmed intentional (file cleanup, non-blocking notifications, PHI decryption fallbacks)
- Duplicate URL validation utilities (`url-validation.ts` + `url-validator.ts`) — should be merged
- Live session Maps have no hard cap (11 unbounded Maps; all cleared on session cleanup)
- `request-metrics.ts` key growth bounded by `req.route?.path` but falls back to `req.path` (raw URL with IDs)
- Missing `htmlFor`/`id` pairing on multiple form labels (a11y)
- `useIsMobile` returns false on first render causing layout shift on mobile

### Feature Gaps — UI needed for existing backend features
- Add client UI for Calibration audit packet download button on `/calibration`
- Add client UI for clinical-scribe continuous-mode opt-in toggle on `clinical-live.tsx`
- Add client UI for coaching-to-LMS "Generate Training Module" button
- Add "Revoke Consent" button to `clinical-live.tsx` session controls
- Frontend should handle `ehrErrorType` field to show actionable EHR error banners

### Feature Gaps — Backend
- Add `linkedLearningModuleIds` to `CoachingSession` Zod schema + DB columns (currently `as any` cast)
- Add `updateLearningProgress` to `IStorage` interface (currently feature-detected via `(storage as any)`)
- Gamification effectiveness endpoint (`/api/gamification/effectiveness`) still loads unbounded calls
- Eaglesoft and Dentrix adapters have the same silent error masking — should get `classifyEhrError` treatment

### Operational Improvements (low urgency)
- Bedrock empty-content metric: per-model counter of empty responses for content-filter debugging
- Per-org circuit breaker state should be exposed in admin health dashboard
- Auto-retry visibility: no metric for age of oldest unsuccessfully-deleted S3 key
- `ephemeralSetNx` adoption: OIDC state, upload dedup could use the same atomic primitive
- Scheduled task timeout env override: expose `SCHEDULED_TASK_TIMEOUT_MS` for ops tuning
- `getOrgUsageSummary` bulk variant for super-admin usage dashboard
- Scheduled task duration metrics: `durationMs` logs → Prometheus histograms
- CloudStorage live session consent fields may need updating if CloudStorage backend is used
- Reconciliation job could re-run missed webhook notifications (currently only re-tracks usage)
- Frontend chart components should handle undefined sub-scores gracefully (show "N/A" not 0)
- Admin.ts BAA routes duplicate `baa.ts` registered routes — consider removing dead copy
- Full-corpus IDF for RAG could be computed at index time and cached per-org
- Revoked sessions should be visually marked in UI and excluded from clinical metrics
- OAuth multi-domain: `settings.allowedEmailDomains: string[]` for multi-Workspace orgs
- PostgreSQL IN-limit: use `chunkedInArray` if super-admin exceeds 32K orgs

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
| HIGH | **Confidence score reconciliation** | ✅ Done | `claude/evaluate-qa-rag-integration-MrMze` — `reconcileConfidence()` cross-checks LLM-stated confidence (`[CONFIDENCE: HIGH/PARTIAL/LOW]` tag) against retrieval effective score. Downgrades overconfident LLM when retrieval < 0.30, upgrades conservative LLM when effective score ≥ 0.50. Enhanced `computeConfidence()`: 65/35 top/avg blending (was 60/40), single-result 15% penalty |
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

Longer-term improvements identified during codebase audits. Work on these incrementally across sessions. Completed items have been moved to `WORK_LOG.md` — 91 items across 13 categories. Only open items remain below.

### Clinical Documentation / Medical Scribe
| Priority | Item | Notes |
|----------|------|-------|
| HIGH | **HL7v2 ADT integration** | New protocol adapter, MSH/PID/PV1 message parsing, TCP/MLLP transport. Required for hospital EHR integration beyond dental |
| HIGH | **Clinical decision support alerts** | Rules engine for drug interactions, allergy cross-reference, contraindication warnings during note generation |

### Call Analysis
| Priority | Item | Notes |
|----------|------|-------|

### RAG Knowledge Base
| Priority | Item | Notes |
|----------|------|-------|

### HIPAA Compliance
| Priority | Item | Notes |
|----------|------|-------|
| MEDIUM | **Audit log chain state memory** | Per-org `chainLocks` Map can hold 10K+ pending promises under load; no cleanup of completed entries. Move to Redis for multi-instance |

### LMS / Learning
| Priority | Item | Notes |
|----------|------|-------|

### Lead Tracking
| Priority | Item | Notes |
|----------|------|-------|
| MEDIUM | **CRM webhook integration** | No outbound webhooks to Salesforce/HubSpot when call-to-appointment conversion is tracked |

### Architecture / Code Quality
| Priority | Item | Effort | Impact | Notes |
|----------|------|--------|--------|-------|
| LOW | **Storage layer type safety (remaining)** | 1 day | Low — mostly structural | Prior audits reduced `as any` from ~200 to 3 genuine casts. Typed row types (`$inferSelect`), JSONB field types, and typed mappers are in place. Remaining: (1) `pg-storage-features.ts` prototype extension pattern (`P = prototype as any` — 74 methods, structural, can't be fixed without file restructuring), (2) `rawRows()` helper uses generic `T` but callers don't annotate yet, (3) `as unknown as Database` for Drizzle transaction type mismatch (3 locations, unfixable without Drizzle upstream change). Low priority — diminishing returns |
| MEDIUM | **Consolidate URL validation utilities** | 0.5 days | Low — reduces confusion | `url-validation.ts` (used by 3 files) and `url-validator.ts` (used only by tests) have overlapping SSRF checks. Merge the best checks from both into `url-validation.ts`, update the 15 test imports in `remaining-adaptations.test.ts`, delete `url-validator.ts`. Sprint 2 |
| MEDIUM | **Large file decomposition (remaining)** | 3 days | Medium — improves navigability | 14 files still >1000 LOC. Server: `memory.ts` (1.6K → split by domain), `sync-schema.ts` (1.5K → split by table group), `rag.ts` (1.3K → extract synonym/query modules), `call-processing.ts` (1.2K → extract pipeline steps). Client: `transcript-viewer.tsx` (1.3K → extract correction UI), `clinical-notes.tsx` (1.2K → extract print/amendment), `reports.tsx` (1.2K → extract chart sections). Sprint 2-3 |
| MEDIUM | **MemStorage parity with PostgresStorage** | 2 days | Medium — prevents dev/prod divergence | Key behavioral gaps: `searchCalls` only searches transcript text (PG also searches summaries+topics), `getTopPerformers` has no min-calls threshold (PG requires 5), `deleteOrgData` misses ~15 collections, `deleteExpiredCallShares` ignores orgId. Fix the 4 highest-impact gaps. Sprint 2 |
| LOW | **290 ESLint `no-unused-vars` warnings** | 1 day | Low — reduces CI noise | Spread across ~100 files, mostly unused function params. Prefix with `_` or remove. Can be done incrementally. Sprint 3+ |
| LOW | **UUID validation on remaining routes** | 1 day | Low — defense-in-depth | validateUUIDParam added to critical PHI routes. ~30 non-PHI routes still missing. Add incrementally. Sprint 3+ |
| LOW | **Scores as VARCHAR→NUMERIC migration** | 2 days | Medium — eliminates parse/cast overhead | performanceScore, confidenceScore, talkTimeRatio, responseTime stored as VARCHAR(20) but always used as numbers. Would require Drizzle migration + update all comparison/sort code. High risk, defer unless performance bottleneck proven. Sprint 4+ |

### Security
| Priority | Item | Effort | Impact | Notes |
|----------|------|--------|--------|-------|
| MEDIUM | **Session absolute max configurable** | 0.5 days | Medium — NIST compliance | 8-hour absolute max exceeds NIST 4-6h recommendation for healthcare. Make configurable per-org via org settings (default 6h). Sprint 2 |
| MEDIUM | **CSP `unsafe-inline` for styles** | 5 days | Medium — prevents CSS injection | Required by Recharts inline styles + Framer Motion transforms. Fix: extract Recharts styles to CSS classes, use Framer Motion's CSS transform option. Large effort due to chart component refactoring. Sprint 3+ |
| LOW | **Error message information disclosure** | 1 day | Low | Some routes expose underlying error messages. Audit all `catch` blocks for message leakage. Sprint 3+ |

### RAG Knowledge Base (continued)
| Priority | Item | Notes |
|----------|------|-------|
| LOW | **AI provider cache invalidation** | `orgProviderCache` in `ai-factory.ts` never invalidated when org changes `bedrockModel`; stale model used until restart |

### Call Analysis (continued)
| Priority | Item | Notes |
|----------|------|-------|

### Testing
| Priority | Item | Effort | Impact | Notes |
|----------|------|--------|--------|-------|
| HIGH | **Tautological test cleanup** | 2 days | High — false confidence elimination | `rbac.test.ts`, `input-validation.test.ts`, `billing.test.ts`, `webhook-retry.test.ts` redefine constants locally instead of importing from production code. Tests pass even if production changes. Fix: import from source modules and test actual behavior. Sprint 1 |
| HIGH | **Stripe webhook verification tests** | 1 day | High — critical billing path untested | No tests for webhook signature verification, subscription lifecycle events, or idempotency. Fix: add tests using Stripe's test webhooks with mock signatures. Sprint 1 |
| MEDIUM | **HTTP integration test suite** | 3 days | High — fills unit↔E2E gap | No HTTP-level tests against real Express server. Gap between mocked unit tests and browser E2E. Fix: add supertest-based tests that start the Express app against MemStorage, covering auth flows, CSRF, rate limiting, org isolation. Sprint 2 |
| MEDIUM | **E2E against PostgreSQL** | 2 days | Medium — catches PG-specific bugs | E2E runs against MemStorage. Race conditions, RLS, transaction behavior untested. Fix: docker-compose test profile with PG + pgvector. Sprint 2-3 |
| MEDIUM | **Rate limiter enforcement tests** | 0.5 days | Medium — security validation | Rate limiting is only tested for header presence (E2E relaxes to 500 limit). No test proves actual blocking behavior. Fix: unit test the in-memory rate limiter with real request counts. Sprint 2 |

### DevOps / Infrastructure
| Priority | Item | Effort | Impact | Notes |
|----------|------|--------|--------|-------|
| MEDIUM | **Move live session state to Redis or sticky sessions** | 2 days | Medium — enables multi-instance for clinical | 1 remaining in-memory subsystem: live sessions (live-session.ts) with 11 Maps holding WebSocket connections and streaming state. These are inherently process-local (can't serialize connections to Redis). Solution: sticky session routing for clinical live sessions in multi-instance deployments. Email OTP, OIDC state, loginAttempts, Stripe webhook dedup, and rate limiting are already Redis-backed. Sprint 2-3 |
| MEDIUM | **Dependency audit on PRs** | 0.5 days | Medium — vulnerability detection | Weekly-only check; critical vulns can ship for days. Fix: add `npm audit --audit-level=high` to PR review workflow. Sprint 2 |
| MEDIUM | **Container image scanning** | 1 day | Medium — supply chain security | No SAST/DAST or container scanning. Fix: add Trivy scan on Docker build step. Sprint 2 |
| MEDIUM | **Canary deployment** | 3 days | Medium — reduces deployment risk | All production traffic switches immediately. Fix: add health-check gated traffic shifting in deploy.sh (10% → 50% → 100% with rollback). Sprint 3 |

### UI/UX
| Priority | Item | Effort | Impact | Notes |
|----------|------|--------|--------|-------|
| HIGH | **Accessibility audit with axe-core** | 2 days | Medium — compliance + usability | Missing `htmlFor`/`id` pairing on auth.tsx, invite-accept.tsx, settings tabs. Mobile sidebar lacks focus trap. 404 page uses hardcoded colors instead of theme. Fix: add axe-core to E2E, fix all critical/serious violations. Sprint 1-2 |
| MEDIUM | **AudioRecorder blob URL leak** | 0.5 days | Low — memory leak | Cleanup effect uses stale closure for `audioUrl`. Fix: use ref to track latest URL for unmount cleanup. Sprint 2 |
| MEDIUM | **`useIsMobile` SSR flash** | 0.5 days | Low — mobile UX | Returns `false` on first render causing layout shift. Fix: initialize with synchronous `window.innerWidth` check. Sprint 2 |
| MEDIUM | **Keyboard shortcuts in contenteditable** | 0.5 days | Low — editor UX | Shortcuts fire in contenteditable elements and open modals. Fix: check `contenteditable` attr and `[role=dialog]` ancestors. Sprint 2 |
| MEDIUM | **Replace native `confirm()` with ConfirmDialog** | 0.5 days | Low — UX consistency | ApiKeysTab.tsx and UsersTab.tsx use browser `confirm()`. Rest of app uses ConfirmDialog component. Sprint 2 |
| MEDIUM | **ScriptProcessorNode deprecation** | 2 days | Medium — clinical recording reliability | `clinical-live.tsx` uses deprecated `createScriptProcessor()` which runs on main thread. Migrate to AudioWorklet for production reliability. Sprint 3 |
| LOW | **Onboarding wizard step validation** | 1 day | Medium — prevents incomplete setup | Users can proceed through steps without completing required fields. Sprint 3+ |
| LOW | **File upload dropzone maxSize** | 0.5 days | Low | `react-dropzone` has no `maxSize` in config; validation only in callback. Sprint 3+ |
| LOW | **Large page decomposition** | 2 days | Low | `clinical-notes.tsx` (1.2K), `reports.tsx` (1.2K) could be split into sub-components. Sprint 3+ |

## Cycle Workflow Config

### Test Command
```
npx tsx --test tests/*.test.ts
```

### Health Dimensions
Architecture & Code Quality, Storage & Data Integrity, Security & HIPAA Compliance, Call Analysis Accuracy, RAG Quality, Clinical Documentation Safety, EHR Integration Reliability, Coaching & Analytics Correctness, Billing Integrity, Operational Readiness, UI/UX & Accessibility, Scalability & Performance, Business Viability

### Subsystems
```
Core Platform & Infrastructure:
  server/index.ts, server/vite.ts, server/utils.ts, server/logger.ts, server/types.d.ts, server/middleware/correlation-id.ts, server/middleware/tracing.ts, server/middleware/error-handler.ts, server/middleware/validate.ts, server/middleware/waf.ts, server/services/websocket.ts, server/services/queue.ts, server/services/redis.ts, server/services/logger.ts, server/services/sentry.ts, server/services/telemetry.ts, server/services/dashboard-cache.ts, server/services/error-codes.ts, server/services/aws-credentials.ts, server/services/s3.ts, server/utils/helpers.ts, server/utils/lru-cache.ts, server/utils/request-metrics.ts, server/routes/index.ts, server/routes/helpers.ts, server/routes/health.ts

Storage Layer & Database:
  server/storage/types.ts, server/storage/index.ts, server/storage/memory.ts, server/storage/cloud.ts, server/db/index.ts, server/db/schema.ts, server/db/pg-storage.ts, server/db/pg-storage-features.ts, server/db/pg-storage-confidence.ts, server/db/sync-schema.ts, server/db/migrate.ts, server/db/migrate-audit-chain.ts, shared/schema/org.ts, shared/schema/calls.ts, shared/schema/billing.ts, shared/schema/features.ts

Auth, Security & HIPAA:
  server/auth.ts, server/services/phi-encryption.ts, server/services/org-encryption.ts, server/services/audit-log.ts, server/services/incident-response.ts, server/utils/phi-redactor.ts, server/utils/url-validation.ts, server/utils/url-validator.ts, server/utils/ai-guardrails.ts, server/routes/auth.ts, server/routes/mfa.ts, server/routes/sso.ts, server/routes/scim.ts, server/routes/oauth.ts, server/routes/password-reset.ts, server/routes/api-keys.ts, server/routes/registration.ts, server/routes/access.ts, server/routes/baa.ts, server/routes/admin-security.routes.ts, server/scheduled/audit-chain-verify.ts

Call Analysis Pipeline:
  server/services/call-processing.ts, server/services/assemblyai.ts, server/services/assemblyai-realtime.ts, server/services/ai-factory.ts, server/services/ai-provider.ts, server/services/ai-prompts.ts, server/services/ai-types.ts, server/services/bedrock.ts, server/services/bedrock-batch.ts, server/services/auto-calibration.ts, server/services/cost-estimation.ts, server/services/scoring-calibration.ts, server/services/call-clustering.ts, server/routes/calls.ts, server/routes/call-insights.ts, server/routes/ab-testing.ts, server/routes/assemblyai-webhook.ts

RAG Knowledge Base:
  server/services/rag.ts, server/services/chunker.ts, server/services/embeddings.ts, server/services/embedding-provider.ts, server/services/rag-worker.ts, server/services/rag-trace.ts, server/services/faq-analytics.ts

Clinical Documentation:
  server/routes/clinical.ts, server/routes/clinical-compliance.routes.ts, server/routes/clinical-analytics.routes.ts, server/routes/live-session.ts, server/routes/insurance-narratives.ts, server/routes/patient-journey.ts, server/services/clinical-templates.ts, server/services/clinical-validation.ts, server/services/clinical-extraction.ts, server/services/style-learning.ts, server/services/fhir.ts

EHR Integration:
  server/services/ehr/index.ts, server/services/ehr/types.ts, server/services/ehr/request.ts, server/services/ehr/secrets-manager.ts, server/services/ehr/health-monitor.ts, server/services/ehr/appointment-matcher.ts, server/services/ehr/open-dental.ts, server/services/ehr/eaglesoft.ts, server/services/ehr/dentrix.ts, server/services/ehr/fhir-r4.ts, server/services/ehr/mock.ts, server/routes/ehr.ts, server/workers/ehr-note-push.worker.ts

Coaching, Gamification & LMS:
  server/routes/coaching.ts, server/routes/calibration.ts, server/routes/gamification.ts, server/routes/lms.ts, server/services/coaching-engine.ts, server/services/proactive-alerts.ts, server/services/performance-snapshots.ts, server/services/scheduled-reports.ts, server/scheduled/coaching-tasks.ts

Billing & Revenue:
  server/routes/billing.ts, server/routes/spend-tracking.ts, server/routes/revenue.ts, server/services/stripe.ts, server/scheduled/trial-downgrade.ts, server/scheduled/quota-alerts.ts

Admin & Platform Operations:
  server/routes/admin.ts, server/routes/super-admin.ts, server/routes/dashboard.ts, server/routes/insights.ts, server/routes/reports.ts, server/routes/export.ts, server/routes/employees.ts, server/routes/feedback.ts, server/routes/onboarding.ts, server/routes/marketing.ts, server/routes/benchmarks.ts, server/routes/emails.ts, server/services/email.ts, server/services/notifications.ts, server/services/telephony-ingestion.ts

Workers & Scheduled Tasks:
  server/workers/index.ts, server/workers/retention.worker.ts, server/workers/reanalysis.worker.ts, server/workers/indexing.worker.ts, server/workers/usage.worker.ts, server/scheduled/index.ts, server/scheduled/scheduler.ts, server/scheduled/retention.ts, server/scheduled/weekly-digest.ts, server/scheduled/post-processing-reconciliation.ts

Frontend (UI/UX):
  client/src/App.tsx, client/src/main.tsx, client/src/pages/, client/src/components/, client/src/hooks/, client/src/lib/
```

### Invariant Library
```
INV-01 | API list endpoints return raw T[] arrays, never wrapper objects | Subsystem: Storage Layer & Database
INV-02 | Every storage method takes orgId as first parameter | Subsystem: Storage Layer & Database
INV-03 | Billing middlewares return 403 when orgId is missing | Subsystem: Billing & Revenue
INV-04 | Billing gates return 503 (not next()) on DB errors | Subsystem: Billing & Revenue
INV-05 | Grace period defaults to false when pastDueAt is null | Subsystem: Billing & Revenue
INV-06 | Stripe redirects use APP_BASE_URL (not raw Host header) | Subsystem: Billing & Revenue
INV-07 | Clinical note PATCH requires version for ALL edits | Subsystem: Clinical Documentation
INV-08 | PHI encryption throws in production without key | Subsystem: Auth, Security & HIPAA
INV-09 | Every PHI decryption logs a HIPAA audit event | Subsystem: Auth, Security & HIPAA
INV-10 | Schema changes go in both schema.ts and sync-schema.ts | Subsystem: Storage Layer & Database
INV-11 | getCallByAssemblyAiId is intentionally cross-org | Subsystem: Call Analysis Pipeline
INV-12 | Auth rate limit keys include orgId for tenant isolation | Subsystem: Core Platform & Infrastructure
INV-13 | postProcessing errors never mark calls as failed | Subsystem: Call Analysis Pipeline
INV-14 | syncSchema runs on dedicated client, destroyed after | Subsystem: Storage Layer & Database
INV-15 | EHR requests pass through validateUrl for SSRF prevention | Subsystem: EHR Integration
INV-16 | calibration computeStdDev uses /(n-1) Bessel correction | Subsystem: Coaching, Gamification & LMS
INV-17 | Webhook signature uses real constructEvent in production | Subsystem: Billing & Revenue
INV-18 | Tests import ROLE_HIERARCHY from auth.ts (not redefined) | Subsystem: Auth, Security & HIPAA
INV-19 | React hooks called before early returns in transcript-viewer | Subsystem: Frontend (UI/UX)
INV-20 | broadcastCallUpdate requires orgId parameter | Subsystem: Core Platform & Infrastructure
INV-21 | searchCalls uses plainto_tsquery for queries >= 2 chars | Subsystem: Storage Layer & Database
INV-22 | EHR adapters use classifyEhrError for typed error handling | Subsystem: EHR Integration
INV-23 | getTeamScopedEmployeeIds returns null for unrestricted | Subsystem: Auth, Security & HIPAA
```

### Policy Configuration
- Policy threshold: 5/10
- Consecutive cycles before trigger: 2
