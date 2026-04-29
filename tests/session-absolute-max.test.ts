/**
 * Tests for the configurable absolute session-max enforcement.
 *
 * The platform default dropped from 8h to 6h to match NIST SP 800-66 Rev. 2
 * healthcare guidance (recommends 4-6h). Orgs can override via OrgSettings
 * `sessionAbsoluteMaxHours` (1-24h, clamped). This file pins:
 *
 *   1. The shared-schema validator: accepts 1, 6, 24; rejects 0, 25, negative.
 *   2. The default fallback constant is 6h (regression guard — if someone
 *      raises it back to 8h they'd quietly weaken the gate platform-wide).
 *
 * The full HTTP flow (cookie expiry → 401) is covered by the `auth-routes`
 * suite. Here we only verify the inputs and the default surface.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { orgSettingsSchema } from "../shared/schema/org.js";
import { DEFAULT_SESSION_ABSOLUTE_MAX_HOURS } from "../server/auth.js";

describe("orgSettingsSchema — sessionAbsoluteMaxHours", () => {
  it("accepts the platform default (6h)", () => {
    const result = orgSettingsSchema.safeParse({ sessionAbsoluteMaxHours: 6 });
    assert.equal(result.success, true);
  });

  it("accepts the floor (1h, sufficient for very-high-sensitivity sessions)", () => {
    const result = orgSettingsSchema.safeParse({ sessionAbsoluteMaxHours: 1 });
    assert.equal(result.success, true);
  });

  it("accepts the ceiling (24h, at the edge of HIPAA prudence)", () => {
    const result = orgSettingsSchema.safeParse({ sessionAbsoluteMaxHours: 24 });
    assert.equal(result.success, true);
  });

  it("rejects 0 (would disable the gate)", () => {
    const result = orgSettingsSchema.safeParse({ sessionAbsoluteMaxHours: 0 });
    assert.equal(result.success, false);
  });

  it("rejects negative values", () => {
    const result = orgSettingsSchema.safeParse({ sessionAbsoluteMaxHours: -1 });
    assert.equal(result.success, false);
  });

  it("rejects values above 24h (NIST upper-bound guard)", () => {
    const result = orgSettingsSchema.safeParse({ sessionAbsoluteMaxHours: 25 });
    assert.equal(result.success, false);
  });

  it("treats unset as valid (orgs that haven't migrated keep the default)", () => {
    const result = orgSettingsSchema.safeParse({});
    assert.equal(result.success, true);
  });
});

describe("DEFAULT_SESSION_ABSOLUTE_MAX_HOURS", () => {
  it("is 6h (NIST healthcare guidance, was 8h pre-PR)", () => {
    // Regression guard: raising this without an explicit policy decision
    // weakens the absolute timeout for every org that hasn't opted out.
    assert.equal(DEFAULT_SESSION_ABSOLUTE_MAX_HOURS, 6);
  });

  it("is at most 8h (the prior hardcoded value — must never silently exceed it)", () => {
    assert.ok(DEFAULT_SESSION_ABSOLUTE_MAX_HOURS <= 8);
  });

  it("is at least 1h (sanity floor — any lower would log users out mid-task)", () => {
    assert.ok(DEFAULT_SESSION_ABSOLUTE_MAX_HOURS >= 1);
  });
});
