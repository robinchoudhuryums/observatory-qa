/**
 * Tests for server/services/phi-policy.ts — the centralized redact-or-preserve
 * decision that gates PHI flow into Bedrock prompts.
 *
 * Observatory has a HIPAA BAA with AWS Bedrock so PHI in prompts is compliant.
 * This module is defense-in-depth: PHI is stripped before prompts enter
 * Bedrock unless the prompt's job IS to summarize PHI (clinical note generation).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CLINICAL_CATEGORIES,
  shouldRedactPhiForCategory,
  redactTextForCategory,
} from "../server/services/phi-policy";

describe("CLINICAL_CATEGORIES — invariants", () => {
  it("contains exactly the four clinical-note-generation categories", () => {
    // INVARIANT: this set must stay in sync with buildSystemPrompt's clinical
    // routing in server/services/ai-prompts.ts. A clinical category whose
    // system prompt asks for SOAP notes but whose transcript arrives
    // PHI-redacted produces useless notes — this test pins the contract.
    assert.equal(CLINICAL_CATEGORIES.size, 4);
    assert.ok(CLINICAL_CATEGORIES.has("clinical_encounter"));
    assert.ok(CLINICAL_CATEGORIES.has("telemedicine"));
    assert.ok(CLINICAL_CATEGORIES.has("dental_encounter"));
    assert.ok(CLINICAL_CATEGORIES.has("dental_consultation"));
  });
});

describe("shouldRedactPhiForCategory — routing logic", () => {
  it("redacts when no category provided (safe default)", () => {
    assert.equal(shouldRedactPhiForCategory(undefined), true);
    assert.equal(shouldRedactPhiForCategory(null), true);
    assert.equal(shouldRedactPhiForCategory(""), true);
  });

  it("redacts for standard call analysis categories", () => {
    assert.equal(shouldRedactPhiForCategory("inbound"), true);
    assert.equal(shouldRedactPhiForCategory("outbound"), true);
    assert.equal(shouldRedactPhiForCategory("internal"), true);
    assert.equal(shouldRedactPhiForCategory("vendor"), true);
  });

  it("redacts for dental front-desk categories (non-clinical)", () => {
    assert.equal(shouldRedactPhiForCategory("dental_scheduling"), true);
    assert.equal(shouldRedactPhiForCategory("dental_insurance"), true);
    assert.equal(shouldRedactPhiForCategory("dental_treatment"), true);
    assert.equal(shouldRedactPhiForCategory("dental_recall"), true);
    assert.equal(shouldRedactPhiForCategory("dental_emergency"), true);
  });

  it("redacts for email categories", () => {
    assert.equal(shouldRedactPhiForCategory("email_support"), true);
    assert.equal(shouldRedactPhiForCategory("email_billing"), true);
    assert.equal(shouldRedactPhiForCategory("email_complaint"), true);
  });

  it("preserves PHI for clinical encounter categories", () => {
    assert.equal(shouldRedactPhiForCategory("clinical_encounter"), false);
    assert.equal(shouldRedactPhiForCategory("telemedicine"), false);
    assert.equal(shouldRedactPhiForCategory("dental_encounter"), false);
    assert.equal(shouldRedactPhiForCategory("dental_consultation"), false);
  });
});

describe("redactTextForCategory — wrapped redactor", () => {
  // Patterns Observatory's redactor catches: SSN, phone, email, MRN, DOB.
  const phiText =
    "Patient SSN 123-45-6789, phone (555) 123-4567, email user@example.com, MRN 1234567, DOB 01/15/1952.";

  it("redacts for non-clinical category (default routing)", () => {
    const out = redactTextForCategory(phiText, "inbound");
    assert.ok(!out.includes("123-45-6789"), "SSN must be redacted");
    assert.ok(!out.includes("(555) 123-4567"), "phone must be redacted");
    assert.ok(!out.includes("user@example.com"), "email must be redacted");
    assert.ok(out.includes("[REDACTED]"), "must contain redaction markers");
  });

  it("preserves PHI for clinical category (default routing)", () => {
    const out = redactTextForCategory(phiText, "clinical_encounter");
    assert.equal(out, phiText, "no redaction for clinical category");
  });

  it("redacts when no category provided (safe default)", () => {
    const out = redactTextForCategory(phiText, undefined);
    assert.ok(!out.includes("123-45-6789"));
    assert.ok(!out.includes("user@example.com"));
  });

  it("explicit override true forces redaction even for clinical", () => {
    const out = redactTextForCategory(phiText, "clinical_encounter", true);
    assert.ok(!out.includes("123-45-6789"));
  });

  it("explicit override false skips redaction even for non-clinical", () => {
    const out = redactTextForCategory(phiText, "inbound", false);
    assert.equal(out, phiText);
  });

  it("preserves benign text unchanged", () => {
    const benign = "Thanks for calling. How can I help today?";
    assert.equal(redactTextForCategory(benign, "inbound"), benign);
  });
});
