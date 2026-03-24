/**
 * sync-schema DDL idempotency tests.
 *
 * Verifies that every SQL statement in syncSchema() uses idempotent DDL:
 *   - CREATE TABLE IF NOT EXISTS (never bare CREATE TABLE)
 *   - CREATE [UNIQUE] INDEX IF NOT EXISTS (never bare CREATE INDEX)
 *   - DROP INDEX IF EXISTS (never bare DROP INDEX)
 *   - addColumnIfNotExists wrapper is used for new columns
 *
 * Also validates sync-schema runtime behaviour with a mock DB:
 *   - Running syncSchema twice does not error
 *   - When Drizzle migrations are detected, DDL is skipped
 *   - pgvector unavailability is handled gracefully (warn, not throw)
 *
 * Run with: npx tsx --test tests/sync-schema.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load the sync-schema source as text for static SQL analysis
const syncSchemaSource = readFileSync(
  join(__dirname, "../server/db/sync-schema.ts"),
  "utf-8"
);

// ---------------------------------------------------------------------------
// Static SQL analysis — verify idempotent DDL patterns
// ---------------------------------------------------------------------------

describe("sync-schema static DDL analysis", () => {
  it("all CREATE TABLE statements use IF NOT EXISTS", () => {
    // Match bare CREATE TABLE (without IF NOT EXISTS)
    const bareCreateTable = /CREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS)\w/gi;
    const matches = syncSchemaSource.match(bareCreateTable);
    assert.equal(
      matches,
      null,
      `Found non-idempotent CREATE TABLE: ${matches?.join(", ")}`
    );
  });

  it("all CREATE INDEX statements use IF NOT EXISTS", () => {
    // Match CREATE INDEX or CREATE UNIQUE INDEX without IF NOT EXISTS
    const bareCreateIndex = /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?!IF\s+NOT\s+EXISTS)\w/gi;
    const matches = syncSchemaSource.match(bareCreateIndex);
    assert.equal(
      matches,
      null,
      `Found non-idempotent CREATE INDEX: ${matches?.join(", ")}`
    );
  });

  it("all DROP INDEX statements use IF EXISTS", () => {
    // Match bare DROP INDEX (without IF EXISTS)
    const bareDropIndex = /DROP\s+INDEX\s+(?!IF\s+EXISTS)\w/gi;
    const matches = syncSchemaSource.match(bareDropIndex);
    assert.equal(
      matches,
      null,
      `Found non-idempotent DROP INDEX: ${matches?.join(", ")}`
    );
  });

  it("new column additions use addColumnIfNotExists helper", () => {
    // All ALTER TABLE ... ADD COLUMN should go through addColumnIfNotExists
    // (which wraps in ADD COLUMN IF NOT EXISTS)
    const directAddColumn = /ALTER\s+TABLE\s+\w+\s+ADD\s+COLUMN\s+(?!IF)/gi;
    const matches = syncSchemaSource.match(directAddColumn);
    assert.equal(
      matches,
      null,
      `Found direct ADD COLUMN without IF NOT EXISTS: ${matches?.join(", ")}`
    );
  });

  it("addColumnIfNotExists is defined and wraps ADD COLUMN IF NOT EXISTS", () => {
    assert.ok(
      syncSchemaSource.includes("ADD COLUMN IF NOT EXISTS"),
      "addColumnIfNotExists must emit ADD COLUMN IF NOT EXISTS"
    );
    assert.ok(
      syncSchemaSource.includes("addColumnIfNotExists"),
      "sync-schema must define addColumnIfNotExists helper"
    );
  });

  it("CREATE EXTENSION uses IF NOT EXISTS for pgvector", () => {
    // pgvector extension install must be idempotent
    assert.ok(
      syncSchemaSource.includes("CREATE EXTENSION IF NOT EXISTS vector"),
      "pgvector must use IF NOT EXISTS"
    );
  });
});

// ---------------------------------------------------------------------------
// Table coverage — all expected tables are present
// ---------------------------------------------------------------------------

describe("sync-schema table coverage", () => {
  const REQUIRED_TABLES = [
    "organizations",
    "users",
    "employees",
    "calls",
    "transcripts",
    "sentiment_analyses",
    "call_analyses",
    "coaching_sessions",
    "prompt_templates",
    "invitations",
    "api_keys",
    "subscriptions",
    "reference_documents",
    "document_chunks",
    "audit_logs",
    "access_requests",
    "password_reset_tokens",
    "ab_tests",
    "usage_records",
    "feedbacks",
  ];

  for (const table of REQUIRED_TABLES) {
    it(`creates table: ${table}`, () => {
      assert.ok(
        syncSchemaSource.includes(`CREATE TABLE IF NOT EXISTS ${table}`),
        `Table "${table}" must be created with IF NOT EXISTS`
      );
    });
  }
});

// ---------------------------------------------------------------------------
// Mock DB — runtime behaviour
// ---------------------------------------------------------------------------

/**
 * Creates a minimal mock for the Drizzle DB object.
 * Records all SQL strings executed and allows injecting failures.
 */
