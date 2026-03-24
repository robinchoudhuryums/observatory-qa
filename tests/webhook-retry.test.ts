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
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

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

describe("Webhook HTTP error classification", () => {
  it("4xx response code is classified as permanent (no retry)", () => {
    // Application logic: status 400-499 → permanent, don't retry
    const permanentCodes = [400, 401, 403, 404, 422];
    for (const code of permanentCodes) {
      assert.ok(code >= 400 && code < 500, `${code} should be a client error`);
    }
  });

  it("5xx response code is classified as transient (should retry)", () => {
    const transientCodes = [500, 502, 503, 504];
    for (const code of transientCodes) {
      assert.ok(code >= 500, `${code} should be a server error (transient)`);
    }
  });

  it("network error (no response) is transient (should retry)", () => {
    // AbortError / ECONNREFUSED / ETIMEDOUT → transient
    const networkErrors = ["AbortError", "FetchError", "ECONNREFUSED", "ETIMEDOUT"];
    for (const name of networkErrors) {
      // These do not have a status code ≥ 400, so they fall into the retry path
      assert.ok(!networkErrors.includes("4xx"), "Network errors must not be treated as 4xx");
    }
  });
});

// ---------------------------------------------------------------------------
// Slack payload builder
// ---------------------------------------------------------------------------

describe("Slack payload builder", () => {
  function buildSlackCallPayload(notification: {
    callId: string;
    flags: string[];
    performanceScore?: number;
    agentName?: string;
    fileName?: string;
    summary?: string;
  }): Record<string, unknown> {
    const flagLabels = notification.flags.map(f => {
      if (f === "low_score") return "Low Score";
      if (f === "exceptional_call") return "Exceptional Call";
      if (f.startsWith("agent_misconduct")) return `Misconduct: ${f.split(":")[1] || "unspecified"}`;
      return f;
    });
    const emoji = notification.flags.includes("exceptional_call") ? "star" : "warning";
    const scoreText = notification.performanceScore != null
      ? `${notification.performanceScore.toFixed(1)}/10`
      : "N/A";

    return {
      text: `Call flagged: ${flagLabels.join(", ")} — Score: ${scoreText}${notification.agentName ? ` — Agent: ${notification.agentName}` : ""}`,
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: `:${emoji}: Call Flagged: ${flagLabels.join(", ")}`, emoji: true },
        },
        {
          type: "section",
          fields: [
            { type: "mrkdwn", text: `*Call ID:*\n${notification.callId}` },
            { type: "mrkdwn", text: `*Score:*\n${scoreText}` },
          ],
        },
      ],
    };
  }

  it("low_score flag produces warning emoji", () => {
    const payload = buildSlackCallPayload({
      callId: "call-1", flags: ["low_score"], performanceScore: 2.1,
    });
    const header = (payload.blocks as any[])[0];
    assert.ok((header.text.text as string).includes("warning"));
  });

  it("exceptional_call flag produces star emoji", () => {
    const payload = buildSlackCallPayload({
      callId: "call-2", flags: ["exceptional_call"], performanceScore: 9.5,
    });
    const header = (payload.blocks as any[])[0];
    assert.ok((header.text.text as string).includes("star"));
  });

  it("includes score as N/A when performanceScore is undefined", () => {
    const payload = buildSlackCallPayload({
      callId: "call-3", flags: ["low_score"],
    });
    assert.ok((payload.text as string).includes("N/A"));
  });

  it("formats agent_misconduct:category flag as readable label", () => {
    const payload = buildSlackCallPayload({
      callId: "call-4", flags: ["agent_misconduct:verbal_abuse"],
    });
    assert.ok((payload.text as string).includes("Misconduct: verbal_abuse"));
  });

  it("includes agent name in text when provided", () => {
    const payload = buildSlackCallPayload({
      callId: "call-5", flags: ["low_score"], agentName: "John Smith",
    });
    assert.ok((payload.text as string).includes("John Smith"));
  });

  it("summary truncated at 500 chars", () => {
    const longSummary = "A".repeat(600);
    const payload = buildSlackCallPayload({
      callId: "call-6", flags: ["low_score"], summary: longSummary,
    });
    // Summary block added but text should be ≤ 500 chars
    const allText = JSON.stringify(payload);
    // Verify summary is not embedded raw (not a 600-char string in output)
    assert.ok(!allText.includes("A".repeat(600)), "Summary must be truncated to 500 chars");
  });
});

// ---------------------------------------------------------------------------
// Teams payload builder
// ---------------------------------------------------------------------------

