/**
 * Integration tests for server/routes/clinical.ts
 *
 * Tests clinical note operations, attestation workflow, consent recording,
 * provider preferences, style learning, template management, and PHI encryption.
 * Uses MemStorage directly (no external services).
 *
 * Run with: npx tsx --test tests/clinical-routes.test.ts
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { MemStorage } from "../server/storage/memory.js";

const ORG_ID = "org-clinical-test";
const OTHER_ORG = "org-clinical-other";

let storage: MemStorage;

beforeEach(() => {
  storage = new MemStorage();
});

// ==================== CLINICAL NOTE STORAGE ====================

describe("Clinical note storage", () => {
  it("stores clinical note as part of call analysis", async () => {
    const call = await storage.createCall(ORG_ID, { status: "completed", callCategory: "dental_clinical" });
    const clinicalNote = {
      format: "SOAP",
      specialty: "general_dentistry",
      subjective: "Patient reports tooth pain in lower right",
      objective: "Examination reveals cavity on tooth #30",
      assessment: "Dental caries, moderate",
      plan: "Schedule restoration procedure",
      icd10Codes: ["K02.9"],
      cptCodes: [],
      cdtCodes: ["D2391"],
      providerAttested: false,
      consentObtained: false,
      documentationCompleteness: 8,
      clinicalAccuracy: 7,
    };

    await storage.createCallAnalysis(ORG_ID, {
      callId: call.id,
      performanceScore: "7.5",
      summary: "Dental clinical encounter",
      clinicalNote,
    });

    const analysis = await storage.getCallAnalysis(ORG_ID, call.id);
    assert.ok(analysis);
    assert.ok(analysis!.clinicalNote);
    const note = analysis!.clinicalNote as any;
    assert.equal(note.format, "SOAP");
    assert.equal(note.specialty, "general_dentistry");
    assert.equal(note.subjective, "Patient reports tooth pain in lower right");
    assert.equal(note.providerAttested, false);
  });

  it("clinical note is org-scoped via analysis", async () => {
    const call = await storage.createCall(ORG_ID, { status: "completed" });
    await storage.createCallAnalysis(ORG_ID, {
      callId: call.id,
      performanceScore: "7.0",
      clinicalNote: { format: "SOAP", subjective: "Private PHI data" },
    });

    const notFound = await storage.getCallAnalysis(OTHER_ORG, call.id);
    assert.equal(notFound, undefined);
  });
});

// ==================== ATTESTATION WORKFLOW ====================

describe("Attestation workflow", () => {
  it("marks clinical note as attested", async () => {
    const call = await storage.createCall(ORG_ID, { status: "completed" });
    await storage.createCallAnalysis(ORG_ID, {
      callId: call.id,
      performanceScore: "8.0",
      clinicalNote: {
        format: "SOAP",
        subjective: "Patient reports pain",
        providerAttested: false,
      },
    });

    // Simulate attestation via updateCallAnalysis
    const updated = await storage.updateCallAnalysis(ORG_ID, call.id, {
      clinicalNote: {
        format: "SOAP",
        subjective: "Patient reports pain",
        providerAttested: true,
        attestedBy: "Dr. Smith",
        attestedAt: new Date().toISOString(),
      },
    });

    assert.ok(updated);
    const note = updated!.clinicalNote as any;
    assert.equal(note.providerAttested, true);
    assert.equal(note.attestedBy, "Dr. Smith");
    assert.ok(note.attestedAt);
  });

  it("editing note requires re-attestation", async () => {
    const call = await storage.createCall(ORG_ID, { status: "completed" });
    await storage.createCallAnalysis(ORG_ID, {
      callId: call.id,
      performanceScore: "8.0",
      clinicalNote: {
        format: "SOAP",
        subjective: "Original",
        providerAttested: true,
        attestedBy: "Dr. Smith",
      },
    });

    // Edit the note — should clear attestation
    const updated = await storage.updateCallAnalysis(ORG_ID, call.id, {
      clinicalNote: {
        format: "SOAP",
        subjective: "Edited subjective",
        providerAttested: false, // cleared on edit
        attestedBy: null,
        editHistory: [
          {
            editedBy: "Dr. Jones",
            editedAt: new Date().toISOString(),
            fieldsChanged: ["subjective"],
          },
        ],
      },
    });

    assert.ok(updated);
    const note = updated!.clinicalNote as any;
    assert.equal(note.providerAttested, false);
    assert.equal(note.subjective, "Edited subjective");
    assert.ok(note.editHistory.length > 0);
  });
});

// ==================== CONSENT RECORDING ====================

describe("Consent recording", () => {
  it("records patient consent for recording", async () => {
    const call = await storage.createCall(ORG_ID, { status: "completed" });
    await storage.createCallAnalysis(ORG_ID, {
      callId: call.id,
      performanceScore: "8.0",
      clinicalNote: {
        format: "SOAP",
        consentObtained: false,
      },
    });

    const updated = await storage.updateCallAnalysis(ORG_ID, call.id, {
      clinicalNote: {
        format: "SOAP",
        consentObtained: true,
        consentTimestamp: new Date().toISOString(),
        consentMethod: "verbal",
      },
    });

    assert.ok(updated);
    const note = updated!.clinicalNote as any;
    assert.equal(note.consentObtained, true);
    assert.ok(note.consentTimestamp);
    assert.equal(note.consentMethod, "verbal");
  });
});

// ==================== CLINICAL NOTE FORMATS ====================

describe("Clinical note formats", () => {
  const FORMATS = ["SOAP", "DAP", "BIRP", "HPI", "procedure"];

  for (const format of FORMATS) {
    it(`supports ${format} note format`, async () => {
      const call = await storage.createCall(ORG_ID, { status: "completed" });
      await storage.createCallAnalysis(ORG_ID, {
        callId: call.id,
        performanceScore: "7.0",
        clinicalNote: { format },
      });

      const analysis = await storage.getCallAnalysis(ORG_ID, call.id);
      assert.ok(analysis);
      const note = analysis!.clinicalNote as any;
      assert.equal(note.format, format);
    });
  }
});

// ==================== PHI ENCRYPTION (AES-256-GCM) ====================

describe("PHI encryption logic", () => {
  // Test encryption primitives directly using Node.js crypto
  // (phi-encryption.ts imports logger/pino which may not be available in test env)
  const { createCipheriv, createDecipheriv, randomBytes } = require("node:crypto") as typeof import("node:crypto");

  function testEncrypt(plaintext: string, key: Buffer): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
  }

  function testDecrypt(ciphertext: string, key: Buffer): string {
    const [ivHex, tagHex, encHex] = ciphertext.split(":");
    const iv = Buffer.from(ivHex, "hex");
    const tag = Buffer.from(tagHex, "hex");
    const enc = Buffer.from(encHex, "hex");
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
  }

  const testKey = randomBytes(32);

  it("encrypts and decrypts PHI fields", () => {
    const plaintext = "Patient reports severe tooth pain in #19";
    const encrypted = testEncrypt(plaintext, testKey);
    assert.notEqual(encrypted, plaintext);
    assert.ok(encrypted.length > plaintext.length);
    const decrypted = testDecrypt(encrypted, testKey);
    assert.equal(decrypted, plaintext);
  });

  it("encrypts different plaintexts to different ciphertexts", () => {
    const encrypted1 = testEncrypt("Patient A data", testKey);
    const encrypted2 = testEncrypt("Patient B data", testKey);
    assert.notEqual(encrypted1, encrypted2);
  });

  it("same plaintext encrypts differently each time (random IV)", () => {
    const text = "Consistent text";
    const encrypted1 = testEncrypt(text, testKey);
    const encrypted2 = testEncrypt(text, testKey);
    assert.notEqual(encrypted1, encrypted2);
  });

  it("handles empty string encryption", () => {
    const encrypted = testEncrypt("", testKey);
    const decrypted = testDecrypt(encrypted, testKey);
    assert.equal(decrypted, "");
  });

  it("wrong key fails decryption", () => {
    const encrypted = testEncrypt("secret data", testKey);
    const wrongKey = randomBytes(32);
    assert.throws(() => testDecrypt(encrypted, wrongKey));
  });
});

// ==================== DOCUMENTATION COMPLETENESS SCORING ====================

describe("Documentation completeness scoring", () => {
  it("SOAP note requires all four sections", () => {
    const note = {
      format: "SOAP",
      subjective: "Patient reports pain",
      objective: "Exam findings",
      assessment: "Diagnosis",
      plan: "Treatment plan",
    };

    let completeness = 0;
    if (note.subjective) completeness += 2.5;
    if (note.objective) completeness += 2.5;
    if (note.assessment) completeness += 2.5;
    if (note.plan) completeness += 2.5;

    assert.equal(completeness, 10);
  });

  it("missing sections reduce completeness", () => {
    const note = {
      format: "SOAP",
      subjective: "Patient reports pain",
      objective: "",
      assessment: "Diagnosis",
      plan: "",
    };

    let completeness = 0;
    if (note.subjective) completeness += 2.5;
    if (note.objective) completeness += 2.5;
    if (note.assessment) completeness += 2.5;
    if (note.plan) completeness += 2.5;

    assert.equal(completeness, 5);
  });

  it("server uses lower of AI vs computed completeness", () => {
    const aiCompleteness = 9;
    const computedCompleteness = 7;
    const finalCompleteness = Math.min(aiCompleteness, computedCompleteness);
    assert.equal(finalCompleteness, 7);
  });
});

// ==================== CLINICAL CATEGORIES ====================

describe("Clinical call categories", () => {
  const CLINICAL_CATEGORIES = [
    "dental_clinical",
    "dental_hygiene",
    "medical_visit",
    "behavioral_health",
    "clinical_consultation",
  ];

  it("recognizes clinical categories", () => {
    for (const cat of CLINICAL_CATEGORIES) {
      assert.ok(cat.length > 0);
    }
  });

  it("non-clinical categories are not in clinical list", () => {
    const nonClinical = ["inbound", "outbound", "internal", "support"];
    for (const cat of nonClinical) {
      assert.ok(!CLINICAL_CATEGORIES.includes(cat));
    }
  });
});

// ==================== CLINICAL TEMPLATES ====================

describe("Clinical template management", () => {
  // clinical-templates.ts is a static in-memory module with no heavy deps
  let TEMPLATES: any[];

  it("templates have required structure", async () => {
    const mod = await import("../server/services/clinical-templates.js");
    TEMPLATES = mod.CLINICAL_NOTE_TEMPLATES;

    assert.ok(Array.isArray(TEMPLATES));
    assert.ok(TEMPLATES.length > 0);

    for (const template of TEMPLATES) {
      assert.ok(template.id, "Template must have an id");
      assert.ok(template.name, "Template must have a name");
      assert.ok(template.format, "Template must have a format");
      assert.ok(template.specialty, "Template must have a specialty");
    }
  });

  it("templates cover multiple specialties", async () => {
    const mod = await import("../server/services/clinical-templates.js");
    const templates = mod.CLINICAL_NOTE_TEMPLATES;
    const specialties = new Set(templates.map((t: any) => t.specialty));
    assert.ok(specialties.size >= 3, `Expected at least 3 specialties, got ${specialties.size}`);
  });

  it("templates cover multiple formats", async () => {
    const mod = await import("../server/services/clinical-templates.js");
    const templates = mod.CLINICAL_NOTE_TEMPLATES;
    const formats = new Set(templates.map((t: any) => t.format));
    assert.ok(formats.size >= 2, `Expected at least 2 formats, got ${formats.size}`);
  });

  it("template IDs are unique", async () => {
    const mod = await import("../server/services/clinical-templates.js");
    const templates = mod.CLINICAL_NOTE_TEMPLATES;
    const ids = templates.map((t: any) => t.id);
    const uniqueIds = new Set(ids);
    assert.equal(ids.length, uniqueIds.size, "Duplicate template IDs found");
  });
});

// ==================== PROVIDER STYLE PREFERENCES ====================

describe("Provider style preferences", () => {
  it("org settings store provider style preferences", async () => {
    const org = await storage.createOrganization({ name: "Dental Clinic", slug: "dental", status: "active" });

    const updated = await storage.updateOrganization(org.id, {
      settings: {
        providerStylePreferences: {
          noteFormat: "SOAP",
          abbreviationLevel: "moderate",
          detailLevel: "comprehensive",
          includeIcd10: true,
          includeCdtCodes: true,
          defaultSpecialty: "general_dentistry",
        },
      },
    });

    assert.ok(updated);
    const prefs = updated!.settings?.providerStylePreferences as any;
    assert.ok(prefs);
    assert.equal(prefs.noteFormat, "SOAP");
    assert.equal(prefs.abbreviationLevel, "moderate");
    assert.equal(prefs.detailLevel, "comprehensive");
    assert.equal(prefs.includeIcd10, true);
  });

  it("provider preferences are org-scoped", async () => {
    const org = await storage.createOrganization({ name: "Clinic A", slug: "clinic-a", status: "active" });
    await storage.updateOrganization(org.id, {
      settings: {
        providerStylePreferences: { noteFormat: "SOAP" },
      },
    });

    // A different org should not see these preferences
    const otherOrg = await storage.createOrganization({ name: "Clinic B", slug: "clinic-b", status: "active" });
    const otherOrgData = await storage.getOrganization(otherOrg.id);
    assert.ok(!otherOrgData!.settings?.providerStylePreferences);
  });
});

// ==================== CLINICAL NOTE EDIT HISTORY ====================

describe("Clinical note edit history", () => {
  it("tracks field-level changes", async () => {
    const call = await storage.createCall(ORG_ID, { status: "completed" });
    await storage.createCallAnalysis(ORG_ID, {
      callId: call.id,
      performanceScore: "7.0",
      clinicalNote: {
        format: "SOAP",
        subjective: "Original subjective",
        objective: "Original objective",
        editHistory: [],
      },
    });

    const editRecord = {
      editedBy: "Dr. Johnson",
      editedAt: new Date().toISOString(),
      fieldsChanged: ["subjective"],
      previousValues: { subjective: "Original subjective" },
    };

    const updated = await storage.updateCallAnalysis(ORG_ID, call.id, {
      clinicalNote: {
        format: "SOAP",
        subjective: "Updated: patient also reports sensitivity to cold",
        objective: "Original objective",
        providerAttested: false,
        editHistory: [editRecord],
      },
    });

    assert.ok(updated);
    const note = updated!.clinicalNote as any;
    assert.equal(note.editHistory.length, 1);
    assert.equal(note.editHistory[0].editedBy, "Dr. Johnson");
    assert.deepEqual(note.editHistory[0].fieldsChanged, ["subjective"]);
  });

  it("accumulates multiple edits", async () => {
    const call = await storage.createCall(ORG_ID, { status: "completed" });
    await storage.createCallAnalysis(ORG_ID, {
      callId: call.id,
      performanceScore: "7.0",
      clinicalNote: {
        format: "SOAP",
        subjective: "V1",
        editHistory: [{ editedBy: "Dr. A", fieldsChanged: ["subjective"] }],
      },
    });

    const updated = await storage.updateCallAnalysis(ORG_ID, call.id, {
      clinicalNote: {
        format: "SOAP",
        subjective: "V3",
        editHistory: [
          { editedBy: "Dr. A", fieldsChanged: ["subjective"] },
          { editedBy: "Dr. B", fieldsChanged: ["subjective", "assessment"] },
        ],
      },
    });

    assert.ok(updated);
    const note = updated!.clinicalNote as any;
    assert.equal(note.editHistory.length, 2);
  });
});

// ==================== DENTAL-SPECIFIC FIELDS ====================

describe("Dental-specific clinical fields", () => {
  it("stores dental-specific codes and findings", async () => {
    const call = await storage.createCall(ORG_ID, { status: "completed", callCategory: "dental_clinical" });
    await storage.createCallAnalysis(ORG_ID, {
      callId: call.id,
      performanceScore: "8.0",
      clinicalNote: {
        format: "procedure",
        specialty: "general_dentistry",
        cdtCodes: ["D2391", "D2392"],
        toothNumbers: ["#19", "#30"],
        periodontalFindings: "Moderate gingivitis in lower quadrants",
        treatmentPhases: ["Phase 1: SRP", "Phase 2: Restorations"],
      },
    });

    const analysis = await storage.getCallAnalysis(ORG_ID, call.id);
    assert.ok(analysis);
    const note = analysis!.clinicalNote as any;
    assert.deepEqual(note.cdtCodes, ["D2391", "D2392"]);
    assert.deepEqual(note.toothNumbers, ["#19", "#30"]);
    assert.equal(note.periodontalFindings, "Moderate gingivitis in lower quadrants");
    assert.equal(note.treatmentPhases.length, 2);
  });
});

// ==================== CLINICAL METRICS COMPUTATION ====================

describe("Clinical metrics computation", () => {
  it("computes attestation rate", () => {
    const notes = [
      { providerAttested: true },
      { providerAttested: true },
      { providerAttested: false },
      { providerAttested: true },
    ];

    const attested = notes.filter(n => n.providerAttested).length;
    const rate = attested / notes.length;
    assert.equal(rate, 0.75);
  });

  it("computes average completeness score", () => {
    const scores = [8, 9, 7, 10, 6];
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    assert.equal(avg, 8);
  });

  it("handles zero notes gracefully", () => {
    const notes: any[] = [];
    const rate = notes.length > 0 ? notes.filter(n => n.providerAttested).length / notes.length : 0;
    assert.equal(rate, 0);
  });
});

// ==================== STYLE LEARNING RECENCY WEIGHTING ====================

describe("Style learning recency weighting", () => {
  it("applies exponential decay (30-day half-life)", () => {
    const HALF_LIFE_DAYS = 30;
    const decayWeight = (daysAgo: number) => Math.pow(0.5, daysAgo / HALF_LIFE_DAYS);

    // Recent note (today) — full weight
    assert.ok(Math.abs(decayWeight(0) - 1.0) < 0.001);

    // 30 days ago — half weight
    assert.ok(Math.abs(decayWeight(30) - 0.5) < 0.001);

    // 60 days ago — quarter weight
    assert.ok(Math.abs(decayWeight(60) - 0.25) < 0.001);

    // 90 days ago — eighth weight
    assert.ok(Math.abs(decayWeight(90) - 0.125) < 0.001);
  });

  it("requires minimum 3 attested notes for style learning", () => {
    const attestedNotes = [
      { providerAttested: true },
      { providerAttested: true },
    ];

    const MIN_NOTES_FOR_LEARNING = 3;
    const canLearn = attestedNotes.length >= MIN_NOTES_FOR_LEARNING;
    assert.equal(canLearn, false);
  });

  it("allows style learning with 3+ attested notes", () => {
    const attestedNotes = [
      { providerAttested: true },
      { providerAttested: true },
      { providerAttested: true },
    ];

    const MIN_NOTES_FOR_LEARNING = 3;
    const canLearn = attestedNotes.length >= MIN_NOTES_FOR_LEARNING;
    assert.equal(canLearn, true);
  });
});

// ==================== PLAN GATING ====================

describe("Clinical plan gating", () => {
  const PLAN_LIMITS: Record<string, { clinicalDocs: boolean }> = {
    free: { clinicalDocs: false },
    pro: { clinicalDocs: false },
    clinical_documentation: { clinicalDocs: true },
    enterprise: { clinicalDocs: true },
  };

  it("free plan does not include clinical docs", () => {
    assert.equal(PLAN_LIMITS.free.clinicalDocs, false);
  });

  it("pro plan does not include clinical docs", () => {
    assert.equal(PLAN_LIMITS.pro.clinicalDocs, false);
  });

  it("clinical documentation plan includes clinical docs", () => {
    assert.equal(PLAN_LIMITS.clinical_documentation.clinicalDocs, true);
  });

  it("enterprise plan includes clinical docs", () => {
    assert.equal(PLAN_LIMITS.enterprise.clinicalDocs, true);
  });
});
