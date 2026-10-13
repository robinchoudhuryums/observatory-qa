/**
 * addDedupedJob against a REAL Redis (BullMQ).
 *
 * Opt-in: skipped unless TEST_REDIS_URL is set, e.g.
 *   TEST_REDIS_URL=redis://127.0.0.1:6379 npx tsx --test tests/queue-dedup.test.ts
 *
 * BullMQ silently ignores add() for a jobId it still stores, and finished
 * jobs are retained. With a bare fixed id, per-org retention ran exactly once
 * and was dropped every day after, and a reindex of an indexed document never
 * ran. addDedupedJob clears a finished job first but still dedups in-flight work.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const REDIS_URL = process.env.TEST_REDIS_URL;
const skip = !REDIS_URL ? "TEST_REDIS_URL not set" : false;

describe("addDedupedJob (real Redis)", { skip }, () => {
  let Queue: typeof import("bullmq").Queue;
  let QueueEvents: typeof import("bullmq").QueueEvents;
  let Worker: typeof import("bullmq").Worker;
  let addDedupedJob: typeof import("../server/services/queue").addDedupedJob;
  let connection: { host: string; port: number };
  let queue: InstanceType<typeof import("bullmq").Queue>;
  let events: InstanceType<typeof import("bullmq").QueueEvents>;
  const queueName = `dedup-test-${randomUUID().slice(0, 8)}`;

  before(async () => {
    ({ Queue, QueueEvents, Worker } = await import("bullmq"));
    ({ addDedupedJob } = await import("../server/services/queue"));
    const url = new URL(REDIS_URL!);
    connection = { host: url.hostname, port: Number(url.port || 6379) };
    queue = new Queue(queueName, { connection, defaultJobOptions: { removeOnComplete: { count: 500 } } });
    events = new QueueEvents(queueName, { connection });
    await events.waitUntilReady();
  });

  after(async () => {
    await queue.obliterate({ force: true });
    await events.close();
    await queue.close();
  });

  async function runToCompletion(jobId: string) {
    const worker = new Worker(queueName, async () => "done", { connection });
    const job = await queue.getJob(jobId);
    assert.ok(job, "job should exist before processing");
    await job.waitUntilFinished(events, 5000);
    await worker.close();
  }

  it("documents the bug: a raw add() with a finished job's id is silently ignored", async () => {
    const id = `raw-${randomUUID()}`;
    await queue.add("t", { n: 1 }, { jobId: id });
    await runToCompletion(id);
    await queue.add("t", { n: 2 }, { jobId: id });
    assert.equal(await (await queue.getJob(id))!.getState(), "completed", "BullMQ kept the old job; nothing re-queued");
  });

  it("re-queues after the previous run finished", async () => {
    const id = `dedup-${randomUUID()}`;
    await addDedupedJob(queue, "t", { n: 1 }, id);
    await runToCompletion(id);
    await addDedupedJob(queue, "t", { n: 2 }, id);
    const job = await queue.getJob(id);
    assert.equal(await job!.getState(), "waiting");
    assert.deepEqual(job!.data, { n: 2 });
  });

  it("still deduplicates while a job with that id is waiting", async () => {
    const id = `inflight-${randomUUID()}`;
    await addDedupedJob(queue, "t", { n: 1 }, id);
    await addDedupedJob(queue, "t", { n: 2 }, id);
    const job = await queue.getJob(id);
    assert.equal(await job!.getState(), "waiting");
    assert.deepEqual(job!.data, { n: 1 }, "in-flight job must not be replaced");
  });
});
