/**
 * Domain synonym expansion (per industry vertical).
 * Extracted from rag.ts. Pure utility — no external dependencies.
 *
 * Bidirectional synonym maps per industry vertical. When a query contains
 * a term, its synonyms are appended to boost BM25 recall on abbreviations
 * and alternate phrasings. The embedding handles semantic similarity;
 * this handles lexical gaps (e.g., "w/c" vs "wheelchair").
 */

const DENTAL_SYNONYMS: ReadonlyMap<string, readonly string[]> = new Map([
  ["crown", ["cap", "restoration", "prosthetic"]],
  ["filling", ["restoration", "composite", "amalgam"]],
  ["extraction", ["pull", "exodontia", "removal"]],
  ["prophylaxis", ["prophy", "cleaning", "dental cleaning"]],
  ["radiograph", ["xray", "x-ray", "film", "image"]],
  ["periodontal", ["perio", "gum", "gingival"]],
  ["endodontic", ["endo", "root canal", "rct"]],
  ["orthodontic", ["ortho", "braces", "aligner"]],
  ["denture", ["prosthesis", "partial", "full denture"]],
  ["implant", ["dental implant", "fixture", "abutment"]],
  ["cdt", ["dental code", "procedure code"]],
  ["sealant", ["pit and fissure sealant", "preventive sealant"]],
  ["fluoride", ["fluoride treatment", "topical fluoride", "varnish"]],
]);

const MEDICAL_SYNONYMS: ReadonlyMap<string, readonly string[]> = new Map([
  ["wheelchair", ["wc", "w/c", "power wheelchair", "manual wheelchair"]],
  ["cpap", ["c-pap", "continuous positive airway pressure"]],
  ["oxygen", ["o2", "supplemental oxygen", "home oxygen"]],
  ["diabetes", ["dm", "dm2", "type 2 diabetes", "diabetic"]],
  ["hypertension", ["htn", "high blood pressure", "elevated bp"]],
  ["medication", ["med", "meds", "prescription", "rx"]],
  ["diagnosis", ["dx", "diagnoses", "condition"]],
  ["treatment", ["tx", "therapy", "intervention"]],
  ["history", ["hx", "medical history", "past history"]],
  ["symptoms", ["sx", "presenting complaints", "chief complaint"]],
  ["patient", ["pt", "client", "individual"]],
  ["hospital", ["facility", "inpatient", "acute care"]],
  ["outpatient", ["op", "ambulatory", "clinic"]],
  ["discharge", ["dc", "d/c", "released"]],
  ["referral", ["consult", "consultation", "refer"]],
  ["vitals", ["vital signs", "bp", "hr", "rr", "temp", "spo2"]],
]);

const BEHAVIORAL_HEALTH_SYNONYMS: ReadonlyMap<string, readonly string[]> = new Map([
  ["therapy", ["counseling", "psychotherapy", "session"]],
  ["depression", ["mdd", "depressive disorder", "depressed mood"]],
  ["anxiety", ["gad", "anxious", "generalized anxiety"]],
  ["substance", ["substance use", "sud", "addiction", "chemical dependency"]],
  ["ptsd", ["post-traumatic", "trauma", "traumatic stress"]],
  ["medication management", ["med management", "psychiatric medication", "psychopharmacology"]],
  ["cbt", ["cognitive behavioral", "cognitive therapy"]],
  ["emdr", ["eye movement", "desensitization", "reprocessing"]],
  ["assessment", ["evaluation", "intake", "diagnostic assessment"]],
  ["crisis", ["crisis intervention", "emergency", "suicidal ideation", "si"]],
  ["soap", ["soap note", "subjective objective assessment plan"]],
  ["dap", ["dap note", "data assessment plan"]],
  ["birp", ["birp note", "behavior intervention response plan"]],
]);

