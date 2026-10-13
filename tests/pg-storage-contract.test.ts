/**
 * PostgresStorage contract tests — run against a REAL PostgreSQL database.
 *
 * Opt-in: skipped unless TEST_DATABASE_URL points at a disposable database
 * (pgvector installed; the tables are created by syncSchema on startup). E.g.
 *   TEST_DATABASE_URL=postgres://obs:obs@127.0.0.1:5432/obs_test npx tsx --test tests/pg-storage-contract.test.ts
 *
 * Why this exists: every other storage test runs on MemStorage, whose Maps
 * overwrite by key and have no foreign keys. Several Postgres-only failures
 * hid behind that — createCallAnalysis threw 23505 on every second write,
 * GDPR purge referenced a nonexistent table, and call deletes/retention
 * failed on unconstrained foreign keys — while tests such as
 * clinical-amendments.test.ts (which writes the same call's analysis several
 * times) passed. These tests pin the contract those MemStorage tests assume.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const TEST_DB = process.env.TEST_DATABASE_URL;
const skip = !TEST_DB ? "TEST_DATABASE_URL not set" : false;

describe("PostgresStorage contract (real PostgreSQL)", { skip }, () => {
  let storage: typeof import("../server/storage/index").storage;
  let db: NonNullable<ReturnType<typeof import("../server/db/index").getDatabase>>;
  let sql: typeof import("drizzle-orm").sql;
  let orgId: string;
  let employeeId: string;

  before(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.STORAGE_BACKEND = "postgres";
    const storageMod = await import("../server/storage/index");
    assert.equal(await storageMod.initPostgresStorage(), true, "PostgresStorage failed to initialize");
    storage = storageMod.storage;
    const dbMod = await import("../server/db/index");
    db = dbMod.getDatabase()!;
    ({ sql } = await import("drizzle-orm"));

    const slug = `pgc-${randomUUID().slice(0, 8)}`;
    const org = await storage.createOrganization({ name: "PG contract", slug, status: "active" } as never);
    orgId = org.id;
    const emp = await storage.createEmployee(orgId, {
      orgId,
      name: "Contract Agent",
      email: `${slug}@example.test`,
    } as never);
    employeeId = emp.id;
  });

  after(async () => {
    const { closeDatabase } = await import("../server/db/index");
    await closeDatabase();
  });

  async function newCall(): Promise<string> {
    const call = await storage.createCall(orgId, { orgId, fileName: "contract.wav", status: "completed" } as never);
    return call.id;
  }

  it("createCallAnalysis upserts by callId (second write replaces, keeps id)", async () => {
    const callId = await newCall();
    const first = await storage.createCallAnalysis(orgId, {
      orgId,
      callId,
      performanceScore: "6.0",
      summary: "first",
    } as never);
    const second = await storage.createCallAnalysis(orgId, {
      orgId,
      callId,
      performanceScore: "8.5",
      summary: "second",
    } as never);
    assert.equal(second.id, first.id, "upsert should keep the original row id");
    const stored = await storage.getCallAnalysis(orgId, callId);
    assert.equal(Number(stored?.performanceScore), 8.5);
    assert.equal(stored?.summary, "second");
  });

  it("createTranscript and createSentimentAnalysis upsert by callId", async () => {
    const callId = await newCall();
    await storage.createTranscript(orgId, { orgId, callId, text: "hello there one", confidence: "0.9" } as never);
    await storage.createTranscript(orgId, { orgId, callId, text: "hello there two", confidence: "0.8" } as never);
    assert.equal((await storage.getTranscript(orgId, callId))?.text, "hello there two");

    await storage.createSentimentAnalysis(orgId, {
      orgId,
      callId,
      overallSentiment: "neutral",
      overallScore: "0.5",
    } as never);
    await storage.createSentimentAnalysis(orgId, {
      orgId,
      callId,
      overallSentiment: "positive",
      overallScore: "0.9",
    } as never);
    assert.equal((await storage.getSentimentAnalysis(orgId, callId))?.overallSentiment, "positive");
  });

  it("an upsert never overwrites another org's row", async () => {
    const callId = await newCall();
    await storage.createCallAnalysis(orgId, { orgId, callId, performanceScore: "7.0" } as never);
    const other = await storage.createOrganization({
      name: "Other",
      slug: `pgc-other-${randomUUID().slice(0, 8)}`,
      status: "active",
    } as never);
    await assert.rejects(
      storage.createCallAnalysis(other.id, { orgId: other.id, callId, performanceScore: "1.0" } as never),
      /different organization/,
    );
    assert.equal(Number((await storage.getCallAnalysis(orgId, callId))?.performanceScore), 7);
  });

  it("deleteCall succeeds when coaching, revenue and calibration rows reference the call", async () => {
    const callId = await newCall();
    const coaching = await storage.createCoachingSession(orgId, {
      orgId,
      employeeId,
      callId,
      assignedBy: "contract-test",
      title: "Coach on this call",
    } as never);
    await storage.createCallRevenue(orgId, { orgId, callId } as never);
    const calibration = await storage.createCalibrationSession(orgId, {
      orgId,
      title: "Calibrate",
      callId,
      facilitatorId: "u1",
      evaluatorIds: ["u1", "u2"],
    } as never);

    await storage.deleteCall(orgId, callId);

    assert.equal(await storage.getCall(orgId, callId), undefined);
    const keptCoaching = await storage.getCoachingSession(orgId, coaching.id);
    assert.ok(keptCoaching, "coaching session should survive the call delete (SET NULL)");
    assert.equal(keptCoaching?.callId ?? null, null);
    assert.equal(await storage.getCallRevenue(orgId, callId), undefined, "revenue row cascades with the call");
    assert.equal(await storage.getCalibrationSession(orgId, calibration.id), undefined, "calibration cascades");
  });

  it("purgeExpiredCalls purges an old call that a coaching session references", async () => {
    const callId = await newCall();
    await storage.createCoachingSession(orgId, {
      orgId,
      employeeId,
      callId,
      assignedBy: "contract-test",
      title: "Old coaching",
    } as never);
    await db.execute(sql`UPDATE calls SET uploaded_at = NOW() - INTERVAL '400 days' WHERE id = ${callId}`);
    const purged = await storage.purgeExpiredCalls(orgId, 90);
    assert.ok(purged >= 1, `expected the expired call to be purged, got ${purged}`);
    assert.equal(await storage.getCall(orgId, callId), undefined);
  });

  it("syncSchema upgrades a legacy NO ACTION call_id foreign key in place", async () => {
    // Recreate the pre-fix constraint shape, then re-run sync.
    const rows = (
      await db.execute(sql`
        SELECT con.conname FROM pg_constraint con
        WHERE con.contype = 'f' AND con.conrelid = 'coaching_sessions'::regclass
          AND con.confrelid = 'calls'::regclass`)
    ).rows as Array<{ conname: string }>;
    for (const r of rows) {
      await db.execute(sql.raw(`ALTER TABLE coaching_sessions DROP CONSTRAINT "${r.conname}"`));
    }
    await db.execute(
      sql.raw(`ALTER TABLE coaching_sessions ADD CONSTRAINT coaching_sessions_call_id_fkey
               FOREIGN KEY (call_id) REFERENCES calls(id)`),
    );

    const { syncSchema } = await import("../server/db/sync-schema");
    await syncSchema(db);

    const after = (
      await db.execute(sql`
        SELECT con.confdeltype::text AS action FROM pg_constraint con
        WHERE con.contype = 'f' AND con.conrelid = 'coaching_sessions'::regclass
          AND con.confrelid = 'calls'::regclass`)
    ).rows as Array<{ action: string }>;
    assert.deepEqual(
      after.map((r) => r.action),
      ["n"],
      "expected exactly one call_id FK with ON DELETE SET NULL",
    );
  });

  it("deleteOrgData (GDPR purge) completes and removes the org's calls", async () => {
    const purgeOrg = await storage.createOrganization({
      name: "Purge me",
      slug: `pgc-purge-${randomUUID().slice(0, 8)}`,
      status: "active",
    } as never);
    const call = await storage.createCall(purgeOrg.id, {
      orgId: purgeOrg.id,
      fileName: "p.wav",
      status: "completed",
    } as never);
    await storage.createCallAnalysis(purgeOrg.id, { orgId: purgeOrg.id, callId: call.id } as never);

    const result = await storage.deleteOrgData(purgeOrg.id);
    assert.ok(result.callsDeleted >= 1);
    assert.equal(await storage.getCall(purgeOrg.id, call.id), undefined);
  });
});
