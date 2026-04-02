/**
 * Embedding generation service using Amazon Titan Embed V2 via Bedrock.
 *
 * Uses @aws-sdk/client-bedrock-runtime InvokeModelCommand.
 *
 * Model: amazon.titan-embed-text-v2:0
 * Dimensions: 1024 (normalized)
 * Max input: 8,192 tokens (~8,000 characters with safety margin)
 */
import { createHash } from "crypto";
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { fromEnv, fromInstanceMetadata } from "@aws-sdk/credential-providers";
import type { AwsCredentialIdentityProvider } from "@aws-sdk/types";
import { logger } from "./logger";
import type { EmbeddingProvider } from "./embedding-provider";

const EMBED_MODEL = "amazon.titan-embed-text-v2:0";
const EMBED_DIMENSIONS = 1024;
const MAX_INPUT_CHARS = 8000;
const BATCH_SIZE = 20; // Concurrent embeddings per batch
const EMBED_TIMEOUT_MS = 30_000; // 30 seconds

// --- Embedding cache (deduplicates identical queries, LRU eviction) ---
import { LruCache } from "../utils/lru-cache";

const CACHE_MAX_SIZE = 200;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

const embeddingCache = new LruCache<number[]>({ maxSize: CACHE_MAX_SIZE, ttlMs: CACHE_TTL_MS });

// Prune expired cache entries every 10 minutes
setInterval(() => embeddingCache.prune(), 10 * 60 * 1000).unref();

function getCacheKey(text: string): string {
  return createHash("sha256").update(text.slice(0, MAX_INPUT_CHARS)).digest("hex");
}

/**
 * Create a BedrockRuntimeClient for embeddings.
 * Returns null if no AWS credentials are configured.
 */
function createEmbeddingClient(): BedrockRuntimeClient | null {
  const region = process.env.AWS_REGION || "us-east-1";

  let credentials: AwsCredentialIdentityProvider;
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    credentials = fromEnv();
  } else {
    // Fall back to EC2 instance metadata (IMDSv2)
    // Note: isEmbeddingAvailable() checks env vars only for a quick sync check;
    // on EC2 this client will still work via instance profile
    credentials = fromInstanceMetadata({ timeout: 3000, maxRetries: 1 });
  }

  return new BedrockRuntimeClient({
    region,
    credentials,
    requestHandler: {
      requestTimeout: EMBED_TIMEOUT_MS,
    } as any,
  });
}

// Lazily initialized client singleton
let _client: BedrockRuntimeClient | null | undefined;
function getClient(): BedrockRuntimeClient | null {
  if (_client === undefined) {
    try {
      _client = createEmbeddingClient();
    } catch (err) {
      logger.warn({ err }, "Failed to initialize Bedrock embedding client");
      _client = null;
    }
  }
  return _client;
}

/**
 * Generate a single embedding vector for text input.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const client = getClient();
  if (!client) throw new Error("AWS credentials not configured for embeddings");

  // Truncate to model's input limit, warn if content was lost
  const inputText = text.slice(0, MAX_INPUT_CHARS);
  if (text.length > MAX_INPUT_CHARS) {
    logger.warn(
      { originalLength: text.length, truncatedTo: MAX_INPUT_CHARS },
      "Embedding input truncated — tail content lost",
    );
  }

  // Check cache first (deduplicates identical queries within TTL)
  const cacheKey = getCacheKey(inputText);
  const cached = embeddingCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const body = JSON.stringify({
    inputText,
    dimensions: EMBED_DIMENSIONS,
    normalize: true,
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EMBED_TIMEOUT_MS);

  try {
    // Retry transient failures (timeouts, throttling) up to 2 times with exponential backoff
    let embedding: number[] | undefined;
    let lastErr: Error | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const command = new InvokeModelCommand({
          modelId: EMBED_MODEL,
          contentType: "application/json",
          accept: "application/json",
          body: new TextEncoder().encode(body),
        });

        const response = await client.send(command, { abortSignal: controller.signal });
        const responseBody = new TextDecoder().decode(response.body);
        const result = JSON.parse(responseBody) as { embedding: number[] };
        embedding = result.embedding;
        break; // Success
      } catch (retryErr: any) {
        lastErr = retryErr;
        const status = retryErr?.$metadata?.httpStatusCode;
        // Only retry on throttling (429) or server errors (5xx), not client errors
        if (status && status < 500 && status !== 429) throw retryErr;
        if (attempt < 2) {
          const delay = Math.pow(2, attempt) * 1000; // 1s, 2s
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }
    if (!embedding) throw lastErr || new Error("Embedding generation failed after retries");

    // Validate embedding dimensions and values
    if (!Array.isArray(embedding) || embedding.length !== EMBED_DIMENSIONS) {
      throw new Error(
        `Unexpected embedding dimensions: expected ${EMBED_DIMENSIONS}, got ${Array.isArray(embedding) ? embedding.length : "non-array"}`,
      );
    }
    // Guard against NaN/Infinity values that would corrupt pgvector operations
    if (embedding.some((v) => !Number.isFinite(v))) {
      throw new Error("Embedding contains NaN or Infinity values — aborting to prevent pgvector corruption");
    }

    // Cache the result (LRU eviction handles capacity)
    embeddingCache.set(cacheKey, embedding);

    return embedding;
  } catch (err: any) {
    const statusCode = err?.$metadata?.httpStatusCode || "unknown";
    throw new Error(`Bedrock Embedding API error (${statusCode}): ${(err?.message || "").substring(0, 200)}`);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Generate embeddings for multiple texts in batches with backpressure.
 * Processes up to `concurrency` texts simultaneously within each batch,
 * logging progress at each batch boundary.
 *
 * For large document uploads (100+ chunks), this provides steady throughput
 * without overwhelming Bedrock's rate limits.
 */
