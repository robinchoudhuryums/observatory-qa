/**
 * AI Analysis Provider — shared interface and factory.
 *
 * Supports multiple backends:
 *   AI_PROVIDER=gemini   — Google AI Studio or Vertex AI (default)
 *   AI_PROVIDER=bedrock  — AWS Bedrock with Claude
 *
 * All providers implement the same interface and return identical output shapes.
 */

export interface CallAnalysis {
  summary: string;
  topics: string[];
  sentiment: string;
  sentiment_score: number;
  performance_score: number;
  action_items: string[];
  feedback: {
    strengths: Array<string | { text: string; timestamp?: string }>;
    suggestions: Array<string | { text: string; timestamp?: string }>;
  };
  call_party_type: string;
  flags: string[];
}

export interface AIAnalysisProvider {
  readonly name: string;
  readonly isAvailable: boolean;
  analyzeCallTranscript(transcriptText: string, callId: string, callCategory?: string): Promise<CallAnalysis>;
  generateText?(prompt: string): Promise<string>;
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
  const strengthsList = data.topStrengths.map(s => `- "${s.text}" (observed ${s.count} times)`).join("\n");
  const suggestionsList = data.topSuggestions.map(s => `- "${s.text}" (observed ${s.count} times)`).join("\n");
  const topicsList = data.commonTopics.map(t => `- ${t.text} (${t.count} calls)`).join("\n");

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

const CATEGORY_CONTEXT: Record<string, string> = {
  inbound: "This is an INBOUND call — a customer or patient called into the company. One speaker is the customer/patient and the other is the company employee/agent.",
  outbound: "This is an OUTBOUND call — the company employee called a customer or patient. One speaker is the employee/agent and the other is the customer/patient.",
  internal: "This is an INTERNAL call — both speakers are coworkers or employees within the same company. Evaluate collaboration, communication clarity, and productivity rather than customer service metrics.",
  vendor: "This is a VENDOR/PARTNER call — the employee is speaking with an external vendor or business partner. Evaluate negotiation, clarity, and professionalism.",
};

export function buildAnalysisPrompt(transcriptText: string, callCategory?: string): string {
  const categoryContext = callCategory && CATEGORY_CONTEXT[callCategory]
    ? `\nCALL CONTEXT:\n${CATEGORY_CONTEXT[callCategory]}\n`
    : "";

  const evaluationCriteria = callCategory === "internal"
    ? "- Evaluate on: communication clarity, collaboration effectiveness, action item follow-through, and productivity"
    : "- Evaluate the agent on: professionalism, product knowledge, empathy, problem resolution, and compliance with medical supply protocols";

  return `You are analyzing a call transcript for a medical supply company. Analyze the following transcript and provide your assessment.
${categoryContext}
TRANSCRIPT:
${transcriptText}

Respond with ONLY valid JSON in this exact format (no markdown, no code fences):
{
  "summary": "A concise one-paragraph summary of what happened in the call",
  "topics": ["topic1", "topic2", "topic3"],
  "sentiment": "positive|neutral|negative",
  "sentiment_score": 0.0,
  "performance_score": 0.0,
  "action_items": ["action1", "action2"],
  "feedback": {
    "strengths": [{"text": "Description of strength referencing a specific moment", "timestamp": "MM:SS"}],
    "suggestions": [{"text": "Description of suggestion referencing a specific moment", "timestamp": "MM:SS"}]
  },
  "call_party_type": "customer|insurance|medical_facility|medicare|vendor|internal|other",
  "flags": []
}

Guidelines:
- sentiment_score: 0.0 to 1.0 (1.0 = most positive)
- performance_score: 0.0 to 10.0 (10.0 = best)
${evaluationCriteria}
- For EACH strength and suggestion, include the approximate timestamp (MM:SS format) of the moment in the call you are referencing. Use the timestamps from the transcript to determine the time.
- Include 2-4 action items that are concrete and actionable
- Topics should be specific (e.g. "order tracking", "billing dispute") not generic
- call_party_type: Classify who the agent is speaking with. Use "customer" for general patients/customers, "insurance" for insurance company representatives, "medical_facility" for hospitals/clinics/doctors offices, "medicare" for 1-800-MEDICARE or Medicare representatives, "vendor" for vendors/suppliers, "internal" for coworkers, or "other" if unclear.
- flags: An array of flag strings. Add "medicare_call" if the call involves 1-800-MEDICARE or a Medicare representative. Add "low_score" if the performance_score is 2.0 or below. Add "agent_misconduct" if the agent displays any of: abusive language toward the caller, hanging up on the caller, refusing to help, making false promises, HIPAA violations, or other serious professional misconduct. Describe the misconduct briefly in the flag like "agent_misconduct:hung up on caller".`;
}

/**
 * Parse a JSON object from model output, handling markdown fences and extra text.
 */
export function parseJsonResponse(text: string, callId: string): CallAnalysis {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.warn(`[${callId}] AI response was not parseable JSON:`, text.slice(0, 200));
    throw new Error("AI response did not contain valid JSON");
  }

  try {
    return JSON.parse(jsonMatch[0]) as CallAnalysis;
  } catch (parseError) {
    console.warn(`[${callId}] JSON parse failed:`, (parseError as Error).message, text.slice(0, 300));
    throw new Error("AI response contained malformed JSON");
  }
}
