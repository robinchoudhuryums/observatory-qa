/**
 * AI Guardrails for the Observatory QA platform.
 *
 * Provides prompt injection detection, output safety checks, and
 * context framing to harden the RAG pipeline against adversarial inputs.
 *
 * Unicode normalization (NFKD) is applied before pattern matching to defeat
 * homoglyph attacks (e.g., Cyrillic 'а' instead of Latin 'a', accented chars).
 */

export interface InjectionCheckResult {
  isInjection: boolean;
  pattern?: string;
}

const INJECTION_PATTERNS: Array<{ regex: RegExp; label: string }> = [
  // Instruction override attempts
  { regex: /ignore previous instructions/i, label: "ignore previous instructions" },
  { regex: /ignore above instructions/i, label: "ignore above instructions" },
  { regex: /disregard your instructions/i, label: "disregard your instructions" },
  { regex: /forget your instructions/i, label: "forget your instructions" },
  { regex: /you are now/i, label: "you are now (role hijack)" },
  { regex: /new instructions:/i, label: "new instructions:" },
  { regex: /system prompt:/i, label: "system prompt:" },
  { regex: /override:/i, label: "override:" },
  { regex: /jailbreak/i, label: "jailbreak" },
  { regex: /DAN mode/i, label: "DAN mode" },
  { regex: /developer mode/i, label: "developer mode" },
  { regex: /pretend you are/i, label: "pretend you are" },
  { regex: /act as if you/i, label: "act as if you (role hijack)" },
  { regex: /do not follow/i, label: "do not follow (override)" },
  // Tag injection — covers all common prompt framing tags (open and close)
  { regex: /<\/?system\b/i, label: "<system> tag injection" },
  { regex: /<\/?instructions\b/i, label: "<instructions> tag injection" },
  { regex: /<\/?prompt\b/i, label: "<prompt> tag injection" },
  { regex: /<\/?context\b/i, label: "<context> tag injection" },
  { regex: /<\/?user\b/i, label: "<user> tag injection" },
  { regex: /<\/?assistant\b/i, label: "<assistant> tag injection" },
  // RAG XML framing escape — prevents breaking out of <knowledge_source> context
  { regex: /<\/?knowledge_source\b/i, label: "<knowledge_source> tag escape" },
  { regex: /<\/?tool_result\b/i, label: "<tool_result> tag injection" },
  { regex: /<\/?function_result\b/i, label: "<function_result> tag injection" },
  { regex: /<\/?human\b/i, label: "<human> tag injection" },
];

/**
 * Normalize a string to defeat Unicode homoglyph and accent-based bypass attacks.
 * NFKD decomposition + stripping combining marks converts "ìgnórè" to "ignore".
 */
function normalizeForDetection(input: string): string {
  return input.normalize("NFKD").replace(/[\u0300-\u036f]/g, ""); // Strip combining diacritical marks
}

/**
 * Detect prompt injection in user-supplied text.
 *
 * Defenses:
 *  1. NFKD normalization defeats homoglyph/accent attacks.
 *  2. HTML entity decoding defeats &lt;system&gt; entity bypasses.
 *  3. Input truncation prevents regex DoS on large payloads.
 */
const MAX_DETECTION_INPUT = 10_000; // Truncate before regex to prevent ReDoS

export function detectPromptInjection(input: string): InjectionCheckResult {
  // Truncate to prevent regex DoS on very large crafted inputs
  const truncated = input.length > MAX_DETECTION_INPUT ? input.slice(0, MAX_DETECTION_INPUT) : input;
  // NFKD normalization for homoglyph defense
  let normalized = normalizeForDetection(truncated);
  // Decode HTML entities to catch &lt;system&gt; style bypasses
  normalized = decodeHtmlEntities(normalized);

  // Check for injections BEFORE comment stripping — catches payloads
  // hidden inside comments (e.g., <!-- <system> --> or <!-- ignore previous instructions -->)
  for (const { regex, label } of INJECTION_PATTERNS) {
    if (regex.test(normalized)) return { isInjection: true, pattern: label };
  }

  // Also check after stripping comments in case the injection is
  // split across a comment boundary
  const commentStripped = normalized.replace(/<!--[\s\S]*?-->/g, " ");
  if (commentStripped !== normalized) {
    for (const { regex, label } of INJECTION_PATTERNS) {
      if (regex.test(commentStripped)) return { isInjection: true, pattern: label };
    }
  }

  return { isInjection: false };
}

/** Decode common HTML entities that could disguise tag injections. */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .replace(/&#60;/g, "<")
    .replace(/&#62;/g, ">")
    .replace(/&#x3c;/gi, "<")
    .replace(/&#x3e;/gi, ">");
}

export interface OutputGuardrailResult {
  flagged: boolean;
  reason?: string;
}

const ROLE_DEVIATION_PHRASES = ["As an AI language model", "I cannot help with", "I'm sorry, but as an AI"];

const PROMPT_ECHO_MARKERS = ["SYSTEM:", "INSTRUCTIONS:", "### System"];

export function checkOutputGuardrails(output: string, systemPromptSnippets?: string[]): OutputGuardrailResult {
  if (systemPromptSnippets && systemPromptSnippets.length > 0) {
    for (const snippet of systemPromptSnippets) {
      const check = snippet.slice(0, 50);
      if (check.length > 0 && output.includes(check)) {
        return { flagged: true, reason: "Possible system prompt leakage detected in output" };
      }
    }
  }
  for (const phrase of ROLE_DEVIATION_PHRASES) {
    if (output.includes(phrase)) return { flagged: true, reason: `Role deviation phrase detected: "${phrase}"` };
  }
  for (const marker of PROMPT_ECHO_MARKERS) {
    if (output.includes(marker)) return { flagged: true, reason: `Prompt echo detected: output contains "${marker}"` };
  }
  return { flagged: false };
}

export function frameUserInput(input: string): string {
  return `<user_input>\n${input}\n</user_input>`;
}