/**
 * Generate embeddings for multiple texts in batches with backpressure.
 *
 * Failed chunks get `null` instead of empty arrays to prevent pgvector
 * corruption — empty arrays produce undefined cosine distances. Callers
 * MUST check for null before inserting into the database.
 */
export async function generateEmbeddingsBatch(
  texts: string[],
  opts?: { concurrency?: number; onProgress?: (completed: number, total: number) => void },
): Promise<(number[] | null)[]> {
  const concurrency = opts?.concurrency ?? BATCH_SIZE;
  const results: (number[] | null)[] = new Array(texts.length);
  let completed = 0;

  for (let i = 0; i < texts.length; i += concurrency) {
    const batch = texts.slice(i, i + concurrency);
    const batchNum = Math.floor(i / concurrency) + 1;
    const totalBatches = Math.ceil(texts.length / concurrency);
    logger.info(
      { batch: batchNum, totalBatches, batchSize: batch.length, total: texts.length },
      `Generating embeddings batch ${batchNum}/${totalBatches}`,
    );

    // Use allSettled so one failed embedding doesn't abort the entire batch.
    const batchResults = await Promise.allSettled(batch.map((text) => generateEmbedding(text)));

    let batchFailures = 0;
    for (let j = 0; j < batchResults.length; j++) {
      const result = batchResults[j];
      if (result.status === "fulfilled") {
        results[i + j] = result.value;
      } else {
        batchFailures++;
        // Store null — NOT empty array. Empty arrays in pgvector produce
        // undefined cosine distances and corrupt search results.
        results[i + j] = null;
        logger.warn(
          { chunkIndex: i + j, batch: batchNum, err: result.reason },
          "Embedding generation failed for chunk — stored without embedding",
        );
      }
    }
    if (batchFailures > 0) {
      logger.warn(
        { batch: batchNum, failures: batchFailures, batchSize: batch.length },
        `${batchFailures}/${batch.length} embeddings failed in batch ${batchNum}`,
      );
    }
    completed += batch.length;
    opts?.onProgress?.(completed, texts.length);
  }

  return results;
}

/**
 * Check if embedding generation is available (AWS credentials configured).
 */
export function isEmbeddingAvailable(): boolean {
  return !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
}

/**
 * Titan Embed V2 implementation of the EmbeddingProvider interface.
 * Allows the embedding model to be swapped without changing calling code.
 */
export class TitanEmbeddingProvider implements EmbeddingProvider {
  readonly name = "Amazon Titan Embed V2";
  readonly dimensions = EMBED_DIMENSIONS;
  readonly maxInputChars = MAX_INPUT_CHARS;

  async embed(text: string): Promise<number[]> {
    return generateEmbedding(text);
  }

  isAvailable(): boolean {
    return isEmbeddingAvailable();
  }
}

/** Default provider instance */
export const defaultEmbeddingProvider: EmbeddingProvider = new TitanEmbeddingProvider();
