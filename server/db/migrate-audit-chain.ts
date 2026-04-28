/**
 * One-time migration: Recompute audit log hash chain using stored createdAt timestamps.
 *
 * Background: Before the F37 fix, `persistAuditEntry()` computed integrity hashes using
 * `entry.timestamp` (JS application time) but stored `createdAt` via PostgreSQL `defaultNow()`.
 * The `verifyAuditChain()` function uses `row.createdAt.toISOString()` to recompute hashes,
 * which produces mismatches for pre-F37 entries.
 *
 * This migration walks each org's audit chain in sequence order and recomputes hashes using
 * the actual `createdAt` value from the database, making the chain self-consistent.
 *
 * Usage:
 *   npx tsx server/db/migrate-audit-chain.ts
 *
 * Requires: DATABASE_URL environment variable
 * Safe to run multiple times (idempotent — recomputes from createdAt every time).
 */
import { createHash } from "crypto";
import pg from "pg";

function computeIntegrityHash(
  prevHash: string,
  entry: {
    orgId: string;
    event: string;
    userId?: string;
    username?: string;
    resourceType: string;
    resourceId?: string;
    detail?: string;
    timestamp: string;
    sequenceNum: number;
  },
): string {
  const payload = JSON.stringify({
    prevHash,
    orgId: entry.orgId,
    event: entry.event,
    userId: entry.userId || "",
    username: entry.username || "",
    resourceType: entry.resourceType,
    resourceId: entry.resourceId || "",
    detail: entry.detail || "",
    timestamp: entry.timestamp,
    sequenceNum: entry.sequenceNum,
  });
  return createHash("sha256").update(payload).digest("hex");
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    // Get all distinct org IDs with audit entries
    const orgsResult = await client.query(
      "SELECT DISTINCT org_id FROM audit_logs WHERE sequence_num IS NOT NULL ORDER BY org_id",
    );
    const orgIds = orgsResult.rows.map((r) => r.org_id);
    console.log(`Found ${orgIds.length} organizations with audit chains`);

    let totalFixed = 0;
    let totalCorrect = 0;

    for (const orgId of orgIds) {
      // Fetch all entries for this org in sequence order
      const entriesResult = await client.query(
        `SELECT id, org_id, event, user_id, username, resource_type, resource_id, detail,
                integrity_hash, prev_hash, sequence_num, created_at
         FROM audit_logs
         WHERE org_id = $1 AND sequence_num IS NOT NULL
         ORDER BY sequence_num ASC`,
        [orgId],
      );

      let prevHash = "genesis";
      let fixedCount = 0;

      for (const row of entriesResult.rows) {
        const timestamp = row.created_at ? new Date(row.created_at).toISOString() : "";

        const expectedHash = computeIntegrityHash(prevHash, {
          orgId: row.org_id,
          event: row.event,
          userId: row.user_id || undefined,
          username: row.username || undefined,
          resourceType: row.resource_type,
          resourceId: row.resource_id || undefined,
          detail: row.detail || undefined,
          timestamp,
          sequenceNum: row.sequence_num,
        });

        if (row.integrity_hash !== expectedHash || row.prev_hash !== prevHash) {
          // Update both integrity_hash and prev_hash to make chain consistent
          await client.query(`UPDATE audit_logs SET integrity_hash = $1, prev_hash = $2 WHERE id = $3`, [
            expectedHash,
            prevHash,
            row.id,
          ]);
          fixedCount++;
        }

        prevHash = expectedHash;
      }

      if (fixedCount > 0) {
        console.log(`  [${orgId}] Fixed ${fixedCount} of ${entriesResult.rows.length} entries`);
        totalFixed += fixedCount;
      } else {
        totalCorrect++;
      }
    }

    console.log(`\nMigration complete:`);
    console.log(`  Organizations processed: ${orgIds.length}`);
    console.log(`  Orgs already correct: ${totalCorrect}`);
    console.log(`  Total entries fixed: ${totalFixed}`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
