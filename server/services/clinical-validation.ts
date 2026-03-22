/**
 * Clinical Note Validation & Utilities
 *
 * Post-generation validation for clinical notes: verifies required sections
 * per format, sanitizes provider style preferences, computes completeness,
 * and provides specialty-to-format mapping.
 */

import { logger } from "./logger";

// --- Required sections per note format ---

const REQUIRED_SECTIONS: Record<string, string[]> = {
  soap: ["chiefComplaint", "subjective", "objective", "assessment", "plan"],
  dap: ["chiefComplaint", "data", "assessment", "plan"],
  birp: ["chiefComplaint", "behavior", "intervention", "response", "plan"],
  hpi_focused: ["chiefComplaint", "hpiNarrative", "assessment", "plan"],
  procedure_note: ["chiefComplaint", "objective", "assessment", "plan"],
};

// --- Specialty → recommended format mapping ---

const SPECIALTY_FORMAT_MAP: Record<string, string> = {
  primary_care: "soap",
  internal_medicine: "soap",
  cardiology: "hpi_focused",
  dermatology: "soap",
  orthopedics: "soap",
  psychiatry: "dap",
  pediatrics: "soap",
  ob_gyn: "soap",
  emergency: "soap",
  urgent_care: "soap",
  general_dentistry: "soap",
  periodontics: "soap",
  endodontics: "procedure_note",
  oral_surgery: "procedure_note",
  orthodontics: "soap",
  prosthodontics: "procedure_note",
  pediatric_dentistry: "soap",
  behavioral_health: "dap",
  general: "soap",
};

/**
 * Get the recommended note format for a given clinical specialty.
 */
export function getRecommendedFormat(specialty: string): string {
  return SPECIALTY_FORMAT_MAP[specialty.toLowerCase()] || "soap";
}

/**
 * Get required sections for a note format.
 */
export function getRequiredSections(format: string): string[] {
  return REQUIRED_SECTIONS[format.toLowerCase()] || REQUIRED_SECTIONS.soap;
}

// --- Section importance weights (critical > standard > supplementary) ---
const SECTION_WEIGHTS: Record<string, number> = {
  chiefComplaint: 2.0,   // Critical — drives entire clinical reasoning
  assessment: 2.0,        // Critical — clinical conclusion
  plan: 1.8,              // Critical — actionable treatment
  subjective: 1.5,        // Standard — patient report
  objective: 1.5,         // Standard — provider findings
  hpiNarrative: 1.5,      // Standard — detailed history
  data: 1.5,              // Standard (DAP format)
  behavior: 1.2,          // Standard (BIRP format)
  intervention: 1.2,      // Standard (BIRP format)
  response: 1.2,          // Standard (BIRP format)
};

export interface ClinicalNoteValidationResult {
  valid: boolean;
  format: string;
  missingSections: string[];
  emptySections: string[];
  computedCompleteness: number;
  /** Weighted completeness accounting for section importance */
  weightedCompleteness: number;
  /** Per-section depth assessment */
  sectionDepth: Record<string, "empty" | "minimal" | "adequate" | "thorough">;
  warnings: string[];
}

/**
 * Validate a clinical note after AI generation.
 * Checks that required sections for the note format are present and non-empty.
 * Returns a validation result with computed completeness score.
 */
