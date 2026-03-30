/**
 * PHI Redaction Utility
 *
 * Regex-based scrubber that catches accidentally-logged Protected Health
 * Information (PHI) in log messages and audit trail detail fields.
 * Clinical codes (ICD-10, CPT, CDT, HCPCS) are excluded from redaction.
 */

const REDACTED = "[REDACTED]";

const SSN_FORMATTED = /\b\d{3}[-\s]\d{2}[-\s]\d{4}\b/g;
const SSN_BARE = /(?<![A-Za-z.\-])\b\d{9}\b(?![.\-]\d)/g;
const PHONE_PATTERN = /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g;
const EMAIL_PATTERN = /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g;
const DOB_KEYWORD_PATTERN =
  /(?:DOB|d\.?o\.?b\.?|date\s+of\s+birth|born\s+on|birthdate)[:\s]*\d{1,4}[/\-]\d{1,2}[/\-]\d{1,4}/gi;
const DOB_NATURAL_PATTERN =
  /(?:born\s+(?:in\s+)?|birth\s*date[:\s]*)(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}?,?\s*\d{2,4}/gi;
const DATE_MMDDYYYY = /\b(?:0?[1-9]|1[0-2])[/\-](?:0?[1-9]|[12]\d|3[01])[/\-](?:19|20)\d{2}\b/g;
const DATE_ISO = /\b(?:19|20)\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])\b/g;
const MRN_PATTERN =
  /(?:MRN|medical\s+record(?:\s+number)?|patient\s+(?:id|number|#))[:\s#]*(?=[A-Z0-9\-]*\d)[A-Z0-9\-]{4,15}/gi;
const MEDICARE_PATTERN = /\b\d{1,4}[A-Z]{1,2}\d{1,4}\b/g;
const MEDICAID_PATTERN = /(?:medicaid|medi-cal)\s*(?:id|#|number)?[:\s]*[A-Z0-9]{6,14}/gi;
const ADDRESS_PATTERN =
  /\b\d{1,6}\s+(?:[A-Z][a-z]+\s+){1,3}(?:St(?:reet)?|Ave(?:nue)?|Blvd|Boulevard|Dr(?:ive)?|Rd|Road|Ln|Lane|Ct|Court|Way|Pl(?:ace)?|Cir(?:cle)?)\b\.?/gi;

function isClinicalCode(match: string): boolean {
  if (/^[A-Z]\d{4}$/.test(match)) return true;
  if (/^[A-Z]\d{2,3}(?:\.\d{1,4})?$/.test(match)) return true;
  if (/^D\d{4}$/.test(match)) return true;
  return false;
}

export function redactPhi(text: string): string {
  if (!text) return text;
  let result = text;
  result = result.replace(SSN_FORMATTED, REDACTED);
  result = result.replace(DOB_KEYWORD_PATTERN, REDACTED);
  result = result.replace(DOB_NATURAL_PATTERN, REDACTED);
  result = result.replace(DATE_MMDDYYYY, REDACTED);
  result = result.replace(DATE_ISO, REDACTED);
  result = result.replace(MRN_PATTERN, REDACTED);
  result = result.replace(MEDICARE_PATTERN, (match) => (isClinicalCode(match) ? match : REDACTED));
  result = result.replace(MEDICAID_PATTERN, REDACTED);
  result = result.replace(EMAIL_PATTERN, REDACTED);
  result = result.replace(PHONE_PATTERN, REDACTED);
  result = result.replace(SSN_BARE, REDACTED);
  result = result.replace(ADDRESS_PATTERN, REDACTED);
  return result;
}

export function redactPhiDeep(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "string") return redactPhi(obj);
  if (typeof obj === "number" || typeof obj === "boolean") return obj;
  if (Array.isArray(obj)) return obj.map((item) => redactPhiDeep(item));
  if (typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = redactPhiDeep(value);
    }
    return result;
  }
  return obj;
}
