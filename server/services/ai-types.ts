/**
 * AI Analysis Provider — shared interfaces, types, and core utilities.
 */
import { logger } from "./logger";

export interface CallAnalysis {
  summary: string;
  topics: string[];
  sentiment: string;
  sentiment_score: number;
  performance_score: number;
  sub_scores: {
    compliance: number;
    customer_experience: number;
    communication: number;
    resolution: number;
  };
  action_items: string[];
  feedback: {
    strengths: Array<string | { text: string; timestamp?: string }>;
    suggestions: Array<string | { text: string; timestamp?: string }>;
  };
  call_party_type: string;
  flags: string[];
  detected_agent_name: string | null;
  /**
   * Score rationale: 3-5 concise bullet points per dimension explaining the score.
   * Keyed by dimension name: compliance, customer_experience, communication, resolution
   */
  score_rationale?: Record<string, string[]>;
  /**
   * Short hash identifying which system prompt version generated this analysis.
   * Computed from the rendered system prompt text, stored for audit and debugging.
   */
  prompt_version_id?: string;
  /** Present only for clinical encounter / telemedicine categories */
  clinical_note?: {
    format: string;
    specialty?: string;
    chief_complaint?: string;
    subjective?: string;
    objective?: string;
    assessment?: string;
    plan?: string[];
    hpi_narrative?: string;
    review_of_systems?: Record<string, string>;
    differential_diagnoses?: string[];
    icd10_codes?: Array<{ code: string; description: string }>;
    cpt_codes?: Array<{ code: string; description: string }>;
    prescriptions?: Array<{ medication: string; dosage?: string; instructions?: string }>;
    follow_up?: string;
    documentation_completeness?: number;
    clinical_accuracy?: number;
    missing_sections?: string[];
  };
}

export interface AIAnalysisProvider {
  readonly name: string;
  readonly isAvailable: boolean;
  analyzeCallTranscript(
    transcriptText: string,
    callId: string,
    callCategory?: string,
    promptTemplate?: PromptTemplateConfig,
    options?: { transcriptConfidence?: number },
  ): Promise<CallAnalysis>;
  generateText?(prompt: string): Promise<string>;
}

export interface PromptTemplateConfig {
  evaluationCriteria?: string;
  requiredPhrases?: Array<{ phrase: string; label: string; severity: string }>;
  scoringWeights?: { compliance: number; customerExperience: number; communication: number; resolution: number };
  additionalInstructions?: string;
  /** Extracted text from company reference documents (injected automatically) */
  referenceDocuments?: Array<{ name: string; category: string; text: string }>;
  /** Provider-specific style preferences for clinical note generation */
  providerStylePreferences?: {
    noteFormat?: string;
    sectionOrder?: string[];
    abbreviationLevel?: "minimal" | "moderate" | "heavy";
    includeNegativePertinents?: boolean;
    defaultSpecialty?: string;
    customSections?: string[];
    templateOverrides?: Record<string, string>;
  };
  /** Clinical specialty for specialty-specific prompt context */
  clinicalSpecialty?: string;
}

/**
 * Build a prompt for generating a narrative agent profile summary.
 */
export function buildAgentSummaryPrompt(data: {
  name: string;
  role?: string;
  totalCalls: number;
  avgScore: number | null;
  highScore: number | null;
  lowScore: number | null;
  sentimentBreakdown: { positive: number; neutral: number; negative: number };
  topStrengths: Array<{ text: string; count: number }>;
  topSuggestions: Array<{ text: string; count: number }>;
  commonTopics: Array<{ text: string; count: number }>;
  dateRange: string;
}): string {
  const strengthsList = data.topStrengths.map((s) => `- "${s.text}" (observed ${s.count} times)`).join("\n");
  const suggestionsList = data.topSuggestions.map((s) => `- "${s.text}" (observed ${s.count} times)`).join("\n");
  const topicsList = data.commonTopics.map((t) => `- ${t.text} (${t.count} calls)`).join("\n");

  return `You are an HR/quality assurance analyst for a medical supply company. Write a professional performance summary for the following call center agent based on aggregated data from their analyzed calls.

AGENT: ${data.name}
DEPARTMENT: ${data.role || "N/A"}
PERIOD: ${data.dateRange}
TOTAL CALLS ANALYZED: ${data.totalCalls}

PERFORMANCE SCORES:
- Average: ${data.avgScore?.toFixed(1) ?? "N/A"}/10
- Best: ${data.highScore?.toFixed(1) ?? "N/A"}/10
- Lowest: ${data.lowScore?.toFixed(1) ?? "N/A"}/10

SENTIMENT BREAKDOWN:
- Positive: ${data.sentimentBreakdown.positive}
- Neutral: ${data.sentimentBreakdown.neutral}
- Negative: ${data.sentimentBreakdown.negative}

RECURRING STRENGTHS:
${strengthsList || "None identified"}

RECURRING AREAS FOR IMPROVEMENT:
${suggestionsList || "None identified"}

COMMON CALL TOPICS:
${topicsList || "Various"}

Write a concise (3-4 paragraph) professional narrative that:
1. Summarizes overall performance and trends
2. Highlights consistent strengths with specific examples from the data
3. Identifies key areas for improvement with actionable recommendations
4. Provides a brief outlook or coaching recommendation

Use a professional but supportive tone appropriate for a performance review. Do NOT use markdown formatting, bullet points, or headers — write in plain paragraph form.`;
}

