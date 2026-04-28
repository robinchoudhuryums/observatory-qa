/**
 * AWS Bedrock + Claude provider for call analysis.
 *
 * Authentication — uses @aws-sdk/client-bedrock-runtime with credential
 * resolution from env vars or EC2 instance profile (IMDSv2).
 *
 * HIPAA: Bedrock is HIPAA-eligible under the AWS BAA.
 * Just ensure your AWS account has a BAA in place.
 *
 * Uses the Bedrock Converse API via ConverseCommand.
 *
 * OPTIMIZATION: System prompt is sent as a separate cacheable field.
 * Bedrock caches system prompts across requests with the same prefix,
 * reducing input token costs by 25-40% for repeated analysis calls.
 */
import { BedrockRuntimeClient, ConverseCommand, type ConverseCommandOutput } from "@aws-sdk/client-bedrock-runtime";
import { fromEnv, fromInstanceMetadata } from "@aws-sdk/credential-providers";
import type { AwsCredentialIdentityProvider } from "@aws-sdk/types";
import type { AIAnalysisProvider, CallAnalysis } from "./ai-provider";
import { buildSystemPrompt, buildUserMessage, parseJsonResponse } from "./ai-provider";
import { getAwsCredentials, type AwsCredentials } from "./aws-credentials";
import { logger } from "./logger";
import { redactTextForCategory } from "./phi-policy";

const DEFAULT_MODEL = "us.anthropic.claude-sonnet-4-6";
const BEDROCK_TIMEOUT_MS = 120_000; // 2 minutes — long transcripts may need >60s

export class BedrockProvider implements AIAnalysisProvider {
  readonly name = "bedrock";
  private credentials: AwsCredentials | null = null;
  private model: string;
  private credentialsInitialized = false;
  private client: BedrockRuntimeClient | null = null;

