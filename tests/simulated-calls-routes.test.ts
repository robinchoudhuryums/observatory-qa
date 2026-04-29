/**
 * Tests for the Simulated Call Generator routes — request validation
 * and plan-tier gating.
 *
 * The HTTP wiring (Express handlers, RBAC, audit middleware) is exercised
 * by the broader integration tests; this file pins the surface that's
 * easy to break unintentionally:
 *   - the request body schemas (createSimulatedCallSchema)
 *   - the query coercion (listSimulatedCallsQuerySchema)
 *   - the plan-tier flag wiring (simulatedCallsEnabled per tier)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createSimulatedCallSchema,
  listSimulatedCallsQuerySchema,
} from "../server/routes/simulated-calls.js";
import { PLAN_DEFINITIONS } from "../shared/schema.js";

const validScript = {
  title: "Order status check",
  scenario: "Customer calling about a delayed shipment",
  qualityTier: "acceptable" as const,
  voices: { agent: "voice_AGENT_id", customer: "voice_CUST_id" },
  turns: [
    { speaker: "agent" as const, text: "Thanks for calling, how can I help?" },
    { speaker: "customer" as const, text: "I'm checking on my order." },
  ],
};

const validConfig = {
  circumstances: [],
};

const validBody = {
  title: "Order status check",
  scenario: "Customer calling about a delayed shipment",
  qualityTier: "acceptable" as const,
  script: validScript,
  config: validConfig,
};

// ── createSimulatedCallSchema ────────────────────────────────────────

describe("createSimulatedCallSchema", () => {
  it("accepts a minimal valid body (title + script + config)", () => {
    const parsed = createSimulatedCallSchema.parse({
      title: "Insurance verification",
      script: validScript,
      config: validConfig,
    });
    assert.equal(parsed.title, "Insurance verification");
    assert.equal(parsed.scenario, undefined);
    assert.equal(parsed.qualityTier, undefined);
  });

  it("accepts the full request shape including optional fields", () => {
    const parsed = createSimulatedCallSchema.parse(validBody);
    assert.equal(parsed.title, validBody.title);
    assert.equal(parsed.scenario, validBody.scenario);
    assert.equal(parsed.qualityTier, "acceptable");
    assert.equal(parsed.script.title, validScript.title);
    assert.equal(parsed.script.turns.length, 2);
    assert.deepEqual(parsed.config.circumstances, []);
    // Defaults from simulatedCallConfigSchema fill in missing fields.
    assert.equal(parsed.config.gapDistribution, "natural");
    assert.equal(parsed.config.connectionQuality, "phone");
  });

  it("rejects an empty / whitespace-only title", () => {
    assert.throws(() =>
      createSimulatedCallSchema.parse({ ...validBody, title: "   " }),
    );
    assert.throws(() => createSimulatedCallSchema.parse({ ...validBody, title: "" }));
  });

  it("rejects a title longer than 500 chars", () => {
    assert.throws(() =>
      createSimulatedCallSchema.parse({ ...validBody, title: "x".repeat(501) }),
    );
  });

  it("rejects an unknown qualityTier", () => {
    assert.throws(() =>
      createSimulatedCallSchema.parse({ ...validBody, qualityTier: "amazing" }),
    );
  });

  it("rejects a body missing the script", () => {
    const { script: _omitted, ...rest } = validBody;
    void _omitted;
    assert.throws(() => createSimulatedCallSchema.parse(rest));
  });

  it("rejects a body missing the config", () => {
    const { config: _omitted, ...rest } = validBody;
    void _omitted;
    assert.throws(() => createSimulatedCallSchema.parse(rest));
  });

  it("rejects a script with no turns", () => {
    assert.throws(() =>
      createSimulatedCallSchema.parse({
        ...validBody,
        script: { ...validScript, turns: [] },
      }),
    );
  });

  it("trims whitespace from the title", () => {
    const parsed = createSimulatedCallSchema.parse({
      ...validBody,
      title: "  Padded Title  ",
    });
    assert.equal(parsed.title, "Padded Title");
  });
});

// ── listSimulatedCallsQuerySchema ───────────────────────────────────

describe("listSimulatedCallsQuerySchema", () => {
  it("returns an empty object when no params are passed", () => {
    const parsed = listSimulatedCallsQuerySchema.parse({});
    assert.equal(parsed.status, undefined);
    assert.equal(parsed.limit, undefined);
  });

  it("coerces limit from a string (Express query strings are always strings)", () => {
    const parsed = listSimulatedCallsQuerySchema.parse({ limit: "25" });
    assert.equal(parsed.limit, 25);
    assert.equal(typeof parsed.limit, "number");
  });

  it("rejects a non-numeric limit", () => {
    assert.throws(() => listSimulatedCallsQuerySchema.parse({ limit: "all" }));
  });

  it("rejects a non-positive limit", () => {
    assert.throws(() => listSimulatedCallsQuerySchema.parse({ limit: "0" }));
    assert.throws(() => listSimulatedCallsQuerySchema.parse({ limit: "-5" }));
  });

  it("rejects a limit above the 200 cap", () => {
    assert.throws(() => listSimulatedCallsQuerySchema.parse({ limit: "201" }));
  });

  it("accepts known status values and rejects unknown ones", () => {
    for (const s of ["pending", "generating", "ready", "failed"]) {
      const parsed = listSimulatedCallsQuerySchema.parse({ status: s });
      assert.equal(parsed.status, s);
    }
    assert.throws(() => listSimulatedCallsQuerySchema.parse({ status: "queued" }));
  });
});

// ── Plan-tier wiring ────────────────────────────────────────────────

describe("simulatedCallsEnabled plan flag", () => {
  it("is OFF for the free tier", () => {
    assert.equal(PLAN_DEFINITIONS.free.limits.simulatedCallsEnabled, false);
  });

  it("is OFF for the starter tier", () => {
    assert.equal(PLAN_DEFINITIONS.starter.limits.simulatedCallsEnabled, false);
  });

  it("is ON for the professional tier", () => {
    assert.equal(PLAN_DEFINITIONS.professional.limits.simulatedCallsEnabled, true);
  });

  it("is ON for the enterprise tier", () => {
    assert.equal(PLAN_DEFINITIONS.enterprise.limits.simulatedCallsEnabled, true);
  });
});