export function validateClinicalNote(
  clinicalNote: Record<string, unknown>,
  expectedFormat?: string,
): ClinicalNoteValidationResult {
  const format = (clinicalNote.format as string) || expectedFormat || "soap";
  const required = getRequiredSections(format);
  const warnings: string[] = [];
  const missingSections: string[] = [];
  const emptySections: string[] = [];

  for (const section of required) {
    const value = clinicalNote[section];
    if (value === undefined || value === null) {
      missingSections.push(section);
    } else if (typeof value === "string" && value.trim().length === 0) {
      emptySections.push(section);
    } else if (Array.isArray(value) && value.length === 0) {
      emptySections.push(section);
    }
  }

  // Check documentation quality indicators
  if (clinicalNote.plan) {
    const plan = clinicalNote.plan;
    if (typeof plan === "string" && plan.trim().length === 0) {
      emptySections.push("plan");
      warnings.push("Plan section is empty — clinical notes should include at least one plan item");
    } else if (Array.isArray(plan)) {
      // Filter out empty/whitespace-only items
      const nonEmptyItems = plan.filter((item: unknown) => typeof item === "string" && item.trim().length > 0);
      if (nonEmptyItems.length === 0) {
        emptySections.push("plan");
        warnings.push("Plan section has no non-empty items — clinical notes should include at least one plan item");
      }
    }
  }

  // Validate ICD-10 code format if present
  const icd10Codes = clinicalNote.icd10Codes || clinicalNote.icd10_codes;
  if (Array.isArray(icd10Codes)) {
    for (const entry of icd10Codes) {
      const code = (entry as any)?.code;
      if (typeof code === "string" && !/^[A-Z]\d{2}(\.\d{1,4})?$/.test(code)) {
        warnings.push(`ICD-10 code "${code}" may be invalid (expected format: A00-Z99 with optional decimal)`);
      }
    }
  }

  // Validate CPT code format if present
  const cptCodes = clinicalNote.cptCodes || clinicalNote.cpt_codes;
  if (Array.isArray(cptCodes)) {
    for (const entry of cptCodes) {
      const code = (entry as any)?.code;
      if (typeof code === "string" && !/^\d{5}$/.test(code)) {
        warnings.push(`CPT code "${code}" may be invalid (expected 5-digit format)`);
      }
    }
  }

  // Validate CDT code format if present
  const cdtCodes = clinicalNote.cdtCodes || clinicalNote.cdt_codes;
  if (Array.isArray(cdtCodes)) {
    for (const entry of cdtCodes) {
      const code = (entry as any)?.code;
      if (typeof code === "string" && !/^D\d{4}$/.test(code)) {
        warnings.push(`CDT code "${code}" may be invalid (expected D0000-D9999 format)`);
      }
    }
  }

  // Validate tooth numbers (Universal Numbering: 1-32 for permanent, A-T for primary)
  const toothNumbers = clinicalNote.toothNumbers || clinicalNote.tooth_numbers;
  if (Array.isArray(toothNumbers)) {
    for (const tooth of toothNumbers) {
      if (typeof tooth === "string" || typeof tooth === "number") {
        const t = String(tooth).trim();
        const isValid = /^([1-9]|[12]\d|3[0-2])$/.test(t) || /^[A-T]$/.test(t);
        if (!isValid) {
          warnings.push(`Tooth number "${t}" may be invalid (expected 1-32 or A-T)`);
        }
      }
    }
  }

  // Compute completeness: ratio of filled required sections (unweighted)
  const totalRequired = required.length;
  const filled = totalRequired - missingSections.length - emptySections.length;
  const computedCompleteness = totalRequired > 0
    ? Math.round((filled / totalRequired) * 10 * 10) / 10 // 0-10 scale, 1 decimal
    : 0;

  // Compute weighted completeness: accounts for section importance
  let totalWeight = 0;
  let filledWeight = 0;
  for (const section of required) {
    const weight = SECTION_WEIGHTS[section] || 1.0;
    totalWeight += weight;
    if (!missingSections.includes(section) && !emptySections.includes(section)) {
      filledWeight += weight;
    }
  }
  const weightedCompleteness = totalWeight > 0
    ? Math.round((filledWeight / totalWeight) * 10 * 10) / 10
    : 0;

  // Compute section depth: categorize content quality by length
  const sectionDepth: Record<string, "empty" | "minimal" | "adequate" | "thorough"> = {};
  for (const section of required) {
    const value = clinicalNote[section];
    if (value === undefined || value === null) {
      sectionDepth[section] = "empty";
    } else if (typeof value === "string") {
      const len = value.trim().length;
      if (len === 0) sectionDepth[section] = "empty";
      else if (len < 50) sectionDepth[section] = "minimal";
      else if (len < 200) sectionDepth[section] = "adequate";
      else sectionDepth[section] = "thorough";
    } else if (Array.isArray(value)) {
      const nonEmpty = value.filter((item: unknown) => typeof item === "string" && item.trim().length > 0);
      if (nonEmpty.length === 0) sectionDepth[section] = "empty";
      else if (nonEmpty.length <= 1) sectionDepth[section] = "minimal";
      else if (nonEmpty.length <= 3) sectionDepth[section] = "adequate";
      else sectionDepth[section] = "thorough";
    }
  }

  // Add depth warnings for critical sections that are too brief
  const criticalSections = required.filter(s => (SECTION_WEIGHTS[s] || 1) >= 1.5);
  for (const section of criticalSections) {
    if (sectionDepth[section] === "minimal") {
      const label = section.replace(/([A-Z])/g, " $1").trim();
      warnings.push(`${label} section is very brief — consider adding more clinical detail`);
    }
  }

  const valid = missingSections.length === 0 && emptySections.length === 0;

  return {
    valid,
    format,
    missingSections,
    emptySections,
    computedCompleteness,
    weightedCompleteness,
    sectionDepth,
    warnings,
  };
}

