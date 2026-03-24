/**
 * FHIR R4 Resource Builders
 *
 * Converts clinical notes to FHIR R4 Composition + DocumentReference resources.
 * Only attested notes should be exported as FHIR (enforced in the route layer).
 *
 * References:
 *   - FHIR R4: https://hl7.org/fhir/R4/
 *   - LOINC codes for note types: https://loinc.org/
 */

import { randomUUID } from "crypto";

// LOINC codes for clinical note types
const FORMAT_LOINC: Record<string, { code: string; display: string }> = {
  soap: { code: "11506-3", display: "Progress note" },
  dap: { code: "11506-3", display: "Progress note" },
  birp: { code: "34764-1", display: "Behavioral health progress note" },
  hpi_focused: { code: "11492-5", display: "History and physical note" },
  procedure_note: { code: "28570-0", display: "Procedure note" },
  progress_note: { code: "11506-3", display: "Progress note" },
  dental_exam: { code: "34139-6", display: "Dentistry Examination note" },
  dental_operative: { code: "28570-0", display: "Procedure note" },
  dental_perio: { code: "34139-6", display: "Dentistry Examination note" },
  dental_endo: { code: "28570-0", display: "Procedure note" },
  dental_ortho_progress: { code: "11506-3", display: "Progress note" },
  dental_surgery: { code: "28570-0", display: "Procedure note" },
  dental_treatment_plan: { code: "34764-1", display: "General medicine Consultation note" },
};

/** Escape string for XHTML text.div content (FHIR requirement) */
function escapeXhtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\n/g, "<br/>");
}

/** Build a FHIR Narrative (xhtml) from plain text */
function buildNarrative(text: string): { status: string; div: string } {
  return {
    status: "generated",
    div: `<div xmlns="http://www.w3.org/1999/xhtml"><p>${escapeXhtml(text)}</p></div>`,
  };
}

/** Build a FHIR section from a label and text content */
function buildSection(title: string, content: string, loincCode?: string): object {
  const section: Record<string, unknown> = {
    title,
    text: buildNarrative(content),
  };
  if (loincCode) {
    section.code = {
      coding: [{ system: "http://loinc.org", code: loincCode, display: title }],
    };
  }
  return section;
}

/**
 * Build a FHIR R4 Composition resource from a clinical note.
 * The note must be decrypted before passing to this function.
 */
