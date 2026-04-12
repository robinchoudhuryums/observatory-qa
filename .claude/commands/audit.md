If $ARGUMENTS is empty or missing, respond with exactly this and stop:

> **Usage:** `/audit <subsystem-name>`
> **Available subsystems:**
> - Core Platform & Infrastructure
> - Storage Layer & Database
> - Auth, Security & HIPAA
> - Call Analysis Pipeline
> - RAG Knowledge Base
> - Clinical Documentation
> - EHR Integration
> - Coaching, Gamification & LMS
> - Billing & Revenue
> - Admin & Platform Operations
> - Workers & Scheduled Tasks
> - Frontend (UI/UX)
>
> **Example:** `/audit Auth, Security & HIPAA`

---

Refer to the systems map summary in CLAUDE.md under "## Systems Map" for architectural context. Do not make any changes to any files during this session.

This session's audit scope: $ARGUMENTS

Look up the file list for this subsystem in CLAUDE.md under "## Cycle Workflow Config" → "### Subsystems". Read every file listed for the target subsystem. If the scope is ambiguous, ask before proceeding.

Also check the Invariant Library in CLAUDE.md under "### Invariant Library" for invariants tagged to this subsystem — verify each one as part of the audit.

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