// --- Valid note formats ---
export const VALID_NOTE_FORMATS = ["soap", "dap", "birp", "hpi_focused", "procedure_note"];

// --- Input validation for clinical note edits ---

/** Max sizes for array fields to prevent abuse. */
const MAX_CODE_ARRAY_LENGTH = 30;
const MAX_TOOTH_NUMBERS = 32;
const MAX_PLAN_ITEMS = 50;
const MAX_STRING_FIELD_LENGTH = 10_000;

/**
 * Validate fields submitted in a clinical note edit.
 * Returns an array of error strings. Empty = valid.
 */
export function validateClinicalEditFields(edits: Record<string, unknown>): string[] {
  const errors: string[] = [];

  // Validate format
  if (edits.format !== undefined) {
    if (typeof edits.format !== "string" || !VALID_NOTE_FORMATS.includes(edits.format)) {
      errors.push(`Invalid format "${edits.format}". Must be one of: ${VALID_NOTE_FORMATS.join(", ")}`);
    }
  }

  // Validate specialty against known specialties
  if (edits.specialty !== undefined) {
    if (typeof edits.specialty !== "string" || edits.specialty.length > 50) {
      errors.push("Specialty must be a string under 50 characters");
    } else if (!/^[a-z_]+$/.test(edits.specialty)) {
      errors.push("Specialty must contain only lowercase letters and underscores");
    }
  }

  // Validate string fields length
  const stringFields = ["chiefComplaint", "subjective", "objective", "assessment", "hpiNarrative",
    "reviewOfSystems", "periodontalFindings", "followUp"];
  for (const field of stringFields) {
    if (edits[field] !== undefined && typeof edits[field] === "string") {
      if ((edits[field] as string).length > MAX_STRING_FIELD_LENGTH) {
        errors.push(`${field} exceeds maximum length of ${MAX_STRING_FIELD_LENGTH} characters`);
      }
    }
  }

  // Validate plan array
  if (edits.plan !== undefined) {
    if (typeof edits.plan === "string") {
      // Allow string plan (will be split later), check length
      if (edits.plan.length > MAX_STRING_FIELD_LENGTH) {
        errors.push(`plan exceeds maximum length of ${MAX_STRING_FIELD_LENGTH} characters`);
      }
    } else if (Array.isArray(edits.plan)) {
      if (edits.plan.length > MAX_PLAN_ITEMS) {
        errors.push(`plan has too many items (max ${MAX_PLAN_ITEMS})`);
      }
      for (const item of edits.plan) {
        if (typeof item !== "string") {
          errors.push("Each plan item must be a string");
          break;
        }
      }
    }
  }

  // Validate ICD-10 codes
  if (edits.icd10Codes !== undefined && Array.isArray(edits.icd10Codes)) {
    if (edits.icd10Codes.length > MAX_CODE_ARRAY_LENGTH) {
      errors.push(`Too many ICD-10 codes (max ${MAX_CODE_ARRAY_LENGTH})`);
    }
    for (const entry of edits.icd10Codes) {
      const code = (entry as any)?.code;
      if (typeof code === "string" && !/^[A-Z]\d{2}(\.\d{1,4})?$/.test(code)) {
        errors.push(`Invalid ICD-10 code format: "${code}" (expected A00-Z99 with optional decimal)`);
      }
    }
  }

  // Validate CPT codes
  if (edits.cptCodes !== undefined && Array.isArray(edits.cptCodes)) {
    if (edits.cptCodes.length > MAX_CODE_ARRAY_LENGTH) {
      errors.push(`Too many CPT codes (max ${MAX_CODE_ARRAY_LENGTH})`);
    }
    for (const entry of edits.cptCodes) {
      const code = (entry as any)?.code;
      if (typeof code === "string" && !/^\d{5}$/.test(code)) {
        errors.push(`Invalid CPT code format: "${code}" (expected 5-digit format)`);
      }
    }
  }

  // Validate CDT codes
  if (edits.cdtCodes !== undefined && Array.isArray(edits.cdtCodes)) {
    if (edits.cdtCodes.length > MAX_CODE_ARRAY_LENGTH) {
      errors.push(`Too many CDT codes (max ${MAX_CODE_ARRAY_LENGTH})`);
    }
    for (const entry of edits.cdtCodes) {
      const code = (entry as any)?.code;
      if (typeof code === "string" && !/^D\d{4}$/.test(code)) {
        errors.push(`Invalid CDT code format: "${code}" (expected D0000-D9999)`);
      }
    }
  }

  // Validate tooth numbers (Universal Numbering: 1-32 permanent, A-T primary)
  if (edits.toothNumbers !== undefined && Array.isArray(edits.toothNumbers)) {
    if (edits.toothNumbers.length > MAX_TOOTH_NUMBERS) {
      errors.push(`Too many tooth numbers (max ${MAX_TOOTH_NUMBERS})`);
    }
    for (const tooth of edits.toothNumbers) {
      const t = String(tooth).trim();
      if (!/^([1-9]|[12]\d|3[0-2])$/.test(t) && !/^[A-T]$/.test(t)) {
        errors.push(`Invalid tooth number: "${t}" (expected 1-32 or A-T)`);
      }
    }
  }

  // Validate differentialDiagnoses
  if (edits.differentialDiagnoses !== undefined && Array.isArray(edits.differentialDiagnoses)) {
    if (edits.differentialDiagnoses.length > 20) {
      errors.push("Too many differential diagnoses (max 20)");
    }
  }

  // Validate prescriptions
  if (edits.prescriptions !== undefined && Array.isArray(edits.prescriptions)) {
    if (edits.prescriptions.length > 30) {
      errors.push("Too many prescriptions (max 30)");
    }
  }

  return errors;
}