/**
 * Parse score_rationale from AI response.
 * Expects { compliance: string[], customer_experience: string[], ... }
 * Validates each dimension is a string array with ≤5 items.
 */
function parseScoreRationale(raw: unknown): Record<string, string[]> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const obj = raw as Record<string, unknown>;
  const result: Record<string, string[]> = {};
  const validDimensions = ["compliance", "customer_experience", "communication", "resolution"];
  let hasAny = false;
  for (const dim of validDimensions) {
    if (!Array.isArray(obj[dim])) continue;
    const items = (obj[dim] as unknown[]).filter((x) => typeof x === "string" && x.length > 0).slice(0, 5) as string[];
    if (items.length > 0) {
      result[dim] = items;
      hasAny = true;
    }
  }
  return hasAny ? result : undefined;
}

/**
 * Extract ALL top-level balanced JSON-object-like substrings from a string by
 * walking braces with string-literal awareness. Returns them in source order.
 *
 * Avoids the F-05 bug where a greedy `/\{[\s\S]*\}/` regex matched from the
 * first `{` to the LAST `}`, silently capturing explanation text. Correctly
 * handles `{`/`}` inside string literals and escaped quotes.
 *
 * Note: this finds BALANCED objects (e.g. `{example}` is balanced even though
 * it isn't valid JSON). The caller should attempt `JSON.parse` on each candidate
 * in order and use the first one that parses successfully — this lets us skip
 * over "{example}"-style placeholders in an AI preamble before reaching the
 * real JSON block.
 */
