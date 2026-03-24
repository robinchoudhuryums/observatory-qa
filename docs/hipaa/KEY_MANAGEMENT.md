# PHI Encryption Key Management

Covers: `PHI_ENCRYPTION_KEY` (AES-256-GCM field-level encryption for clinical note PHI fields)

---

## Key Specification

| Property | Value |
|----------|-------|
| Algorithm | AES-256-GCM |
| Key length | 256 bits (32 bytes = 64 hex characters) |
| IV | 96-bit random per encryption (GCM standard) |
| Auth tag | 128-bit (detects tampering) |
| Storage format | `enc_v1:<base64(iv \|\| ciphertext \|\| authTag)>` |

---

## Generating a Key

```bash
# Generate a cryptographically random 32-byte key
openssl rand -hex 32
# Output example: a3f2e1d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8a9f0e1d2c3b4a5f6e7d8c9b0a1f2
```

Store the output as `PHI_ENCRYPTION_KEY` in your secrets manager (AWS Secrets Manager, SSM Parameter Store, or HashiCorp Vault). **Never store it in `.env` files in version control.**

---

## Initial Setup

1. Generate a key using the command above
2. Store in AWS Secrets Manager: `observatory-qa/phi-encryption-key`
3. Grant EC2 instance role read access: `secretsmanager:GetSecretValue`
4. Load at startup:
   ```bash
   export PHI_ENCRYPTION_KEY=$(aws secretsmanager get-secret-value \
     --secret-id observatory-qa/phi-encryption-key \
     --query SecretString --output text)
   ```
5. Verify encryption is active: check logs for `[PHI_ENCRYPTION]` on startup

---

## Key Rotation Procedure

Rotate keys annually or immediately if compromise is suspected.

### Zero-Downtime Rotation

The application supports a `PHI_ENCRYPTION_KEY_PREV` environment variable that allows old encrypted data to be decrypted while new data is encrypted with the new key.

**Step 1 — Generate new key**
```bash
NEW_KEY=$(openssl rand -hex 32)
echo "New key: $NEW_KEY"
```

**Step 2 — Deploy new key without removing old key**
```bash
# Set both variables
export PHI_ENCRYPTION_KEY="<new-key>"
export PHI_ENCRYPTION_KEY_PREV="<old-key>"
# Deploy / restart application
```

At this point:
- All new encryptions use the new key
- Old data still decrypts using the previous key fallback
- Logs will warn: "PHI field decrypted with previous key — re-encrypt recommended"

**Step 3 — Re-encrypt existing data (background job)**

Run the re-encryption script to migrate all existing PHI fields to the new key:
```bash
# TODO: implement re-encryption script
# Until implemented, the fallback key handles decryption
node scripts/reencrypt-phi.js --dry-run   # preview
node scripts/reencrypt-phi.js             # execute
```

This script should:
1. Query all `call_analyses` rows where `clinical_note` is non-null
2. Decrypt each PHI field (will use `PREV` key for old records)
3. Re-encrypt with current key
4. Update the row

**Step 4 — Remove previous key**

After all records are re-encrypted:
```bash
unset PHI_ENCRYPTION_KEY_PREV
# Deploy / restart application
```

Verify no more "previous key" warnings in logs.

---

## Key Compromise Response

If `PHI_ENCRYPTION_KEY` is suspected to be compromised:

1. **Immediately**: Generate a new key and begin Step 2 of rotation (deploy both keys)
2. **Within 1 hour**: Notify Security Officer
3. **Within 24 hours**: Complete re-encryption (Step 3) with new key
4. **Within 60 days**: Assess whether a HIPAA breach notification is required (was PHI actually accessed with the compromised key?)
5. Document the incident per `INCIDENT_RESPONSE.md`

---

## What Is Encrypted

Encrypted fields in `call_analyses.clinical_note` (JSONB):
- `subjective` — Patient-reported symptoms
- `objective` — Clinical findings
- `assessment` — Diagnosis / differential
- `hpiNarrative` — History of present illness
- `chiefComplaint` — Chief complaint
- `reviewOfSystems` — ROS findings
- `differentialDiagnoses` — Differential diagnoses
- `periodontalFindings` — Dental: perio chart data

Also encrypted:
- `users.mfa_secret` — TOTP secrets (same key, via `encryptMfaSecret`)

---

## Key Storage Best Practices

| Environment | Recommended Storage |
|-------------|---------------------|
| Production (EC2) | AWS Secrets Manager (IAM role, no static credentials) |
| Production (container) | Kubernetes Secrets (sealed with Sealed Secrets or Vault) |
| Staging | AWS Secrets Manager (separate key from production) |
| Development | Local `.env` (never commit; data is not real PHI) |
| CI/CD | GitHub Actions Secrets or AWS OIDC |

**Never**: Hardcode the key in source code, Docker images, or CI logs.

---

## Audit Trail

Key rotation events should be logged in the HIPAA audit trail:
```typescript
logPhiAccess({
  event: "phi_key_rotated",
  resourceType: "encryption_key",
  detail: "PHI encryption key rotated — all records queued for re-encryption",
});
```

Keep key rotation records for 6 years (HIPAA documentation requirement).
