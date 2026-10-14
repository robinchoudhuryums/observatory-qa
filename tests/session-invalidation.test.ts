/**
 * invalidateUserSessions against a REAL Redis session store (F37).
 *
 * Opt-in: skipped unless TEST_REDIS_URL is set, e.g.
 *   TEST_REDIS_URL=redis://127.0.0.1:6379 npx tsx --test tests/session-invalidation.test.ts
 *
 * connect-redis stores sessions under "observatory:sess:", but the revocation
 * scan matched "sess:*", so a password reset or admin password change evicted
 * nothing and every existing session stayed valid.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const REDIS_URL = process.env.TEST_REDIS_URL;
const skip = !REDIS_URL ? "TEST_REDIS_URL not set" : false;

describe("invalidateUserSessions (real Redis)", { skip }, () => {
  let redisMod: typeof import("../server/services/redis");
  const userId = `user-${randomUUID()}`;
  const otherUserId = `user-${randomUUID()}`;
  let keys: string[] = [];

  before(async () => {
    process.env.REDIS_URL = REDIS_URL;
    redisMod = await import("../server/services/redis");
    const client = redisMod.initRedis()!;
    for (let i = 0; i < 20 && client.status !== "ready"; i++) await new Promise((r) => setTimeout(r, 100));
    const prefix = redisMod.SESSION_KEY_PREFIX;
    keys = [`${prefix}${randomUUID()}`, `${prefix}${randomUUID()}`, `${prefix}${randomUUID()}`];
    await client.set(keys[0], JSON.stringify({ cookie: {}, passport: { user: userId } }));
    await client.set(keys[1], JSON.stringify({ cookie: {}, passport: { user: userId } }));
    await client.set(keys[2], JSON.stringify({ cookie: {}, passport: { user: otherUserId } }));
  });

  after(async () => {
    const client = redisMod.getRedis();
    if (client) {
      await client.del(...keys);
      client.disconnect();
    }
  });

  it("deletes every session of the user and only that user's", async () => {
    const deleted = await redisMod.invalidateUserSessions(userId);
    assert.equal(deleted, 2);
    const client = redisMod.getRedis()!;
    assert.equal(await client.exists(keys[0], keys[1]), 0);
    assert.equal(await client.exists(keys[2]), 1, "other users' sessions are untouched");
  });
});