function extractBalancedJsonObjects(text: string): string[] {
  const results: string[] = [];
  let i = 0;
  while (i < text.length) {
    const start = text.indexOf("{", i);
    if (start === -1) break;

    let depth = 0;
    let inString = false;
    let escapeNext = false;
    let end = -1;

    for (let j = start; j < text.length; j++) {
      const ch = text[j];
      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      if (ch === "\\" && inString) {
        escapeNext = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;

      if (ch === "{") {
        depth++;
      } else if (ch === "}") {
        depth--;
        if (depth === 0) {
          end = j;
          break;
        }
      }
    }

    if (end === -1) {
      // Unclosed object from this `{` onward — no more candidates possible.
      break;
    }
    results.push(text.slice(start, end + 1));
    i = end + 1;
  }
  return results;
}

/**
 * Parse a JSON object from model output, handling markdown fences, preamble
 * text, and balanced-brace placeholders like `{example}` that aren't valid JSON.
 *
 * Strategy (in order, first success wins):
 *   1. Strip markdown code fences (```json ... ```) and try parsing the content.
 *   2. Try parsing the full trimmed response as JSON.
 *   3. Walk the response looking for balanced `{...}` substrings and try each
 *      one in source order until one parses as a JSON object.
 *
 * This avoids the F-05 bug where a greedy regex matched from the first `{`
 * to the LAST `}`, silently capturing explanation text between the AI's
 * preamble and its actual JSON block.
 */
export function parseJsonResponse(text: string, callId: string): CallAnalysis {
  const tryParseObject = (candidate: string): Record<string, unknown> | null => {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Fall through to return null.
    }
    return null;
  };

  // 1. Strip markdown code fences if present (```json ... ``` or ``` ... ```).
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const fencedContent = fenceMatch ? fenceMatch[1] : null;

  let raw: Record<string, unknown> | null = null;

  // 2. Try fenced content first (highest precedence when present).
  if (fencedContent) {
    raw = tryParseObject(fencedContent.trim());
  }

  // 3. Try the full trimmed response — covers the clean-JSON happy path.
  if (!raw) {
    raw = tryParseObject(text.trim());
  }

  // 4. Fall back to walking the response for balanced {...} objects and try each.
  //    This handles AI preamble like "Here's the analysis {example}: {...real JSON...}"
  //    where a naive first-balanced match would grab `{example}`.
  if (!raw) {
    const candidates = extractBalancedJsonObjects(fencedContent || text);
    for (const candidate of candidates) {
      const parsed = tryParseObject(candidate);
      if (parsed) {
        raw = parsed;
        break;
      }
    }
  }

  if (!raw) {
    // Distinguish "no brace candidates at all" from "candidates existed but none parsed".
    const hadBraceCandidates = extractBalancedJsonObjects(fencedContent || text).length > 0;
    if (!hadBraceCandidates) {
      logger.warn(
        { callId, responsePreview: text.slice(0, 200), responseLength: text.length, errorCode: "AI_NO_JSON" },
        "AI response contained no JSON object — may be truncated or an error message",
      );
      const err = new Error("AI response did not contain valid JSON");
      (err as any).code = "AI_NO_JSON";
      throw err;
    }
    logger.warn(
      { callId, responsePreview: text.slice(0, 300), errorCode: "AI_MALFORMED_JSON" },
      "AI response JSON parse failed — response may be truncated or contain syntax errors",
    );
    const err2 = new Error("AI response contained malformed JSON");
    (err2 as any).code = "AI_MALFORMED_JSON";
    throw err2;
  }

  // Validate and normalize with safe defaults for missing/malformed fields
  const clampScore = (v: unknown, min: number, max: number, fallback: number): number => {
    const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
    if (isNaN(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  };

  const toStringArray = (v: unknown): string[] => {
    if (Array.isArray(v))
      return v
        .map((x) => {
          if (typeof x === "string") return x;
          // AI may return objects like {text: "...", timestamp: "MM:SS"} — extract text
          if (x && typeof x === "object") {
            const obj = x as Record<string, unknown>;
            return typeof obj.text === "string"
              ? obj.text
              : typeof obj.message === "string"
                ? obj.message
                : typeof obj.value === "string"
                  ? obj.value
                  : JSON.stringify(x);
          }
          return String(x);
        })
        .filter((s) => s.length > 0);
    if (typeof v === "string") return [v];
    return [];
  };

  const rawSubScores =
    raw.sub_scores && typeof raw.sub_scores === "object" && !Array.isArray(raw.sub_scores)
      ? (raw.sub_scores as Record<string, unknown>)
      : {};

  const rawFeedback =
    raw.feedback && typeof raw.feedback === "object" && !Array.isArray(raw.feedback)
      ? (raw.feedback as Record<string, unknown>)
      : {};

  const analysis: CallAnalysis = {
    summary: typeof raw.summary === "string" ? raw.summary : "",
    topics: toStringArray(raw.topics),
    sentiment: typeof raw.sentiment === "string" ? raw.sentiment : "neutral",
    sentiment_score: clampScore(raw.sentiment_score, 0, 1, 0.5),
    performance_score: clampScore(raw.performance_score, 0, 10, 5.0),
    sub_scores: {
      compliance: clampScore(rawSubScores.compliance, 0, 10, 5.0),
      customer_experience: clampScore(rawSubScores.customer_experience, 0, 10, 5.0),
      communication: clampScore(rawSubScores.communication, 0, 10, 5.0),
      resolution: clampScore(rawSubScores.resolution, 0, 10, 5.0),
    },
    action_items: toStringArray(raw.action_items),
    feedback: {
      strengths: toStringArray(rawFeedback.strengths),
      suggestions: toStringArray(rawFeedback.suggestions),
    },
    call_party_type: typeof raw.call_party_type === "string" ? raw.call_party_type : "other",
    flags: toStringArray(raw.flags).filter((f) => {
      // Validate flag format: known flags or missing_required_phrase:<label>
      const validFlags = [
        "low_score",
        "exceptional_call",
        "agent_misconduct",
        "compliance_risk",
        "empty_transcript",
        "audio_missing",
        "low_confidence",
        "transcript_edited",
      ];
      if (validFlags.includes(f)) return true;
      if (f.startsWith("missing_required_phrase:")) return true;
      // Allow custom flags with safe format: lowercase alphanumeric + underscores + hyphens,
      // optional colon-separated prefix (e.g., "custom:high_urgency"). Reject arbitrary strings
      // that could break downstream filters, analytics queries, or UI rendering.
      if (f.length > 0 && f.length < 100 && /^[a-z0-9][a-z0-9_-]*(?::[a-z0-9_-]+)?$/.test(f)) return true;
      return false;
    }),
    detected_agent_name: typeof raw.detected_agent_name === "string" ? raw.detected_agent_name : null,
    score_rationale: parseScoreRationale(raw.score_rationale),
  };

  // Carry through clinical_note if present
  if (raw.clinical_note && typeof raw.clinical_note === "object") {
    analysis.clinical_note = raw.clinical_note as CallAnalysis["clinical_note"];
  }

  // Log if we had to fix missing fields — helps audit AI data quality
  const missingFields: string[] = [];
  if (!raw.summary) missingFields.push("summary");
  if (!raw.performance_score && raw.performance_score !== 0) missingFields.push("performance_score");
  if (!raw.sentiment_score && raw.sentiment_score !== 0) missingFields.push("sentiment_score");
  if (!raw.sub_scores) missingFields.push("sub_scores");
  else {
    // Track individual sub-score defaults
    for (const key of ["compliance", "customer_experience", "communication", "resolution"]) {
      if (!(key in (raw.sub_scores as Record<string, unknown>))) missingFields.push(`sub_scores.${key}`);
    }
  }
  if (!raw.feedback) missingFields.push("feedback");
  if (!raw.detected_agent_name) missingFields.push("detected_agent_name");
  if (missingFields.length > 0) {
    logger.warn(
      { callId, missingFields, fieldCount: missingFields.length },
      "AI response missing fields — defaults applied",
    );
  }

  return analysis;
}
