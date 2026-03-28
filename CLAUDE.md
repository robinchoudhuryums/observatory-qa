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
npm run test:e2e       # Run Playwright E2E tests (requires dev server running)
npm run test:e2e:ui    # Open Playwright interactive UI
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
- **Unit test files** (35 files):
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
  - `tests/sso.test.ts` — SAML SSO
  - `tests/validation.test.ts` — Input validation
- **E2E test files** (14 specs):
  - `tests/e2e/fixtures.ts` — **Shared auth fixtures** (`adminTest`, `viewerTest`) — per-test login via `page.request.post()`
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
- **E2E auth pattern**: Import `{ adminTest as test, expect } from "./fixtures"` (or `viewerTest`) for authenticated tests. Each test gets a fresh login — no shared storageState. Tests use `data-testid` selectors for stability.

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
  upload/                    #   File upload (file-upload)
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

server/services/             # Business logic & integrations (30 files)
  ai-factory.ts              #   AI provider setup (Bedrock, per-org model config)
  ai-provider.ts             #   AI analysis interface, prompt building, JSON parsing, clinical note generation
  bedrock.ts                 #   AWS Bedrock Claude provider (raw REST + SigV4)
  assemblyai.ts              #   AssemblyAI transcription + transcript processing. TranscriptionOptions: webhookUrl, wordBoost, piiRedaction, languageDetection. continueAfterTranscription() for webhook/polling dual-path
  assemblyai-realtime.ts     #   AssemblyAI real-time streaming transcription
  aws-credentials.ts         #   AWS credential resolution (env vars, instance roles, STS)
  s3.ts                      #   S3 client (raw REST + SigV4, no AWS SDK)
  redis.ts                   #   Redis connection, session store, rate limiter, pub/sub
  queue.ts                   #   BullMQ queue definitions (5 queues)
  websocket.ts               #   WebSocket for real-time call processing updates (org-scoped)
  stripe.ts                  #   Stripe SDK integration
  logger.ts                  #   Pino structured logging + Betterstack transport
  audit-log.ts               #   HIPAA audit logging (PHI access events)
  notifications.ts           #   Webhook notifications for flagged calls
  embeddings.ts              #   Amazon Titan Embed V2 via Bedrock (1024-dim vectors)
  rag.ts                     #   RAG orchestrator (chunk → embed → pgvector search → BM25 rerank)
  rag-worker.ts              #   In-process RAG indexing fallback
  chunker.ts                 #   Document chunking (sliding window, natural breaks, section detection)
  phi-encryption.ts          #   AES-256-GCM field-level encryption for PHI data
  email.ts                   #   Transactional email (AWS SES API, SMTP, console fallback)
  error-codes.ts             #   Standardized error codes (OBS-{DOMAIN}-{NUMBER})
  coaching-engine.ts         #   Auto-recommendations and AI coaching plan generation
  clinical-templates.ts      #   Pre-built clinical note templates (10+ specialties, multiple formats)
  clinical-validation.ts     #   Clinical note field validation and completeness scoring
  style-learning.ts          #   Provider style analysis — auto-detect note preferences from history
  scoring-calibration.ts     #   Cross-evaluator scoring calibration and variance analysis
  sentry.ts                  #   Sentry server-side error tracking with HIPAA PHI sanitization
  telemetry.ts               #   OpenTelemetry setup (traces, metrics — enabled via OTEL_ENABLED=true)
  incident-response.ts       #   Automated incident detection and response workflows
  proactive-alerts.ts        #   Proactive performance/compliance alerting engine
  fhir.ts                    #   FHIR R4 export builder (Composition, DocumentReference, Bundle)
  clinical-extraction.ts     #   Structured data extraction from clinical notes (vitals, medications, allergies)
  org-encryption.ts          #   Per-org KMS envelope encryption: getOrgDataKey, encryptFieldForOrg, decryptFieldForOrg
  rag-trace.ts               #   RAG pipeline observability: per-query timing breakdown, confidence metrics, injection audit trail
  faq-analytics.ts           #   FAQ detection from RAG query patterns: query normalization, gap analysis, confidence distribution
  embedding-provider.ts      #   EmbeddingProvider interface for swappable embedding models (default: Titan Embed V2)

server/middleware/           # Express middleware
  waf.ts                     #   Web Application Firewall (request filtering, bot detection)
  tracing.ts                 #   OpenTelemetry request tracing (trace IDs, span attributes)
  correlation-id.ts          #   Per-request correlation ID via AsyncLocalStorage

