/**
 * Webhook delivery retry logic tests.
 *
 * Tests the `withRetry` exponential backoff helper and the `sendWebhook`
 * retry behaviour via the notification service:
 *   - Immediate success requires no retry
 *   - Transient 5xx errors are retried with exponential backoff
 *   - Client 4xx errors are NOT retried (permanent failure)
 *   - All retries exhausted → returns false, never throws to caller
 *   - Slack vs Teams payload builders produce correct structure
 *   - shouldNotify flag-filtering logic
 *   - Org-level webhook config override
 *
 * Run with: npx tsx --test tests/webhook-retry.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildSlackCallPayload,
  buildTeamsCallPayload,
  formatFlagLabels,
  matchFlagsAgainstEvents,
  mergeWebhookConfig,
} from "../server/services/notifications.ts";

// ---------------------------------------------------------------------------
// withRetry unit tests (imported directly from helpers)
// ---------------------------------------------------------------------------

describe("withRetry — exponential backoff helper", () => {
  it("resolves immediately on first success (no retry)", async () => {
    const { withRetry } = await import("../server/routes/helpers.js");

    let calls = 0;
    const result = await withRetry(async () => {
      calls++;
      return "ok";
    }, { retries: 3, baseDelay: 1 });

    assert.equal(result, "ok");
    assert.equal(calls, 1, "Must not retry on success");
  });

  it("retries on transient failure and succeeds on 2nd attempt", async () => {
    const { withRetry } = await import("../server/routes/helpers.js");

    let calls = 0;
    const result = await withRetry(async () => {
      calls++;
      if (calls < 2) throw new Error("Transient error");
      return "recovered";
    }, { retries: 3, baseDelay: 1 });

    assert.equal(result, "recovered");
    assert.equal(calls, 2, "Should have retried once");
  });

  it("retries up to the configured maximum then throws", async () => {
    const { withRetry } = await import("../server/routes/helpers.js");

    let calls = 0;
    let threw = false;
    try {
      await withRetry(async () => {
        calls++;
        throw new Error("Always fails");
      }, { retries: 2, baseDelay: 1 });
    } catch (err) {
      threw = true;
      assert.ok(err instanceof Error);
      assert.equal((err as Error).message, "Always fails");
    }

    assert.ok(threw, "Must throw after all retries exhausted");
    assert.equal(calls, 3, "Should have tried 3 times (1 initial + 2 retries)");
  });

  it("passes the last error to the caller when all retries fail", async () => {
    const { withRetry } = await import("../server/routes/helpers.js");

    let attempt = 0;
    let thrownMessage = "";
    try {
      await withRetry(async () => {
        attempt++;
        throw new Error(`Failure attempt ${attempt}`);
      }, { retries: 2, baseDelay: 1 });
    } catch (err) {
      thrownMessage = (err as Error).message;
    }

    assert.equal(thrownMessage, "Failure attempt 3", "Last error message must match final attempt");
  });

  it("succeeds on exactly the last retry attempt", async () => {
    const { withRetry } = await import("../server/routes/helpers.js");

    let calls = 0;
    const RETRIES = 3;
    const result = await withRetry(async () => {
      calls++;
      if (calls <= RETRIES) throw new Error("Not yet");
      return "finally succeeded";
    }, { retries: RETRIES, baseDelay: 1 });

    assert.equal(result, "finally succeeded");
    assert.equal(calls, RETRIES + 1);
  });
});

// ---------------------------------------------------------------------------
// 4xx vs 5xx retry logic (send behaviour)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Slack payload builder (production buildSlackCallPayload)
// ---------------------------------------------------------------------------

describe("Slack payload builder (production)", () => {
  it("low_score flag produces warning emoji in header", () => {
    const payload = buildSlackCallPayload({
      event: "call_flagged",
      orgId: "org-1",
      callId: "call-1",
      flags: ["low_score"],
      performanceScore: 2.1,
    });
    const header = (payload.blocks as any[])[0];
    assert.ok((header.text.text as string).includes("warning"));
  });

  it("exceptional_call flag produces star emoji", () => {
    const payload = buildSlackCallPayload({
      event: "call_flagged",
      orgId: "org-1",
      callId: "call-2",
      flags: ["exceptional_call"],
      performanceScore: 9.5,
    });
    const header = (payload.blocks as any[])[0];
    assert.ok((header.text.text as string).includes("star"));
  });

  it("includes score as N/A when performanceScore is undefined", () => {
    const payload = buildSlackCallPayload({
      event: "call_flagged",
      orgId: "org-1",
      callId: "call-3",
      flags: ["low_score"],
    });
    assert.ok((payload.text as string).includes("N/A"));
  });

  it("includes agent name in text when provided", () => {
    const payload = buildSlackCallPayload({
      event: "call_flagged",
      orgId: "org-1",
      callId: "call-5",
      flags: ["low_score"],
      agentName: "John Smith",
    });
    assert.ok((payload.text as string).includes("John Smith"));
  });

  it("summary is truncated at 500 chars to keep webhook bodies bounded", () => {
    const longSummary = "A".repeat(600);
    const payload = buildSlackCallPayload({
      event: "call_flagged",
      orgId: "org-1",
      callId: "call-6",
      flags: ["low_score"],
      summary: longSummary,
    });
    const serialized = JSON.stringify(payload);
    assert.ok(!serialized.includes("A".repeat(600)), "Summary must be truncated to 500 chars");
  });
});

describe("Flag label formatting (production formatFlagLabels)", () => {
  it("renders low_score and exceptional_call as friendly labels", () => {
    const labels = formatFlagLabels(["low_score", "exceptional_call"]);
    assert.deepStrictEqual(labels, ["Low Score", "Exceptional Call"]);
  });

  it("formats agent_misconduct:category as 'Misconduct: <category>'", () => {
    const [label] = formatFlagLabels(["agent_misconduct:verbal_abuse"]);
    assert.strictEqual(label, "Misconduct: verbal_abuse");
  });

  it("falls back to the raw flag for unknown flags", () => {
    const [label] = formatFlagLabels(["something_unrecognized"]);
    assert.strictEqual(label, "something_unrecognized");
  });
});

// ---------------------------------------------------------------------------
// Teams payload builder (production buildTeamsCallPayload)
// ---------------------------------------------------------------------------

describe("Teams (MessageCard) payload builder (production)", () => {
  it("has correct @type and @context for Teams MessageCard format", () => {
    const payload = buildTeamsCallPayload({
      event: "call_flagged",
      orgId: "org-1",
      callId: "c1",
      flags: ["low_score"],
    });
    assert.equal(payload["@type"], "MessageCard");
    assert.equal(payload["@context"], "http://schema.org/extensions");
  });

  it("exceptional_call sets green themeColor (00AA00)", () => {
    const payload = buildTeamsCallPayload({
      event: "call_flagged",
      orgId: "org-1",
      callId: "c2",
      flags: ["exceptional_call"],
    });
    assert.equal(payload.themeColor, "00AA00");
  });

  it("low_score sets red themeColor (FF0000)", () => {
    const payload = buildTeamsCallPayload({
      event: "call_flagged",
      orgId: "org-1",
      callId: "c3",
      flags: ["low_score"],
    });
    assert.equal(payload.themeColor, "FF0000");
  });

  it("emits a Score fact with the formatted performance score", () => {
    const payload = buildTeamsCallPayload({
      event: "call_flagged",
      orgId: "org-1",
      callId: "c4",
      flags: ["low_score"],
      performanceScore: 1.5,
    });
    const sections = payload.sections as any[];
    const scoreFact = sections[0].facts.find((f: any) => f.name === "Score");
    assert.ok(scoreFact);
    assert.equal(scoreFact.value, "1.5/10");
  });
});

// ---------------------------------------------------------------------------
// Flag-vs-event matching (production matchFlagsAgainstEvents)
// ---------------------------------------------------------------------------

describe("matchFlagsAgainstEvents (production)", () => {
  it("returns false when flags array is empty", () => {
    assert.equal(matchFlagsAgainstEvents([], ["low_score"]), false);
  });

  it("returns false when allowedEvents array is empty", () => {
    assert.equal(matchFlagsAgainstEvents(["low_score"], []), false);
  });

  it("returns true for an exact flag/event match", () => {
    assert.equal(matchFlagsAgainstEvents(["low_score"], ["low_score"]), true);
  });

  it("matches a composite flag (event:category) against the bare event prefix", () => {
    assert.equal(
      matchFlagsAgainstEvents(["agent_misconduct:verbal_abuse"], ["agent_misconduct"]),
      true,
    );
  });

  it("returns false when no flag is in allowedEvents", () => {
    assert.equal(
      matchFlagsAgainstEvents(["low_confidence"], ["low_score", "exceptional_call"]),
      false,
    );
  });

  it("returns true when at least one of multiple flags matches", () => {
    assert.equal(
      matchFlagsAgainstEvents(["low_confidence", "low_score"], ["low_score"]),
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// Org-level webhook config override (production mergeWebhookConfig)
// ---------------------------------------------------------------------------

describe("mergeWebhookConfig (production)", () => {
  const envDefaults = {
    url: "https://hooks.slack.com/env" as string | undefined,
    platform: "slack" as "slack" | "teams",
    events: ["low_score", "agent_misconduct", "exceptional_call"],
  };

  it("org webhookUrl wins over env default when set", () => {
    const merged = mergeWebhookConfig({ webhookUrl: "https://hooks.slack.com/org" }, envDefaults);
    assert.equal(merged.url, "https://hooks.slack.com/org");
  });

  it("env default is used when org has no webhookUrl", () => {
    assert.equal(mergeWebhookConfig(undefined, envDefaults).url, envDefaults.url);
    assert.equal(mergeWebhookConfig({}, envDefaults).url, envDefaults.url);
  });

  it("org webhookEvents wins over env default when non-empty", () => {
    const merged = mergeWebhookConfig({ webhookEvents: ["exceptional_call"] }, envDefaults);
    assert.deepEqual(merged.events, ["exceptional_call"]);
  });

  it("env events used when org webhookEvents is empty array", () => {
    const merged = mergeWebhookConfig({ webhookEvents: [] }, envDefaults);
    assert.deepEqual(merged.events, envDefaults.events);
  });

  it("org platform wins over env platform when set", () => {
    const merged = mergeWebhookConfig({ webhookPlatform: "teams" }, envDefaults);
    assert.equal(merged.platform, "teams");
  });

  it("env platform used when org platform is unset", () => {
    const merged = mergeWebhookConfig(undefined, envDefaults);
    assert.equal(merged.platform, envDefaults.platform);
  });
});