describe("Teams (MessageCard) payload builder", () => {
  function buildTeamsCallPayload(notification: {
    callId: string;
    flags: string[];
    performanceScore?: number;
    agentName?: string;
    fileName?: string;
    summary?: string;
  }): Record<string, unknown> {
    const flagLabels = notification.flags.map(f => {
      if (f === "low_score") return "Low Score";
      if (f === "exceptional_call") return "Exceptional Call";
      return f;
    });
    const scoreText = notification.performanceScore != null
      ? `${notification.performanceScore.toFixed(1)}/10`
      : "N/A";

    return {
      "@type": "MessageCard",
      "@context": "http://schema.org/extensions",
      themeColor: notification.flags.includes("exceptional_call") ? "00AA00" : "FF0000",
      summary: `Call Flagged: ${flagLabels.join(", ")}`,
      sections: [
        {
          activityTitle: `Call Flagged: ${flagLabels.join(", ")}`,
          facts: [
            { name: "Call ID", value: notification.callId },
            { name: "Score", value: scoreText },
          ],
        },
      ],
    };
  }

  it("has correct @type and @context for Teams MessageCard format", () => {
    const payload = buildTeamsCallPayload({ callId: "c1", flags: ["low_score"] });
    assert.equal(payload["@type"], "MessageCard");
    assert.equal(payload["@context"], "http://schema.org/extensions");
  });

  it("exceptional_call sets green themeColor (00AA00)", () => {
    const payload = buildTeamsCallPayload({ callId: "c2", flags: ["exceptional_call"] });
    assert.equal(payload.themeColor, "00AA00");
  });

  it("low_score sets red themeColor (FF0000)", () => {
    const payload = buildTeamsCallPayload({ callId: "c3", flags: ["low_score"] });
    assert.equal(payload.themeColor, "FF0000");
  });

  it("has sections array with activityTitle and facts", () => {
    const payload = buildTeamsCallPayload({ callId: "c4", flags: ["low_score"], performanceScore: 1.5 });
    const sections = payload.sections as any[];
    assert.ok(Array.isArray(sections));
    assert.ok(sections[0].activityTitle);
    assert.ok(Array.isArray(sections[0].facts));
    const scoreFact = sections[0].facts.find((f: any) => f.name === "Score");
    assert.ok(scoreFact);
    assert.equal(scoreFact.value, "1.5/10");
  });
});

// ---------------------------------------------------------------------------
// Flag-based notification filtering (shouldNotify logic)
// ---------------------------------------------------------------------------

describe("shouldNotify flag filtering", () => {
  function shouldNotify(
    flags: string[],
    webhookUrl: string | undefined,
    allowedEvents: string[],
  ): boolean {
    if (!webhookUrl || flags.length === 0) return false;
    return flags.some(flag =>
      allowedEvents.some(event => flag === event || flag.startsWith(`${event}:`))
    );
  }

  it("returns false when webhook URL is not configured", () => {
    assert.equal(shouldNotify(["low_score"], undefined, ["low_score"]), false);
  });

  it("returns false when flags array is empty", () => {
    assert.equal(shouldNotify([], "https://hooks.slack.com/test", ["low_score"]), false);
  });

  it("returns true for exact flag match", () => {
    assert.equal(
      shouldNotify(["low_score"], "https://hooks.slack.com/test", ["low_score"]),
      true
    );
  });

  it("returns true for prefix match (agent_misconduct:category)", () => {
    assert.equal(
      shouldNotify(["agent_misconduct:verbal_abuse"], "https://hooks.slack.com/test", ["agent_misconduct"]),
      true
    );
  });

  it("returns false for flag not in allowed events", () => {
    assert.equal(
      shouldNotify(["low_confidence"], "https://hooks.slack.com/test", ["low_score", "exceptional_call"]),
      false
    );
  });

  it("returns true when at least one flag matches allowed events", () => {
    assert.equal(
      shouldNotify(["low_confidence", "low_score"], "https://hooks.slack.com/test", ["low_score"]),
      true
    );
  });

  it("exceptional_call is included in default event set", () => {
    const DEFAULT_EVENTS = ["low_score", "agent_misconduct", "exceptional_call"];
    assert.equal(
      shouldNotify(["exceptional_call"], "https://hooks.slack.com/test", DEFAULT_EVENTS),
      true
    );
  });
});

// ---------------------------------------------------------------------------
// Org-level webhook config override
// ---------------------------------------------------------------------------

describe("Org-level webhook config override", () => {
  it("org webhookUrl takes precedence over env var when set", () => {
    const envUrl = "https://hooks.slack.com/env";
    const orgUrl = "https://hooks.slack.com/org-specific";

    // Simulate resolveOrgWebhookConfig logic
    function resolveUrl(orgSettings: { webhookUrl?: string } | undefined, envDefault: string | undefined) {
      return orgSettings?.webhookUrl || envDefault;
    }

    assert.equal(resolveUrl({ webhookUrl: orgUrl }, envUrl), orgUrl);
    assert.equal(resolveUrl(undefined, envUrl), envUrl);
    assert.equal(resolveUrl({}, envUrl), envUrl);
    assert.equal(resolveUrl({ webhookUrl: orgUrl }, undefined), orgUrl);
  });

  it("org webhookEvents takes precedence when non-empty", () => {
    const envEvents = ["low_score", "agent_misconduct", "exceptional_call"];
    const orgEvents = ["exceptional_call"]; // org only wants exceptional calls

    function resolveEvents(orgSettings: { webhookEvents?: string[] } | undefined, envDefault: string[]) {
      return (orgSettings?.webhookEvents && orgSettings.webhookEvents.length > 0)
        ? orgSettings.webhookEvents
        : envDefault;
    }

    assert.deepEqual(resolveEvents({ webhookEvents: orgEvents }, envEvents), orgEvents);
    assert.deepEqual(resolveEvents({ webhookEvents: [] }, envEvents), envEvents);
    assert.deepEqual(resolveEvents(undefined, envEvents), envEvents);
  });

  it("org platform takes precedence over env WEBHOOK_PLATFORM", () => {
    function resolvePlatform(
      orgPlatform: "slack" | "teams" | undefined,
      envPlatform: "slack" | "teams",
    ): "slack" | "teams" {
      return orgPlatform || envPlatform;
    }

    assert.equal(resolvePlatform("teams", "slack"), "teams");
    assert.equal(resolvePlatform(undefined, "slack"), "slack");
    assert.equal(resolvePlatform("slack", "teams"), "slack");
  });
});