server/utils/                # Shared server utilities (ported from UMS knowledge base tool)
  url-validation.ts          #   SSRF prevention: blocks private IPs, cloud metadata, non-HTTP protocols
  ai-guardrails.ts           #   Prompt injection detection (15 patterns), output safety checks
  phi-redactor.ts            #   PHI regex scrubber (SSN, phone, email, MRN, addresses; preserves clinical codes)
  request-metrics.ts         #   In-memory per-route latency percentiles (p50/p95/p99, 10-min window)

server/services/ehr/         # EHR integration adapters
  types.ts                   #   IEhrAdapter interface, EhrPatient, EhrAppointment, EhrClinicalNote, EhrTreatmentPlan
  index.ts                   #   EHR adapter factory (Open Dental, Eaglesoft)
  open-dental.ts             #   Open Dental adapter (bidirectional: patient lookup, note push, treatment plans)
  eaglesoft.ts               #   Eaglesoft/Patterson eDex adapter (read-focused: patients, appointments)

server/storage/              # Storage abstraction layer
  types.ts                   #   IStorage interface (all methods org-scoped)
  index.ts                   #   Storage backend factory (postgres > S3 > memory)
  cloud.ts                   #   CloudStorage implementation (S3 JSON files)
  memory.ts                  #   MemStorage (in-memory, dev only)

server/db/                   # PostgreSQL (Drizzle ORM)
  schema.ts                  #   Table definitions (20+ tables + pgvector document_chunks)
  index.ts                   #   Database connection initialization
  migrate.ts                 #   Migration runner
  pg-storage.ts              #   PostgresStorage implementing IStorage
  sync-schema.ts             #   Idempotent schema sync on startup (CREATE IF NOT EXISTS)

server/workers/              # BullMQ worker processes (run separately)
  index.ts                   #   Worker entry point — starts all workers
  retention.worker.ts        #   Data retention purge (per-org)
  usage.worker.ts            #   Usage event recording
  reanalysis.worker.ts       #   Bulk call re-analysis
  indexing.worker.ts         #   RAG document indexing (chunk + embed)

shared/schema.ts             # Zod schemas + TypeScript types (shared client/server)
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
| Plan | Price | Calls/mo | Storage | Base Seats | RAG | Custom Templates | Clinical Docs | SSO |
|------|-------|----------|---------|------------|-----|-----------------|---------------|-----|
| Free | $0 | 50 | 500 MB | 3 | No | No | No | No |
| Starter | $79/mo | 300 | 5 GB | 5 (+$12/seat) | Yes | Yes | No | No |
| Professional | $149/mo | 1,000 | 20 GB | 10 (+$18/seat) | Yes | Yes | Yes | No |
| Enterprise | $999/mo | Unlimited | 500 GB | 25 (+$25/seat) | Yes | Yes | Yes | Yes |

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
2. **Chunking** (`chunker.ts`) — sliding window with overlap (400 tokens, 80 token overlap), natural break detection (paragraph > sentence > line), section header tracking
3. **Embedding** (`embeddings.ts`) — Amazon Titan Embed V2 via Bedrock (1024 dimensions, raw REST + SigV4)
4. **Storage** — chunks + embeddings stored in `document_chunks` table (pgvector)
5. **Retrieval** (`rag.ts`) — hybrid search: pgvector cosine similarity + BM25 keyword boosting, weighted scoring (70% semantic, 30% keyword), minimum relevance score threshold (0.3) filters low-quality chunks
6. **Injection** — relevant chunks formatted and injected into the AI analysis prompt

RAG requires: PostgreSQL with pgvector extension + AWS credentials for Titan embeddings. Document indexing can run via BullMQ worker or in-process fallback.

### Storage Backend Selection (server/storage/index.ts)
Priority order:
1. `STORAGE_BACKEND=postgres` + `DATABASE_URL` → **PostgresStorage** (Drizzle ORM, recommended)
2. `STORAGE_BACKEND=s3` or `S3_BUCKET` → **CloudStorage** (S3 JSON files)
3. No config → **MemStorage** (in-memory, data lost on restart)

PostgreSQL + S3 hybrid: When using PostgresStorage, set `S3_BUCKET` alongside `DATABASE_URL` for audio blob storage in S3 while structured data lives in PostgreSQL.

