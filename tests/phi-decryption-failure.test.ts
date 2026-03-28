/**
 * PHI decryption failure path tests — key rotation, fallback, and error propagation.
 *
 * Covers the paths added for HIPAA compliance:
 *   - PHI_ENCRYPTION_KEY_PREV fallback when current key fails
 *   - Error thrown (not silently swallowed) when both keys fail
 *   - Re-encryption round-trip: data encrypted with PREV key decrypts via fallback
 *   - No cross-contamination between current and previous key slots
 *   - Decryption failure produces an error message surfaceable to audit log
 *
 * Run with: npx tsx --test tests/phi-decryption-failure.test.ts
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

const KEY_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"; // 64 hex chars
const KEY_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const KEY_C = "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";

// ---------------------------------------------------------------------------
// Module loader helper — bypasses ES module cache to pick up new env vars
// ---------------------------------------------------------------------------

async function loadMod() {
  return import(`../server/services/phi-encryption.js?t=${Date.now()}-${Math.random()}`);
}

// ---------------------------------------------------------------------------
// Env var save/restore
// ---------------------------------------------------------------------------

let savedKey: string | undefined;
let savedPrevKey: string | undefined;

beforeEach(() => {
  savedKey = process.env.PHI_ENCRYPTION_KEY;
  savedPrevKey = process.env.PHI_ENCRYPTION_KEY_PREV;
});

afterEach(() => {
  if (savedKey !== undefined) process.env.PHI_ENCRYPTION_KEY = savedKey;
  else delete process.env.PHI_ENCRYPTION_KEY;

  if (savedPrevKey !== undefined) process.env.PHI_ENCRYPTION_KEY_PREV = savedPrevKey;
  else delete process.env.PHI_ENCRYPTION_KEY_PREV;
});

// ---------------------------------------------------------------------------
// Key rotation — PREV fallback
// ---------------------------------------------------------------------------

describe("Key rotation — PHI_ENCRYPTION_KEY_PREV fallback", () => {
  it("data encrypted with old key decrypts successfully during rotation window", async () => {
    // Phase 1: encrypt with KEY_A
    process.env.PHI_ENCRYPTION_KEY = KEY_A;
    delete process.env.PHI_ENCRYPTION_KEY_PREV;
    const oldMod = await loadMod();
    const plaintext = "Patient: Jane Smith, DOB 1985-03-12, diagnosis: hypertension";
    const encryptedWithA = oldMod.encryptField(plaintext);
    assert.ok(encryptedWithA.startsWith("enc_v1:"));

    // Phase 2: rotate — KEY_B is current, KEY_A is previous
    process.env.PHI_ENCRYPTION_KEY = KEY_B;
    process.env.PHI_ENCRYPTION_KEY_PREV = KEY_A;
    const rotatedMod = await loadMod();

    // Data encrypted with A should still decrypt via PREV fallback
    const decrypted = rotatedMod.decryptField(encryptedWithA);
    assert.equal(decrypted, plaintext, "PREV key fallback must recover old ciphertext");
  });

  it("new data after rotation is encrypted with the current (new) key", async () => {
    process.env.PHI_ENCRYPTION_KEY = KEY_B;
    process.env.PHI_ENCRYPTION_KEY_PREV = KEY_A;
    const rotatedMod = await loadMod();

    const newPlaintext = "New clinical note after key rotation";
    const newEncrypted = rotatedMod.encryptField(newPlaintext);

    // Should decrypt using KEY_B (current)
    const decrypted = rotatedMod.decryptField(newEncrypted);
    assert.equal(decrypted, newPlaintext);

    // Should fail if we only have KEY_A (old key can't decrypt new ciphertext)
    process.env.PHI_ENCRYPTION_KEY = KEY_A;
    delete process.env.PHI_ENCRYPTION_KEY_PREV;
    const oldKeyOnlyMod = await loadMod();

    let threw = false;
    try {
      oldKeyOnlyMod.decryptField(newEncrypted);
    } catch {
      threw = true;
    }
    assert.ok(threw, "Old key alone must not decrypt data encrypted with new key");
  });

  it("re-encrypted data (old plaintext re-encrypted with new key) decrypts without PREV key", async () => {
    // Simulate the re-encryption migration script outcome:
    // Take data that was encrypted with KEY_A, decrypt it via PREV fallback,
    // re-encrypt with KEY_B, then remove PREV key.

    // Step 1: encrypt with A
    process.env.PHI_ENCRYPTION_KEY = KEY_A;
    delete process.env.PHI_ENCRYPTION_KEY_PREV;
    const mod1 = await loadMod();
    const plaintext = "Migrated PHI content";
    const encWithA = mod1.encryptField(plaintext);

    // Step 2: rotate — decrypt with PREV fallback
    process.env.PHI_ENCRYPTION_KEY = KEY_B;
    process.env.PHI_ENCRYPTION_KEY_PREV = KEY_A;
    const mod2 = await loadMod();
    const decrypted = mod2.decryptField(encWithA);
    assert.equal(decrypted, plaintext);

    // Step 3: re-encrypt with new key
    const reEncrypted = mod2.encryptField(decrypted);

    // Step 4: remove PREV key — new ciphertext must still work
    process.env.PHI_ENCRYPTION_KEY = KEY_B;
    delete process.env.PHI_ENCRYPTION_KEY_PREV;
    const mod3 = await loadMod();
    const finalDecrypt = mod3.decryptField(reEncrypted);
    assert.equal(finalDecrypt, plaintext, "Re-encrypted data must be recoverable without PREV key");
  });
});

// ---------------------------------------------------------------------------
// Both keys fail — must throw, not silently return garbage
// ---------------------------------------------------------------------------

describe("Both keys fail — throws with clear error", () => {
  it("throws when current key cannot decrypt and no PREV key is set", async () => {
    // Encrypt with KEY_A
    process.env.PHI_ENCRYPTION_KEY = KEY_A;
    delete process.env.PHI_ENCRYPTION_KEY_PREV;
    const mod1 = await loadMod();
    const encrypted = mod1.encryptField("Sensitive PHI data");

    // Switch to KEY_B — cannot decrypt KEY_A ciphertext — no fallback
    process.env.PHI_ENCRYPTION_KEY = KEY_B;
    delete process.env.PHI_ENCRYPTION_KEY_PREV;
    const mod2 = await loadMod();

    await assert.rejects(
      async () => mod2.decryptField(encrypted),
      (err: Error) => {
        assert.ok(err.message.length > 0, "Error must have a descriptive message");
        return true;
      }
    );
  });

  it("throws when both current and PREV key are wrong for the ciphertext", async () => {
    // Encrypt with KEY_A
    process.env.PHI_ENCRYPTION_KEY = KEY_A;
    delete process.env.PHI_ENCRYPTION_KEY_PREV;
    const mod1 = await loadMod();
    const encrypted = mod1.encryptField("Sensitive data");

    // Attempt with KEY_B (current) and KEY_C (prev) — neither matches KEY_A
    process.env.PHI_ENCRYPTION_KEY = KEY_B;
    process.env.PHI_ENCRYPTION_KEY_PREV = KEY_C;
    const mod2 = await loadMod();

    let threw = false;
    try {
      mod2.decryptField(encrypted);
    } catch (err) {
      threw = true;
      assert.ok(err instanceof Error, "Must throw an Error instance");
      assert.ok((err as Error).message.length > 0, "Error must have a message");
    }
    assert.ok(threw, "Must throw when neither key can decrypt");
  });

  it("corrupted ciphertext (truncated) throws even with correct key", async () => {
    process.env.PHI_ENCRYPTION_KEY = KEY_A;
    delete process.env.PHI_ENCRYPTION_KEY_PREV;
    const mod = await loadMod();

    const encrypted = mod.encryptField("Real patient data");
    // Truncate the payload to corrupt it
    const corrupted = encrypted.slice(0, encrypted.length - 20);

    let threw = false;
    try {
      mod.decryptField(corrupted);
    } catch {
      threw = true;
    }
    assert.ok(threw, "Truncated ciphertext must throw");
  });

  it("bit-flipped auth tag causes GCM to reject (tamper detection)", async () => {
    process.env.PHI_ENCRYPTION_KEY = KEY_A;
    delete process.env.PHI_ENCRYPTION_KEY_PREV;
    const mod = await loadMod();

    const encrypted = mod.encryptField("Tamper me");
    // Flip a byte in the binary payload (auth tag region) to guarantee tampering
    const prefix = "enc_v1:";
    const payload = encrypted.slice(prefix.length);
    const buf = Buffer.from(payload, "base64");
    // Flip the last byte (part of auth tag)
    buf[buf.length - 1] ^= 0xff;
    const tampered = prefix + buf.toString("base64");

    let threw = false;
    try {
      mod.decryptField(tampered);
    } catch {
      threw = true;
    }
    assert.ok(threw, "AES-GCM auth tag mismatch must throw (tamper detected)");
  });
});

// ---------------------------------------------------------------------------
// Error does not leak PHI
// ---------------------------------------------------------------------------

describe("Error message does not leak PHI", () => {
  it("thrown error message does not include plaintext content", async () => {
    process.env.PHI_ENCRYPTION_KEY = KEY_B;
    delete process.env.PHI_ENCRYPTION_KEY_PREV;
    const mod = await loadMod();

    let errorMessage = "";
    try {
      mod.decryptField("enc_v1:dGhpcyBpcyBub3QgdmFsaWQgY2lwaGVydGV4dA==");
    } catch (err) {
      errorMessage = (err as Error).message || "";
    }

    // Error must not contain the word "patient" or any embedded PHI
    assert.ok(!errorMessage.toLowerCase().includes("patient"),
      "Error message must not contain PHI keywords");
    assert.ok(errorMessage.length > 0, "Error must have a message");
  });
});

// ---------------------------------------------------------------------------
// Passthrough for non-encrypted data (legacy plaintext)
// ---------------------------------------------------------------------------

describe("Passthrough for unencrypted legacy data", () => {
  it("decryptField returns plaintext unchanged for strings without enc_v1: prefix", async () => {
    process.env.PHI_ENCRYPTION_KEY = KEY_A;
    delete process.env.PHI_ENCRYPTION_KEY_PREV;
    const mod = await loadMod();

    const legacyValue = "Legacy unencrypted note from before PHI encryption was enabled";
    const result = mod.decryptField(legacyValue);
    assert.equal(result, legacyValue, "Non-prefixed strings pass through unchanged");
  });

  it("decryptField returns empty string unchanged", async () => {
    process.env.PHI_ENCRYPTION_KEY = KEY_A;
    const mod = await loadMod();

    assert.equal(mod.decryptField(""), "");
  });
});

// ---------------------------------------------------------------------------
// No key configured
// ---------------------------------------------------------------------------

describe("No encryption key configured", () => {
  it("encryptField returns plaintext passthrough when key is absent", async () => {
    delete process.env.PHI_ENCRYPTION_KEY;
    delete process.env.PHI_ENCRYPTION_KEY_PREV;
    const mod = await loadMod();

    const value = "Unencrypted dev data";
    assert.equal(mod.encryptField(value), value);
  });

  it("isPhiEncryptionEnabled returns false with no key", async () => {
    delete process.env.PHI_ENCRYPTION_KEY;
    delete process.env.PHI_ENCRYPTION_KEY_PREV;
    const mod = await loadMod();

    assert.equal(mod.isPhiEncryptionEnabled(), false);
  });
});
