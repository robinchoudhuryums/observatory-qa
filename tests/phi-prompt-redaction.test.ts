/**
 * Tests for PHI redaction at AI inference boundaries (Tier 0.1 of the
 * CallAnalyzer adaptation plan).
 *
 * Observatory has a HIPAA BAA with AWS Bedrock, so PHI in prompts is
 * compliant. These tests guard the defense-in-depth policy: PHI is stripped
 * before prompts enter Bedrock unless the prompt's job IS to summarize PHI
 * (clinical note generation).
 *
 * What's covered:
 *   - shouldRedactPhiForCategory: routing logic
 *   - CLINICAL_CATEGORIES: set membership stays in sync with buildSystemPrompt
 *   - buildUserMessage: redacts for non-clinical, preserves for clinical,
 *     respects explicit redactPhi option
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CLINICAL_CATEGORIES,
  shouldRedactPhiForCategory,
  buildUserMessage,
} from "../server/services/ai-prompts";

describe("shouldRedactPhiForCategory — routing logic", () => {
  it("redacts when no category provided (default safe)", () => {
    assert.equal(shouldRedactPhiForCategory(undefined), true);
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

describe("CLINICAL_CATEGORIES — invariants", () => {
  it("contains exactly the four clinical-note-generation categories", () => {
    // If buildSystemPrompt's clinical routing changes, this test must be
    // updated alongside it. Drift between the two is a HIPAA-relevant bug.
    assert.equal(CLINICAL_CATEGORIES.size, 4);
    assert.ok(CLINICAL_CATEGORIES.has("clinical_encounter"));
    assert.ok(CLINICAL_CATEGORIES.has("telemedicine"));
    assert.ok(CLINICAL_CATEGORIES.has("dental_encounter"));
    assert.ok(CLINICAL_CATEGORIES.has("dental_consultation"));
  });
});

describe("buildUserMessage — PHI redaction routing", () => {
  // Use Observatory's redactor patterns: SSN, phone, email, MRN, DOB.
  // These are the surface that travels into Bedrock with the transcript.
  const phiTranscript =
    "Agent: Hi, this is Sarah. Patient: My SSN is 123-45-6789, " +
    "phone (555) 123-4567, email john.doe@example.com, MRN 1234567, DOB 01/15/1952.";

  it("redacts PHI by default for non-clinical category (inbound)", () => {
    const out = buildUserMessage(phiTranscript, "inbound");
    assert.ok(!out.includes("123-45-6789"), "SSN must be redacted");
    assert.ok(!out.includes("(555) 123-4567"), "phone must be redacted");
    assert.ok(!out.includes("john.doe@example.com"), "email must be redacted");
    assert.ok(!out.includes("1234567"), "MRN must be redacted");
    assert.ok(!out.includes("01/15/1952"), "DOB must be redacted");
    assert.ok(out.includes("[REDACTED]"), "must contain redaction markers");
  });

  it("redacts PHI by default when no category provided (safe default)", () => {
    const out = buildUserMessage(phiTranscript);
    assert.ok(!out.includes("123-45-6789"));
    assert.ok(!out.includes("john.doe@example.com"));
  });

  it("preserves PHI for clinical_encounter (AI must see PHI to draft notes)", () => {
    const out = buildUserMessage(phiTranscript, "clinical_encounter");
    assert.ok(out.includes("123-45-6789"), "SSN must be preserved for clinical");
    assert.ok(out.includes("(555) 123-4567"), "phone must be preserved");
    assert.ok(out.includes("john.doe@example.com"), "email must be preserved");
  });

  it("preserves PHI for telemedicine, dental_encounter, dental_consultation", () => {
    for (const category of ["telemedicine", "dental_encounter", "dental_consultation"]) {
      const out = buildUserMessage(phiTranscript, category);
      assert.ok(out.includes("123-45-6789"), `SSN preserved for ${category}`);
      assert.ok(out.includes("MRN 1234567"), `MRN preserved for ${category}`);
    }
  });

  it("respects explicit redactPhi: true even for clinical categories", () => {
    const out = buildUserMessage(phiTranscript, "clinical_encounter", { redactPhi: true });
    assert.ok(!out.includes("123-45-6789"), "explicit override forces redaction");
  });

  it("respects explicit redactPhi: false even for non-clinical categories", () => {
    const out = buildUserMessage(phiTranscript, "inbound", { redactPhi: false });
    assert.ok(out.includes("123-45-6789"), "explicit override skips redaction");
  });

  it("preserves agent name detection cues (no NAME pattern in redactor)", () => {
    // Observatory's redactor intentionally omits name patterns to keep
    // detected_agent_name working. This test pins that contract: the agent
    // greeting "Hi, this is Sarah" should survive redaction.
    const out = buildUserMessage(phiTranscript, "inbound");
    assert.ok(out.includes("Sarah"), "agent name cue must survive redaction");
  });

  it("preserves benign transcript content", () => {
    const benign = "Agent: Thanks for calling. How can I help today? Customer: I have a question about my order.";
    const out = buildUserMessage(benign, "inbound");
    assert.ok(out.includes("Thanks for calling"));
    assert.ok(out.includes("question about my order"));
  });

  it("attaches low-confidence note when transcriptConfidence < 0.5", () => {
    const out = buildUserMessage("benign text", "inbound", { transcriptConfidence: 0.3 });
    assert.ok(out.includes("LOW confidence"));
    assert.ok(out.includes("30%"));
  });

  it("does not attach confidence note for high-confidence transcripts", () => {
    const out = buildUserMessage("benign text", "inbound", { transcriptConfidence: 0.9 });
    assert.ok(!out.includes("LOW confidence"));
  });
});
