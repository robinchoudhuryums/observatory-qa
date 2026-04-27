# Tier 0.5 — Pending Hand-Edits

This branch (`claude/adapt-callanalyzer-observatory-EZDqB`) shipped Tier 0.1 / 0.2 / 0.3
infrastructure plus the email + scheduler integrations from Tier 0.5. Three small
hand-edits in large files remain — each is a 1–2 line change but the host files
exceed the GitHub MCP push-stream-timeout threshold reliably. Easiest delivery
path is the GitHub web UI or a local clone.

Estimated total time: **~5 minutes**.

---

## A. Activate PHI redaction at the RAG query boundary

**File:** `server/services/rag.ts` (~48KB)

**1.** Add this import after the existing `import { generateEmbedding, generateEmbeddingsBatch, isEmbeddingAvailable } from "./embeddings";` line:

```ts
import { generateQueryEmbedding } from "./embeddings-rag";
```

**2.** In the `searchRelevantChunks` function body, find:

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

**2.** In the `generateCoachingPlan` function body, find this block:

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

Find the existing table definitions near the bottom (or wherever the file groups
`pgTable` exports) and add these three table imports/re-exports so that
`sync-schema.ts` discovers them:

```ts
import {
  performanceSnapshots,
} from "@shared/schema/snapshots";
import {
  scheduledReports,
  scheduledReportConfigs,
} from "@shared/schema/scheduled-reports";

// re-export so sync-schema.ts walks them as part of the canonical table list
export { performanceSnapshots, scheduledReports, scheduledReportConfigs };
```

**Why:** invariant **INV-10** in `CLAUDE.md` says "Schema changes go in both
`schema.ts` and `sync-schema.ts`". Today the three new tables are created at
runtime by `ensureSnapshotTable()` / `ensureScheduledReportTables()` in their
respective storage modules — defensive but divergent from the project's canonical
sync-schema pattern. Wiring them here lets the existing `syncSchema()` flow own
DDL, after which the `ensureXTable()` calls become defensive no-ops (safe to keep
or remove).

**Effect:** Tables will be created during `syncSchema()` startup like all other
canonical schema. Runtime CREATE-TABLE-IF-NOT-EXISTS guards remain as a safety
net (and let the workaround keep working until the canonical path is verified in
production).

---

## D. Wire scheduled-reports tick into server bootstrap

**File:** `server/index.ts` (likely large)

Add (one-time, near the existing scheduler bootstrap, AFTER DB initialization):

```ts
import {
  startScheduledReportsHourlyTick,
  runScheduledReportsCatchUp,
} from "./scheduled/scheduled-reports-tick";

// Inside the server startup function, after DB init:
void runScheduledReportsCatchUp(storage);  // fire-and-forget backfill
const stopReportsTick = startScheduledReportsHourlyTick();
// In the existing graceful-shutdown handler:
//   stopReportsTick();
```

**Effect:** the hourly tick (generation + delivery) starts firing at top-of-hour
once the server boots; missed reports for the last 12 weeks/months are backfilled
asynchronously on first boot per org.

---

## Verifying after the hand-edits

1. `npm run check` — should pass without TypeScript errors
2. `npm run test` — adapter tests in `tests/phi-prompt-redaction.test.ts` already exist
3. Look for "scheduled-reports-tick complete" in logs at the top of each UTC hour