const VETERINARY_SYNONYMS: ReadonlyMap<string, readonly string[]> = new Map([
  ["spay", ["ovariohysterectomy", "ohe", "sterilization"]],
  ["neuter", ["castration", "orchiectomy"]],
  ["vaccination", ["vaccine", "vax", "immunization", "booster"]],
  ["heartworm", ["hw", "dirofilaria", "heartworm disease"]],
  ["flea", ["flea treatment", "ectoparasite", "flea tick"]],
  ["dental", ["dental cleaning", "dental prophy", "oral health"]],
  ["blood work", ["cbc", "chemistry panel", "lab work", "blood panel"]],
  ["radiograph", ["xray", "x-ray", "imaging"]],
]);

const GENERAL_SYNONYMS: ReadonlyMap<string, readonly string[]> = new Map([
  ["cancellation", ["cancel", "cancelled", "no show", "no-show"]],
  ["appointment", ["appt", "visit", "booking", "scheduled"]],
  ["insurance", ["coverage", "benefits", "plan", "carrier"]],
  ["copay", ["co-pay", "copayment", "co-payment"]],
  ["deductible", ["out of pocket", "oop", "patient responsibility"]],
  ["preauthorization", ["prior auth", "pre-auth", "precertification"]],
  ["complaint", ["concern", "issue", "problem", "grievance"]],
  ["satisfaction", ["csat", "nps", "experience", "happy"]],
  ["escalation", ["escalate", "supervisor", "manager"]],
  ["hold time", ["wait time", "on hold", "queue"]],
]);

/** Get the synonym map for an industry type (falls back to general). */
function getSynonymMap(industryType?: string): ReadonlyMap<string, readonly string[]> {
  const maps: ReadonlyMap<string, readonly string[]>[] = [GENERAL_SYNONYMS];
  switch (industryType) {
    case "dental":
      maps.push(DENTAL_SYNONYMS, MEDICAL_SYNONYMS);
      break;
    case "medical":
      maps.push(MEDICAL_SYNONYMS);
      break;
    case "behavioral_health":
      maps.push(BEHAVIORAL_HEALTH_SYNONYMS, MEDICAL_SYNONYMS);
      break;
    case "veterinary":
      maps.push(VETERINARY_SYNONYMS);
      break;
  }
  // Merge all maps into one
  const merged = new Map<string, readonly string[]>();
  for (const map of maps) {
    for (const [key, synonyms] of Array.from(map)) {
      merged.set(key, synonyms);
    }
  }
  return merged;
}

/**
 * Build a bidirectional synonym lookup from a synonym map.
 * If "cpap" maps to ["c-pap", "continuous positive airway pressure"],
 * then "c-pap" also maps to ["cpap"].
 */
function buildBidirectionalLookup(synonymMap: ReadonlyMap<string, readonly string[]>): Map<string, string[]> {
  const lookup = new Map<string, string[]>();
  for (const [key, synonyms] of Array.from(synonymMap)) {
    // key → all synonyms
    const existing = lookup.get(key) || [];
    for (const syn of synonyms) {
      if (!existing.includes(syn)) existing.push(syn);
    }
    lookup.set(key, existing);

    // each synonym → key (bidirectional)
    for (const syn of synonyms) {
      const synLower = syn.toLowerCase();
      const synExisting = lookup.get(synLower) || [];
      if (!synExisting.includes(key)) synExisting.push(key);
      lookup.set(synLower, synExisting);
    }
  }
  return lookup;
}

/**
 * Expand a query with synonyms for improved BM25 recall.
 * Only appends single-token synonyms to avoid noise.
 */
export function expandQueryWithSynonyms(query: string, industryType?: string): string {
  const synonymMap = getSynonymMap(industryType);
  const lookup = buildBidirectionalLookup(synonymMap);
  const queryLower = query.toLowerCase();
  const terms = queryLower.split(/\s+/);
  const expansions: string[] = [];

  for (const term of terms) {
    const synonyms = lookup.get(term);
    if (synonyms) {
      for (const syn of synonyms) {
        // Only add single-token synonyms (multi-word ones add noise to BM25)
        if (!syn.includes(" ") && !terms.includes(syn) && !expansions.includes(syn)) {
          expansions.push(syn);
        }
      }
    }
  }

  return expansions.length > 0 ? `${query} ${expansions.join(" ")}` : query;
}
