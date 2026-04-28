/**
 * FHIR R4 Resource Builders
 *
 * Converts clinical notes to FHIR R4 resources:
 *   - Patient (from EHR data or clinical note context)
 *   - Practitioner (from attesting provider)
 *   - Encounter (from call/clinical encounter)
 *   - Composition (clinical note with sections)
 *   - DocumentReference (pointing to Composition)
 *
 * Only attested notes should be exported as FHIR (enforced in the route layer).
 *
 * References:
 *   - FHIR R4: https://hl7.org/fhir/R4/
 *   - US Core: https://hl7.org/fhir/us/core/
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

// ─── Patient resource ────────────────────────────────────────────────────────

/**
 * Build a FHIR R4 Patient resource from available patient context.
 * Returns null if no patient identifying info is available.
 */
export function buildFhirPatient(params: {
  patientId?: string;
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
  phone?: string;
  email?: string;
}): object | null {
  const { patientId, firstName, lastName, dateOfBirth, phone, email } = params;
  // Need at minimum a name or identifier to create a useful Patient resource
  if (!firstName && !lastName && !patientId) return null;

  const patient: Record<string, unknown> = {
    resourceType: "Patient",
    id: patientId || randomUUID(),
  };

  if (firstName || lastName) {
    patient.name = [
      {
        use: "official",
        family: lastName || undefined,
        given: firstName ? [firstName] : undefined,
      },
    ];
  }

  if (dateOfBirth) {
    patient.birthDate = dateOfBirth;
  }

  const telecom: object[] = [];
  if (phone) {
    telecom.push({ system: "phone", value: phone, use: "home" });
  }
  if (email) {
    telecom.push({ system: "email", value: email });
  }
  if (telecom.length > 0) patient.telecom = telecom;

  return patient;
}

// ─── Practitioner resource ───────────────────────────────────────────────────

/**
 * Build a FHIR R4 Practitioner resource from provider info.
 */
export function buildFhirPractitioner(params: {
  providerName: string;
  npi?: string;
  cosigner?: { name: string; npi?: string; credentials?: string };
}): object {
  const { providerName, npi, cosigner } = params;
  const [given, ...familyParts] = providerName.split(" ");
  const family = familyParts.join(" ") || given;

  const practitioner: Record<string, unknown> = {
    resourceType: "Practitioner",
    id: `practitioner-${npi || randomUUID()}`,
    name: [
      {
        use: "official",
        family,
        given: familyParts.length > 0 ? [given] : undefined,
        text: providerName,
      },
    ],
  };

  const identifiers: object[] = [];
  if (npi) {
    identifiers.push({
      system: "http://hl7.org/fhir/sid/us-npi",
      value: npi,
    });
  }
  if (identifiers.length > 0) practitioner.identifier = identifiers;

  // If there's a cosigner, add their NPI to identifiers and create a qualification entry
  if (cosigner) {
    if (cosigner.npi) {
      identifiers.push({
        system: "http://hl7.org/fhir/sid/us-npi",
        value: cosigner.npi,
        type: { text: "Cosigner NPI" },
      });
      // Update identifiers on practitioner (may have been set above for primary NPI)
      practitioner.identifier = identifiers;
    }
    practitioner.qualification = [
      {
        code: {
          text: cosigner.credentials || "Supervising Provider",
        },
      },
    ];
  }

  return practitioner;
}

// ─── Encounter resource ──────────────────────────────────────────────────────

/**
 * Build a FHIR R4 Encounter resource representing the clinical encounter.
 */
export function buildFhirEncounter(params: {
  encounterId: string;
  patientId?: string;
  practitionerId?: string;
  encounterDate: string;
  encounterType?: string; // e.g., "ambulatory", "inpatient", "emergency"
  specialty?: string;
}): object {
  const { encounterId, patientId, practitionerId, encounterDate, encounterType, specialty } = params;

  const encounter: Record<string, unknown> = {
    resourceType: "Encounter",
    id: encounterId,
    status: "finished",
    class: {
      system: "http://terminology.hl7.org/CodeSystem/v3-ActCode",
      code: encounterType === "inpatient" ? "IMP" : "AMB",
      display: encounterType === "inpatient" ? "Inpatient" : "Ambulatory",
    },
    period: {
      start: encounterDate,
      end: encounterDate,
    },
  };

  if (patientId) {
    encounter.subject = { reference: `Patient/${patientId}` };
  }

  if (practitionerId) {
    encounter.participant = [
      {
        type: [
          {
            coding: [
              {
                system: "http://terminology.hl7.org/CodeSystem/v3-ParticipationType",
                code: "PPRF",
                display: "Primary performer",
              },
            ],
          },
        ],
        individual: { reference: `Practitioner/${practitionerId}` },
      },
    ];
  }

  if (specialty) {
    encounter.type = [
      {
        text: specialty,
      },
    ];
  }

  return encounter;
}

