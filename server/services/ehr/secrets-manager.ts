/**
 * AWS Secrets Manager integration for EHR credentials.
 *
 * When an org's EHR config includes a `secretArn`, credentials are fetched
 * from AWS Secrets Manager at runtime rather than decrypting them from org
 * settings JSONB. This provides stronger security by:
 *   - Keeping credentials completely out of the application database
 *   - Enabling IAM-based access control and credential rotation
 *   - Providing a full audit trail via CloudTrail
 *
 * The secret value should be a JSON object:
 *   {
 *     "apiKey": "<EHR API key or token>",
 *     "customerKey": "<optional secondary key>",  // Open Dental
 *     "practiceId": "<optional practice ID>"       // Eaglesoft
 *   }
 *
 * Usage:
 *   const config = await resolveEhrConfig(rawEhrConfig);
 *   // config.apiKey is populated from Secrets Manager if secretArn is set
 *
 * Falls back to PHI-encrypted apiKey in org settings if Secrets Manager
 * is unavailable or not configured (for backward compatibility).
 */

import { getAwsCredentials } from "../aws-credentials.js";
import { createHmac } from "crypto";
import { logger } from "../logger.js";
import type { EhrConnectionConfig } from "./types.js";

/** Cache to avoid calling Secrets Manager on every request (5-minute TTL) */
const secretCache = new Map<string, { value: string; expiresAt: number }>();
const SECRET_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch a secret from AWS Secrets Manager using SigV4-signed REST calls.
 * No AWS SDK required — uses raw fetch + manual SigV4 signing.
 */
async function fetchSecret(secretArn: string, region: string): Promise<string | null> {
  const creds = await getAwsCredentials();
  if (!creds) {
    logger.warn({ secretArn }, "No AWS credentials available for Secrets Manager");
    return null;
  }

  const endpoint = `https://secretsmanager.${region}.amazonaws.com/`;
  const payload = JSON.stringify({ SecretId: secretArn });
  const service = "secretsmanager";
  const now = new Date();

  const dateStamp = now.toISOString().slice(0, 10).replace(/-/g, "");
  const amzDate = now.toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";

  const canonicalHeaders =
    [
      `content-type:application/x-amz-json-1.1`,
      `host:secretsmanager.${region}.amazonaws.com`,
      `x-amz-date:${amzDate}`,
      ...(creds.sessionToken ? [`x-amz-security-token:${creds.sessionToken}`] : []),
      "x-amz-target:secretsmanager.GetSecretValue",
    ].join("\n") + "\n";

  const signedHeaders = [
    "content-type",
    "host",
    "x-amz-date",
    ...(creds.sessionToken ? ["x-amz-security-token"] : []),
    "x-amz-target",
  ].join(";");

  // SHA-256 of payload
  const payloadHash = await sha256Hex(payload);

  const canonicalRequest = ["POST", "/", "", canonicalHeaders, signedHeaders, payloadHash].join("\n");

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, await sha256Hex(canonicalRequest)].join("\n");

  const signingKey = await getSigningKey(creds.secretAccessKey, dateStamp, region, service);
  const signature = hmacHex(signingKey, stringToSign);

  const authorization = [
    `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${credentialScope}`,
    `SignedHeaders=${signedHeaders}`,
    `Signature=${signature}`,
  ].join(", ");

  const headers: Record<string, string> = {
    "Content-Type": "application/x-amz-json-1.1",
    "X-Amz-Date": amzDate,
    "X-Amz-Target": "secretsmanager.GetSecretValue",
    Authorization: authorization,
  };
  if (creds.sessionToken) {
    headers["X-Amz-Security-Token"] = creds.sessionToken;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: payload,
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      logger.warn({ secretArn, status: response.status, errText }, "Secrets Manager request failed");
      return null;
    }

    const data = (await response.json()) as { SecretString?: string; SecretBinary?: string };
    return data.SecretString || null;
  } catch (err) {
    logger.warn({ err, secretArn }, "Failed to fetch secret from Secrets Manager");
    return null;
  }
}

/**
 * Resolve EHR credentials from AWS Secrets Manager (if secretArn is configured)
 * or fall back to the decrypted apiKey in org settings.
 *
 * The decryptedApiKey param should already be decrypted by the caller
 * (via decryptField) when secretArn is absent.
 */
export async function resolveEhrCredentials(
  ehrConfig: EhrConnectionConfig & { secretArn?: string },
  decryptedApiKey?: string,
): Promise<EhrConnectionConfig> {
  const secretArn = ehrConfig.secretArn;

  if (!secretArn) {
    // No Secrets Manager — use the (already-decrypted) PHI-encrypted key
    return { ...ehrConfig, apiKey: decryptedApiKey };
  }

  // Check cache first
  const cached = secretCache.get(secretArn);
  if (cached && cached.expiresAt > Date.now()) {
    try {
      const secret = JSON.parse(cached.value);
      return mergeSecretIntoConfig(ehrConfig, secret);
    } catch {
      // Malformed cache entry — continue to fetch
    }
  }

  // Parse region from ARN: arn:aws:secretsmanager:{region}:{account}:secret:{name}
  const arnParts = secretArn.split(":");
  const region = arnParts[3] || process.env.AWS_REGION || "us-east-1";

  const secretValue = await fetchSecret(secretArn, region);
  if (!secretValue) {
    logger.warn({ secretArn }, "Secrets Manager unavailable — falling back to org-settings credential");
    return { ...ehrConfig, apiKey: decryptedApiKey };
  }

  // Cache the result
  secretCache.set(secretArn, {
    value: secretValue,
    expiresAt: Date.now() + SECRET_CACHE_TTL_MS,
  });

  try {
    const secret = JSON.parse(secretValue);
    return mergeSecretIntoConfig(ehrConfig, secret);
  } catch {
    // Secret is a bare string (not JSON) — treat as the apiKey
    return { ...ehrConfig, apiKey: secretValue };
  }
}

/** Merge secret JSON fields into the EHR config */
function mergeSecretIntoConfig(config: EhrConnectionConfig, secret: Record<string, string>): EhrConnectionConfig {
  return {
    ...config,
    apiKey: secret.apiKey || secret.api_key || secret.token || config.apiKey,
    options: {
      ...config.options,
      ...(secret.customerKey ? { customerKey: secret.customerKey } : {}),
      ...(secret.practiceId ? { practiceId: secret.practiceId } : {}),
      ...(secret.clinicId ? { clinicId: secret.clinicId } : {}),
    },
  };
}

/**
 * Invalidate the Secrets Manager cache for a specific secret ARN.
 * Call this after updating credentials.
 */
export function invalidateSecretCache(secretArn: string): void {
  secretCache.delete(secretArn);
}

// --- SigV4 helpers (no external SDK) ---

async function sha256Hex(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-256", encoder.encode(data));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hmacSha256(key: Uint8Array | string, data: string): Promise<Uint8Array> {
  const keyBytes = typeof key === "string" ? new TextEncoder().encode(key) : key;
  const cryptoKey = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data));
  return new Uint8Array(sig);
}

function hmacHex(key: Uint8Array, data: string): string {
  // Sync fallback using Node crypto (same result)
  const hmac = createHmac("sha256", Buffer.from(key));
  hmac.update(data);
  return hmac.digest("hex");
}

async function getSigningKey(
  secretAccessKey: string,
  dateStamp: string,
  region: string,
  service: string,
): Promise<Uint8Array> {
  const kDate = await hmacSha256(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  return hmacSha256(kService, "aws4_request");
}
