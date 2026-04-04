/**
 * Application-level PHI field encryption using AES-256-GCM.
 *
 * HIPAA: Encrypts sensitive fields (transcript text, call analysis summaries)
 * at the application layer, independent of disk/transport encryption.
 * This provides defense-in-depth: even if database backups are exposed,
 * PHI fields remain encrypted.
 *
 * Key management: Uses PHI_ENCRYPTION_KEY env var (64-char hex = 32 bytes).
 *
 * KEY ESCROW / DISASTER RECOVERY:
 * If PHI_ENCRYPTION_KEY is lost, ALL encrypted clinical data becomes permanently
 * inaccessible. There is NO backdoor or recovery mechanism by design.
 *
 * Recommended key backup strategy:
 *   1. Store the key in AWS Secrets Manager (primary): `aws secretsmanager create-secret --name observatory/phi-key --secret-string $PHI_ENCRYPTION_KEY`
 *   2. Store a backup in a separate AWS account or region for cross-account redundancy
 *   3. Document the key ID and rotation procedure in your organization's runbook
 *   4. For key rotation: set PHI_ENCRYPTION_KEY to the new key and PHI_ENCRYPTION_KEY_PREV
 *      to the old key. The system will decrypt with either key but encrypt with the new one.
 *      After all records are re-encrypted, remove PHI_ENCRYPTION_KEY_PREV.
 *
 * Format: base64(iv:ciphertext:authTag) — all in one string for DB storage.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { logger } from "./logger";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // GCM standard
const AUTH_TAG_LENGTH = 16;

let encryptionKey: Buffer | null = null;
let prevEncryptionKey: Buffer | null | undefined = undefined; // undefined = not yet loaded
let _encryptionWarningLogged = false;

function getKey(): Buffer | null {
  if (encryptionKey) return encryptionKey;

  const keyHex = process.env.PHI_ENCRYPTION_KEY;
  if (!keyHex) return null;

  if (keyHex.length !== 64) {
    logger.error("PHI_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes)");
    return null;
  }

  encryptionKey = Buffer.from(keyHex, "hex");
  return encryptionKey;
}

/**
 * Load the previous encryption key for key-rotation decryption fallback.
 * Set PHI_ENCRYPTION_KEY_PREV to the old key when rotating to a new key.
 * Once all records are re-encrypted, remove PHI_ENCRYPTION_KEY_PREV.
 */
function getPrevKey(): Buffer | null {
  if (prevEncryptionKey !== undefined) return prevEncryptionKey;

  const keyHex = process.env.PHI_ENCRYPTION_KEY_PREV;
  if (!keyHex) {
    prevEncryptionKey = null;
    return null;
  }

  if (keyHex.length !== 64) {
    logger.error("PHI_ENCRYPTION_KEY_PREV must be exactly 64 hex characters (32 bytes)");
    prevEncryptionKey = null;
    return null;
  }

  prevEncryptionKey = Buffer.from(keyHex, "hex");
  logger.info("PHI key rotation mode: previous key loaded for decryption fallback");
  return prevEncryptionKey;
}

/** Inner decrypt — tries one specific key. Throws on failure. */
function decryptWithKey(payload: string, key: Buffer): string {
  const packed = Buffer.from(payload, "base64");
  const minLength = IV_LENGTH + AUTH_TAG_LENGTH; // iv (12) + authTag (16) = 28; ciphertext may be 0 for empty strings
  if (packed.length < minLength) {
    throw new Error(`Invalid encrypted payload: ${packed.length} bytes is below minimum ${minLength} (corrupt or truncated data)`);
  }
  const iv = packed.subarray(0, IV_LENGTH);
  const authTag = packed.subarray(packed.length - AUTH_TAG_LENGTH);
  const ciphertext = packed.subarray(IV_LENGTH, packed.length - AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);
  return decipher.update(ciphertext) + decipher.final("utf8");
}

/**
 * Check if PHI encryption is configured and available.
 */
export function isPhiEncryptionEnabled(): boolean {
  return getKey() !== null;
}

/**
 * Encrypt a plaintext string. Returns the encrypted payload as a prefixed string.
 *
 * HIPAA: In production, throws if PHI_ENCRYPTION_KEY is not set — PHI must never
 * be stored unencrypted. In development, logs a warning and returns plaintext
 * to allow local dev without key setup.
 */