### Job Queue System (BullMQ)
Five queues, all Redis-backed with fallback to in-process execution:
| Queue | Purpose | Retries |
|-------|---------|---------|
| `audio-processing` | Transcription + AI analysis pipeline | 2 (exponential backoff) |
| `bulk-reanalysis` | Re-analyze all calls for an org | 1 |
| `data-retention` | Purge expired calls per org policy | 3 |
| `usage-metering` | Track per-org usage events for billing | 3 |
| `document-indexing` | RAG indexing (chunk + embed) | 2 |

Workers run as a separate process: `npm run workers` (dev) or `node dist/workers.js` (prod).

### AI Provider System (server/services/ai-factory.ts)
Uses AWS Bedrock (Claude) for AI analysis. Per-org `bedrockModel` can be configured via org's `OrgSettings`. The provider implements the `AIAnalysisProvider` interface defined in `ai-provider.ts`. Per-org providers are cached to avoid re-creation on every call.

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
STRIPE_PRICE_STARTER_MONTHLY    # Price ID for Starter monthly
STRIPE_PRICE_STARTER_YEARLY     # Price ID for Starter yearly
STRIPE_PRICE_PROFESSIONAL_MONTHLY # Price ID for Professional monthly
STRIPE_PRICE_PROFESSIONAL_YEARLY  # Price ID for Professional yearly
STRIPE_PRICE_ENTERPRISE_MONTHLY # Price ID for Enterprise monthly
STRIPE_PRICE_ENTERPRISE_YEARLY  # Price ID for Enterprise yearly

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
| **PHI encryption** | `server/services/phi-encryption.ts` | AES-256-GCM application-level encryption for sensitive fields |
| **Tamper-evident audit** | `server/db/sync-schema.ts` | `audit_logs` table with integrity hashes and sequence numbers |
| **PostgreSQL RLS** | `server/db/sync-schema.ts` | `ENABLE/FORCE ROW LEVEL SECURITY` on all 27 tenant-scoped tables. `org_isolation` policies using `current_setting('app.org_id')`. DO-block idempotency for PG15 compatibility. `app.bypass_rls` session var for schema-sync and super-admin operations |
| **Per-org KMS encryption** | `server/services/org-encryption.ts` | Envelope encryption: AWS KMS generates per-org DEK, encrypted DEK stored in org settings, 30-min cache, `enc_v2_{orgPrefix}:` format. Falls back to shared `PHI_ENCRYPTION_KEY` when `AWS_KMS_KEY_ID` not set |
| **GDPR/CCPA compliance** | `server/routes/admin.ts` | `GET /api/admin/org/export` (right to access), `DELETE /api/admin/org/purge` (right to erasure with confirmation). `deleteOrgData()` in all storage backends |
| **Org suspension gate** | `server/auth.ts` | `injectOrgContext` checks org `status` field: suspended → 403 `OBS-ORG-SUSPENDED`, deleted → 410 `OBS-ORG-DELETED` |

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
- **Billing enforcement gates**: Plan feature gating (`requirePlanFeature`), quota enforcement (`enforceQuota`, `enforceUserQuota`), and active subscription checks (`requireActiveSubscription`) are applied as middleware on write routes. All reject requests with missing `orgId` rather than silently allowing
- **AI response hardening**: `parseJsonResponse()` validates every field type, clamps scores to valid ranges, and provides safe defaults. `normalizeAnalysis()` also clamps on the read path. Server-side flag enforcement overrides AI-set flags
- **Per-org username uniqueness**: Usernames are unique within an org (composite index `orgId + username`), not globally. `getUserByUsername()` accepts optional `orgId` for scoped lookups. OAuth/SSO flows without org context search globally
- **Org-scoped rate limiting**: Authenticated data routes include `orgId` in rate limit keys so tenants sharing an IP (corporate networks) don't affect each other. Pre-auth routes (login, register) use IP-only keys
- **Search scope**: `searchCalls()` searches transcripts, analysis summaries, and topics (not just transcripts). Uses PostgreSQL ILIKE with Set-based deduplication
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

## Deployment

### EC2 (Production HIPAA) — `deploy/ec2/`
```
Internet → Caddy (:443, auto TLS) → Node.js (:5000) → PostgreSQL + S3 + Bedrock + AssemblyAI
```
- EC2 t3.micro + Caddy for TLS + systemd for process management
- IAM instance role for S3 + Bedrock (no hardcoded AWS keys)
- Estimated ~$13/month (after free tier)
- See `deploy/ec2/README.md` for full setup guide

