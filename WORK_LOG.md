# Observatory QA — Work Log

Detailed branch-by-branch history of completed audit and implementation work.
Moved from CLAUDE.md to keep the main documentation file focused on active
reference material. The critical invariants from these fixes are captured in
CLAUDE.md's Invariant Library (INV-01 through INV-23) and Common Gotchas.

For active follow-on items, see CLAUDE.md under "## Open Follow-On Items".

---

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
**P1 (Resolved):**
- ~~Analytics routes load unbounded datasets~~ — Fixed: revenue endpoints use `getCallMapForRevenues()` instead of `getAllCalls()`; proactive-alerts query limits added (20/employee, 5000 total, 200 active employees).
- ~~`checkAndAwardBadges` loads ALL org calls~~ — Fixed: now passes `employee` filter + `limit: 200` to `getCallSummaries()`. Gamification effectiveness endpoint (`/api/gamification/effectiveness`) still loads unbounded calls.
- ~~`AudioRecorder` cleanup stale closure~~ — Fixed: unmount cleanup properly revokes blob URL

**P2 (Medium):**
- ~379 `as any` casts across 68 server files (the 82 in pg-storage.ts have been refactored away via typed mappers)
- 250 ESLint `no-unused-vars` warnings
- ~105 remaining catch blocks across 29 route files for asyncHandler Phase 2
- Duplicate URL validation utilities (`url-validation.ts` + `url-validator.ts`)
- Live session Maps have no hard cap (11 unbounded Maps — added 4 for continuous clinical-scribe mode; all cleared on session cleanup)
- `request-metrics.ts` key growth bounded by Express `req.route?.path` normalization but falls back to `req.path` (raw URL with IDs) when no route match
- Missing `htmlFor`/`id` pairing on multiple form labels (a11y)
- `useIsMobile` returns false on first render causing layout shift on mobile

### Branch: `claude/broad-scan-feature-0YtPG`

