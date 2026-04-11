If $ARGUMENTS is empty or missing, respond with exactly this and stop:

> **Usage:** `/audit <subsystem-name>`
> **Available subsystems:**
> - Core Architecture & Data Pipeline
> - Storage Layer / Database
> - Security & HIPAA Compliance
> - Call Analysis Pipeline
> - RAG System
> - Clinical Documentation / Medical Scribe
> - EHR Integration
> - Integrations & External Services
> - UI/UX & Frontend
> - Billing / Business Plan
>
> **Example:** `/audit Security & HIPAA Compliance`

---

Refer to the systems map summary in CLAUDE.md under "## Systems Map" for architectural context. Do not make any changes to any files during this session.

This session's audit scope: $ARGUMENTS

Use the subsystem file reference below to determine the relevant files. If the scope is ambiguous, ask before proceeding.

---
SUBSYSTEM FILE REFERENCE:
- Core Architecture & Data Pipeline: server/index.ts, server/vite.ts, server/utils.ts, server/logger.ts, server/types.d.ts, server/middleware/correlation-id.ts, server/middleware/tracing.ts, server/middleware/error-handler.ts, server/middleware/validate.ts, server/services/websocket.ts, server/services/queue.ts, server/services/redis.ts, server/services/logger.ts, server/services/sentry.ts, server/services/telemetry.ts, server/services/dashboard-cache.ts, server/services/error-codes.ts, server/utils/helpers.ts, server/utils/lru-cache.ts, server/utils/request-metrics.ts, server/workers/index.ts, server/scheduled/index.ts, server/scheduled/scheduler.ts, server/scheduled/weekly-digest.ts, server/routes/index.ts, server/routes/helpers.ts, server/routes/health.ts, server/routes/admin.ts, server/routes/super-admin.ts, server/routes/dashboard.ts, server/routes/insights.ts, server/routes/reports.ts, server/routes/export.ts, server/routes/employees.ts, server/routes/feedback.ts, server/routes/onboarding.ts, server/routes/marketing.ts, server/routes/lms.ts, server/routes/gamification.ts, server/routes/benchmarks.ts
- Storage Layer / Database: server/storage/types.ts, server/storage/index.ts, server/storage/memory.ts, server/storage/cloud.ts, server/db/index.ts, server/db/schema.ts, server/db/pg-storage.ts, server/db/pg-storage-features.ts, server/db/pg-storage-confidence.ts, server/db/sync-schema.ts, server/db/migrate.ts, server/db/migrate-audit-chain.ts, server/workers/retention.worker.ts, server/workers/usage.worker.ts, server/scheduled/retention.ts, shared/schema/org.ts, shared/schema/calls.ts
- Security & HIPAA Compliance: server/auth.ts, server/services/phi-encryption.ts, server/services/org-encryption.ts, server/services/audit-log.ts, server/services/incident-response.ts, server/middleware/waf.ts, server/routes/mfa.ts, server/routes/sso.ts, server/routes/scim.ts, server/routes/oauth.ts, server/routes/admin-security.routes.ts, server/utils/phi-redactor.ts, server/utils/url-validation.ts, server/utils/url-validator.ts, server/utils/ai-guardrails.ts, server/routes/auth.ts, server/routes/password-reset.ts, server/routes/api-keys.ts, server/routes/baa.ts, server/routes/access.ts, server/routes/registration.ts, server/scheduled/audit-chain-verify.ts
- Call Analysis Pipeline: server/services/call-processing.ts, server/services/assemblyai.ts, server/services/assemblyai-realtime.ts, server/services/ai-factory.ts, server/services/ai-provider.ts, server/services/ai-prompts.ts, server/services/ai-types.ts, server/services/bedrock.ts, server/services/bedrock-batch.ts, server/services/auto-calibration.ts, server/services/cost-estimation.ts, server/services/scoring-calibration.ts, server/services/call-clustering.ts, server/services/coaching-engine.ts, server/services/proactive-alerts.ts, server/services/performance-snapshots.ts, server/services/scheduled-reports.ts, server/routes/calls.ts, server/routes/call-insights.ts, server/routes/ab-testing.ts, server/routes/coaching.ts, server/routes/calibration.ts, server/workers/reanalysis.worker.ts, server/scheduled/coaching-tasks.ts
- RAG System: server/services/rag.ts, server/services/chunker.ts, server/services/embeddings.ts, server/services/embedding-provider.ts, server/services/rag-worker.ts, server/services/rag-trace.ts, server/services/faq-analytics.ts, server/workers/indexing.worker.ts
- Clinical Documentation / Medical Scribe: server/routes/clinical.ts, server/routes/clinical-compliance.routes.ts, server/routes/clinical-analytics.routes.ts, server/routes/live-session.ts, server/routes/insurance-narratives.ts, server/routes/patient-journey.ts, server/services/clinical-templates.ts, server/services/clinical-validation.ts, server/services/clinical-extraction.ts, server/services/style-learning.ts, server/services/fhir.ts
- EHR Integration: server/services/ehr/index.ts, server/services/ehr/types.ts, server/services/ehr/request.ts, server/services/ehr/secrets-manager.ts, server/services/ehr/health-monitor.ts, server/services/ehr/appointment-matcher.ts, server/services/ehr/open-dental.ts, server/services/ehr/eaglesoft.ts, server/services/ehr/dentrix.ts, server/services/ehr/fhir-r4.ts, server/services/ehr/mock.ts, server/routes/ehr.ts, server/workers/ehr-note-push.worker.ts
- Integrations & External Services: server/services/stripe.ts, server/services/email.ts, server/services/notifications.ts, server/services/telephony-ingestion.ts, server/services/sentry.ts, server/services/aws-credentials.ts, server/services/s3.ts, server/routes/assemblyai-webhook.ts, server/routes/emails.ts
- UI/UX & Frontend: client/src/App.tsx, client/src/main.tsx, client/src/pages/, client/src/components/, client/src/hooks/, client/src/lib/
- Billing / Business Plan: server/routes/billing.ts, server/routes/spend-tracking.ts, server/routes/revenue.ts, server/services/stripe.ts, server/services/cost-estimation.ts, server/scheduled/trial-downgrade.ts, server/scheduled/quota-alerts.ts, shared/schema/billing.ts, shared/schema/features.ts

