Do not make any changes to any files during this session.

Read the following to orient yourself: CLAUDE.md, README, and any recently modified files.

[OPTIONAL: PASTE ANY PRIOR SYNTHESIS SCORE OR KEY FINDINGS FOR REFERENCE]

[OPTIONAL: NOTE ANY AREAS THAT HAVE CHANGED SIGNIFICANTLY SINCE THE LAST AUDIT]

Provide a Health Pulse — a directional snapshot of overall project standing on both axes.

AXIS A — VERTICAL (Subsystem Health):
For each dimension, provide:
- A score out of 10 (or "Not assessed" if no signal)
- Confidence: High / Medium / Low
- One sentence of reasoning
- Flag any dimension where confidence is Low and a proper audit session is overdue

Use the dimensions defined in CLAUDE.md under "## Cycle Workflow Config" → "### Health Dimensions":
Architecture & Code Quality, Storage & Data Integrity, Security & HIPAA Compliance, Call Analysis Accuracy, RAG Quality, Clinical Documentation Safety, EHR Integration Reliability, Coaching & Analytics Correctness, Billing Integrity, Operational Readiness, UI/UX & Accessibility, Scalability & Performance, Business Viability

AXIS B — HORIZONTAL (Bug-Shape Posture — lightweight scan):
For each category below, provide a quick directional score (1–10) and one sentence of evidence based on what you can observe from CLAUDE.md, recent commits, and code structure. These are lower-confidence than synthesis scores — flag that explicitly.

1. Silent Degradation — Are there .catch() blocks with default/fallback values in load-bearing paths? Does the app fail loudly or silently on missing state?
2. Startup Ordering — Does startup validation exist for env vars listed in CLAUDE.md? Any obvious middleware-ordering risks?
3. Operator-Only State Gaps — Are there manual setup steps in CLAUDE.md that have no automated validation?
4. Parallel Source-of-Truth Drift — Are there config values, types, or constants defined in multiple places?
5. Test Coverage Quality — Do recent fixes have corresponding regression tests, or are they untested?

Then answer:
- Has anything changed significantly since the last assessment (if provided)?
- Is there any dimension on either axis that looks materially worse and warrants moving up in the audit queue?
- What is the one thing most likely to cause a problem before the next full audit cycle?
- Which Axis B category would you investigate first if you had one hour?
