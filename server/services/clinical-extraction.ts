/**
 * Clinical Structured Data Extraction
 *
 * Extracts structured data (vitals, medications, allergies) from clinical note
 * free text using regex patterns for reliable extraction of standardized formats.
 */

export interface ExtractedVitals {
  bloodPressureSystolic?: number;
  bloodPressureDiastolic?: number;
  heartRate?: number;
  respiratoryRate?: number;
  temperature?: number;
  temperatureUnit?: "F" | "C";
  oxygenSaturation?: number;
  painScale?: number;
  weight?: number;
  weightUnit?: "lbs" | "kg";
  height?: number;
  heightUnit?: "in" | "cm";
  bmi?: number;
}

export interface ExtractedMedication {
  name: string;
  dose?: string;
  frequency?: string;
  route?: string;
  isNew?: boolean;
}

export interface ExtractedAllergy {
  substance: string;
  reaction?: string;
  severity?: "mild" | "moderate" | "severe";
}

export interface ExtractedStructuredData {
  vitals?: ExtractedVitals;
  medications?: ExtractedMedication[];
  allergies?: ExtractedAllergy[];
}

/**
 * Extract vitals from note text using standardized regex patterns.
 */
function extractVitals(text: string): ExtractedVitals | undefined {
  const vitals: ExtractedVitals = {};

  // Blood pressure: BP: 120/80 or BP 120/80
  const bpMatch = text.match(/BP[:\s]+(\d{2,3})\s*\/\s*(\d{2,3})/i);
  if (bpMatch) {
    vitals.bloodPressureSystolic = parseInt(bpMatch[1], 10);
    vitals.bloodPressureDiastolic = parseInt(bpMatch[2], 10);
  }

  // Heart rate: HR: 72 bpm or Heart Rate: 72 or Pulse: 72
  const hrMatch = text.match(/(?:HR|Heart Rate|Pulse)[:\s]+(\d{2,3})\s*(?:bpm)?/i);
  if (hrMatch) {
    vitals.heartRate = parseInt(hrMatch[1], 10);
  }

  // Respiratory rate: RR: 16 or Resp Rate: 16
  const rrMatch = text.match(/(?:RR|Resp(?:iratory)?(?:\s*Rate)?)[:\s]+(\d{1,2})\s*(?:\/min)?/i);
  if (rrMatch) {
    vitals.respiratoryRate = parseInt(rrMatch[1], 10);
  }

  // Temperature: Temp: 98.6 F or Temperature: 37.0 C
  const tempMatch = text.match(/(?:Temp(?:erature)?)[:\s]+(\d{2,3}(?:\.\d)?)\s*°?\s*([FC])?/i);
  if (tempMatch) {
    vitals.temperature = parseFloat(tempMatch[1]);
    if (tempMatch[2]) {
      vitals.temperatureUnit = tempMatch[2].toUpperCase() as "F" | "C";
    }
  }

  // Oxygen saturation: O2 Sat: 98% or SpO2: 98% or Oxygen Sat: 98%
  const o2Match = text.match(/(?:O2\s*Sat|SpO2|Oxygen\s*Sat)[:\s]+(\d{2,3})\s*%/i);
  if (o2Match) {
    vitals.oxygenSaturation = parseInt(o2Match[1], 10);
  }

  // Pain scale: Pain: 5/10 or Pain: 5
  const painMatch = text.match(/(?:Pain)[:\s]+(\d{1,2})\s*(?:\/\s*10)?/i);
  if (painMatch) {
    const pain = parseInt(painMatch[1], 10);
    if (pain >= 0 && pain <= 10) {
      vitals.painScale = pain;
    }
  }

  // Weight: Wt: 185 lbs or Weight: 84 kg
  const wtMatch = text.match(/(?:Wt|Weight)[:\s]+(\d{2,3}(?:\.\d)?)\s*(lbs?|kg)/i);
  if (wtMatch) {
    vitals.weight = parseFloat(wtMatch[1]);
    vitals.weightUnit = wtMatch[2].toLowerCase().startsWith("lb") ? "lbs" : "kg";
  }

  // Height: Ht: 5'10" or Height: 70 in or Height: 178 cm
  const htMatch = text.match(/(?:Ht|Height)[:\s]+(\d{1,3}(?:\.\d)?)\s*(in|cm|"|'[\d"]*)/i);
  if (htMatch) {
    const htUnit = htMatch[2].toLowerCase();
    if (htUnit === "cm") {
      vitals.height = parseFloat(htMatch[1]);
      vitals.heightUnit = "cm";
    } else {
      // Convert to inches for in/"
      vitals.height = parseFloat(htMatch[1]);
      vitals.heightUnit = "in";
    }
  }

  // BMI: BMI: 22.5
  const bmiMatch = text.match(/BMI[:\s]+(\d{1,2}(?:\.\d{1,2})?)/i);
  if (bmiMatch) {
    vitals.bmi = parseFloat(bmiMatch[1]);
  }

  // Return undefined if no vitals were extracted
  if (Object.keys(vitals).length === 0) return undefined;
  return vitals;
}

/**
 * Extract medications from note text.
 * Looks for content after "Medications:" header or "Rx:" prefix,
 * or inline medication mentions.
 */