// --- Max length for style preference fields to prevent prompt injection ---
const MAX_PREF_STRING_LENGTH = 200;
const MAX_PREF_ARRAY_LENGTH = 10;
const MAX_PREF_ARRAY_ITEM_LENGTH = 100;

/**
 * Sanitize provider style preferences before injecting into AI prompts.
 * Prevents prompt injection via overly long or malicious preference values.
 */
export function sanitizeStylePreferences(prefs: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  // Whitelist of allowed note formats
  const allowedFormats = ["soap", "dap", "birp", "hpi_focused", "procedure_note"];
  if (typeof prefs.noteFormat === "string" && allowedFormats.includes(prefs.noteFormat)) {
    sanitized.noteFormat = prefs.noteFormat;
  }

  // Whitelist of allowed abbreviation levels
  const allowedAbbrevLevels = ["minimal", "moderate", "heavy"];
  if (typeof prefs.abbreviationLevel === "string" && allowedAbbrevLevels.includes(prefs.abbreviationLevel)) {
    sanitized.abbreviationLevel = prefs.abbreviationLevel;
  }

  // Boolean
  if (typeof prefs.includeNegativePertinents === "boolean") {
    sanitized.includeNegativePertinents = prefs.includeNegativePertinents;
  }

  // Specialty — validate against known specialties
  if (typeof prefs.defaultSpecialty === "string") {
    // Strip anything that's not alphanumeric/underscore
    const cleaned = prefs.defaultSpecialty.replace(/[^a-z_]/gi, "").slice(0, 50);
    if (cleaned.length > 0 && SPECIALTY_FORMAT_MAP[cleaned.toLowerCase()]) {
      sanitized.defaultSpecialty = cleaned;
    }
  }

  // Section order — array of short strings
  if (Array.isArray(prefs.sectionOrder)) {
    sanitized.sectionOrder = prefs.sectionOrder
      .filter((s: unknown) => typeof s === "string")
      .slice(0, MAX_PREF_ARRAY_LENGTH)
      .map((s: string) => s.replace(/[^a-zA-Z_ ]/g, "").slice(0, MAX_PREF_ARRAY_ITEM_LENGTH));
  }

  // Custom sections — sanitize to prevent injection
  if (Array.isArray(prefs.customSections)) {
    sanitized.customSections = prefs.customSections
      .filter((s: unknown) => typeof s === "string")
      .slice(0, MAX_PREF_ARRAY_LENGTH)
      .map((s: string) => s.replace(/[^a-zA-Z0-9_ \-\/()]/g, "").slice(0, MAX_PREF_ARRAY_ITEM_LENGTH));
  }

  // Template overrides — sanitize keys and values
  if (typeof prefs.templateOverrides === "object" && prefs.templateOverrides !== null && !Array.isArray(prefs.templateOverrides)) {
    const cleanOverrides: Record<string, string> = {};
    for (const [key, value] of Object.entries(prefs.templateOverrides as Record<string, unknown>)) {
      const cleanKey = key.replace(/[^a-zA-Z_]/g, "").slice(0, 50);
      if (cleanKey && typeof value === "string") {
        cleanOverrides[cleanKey] = value.slice(0, MAX_PREF_STRING_LENGTH);
      }
    }
    if (Object.keys(cleanOverrides).length > 0) {
      sanitized.templateOverrides = cleanOverrides;
    }
  }

  return sanitized;
}
