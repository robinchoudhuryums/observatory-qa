If $ARGUMENTS is empty or missing, respond with exactly this and stop:

Usage: /targeted-audit <subsystem-name>

Available subsystems:
- Core Platform & Infrastructure
- Storage Layer & Database
- Auth, Security & HIPAA
- Call Analysis Pipeline
- RAG Knowledge Base
- Clinical Documentation
- EHR Integration
- Coaching, Gamification & LMS
- Billing & Revenue
- Admin & Platform Operations
- Workers & Scheduled Tasks
- Frontend (UI/UX)

Example: /targeted-audit Auth, Security & HIPAA

---

Read CLAUDE.md (especially Common Gotchas and Key Design Decisions)
before starting. Do not make any changes to any files during this session.

This session's scope: $ARGUMENTS

Look up the file list for this subsystem in CLAUDE.md under "## Cycle Workflow Config" → "### Subsystems". Read every file listed for the target subsystem.

Also check the Invariant Library in CLAUDE.md under "### Invariant Library" for invariants tagged to this subsystem — verify each one as part of the audit.

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
