If $ARGUMENTS is empty or missing, respond with exactly this and stop:

Usage: /targeted-audit <subsystem-name>

Available subsystems:
- Core Architecture & Data Pipeline
- Storage Layer / Database
- Security & HIPAA Compliance
- Call Analysis Pipeline
- RAG System
- Clinical Documentation / Medical Scribe
- EHR Integration
- Integrations & External Services
- UI/UX & Frontend
- Billing / Business Plan

Example: /targeted-audit Security & HIPAA Compliance

---

Read CLAUDE.md (especially Common Gotchas and Key Design Decisions)
before starting. Do not make any changes to any files during this session.

SUBSYSTEM FILE REFERENCE:
Core Architecture & Data Pipeline:
  server/index.ts, server/routes/index.ts, server/middleware/, server/services/websocket.ts, server/services/queue.ts, server/services/redis.ts, server/services/logger.ts, server/scheduled/, server/workers/
Storage Layer / Database:
  server/storage/types.ts, server/storage/index.ts, server/storage/memory.ts, server/storage/cloud.ts, server/db/index.ts, server/db/schema.ts, server/db/pg-storage.ts, server/db/pg-storage-features.ts, server/db/pg-storage-confidence.ts, server/db/sync-schema.ts, server/db/migrate.ts
Security & HIPAA Compliance:
  server/auth.ts, server/services/phi-encryption.ts, server/services/org-encryption.ts, server/services/audit-log.ts, server/services/incident-response.ts, server/middleware/waf.ts, server/routes/mfa.ts, server/routes/sso.ts, server/routes/scim.ts, server/routes/oauth.ts, server/routes/admin-security.routes.ts, server/utils/phi-redactor.ts, server/utils/ai-guardrails.ts
Call Analysis Pipeline:
  server/services/call-processing.ts, server/services/assemblyai.ts, server/services/assemblyai-realtime.ts, server/services/ai-factory.ts, server/services/ai-provider.ts, server/services/ai-prompts.ts, server/services/ai-types.ts, server/services/bedrock.ts, server/services/bedrock-batch.ts, server/services/auto-calibration.ts, server/services/cost-estimation.ts
RAG System:
  server/services/rag.ts, server/services/chunker.ts, server/services/embeddings.ts, server/services/embedding-provider.ts, server/services/rag-worker.ts, server/services/rag-trace.ts, server/services/faq-analytics.ts
Clinical Documentation / Medical Scribe:
  server/routes/clinical.ts, server/routes/clinical-compliance.routes.ts, server/routes/clinical-analytics.routes.ts, server/services/clinical-templates.ts, server/services/clinical-validation.ts, server/services/clinical-extraction.ts, server/services/style-learning.ts, server/services/fhir.ts
EHR Integration:
  server/services/ehr/, server/routes/ehr.ts
Integrations & External Services:
  server/services/stripe.ts, server/services/email.ts, server/services/notifications.ts, server/services/telephony-ingestion.ts, server/services/sentry.ts, server/routes/assemblyai-webhook.ts
UI/UX & Frontend:
  client/src/App.tsx, client/src/pages/, client/src/components/, client/src/hooks/, client/src/lib/
Billing / Business Plan:
  server/routes/billing.ts, server/services/stripe.ts, shared/schema/billing.ts, shared/schema/features.ts

This session's scope: $ARGUMENTS
Use the file reference above to identify relevant files.

[OPTIONAL: PASTE ANY FOLLOW-ON ITEMS FROM A PRIOR SESSION THAT FLAGGED THIS SUBSYSTEM]

[OPTIONAL: PASTE ANY POLICY RESPONSE TRIGGERED BLOCKS FROM THE LAST HEALTH SYNTHESIS — if triggered, these are MANDATORY scope additions]

Audit this subsystem thoroughly. For each finding:
- State the issue, cite file and function/line
- Severity: Critical / High / Medium / Low
- Confidence: High / Medium / Low
- Would this bug actually fire in production this month? YES (describe
  the trigger) or NO (explain why)
- Effort to fix: S (< 2 hours) / M (half-day to 2 days) / L (3+ days)

Focus on:
- Bugs and logic errors in currently-reachable code paths
- Security concerns specific to this module
- Inconsistencies between CLAUDE.md and actual implementation
- Cross-module dependencies this subsystem has — what would break
  in OTHER modules if we change things here
- Silent degradation paths: places where failure is swallowed and the
  app continues with wrong results rather than surfacing an error

DO NOT flag style preferences, speculative improvements, or "could be
cleaner" refactoring unless the current code is actively wrong.

After the audit, produce an implementation plan. For each action:
- Action ID (A1, A2, A3...)
- What specifically to do (concrete, not "improve error handling")
- Which finding(s) it addresses
- Effort: S / M / L
- Cross-module risk: Low / High
- Prerequisites: other actions that must complete first

Organize into:
1. Fix now — production bugs, security issues, blocking problems
2. Fix this session — high-value, well-scoped, low cross-module risk
3. Defer — needs more context, high risk, or dependencies outside scope

End with a TIER 2 HANDOFF BLOCK:

---TIER 2 HANDOFF BLOCK---
Scope: [subsystem]
Findings: [count] total — [critical/high/medium/low breakdown]
Production bugs (would fire this month): [count of YES answers]

ACTIONS (implement in this order):
[ID] | [File: area] | [Effort] | [Risk] | [Description]

CROSS-MODULE RISKS:
- [what could break outside this scope and where to verify]
(or "None identified")

DO NOT TOUCH:
- [any files/functions that are high-risk to modify without deeper
  investigation — explain why]
---END TIER 2 HANDOFF BLOCK---
