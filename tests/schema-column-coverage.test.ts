/**
 * Schema column coverage — ensures sync-schema.ts DDL matches schema.ts
 * (Drizzle) at the column level, not just table level.
 *
 * Catches drift where a column is added to schema.ts but not sync-schema.ts
 * (or vice versa), which causes production 500s on INSERT/SELECT of the
 * missing column.
 *
 * Run with: npx tsx --test tests/schema-column-coverage.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

/**
 * Parse Drizzle schema.ts to extract table→columns mapping.
 * Handles: text("col"), varchar("col", ...), integer("col"), real("col"),
 *          boolean("col"), timestamp("col"), jsonb("col"), vector("col", N)
 */
function parseDrizzleSchema(code: string): Map<string, Set<string>> {
  const tables = new Map<string, Set<string>>();

  // Split by pgTable calls. Use a state machine approach for nested braces.
  const pgTableStarts = [...code.matchAll(/pgTable\(\s*"([^"]+)"/g)];

  for (const match of pgTableStarts) {
    const tableName = match[1];
    const startIdx = match.index! + match[0].length;

    // Find the column definition object: scan for balanced { }
    let braceDepth = 0;
    let inColumns = false;
    let columnsStart = -1;
    let columnsEnd = -1;

    for (let i = startIdx; i < code.length; i++) {
      if (code[i] === "{") {
        braceDepth++;
        if (braceDepth === 1 && !inColumns) {
          inColumns = true;
          columnsStart = i + 1;
        }
      } else if (code[i] === "}") {
        braceDepth--;
        if (braceDepth === 0 && inColumns) {
          columnsEnd = i;
          break;
        }
      }
    }

    if (columnsStart === -1 || columnsEnd === -1) continue;

    const columnsBlock = code.slice(columnsStart, columnsEnd);
    const columns = new Set<string>();

    // Match column DB names in type constructors
    const colRegex = /(?:text|varchar|integer|real|boolean|timestamp|jsonb)\(\s*"([^"]+)"/g;
    let colMatch;
    while ((colMatch = colRegex.exec(columnsBlock)) !== null) {
      columns.add(colMatch[1]);
    }

    // Also match vector() columns (custom type call pattern)
    const vectorRegex = /vector\(\s*"([^"]+)"/g;
    while ((colMatch = vectorRegex.exec(columnsBlock)) !== null) {
      columns.add(colMatch[1]);
    }

    if (columns.size > 0) {
      tables.set(tableName, columns);
    }
  }

  return tables;
}

/**
 * Parse sync-schema.ts to extract table→columns mapping.
 * Handles CREATE TABLE blocks and addColumnIfNotExists() calls.
 */
function parseSyncSchema(code: string): Map<string, Set<string>> {
  const tables = new Map<string, Set<string>>();

  // Parse CREATE TABLE blocks
  const createRegex = /CREATE TABLE IF NOT EXISTS (\w+)\s*\(([\s\S]*?)\n\s*\)/g;
  let tableMatch;
  while ((tableMatch = createRegex.exec(code)) !== null) {
    const tableName = tableMatch[1];
    const body = tableMatch[2];
    const columns = new Set<string>();

    for (const line of body.split("\n")) {
      const trimmed = line.trim().replace(/,$/, "");
      if (!trimmed || trimmed.startsWith("--") || trimmed.startsWith("CONSTRAINT") ||
          trimmed.startsWith("FOREIGN KEY") || trimmed.startsWith("UNIQUE") ||
          trimmed.startsWith("PRIMARY KEY") || trimmed.startsWith("CHECK")) {
        continue;
      }
      const colMatch = trimmed.match(
        /^(\w+)\s+(?:TEXT|VARCHAR|INTEGER|REAL|BOOLEAN|TIMESTAMPTZ|TIMESTAMP|JSONB|SERIAL|BIGINT|NUMERIC|vector)\b/i,
      );
      if (colMatch) {
        columns.add(colMatch[1]);
      }
    }

    tables.set(tableName, columns);
  }

  // Parse addColumnIfNotExists helper calls
  const addColRegex = /addColumnIfNotExists\(\s*db\s*,\s*"(\w+)"\s*,\s*"(\w+)"/g;
  let addMatch;
  while ((addMatch = addColRegex.exec(code)) !== null) {
    const [, tableName, colName] = addMatch;
    if (!tables.has(tableName)) tables.set(tableName, new Set());
    tables.get(tableName)!.add(colName);
  }

  // Parse raw ALTER TABLE ... ADD COLUMN IF NOT EXISTS statements
  const alterColRegex = /ALTER TABLE (\w+) ADD COLUMN IF NOT EXISTS (\w+)/g;
  let alterMatch;
  while ((alterMatch = alterColRegex.exec(code)) !== null) {
    const [, tableName, colName] = alterMatch;
    if (!tables.has(tableName)) tables.set(tableName, new Set());
    tables.get(tableName)!.add(colName);
  }

  return tables;
}

// ---------------------------------------------------------------------------
// Load and parse
// ---------------------------------------------------------------------------

const schemaCode = fs.readFileSync(path.resolve("server/db/schema.ts"), "utf8");
const syncCode = fs.readFileSync(path.resolve("server/db/sync-schema.ts"), "utf8");

const drizzle = parseDrizzleSchema(schemaCode);
const sync = parseSyncSchema(syncCode);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Schema column coverage: every Drizzle table exists in sync-schema", () => {
  const missingTables: string[] = [];
  for (const name of drizzle.keys()) {
    if (!sync.has(name)) missingTables.push(name);
  }

  it("all Drizzle tables have CREATE TABLE in sync-schema.ts", () => {
    assert.deepEqual(missingTables, [], `Missing tables: ${missingTables.join(", ")}`);
  });
});

describe("Schema column coverage: per-table column comparison", () => {
  for (const [tableName, drizzleCols] of drizzle) {
    const syncCols = sync.get(tableName);
    if (!syncCols) continue; // Table-level miss is tested above

    it(`${tableName}: all ${drizzleCols.size} Drizzle columns exist in sync-schema DDL`, () => {
      const missing = [...drizzleCols].filter((c) => !syncCols.has(c));
      assert.deepEqual(
        missing,
        [],
        `Columns in schema.ts → ${tableName} missing from sync-schema.ts: ${missing.join(", ")}`,
      );
    });
  }
});

describe("Schema column coverage: parsing sanity", () => {
  it("parsed ≥20 tables from schema.ts", () => {
    assert.ok(drizzle.size >= 20, `Got ${drizzle.size} tables`);
  });

  it("parsed ≥20 tables from sync-schema.ts", () => {
    assert.ok(sync.size >= 20, `Got ${sync.size} tables`);
  });

  it("organizations has core columns", () => {
    for (const col of ["id", "name", "slug", "status", "settings"]) {
      assert.ok(drizzle.get("organizations")?.has(col), `schema.ts missing organizations.${col}`);
      assert.ok(sync.get("organizations")?.has(col), `sync-schema.ts missing organizations.${col}`);
    }
  });

  it("calls has core columns", () => {
    for (const col of ["id", "org_id", "employee_id", "file_name", "status"]) {
      assert.ok(drizzle.get("calls")?.has(col), `schema.ts missing calls.${col}`);
      assert.ok(sync.get("calls")?.has(col), `sync-schema.ts missing calls.${col}`);
    }
  });
});
