# Tier 0.5 — Pending Hand-Edits

This branch (`claude/adapt-callanalyzer-observatory-EZDqB`) shipped Tier 0.1 / 0.2 / 0.3
infrastructure plus the email + scheduler integrations from Tier 0.5. Four small
hand-edits in large files (22-49KB) remain — each is a 1–5 line change but the
host files exceed the GitHub MCP push-stream-timeout threshold reliably. Easiest
delivery path is the GitHub web UI or a local clone.

Estimated total time: **~5 minutes**.

---

## A. Activate PHI redaction at the RAG query boundary

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

**Effect:** RAG queries will be PHI-redacted before reaching Bedrock's Titan embedding
endpoint. Document indexing (`indexDocument`) keeps using `generateEmbedding` directly —
verbatim text is required for retrieval to work. Adapter from commit `2ff2cdd9`.

---

## B. Activate PHI redaction in coaching plan generation

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

## C. Wire new tables into canonical schema sync

**File:** `server/db/schema.ts` (~49KB)

Find the existing table definitions block near the bottom and add:

```ts
// --- Tier 0.2 / 0.3 tables (re-exported from shared/schema for sync-schema discovery) ---
export {
  performanceSnapshots,
} from "@shared/schema/snapshots";
export {
  scheduledReports,
  scheduledReportConfigs,
} from "@shared/schema/scheduled-reports";
```

If `sync-schema.ts` (71KB) walks tables programmatically via Drizzle, this re-export
is sufficient. If `sync-schema.ts` has hand-coded DDL per table, you'll also need to
add CREATE TABLE / CREATE INDEX statements there mirroring what's in
`server/storage/snapshots.ts` (`ensureSnapshotTable`) and
`server/storage/scheduled-reports.ts` (`ensureScheduledReportTables`). Both runtime
guards remain as a defensive safety net regardless.

**Why:** invariant **INV-10** in `CLAUDE.md`: "Schema changes go in both
`schema.ts` and `sync-schema.ts`". Today the three new tables are created at
runtime by `ensureSnapshotTable()` / `ensureScheduledReportTables()` — defensive but
divergent from the project's canonical sync-schema pattern.

**Important — RLS:** the tenant-scoped tables documented in the README and CLAUDE.md
(27 of them) have **PostgreSQL Row-Level Security** policies. The three new tables
do NOT have RLS policies wired. Application-level `orgId` scoping in the storage
modules is the only isolation today. Adding `CREATE POLICY ... USING (org_id = current_setting('app.org_id'))`
patterns matching the existing 27 tables is **strongly recommended before production
rollout** — the data-access modules already filter by `orgId`, but RLS is the
canonical defense-in-depth layer per the project's HIPAA posture. See the existing
`syncSchema` RLS policy block in `sync-schema.ts` for the patterns to mirror.

---

## D. Wire scheduled-reports tick into server bootstrap

**File:** `server/index.ts` (~24KB)

Find this block inside the `server.listen` callback (line ~325 in the current file):

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

Then immediately after the existing `cancelWeeklyDigest = scheduleWeekly(...)` line:

```ts
      const cancelWeeklyDigest = scheduleWeekly(1, 8, () => runWeeklyDigest(storage), "weekly-digest");
```

Add:

```ts
      // Hourly scheduled-reports tick (generation + delivery) — Tier 0.5
      const cancelReportsTick = startScheduledReportsHourlyTick();
      // Boot-time catch-up of missed report periods (fire-and-forget, ~12 weeks/months bound)
      void runScheduledReportsCatchUp(storage);
```

Then in the existing `shutdown` function, find:

```ts
        cancelDailyTasks();
        cancelWeeklyDigest();
```

Add:

```ts
        cancelReportsTick();
```

**Effect:** the hourly tick (generation + delivery) starts firing at top-of-hour
once the server boots; missed reports for the last 12 weeks/months are backfilled
asynchronously on first boot per org.

---

## Verifying after the hand-edits

1. `npm run check` — should pass without TypeScript errors
2. `npm run test` — adapter tests in `tests/phi-prompt-redaction.test.ts` already exist
3. Look for `"scheduled-reports-tick complete"` in logs at the top of each UTC hour
4. Confirm the three new tables exist post-deploy: `\d performance_snapshots scheduled_reports scheduled_report_configs`
