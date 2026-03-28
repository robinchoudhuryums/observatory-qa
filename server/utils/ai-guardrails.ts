/**
 * AI Guardrails for the Observatory QA platform.
 *
 * Provides prompt injection detection, output safety checks, and
 * context framing to harden the RAG pipeline against adversarial inputs.
 */

export interface InjectionCheckResult {
  isInjection: boolean;
  pattern?: string;
}

const INJECTION_PATTERNS: Array<{ regex: RegExp; label: string }> = [
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
  { regex: /<\/system>/i, label: "</system> tag injection" },
  { regex: /<system>/i, label: "<system> tag injection" },
  { regex: /<\/instructions>/i, label: "</instructions> tag injection" },
];

export function detectPromptInjection(input: string): InjectionCheckResult {
  for (const { regex, label } of INJECTION_PATTERNS) {
    if (regex.test(input)) return { isInjection: true, pattern: label };
  }
  return { isInjection: false };
}

export interface OutputGuardrailResult {
  flagged: boolean;
  reason?: string;
}

const ROLE_DEVIATION_PHRASES = [
  "As an AI language model",
  "I cannot help with",
  "I'm sorry, but as an AI",
];

const PROMPT_ECHO_MARKERS = ["SYSTEM:", "INSTRUCTIONS:", "### System"];

export function checkOutputGuardrails(
  output: string,
  systemPromptSnippets?: string[],
): OutputGuardrailResult {
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