// ─── Composition resource ────────────────────────────────────────────────────

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
  patientId?: string;
  practitionerId?: string;
}): object {
  const { note, callId, orgName, providerName, npi, encounterId, patientId, practitionerId } = params;
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

  // ICD-10 codes → FHIR diagnosis section with optional linkage
  const icd10Codes = note.icd10Codes as
    | Array<{ code: string; description: string; linkedDiagnosis?: string; isPrimary?: boolean }>
    | undefined;
  if (icd10Codes && icd10Codes.length > 0) {
    const diagText = icd10Codes
      .map((c) => {
        let line = `${c.code}: ${c.description}`;
        if (c.isPrimary) line = `[PRIMARY] ${line}`;
        if (c.linkedDiagnosis) line += ` → ${c.linkedDiagnosis}`;
        return line;
      })
      .join("\n");
    sections.push(buildSection("Diagnoses", diagText, "29548-5"));
  }

  // Prescriptions section
  const prescriptions = note.prescriptions as
    | Array<{ medication: string; dosage?: string; instructions?: string }>
    | undefined;
  if (prescriptions && prescriptions.length > 0) {
    const rxText = prescriptions
      .map(
        (rx) => `${rx.medication}${rx.dosage ? ` ${rx.dosage}` : ""}${rx.instructions ? ` — ${rx.instructions}` : ""}`,
      )
      .join("\n");
    sections.push(buildSection("Medications / Prescriptions", rxText, "10160-0"));
  }

  // Build the Composition resource
  const composition: Record<string, unknown> = {
    resourceType: "Composition",
    id: callId,
    meta: {
      // US Core Clinical Notes profile for Composition (not DocumentReference)
      profile: ["http://hl7.org/fhir/us/core/StructureDefinition/us-core-clinical-note"],
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
    author: practitionerId ? [{ reference: `Practitioner/${practitionerId}`, display: providerName }] : [author],
    title: "Clinical Note",
    custodian: {
      display: orgName,
    },
    section: sections,
    attester: [
      {
        mode: "professional",
        time: attestedAt,
        party: practitionerId
          ? { reference: `Practitioner/${practitionerId}`, display: providerName }
          : { display: providerName },
      },
    ],
  };

  // US Core requires subject on Composition — use patient reference if available,
  // otherwise add a placeholder unknown patient to satisfy FHIR R4 validation.
  if (patientId) {
    composition.subject = { reference: `Patient/${patientId}` };
  } else {
    composition.subject = { display: "Unknown patient (no EHR link)" };
  }

  // Link to Encounter
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
 * Build a FHIR R4 Bundle containing all clinical resources.
 *
 * The bundle includes (when data is available):
 *   - Patient (from EHR or clinical note context)
 *   - Practitioner (from attesting provider)
 *   - Encounter (representing the clinical encounter)
 *   - Composition (the clinical note with sections)
 *   - DocumentReference (pointing to Composition)
 *
 * Returns a document bundle suitable for export to EHR systems.
 */
export function buildFhirBundle(params: {
  note: Record<string, unknown>;
  callId: string;
  orgName: string;
  providerName: string;
  npi?: string;
  /** Patient demographics from EHR integration (optional) */
  patient?: {
    id?: string;
    firstName?: string;
    lastName?: string;
    dateOfBirth?: string;
    phone?: string;
    email?: string;
  };
  /** Cosigning provider info (optional) */
  cosigner?: { name: string; npi?: string; credentials?: string };
  /** Encounter date (defaults to attestation date) */
  encounterDate?: string;
}): object {
  const entries: Array<{ fullUrl: string; resource: object }> = [];

  // 1. Build Practitioner
  const practitioner = buildFhirPractitioner({
    providerName: params.providerName,
    npi: params.npi,
    cosigner: params.cosigner,
  });
  const practitionerId = (practitioner as Record<string, unknown>).id as string;
  entries.push({ fullUrl: `urn:uuid:${practitionerId}`, resource: practitioner });

  // 2. Build Patient (if data available)
  let patientId: string | undefined;
  if (params.patient) {
    const patient = buildFhirPatient(params.patient);
    if (patient) {
      patientId = (patient as Record<string, unknown>).id as string;
      entries.push({ fullUrl: `urn:uuid:${patientId}`, resource: patient });
    }
  }

  // 3. Build Encounter
  const encounterId = `encounter-${params.callId}`;
  const encounterDate = params.encounterDate || (params.note.attestedAt as string) || new Date().toISOString();
  const encounter = buildFhirEncounter({
    encounterId,
    patientId,
    practitionerId,
    encounterDate,
    specialty: params.note.specialty as string | undefined,
  });
  entries.push({ fullUrl: `urn:uuid:${encounterId}`, resource: encounter });

  // 4. Build Composition (the clinical note)
  const composition = buildFhirComposition({
    ...params,
    encounterId,
    patientId,
    practitionerId,
  });
  const compositionId = (composition as Record<string, unknown>).id as string;
  entries.push({ fullUrl: `urn:uuid:${compositionId}`, resource: composition });

  // 5. Build DocumentReference
  const docRef = buildFhirDocumentReference({
    compositionId,
    callId: params.callId,
    note: params.note,
    orgName: params.orgName,
    providerName: params.providerName,
  });
  entries.push({ fullUrl: `urn:uuid:${randomUUID()}`, resource: docRef });

  return {
    resourceType: "Bundle",
    id: randomUUID(),
    type: "document",
    timestamp: new Date().toISOString(),
    meta: {
      profile: ["http://hl7.org/fhir/us/core/StructureDefinition/us-core-documentreference"],
    },
    entry: entries,
  };
}
