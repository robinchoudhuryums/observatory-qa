/**
 * AI Guardrails for the Observatory QA platform.
 *
 * Provides prompt injection detection, output safety checks, and
 * context framing to harden both the RAG pipeline and call analysis
 * pipeline against adversarial inputs.
 *
 * Input-side: detects injection patterns in transcripts/documents before AI analysis.
 * Output-side: detects if AI response shows signs of successful injection bypass.
 *
 * Unicode normalization (NFKD) is applied before pattern matching to defeat
 * homoglyph attacks (e.g., Cyrillic 'а' instead of Latin 'a', accented chars).
 */

export interface InjectionCheckResult {
  isInjection: boolean;
  pattern?: string;
  /** All matched patterns (for call analysis, multiple may fire). */
  allPatterns?: string[];
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

// --- Call-analysis-specific patterns (spoken injection via transcript) ---
const CALL_ANALYSIS_INJECTION_PATTERNS: Array<{ regex: RegExp; label: string }> = [
  // Score manipulation attempts
  {
    regex: /give\s+(this|the)\s+(call|agent|person)\s+a\s+(perfect|high|10|ten)\s+score/i,
    label: "score manipulation: request high score",
  },
  { regex: /score\s+this\s+(call\s+)?(a\s+)?(10|ten|perfect)/i, label: "score manipulation: force perfect score" },
  {
    regex: /this\s+call\s+(should|must|deserves?)\s+(be\s+)?(a\s+)?(10|ten|perfect)/i,
    label: "score manipulation: assert perfect score",
  },
  // Output format manipulation
  { regex: /output\s+the\s+following\s+json/i, label: "output format manipulation" },
  { regex: /return\s+this\s+exact\s+(json|response|output)/i, label: "output override attempt" },
  { regex: /respond\s+with\s+only\s+(this|the\s+following)/i, label: "response override attempt" },
  // Expanded instruction overrides (more flexible matching)
  {
    regex: /ignore\s+(all\s+)?(previous|prior|above|earlier|system)\s+(instructions?|prompts?|rules?|guidelines?)/i,
    label: "system instruction override",
  },
  {
    regex: /disregard\s+(all\s+)?(previous|prior|above|earlier|system)\s+(instructions?|prompts?|rules?|guidelines?)/i,
    label: "system instruction override",
  },
  {
    regex: /forget\s+(all\s+)?(previous|prior|above|earlier|system)\s+(instructions?|prompts?|rules?|guidelines?)/i,
    label: "system instruction override",
  },
  // Role reassignment
  { regex: /you\s+are\s+now\s+(a|an|the|my)\s+/i, label: "role reassignment attempt" },
  { regex: /pretend\s+(you('re|\s+are)\s+)?(not\s+)?(a|an|the)\s+/i, label: "role manipulation" },
  { regex: /act\s+as\s+(if\s+)?(you('re|\s+are)\s+)?(a|an|the|my)\s+/i, label: "role manipulation" },
  // Chat template injection
  {
    regex: /\[system\]|\[inst\]|\[\/inst\]|<\|system\|>|<\|user\|>|<\|assistant\|>/i,
    label: "chat template injection",
  },
  { regex: /```\s*(system|instruction|prompt)/i, label: "code block instruction injection" },
  { regex: /override\s+(the\s+)?(system|safety|content)\s+(prompt|filter|policy)/i, label: "safety override attempt" },
];

/**
 * Normalize a string to defeat Unicode homoglyph and accent-based bypass attacks.
 * NFKD decomposition + stripping combining marks converts "ìgnórè" to "ignore".
 * Also normalizes Cyrillic lookalikes to Latin equivalents.
 */
function normalizeForDetection(input: string): string {
  // Strip zero-width characters that can break keyword matching (e.g., "i\u200Bgnore" → "ignore")
  let normalized = input.replace(/[\u200B\u200C\u200D\uFEFF\u00AD\u2060\u180E]/g, "");
  normalized = normalized.normalize("NFKD").replace(/[\u0300-\u036f]/g, ""); // Strip combining diacritical marks
  // Cyrillic lookalike substitution
  const cyrillicMap: Record<string, string> = { а: "a", е: "e", і: "i", о: "o", р: "p", с: "c", у: "y", х: "x" };
  normalized = normalized.replace(/[\u0400-\u04FF]/g, (ch) => cyrillicMap[ch.toLowerCase()] || ch);
  return normalized;
}

/**
 * Detect prompt injection in user-supplied text (RAG documents, user inputs).
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

/**
 * Detect prompt injection in call transcripts before AI analysis.
 *
 * Includes all standard patterns PLUS call-analysis-specific patterns
 * (score manipulation, output format override). Since transcripts come
 * from speech-to-text, injection text could be spoken by a malicious caller.
 *
 * Returns all matched patterns (not just the first) so reviewers can see
 * the full scope of potential manipulation.
 *
 * Does NOT block analysis — flags the call for reviewer attention.
 */
export function detectTranscriptInjection(input: string): InjectionCheckResult {
  const truncated = input.length > MAX_DETECTION_INPUT ? input.slice(0, MAX_DETECTION_INPUT) : input;
  let normalized = normalizeForDetection(truncated);
  normalized = decodeHtmlEntities(normalized);

  const allPatterns: string[] = [];

  // Check standard patterns
  for (const { regex, label } of INJECTION_PATTERNS) {
    if (regex.test(normalized)) allPatterns.push(label);
  }

  // Check call-analysis-specific patterns
  for (const { regex, label } of CALL_ANALYSIS_INJECTION_PATTERNS) {
    if (regex.test(normalized)) {
      if (!allPatterns.includes(label)) allPatterns.push(label);
    }
  }

  // Check for excessive special delimiters that may try to break prompt framing
  const delimiterCount = (normalized.match(/---+|===+|####+|\*\*\*+/g) || []).length;
  if (delimiterCount > 5) {
    allPatterns.push("excessive delimiters (context manipulation)");
  }

  return {
    isInjection: allPatterns.length > 0,
    pattern: allPatterns[0],
    allPatterns: allPatterns.length > 0 ? allPatterns : undefined,
  };
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

// Output-side patterns adapted from Call Analyzer's prompt-guard.ts
const OUTPUT_LEAK_PATTERNS: RegExp[] = [
  /my (?:system |internal )?(?:prompt|instructions?) (?:say|tell|are|is)/i,
  /here (?:is|are) my (?:system |internal )?(?:prompt|instructions?)/i,
  /i(?:'m| am) (?:actually |really )?(?:an? )?(?:AI|language model|LLM|chatbot|assistant)(?:,| and| that)/i,
  /as an? (?:AI|language model|LLM)/i,
];

const OUTPUT_ROLE_DEVIATION_PHRASES = [
  "here is the python code",
  "here is the javascript",
  "dear sir/madam",
  "as a creative writing exercise",
  "here is the translation",
  "i cannot analyze this call",
];

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
  // Enhanced output leak detection (from Call Analyzer)
  for (const pattern of OUTPUT_LEAK_PATTERNS) {
    if (pattern.test(output)) return { flagged: true, reason: "Response may reference internal instructions" };
  }
  const lower = output.toLowerCase();
  for (const phrase of OUTPUT_ROLE_DEVIATION_PHRASES) {
    if (lower.includes(phrase))
      return { flagged: true, reason: `Response deviates from call analysis role: "${phrase}"` };
  }
  return { flagged: false };
}

export function frameUserInput(input: string): string {
  return `<user_input>\n${input}\n</user_input>`;
}
