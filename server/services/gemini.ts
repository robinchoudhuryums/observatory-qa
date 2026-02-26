/**
 * Lightweight Vertex AI Gemini client using REST API.
 * Authenticates via the same service account credentials as GCS.
 * Replaces LeMUR for call analysis (summary, scoring, feedback).
 */
import { createSign } from "crypto";
import fs from "fs";

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  project_id: string;
}

export interface GeminiAnalysis {
  summary: string;
  topics: string[];
  sentiment: string;
  sentiment_score: number;
  performance_score: number;
  action_items: string[];
  feedback: {
    strengths: string[];
    suggestions: string[];
  };
}

export class GeminiService {
  private credentials: ServiceAccountKey | null = null;
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;

  constructor() {
    try {
      this.credentials = this.loadCredentials();
      console.log(`Gemini service initialized (project: ${this.credentials.project_id})`);
    } catch {
      console.warn("Gemini service: No GCS/Google credentials found. AI analysis will be unavailable.");
    }
  }

  get isAvailable(): boolean {
    return this.credentials !== null;
  }

  private loadCredentials(): ServiceAccountKey {
    if (process.env.GCS_CREDENTIALS) {
      return JSON.parse(process.env.GCS_CREDENTIALS);
    }
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      const raw = fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, "utf-8");
      return JSON.parse(raw);
    }
    throw new Error("No Google credentials configured");
  }

  private createJwt(): string {
    const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
    const now = Math.floor(Date.now() / 1000);
    const claimSet = Buffer.from(
      JSON.stringify({
        iss: this.credentials!.client_email,
        scope: "https://www.googleapis.com/auth/cloud-platform",
        aud: "https://oauth2.googleapis.com/token",
        iat: now,
        exp: now + 3600,
      })
    ).toString("base64url");

    const signatureInput = `${header}.${claimSet}`;
    const sign = createSign("RSA-SHA256");
    sign.update(signatureInput);
    const signature = sign.sign(this.credentials!.private_key, "base64url");

    return `${signatureInput}.${signature}`;
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiry - 300_000) {
      return this.accessToken;
    }

    const jwt = this.createJwt();
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
    });

    if (!response.ok) {
      throw new Error(`Failed to get access token: ${await response.text()}`);
    }

    const data = await response.json();
    this.accessToken = data.access_token;
    this.tokenExpiry = Date.now() + (data.expires_in || 3600) * 1000;
    return this.accessToken!;
  }

  async analyzeCallTranscript(transcriptText: string, callId: string): Promise<GeminiAnalysis> {
    if (!this.credentials) {
      throw new Error("Gemini service not configured");
    }

    const token = await this.getAccessToken();
    const projectId = this.credentials.project_id;
    const model = "gemini-2.0-flash";
    const location = "us-central1";

    const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;

    const prompt = `You are analyzing a customer service call transcript for a medical supply company. Analyze the following transcript and provide your assessment.

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
    "strengths": ["strength1", "strength2"],
    "suggestions": ["suggestion1", "suggestion2"]
  }
}

Guidelines:
- sentiment_score: 0.0 to 1.0 (1.0 = most positive)
- performance_score: 0.0 to 10.0 (10.0 = best)
- Evaluate the agent on: professionalism, product knowledge, empathy, problem resolution, and compliance with medical supply protocols
- Be specific in strengths and suggestions — reference actual moments from the call
- Include 2-4 action items that are concrete and actionable
- Topics should be specific (e.g. "order tracking", "billing dispute") not generic`;

    console.log(`[${callId}] Calling Gemini (${model}) for analysis...`);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 2048,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API error (${response.status}): ${errorText}`);
    }

    const result = await response.json();
    const responseText = result.candidates?.[0]?.content?.parts?.[0]?.text || "";

    // Extract JSON from response (handle potential markdown fences)
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn(`[${callId}] Gemini response was not parseable JSON:`, responseText.slice(0, 200));
      throw new Error("Gemini response did not contain valid JSON");
    }

    const analysis: GeminiAnalysis = JSON.parse(jsonMatch[0]);
    console.log(`[${callId}] Gemini analysis complete (score: ${analysis.performance_score}/10, sentiment: ${analysis.sentiment})`);
    return analysis;
  }
}

export const geminiService = new GeminiService();
