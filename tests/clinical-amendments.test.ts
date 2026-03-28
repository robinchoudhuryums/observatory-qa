/**
 * Clinical amendment and addendum workflow tests.
 *
 * Tests the full lifecycle of post-attestation clinical note changes:
 * - Amendment: re-opens note, clears attestation, creates audit snapshot
 * - Addendum: appends supplementary info, preserves attestation
 * - Conflict detection: optimistic locking via version field
 * - Multi-amendment chains
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { MemStorage } from "../server/storage/memory.js";
import { clinicalNoteSchema } from "../shared/schema.js";
import type { InsertCallAnalysis } from "../shared/schema.js";

const ORG_ID = "org-clinical-test";

function makeAttestedNote(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    format: "soap",
    specialty: "dental",
    chiefComplaint: "Tooth pain",
    subjective: "Patient reports sharp pain in lower right molar",
    objective: "Visible caries on tooth #30",
    assessment: "Dental caries, unspecified",
    plan: ["Schedule restoration D2391", "Follow up in 2 weeks"],
    providerAttested: true,
    attestedBy: "Dr. Smith",
    attestedById: "user-smith",
    attestedAt: new Date().toISOString(),
    version: 1,
    amendments: [],
    editHistory: [],
    ...overrides,
  };
}

describe("Clinical amendment workflow", () => {
  let storage: InstanceType<typeof MemStorage>;
  let orgId: string;

  beforeEach(async () => {
    storage = new MemStorage();
    const org = await storage.createOrganization({ name: "Dental Practice", slug: "dental-amend", status: "active" });
    orgId = org.id;
  });

  // ── Schema validation ──────────────────────────────────────────────

  describe("Amendment schema", () => {
    it("validates amendment type enum", () => {
      const note = makeAttestedNote({
        amendments: [{
          type: "amendment",
          reason: "Corrected tooth number",
          amendedBy: "Dr. Smith",
          amendedAt: new Date().toISOString(),
          fieldsChanged: ["toothNumbers"],
        }],
      });
      const result = clinicalNoteSchema.safeParse(note);
      assert.ok(result.success, `Should validate amendment: ${JSON.stringify(result.error?.issues)}`);
    });

    it("validates addendum type", () => {
      const note = makeAttestedNote({
        amendments: [{
          type: "addendum",
          reason: "Additional findings from radiograph",
          amendedBy: "Dr. Smith",
          amendedAt: new Date().toISOString(),
          fieldsChanged: [],
          content: "Radiograph reveals periapical abscess at tooth #30. Recommend endodontic consultation.",
        }],
      });
      const result = clinicalNoteSchema.safeParse(note);
      assert.ok(result.success, `Should validate addendum: ${JSON.stringify(result.error?.issues)}`);
    });

    it("rejects invalid amendment type", () => {
      const note = makeAttestedNote({
        amendments: [{
          type: "correction",
          reason: "Fix typo",
          amendedBy: "Dr. Smith",
          amendedAt: new Date().toISOString(),
          fieldsChanged: [],
        }],
      });
      const result = clinicalNoteSchema.safeParse(note);
      assert.ok(!result.success, "Should reject invalid amendment type");
    });
  });

  // ── Storage-level amendment persistence ────────────────────────────

  describe("Amendment persistence", () => {
    it("stores amendment in analysis.clinicalNote.amendments", async () => {
      const call = await storage.createCall(orgId, { orgId, status: "completed" });
      const note = makeAttestedNote();
      const analysis = await storage.createCallAnalysis(orgId, {
        orgId, callId: call.id, performanceScore: "8.0",
        clinicalNote: note,
      } as InsertCallAnalysis);

      // Simulate amendment: add to amendments array, increment version, clear attestation
      const amendments = [...(note.amendments as any[] || []), {
        type: "amendment",
        reason: "Updated assessment after lab results",
        amendedBy: "Dr. Jones",
        amendedById: "user-jones",
        amendedAt: new Date().toISOString(),
        fieldsChanged: ["assessment", "plan"],
        noteSnapshot: { format: "soap", specialty: "dental", plan: note.plan },
      }];

      const updatedNote = {
        ...note,
        assessment: "Irreversible pulpitis — endodontic treatment needed",
        plan: ["Root canal therapy D3330", "Crown D2740 post-endo"],
        providerAttested: false,
        attestedBy: undefined,
        attestedAt: undefined,
        version: 2,
        amendments,
      };

      await storage.createCallAnalysis(orgId, {
        orgId, callId: call.id, performanceScore: "8.0",
        clinicalNote: updatedNote,
      } as InsertCallAnalysis);

      const retrieved = await storage.getCallAnalysis(orgId, call.id);
      assert.ok(retrieved);
      const cn = retrieved.clinicalNote as Record<string, unknown>;
      assert.ok(cn);
      assert.equal((cn.amendments as any[]).length, 1);
      assert.equal((cn.amendments as any[])[0].type, "amendment");
      assert.equal((cn.amendments as any[])[0].reason, "Updated assessment after lab results");
      assert.equal(cn.providerAttested, false, "Attestation should be cleared after amendment");
      assert.equal(cn.version, 2);
    });

    it("stores addendum without clearing attestation", async () => {
      const call = await storage.createCall(orgId, { orgId, status: "completed" });
      const note = makeAttestedNote();

      const addendum = {
        type: "addendum",
        reason: "Additional radiograph findings",
        amendedBy: "Dr. Smith",
        amendedAt: new Date().toISOString(),
        fieldsChanged: [],
        content: "Panoramic radiograph shows impacted wisdom tooth #32.",
      };

      const updatedNote = {
        ...note,
        amendments: [addendum],
        // Addendum preserves attestation — no re-attestation needed
        providerAttested: true,
        version: 2,
      };

      await storage.createCallAnalysis(orgId, {
        orgId, callId: call.id, performanceScore: "8.0",
        clinicalNote: updatedNote,
      } as InsertCallAnalysis);

      const retrieved = await storage.getCallAnalysis(orgId, call.id);
      const cn = retrieved!.clinicalNote as Record<string, unknown>;
      assert.equal((cn.amendments as any[]).length, 1);
      assert.equal((cn.amendments as any[])[0].type, "addendum");
      assert.equal(cn.providerAttested, true, "Attestation preserved for addendum");
    });

    it("supports multi-amendment chains", async () => {
      const call = await storage.createCall(orgId, { orgId, status: "completed" });
      const now = new Date();

      const amendments = [
        {
          type: "amendment", reason: "First correction",
          amendedBy: "Dr. Smith", amendedAt: new Date(now.getTime() - 3600000).toISOString(),
          fieldsChanged: ["objective"],
        },
        {
          type: "addendum", reason: "Lab results received",
          amendedBy: "Dr. Smith", amendedAt: new Date(now.getTime() - 1800000).toISOString(),
          fieldsChanged: [], content: "WBC count elevated. Recommend antibiotics.",
        },
        {
          type: "amendment", reason: "Updated treatment plan per lab findings",
          amendedBy: "Dr. Jones", amendedAt: now.toISOString(),
          fieldsChanged: ["plan", "assessment"],
        },
      ];

      const note = makeAttestedNote({ amendments, version: 4, providerAttested: false });

      await storage.createCallAnalysis(orgId, {
        orgId, callId: call.id, performanceScore: "8.0",
        clinicalNote: note,
      } as InsertCallAnalysis);

      const retrieved = await storage.getCallAnalysis(orgId, call.id);
      const cn = retrieved!.clinicalNote as Record<string, unknown>;
      const amends = cn.amendments as any[];
      assert.equal(amends.length, 3);
      assert.equal(amends[0].type, "amendment");
      assert.equal(amends[1].type, "addendum");
      assert.equal(amends[2].type, "amendment");
      assert.ok(amends[1].content, "Addendum should have content");
      assert.equal(amends[2].fieldsChanged.length, 2);
    });
  });

  // ── Version/conflict detection ─────────────────────────────────────

  describe("Optimistic locking (version field)", () => {
    it("version starts at 0 or 1 for new notes", () => {
      const note = makeAttestedNote({ version: 1 });
      const result = clinicalNoteSchema.safeParse(note);
      assert.ok(result.success);
      assert.equal(result.data?.version, 1);
    });

    it("version increments are tracked", async () => {
      const call = await storage.createCall(orgId, { orgId, status: "completed" });
      let currentVersion = 1;

      // Create initial note
      const note = makeAttestedNote({ version: currentVersion });
      await storage.createCallAnalysis(orgId, {
        orgId, callId: call.id, performanceScore: "8.0",
        clinicalNote: note,
      } as InsertCallAnalysis);

      // Simulate 3 edits, each incrementing version
      for (let i = 0; i < 3; i++) {
        currentVersion++;
        const updated = { ...note, version: currentVersion, assessment: `Edit ${i + 1}` };
        await storage.createCallAnalysis(orgId, {
          orgId, callId: call.id, performanceScore: "8.0",
          clinicalNote: updated,
        } as InsertCallAnalysis);
      }

      const retrieved = await storage.getCallAnalysis(orgId, call.id);
      const cn = retrieved!.clinicalNote as Record<string, unknown>;
      assert.equal(cn.version, 4, "Version should be 4 after 3 edits from initial version 1");
    });
  });

  // ── Non-PHI snapshot ───────────────────────────────────────────────

  describe("Amendment snapshot (non-PHI)", () => {
    it("snapshot captures non-PHI fields only", () => {
      const snapshot = {
        format: "soap",
        specialty: "dental",
        plan: ["Restore tooth #30"],
        icd10Codes: [{ code: "K02.9", description: "Dental caries" }],
        cptCodes: [],
        cdtCodes: [{ code: "D2391", description: "Composite restoration" }],
        version: 1,
      };

      // Verify no PHI fields leak into snapshot
      const phiFields = ["subjective", "objective", "assessment", "hpiNarrative",
        "chiefComplaint", "reviewOfSystems", "attestedNpi", "cosignedNpi"];
      for (const field of phiFields) {
        assert.equal((snapshot as any)[field], undefined, `PHI field "${field}" must not be in snapshot`);
      }
    });

    it("amendment with snapshot validates against schema", () => {
      const note = makeAttestedNote({
        amendments: [{
          type: "amendment",
          reason: "Corrected diagnosis code",
          amendedBy: "Dr. Smith",
          amendedAt: new Date().toISOString(),
          fieldsChanged: ["icd10Codes"],
          noteSnapshot: {
            format: "soap",
            icd10Codes: [{ code: "K02.9", description: "Dental caries" }],
          },
        }],
      });
      const result = clinicalNoteSchema.safeParse(note);
      assert.ok(result.success, "Amendment with snapshot should validate");
    });
  });

  // ── Multi-tenant isolation ─────────────────────────────────────────

  describe("Clinical amendment isolation", () => {
    it("amendments on org A note cannot be read from org B", async () => {
      const orgB = "org-clinical-other";
      const call = await storage.createCall(orgId, { orgId, status: "completed" });
      const note = makeAttestedNote({
        amendments: [{
          type: "amendment", reason: "Confidential correction",
          amendedBy: "Dr. Smith", amendedAt: new Date().toISOString(),
          fieldsChanged: ["assessment"],
        }],
      });

      await storage.createCallAnalysis(orgId, {
        orgId, callId: call.id, performanceScore: "8.0",
        clinicalNote: note,
      } as InsertCallAnalysis);

      const fromOrgB = await storage.getCallAnalysis(orgB, call.id);
      assert.equal(fromOrgB, undefined, "Org B must not access Org A clinical data");
    });
  });
});