export function buildFhirComposition(params: {
  note: Record<string, unknown>;
  callId: string;
  orgName: string;
  providerName: string;
  npi?: string;
  encounterId?: string;
}): object {
  const { note, callId, orgName, providerName, npi, encounterId } = params;
  const format = (note.format as string) || "soap";
  const loinc = FORMAT_LOINC[format] || FORMAT_LOINC.soap;
  const attestedAt = (note.attestedAt as string) || new Date().toISOString();

  // Build author reference
  const author: Record<string, unknown> = { display: providerName };
  if (npi) {
    author.identifier = {
      system: "http://hl7.org/fhir/sid/us-npi",
      value: npi,
    };
  }

  // Build sections from non-empty note fields
  const sections: object[] = [];

  if (note.chiefComplaint) {
    sections.push(buildSection("Chief Complaint", note.chiefComplaint as string, "10154-3"));
  }
  if (note.subjective) {
    sections.push(buildSection("Subjective", note.subjective as string, "61150-9"));
  }
  if (note.hpiNarrative) {
    sections.push(buildSection("History of Present Illness", note.hpiNarrative as string, "10164-2"));
  }
  if (note.objective) {
    sections.push(buildSection("Objective", note.objective as string, "61149-1"));
  }
  if (note.data) {
    sections.push(buildSection("Data", note.data as string, "61150-9")); // DAP format
  }
  if (note.behavior) {
    sections.push(buildSection("Behavior", note.behavior as string));
  }
  if (note.intervention) {
    sections.push(buildSection("Intervention", note.intervention as string));
  }
  if (note.response) {
    sections.push(buildSection("Response", note.response as string));
  }
  if (note.assessment) {
    sections.push(buildSection("Assessment", note.assessment as string, "51848-0"));
  }
  if (note.plan && Array.isArray(note.plan) && (note.plan as string[]).length > 0) {
    const planText = (note.plan as string[]).map((p, i) => `${i + 1}. ${p}`).join("\n");
    sections.push(buildSection("Plan", planText, "18776-5"));
  }
  if (note.followUp) {
    sections.push(buildSection("Follow-up", note.followUp as string));
  }

  // ICD-10 codes → FHIR diagnosis section
  const icd10Codes = note.icd10Codes as Array<{ code: string; description: string }> | undefined;
  if (icd10Codes && icd10Codes.length > 0) {
    const diagText = icd10Codes.map(c => `${c.code}: ${c.description}`).join("\n");
    sections.push(buildSection("Diagnoses", diagText, "29548-5"));
  }

  // Prescriptions section
  const prescriptions = note.prescriptions as Array<{ medication: string; dosage?: string; instructions?: string }> | undefined;
  if (prescriptions && prescriptions.length > 0) {
    const rxText = prescriptions.map(rx => `${rx.medication}${rx.dosage ? ` ${rx.dosage}` : ""}${rx.instructions ? ` — ${rx.instructions}` : ""}`).join("\n");
    sections.push(buildSection("Medications / Prescriptions", rxText, "10160-0"));
  }

  // Build the Composition resource
  const composition: Record<string, unknown> = {
    resourceType: "Composition",
    id: callId,
    meta: {
      profile: ["http://hl7.org/fhir/us/core/StructureDefinition/us-core-documentreference"],
    },
    status: "final",
    type: {
      coding: [
        {
          system: "http://loinc.org",
          code: loinc.code,
          display: loinc.display,
        },
      ],
      text: loinc.display,
    },
    date: attestedAt,
    author: [author],
    title: "Clinical Note",
    custodian: {
      display: orgName,
    },
    section: sections,
    attester: [
      {
        mode: "professional",
        time: attestedAt,
        party: { display: providerName },
      },
    ],
  };

  if (encounterId) {
    composition.encounter = { reference: `Encounter/${encounterId}` };
  }

  if (note.cosignature) {
    const cosig = note.cosignature as { cosignedBy: string; cosignedAt: string; role?: string };
    (composition.attester as unknown[]).push({
      mode: "professional",
      time: cosig.cosignedAt,
      party: { display: `${cosig.cosignedBy}${cosig.role ? ` (${cosig.role})` : ""}` },
    });
  }

  return composition;
}

/**
 * Build a FHIR R4 DocumentReference resource pointing to a Composition.
 */
export function buildFhirDocumentReference(params: {
  compositionId: string;
  callId: string;
  note: Record<string, unknown>;
  orgName: string;
  providerName: string;
}): object {
  const { compositionId, callId, note, orgName, providerName } = params;
  const format = (note.format as string) || "soap";
  const loinc = FORMAT_LOINC[format] || FORMAT_LOINC.soap;
  const attestedAt = (note.attestedAt as string) || new Date().toISOString();

  return {
    resourceType: "DocumentReference",
    id: `docref-${callId}`,
    status: "current",
    type: {
      coding: [
        {
          system: "http://loinc.org",
          code: loinc.code,
          display: loinc.display,
        },
      ],
    },
    date: attestedAt,
    author: [{ display: providerName }],
    custodian: { display: orgName },
    content: [
      {
        attachment: {
          contentType: "application/fhir+json",
          url: `urn:uuid:${compositionId}`,
          title: "Clinical Note",
          creation: attestedAt,
        },
      },
    ],
  };
}

/**
 * Build a FHIR R4 Bundle containing a Composition and DocumentReference.
 * Returns a searchset bundle suitable for export to EHR systems.
 */
export function buildFhirBundle(params: {
  note: Record<string, unknown>;
  callId: string;
  orgName: string;
  providerName: string;
  npi?: string;
}): object {
  const composition = buildFhirComposition(params);
  const compositionId = (composition as Record<string, unknown>).id as string;
  const docRef = buildFhirDocumentReference({
    compositionId,
    callId: params.callId,
    note: params.note,
    orgName: params.orgName,
    providerName: params.providerName,
  });

  return {
    resourceType: "Bundle",
    id: randomUUID(),
    type: "document",
    timestamp: new Date().toISOString(),
    meta: {
      profile: ["http://hl7.org/fhir/us/core/StructureDefinition/us-core-documentreference"],
    },
    entry: [
      {
        fullUrl: `urn:uuid:${compositionId}`,
        resource: composition,
      },
      {
        fullUrl: `urn:uuid:${randomUUID()}`,
        resource: docRef,
      },
    ],
  };
}
