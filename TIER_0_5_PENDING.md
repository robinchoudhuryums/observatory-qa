# Pending Hand-Edits

This branch (`claude/adapt-callanalyzer-observatory-EZDqB`) shipped Tier 0.1 / 0.2 / 0.3 / 0.5
infrastructure plus Tier 1 (1A tags+annotations, 1B resilience, 1C progressive coaching plan,
1D sub-score badges) and **Tier 2 scoring feedback loop** (2A-2E).

The hand-edits below complete the wire-ups in larger files (22-49KB) that hit the GitHub
MCP push-stream-timeout reliably. Each is a 1-25 line change; the whole list is **~15 minutes
total** via github.dev or any local checkout.

The list is grouped by tier so you can land in any order. Tier 0.5 wire-ups (A-D) and Tier 1
wire-ups (E-G) are independent of Tier 2 wire-ups (H-K) — start with whichever is most
useful.

---

## A. Tier 0.1 — Activate PHI redaction at the RAG query boundary

**File:** `server/services/rag.ts` (~48KB)

Add after the existing `import { generateEmbedding, generateEmbeddingsBatch, isEmbeddingAvailable } from "./embeddings";`:
```ts
import { generateQueryEmbedding } from "./embeddings-rag";
```

Inside `searchRelevantChunks`, replace:
```ts
  const queryEmbedding = await generateEmbedding(queryText);
```
with:
```ts
  const queryEmbedding = await generateQueryEmbedding(queryText);
```

---

## B. Tier 0.1 — Activate PHI redaction in coaching plan generation

**File:** `server/services/coaching-engine.ts` (~22KB)

Add this import:
```ts
import { prepareCallSummariesForPrompt } from "./coaching-prompt";
```

In `generateCoachingPlan`, wrap the existing `recentCalls.slice(0, 5).map(...)` callSummaries
assignment with `prepareCallSummariesForPrompt(...)`. Pass `null` as the second argument
(coaching is non-clinical → default redact policy).

---

## C. Tier 0.2/0.3/1A/2A — Wire new tables into canonical schema sync

**File:** `server/db/schema.ts` (~49KB)

Append to the existing exports block:
```ts
export {
  performanceSnapshots,
} from "@shared/schema/snapshots";
export {
  scheduledReports,
  scheduledReportConfigs,
} from "@shared/schema/scheduled-reports";
export {
  callTags,
  annotations,
} from "@shared/schema/call-tags";
export {
  scoringCorrections,
} from "@shared/schema/scoring-corrections";
```

**RLS warning:** none of the SIX new tables (`performance_snapshots`, `scheduled_reports`,
`scheduled_report_configs`, `call_tags`, `annotations`, `scoring_corrections`) currently
have RLS policies, unlike OQ's existing 27 tenant-scoped tables. Application-level orgId
filtering in the storage modules is the only isolation today. **Recommended before
production rollout** — add `CREATE POLICY ... USING (org_id = current_setting('app.org_id'))`
patterns mirroring the existing 27 tables. See `sync-schema.ts`.

---

## D. Tier 0.3/0.5 — Wire scheduled-reports tick into server bootstrap

**File:** `server/index.ts` (~24KB)

Find the `await import("./scheduled")` block (~line 325) and add to the destructure:
```ts
        startScheduledReportsHourlyTick,
        runScheduledReportsCatchUp,
```

After `cancelWeeklyDigest = scheduleWeekly(...)`:
```ts
      const cancelReportsTick = startScheduledReportsHourlyTick();
      void runScheduledReportsCatchUp(storage);
```

In the `shutdown` function, add `cancelReportsTick();` alongside the other cancels.

---

## E. Tier 1C — Activate progressive multi-week coaching plan

**File:** `server/services/coaching-engine.ts` (~22KB)

Add import:
```ts
import { generateProgressivePlan, progressivePlanToActionPlan, type WeaknessContext } from "./coaching-progressive";
```

In `runAutomationRules`, BEFORE `await storage.createCoachingSession(orgId, sessionData);`, add the
recurring-pattern detection block from the previous version of this doc (replaces static template
with AI-generated multi-week plan when applicable).

---

## F. Tier 1D — Add sub-score badge IDs to BADGE_DEFINITIONS

**File:** `shared/schema/features.ts` (~24KB)

Add three entries to `BADGE_DEFINITIONS` (after `consistency_king` for category locality):
```ts
  {
    id: "compliance_star",
    name: "Compliance Star",
    description: "5 consecutive calls with compliance sub-score 9.0 or higher",
    icon: "shield-check",
    category: "performance",
  },
  {
    id: "empathy_champion",
    name: "Empathy Champion",
    description: "5 consecutive calls with customer experience sub-score 9.0 or higher",
    icon: "heart",
    category: "performance",
  },
  {
    id: "resolution_ace",
    name: "Resolution Ace",
    description: "5 consecutive calls with resolution sub-score 9.0 or higher",
    icon: "target",
    category: "performance",
  },
```

---

## G. Tier 1D — Wire sub-score evaluator into checkAndAwardBadges

**File:** `server/routes/gamification.ts` (~21KB)

Add import:
```ts
import { evaluateSubScoreBadges } from "../services/sub-score-badges";
```

At the END of `checkAndAwardBadges` (just before `} catch (error) {`):
```ts
    await evaluateSubScoreBadges(orgId, employeeId);
```

---

## H. Tier 2A — Capture corrections at PATCH /api/calls/:id/analysis

**File:** `server/routes/calls.ts` (~35KB)

Add import:
```ts
import { recordScoringCorrection } from "../services/scoring-feedback";
```