function createMockDb(options: {
  hasMigrations?: boolean;
  pgvectorFails?: boolean;
  failOnTable?: string;
} = {}) {
  const executedSql: string[] = [];
  let callCount = 0;

  return {
    executedSql,
    db: {
      execute: async (sqlObj: { queryChunks?: Array<{ value: unknown }> }) => {
        callCount++;

        // Extract SQL string from Drizzle sql template tag
        const sqlStr = sqlObj.queryChunks
          ? sqlObj.queryChunks.map(c => String(c.value ?? "")).join("").trim()
          : "";
        executedSql.push(sqlStr);

        // Simulate migration table check
        if (sqlStr.includes("drizzle") && sqlStr.includes("__drizzle_migrations")) {
          return { rows: [{ has_migrations: options.hasMigrations ?? false }] };
        }

        // Simulate pgvector unavailability
        if (sqlStr.includes("CREATE EXTENSION") && options.pgvectorFails) {
          throw new Error("Extension 'vector' not available");
        }

        // Simulate specific table creation failure
        if (options.failOnTable && sqlStr.includes(options.failOnTable)) {
          throw new Error(`Simulated failure on table: ${options.failOnTable}`);
        }

        return { rows: [] };
      },
    },
  };
}

describe("sync-schema runtime — mock DB", () => {
  it("runs without error on clean database (no existing tables)", async () => {
    const { syncSchema } = await import(
      `../server/db/sync-schema.js?t=${Date.now()}`
    );
    const { db } = createMockDb({ hasMigrations: false });

    let threw = false;
    try {
      await syncSchema(db as any);
    } catch {
      threw = true;
    }
    assert.equal(threw, false, "syncSchema must not throw on clean database");
  });

  it("skips DDL when Drizzle migrations are detected", async () => {
    const { syncSchema } = await import(
      `../server/db/sync-schema.js?t=${Date.now()}`
    );
    const { db, executedSql } = createMockDb({ hasMigrations: true });

    await syncSchema(db as any);

    // After detecting migrations, only the check query and the hasMigrations query
    // should have been issued — no CREATE TABLE statements
    const createTableCalls = executedSql.filter(sql =>
      sql.toUpperCase().includes("CREATE TABLE")
    );
    assert.equal(
      createTableCalls.length, 0,
      "No CREATE TABLE should be issued when Drizzle migrations exist"
    );
  });

  it("handles pgvector extension failure gracefully (warn, not throw)", async () => {
    const { syncSchema } = await import(
      `../server/db/sync-schema.js?t=${Date.now()}`
    );
    const { db } = createMockDb({ hasMigrations: false, pgvectorFails: true });

    let threw = false;
    try {
      await syncSchema(db as any);
    } catch {
      threw = true;
    }
    assert.equal(threw, false, "pgvector failure must not crash syncSchema");
  });

  it("is callable twice without error (true idempotency under mock)", async () => {
    const { syncSchema } = await import(
      `../server/db/sync-schema.js?t=${Date.now()}`
    );
    const { db } = createMockDb({ hasMigrations: false });

    let threw = false;
    try {
      await syncSchema(db as any);
      await syncSchema(db as any); // second run
    } catch {
      threw = true;
    }
    assert.equal(threw, false, "Running syncSchema twice must not throw");
  });
});

// ---------------------------------------------------------------------------
// addColumnIfNotExists — SQL correctness
// ---------------------------------------------------------------------------

describe("addColumnIfNotExists SQL helper", () => {
  it("wraps ADD COLUMN in IF NOT EXISTS", () => {
    // Verify the helper template from the source includes correct SQL
    assert.ok(
      syncSchemaSource.includes("ADD COLUMN IF NOT EXISTS"),
      "Helper must emit ADD COLUMN IF NOT EXISTS"
    );
  });

  it("helper is called for all post-create column migrations", () => {
    // Count calls to addColumnIfNotExists — should be at least 5 (known migrations)
    const callMatches = syncSchemaSource.match(/addColumnIfNotExists\s*\(/g);
    assert.ok(
      callMatches && callMatches.length >= 5,
      `Expected ≥5 addColumnIfNotExists calls, found ${callMatches?.length ?? 0}`
    );
  });

  it("helper receives table name, column name, and type definition", () => {
    // Example: addColumnIfNotExists(db, "users", "mfa_enabled", "BOOLEAN NOT NULL DEFAULT false")
    assert.ok(
      syncSchemaSource.includes(`addColumnIfNotExists(db, "users", "mfa_enabled"`),
      "users.mfa_enabled migration must use addColumnIfNotExists"
    );
    assert.ok(
      syncSchemaSource.includes(`addColumnIfNotExists(db, "users", "is_active"`),
      "users.is_active migration must use addColumnIfNotExists"
    );
  });
});