  /**
   * @param modelOverride - Per-org model override (from OrgSettings.bedrockModel)
   */
  constructor(modelOverride?: string) {
    this.model = modelOverride || process.env.BEDROCK_MODEL || DEFAULT_MODEL;

    // Eagerly try env vars for backward compat (async IMDSv2 resolved on first use)
    if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
      this.credentials = {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID.trim(),
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY.trim(),
        sessionToken: process.env.AWS_SESSION_TOKEN?.trim(),
        region: process.env.AWS_REGION?.trim() || "us-east-1",
        source: "env" as const,
      };
      this.credentialsInitialized = true;
      this.client = this.createClient(this.credentials.region);
      logger.info(
        { region: this.credentials.region, model: this.model },
        "Bedrock provider initialized (env credentials)",
      );
    } else {
      logger.info({ model: this.model }, "Bedrock provider: will attempt IMDSv2 on first use");
    }
  }

  /**
   * Create a BedrockRuntimeClient for the given region.
   */
  private createClient(region: string): BedrockRuntimeClient {
    let credentials: AwsCredentialIdentityProvider;
    if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
      credentials = fromEnv();
    } else {
      credentials = fromInstanceMetadata({ timeout: 3000, maxRetries: 1 });
    }

    return new BedrockRuntimeClient({
      region,
      credentials,
      requestHandler: {
        requestTimeout: BEDROCK_TIMEOUT_MS,
      } as any,
    });
  }

  /**
   * Ensure credentials are resolved (env or IMDSv2).
   */
  private async ensureCredentials(): Promise<void> {
    if (this.credentialsInitialized && this.credentials) {
      // Check if IMDSv2 creds are about to expire
      if (this.credentials.expiresAt) {
        const bufferMs = 5 * 60 * 1000;
        if (this.credentials.expiresAt.getTime() - Date.now() < bufferMs) {
          this.credentials = await getAwsCredentials();
          if (this.credentials) {
            this.client = this.createClient(this.credentials.region);
          }
        }
      }
      return;
    }
    this.credentials = await getAwsCredentials();
    this.credentialsInitialized = true;
    if (this.credentials) {
      this.client = this.createClient(this.credentials.region);
      logger.info(
        { source: this.credentials.source, region: this.credentials.region, model: this.model },
        "Bedrock provider credentials resolved",
      );
    } else {
      logger.warn("Bedrock provider: No AWS credentials available (checked env + IMDSv2)");
    }
  }

  /** Create a provider with a specific model — used for A/B testing. */
  static createWithModel(modelId: string): BedrockProvider {
    return new BedrockProvider(modelId);
  }

  get modelId(): string {
    return this.model;
  }

  get isAvailable(): boolean {
    // If credentials haven't been resolved yet (IMDSv2 path), optimistically return true
    // since ensureCredentials() will resolve them on first use
    if (!this.credentialsInitialized) return true;
    return this.credentials !== null;
  }

  async generateText(prompt: string): Promise<string> {
    await this.ensureCredentials();
    if (!this.credentials || !this.client) {
      throw new Error("Bedrock provider not configured — no AWS credentials available");
    }

    // Retry with exponential backoff for transient failures (429, 5xx, timeout).
    // All callers (coaching plans, insurance narratives, reports, referral letters)
    // benefit without needing individual withRetry() wrappers.
    const MAX_RETRIES = 2;
    const BASE_DELAY_MS = 1000;
    let lastErr: any;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), BEDROCK_TIMEOUT_MS);
      try {
        const command = new ConverseCommand({
          modelId: this.model,
          messages: [{ role: "user", content: [{ text: prompt }] }],
          inferenceConfig: { temperature: 0.4, maxTokens: 2048 },
        });

        const result = await this.client.send(command, { abortSignal: controller.signal });

        this.logTokenUsage(result, "generateText");
        // F-06: Bedrock can return a successful response with no text content
        // (content filter blocks, empty response structure, or API shape changes).
        // Previously this returned "" which callers (coaching engine, call insights,
        // reports, emails) treated as a valid empty output — coaching plans appeared
        // "generated" with no content. Throw explicitly; marked retryable since a
        // transient blip in the response pipeline may recover on the next attempt.
        const text = result.output?.message?.content?.[0]?.text;
        if (!text || text.length === 0) {
          logger.warn(
            { model: this.model, stopReason: result.stopReason },
            "Bedrock generateText returned empty content — treating as retryable failure",
          );
          const emptyErr = new Error("Bedrock returned empty response content");
          (emptyErr as any).isBedrockEmptyContent = true;
          throw emptyErr;
        }
        return text;
      } catch (err: any) {
        lastErr = err;
        clearTimeout(timeout);
        const statusCode = err?.$metadata?.httpStatusCode;
        const isRetryable =
          statusCode === 429 ||
          (statusCode >= 500 && statusCode < 600) ||
          err?.name === "AbortError" ||
          err?.name === "TimeoutError" ||
          err?.isBedrockEmptyContent === true;

        if (isRetryable && attempt < MAX_RETRIES) {
          const delay = BASE_DELAY_MS * Math.pow(2, attempt);
          logger.warn({ attempt: attempt + 1, statusCode, delay }, "Bedrock generateText transient failure — retrying");
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        // Non-retryable or retries exhausted
        // HIPAA: Truncate error to avoid leaking PHI in logs
        throw new Error(`Bedrock API error (${statusCode || "unknown"}): ${(err?.message || "").substring(0, 200)}`);
      } finally {
        clearTimeout(timeout);
      }
    }
    throw lastErr; // Should never reach here, but TypeScript needs it
  }

  async analyzeCallTranscript(
    transcriptText: string,
    callId: string,
    callCategory?: string,
    promptTemplate?: any,
    options?: { transcriptConfidence?: number },
  ): Promise<CallAnalysis> {
    await this.ensureCredentials();
    if (!this.credentials || !this.client) {
      throw new Error("Bedrock provider not configured — no AWS credentials available");
    }

    // PHI redaction policy: redact transcript before it enters the user message
    // for non-clinical categories. Clinical categories (clinical_encounter,
    // telemedicine, dental_*) preserve PHI because the AI's job is to draft
    // SOAP/DAP/BIRP notes that require patient details. See phi-policy.ts.
    // Defense-in-depth on top of the AWS Bedrock BAA — minimizes PHI in
    // Bedrock's prompt cache and CloudTrail.
    const safeTranscript = redactTextForCategory(transcriptText, callCategory);

    // Split prompt into cacheable system prompt + dynamic user message
    const systemPrompt = buildSystemPrompt(callCategory, promptTemplate);
    const userMessage = buildUserMessage(safeTranscript, callCategory, {
      transcriptConfidence: options?.transcriptConfidence,
    });

    logger.info(
      { callId, model: this.model, systemPromptLen: systemPrompt.length, userMsgLen: userMessage.length },
      "Calling Bedrock for analysis",
    );

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), BEDROCK_TIMEOUT_MS);
    let result: ConverseCommandOutput;
    try {
      // System prompt sent with explicit cache point — Bedrock caches the system
      // prompt prefix across requests, reducing input token costs by up to 90%.
      // Adapted from UMS's buildSystemBlocks() prompt caching pattern.
      // The cachePoint block tells Bedrock to cache everything above it.
      const command = new ConverseCommand({
        modelId: this.model,
        system: [{ text: systemPrompt } as any, { cachePoint: { type: "default" } } as any],
        messages: [{ role: "user", content: [{ text: userMessage }] }],
        inferenceConfig: {
          temperature: 0.3,
          maxTokens: 2048,
        },
      });

      result = await this.client.send(command, { abortSignal: controller.signal });
    } catch (err: any) {
      // HIPAA: Truncate error to avoid leaking PHI in logs
      const statusCode = err?.$metadata?.httpStatusCode || "unknown";
      throw new Error(`Bedrock API error (${statusCode}): ${(err?.message || "").substring(0, 200)}`);
    } finally {
      clearTimeout(timeout);
    }

    // Log token usage for cost tracking
    this.logTokenUsage(result, callId);

    // Converse API response shape:
    // { output: { message: { role: "assistant", content: [{ text: "..." }] } }, usage: { inputTokens, outputTokens } }
    const responseText = result.output?.message?.content?.[0]?.text || "";

    const analysis = parseJsonResponse(responseText, callId);

    // Attach actual token usage from Bedrock response for accurate cost tracking
    // (instead of estimating from text length)
    const usage = result?.usage;
    if (usage) {
      (analysis as any)._tokenUsage = {
        inputTokens: usage.inputTokens || 0,
        outputTokens: usage.outputTokens || 0,
        cacheReadTokens: (usage as any).cacheReadInputTokens || (usage as any).cacheReadInputTokenCount || 0,
      };
    }

    logger.info(
      { callId, performanceScore: analysis.performance_score, sentiment: analysis.sentiment },
      "Bedrock analysis complete",
    );
    return analysis;
  }

  /**
   * Log token usage from Bedrock response for cost tracking and billing.
   */
  private logTokenUsage(result: any, context: string): void {
    const usage = result?.usage;
    if (usage) {
      const cacheRead = usage.cacheReadInputTokenCount || 0;
      const cacheWrite = usage.cacheWriteInputTokenCount || 0;
      const cacheHit = cacheRead > 0;
      logger.info(
        {
          context,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          totalTokens: (usage.inputTokens || 0) + (usage.outputTokens || 0),
          cacheReadTokens: cacheRead,
          cacheWriteTokens: cacheWrite,
          promptCacheStatus: cacheHit ? "hit" : cacheWrite > 0 ? "miss_written" : "no_cache",
        },
        cacheHit ? `Bedrock token usage — prompt cache HIT (${cacheRead} cached tokens)` : "Bedrock token usage",
      );
    }
  }
}