Note: Some files are intentionally dual-listed where they span subsystems (e.g., `server/services/stripe.ts` under both Integrations and Billing). When auditing a specific subsystem, read every file listed for that subsystem even if it also appears under another.
---

[OPTIONAL: PASTE ANY FOLLOW-ON ITEMS FROM A PRIOR SESSION THAT FLAGGED THIS SUBSYSTEM]

[OPTIONAL: PASTE ANY POLICY RESPONSE TRIGGERED BLOCKS FROM THE LAST HEALTH SYNTHESIS — if a policy response was triggered for an Axis B category, the prescribed policy fixes are MANDATORY additions to this cycle's scope regardless of subsystem focus]

[OPTIONAL: PASTE THE "RECOMMENDED FOCUS FOR NEXT SUBSYSTEM CYCLE" SECTION FROM THE LAST SEAMS & INVARIANTS AUDIT — if this subsystem was flagged, check the seam-related findings listed there before running the full audit]

Audit this scope thoroughly. Flag:
- Bugs and logic errors
- Dead or unused code (functions, variables, imports never called or referenced)
- Stale TODOs, commented-out code, and placeholder logic left in production paths
- Hardcoded values that should be config or environment variables
- Security concerns specific to this module (auth gaps, unvalidated inputs, exposed sensitive data)
- Inconsistencies between documentation/CLAUDE.md and actual implementation
- Code quality issues: overly complex functions, poor separation of concerns, naming that obscures intent
- Anything that will compound into a larger problem if not addressed before this module scales

For each finding:
- Assign an ID (F01, F02, F03...)
- State the issue clearly in one or two sentences
- Cite the file and approximate location (function name or line range)
- Rate severity: Critical / High / Medium / Low
- State your confidence level: High / Medium / Low (flag if you're inferring from limited context)
- Add a rough effort signal for the fix: S (< 2 hours) / M (half-day to 2 days) / L (3+ days)

End with:
- Top findings by impact — the 5 findings most likely to cause active breakage, data loss, or a security/compliance failure. Note: severity label and impact rank can differ.
- Top 5 highest-leverage improvements (things that would most improve velocity or reliability if addressed)
- Any dependencies or interactions with OTHER subsystems that this audit surfaced

Then produce a SESSION HANDOFF BLOCK:

---SESSION HANDOFF BLOCK---
Scope: $ARGUMENTS
Files covered: [comma-separated list]
Audit confidence: [High / Medium / Low overall, with any dimension-specific notes]

FINDINGS:
[ID] | [File: function/line] | [Severity] | [Confidence] | [Effort: S/M/L] | [One-line description]
(repeat for each finding)

CROSS-MODULE DEPENDENCIES SURFACED:
- [module or file] depends on [specific function/export] in this scope — [nature of dependency]
(or "None identified")

TOP PRIORITIES:
Impact: [finding IDs — group related findings that should be fixed together, e.g. F03+F04+F05 (batch)]
High-leverage: [finding IDs]

RECOMMENDED PLANNING STARTING POINT: [one sentence — include why this ordering matters]
---END HANDOFF BLOCK---