function extractMedications(text: string): ExtractedMedication[] | undefined {
  const medications: ExtractedMedication[] = [];

  // Check for NKDA / no known medications
  if (/\bNKDA\b|\bno\s+known\s+(?:drug\s+)?allergies\b/i.test(text)) {
    // Don't extract medications if NKDA noted
  }

  // Find medications section
  const medSectionMatch = text.match(
    /(?:Medications?|Current\s+Meds?|Rx|Prescriptions?)[:\s]*\n((?:.+\n?)*?)(?:\n\n|\n[A-Z][a-z]+:|\n---|\n\*\*|$)/i,
  );

  if (medSectionMatch) {
    const medLines = medSectionMatch[1]
      .split("\n")
      .map(l => l.trim())
      .filter(l => l.length > 2);

    for (const line of medLines) {
      // Skip obvious non-medication lines
      if (/^[-*•]?\s*(none|nkda|no\s+known|n\/a)/i.test(line)) continue;

      // Try to parse: "Medication Name Dose frequency route"
      // e.g., "Lisinopril 10mg daily PO" or "- Metformin 500 mg twice daily"
      const cleanLine = line.replace(/^[-*•\d.)\s]+/, "").trim();
      if (!cleanLine) continue;

      // Parse common medication line format
      const medMatch = cleanLine.match(
        /^([A-Za-z][A-Za-z\s/-]+?)\s+(\d+\s*(?:mg|mcg|mL|units?|%|g|IU|meq)(?:\s*\/\s*(?:tablet|cap|tab|dose))?)?\s*((?:once|twice|three\s+times|qd|bid|tid|qid|q\d+h|daily|weekly|monthly|prn|as\s+needed)[\w\s]*)?\s*((?:po|pv|pr|sl|inhaled|topical|sublingual|by\s+mouth|orally?))?/i,
      );

      if (medMatch && medMatch[1]) {
        const med: ExtractedMedication = {
          name: medMatch[1].trim(),
          dose: medMatch[2]?.trim() || undefined,
          frequency: medMatch[3]?.trim() || undefined,
          route: medMatch[4]?.trim() || undefined,
        };
        // Only add if name looks like a real medication (not just a word)
        if (med.name.length >= 3 && !/^(the|and|for|with|take|use)$/i.test(med.name)) {
          medications.push(med);
        }
      }
    }
  }

  return medications.length > 0 ? medications : undefined;
}

/**
 * Extract allergies from note text.
 * Looks for content after "Allergies:" header.
 */
function extractAllergies(text: string): ExtractedAllergy[] | undefined {
  // Check for NKA / NKDA
  if (/\bNKA\b|\bNKDA\b|\bno\s+known\s+(?:drug\s+)?allergies\b/i.test(text)) {
    return undefined; // No allergies noted — not returning empty, just nothing
  }

  const allergies: ExtractedAllergy[] = [];

  // Find allergies section
  const allergySectionMatch = text.match(
    /(?:Allergies?|Drug\s+Allergies?)[:\s]*\n((?:.+\n?)*?)(?:\n\n|\n[A-Z][a-z]+:|\n---|\n\*\*|$)/i,
  );

  if (allergySectionMatch) {
    const allergyLines = allergySectionMatch[1]
      .split("\n")
      .map(l => l.trim())
      .filter(l => l.length > 2);

    for (const line of allergyLines) {
      if (/^[-*•]?\s*(none|nkda|nka|no\s+known|n\/a)/i.test(line)) continue;

      const cleanLine = line.replace(/^[-*•\d.)\s]+/, "").trim();
      if (!cleanLine) continue;

      // Parse: "Penicillin (hives, moderate)" or "Penicillin - hives"
      const allergyMatch = cleanLine.match(
        /^([A-Za-z][A-Za-z\s/-]+?)(?:\s*[-—(:]?\s*([A-Za-z\s,]+?)(?:\s*[-—,]?\s*(mild|moderate|severe))?)?(?:\)|\s*$)/i,
      );

      if (allergyMatch && allergyMatch[1]) {
        const allergy: ExtractedAllergy = {
          substance: allergyMatch[1].trim(),
          reaction: allergyMatch[2]?.trim() || undefined,
          severity: allergyMatch[3]?.toLowerCase() as "mild" | "moderate" | "severe" | undefined,
        };
        if (allergy.substance.length >= 2) {
          allergies.push(allergy);
        }
      }
    }
  }

  return allergies.length > 0 ? allergies : undefined;
}

/**
 * Extract structured data (vitals, medications, allergies) from clinical note free text.
 * Primarily extracts from the objective section (SOAP), but also checks subjective and plan.
 *
 * @param noteText - The clinical note text (typically decrypted objective section)
 * @returns Extracted structured data, with undefined fields if nothing was found
 */
export function extractStructuredData(noteText: string): ExtractedStructuredData {
  if (!noteText || typeof noteText !== "string") {
    return {};
  }

  const vitals = extractVitals(noteText);
  const medications = extractMedications(noteText);
  const allergies = extractAllergies(noteText);

  const result: ExtractedStructuredData = {};
  if (vitals) result.vitals = vitals;
  if (medications) result.medications = medications;
  if (allergies) result.allergies = allergies;

  return result;
}

/**
 * Merge extracted structured data from multiple note sections.
 * Vitals come from objective, medications/allergies from subjective or plan.
 */
export function extractStructuredDataFromSections(sections: {
  objective?: string;
  subjective?: string;
  plan?: string | string[];
}): ExtractedStructuredData {
  const objectiveData = sections.objective ? extractStructuredData(sections.objective) : {};

  // Combine plan array to string for searching
  const planText = Array.isArray(sections.plan)
    ? sections.plan.join("\n")
    : (sections.plan || "");

  const subjPlanText = [sections.subjective || "", planText].join("\n\n");
  const subjPlanData = subjPlanText.trim() ? extractStructuredData(subjPlanText) : {};

  return {
    vitals: objectiveData.vitals || subjPlanData.vitals,
    medications: objectiveData.medications || subjPlanData.medications,
    allergies: objectiveData.allergies || subjPlanData.allergies,
  };
}
