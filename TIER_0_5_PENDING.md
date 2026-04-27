# Pending Hand-Edits

This branch (`claude/adapt-callanalyzer-observatory-EZDqB`) shipped Tier 0.1 / 0.2 / 0.3 / 0.5
infrastructure plus Tier 1A (tags + annotations), 1B (resilience), 1C (progressive
coaching plan), and 1D (sub-score badges) — modules + tests only.

The hand-edits below complete the wire-ups in the larger files (22-49KB) that hit
the GitHub MCP push-stream-timeout reliably. Each is a 1-10 line change; the whole
list is **~10 minutes via Codespaces or any local checkout**.

The list is grouped by Tier so you can land in any order. Tier 0.5 wire-ups (A-D)
have the most behavior impact; Tier 1 wire-ups (E-G) are additive.

---

## A. Tier 0.1 — Activate PHI redaction at the RAG query boundary

**File:** `server/services/rag.ts` (~48KB)

**1.** Add this import after the existing line:
```ts
import { generateEmbedding, generateEmbeddingsBatch, isEmbeddingAvailable } from "./embeddings";
```

Add directly below it:
```ts
import { generateQueryEmbedding } from "./embeddings-rag";
```

**2.** Inside `searchRelevantChunks`, find:
```ts
  // Generate query embedding
  const queryEmbedding = await generateEmbedding(queryText);
```

Replace with:
```ts
  // Generate query embedding (PHI-redacted via embeddings-rag adapter — Tier 0.1)
  const queryEmbedding = await generateQueryEmbedding(queryText);
```

**Effect:** RAG queries get PHI-redacted before reaching Bedrock's Titan embedding
endpoint. Document indexing keeps using `generateEmbedding` directly. Adapter from
commit `2ff2cdd9`.

---

## B. Tier 0.1 — Activate PHI redaction in coaching plan generation

**File:** `server/services/coaching-engine.ts` (~22KB)

**1.** Add this import after the existing imports at the top of the file:
```ts
import { prepareCallSummariesForPrompt } from "./coaching-prompt";
```

**2.** Inside `generateCoachingPlan`, find this block:
```ts
  const callSummaries = recentCalls.slice(0, 5).map((c) => ({
    score: c.analysis?.performanceScore,
    subScores: c.analysis?.subScores,
    summary: c.analysis?.summary,
    feedback: c.analysis?.feedback,
    flags: c.analysis?.flags,
    sentiment: c.sentiment?.overallSentiment,
  }));
```

Wrap the result in the prepared helper:
```ts
  const callSummaries = prepareCallSummariesForPrompt(
    recentCalls.slice(0, 5).map((c) => ({
      score: c.analysis?.performanceScore,
      subScores: c.analysis?.subScores,
      summary: c.analysis?.summary,
      feedback: c.analysis?.feedback,
      flags: c.analysis?.flags,
      sentiment: c.sentiment?.overallSentiment,
    })),
    null,  // null = use default redact-by-policy; coaching is non-clinical
  );
```

**Effect:** PHI is deep-redacted from call summaries before they enter the Bedrock
prompt for coaching plan generation. Adapter from commit `7952aa0b`.

---

## C. Tier 0.2/0.3 — Wire new tables into canonical schema sync

**File:** `server/db/schema.ts` (~49KB)

Find the existing table definitions block near the bottom and add:

```ts
// --- Tier 0.2 / 0.3 / 1A tables (re-exported from shared/schema for sync-schema discovery) ---
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
```

If `sync-schema.ts` walks tables programmatically via Drizzle, this re-export
is sufficient. If it has hand-coded DDL, you'll also need to add CREATE TABLE
/ CREATE INDEX statements there mirroring what's in:

- `server/storage/snapshots.ts` → `ensureSnapshotTable()`
- `server/storage/scheduled-reports.ts` → `ensureScheduledReportTables()`
- `server/storage/call-tags.ts` → `ensureCallTagsTables()`

**Why:** invariant **INV-10** in `CLAUDE.md`: "Schema changes go in both
`schema.ts` and `sync-schema.ts`".

