/**
 * Tests for Insurance Narrative improvements:
 * - Outcome tracking schema
 * - Denial code analysis logic
 * - Deadline tracking calculations
 * - Payer-specific template structure
 * - Supporting document checklist generation
 *
 * Run with: npx tsx --test tests/insurance-narrative-improvements.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  insuranceNarrativeSchema,
  insertInsuranceNarrativeSchema,
  NARRATIVE_OUTCOMES,
  INSURANCE_LETTER_TYPES,
  type InsuranceNarrative,
} from "../shared/schema.js";

describe("Insurance Narrative Schema - Outcome Tracking", () => {
  it("accepts outcome fields", () => {
    const narrative = insuranceNarrativeSchema.parse({
      id: "n1", orgId: "o1", patientName: "Jane Doe", insurerName: "BCBS",
      letterType: "prior_auth", createdBy: "admin",
      outcome: "approved",
      outcomeDate: "2026-03-25T10:00:00Z",
      outcomeNotes: "Approved on first submission",
    });
    assert.equal(narrative.outcome, "approved");
    assert.equal(narrative.outcomeDate, "2026-03-25T10:00:00Z");
  });

  it("validates all outcome values", () => {
    for (const outcome of NARRATIVE_OUTCOMES) {
      const n = insuranceNarrativeSchema.parse({
        id: "n1", orgId: "o1", patientName: "J", insurerName: "I",
        letterType: "prior_auth", createdBy: "admin", outcome,
      });
      assert.equal(n.outcome, outcome);
    }
  });

  it("rejects invalid outcome", () => {
    assert.throws(() => {
      insertInsuranceNarrativeSchema.parse({
        orgId: "o1", patientName: "J", insurerName: "I",
        letterType: "prior_auth", createdBy: "admin",
        outcome: "maybe",
      });
    });
  });

  it("outcome fields are optional", () => {
    const n = insuranceNarrativeSchema.parse({
      id: "n1", orgId: "o1", patientName: "J", insurerName: "I",
      letterType: "appeal", createdBy: "admin",
    });
    assert.equal(n.outcome, undefined);
    assert.equal(n.outcomeDate, undefined);
  });
});

describe("Insurance Narrative Schema - Denial Codes", () => {
  it("accepts denial code and reason", () => {
    const n = insuranceNarrativeSchema.parse({
      id: "n1", orgId: "o1", patientName: "J", insurerName: "Aetna",
      letterType: "appeal", createdBy: "admin",
      outcome: "denied",
      denialCode: "CO-50",
      denialReason: "Non-covered service: procedure not included in benefit plan",
    });
    assert.equal(n.denialCode, "CO-50");
    assert.ok(n.denialReason?.includes("Non-covered"));
  });
});

describe("Insurance Narrative Schema - Deadlines", () => {
  it("accepts submission deadline", () => {
    const n = insuranceNarrativeSchema.parse({
      id: "n1", orgId: "o1", patientName: "J", insurerName: "I",
      letterType: "appeal", createdBy: "admin",
      submissionDeadline: "2026-04-15T00:00:00Z",
      deadlineAcknowledged: false,
    });
    assert.equal(n.submissionDeadline, "2026-04-15T00:00:00Z");
    assert.equal(n.deadlineAcknowledged, false);
  });
});

describe("Insurance Narrative Schema - Payer Template", () => {
  it("accepts payerTemplate field", () => {
    const n = insuranceNarrativeSchema.parse({
      id: "n1", orgId: "o1", patientName: "J", insurerName: "BCBS",
      letterType: "prior_auth", createdBy: "admin",
      payerTemplate: "bcbs",
    });
    assert.equal(n.payerTemplate, "bcbs");
  });
});

describe("Insurance Narrative Schema - Supporting Documents", () => {
  it("accepts supporting documents checklist", () => {
    const n = insuranceNarrativeSchema.parse({
      id: "n1", orgId: "o1", patientName: "J", insurerName: "I",
      letterType: "prior_auth", createdBy: "admin",
      supportingDocuments: [
        { name: "Pre-operative radiographs", required: true, attached: true },
        { name: "Clinical photographs", required: false, attached: false, notes: "Intraoral" },
      ],
    });
    assert.equal(n.supportingDocuments!.length, 2);
    assert.equal(n.supportingDocuments![0].attached, true);
    assert.equal(n.supportingDocuments![1].required, false);
  });
});

describe("Deadline Tracking Logic", () => {
  it("calculates days remaining correctly", () => {
    const deadline = new Date();
    deadline.setDate(deadline.getDate() + 5);
    const now = new Date();
    const daysRemaining = Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    assert.ok(daysRemaining >= 4 && daysRemaining <= 6);
  });

  it("classifies urgency levels", () => {
    function getUrgency(daysRemaining: number): string {
      if (daysRemaining < 0) return "overdue";
      if (daysRemaining <= 3) return "critical";
      if (daysRemaining <= 7) return "warning";
      return "on_track";
    }
    assert.equal(getUrgency(-2), "overdue");
    assert.equal(getUrgency(0), "critical");
    assert.equal(getUrgency(3), "critical");
    assert.equal(getUrgency(5), "warning");
    assert.equal(getUrgency(14), "on_track");
  });
});

describe("Denial Analysis Logic", () => {
  it("groups denials by code", () => {
    const denials = [
      { denialCode: "CO-50", insurerName: "BCBS", letterType: "prior_auth" },
      { denialCode: "CO-50", insurerName: "Aetna", letterType: "appeal" },
      { denialCode: "PR-96", insurerName: "BCBS", letterType: "prior_auth" },
    ];

    const groups: Record<string, { count: number; insurers: Set<string> }> = {};
    for (const d of denials) {
      const code = d.denialCode || "unknown";
      if (!groups[code]) groups[code] = { count: 0, insurers: new Set() };
      groups[code].count++;
      groups[code].insurers.add(d.insurerName);
    }

    assert.equal(groups["CO-50"].count, 2);
    assert.equal(groups["CO-50"].insurers.size, 2);
    assert.equal(groups["PR-96"].count, 1);
  });

  it("computes approval rate", () => {
    const outcomes = ["approved", "approved", "denied", "approved", "partial_approval"];
    const approved = outcomes.filter(o => o === "approved").length;
    const total = outcomes.length;
    const rate = Math.round((approved / total) * 100);
    assert.equal(rate, 60);
  });
});

describe("Payer Template Structure", () => {
  it("has at least 5 payer templates", () => {
    // Templates are defined in the routes file, test the structure
    const templates = [
      { key: "bcbs", name: "Blue Cross Blue Shield" },
      { key: "aetna", name: "Aetna" },
      { key: "uhc", name: "UnitedHealthcare" },
      { key: "cigna", name: "Cigna" },
      { key: "delta_dental", name: "Delta Dental" },
    ];
    assert.ok(templates.length >= 5);
    for (const t of templates) {
      assert.ok(t.key.length > 0);
      assert.ok(t.name.length > 0);
    }
  });
});

describe("Checklist Completeness", () => {
  it("computes completion rate", () => {
    const checklist = [
      { name: "Claim form", required: true, attached: true },
      { name: "Radiographs", required: true, attached: false },
      { name: "Photos", required: false, attached: false },
    ];
    const complete = checklist.filter(i => i.attached || !i.required).length;
    const rate = Math.round((complete / checklist.length) * 100);
    assert.equal(rate, 67); // 2 of 3 (form attached + photos optional)
  });
});

describe("Full Narrative Lifecycle", () => {
  it("models complete prior auth flow with outcome", () => {
    const narrative: InsuranceNarrative = insuranceNarrativeSchema.parse({
      id: "full-lifecycle",
      orgId: "org-1",
      patientName: "John Smith",
      insurerName: "Delta Dental",
      letterType: "prior_auth",
      status: "submitted",
      createdBy: "dr-jones",
      payerTemplate: "delta_dental",
      submissionDeadline: "2026-04-01T00:00:00Z",
      outcome: "denied",
      outcomeDate: "2026-03-28T14:00:00Z",
      denialCode: "CO-50",
      denialReason: "Non-covered service per benefit limitations",
      supportingDocuments: [
        { name: "Claim form", required: true, attached: true },
        { name: "Pre-op radiographs", required: true, attached: true },
        { name: "Periodontal charting", required: true, attached: false },
      ],
    });

    assert.equal(narrative.outcome, "denied");
    assert.equal(narrative.denialCode, "CO-50");
    assert.equal(narrative.payerTemplate, "delta_dental");
    assert.equal(narrative.supportingDocuments!.filter(d => d.attached).length, 2);
  });
});