### Render.com (Staging / Non-PHI)
- Build: `npm run build`, Start: `npm run start`
- Env vars in Render dashboard
- No `render.yaml` — configured via dashboard
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
9. Schedule data retention (30s delay, then daily)
10. Register graceful shutdown handlers (close queues, Redis, DB)

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
- **Clinical note PHI encryption**: PHI fields (subjective, objective, assessment, HPI) are encrypted with AES-256-GCM before storage and decrypted on retrieval in clinical routes
- **EHR adapters**: Open Dental uses developer key + customer key auth; Eaglesoft uses eDex API with X-API-Key header. Config stored in `org.settings.ehrConfig`
- **Document versioning is a linked list**: Each `ReferenceDocument` has `previousVersionId` pointing to its predecessor. Creating a new version deactivates the old one (`isActive: false`) and purges its chunks. Version history is reconstructed by walking `previousVersionId` chain + scanning for forward references
- **RAG citations are fire-and-forget**: `consumeRagCitations()` returns the last citations produced by `loadReferenceContext()` and clears them. This avoids passing citation data through the entire prompt template pipeline. Citations are attached to `confidenceFactors.ragCitations[]` in the analysis
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
- **AI response validation**: `parseJsonResponse()` in `ai-provider.ts` clamps `performanceScore` to 0-10, sentiment scores to 0-1, sub-scores to 0-10, and validates all field types. Missing fields get safe defaults (5.0 for scores, "neutral" for sentiment). `normalizeAnalysis()` in `storage/types.ts` also clamps on read
- **Empty transcript handling**: If transcript text is <10 characters, the pipeline saves the call with `empty_transcript` flag, low confidence, and skips AI analysis entirely — prevents generating junk analysis from silence/noise
- **Employee auto-assignment safety**: Only considers active employees. If multiple employees match the detected name, prefers exact full-name match; skips assignment if ambiguous (logs the ambiguity)
- **`toDisplayString()` handles nested objects**: Checks `value`, `message`, `text` keys for wrapped strings, handles arrays, and caps JSON fallback at 500 chars
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
- **Team scoping returns null for no restriction**: `getTeamScopedEmployeeIds()` returns `null` (not an empty Set) when there is no restriction — null means "unrestricted", an empty Set means "access to zero employees". Always check `if (teamIds !== null)` before filtering.
- **Call share token only returned at creation**: `POST /api/calls/:id/shares` returns the full 48-hex token once. Subsequent `GET /api/calls/:id/shares` only returns `tokenPrefix` (first 8 chars) for display. This mirrors the API key pattern.
- **Call shares in cloud.ts use in-memory token lookup**: `getCallShareByToken()` in CloudStorage searches an in-memory Map populated at `createCallShare()` time. In multi-instance deployments, replace with a dedicated S3 index or move to PostgreSQL.
- **`checkApiKeyScope()` is a no-op for session auth**: The middleware checks `req.apiKeyScopes` and returns `next()` immediately if it's undefined — which it is for all session-authenticated requests. This means scope checks are additive, not breaking, for existing session-based flows.
- **`GET /api/coaching/my` match priority**: Matches caller's employee record first by email (exact match on `employee.email === user.username`), then by display name (`employee.name === user.name`). If multiple name matches exist, returns 409 to avoid returning the wrong employee's sessions.

## In-Progress Work (resume here in a new session)

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

## Future Plans / Roadmap
See `HEALTHCARE_EXPANSION_PLAN.md` for the full 4-phase healthcare expansion roadmap.

- **Phase 1 (done)**: Dental practice QA — dental call categories, prompt templates, CDT code reference, clinical note generation
- **Phase 2 (in progress)**: Clinical documentation add-on — AI scribe, style learning, multi-format notes (SOAP/DAP/BIRP), provider attestation workflow
- **Phase 3 (planned)**: EHR integration — Open Dental (bidirectional), Eaglesoft (read-focused), Dentrix (future). Routes and adapters are scaffolded
- **Phase 4 (planned)**: Expand verticals — urgent care, behavioral health, dermatology, ophthalmology, veterinary
- **QA + Docs bundle pricing**: The Professional plan now bundles QA + Clinical Documentation at $149/mo (previously split as $99 QA-only + $49 Docs-only separately)
- **Super-admin role**: Platform-level admin (not org-scoped) for managing all organizations — `SUPER_ADMIN_USERS` env var
- **PostgreSQL migration**: Move remaining S3-only deployments to PostgreSQL for better query performance and transactional integrity
- **Spanish language support**: Multilingual clinical note generation