**Important — RLS:** the tenant-scoped tables in CLAUDE.md (27 of them) have
PostgreSQL Row-Level Security policies. The five new tables (`performance_snapshots`,
`scheduled_reports`, `scheduled_report_configs`, `call_tags`, `annotations`) do
NOT have RLS policies yet. Application-level `orgId` scoping in the storage modules
is the only isolation today. **Strongly recommended before production rollout** —
add `CREATE POLICY ... USING (org_id = current_setting('app.org_id'))` blocks
matching the existing 27 tables. See `sync-schema.ts` for the patterns.

---

## D. Tier 0.3/0.5 — Wire scheduled-reports tick into server bootstrap

**File:** `server/index.ts` (~24KB)

Find this block inside the `server.listen` callback (line ~325):

```ts
      // Scheduled tasks (extracted to server/scheduled/ for testability)
      const {
        runRetention,
        runTrialDowngrade,
        runQuotaAlerts,
        runWeeklyDigest,
        runAllDailyTasks,
        scheduleDaily,
        scheduleWeekly,
      } = await import("./scheduled");
```

Add the two new exports to the destructure:

```ts
      const {
        runRetention,
        runTrialDowngrade,
        runQuotaAlerts,
        runWeeklyDigest,
        runAllDailyTasks,
        scheduleDaily,
        scheduleWeekly,
        startScheduledReportsHourlyTick,
        runScheduledReportsCatchUp,
      } = await import("./scheduled");
```

Then after `cancelWeeklyDigest = scheduleWeekly(...)`:

```ts
      // Hourly scheduled-reports tick (generation + delivery) — Tier 0.5
      const cancelReportsTick = startScheduledReportsHourlyTick();
      // Boot-time catch-up of missed report periods (fire-and-forget, ~12 weeks/months)
      void runScheduledReportsCatchUp(storage);
```

In the `shutdown` function, after `cancelDailyTasks(); cancelWeeklyDigest();` add:

```ts
        cancelReportsTick();
```

**Effect:** the hourly tick (generation + delivery) starts firing at top-of-hour;
missed periods are backfilled async on first boot per org.

---

## E. Tier 1C — Activate progressive multi-week coaching plan

**File:** `server/services/coaching-engine.ts` (~22KB)

CA's pattern is to call the multi-week progressive generator when an automation
rule fires for **recurring weakness** (consistent low sub-score in one dimension).
OQ's `runAutomationRules` currently creates the session with a static action plan
from a template; the wire-up below replaces that with an AI-generated progressive
plan when available.

**1.** Add imports near the top of the file (alongside other `./` imports):
```ts
import { generateProgressivePlan, progressivePlanToActionPlan, type WeaknessContext } from "./coaching-progressive";
```

**2.** Inside `runAutomationRules`, find the block where the session is created
from the rule (after `evaluateRule` returns true):

```ts
            const sessionData = {
              orgId,
              employeeId: employee.id,
              assignedBy: "Automation",
              category: actions.sessionCategory || "general",
              title: sessionTitle,
              notes: actions.sessionNotes
                ? actions.sessionNotes.replace("{employee}", employee.name).replace("{rule}", rule.name)
                : `Auto-created by rule: ${rule.name}`,
              actionPlan: template?.actionPlan?.map((t: any) => ({ task: t.task, completed: false })) || [],
              status: "pending" as const,
              automatedTrigger: rule.triggerType,
              automationRuleId: rule.id,
              templateId: actions.templateId || null,
            } as any;
```

Right BEFORE `await storage.createCoachingSession(orgId, sessionData);`, add:

