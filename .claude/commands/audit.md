If $ARGUMENTS is empty or missing, respond with exactly this and stop:

> **Usage:** `/audit <subsystem-name>`
> **Available subsystems:**
> - Core Architecture & Data Pipeline
> - Storage Layer / Database
> - Security & HIPAA Compliance
> - Call Analysis Pipeline
> - RAG System
> - Clinical Documentation / Medical Scribe
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
- Core Architecture & Data Pipeline: server/index.ts, server/routes/index.ts, server/middleware/, server/services/websocket.ts, server/services/queue.ts, server/services/redis.ts
- Storage Layer / Database: server/storage/types.ts, server/storage/index.ts, server/storage/memory.ts, server/storage/cloud.ts, server/db/index.ts, server/db/schema.ts, server/db/pg-storage.ts, server/db/pg-storage-features.ts, server/db/sync-schema.ts
- Security & HIPAA Compliance: server/auth.ts, server/services/phi-encryption.ts, server/services/org-encryption.ts, server/services/audit-log.ts, server/middleware/waf.ts
- Call Analysis Pipeline: server/services/call-processing.ts, server/services/assemblyai.ts, server/services/ai-factory.ts, server/services/ai-provider.ts, server/services/bedrock.ts
- RAG System: server/services/rag.ts, server/services/chunker.ts, server/services/embeddings.ts, server/services/rag-trace.ts, server/services/faq-analytics.ts
- Clinical Documentation / Medical Scribe: server/routes/clinical.ts, server/routes/clinical-compliance.routes.ts, server/routes/clinical-analytics.routes.ts
- Integrations & External Services: server/services/ehr/, server/services/stripe.ts, server/services/email.ts, server/routes/assemblyai-webhook.ts
- UI/UX & Frontend: client/src/App.tsx, client/src/pages/, client/src/components/
- Billing / Business Plan: server/routes/billing.ts, server/services/stripe.ts, shared/schema/billing.ts, shared/schema/features.ts
---

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
