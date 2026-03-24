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

---

## Backup Encryption Strategy

### PHI Encryption Key Backup (Key Escrow)

`PHI_ENCRYPTION_KEY` must be backed up before it is used in production. Loss of this key makes all encrypted PHI permanently unrecoverable.

**Required backup configuration**:

```bash
# Store in AWS Secrets Manager with cross-region replication
aws secretsmanager create-secret \
  --name "observatory-qa/phi-encryption-key" \
  --secret-string "$(echo $PHI_ENCRYPTION_KEY)" \
  --add-replica-regions '[{"Region":"us-west-2"}]'

# Enable automatic rotation reminder (not automatic rotation — manual rotation required
# because all existing PHI must be re-encrypted first)
aws secretsmanager put-resource-policy \
  --secret-id observatory-qa/phi-encryption-key \
  --resource-policy file://secrets-policy.json
```

**Minimum two authorized IAM principals** must have `secretsmanager:GetSecretValue` on this secret:
1. EC2 instance role (for runtime access)
2. Security Officer IAM user (for emergency recovery)

### PostgreSQL Backup Encryption

**RDS automated backups** (recommended for production):
```
Encryption: AES-256, uses the RDS-managed KMS key (aws/rds) by default.
Retention: Set to 7 days minimum; 35 days for HIPAA (keeps 6-week window).
Backup window: Schedule during low-traffic hours.
```

**Manual pg_dump encryption** (for EC2 self-managed PostgreSQL):
```bash
# Dump and encrypt in one pipeline — never writes plaintext to disk
pg_dump "$DATABASE_URL" | \
  gpg --symmetric --cipher-algo AES256 --compress-algo 0 \
  -o "backup-$(date +%F).sql.gpg"

# Store the GPG passphrase in AWS Secrets Manager, NOT alongside the backup
aws secretsmanager put-secret-value \
  --secret-id observatory-qa/backup-encryption-passphrase \
  --secret-string "$BACKUP_PASSPHRASE"

# Upload encrypted backup to S3
aws s3 cp "backup-$(date +%F).sql.gpg" \
  "s3://$S3_BUCKET/backups/postgres/backup-$(date +%F).sql.gpg" \
  --sse aws:kms
```

**Recovery test** (run monthly):
```bash
# Download and decrypt
aws s3 cp "s3://$S3_BUCKET/backups/postgres/backup-<date>.sql.gpg" /tmp/
gpg --decrypt /tmp/backup-<date>.sql.gpg | psql "$RESTORE_DATABASE_URL"
```

### S3 Audio Bucket Encryption

All audio files containing recordings must use server-side encryption:

```bash
# Enforce SSE-S3 encryption on all new objects
aws s3api put-bucket-encryption \
  --bucket "$S3_BUCKET" \
  --server-side-encryption-configuration '{
    "Rules": [{
      "ApplyServerSideEncryptionByDefault": {
        "SSEAlgorithm": "aws:kms",
        "KMSMasterKeyID": "alias/observatory-qa-s3"
      },
      "BucketKeyEnabled": true
    }]
  }'

# Enable versioning (supports point-in-time recovery and accidental deletion protection)
aws s3api put-bucket-versioning \
  --bucket "$S3_BUCKET" \
  --versioning-configuration Status=Enabled

# Block all public access
aws s3api put-public-access-block \
  --bucket "$S3_BUCKET" \
  --public-access-block-configuration \
    "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"
```

### EBS Volume Encryption (EC2)

Root and data volumes must be encrypted at rest:

1. Enable account-level default EBS encryption:
   ```bash
   aws ec2 enable-ebs-encryption-by-default --region us-east-1
   ```
2. Verify existing volumes: `aws ec2 describe-volumes --query 'Volumes[].Encrypted'`
3. Automated EBS snapshots via AWS Backup:
   ```bash
   # Create backup plan: daily snapshots, 35-day retention
   aws backup create-backup-plan --backup-plan file://ebs-backup-plan.json
   ```

### Recovery Time / Recovery Point Objectives

| Component | RPO | RTO | Backup Method |
|-----------|-----|-----|---------------|
| PostgreSQL | 24 hours | 2 hours | RDS automated backups or daily pg_dump |
| S3 audio files | 0 (versioning) | 1 hour | S3 versioning + cross-region replication |
| PHI encryption key | 0 (Secrets Manager) | 15 min | Secrets Manager cross-region replica |
| Application config | 1 day | 30 min | Secrets Manager + `.env` encrypted backup |

**Test restore quarterly**: Verify each backup can be decrypted and restored to a test environment. Document the test date and result in the incident log.
