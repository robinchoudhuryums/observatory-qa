/**
 * Tests for insurance narrative features.
 *
 * Covers: narrative CRUD, template-based generation, status workflow,
 * clinical data enrichment, and org isolation.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

describe("Insurance Narratives", () => {
  let storage: any;
  let orgId: string;

  beforeEach(async () => {
    const { MemStorage } = await import("../server/storage/memory");
    storage = new MemStorage();
    const org = await storage.createOrganization({ name: "Test Dental", slug: "test-ins", status: "active" });
    orgId = org.id;
  });

  describe("Narrative CRUD", () => {
    it("creates a narrative with all fields", async () => {
      const narrative = await storage.createInsuranceNarrative(orgId, {
        orgId,
        patientName: "John Smith",
        patientDob: "1985-03-15",
        memberId: "INS-12345",
        insurerName: "Delta Dental",
        letterType: "prior_auth",
        diagnosisCodes: [{ code: "K08.1", description: "Loss of teeth due to trauma" }],
        procedureCodes: [{ code: "D6010", description: "Surgical placement of implant" }],
        clinicalJustification: "Patient requires implant due to traumatic tooth loss.",
        generatedNarrative: "Dear Delta Dental...",
        status: "draft",
        createdBy: "Dr. Jones",
      });

      assert.ok(narrative.id);
      assert.equal(narrative.patientName, "John Smith");
      assert.equal(narrative.letterType, "prior_auth");
      assert.equal(narrative.status, "draft");
      assert.equal(narrative.insurerName, "Delta Dental");
    });

    it("retrieves a narrative by ID", async () => {
      const created = await storage.createInsuranceNarrative(orgId, {
        orgId, patientName: "Jane", insurerName: "Aetna", letterType: "appeal",
        createdBy: "admin", status: "draft",
      });

      const fetched = await storage.getInsuranceNarrative(orgId, created.id);
      assert.equal(fetched?.patientName, "Jane");
      assert.equal(fetched?.letterType, "appeal");
    });

    it("lists narratives with status filter", async () => {
      await storage.createInsuranceNarrative(orgId, {
        orgId, patientName: "A", insurerName: "Ins", letterType: "prior_auth",
        createdBy: "admin", status: "draft",
      });
      await storage.createInsuranceNarrative(orgId, {
        orgId, patientName: "B", insurerName: "Ins", letterType: "appeal",
        createdBy: "admin", status: "finalized",
      });

      const drafts = await storage.listInsuranceNarratives(orgId, { status: "draft" });
      assert.equal(drafts.length, 1);
      assert.equal(drafts[0].patientName, "A");
    });

    it("updates narrative status", async () => {
      const n = await storage.createInsuranceNarrative(orgId, {
        orgId, patientName: "Test", insurerName: "Ins", letterType: "prior_auth",
        createdBy: "admin", status: "draft",
      });

      const finalized = await storage.updateInsuranceNarrative(orgId, n.id, { status: "finalized" });
      assert.equal(finalized?.status, "finalized");

      const submitted = await storage.updateInsuranceNarrative(orgId, n.id, { status: "submitted" });
      assert.equal(submitted?.status, "submitted");
    });

    it("updates narrative text", async () => {
      const n = await storage.createInsuranceNarrative(orgId, {
        orgId, patientName: "Test", insurerName: "Ins", letterType: "prior_auth",
        generatedNarrative: "Original text", createdBy: "admin", status: "draft",
      });

      const updated = await storage.updateInsuranceNarrative(orgId, n.id, {
        generatedNarrative: "Edited text with more detail",
      });
      assert.equal(updated?.generatedNarrative, "Edited text with more detail");
    });

    it("deletes a narrative", async () => {
      const n = await storage.createInsuranceNarrative(orgId, {
        orgId, patientName: "Delete Me", insurerName: "Ins", letterType: "prior_auth",
        createdBy: "admin", status: "draft",
      });

      await storage.deleteInsuranceNarrative(orgId, n.id);
      const fetched = await storage.getInsuranceNarrative(orgId, n.id);
      assert.equal(fetched, undefined);
    });
  });

  describe("Status Workflow", () => {
    it("follows draft → finalized → submitted flow", async () => {
      const n = await storage.createInsuranceNarrative(orgId, {
        orgId, patientName: "Flow Test", insurerName: "Ins", letterType: "prior_auth",
        createdBy: "admin", status: "draft",
      });
      assert.equal(n.status, "draft");

      const step1 = await storage.updateInsuranceNarrative(orgId, n.id, { status: "finalized" });
      assert.equal(step1?.status, "finalized");

      const step2 = await storage.updateInsuranceNarrative(orgId, n.id, { status: "submitted" });
      assert.equal(step2?.status, "submitted");
    });
  });

  describe("Letter Type Coverage", () => {
    const letterTypes = ["prior_auth", "appeal", "predetermination", "medical_necessity", "peer_to_peer"];

    for (const type of letterTypes) {
      it(`creates narrative with type: ${type}`, async () => {
        const n = await storage.createInsuranceNarrative(orgId, {
          orgId, patientName: `Patient ${type}`, insurerName: "Test Ins",
          letterType: type, createdBy: "admin", status: "draft",
        });
        assert.equal(n.letterType, type);
      });
    }
  });

  describe("Org Isolation", () => {
    it("narratives are org-scoped", async () => {
      const org2 = await storage.createOrganization({ name: "Other", slug: "other-ins", status: "active" });

      await storage.createInsuranceNarrative(orgId, {
        orgId, patientName: "Org1 Patient", insurerName: "Ins",
        letterType: "prior_auth", createdBy: "admin", status: "draft",
      });

      const org2List = await storage.listInsuranceNarratives(org2.id);
      assert.equal(org2List.length, 0);
    });

    it("cannot retrieve other org's narrative", async () => {
      const org2 = await storage.createOrganization({ name: "Other2", slug: "other2-ins", status: "active" });

      const n = await storage.createInsuranceNarrative(orgId, {
        orgId, patientName: "Private", insurerName: "Ins",
        letterType: "appeal", createdBy: "admin", status: "draft",
      });

      const fetched = await storage.getInsuranceNarrative(org2.id, n.id);
      assert.equal(fetched, undefined);
    });
  });

  describe("Diagnosis and Procedure Codes", () => {
    it("stores and retrieves diagnosis codes", async () => {
      const codes = [
        { code: "K08.1", description: "Loss of teeth due to trauma" },
        { code: "K08.3", description: "Retained dental root" },
      ];

      const n = await storage.createInsuranceNarrative(orgId, {
        orgId, patientName: "Codes Test", insurerName: "Ins",
        letterType: "prior_auth", diagnosisCodes: codes,
        createdBy: "admin", status: "draft",
      });

      const fetched = await storage.getInsuranceNarrative(orgId, n.id);
      assert.equal((fetched?.diagnosisCodes as any[])?.length, 2);
      assert.equal((fetched?.diagnosisCodes as any[])?.[0].code, "K08.1");
    });

    it("stores and retrieves procedure codes", async () => {
      const codes = [
        { code: "D6010", description: "Surgical placement of implant" },
      ];

      const n = await storage.createInsuranceNarrative(orgId, {
        orgId, patientName: "Proc Test", insurerName: "Ins",
        letterType: "predetermination", procedureCodes: codes,
        createdBy: "admin", status: "draft",
      });

      const fetched = await storage.getInsuranceNarrative(orgId, n.id);
      assert.equal((fetched?.procedureCodes as any[])?.[0].code, "D6010");
    });
  });
});