#### ✅ Completed & committed: 5 P0/P1 fixes from broad-scan audit (F-44, F-11, F-13, F-03, F-01)
- **F-44 (High) — Post-commit error path data corruption** (`server/services/call-processing.ts`): `postProcessing()` was awaited inside the main try block, so notification/coaching/usage-tracking failures would mark the successfully-committed call as "failed" AND enqueue a retry, producing duplicate transcripts/analyses on re-processing. Fix: wrapped `postProcessing()` in its own try/catch that logs errors but keeps the call in "completed" state.
- **F-11 (High) — Cosign bypass via addenda** (`server/routes/clinical-compliance.routes.ts`, `shared/schema/calls.ts`): Cosign route filtered amendments by `type === "amendment"`, missing post-attestation addenda. A cosigner could unknowingly sign a note with unreviewed post-attestation content. Fix: returns 409 `OBS-CLINICAL-COSIGN-ADDENDA` when post-attestation addenda exist unless `acknowledgedAddenda: true` is in the request body; `acknowledgedAddendaCount` captured in the cosignature record and audit event. Schema gained optional `acknowledgedAddendaCount` field.
- **F-13 (High) — Stripe webhook dedup TOCTOU** (`server/services/redis.ts`, `server/routes/billing.ts`): `ephemeralGet` → check → `ephemeralSet` created a window where concurrent Stripe redeliveries could both pass the dedup check. Fix: added `ephemeralSetNx(prefix, key, value, ttlMs)` atomic primitive using Redis `SET NX PX`. In-memory fallback uses Node event-loop serialization. Billing webhook replaced check-then-set with single atomic call.
- **F-03 (Critical) — S3 retention audit trail** (`server/workers/retention.worker.ts`): S3 deletion failures had no tamper-evident audit trail — compliance officers could not prove retention attempts. Fix: per-failure `logPhiAccess` audit entry with specific object key and error message (`s3_audio_delete_failed` event); summary `s3_audio_purge_partial_failure` event on any partial failure; setup-failure `s3_audio_purge_setup_failed` event when listObjects itself fails. Slack alert now includes sample of failed keys. Retention worker naturally retries failed keys on the next scheduled run via the mtime scan.
- **F-01 (Critical) — Missing RLS on auth-adjacent tables** (`server/db/schema.ts`, `server/db/sync-schema.ts`, `server/routes/password-reset.ts`): `password_reset_tokens` and `mfa_recovery_requests` lacked RLS policies. `password_reset_tokens` additionally lacked an `org_id` column. Fix: added `addRlsPolicy()` calls for both tables; added `org_id TEXT REFERENCES organizations(id) ON DELETE CASCADE` column to `password_reset_tokens` via idempotent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`; backfill UPDATE from users table on every startup (no-op after first run); Drizzle schema updated with nullable `orgId`. `storeResetToken`/`validateAndConsumeToken` now wrap DB ops in a transaction with local `set_config('app.bypass_rls', 'true', true)` since password reset is pre-auth and has no org context.

#### Follow-on items surfaced during F-01 implementation
- **Auto-retry visibility**: Retention worker auto-retries failed S3 keys on the next scheduled run, but there's no metric for "age of oldest unsuccessfully-deleted S3 key".
- **`ephemeralSetNx` adoption elsewhere**: Other read-then-write patterns (OIDC state, upload dedup) could benefit from the same atomic primitive.

#### ✅ Completed & committed: 3 HIPAA-critical fixes from top-10 follow-on list
- **Session-level RLS bypass leak** (`server/db/sync-schema.ts`, `server/db/index.ts`) — `syncSchema` previously set `app.bypass_rls='true'` on a pooled drizzle connection at the session level, and that setting leaked back to the pool and silently disabled RLS on subsequent requests. Fix: `syncSchema` now acquires a dedicated pg client via `getPool().connect()`, builds a drizzle instance bound to that client, runs all DDL on it, and destroys the client with `client.release(true)` in a finally block. Every RLS policy in the codebase (including F-01's new ones for `password_reset_tokens` and `mfa_recovery_requests`) is now actually runtime-enforced. `getPool()` export added to `db/index.ts`.
- **F-12 — Live-session consent hard-coded** (`server/routes/live-session.ts`, `shared/schema/billing.ts`, `server/db/schema.ts`, `server/db/sync-schema.ts`, `server/db/pg-storage-features.ts`) — `POST /api/live-sessions` accepted a boolean `consentObtained` with no metadata, violating HIPAA §164.508's documented-consent requirement. Fix: added `CONSENT_METHODS = ["verbal", "written", "electronic"]` enum. The route now requires `consentMethod` in the request (returns 400 `OBS-CLINICAL-CONSENT-METHOD-REQUIRED` if missing), persists structured metadata (`consentMethod`, `consentCapturedAt`, `consentCapturedBy`) on the `live_sessions` row, and logs a `clinical_consent_obtained` HIPAA audit event with the provider and method. Schema columns added via `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`. **Breaking change**: client UI must send `consentMethod`.
- **F-18 — backup.sh mktemp race window** (`deploy/ec2/backup.sh`) — `mktemp -d` created the PHI backup directory with default umask (0022 → 0755) before the subsequent `chmod 700`, leaving a brief window where the directory was world-readable. Fix: added `umask 077` at the top of the script so every file and directory created is owner-only from the moment of creation. The existing `chmod 700` is kept as defense-in-depth.

#### Follow-on items (from the 3-fix batch)
- **Consent revocation workflow**: ✅ Implemented — `POST /api/live-sessions/:id/revoke-consent` stops recording, marks session with revocation metadata, logs HIPAA audit event.
- **CloudStorage live session consent fields**: PostgresStorage mapper was updated. If any deployment uses CloudStorage backend for live sessions, that implementation may need to be updated to handle the new fields. MemStorage passes through via spread.

#### ✅ Completed & committed: 3 High-priority fixes from top-10 follow-on list (F-38, F-05, F-09)
- **F-38 (High) — clinical-live audio error swallowing** (`client/src/pages/clinical-live.tsx`): The audio chunk POST used `.catch(() => {})` so network failures during a live clinical recording were invisible to the provider. Clinicians would believe they were recording while audio was being lost, leading to incomplete clinical notes. Fix: added `audioUploadFailed` state + `audioUploadFailCountRef`. The .then/.catch now tracks consecutive failures; after 3 in a row, a persistent red banner with `role="alert"` appears telling the clinician audio is being lost and to pause/resume or restart. Any successful upload resets the counter and clears the banner. "New Recording" reset also clears.
- **F-05 (High) — Greedy JSON regex in `parseJsonResponse`** (`server/services/ai-types.ts`): `/\{[\s\S]*\}/` matched from the first `{` to the LAST `}`, so an AI response wrapping JSON in explanation text with braces (e.g. `"Here's the pattern {example}: {...real JSON...}"`) captured both together and failed `JSON.parse`. Calls were marked failed with a confusing error. Fix: new `extractBalancedJsonObjects` walker finds ALL top-level balanced `{...}` substrings with string-literal awareness (handles nested braces, escaped quotes, braces inside strings). `parseJsonResponse` tries (1) markdown code fences, (2) full trimmed text, (3) each balanced candidate in source order until one parses successfully — skips past `{example}`-style placeholders. Preserves `AI_NO_JSON` vs `AI_MALFORMED_JSON` error code distinction.
- **F-09 (High) — MFA rate limit keyed only by sessionId** (`server/services/redis.ts`, `server/routes/mfa.ts`): `isMfaLocked`/`recordMfaAttempt`/`clearMfaAttempts` were keyed by `req.sessionID`, which meant (1) an attacker could clear their session cookie between attempts to get a fresh ID (unlimited retries), and (2) multi-instance deployments without sticky sessions had per-instance state (5 attempts × N instances per user). Fix: new `ephemeralIncrement(prefix, key, ttlMs)` in `redis.ts` using atomic Redis `INCR` + `PEXPIRE` (in-memory counter fallback). Rate limit now keyed by `userId` (from request body — attackers cannot rotate it). All 4 MFA verify endpoints (TOTP, backup codes, WebAuthn, email OTP) updated. Removed the module-local `setInterval` pruning (handled by Redis TTL or memFallback auto-eviction).

#### ✅ Completed & committed: 3 top-10 fixes (consent UI, Bedrock empty response, Google OAuth hd claim)
- **Consent method picker UI** (`client/src/pages/clinical-live.tsx`): Follow-on from F-12. The server-side F-12 fix required clients to send `consentMethod` in `POST /api/live-sessions` or the server returns 400 `OBS-CLINICAL-CONSENT-METHOD-REQUIRED`. Without a UI picker, clinical live recording was silently broken for every clinical customer. Fix: added `consentMethod` state + a `Select` dropdown with 3 options (verbal / written / electronic) each with a descriptive label. The Start Recording button is disabled until BOTH `consentConfirmed` checkbox AND `consentMethod` are set. Mutation body now includes `consentMethod`. "New Recording" reset clears the method too.
- **F-06 (High) — Bedrock `generateText` empty string ambiguity** (`server/services/bedrock.ts`): The function returned `""` when `result.output.message.content[0].text` was missing (content filter blocks, API shape changes, transient blips). Callers (coaching engine, call insights, reports, emails, insurance narratives) treated empty as success, producing silently-empty coaching plans and narrative drafts. Fix: explicit check for missing/empty text content; throws a marked error (`isBedrockEmptyContent: true`) that the existing retry loop recognizes as retryable. After `MAX_RETRIES`, callers get a clear `"Bedrock returned empty response content"` error instead of an empty string. Transient cases now get 2 retries automatically.
- **F-36 (High) — Google OAuth auto-provisioning domain verification** (`server/routes/oauth.ts`): Auto-provisioning trusted any Google account whose email domain matched `org.settings.emailDomain`, with no verification that the account was managed by that domain's Google Workspace tenant. Consumer Gmail accounts and cross-Workspace accounts could claim membership — domain-squatting account takeover. Fix: added two checks to the auto-provisioning path: (1) reject if `profile.emails[0].verified === false`, (2) require `profile._json.hd === emailDomain` (Workspace hosted-domain claim must match). Existing-user login path is unchanged — only new-user auto-provisioning is gated. Admins can still invite users manually without the `hd` check.

#### Follow-on items (from the 3 top-10 fixes)
- **Consent revocation workflow**: ✅ Implemented in `claude/broad-scan-feature-UXVES`.
- **Bedrock empty-content metric**: The thrown error is logged at warn level but not counted in a metric. Ops would benefit from a per-model counter of empty-content responses for content-filter debugging.
- **OAuth multi-domain support**: Orgs with multiple Google Workspace domains could be supported by adding `settings.allowedEmailDomains: string[]` and checking membership. Not in scope.
- **OAuth admin approval queue**: A stricter posture would queue auto-provisioned users as "pending" until an admin approves. Not in scope.

#### ✅ Completed & committed: 2 top-10 fixes (F-14 scheduled task timeouts, super-admin N+1 queries)
- **#3 F-14 (High) — Daily task orchestrator has no per-task timeout** (`server/scheduled/index.ts`): `runAllDailyTasks()` ran tasks sequentially with only try/catch isolation. A hung `runRetention()` or `audit-chain-verify` (DB deadlock, S3 rate-limit hang, unresponsive EHR) silently blocked every downstream task (quota alerts, trial downgrade, weekly digest) for that day. Fix: new `withTaskTimeout()` helper wraps each task in `Promise.race` with a distinct `ScheduledTaskTimeoutError` class. Retention gets 30 min, others get 10 min. Added duration logging on completion. Documented that JavaScript can't cancel promises — a hung task's work continues in background but the orchestrator moves on so downstream tasks still run.
- **#5 (High) — Super-admin N+1 queries**: `/api/super-admin/stats`, `/organizations`, and `/usage` looped over orgs with `Promise.all` per-org (3 queries each for `countUsersByOrg` + `countCallsByOrg` + `getSubscription`). For 100 orgs that's 300+ DB queries per dashboard request, making the super-admin panel unusable at scale. Fix: new `IStorage.getOrgsStatsBulk(orgIds)` method. Postgres implementation uses 3 aggregate queries total (`GROUP BY` on users, `GROUP BY` on calls, `inArray` on subscriptions). MemStorage implementation scans in-memory Maps. CloudStorage falls back to parallel per-org queries. `/stats` and `/organizations` now do 3 queries total regardless of org count. `/usage` reduced from 3 queries/org to 1 query/org + 3 platform-wide aggregates (the per-org `getOrgUsageSummary` call returns richer data not covered by the bulk method). Response JSON shape unchanged.

#### Follow-on items (from the 2-fix batch)
- **PostgreSQL IN-limit safety**: `inArray` with >32,767 org IDs would fail. Use the existing `chunkedInArray` helper if a super-admin ever has that many orgs. Not required at current scale.
- **Scheduled task timeout env override**: Timeout values are constants. Exposing them via `SCHEDULED_TASK_TIMEOUT_MS` would let ops tune them without code changes.
- **`getOrgUsageSummary` bulk variant**: `/usage` is still O(N) for the richer per-org aggregate. Adding a bulk variant would further speed up the usage dashboard.
- **Scheduled task duration metrics**: New `durationMs` log lines could feed Prometheus histograms for daily task observability.

#### ✅ Completed & committed: Strategic features from broad-scan audit (Stage 3 suggestions)
- **Plan-aware sidebar navigation** (`client/src/components/layout/sidebar.tsx`) — `meetsPlan()` helper + `PLAN_LEVEL` map. Free/Starter tiers hide Channels and Engagement sections; Calibration gated to Professional+; Insurance Letters gated to clinical plans. First-load effect applies plan-specific collapse defaults, respecting explicit user overrides persisted in localStorage. Users can still reach these pages by URL if they have role access — the sidebar gate is UX-only.
- **QA audit packet export** (`server/routes/calibration.ts`) — `GET /api/calibration/audit-packet?startDate&endDate&format=json|csv` (manager+, default 90-day window). Aggregates all completed calibration sessions in the range, computes org-wide Krippendorff α / ICC, evaluator certification summary (certified/probationary/flagged/needs_calibration), and per-session breakdowns. HIPAA audit-logged via `calibration_audit_packet_generated` event.
- **Coaching → LMS bridge** (`server/routes/coaching.ts`) — `POST /api/coaching/:id/generate-lms-module` (manager+). Uses the coaching session's category, notes, and linked call analysis to generate a focused, PHI-free LMS module via `aiProvider.generateText`. Optionally auto-assigns to the coached employee and links the module back to the session (via `linkedLearningModuleIds` — currently cast as `any` since the field isn't in the Zod schema). HIPAA audit event `coaching_lms_module_generated`.
- **Clinical-scribe continuous mode** (`server/routes/live-session.ts`) — `POST /api/live-sessions` accepts `continuousDraftMode: true`. When enabled, the server auto-regenerates the draft clinical note every 3 new final segments or 20s elapsed (whichever first), bypassing the manual 15s cooldown. Extracted shared `generateDraftNoteForSession()` helper and `maybeTriggerAutoDraft()` trigger with in-flight guard. Added 4 new in-memory Maps (`sessionContinuousMode`, `sessionSegmentsSinceDraft`, `sessionLastAutoDraftAt`, `sessionAutoDraftInFlight`), all cleared in `cleanupSession()`. 5-second periodic timer scans continuous sessions for time-based triggers. Auto-drafts broadcast via `broadcastLiveTranscript` with `autoDrafted: true`.

#### Follow-on items (not yet implemented)
- Add `linkedLearningModuleIds` to the `CoachingSession` Zod schema + DB columns so the coaching→LMS back-link persists properly (currently via `as any` cast)
- Add client UI for the Calibration audit packet download button on `/calibration`
- Add client UI for clinical-scribe continuous-mode opt-in toggle on `clinical-live.tsx` setup step
- Add client UI for coaching-to-LMS "Generate Training Module" button on each coaching session card
- Add `updateLearningProgress` to the `IStorage` interface (currently feature-detected via `(storage as any)`)

### Branch: `claude/broad-scan-feature-UXVES`

#### ✅ Completed & committed: 5 broad-scan findings (F-03, F-23, F-05, F-09, F-24) + 5 pre-existing TS fixes
- **F-03 (High) — Per-org circuit breaker** (`server/services/ai-factory.ts`): The Bedrock circuit breaker was global — one org's rate limits disabled AI for all tenants. Fix: each org now has its own circuit breaker state (`orgCircuitBreakers` Map). A global circuit breaker (threshold 15, vs per-org threshold 5) catches platform-wide Bedrock outages. Stale per-org breakers auto-cleaned every 5 min. New env var: `BEDROCK_GLOBAL_CIRCUIT_THRESHOLD`.
- **F-23 (High) — Enterprise overage billing** (`server/services/stripe.ts`, `server/routes/billing.ts`): `getOveragePriceId()` didn't map Enterprise tier, so enterprise customers exceeding 5,000 calls/month were never billed overage. Fix: added `enterprise` to overage price map and `STRIPE_PRICE_ENTERPRISE_OVERAGE` to `findItemByKnownPriceId()` lookups in checkout handler.
- **F-05 (High) — Zero sub-scores from missing AI data** (`server/services/call-processing.ts`, `server/workers/reanalysis.worker.ts`): Sub-score fields used `?? 0` when AI omitted them, making missing data indistinguishable from a genuine 0/10 score. Fix: sub-score fields now use `undefined` when AI omits them. `applyScoreCalibration()` preserves undefined for missing fields rather than calibrating zeros.
- **F-09 (High) — Reanalysis worker silent completion** (`server/workers/reanalysis.worker.ts`): When AI provider was unavailable, the worker returned a success result with `{ succeeded: 0 }`. BullMQ marked the job as completed. Fix: throws an error so BullMQ marks the job as failed and retries; after max retries, moves to DLQ.
- **F-24 (High) — Stripe webhook metered item sync** (`server/routes/billing.ts`): `customer.subscription.updated` didn't extract metered item IDs; `customer.subscription.deleted` lost `stripeCustomerId`. Fix: updated handler extracts `stripeSeatsItemId`/`stripeOverageItemId` from subscription items; deleted handler preserves customer ID and explicitly clears stale metered items.
- **Pre-existing TS fixes** (`server/index.ts`, `server/routes/admin.ts`): `server.listen` callback was non-async but used `await import()`. BAA routes in admin.ts imported removed `baaRecords` export — updated to use `businessAssociateAgreements` with correct column names (`expiresAt`, `signedAt`, `signedBy`).

#### Follow-on items
- Per-org circuit state should be exposed in admin health dashboard for operational visibility
- Frontend chart components should be audited to confirm they handle undefined sub-scores gracefully (show "N/A" instead of 0)
- `customer.subscription.updated` handler should also handle enterprise seat pricing if custom seat prices are introduced
- Admin.ts BAA routes duplicate `baa.ts` registered routes — consider removing the dead admin.ts copy

#### ✅ Completed & committed: Billing lifecycle tests + email OTP Redis migration
- **Stripe billing webhook tests** (`tests/billing-webhooks.test.ts`, 38 tests): Overage/seat price mapping (all tiers including enterprise), plan billing consistency (volume discount, calls/seats scaling), webhook event structure validation (tier resolution, metered item extraction, flat-rate vs metered identification), subscription lifecycle state transitions (checkout upsert, deletion preserves customer ID, update syncs metered items, additional seat calculation), webhook idempotency, and grace period calculation.
- **Email OTP Redis migration** (`server/routes/mfa.ts`): Replaced in-memory `emailOtpStore` Map + cleanup interval with Redis-backed ephemeral API (`ephemeralSet`/`ephemeralGet`/`ephemeralDel` with JSON serialization). OTP entries auto-expire via Redis TTL (10 min). Multi-instance safe: OTP created on instance A verifiable on instance B. In-memory fallback preserved via ephemeral API. Resolves the TODO comment that was in the code.

#### ✅ Completed & committed: Storage layer type safety improvements
- **Confidence mixin typed** (`server/db/pg-storage-confidence.ts`): Replaced `storage: any` parameter with typed `PostgresStorage` intersection. Typed raw SQL result as `ConfidenceMetricsRow` interface (was `as any`). Removed `(r: any)` cast in map callback.
- **rawRows generic** (`server/db/pg-storage.ts`): `rawRows()` helper now uses generic type parameter `rawRows<T>()` returning `T[]` instead of `any[]`. Callers can gradually annotate with expected row types.

#### ✅ Completed & committed: Post-processing reconciliation + EHR error classification
- **Post-processing reconciliation** (`server/scheduled/post-processing-reconciliation.ts`): New daily scheduled task finds completed calls (1-48h old) with no usage records and re-tracks transcription + AI analysis usage. Capped at 50 calls per org per run. Registered in daily task orchestrator. Addresses the F-06 gap where postProcessing() failures are intentionally swallowed (per F-44) but had no compensating mechanism.
- **EHR error classification** (`server/services/ehr/types.ts`, `open-dental.ts`, `eaglesoft.ts`, `dentrix.ts`, `server/routes/ehr.ts`): New `EhrError` class with typed `errorType` (auth/not_found/network/server/timeout/unknown). `classifyEhrError()` parses HTTP status from error messages. Open Dental, Eaglesoft, and Dentrix adapters now throw `EhrError` for non-404 errors instead of silently returning null/[]. EHR route catches `EhrError` and returns 502/504 with `ehrErrorType` field for actionable frontend messages.

#### Follow-on items
- FHIR R4 and mock adapters not yet updated with classifyEhrError
- Frontend should handle `ehrErrorType` field to show actionable error banners
- Reconciliation job should be extended to re-run missed webhook notifications (currently only re-tracks usage)

#### ✅ Completed & committed: Consent revocation + BM25 IDF
- **Consent revocation** (`shared/schema/billing.ts`, `server/db/sync-schema.ts`, `server/routes/live-session.ts`): HIPAA §164.508 right to revoke consent mid-session. New `consentRevokedAt`/`consentRevokedBy` fields on LiveSession. New `POST /api/live-sessions/:id/revoke-consent` endpoint: immediately stops recording (closes AssemblyAI connection), cleans up session buffers, marks consent as revoked, logs tamper-evident `clinical_consent_revoked` audit event with original consent method and session duration.
- **BM25 IDF in RAG production** (`server/services/rag.ts`): `searchRelevantChunks()` now computes document frequencies from the pgvector candidate set and passes `corpusSize` + `documentFrequencies` to `bm25Score()`. Previously IDF defaulted to 1.0 (all terms weighted equally). Now common terms like "patient" get lower BM25 weight while rare domain terms get higher weight. Uses local IDF (candidate window as corpus) — pragmatic approximation that avoids querying the full corpus.

#### Follow-on items
- Frontend: add "Revoke Consent" button to clinical-live.tsx session controls
- Revoked sessions should be visually marked in the UI and excluded from clinical metrics
- Full-corpus IDF could be computed at index time and cached per-org for even better precision

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
- **Clinical note edits always require `version`**: `PATCH /api/clinical/notes/:callId` requires `req.body.version` matching the current note version for ALL edits (not just attested notes). This prevents concurrent edits from silently overwriting each other. If version is missing → 400 `OBS-CLINICAL-VERSION-REQUIRED`; if mismatched → 409 `OBS-CLINICAL-CONFLICT`. The GET endpoint returns the current `version` in the clinical note object.

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
- **Org cache invalidation** — `admin.ts`, `super-admin.ts`, `admin-security.routes.ts`, `billing.ts`, `ehr.ts`, `clinical.ts`, `clinical-analytics.routes.ts`, `gamification.ts`, `spend-tracking.ts`: `invalidateOrgCache()` after `updateOrganization()` call sites that change settings read by other middleware. Note: some low-impact settings updates (onboarding branding, edit pattern insights) do not invalidate cache — settings changes take effect after 30s TTL
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
- **generateText retry** — `bedrock.ts`: 2 retries with exponential backoff for transient failures (429, 5xx, timeout, and missing-content responses marked `isBedrockEmptyContent`). Empty-content case previously returned `""` which callers treated as success; now throws and retries. All callers benefit automatically

### Branch: `claude/broad-scan-feature-X5Op5`

#### ✅ Completed & committed: 5 broad-scan findings (F-05, F-01, F-02, F-12, F-06)
- **F-05 (High) — Revenue endpoint OOM** (`server/routes/revenue.ts`): Five revenue endpoints (forecast, trend, by-employee, payer-mix) called `storage.getAllCalls(orgId)` loading ALL calls into memory to build date maps. Fix: new `getCallMapForRevenues()` helper loads only calls referenced by revenue records, batched in groups of 50.
- **F-01 (High) — Billing grace period fail-open** (`server/routes/billing.ts:191`): `requireActiveSubscription()` defaulted `inGracePeriod` to `true` when `pastDueAt` was null (old subscription records), granting indefinite free access to past-due accounts. Fix: changed default to `false` (fail-closed).
- **F-02 (High) — Host header injection in Stripe redirects** (`server/routes/billing.ts:452,494`): Checkout and portal redirect URLs used `req.protocol + req.get("host")` which is attacker-controlled. Fix: use `process.env.APP_BASE_URL` with host header fallback.
- **F-12 (High) — Proactive alerts unbounded queries** (`server/services/proactive-alerts.ts`): `getManagerReviewQueue()` loaded all calls per employee without limit; `generateWeeklyDigest()` loaded all completed calls. Fix: added `limit: 20` per employee, `limit: 5000` for digest, capped active employees at 200.
- **F-06 (Medium) — Clinical note concurrent edit data loss** (`server/routes/clinical.ts:305-325`): Optimistic locking only applied to attested notes. Unattested note edits had no version checking, causing silent overwrites on concurrent edits. Fix: version field now required for ALL clinical note edits. **Breaking API change**: frontend must send `version` in PATCH body.

#### ✅ Completed & committed: 6 follow-on fixes (#1, #3, #4, #6, #7, #8)
- **#1 — Clinical note version UI** (`client/src/pages/clinical-notes.tsx`): saveMutation now sends `version: cn?.version ?? 0` in PATCH body; onError handles 409 conflicts by refreshing data and exiting edit mode.
- **#3 — EHR SSRF validation** (`server/services/ehr/request.ts`): Added `validateUrl()` check before every outbound EHR request, blocking private IPs, cloud metadata endpoints, and non-HTTP protocols.
- **#4 — RAG confidence math** (`server/services/rag.ts:1209-1216`): Removed invalid `topScore = score / 0.65` back-derivation. Uses effective score directly with threshold 0.50 for PARTIAL→HIGH upgrades.
- **#6 — Gamification badges OOM** (`server/routes/gamification.ts:26-28`): `checkAndAwardBadges` now passes `employee` filter + `limit: 200` to `getCallSummaries()` instead of loading all org calls.
- **#7 — Calibration stddev** (`server/routes/calibration.ts:17`): `computeStdDev` changed from population variance (`/n`) to sample variance (`/(n-1)`) with Bessel's correction, consistent with `computeICC`.
- **#8 — FHIR R4 error masking** (`server/services/ehr/fhir-r4.ts`): `getPatient` and `getPatientTreatmentPlans` now use `classifyEhrError` — return null/[] only for not_found; throw with logging for auth/network/server errors.

#### ✅ Completed & committed: 3 additional fixes (#5, #9, #10)
- **#5 — Revenue date filtering** (`server/storage/types.ts`, `server/db/pg-storage-features.ts`, `server/storage/memory.ts`, `server/routes/revenue.ts`): `listCallRevenues` now accepts optional `startDate`/`endDate` filters with SQL-level gte/lte. Forecast uses 180-day window, trend uses 120-day window.
- **#9 — Webhook signature tests** (`tests/billing-webhooks.test.ts`): 5 new tests using real Stripe SDK `constructEvent` + `generateTestHeaderString`. Covers valid signature, invalid signature, wrong secret, tampered payload, missing secret.
- **#10 — Tautological test fix** (`server/auth.ts`, `tests/auth-routes.test.ts`, `tests/input-validation.test.ts`): Exported `ROLE_HIERARCHY` from auth.ts. Tests now import `ROLE_HIERARCHY`, `INDUSTRY_TYPES`, `USER_ROLES` from production code. Fixed stale "healthcare" assertion.

#### Follow-on items
- Gamification effectiveness endpoint (`/api/gamification/effectiveness`) still loads unbounded calls
- Eaglesoft and Dentrix adapters have the same silent error masking — should get the same `classifyEhrError` treatment


Created: 2026-04-13T01:43:07Z

---

## Completed Improvement Backlog Items (91 items)

The following items were tracked in CLAUDE.md's Improvement Backlog and completed
across multiple audit sessions. Moved here to keep the active backlog focused.

### Clinical Documentation / Medical Scribe (12 items completed)
Structured data auto-extraction, clinical note retry on AI failure, amendment chain integrity (SHA-256), cosignature version conflict detection, ICD-10/diagnosis linkage, amendment subtypes, batch clinical note revalidation, vital signs range validation, cosign NPI validation, viewer PHI filtering expanded, FHIR subject fallback, amendment decryption audit.

### Call Analysis (10 items completed)
Upload deduplication lock, confidence-based prompt adjustment, prompt template caching, per-call cost attribution, pipeline storage resilience, flag validation tightened, auto-assignment safety, unlabeled speaker tracking, ref doc cache FIFO→LRU, analyzeAndStoreEditPatterns N+1 fix.

### RAG Knowledge Base (13 items completed)
Chunk deduplication, semantic deduplication of results, PDF extraction timeout, chunk-level retrieval tracking, pgvector availability check, score normalization, FAQ NaN guard, embedding retry jitter, silent degradation detection, empty embedding arrays, BM25 normalization overflow, embedding cache FIFO→LRU, silent RAG degradation.

### HIPAA Compliance (5 items completed)
BAA management system, automated breach detection, S3/backup lifecycle purging, PHI access reporting UI, key escrow for PHI encryption.

### LMS / Learning (6 items completed)
Progress upsert race condition, quiz question versioning, N+1 query in path progress, learning path assignment notifications, bulk progress operations, stats endpoint optimization.

### Lead Tracking (3 items completed)
UTM parameter capture, cohort conversion analysis, time-to-convert metrics.

### Architecture / Code Quality (14 items completed)
asyncHandler adoption, call processing transaction wrapper, rate limit key normalization, inline schema centralization, team scoping TOCTOU fix, promptTemplateCache LRU, orgCache LRU, feedback pagination, coaching pagination, users Drizzle schema sync, analysis schema sync, deleteOrgData completeness, dead BAA table removal, session invalidation after password reset.

### Security (11 items completed)
Invitation token hashing, CSRF on direct fetch() calls, account lockout eviction, CSRF bypass via x-api-key, tenant isolation on marketing/LMS, webhook empty-token bypass, DB SSL certificate verification, prompt injection hardening, org cache invalidation, session secret fail-fast, CLI secret scanning.

### Testing (4 items completed)
E2E credential alignment, coverage thresholds, E2E test isolation, AI provider mocks.

### DevOps / Infrastructure (6 items completed)
Pin CI actions to SHA, backup script PHI safety, Docker ports bound to localhost, security gates Docker builds, Docker image push, schema sync validation.

### UI/UX (6 items completed)
Idle timeout warning bypass, ErrorBoundary dashboard link, CSRF cookie name mismatch, dashboard query freshness, upload progress tracking, ProtectedRoute stale permissions.