```ts
            // Tier 1C: For trend_decline / consecutive_low_score / flag_recurring,
            // attempt to generate an AI progressive plan and use it instead of the
            // static template. Falls back to the template if Bedrock is unavailable
            // or the response can't be parsed.
            const conditions = rule.conditions as any;
            const isRecurringPattern =
              rule.triggerType === "trend_decline" ||
              rule.triggerType === "consecutive_low_score" ||
              rule.triggerType === "flag_recurring";

            if (isRecurringPattern) {
              const primary: WeaknessContext = {
                dim: conditions.flagType || rule.triggerType,
                label: rule.name,
                avgScore: 0, // best-effort; fill from analyzed window if you compute it elsewhere
                count: conditions.consecutiveCount ?? 3,
              };
              try {
                const progressive = await generateProgressivePlan(orgId, employee.id, primary, {
                  totalCallsAnalyzed: 20,
                });
                if (progressive) {
                  sessionData.actionPlan = progressivePlanToActionPlan(progressive);
                  sessionData.notes = progressive.notes;
                }
              } catch (err) {
                logger.warn({ err, ruleId: rule.id, employeeId: employee.id }, "Progressive plan generation failed — using template fallback");
              }
            }
```

**Effect:** automation rules for recurring weakness produce richer multi-week
coaching plans. Non-recurring patterns (e.g. low_sentiment) keep the template
behavior unchanged. Module from commit `06484edb`.

---

## F. Tier 1D — Add sub-score badge IDs to BADGE_DEFINITIONS

**File:** `shared/schema/features.ts` (~24KB)

Find the `BADGE_DEFINITIONS` array (search for `compliance_star` returning no hits
confirms the addition is needed). Add three entries:

```ts
  {
    id: "compliance_star",
    name: "Compliance Star",
    description: "5 consecutive calls with compliance sub-score 9.0 or higher",
    category: "performance",
    icon: "shield-check",
  },
  {
    id: "empathy_champion",
    name: "Empathy Champion",
    description: "5 consecutive calls with customer experience sub-score 9.0 or higher",
    category: "performance",
    icon: "heart",
  },
  {
    id: "resolution_ace",
    name: "Resolution Ace",
    description: "5 consecutive calls with resolution sub-score 9.0 or higher",
    category: "performance",
    icon: "target",
  },
```

If `BadgeId` is a union literal type, also add the three IDs to that union so
the route's `as never` cast in `server/services/sub-score-badges.ts` becomes
unnecessary (you can then drop the cast — it's safe to leave too).

**Effect:** UI components that render `BADGE_DEFINITIONS` (badge gallery,
employee profile) will surface the three new badges with names + descriptions.

---

## G. Tier 1D — Wire sub-score evaluator into checkAndAwardBadges

**File:** `server/routes/gamification.ts` (~21KB)

**1.** Add this import alongside the existing imports at the top of the file:
```ts
import { evaluateSubScoreBadges } from "../services/sub-score-badges";
```

**2.** At the END of the `checkAndAwardBadges` function (just before the closing
`} catch (error) {`), add:

```ts
    // Tier 1D: sub-score excellence badges (compliance_star, empathy_champion, resolution_ace)
    await evaluateSubScoreBadges(orgId, employeeId);
```

**Effect:** sub-score excellence badges are evaluated alongside the existing
badge checks after every call processed. Idempotent — already-held badges are
skipped. Non-throwing — failures are logged but don't fail the parent function.
Module from commit `0bb80a22`.

---

## Verifying after the hand-edits

```bash
npm run check         # TypeScript — should pass
npm run test          # New test files: phi-prompt-redaction, call-tags, resilience,
                      # coaching-progressive, sub-score-badges
npm run dev           # Local smoke test
```

Expected log lines after deploy:
- A: `"PHI-redacted query embedding"` traces in the RAG path
- B: `"prepareCallSummariesForPrompt"` invocations
- C: `"sync-schema: created performance_snapshots / scheduled_reports / ..."` on first boot
- D: `"scheduled-reports-tick complete"` at the top of each UTC hour
- E: `"Progressive plan generation failed — using template fallback"` (warning if Bedrock unavailable)
- F: badge gallery shows three new "performance" category badges
- G: `"Sub-score excellence badge awarded"` info logs after qualifying call sequences

## Recommended order

1. **D** first — activates the largest accumulated infra (scheduled reports tick)
2. **B → A** — quickest behavior wins (PHI redaction wired up)
3. **F → G** — Tier 1D goes together
4. **E** — Tier 1C, slightly more complex
5. **C** — schema sync wiring; do last so the runtime `ensureXTable()` guards
   stay as the safety net while you verify

Total: ~10 minutes if you're familiar with the files; ~20 if not.
