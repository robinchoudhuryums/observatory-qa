import { InsertTranscript, InsertSentimentAnalysis, InsertCallAnalysis } from "@shared/schema";
import type { CallAnalysis } from "./ai-provider";
import { normalizeStringArray } from "../utils";
import { logger } from "./logger";

/** Normalize a sentiment value to one of the valid enum values. */
function normalizeSentiment(value: unknown): "positive" | "neutral" | "negative" {
  const str = typeof value === "string" ? value.toLowerCase().trim() : "";
  if (str === "positive" || str === "negative") return str;
  return "neutral";
}

// --- Agent speaker detection patterns ---
// Phrases that strongly indicate the speaker is an agent/employee (not the caller).
// Matched against the first ~60 words per speaker to detect greetings.
const AGENT_GREETING_PATTERNS = [
  /\bthank(?:s| you) for calling\b/i,
  /\bmy name is\b/i,
  /\bthis is [^\s,.]+ (?:with|from|at)\b/i,
  /\bhow (?:can|may) I (?:help|assist)\b/i,
  /\bwelcome to\b/i,
  /\byou(?:'ve| have) reached\b/i,
  /\bthanks? for (?:choosing|reaching out|contacting)\b/i,
];

// Phrases that strongly indicate the speaker is a customer/patient.
const CUSTOMER_PATTERNS = [
  /\bI(?:'m| am) calling (?:about|because|to|regarding)\b/i,
  /\bI(?:'d| would) like to (?:schedule|make|book|cancel)\b/i,
  /\bI have (?:a |an )?(?:question|appointment|problem|issue)\b/i,
  /\bI need to (?:speak|talk) (?:to|with)\b/i,
];

/**
 * Detect speaker roles from transcript word patterns and optional AI-detected agent name.
 *
 * Strategy (in priority order):
 * 1. If AI detected an agent name, find which speaker said it in a self-introduction context
 * 2. Match greeting patterns (agent phrases vs customer phrases) in first ~60 words per speaker
 * 3. Return null if no confident detection (caller should fall back to org config or default)
 *
 * Returns a Record<string, "agent"|"customer"> or null if detection is inconclusive.
 */
export function detectSpeakerRolesFromTranscript(
  words: TranscriptWord[],
  detectedAgentName?: string | null,
): Record<string, string> | null {
  if (!words || words.length < 5) return null;

  // Collect unique speakers
  const speakers = new Set<string>();
  for (const w of words) {
    if (w.speaker) speakers.add(w.speaker);
  }
  if (speakers.size < 2) return null; // Need at least 2 speakers for role assignment

  // Build first ~60 words of text per speaker for pattern matching
  const speakerTexts = new Map<string, string>();
  const speakerWordCounts = new Map<string, number>();
  for (const w of words) {
    if (!w.speaker) continue;
    const count = speakerWordCounts.get(w.speaker) || 0;
    if (count >= 60) continue; // Only examine first ~60 words per speaker
    speakerWordCounts.set(w.speaker, count + 1);
    const existing = speakerTexts.get(w.speaker) || "";
    speakerTexts.set(w.speaker, existing + " " + w.text);
  }

  // Strategy 1: If AI detected an agent name, find which speaker said "my name is [name]"
  // or "this is [name]" where [name] matches the detected agent name.
  if (detectedAgentName && detectedAgentName.length >= 2) {
    const nameLower = detectedAgentName.toLowerCase();
    const namePattern = new RegExp(
      `\\b(?:(?:my name is|this is|I'm|I am)\\s+)${nameLower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
      "i",
    );
    for (const [speaker, text] of Array.from(speakerTexts)) {
      if (namePattern.test(text)) {
        // This speaker introduced themselves as the agent
        const roles: Record<string, string> = {};
        for (const s of Array.from(speakers)) {
          roles[s] = s === speaker ? "agent" : "customer";
        }
        logger.debug({ detectedAgentName, agentSpeaker: speaker }, "Speaker role detected via agent name match");
        return roles;
      }
    }
  }

  // Strategy 2: Pattern-based greeting detection
  let agentSpeaker: string | null = null;
  let customerSpeaker: string | null = null;
  let agentConfidence = 0;
  let customerConfidence = 0;

  for (const [speaker, text] of Array.from(speakerTexts)) {
    let agentScore = 0;
    let custScore = 0;
    for (const pat of AGENT_GREETING_PATTERNS) {
      if (pat.test(text)) agentScore++;
    }
    for (const pat of CUSTOMER_PATTERNS) {
      if (pat.test(text)) custScore++;
    }

    if (agentScore > custScore && agentScore > agentConfidence) {
      agentSpeaker = speaker;
      agentConfidence = agentScore;
    }
    if (custScore > agentScore && custScore > customerConfidence) {
      customerSpeaker = speaker;
      customerConfidence = custScore;
    }
  }

  // Only return if we have a clear signal (at least one pattern matched for agent role)
  if (agentSpeaker && agentConfidence >= 1) {
    const roles: Record<string, string> = {};
    for (const s of Array.from(speakers)) {
      roles[s] = s === agentSpeaker ? "agent" : "customer";
    }
    logger.debug(
      { agentSpeaker, agentConfidence, customerSpeaker, customerConfidence },
      "Speaker roles detected via greeting patterns",
    );
    return roles;
  }

  // Inconclusive — return null so caller falls back to org config or default
  return null;
}

export interface AssemblyAIConfig {
  apiKey: string;
  baseUrl: string;
}

export interface TranscriptWord {
  text: string;
  start: number;
  end: number;
  confidence: number;
  speaker?: string;
}

export interface AssemblyAIResponse {
  id: string;
  status: "queued" | "processing" | "completed" | "error";
  text?: string;
  confidence?: number;
  words?: TranscriptWord[];
  sentiment_analysis_results?: Array<{
    text: string;
    sentiment: "POSITIVE" | "NEUTRAL" | "NEGATIVE";
    confidence: number;
    start: number;
    end: number;
  }>;
  auto_chapters?: Array<{
    summary: string;
    headline: string;
    start: number;
    end: number;
  }>;
  iab_categories_result?: {
    summary: Record<string, number>;
  };
  error?: string;
  language_code?: string; // ISO language code (e.g., "en", "es") — set when language_detection: true
}

export interface TranscriptionOptions {
  webhookUrl?: string;
  webhookAuthHeaderValue?: string; // secret token sent in X-Assembly-Webhook-Token header
  wordBoost?: string[];
  piiRedaction?: {
    enabled: boolean;
    policies?: string[];
    substitution?: "hash" | "entity_name";
  };
  languageDetection?: boolean;
  /** ISO 639-1 language code (e.g., "en", "es"). When provided and non-English,
   *  sentiment_analysis is disabled to save ~12% on AssemblyAI costs (sentiment
   *  accuracy drops significantly for non-English audio). */
  language?: string;
}

export interface LeMURResponse {
  request_id: string;
  response: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

export class AssemblyAIService {
  private config: AssemblyAIConfig;

  constructor() {
    this.config = {
      apiKey: process.env.ASSEMBLYAI_API_KEY || "",
      baseUrl: "https://api.assemblyai.com/v2",
    };
    if (!this.config.apiKey) {
      logger.warn("ASSEMBLYAI_API_KEY is not set. Audio processing will fail.");
    }
  }

  async uploadAudioFile(audioBuffer: Buffer, fileName: string): Promise<string> {
    const response = await fetch(`${this.config.baseUrl}/upload`, {
      method: "POST",
      headers: { Authorization: this.config.apiKey, "Content-Type": "application/octet-stream" },
      body: audioBuffer,
    });
    if (!response.ok) throw new Error(`Failed to upload audio file: ${await response.text()}`);
    return (await response.json()).upload_url;
  }

  async transcribeAudio(audioUrl: string, options?: TranscriptionOptions): Promise<string> {
    // Default PII redaction policies (used when no override provided)
    const defaultPiiPolicies = [
      "person_name",
      "phone_number",
      "email_address",
      "date_of_birth",
      "us_social_security_number",
      "credit_card_number",
      "medical_record_number",
      "blood_type",
      "drug",
      "injury",
      "medical_condition",
    ];

    // Determine PII redaction settings
    const piiOpts = options?.piiRedaction;
    const piiEnabled = piiOpts ? piiOpts.enabled : true; // default on
    const piiPolicies = piiOpts?.policies && piiOpts.policies.length > 0 ? piiOpts.policies : defaultPiiPolicies;
    const piiSub = piiOpts?.substitution ?? "hash";

    // Skip sentiment analysis for explicitly non-English audio — saves ~12% on
    // AssemblyAI cost and avoids unreliable sentiment data. AI analysis (Bedrock)
    // still provides its own sentiment scoring regardless.
    const isNonEnglish = options?.language ? !options.language.toLowerCase().startsWith("en") : false;
    if (isNonEnglish) {
      logger.info(
        { language: options!.language },
        "Non-English language specified — disabling AssemblyAI sentiment analysis (cost optimization)",
      );
    }

    const body: Record<string, unknown> = {
      audio_url: audioUrl,
      speech_model: "best",
      speaker_labels: true,
      punctuate: true,
      format_text: true,
      sentiment_analysis: !isNonEnglish,
      // PII/PHI auto-redaction
      redact_pii: piiEnabled,
      ...(piiEnabled
        ? {
            redact_pii_policies: piiPolicies,
            redact_pii_sub: piiSub,
          }
        : {}),
    };

    // Language detection
    if (options?.languageDetection) {
      body.language_detection = true;
    }

    // Word boost (custom vocabulary)
    if (options?.wordBoost && options.wordBoost.length > 0) {
      body.word_boost = options.wordBoost;
    }

    // Webhook support — AssemblyAI will POST results instead of requiring polling
    if (options?.webhookUrl) {
      body.webhook_url = options.webhookUrl;
      body.webhook_auth_header_name = "X-Assembly-Webhook-Token";
      if (options.webhookAuthHeaderValue) {
        body.webhook_auth_header_value = options.webhookAuthHeaderValue;
      }
    }

    const response = await fetch(`${this.config.baseUrl}/transcript`, {
      method: "POST",
      headers: { Authorization: this.config.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`Failed to start transcription: ${await response.text()}`);
    return (await response.json()).id;
  }

  async getTranscript(transcriptId: string): Promise<AssemblyAIResponse> {
    const response = await fetch(`${this.config.baseUrl}/transcript/${transcriptId}`, {
      headers: { Authorization: this.config.apiKey },
    });
    if (!response.ok) throw new Error(`Failed to get transcript: ${await response.text()}`);
    return await response.json();
  }

  async pollTranscript(
    transcriptId: string,
    maxAttempts = 60,
    onProgress?: (attempt: number, maxAttempts: number, status: string) => void,
  ): Promise<AssemblyAIResponse> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const transcript = await this.getTranscript(transcriptId);

      if (transcript.status === "completed") {
        return transcript;
      }
      if (transcript.status === "error") {
        throw new Error(`Transcription failed: ${transcript.error || "Unknown error"}`);
      }

      onProgress?.(attempt, maxAttempts, transcript.status);

      // Wait with backoff: 3s for first 10 attempts, then 5s
      const delay = attempt < 10 ? 3000 : 5000;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    throw new Error("Transcription polling timed out");
  }

  // LeMUR task endpoint is synchronous - it returns the result directly
  async submitLeMURTask(transcriptId: string): Promise<LeMURResponse> {
    logger.info({ transcriptId }, "Submitting task to LeMUR");
    const response = await fetch(`https://api.assemblyai.com/lemur/v3/generate/task`, {
      method: "POST",
      headers: { Authorization: this.config.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        transcript_ids: [transcriptId],
        prompt: `Analyze this customer service call for a medical supply company. Provide your response in the following JSON format only, with no additional text:
{
  "summary": "A concise one-paragraph summary of the call",
  "topics": ["topic1", "topic2", "topic3"],
  "sentiment": "positive|neutral|negative",
  "sentiment_score": 0.0,
  "performance_score": 0.0,
  "action_items": ["action1", "action2"],
  "feedback": {
    "strengths": ["strength1", "strength2"],
    "suggestions": ["suggestion1", "suggestion2"]
  }
}

For sentiment_score, use 0.0-1.0 where 1.0 is most positive.
For performance_score, use 0.0-10.0 where 10.0 is best.
Evaluate the agent on: professionalism, product knowledge, empathy, problem resolution, and compliance with medical supply protocols.`,
      }),
    });
    if (!response.ok) throw new Error(`Failed to submit LeMUR task: ${await response.text()}`);
    const result = await response.json();
    logger.info({ transcriptId, requestId: result.request_id }, "LeMUR task complete");
    return result;
  }

  processTranscriptData(
    transcriptResponse: AssemblyAIResponse,
    aiAnalysis: CallAnalysis | null,
    callId: string,
    orgId: string,
    /** Optional per-org speaker role mapping (e.g., { A: "customer", B: "agent" } for IVR-routed calls). */
    orgSpeakerRoles?: Record<string, string>,
  ): { transcript: InsertTranscript; sentiment: InsertSentimentAnalysis; analysis: InsertCallAnalysis } {
    // Build transcript record
    const transcript: InsertTranscript = {
      orgId,
      callId,
      text: transcriptResponse.text || "",
      confidence: transcriptResponse.confidence?.toString(),
      words: transcriptResponse.words || [],
    };

    // Determine sentiment: prefer Gemini analysis, fall back to AssemblyAI sentiment results
    let overallSentiment = aiAnalysis?.sentiment || "neutral";
    let overallScore = aiAnalysis?.sentiment_score ?? 0.5;

    // Use AssemblyAI's sentiment results when AI analysis is missing OR when AI returned
    // no sentiment data. Previously, this only triggered when aiAnalysis was null, silently
    // discarding AssemblyAI sentiment when AI returned a valid analysis with null sentiment.
    const aiSentimentMissing = !aiAnalysis?.sentiment && !aiAnalysis?.sentiment_score;
    if (aiSentimentMissing && transcriptResponse.sentiment_analysis_results?.length) {
      const sentiments = transcriptResponse.sentiment_analysis_results;
      const positiveCount = sentiments.filter((s) => s.sentiment === "POSITIVE").length;
      const negativeCount = sentiments.filter((s) => s.sentiment === "NEGATIVE").length;
      const total = sentiments.length;

      if (positiveCount > total * 0.5) overallSentiment = "positive";
      else if (negativeCount > total * 0.3) overallSentiment = "negative";
      else overallSentiment = "neutral";

      // Compute overall sentiment positivity score (0 = strongly negative, 0.5 = neutral, 1 = strongly positive).
      // POSITIVE segments contribute their confidence directly (high conf positive → near 1).
      // NEGATIVE segments contribute (1 - confidence) — high conf negative → near 0.
      // NEUTRAL segments contribute 0.5 regardless of confidence.
      const positivityScore =
        sentiments.reduce((sum, s) => {
          if (s.sentiment === "POSITIVE") return sum + s.confidence;
          if (s.sentiment === "NEGATIVE") return sum + (1 - s.confidence);
          return sum + 0.5;
        }, 0) / total;
      overallScore = Math.round(positivityScore * 100) / 100;
    }

    // Validate overallSentiment to match the enum type
    const validatedSentiment = normalizeSentiment(overallSentiment);

    const sentiment: InsertSentimentAnalysis = {
      orgId,
      callId,
      overallSentiment: validatedSentiment,
      overallScore: overallScore.toString(),
      segments: transcriptResponse.sentiment_analysis_results || [],
    };

    // Build analysis record
    const performanceScore = aiAnalysis?.performance_score ?? 5.0;
    const words = transcriptResponse.words || [];

    // --- Speech Analytics: compute from word timing data ---
    const speechMetrics = this.computeSpeechMetrics(words);

    // --- Speaker role mapping ---
    // Priority: (1) auto-detect from transcript patterns + AI-detected agent name,
    //           (2) org-configured default, (3) hardcoded default (A=agent, B=customer).
    const detectedRoles = detectSpeakerRolesFromTranscript(words, aiAnalysis?.detected_agent_name ?? undefined);
    const speakerRoleMap: Record<string, string> =
      detectedRoles ??
      (orgSpeakerRoles && Object.keys(orgSpeakerRoles).length > 0 ? orgSpeakerRoles : { A: "agent", B: "customer" });

    // Calculate talk time ratio per speaker (uses role mapping from above).
    // Result is a 0.0–1.0 decimal representing the agent's share of talk time.
    let talkTimeRatio = 0.5;
    if (words.length > 0) {
      const totalTime = words[words.length - 1].end - words[0].start;
      if (totalTime > 0) {
        const agentLabels = Object.entries(speakerRoleMap)
          .filter(([, role]) => role === "agent")
          .map(([label]) => label);
        // If no speaker has the "agent" role (e.g., role map only has "customer"),
        // fall back to the first speaker in the map as a reasonable default.
        if (agentLabels.length === 0) {
          const firstSpeaker = Object.keys(speakerRoleMap)[0];
          if (firstSpeaker) agentLabels.push(firstSpeaker);
        }
        const agentTime = words
          .filter((w: TranscriptWord) => w.speaker && agentLabels.includes(w.speaker))
          .reduce((sum: number, w: TranscriptWord) => sum + (w.end - w.start), 0);
        talkTimeRatio = Math.round((agentTime / totalTime) * 100) / 100;
      }
    }

    // Determine flags
    const flags: string[] = aiAnalysis?.flags || [];
    if (performanceScore <= 2.0 && !flags.includes("low_score")) {
      flags.push("low_score");
    }
    if (performanceScore >= 9.0 && !flags.includes("exceptional_call")) {
      flags.push("exceptional_call");
    }

    const analysis: InsertCallAnalysis = {
      orgId,
      callId,
      performanceScore: performanceScore.toString(),
      talkTimeRatio: talkTimeRatio.toString(),
      responseTime: undefined,
      keywords: normalizeStringArray(aiAnalysis?.topics),
      topics: normalizeStringArray(aiAnalysis?.topics),
      summary:
        typeof aiAnalysis?.summary === "string"
          ? aiAnalysis.summary
          : aiAnalysis?.summary
            ? JSON.stringify(aiAnalysis.summary)
            : transcriptResponse.text?.slice(0, 500) || "",
      actionItems: normalizeStringArray(aiAnalysis?.action_items),
      feedback: aiAnalysis?.feedback || { strengths: [], suggestions: [] },
      lemurResponse: undefined,
      callPartyType: typeof aiAnalysis?.call_party_type === "string" ? aiAnalysis.call_party_type : undefined,
      flags: flags.length > 0 ? flags : undefined,
      speechMetrics: Object.keys(speechMetrics).length > 0 ? speechMetrics : undefined,
      speakerRoleMap,
    };

    return { transcript, sentiment, analysis };
  }

  /**
   * Compute speech analytics metrics from AssemblyAI word timing data.
   * Analyzes dead air, interruptions, talk speed, filler words, and response times.
   */
  private computeSpeechMetrics(words: TranscriptWord[]): Record<string, unknown> {
    if (!words || words.length < 2) return {};

    const DEAD_AIR_THRESHOLD_MS = 3000; // 3 seconds
    // Single-word fillers (matched per word token)
    const FILLER_WORDS = new Set([
      "um",
      "uh",
      "uhm",
      "hmm",
      "hm",
      "ah",
      "er",
      "erm",
      "like",
      "basically",
      "actually",
      "literally",
      "essentially",
      "right",
      "so",
      "well",
      "okay",
      "ok",
    ]);
    // Two-word filler phrases (matched by looking at consecutive word pairs)
    const FILLER_BIGRAMS = new Set(["you know", "i mean", "sort of", "kind of"]);

    const totalDurationMs = words[words.length - 1].end - words[0].start;
    if (totalDurationMs <= 0) return {};

    // --- Talk speed (words per minute) ---
    const totalWords = words.length;
    const talkSpeedWpm = Math.round((totalWords / (totalDurationMs / 60000)) * 10) / 10;

    // --- Dead air detection ---
    let deadAirSeconds = 0;
    let deadAirCount = 0;
    let longestDeadAirMs = 0;

    for (let i = 1; i < words.length; i++) {
      const gap = words[i].start - words[i - 1].end;
      if (gap >= DEAD_AIR_THRESHOLD_MS) {
        deadAirCount++;
        deadAirSeconds += gap / 1000;
        if (gap > longestDeadAirMs) longestDeadAirMs = gap;
      }
    }

    // --- Interruption detection (speaker overlap) ---
    let interruptionCount = 0;
    for (let i = 1; i < words.length; i++) {
      if (words[i].speaker && words[i - 1].speaker && words[i].speaker !== words[i - 1].speaker) {
        // Speaker changed — check if there's overlap (new speaker starts before old ends)
        if (words[i].start < words[i - 1].end) {
          interruptionCount++;
        }
      }
    }

    // --- Filler word count (single words + bigram phrases) ---
    const fillerWordCounts: Record<string, number> = {};
    let fillerWordTotal = 0;
    const bigramMatched = new Set<number>(); // indices already matched as part of a bigram

    // First pass: detect bigram filler phrases (e.g., "you know", "i mean")
    for (let i = 0; i < words.length - 1; i++) {
      const pair =
        words[i].text.toLowerCase().replace(/[.,!?]/g, "") +
        " " +
        words[i + 1].text.toLowerCase().replace(/[.,!?]/g, "");
      if (FILLER_BIGRAMS.has(pair)) {
        fillerWordCounts[pair] = (fillerWordCounts[pair] || 0) + 1;
        fillerWordTotal++;
        bigramMatched.add(i);
        bigramMatched.add(i + 1);
      }
    }

    // Second pass: single-word fillers (skip words already matched in bigrams)
    for (let i = 0; i < words.length; i++) {
      if (bigramMatched.has(i)) continue;
      const lower = words[i].text.toLowerCase().replace(/[.,!?]/g, "");
      if (FILLER_WORDS.has(lower)) {
        fillerWordCounts[lower] = (fillerWordCounts[lower] || 0) + 1;
        fillerWordTotal++;
      }
    }

    // --- Average response time between speaker turns ---
    const turnGaps: number[] = [];
    for (let i = 1; i < words.length; i++) {
      if (words[i].speaker && words[i - 1].speaker && words[i].speaker !== words[i - 1].speaker) {
        const gap = words[i].start - words[i - 1].end;
        if (gap > 0 && gap < 30000) {
          // Ignore unreasonable gaps
          turnGaps.push(gap);
        }
      }
    }
    const avgResponseTimeMs =
      turnGaps.length > 0 ? Math.round(turnGaps.reduce((a, b) => a + b, 0) / turnGaps.length) : undefined;

    // --- Per-speaker talk percentages ---
    const speakerTime: Record<string, number> = {};
    let unlabeledWordCount = 0;
    for (const w of words) {
      if (!w.speaker) unlabeledWordCount++;
      const speaker = w.speaker || "unknown";
      speakerTime[speaker] = (speakerTime[speaker] || 0) + (w.end - w.start);
    }
    const totalTalkTime = Object.values(speakerTime).reduce((a, b) => a + b, 0);
    const speakerATalkPercent =
      totalTalkTime > 0 ? Math.round(((speakerTime["A"] || 0) / totalTalkTime) * 100) : undefined;
    const speakerBTalkPercent =
      totalTalkTime > 0 ? Math.round(((speakerTime["B"] || 0) / totalTalkTime) * 100) : undefined;

    // Warn when >10% of words have no speaker label — metrics will be inaccurate
    const unlabeledPercent = words.length > 0 ? Math.round((unlabeledWordCount / words.length) * 100) : 0;

    return {
      talkSpeedWpm,
      deadAirSeconds: Math.round(deadAirSeconds * 10) / 10,
      deadAirCount,
      longestDeadAirSeconds: Math.round((longestDeadAirMs / 1000) * 10) / 10,
      interruptionCount,
      fillerWordCount: fillerWordTotal,
      fillerWords: Object.keys(fillerWordCounts).length > 0 ? fillerWordCounts : undefined,
      avgResponseTimeMs,
      speakerATalkPercent,
      speakerBTalkPercent,
      ...(unlabeledPercent > 10 ? { unlabeledSpeakerPercent: unlabeledPercent } : {}),
    };
  }
}

export const assemblyAIService = new AssemblyAIService();