export function encryptField(plaintext: string): string {
  const key = getKey();
  if (!key) {
    if (process.env.NODE_ENV === "production") {
      const msg = "CRITICAL: PHI_ENCRYPTION_KEY not configured — refusing to store unencrypted PHI in production";
      logger.error(msg);
      throw new Error(msg);
    }
    if (!_encryptionWarningLogged) {
      logger.warn("PHI_ENCRYPTION_KEY not set — PHI fields will be stored unencrypted (development only)");
      _encryptionWarningLogged = true;
    }
    return plaintext;
  }

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Pack as: enc_v1:<base64(iv + ciphertext + authTag)>
  const packed = Buffer.concat([iv, encrypted, authTag]);
  return `enc_v1:${packed.toString("base64")}`;
}

/**
 * Decrypt an encrypted field. If the value doesn't have the encryption prefix,
 * returns it as-is (backward compatibility with unencrypted data).
 *
 * THROWS on decryption failure — callers must handle errors and return a
 * proper HTTP error rather than surfacing broken placeholder strings to users.
 * Returning a placeholder to a clinician making care decisions is a patient
 * safety issue and a HIPAA data-integrity violation.
 */
export function decryptField(encrypted: string): string {
  if (!encrypted.startsWith("enc_v1:")) return encrypted;

  const key = getKey();
  if (!key) {
    const msg = "Cannot decrypt PHI field: PHI_ENCRYPTION_KEY not configured";
    logger.error(msg);
    throw new Error(msg);
  }

  const payload = encrypted.slice(7); // strip "enc_v1:" prefix

  // Try current key first
  try {
    return decryptWithKey(payload, key);
  } catch (primaryErr) {
    // Current key failed — try previous key if one is configured (key rotation in progress)
    const prevKey = getPrevKey();
    if (prevKey) {
      try {
        const plaintext = decryptWithKey(payload, prevKey);
        logger.warn("PHI field decrypted with previous key — re-encrypt with current key is recommended");
        return plaintext;
      } catch {
        // Both keys failed — fall through to the error below
      }
    }
    logger.error({ err: primaryErr }, "Failed to decrypt PHI field — data may be corrupted or key mismatch");
    throw new Error("PHI decryption failed: data may be corrupted or the encryption key has changed");
  }
}

/**
 * Encrypt a TOTP MFA secret for storage.
 * Uses the same AES-256-GCM but with a distinct prefix for clarity.
 */
export function encryptMfaSecret(secret: string): string {
  return encryptField(secret);
}

/**
 * Decrypt a stored MFA secret.
 */
export function decryptMfaSecret(encrypted: string): string {
  return decryptField(encrypted);
}

/**
 * Decrypt PHI fields in a clinical note object.
 * Safe to call on already-decrypted or null data — no-ops gracefully.
 * Modifies the object in-place for efficiency.
 *
 * HIPAA: Logs decryption events for audit trail when context is provided.
 */
const PHI_FIELDS = [
  "subjective",
  "objective",
  "assessment",
  "hpiNarrative",
  "chiefComplaint",
  "reviewOfSystems",
  "differentialDiagnoses",
  "periodontalFindings",
  "attestedNpi",
  "cosignedNpi",
] as const;

export interface PhiDecryptionContext {
  userId?: string;
  orgId?: string;
  resourceId?: string;
  resourceType?: string;
}

export function decryptClinicalNotePhi(
  analysis: Record<string, unknown> | null | undefined,
  auditContext?: PhiDecryptionContext,
): void {
  if (!analysis) return;
  const cn = analysis.clinicalNote as Record<string, unknown> | undefined;
  if (!cn) return;

  let decryptedCount = 0;
  for (const field of PHI_FIELDS) {
    if (typeof cn[field] === "string" && (cn[field] as string).startsWith("enc_v1:")) {
      cn[field] = decryptField(cn[field] as string);
      decryptedCount++;
    }
  }

  // Decrypt addendum content — addenda may contain clinical details (PHI)
  const amendments = cn.amendments as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(amendments)) {
    for (const amendment of amendments) {
      if (typeof amendment.content === "string" && (amendment.content as string).startsWith("enc_v1:")) {
        amendment.content = decryptField(amendment.content as string);
        decryptedCount++;
      }
    }
  }

  // HIPAA: Log PHI decryption event for audit trail
  if (decryptedCount > 0 && auditContext) {
    logger.info(
      {
        _audit: "PHI_DECRYPT",
        userId: auditContext.userId,
        orgId: auditContext.orgId,
        resourceType: auditContext.resourceType || "clinical_note",
        resourceId: auditContext.resourceId,
        fieldsDecrypted: decryptedCount,
      },
      "[HIPAA_AUDIT] PHI fields decrypted",
    );
  }
}