Find the `PATCH /api/calls/:id/analysis` handler (search for the existing analysis-edit
audit-log pattern). After the analysis update is persisted but before the response is sent,
capture the correction:

```ts
      // Tier 2A: capture this edit as a scoring correction (fire-and-forget, non-blocking)
      const newScore = parseFloat(String(req.body?.performanceScore ?? ""));
      const oldScore = parseFloat(String(existingAnalysis?.performanceScore ?? ""));
      if (
        Number.isFinite(newScore) &&
        Number.isFinite(oldScore) &&
        Math.abs(newScore - oldScore) >= 0.1 &&
        typeof req.body?.editReason === "string"
      ) {
        // Build per-sub-score deltas if the patch touched any
        const subScoreChanges: Record<string, { original: number; corrected: number }> | undefined =
          (() => {
            const oldSubs = (existingAnalysis as any)?.subScores ?? {};
            const newSubs = (req.body?.subScores as Record<string, unknown>) ?? {};
            const out: Record<string, { original: number; corrected: number }> = {};
            for (const [k, v] of Object.entries(newSubs)) {
              const o = parseFloat(String(oldSubs[k] ?? ""));
              const n = parseFloat(String(v ?? ""));
              if (Number.isFinite(o) && Number.isFinite(n) && Math.abs(o - n) >= 0.1) {
                out[k] = { original: o, corrected: n };
              }
            }
            return Object.keys(out).length > 0 ? out : undefined;
          })();

        void recordScoringCorrection({
          orgId,
          callId: req.params.id,
          correctedBy: req.user!.id,
          correctedByName: req.user!.name || req.user!.username,
          reason: req.body.editReason,
          originalScore: oldScore,
          correctedScore: newScore,
          subScoreChanges,
        });
      }
```

The capture is `void`-prefixed and fire-and-forget — the route handler doesn't await it,
so a correction-capture failure never blocks the analysis edit.

---

## I. Tier 2B — Inject correction context into Bedrock analysis prompt

**File:** `server/services/bedrock.ts` (~12KB — small enough for MCP, but documenting here for completeness)

Add import:
```ts
import { buildCorrectionContext } from "./scoring-feedback-context";
```

In `analyzeCallTranscript`, after the existing `safeTranscript` line and BEFORE
`const systemPrompt = buildSystemPrompt(...)`:

```ts
    // Tier 2B: pull recent scoring corrections for this org/category and append
    // them as an "untrusted manager notes" block to the system prompt. Empty
    // when no relevant corrections exist.
    const correctionContext = await buildCorrectionContext(/* orgId */ "", callCategory);
```

Then update the `system: [...]` array in the ConverseCommand:
```ts
        system: [
          { text: systemPrompt + (correctionContext ? "\n\n" + correctionContext : "") } as any,
          { cachePoint: { type: "default" } } as any,
        ],
```

**Note:** `analyzeCallTranscript` doesn't currently receive `orgId` as a parameter. Either
(a) thread orgId through from the call-processing service into BedrockProvider
(plumbing only — add to the method signature + every caller), OR (b) leave correction
context disabled until the next refactor — it's additive.

---

## J. Tier 2 — Wire quality + regression checks into daily scheduler

**File:** `server/scheduled/index.ts` (~5.5KB — small enough for MCP)

Will attempt this via MCP push.

Adds to the `runAllDailyTasks` orchestrator + per-task imports:
- `runScoringQualityChecks` from `./scoring-quality-tasks` (new wrapper file in this commit)
- `runScoringRegressionChecks` from same

---

## K. Tier 2E — Register scoring corrections routes

**File:** `server/routes/index.ts` (~5KB — small enough for MCP)

Will attempt this via MCP push.

Adds:
```ts
import { registerScoringCorrectionRoutes } from "./scoring-corrections";
// ...
registerScoringCorrectionRoutes(app);
```

---

## Verifying after the hand-edits

```bash
npm run check         # TypeScript — should pass
npm run test          # New test files for all tiers
npm run dev           # Local smoke test
```

Expected log lines after deploy:
- A: PHI-redacted query embeddings traced
- B: `prepareCallSummariesForPrompt` invocations
- C: `sync-schema: created scoring_corrections / ...` on first boot
- D: `scheduled-reports-tick complete` at top of each UTC hour
- E: `Progressive plan generation failed — using template fallback` (warn if Bedrock unavailable)
- F: badge gallery shows three new "performance" badges
- G: `Sub-score excellence badge awarded` after qualifying sequences
- H: `Scoring correction recorded` after each manual analysis edit
- I: Bedrock prompt includes `<<<UNTRUSTED_MANAGER_NOTES>>>` block when corrections exist
- J: `Scoring quality issues detected` (warn) and `Scoring regression detected` (warn) in daily orchestrator
- K: 5 new endpoints under `/api/scoring-corrections/*` reachable

## Recommended order

1. **K + J** first — these will be auto-attempted via MCP after this doc commits
2. **D** — activates the largest accumulated infra (scheduled reports tick)
3. **B → A** — quickest behavior wins (PHI redaction wired up)
4. **F → G** — Tier 1D goes together
5. **E** — Tier 1C, slightly more complex
6. **H** — Tier 2A capture (depends on the calls.ts handler shape; verify against
   the existing audit-trail block before pasting)
7. **C** — schema sync wiring; do last so the runtime `ensureXTable()` guards stay
   as the safety net while you verify
8. **I** — only if you've completed the `analyzeCallTranscript(orgId, ...)` plumbing
   refactor first (see the note in I above)

Total: ~15 minutes if you're familiar with the files; ~25 if not.
