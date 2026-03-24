# Database Backup Strategy

This document covers Observatory QA's PostgreSQL backup architecture, schedules,
restore procedures, RPO/RTO targets, and operational checklists.

---

## Architecture Overview

```
PostgreSQL (EC2 / Neon)
    │
    ├── Daily pg_dump ──────────────────────────────► S3 bucket/backups/db/
    │   (compressed custom format)                   (AES256 server-side encryption)
    │                                                (30-day retention)
    │
    ├── Continuous WAL archiving (EC2 only) ────────► S3 bucket/backups/wal/
    │   (enables point-in-time recovery)             (7-day retention)
    │
    └── Pre-deploy snapshots ───────────────────────► /tmp/observatory-backups/
        (taken by deploy.sh and rollback.sh          (retained until next backup run)
         before each production deploy)
```

### Backup types

| Type | Script | Schedule | Retention | Target |
|------|--------|----------|-----------|--------|
| Daily full dump | `deploy/ec2/backup.sh` | 02:00 UTC (cron) | 30 days | S3 |
| Pre-deploy snapshot | `deploy/ec2/deploy.sh` | Before every deploy | Until next daily | Local `/tmp` |
| Pre-rollback snapshot | `deploy/ec2/rollback.sh` | Before every rollback | Until next daily | Local `/tmp` |
| Neon auto-backup (staging) | Neon platform | Every 5 min | 7 days | Neon internal |

---

## RPO / RTO Targets

| Environment | RPO | RTO | Strategy |
|-------------|-----|-----|----------|
| Production (EC2, HIPAA) | ≤ 24 hours | ≤ 2 hours | Daily pg_dump + pre-deploy snapshots |
| Staging (Render + Neon) | ≤ 5 minutes | ≤ 30 minutes | Neon continuous branching |
| Development | N/A — non-PHI | N/A | MemStorage (ephemeral) |

For production HIPAA workloads requiring RPO < 24h, enable WAL archiving
(see [WAL Archiving Setup](#wal-archiving-ec2) below).

---

## Daily Backup Setup (EC2)

### Install cron job

```bash
# SSH into EC2 and add to root crontab
sudo crontab -e
```

Add this line:

```cron
# Daily backup at 2am UTC — logs to /var/log/callanalyzer-backup.log
0 2 * * * /opt/callanalyzer/deploy/ec2/backup.sh >> /var/log/callanalyzer-backup.log 2>&1
```

### Verify it runs

```bash
# Test run manually
sudo /opt/callanalyzer/deploy/ec2/backup.sh

# Check log after cron fires
tail -50 /var/log/callanalyzer-backup.log

# List recent S3 backups
aws s3 ls s3://$S3_BUCKET/backups/db/ --recursive | sort | tail -10
```

---

## S3 Lifecycle Policy

Apply this to the S3 bucket to auto-expire old backups and reduce storage costs:

```json
{
  "Rules": [
    {
      "ID": "expire-daily-db-backups",
      "Filter": { "Prefix": "backups/db/" },
      "Status": "Enabled",
      "Expiration": { "Days": 30 }
    },
    {
      "ID": "expire-wal-archives",
      "Filter": { "Prefix": "backups/wal/" },
      "Status": "Enabled",
      "Expiration": { "Days": 7 }
    },
    {
      "ID": "transition-old-backups-to-glacier",
      "Filter": { "Prefix": "backups/db/" },
      "Status": "Enabled",
      "Transitions": [
        { "Days": 7, "StorageClass": "STANDARD_IA" },
        { "Days": 20, "StorageClass": "GLACIER_IR" }
      ]
    }
  ]
}
```

Apply via AWS CLI:
```bash
aws s3api put-bucket-lifecycle-configuration \
  --bucket "$S3_BUCKET" \
  --lifecycle-configuration file://s3-lifecycle.json
```

---

## WAL Archiving (EC2)

Continuous WAL archiving enables Point-In-Time Recovery (PITR) to any second
within the retention window. Required if RPO < 24 hours is needed.

### Configure PostgreSQL

Edit `/etc/postgresql/16/main/postgresql.conf`:

```ini
wal_level = replica
archive_mode = on
archive_command = 'aws s3 cp %p s3://$S3_BUCKET/backups/wal/%f'
archive_timeout = 300   # archive at least every 5 minutes
```

Restart PostgreSQL:
```bash
sudo systemctl restart postgresql
```

### Verify archiving

```bash
# Check archive_status
psql $DATABASE_URL -c "SELECT * FROM pg_stat_archiver;"

# List WAL files in S3
aws s3 ls s3://$S3_BUCKET/backups/wal/ | tail -20
```

---

## Restore Procedures

### Scenario 1: Restore from daily pg_dump (full restore)

**When to use**: Data corruption, accidental mass-delete, or instance failure.

```bash
# 1. List available backups
aws s3 ls s3://$S3_BUCKET/backups/db/ | sort

# 2. Download the desired backup
aws s3 cp s3://$S3_BUCKET/backups/db/observatory_20260101_020000.dump \
    /tmp/restore.dump

# 3. Stop the application
sudo systemctl stop callanalyzer

# 4. Create a new empty database (if restoring to existing DB, drop first)
psql $DATABASE_URL -c "DROP DATABASE observatory_qa;"
psql $DATABASE_URL -c "CREATE DATABASE observatory_qa;"

# 5. Restore
pg_restore \
    --dbname="$DATABASE_URL" \
    --no-owner \
    --no-acl \
    --verbose \
    /tmp/restore.dump

# 6. Verify row counts
psql $DATABASE_URL -c "
  SELECT schemaname, tablename, n_live_tup
  FROM pg_stat_user_tables
  ORDER BY n_live_tup DESC
  LIMIT 20;
"

# 7. Restart the application
sudo systemctl start callanalyzer
sudo /opt/callanalyzer/deploy/ec2/backup.sh  # take fresh baseline after restore
```

### Scenario 2: Restore from pre-deploy snapshot (rollback + data restore)

**When to use**: A bad deploy corrupted data AND the git rollback alone is insufficient.

```bash
# 1. Identify the pre-deploy snapshot
ls -lt /tmp/observatory-backups/pre_deploy_*.dump | head -5

# 2. Stop the application
sudo systemctl stop callanalyzer

# 3. Restore the snapshot
pg_restore \
    --dbname="$DATABASE_URL" \
    --clean \
    --if-exists \
    --no-owner \
    --no-acl \
    /tmp/observatory-backups/pre_deploy_YYYYMMDD_HHMMSS.dump

# 4. Roll back the code (if not already done)
sudo /opt/callanalyzer/deploy/ec2/rollback.sh

# Note: rollback.sh restarts the service — no need to manually start
```

### Scenario 3: Point-in-time recovery (WAL archiving required)

**When to use**: Restoring to a specific time, e.g. "before the accidental delete at 14:32 UTC".

```bash
# This requires WAL archiving to be enabled (see above).
# Consult pg_basebackup + recovery.conf documentation for your PostgreSQL version.
# Summary of steps:
#   1. Restore base backup
#   2. Place recovery.conf with recovery_target_time
#   3. Copy WAL files from S3 into pg_wal/
#   4. Start PostgreSQL in recovery mode
# See: https://www.postgresql.org/docs/current/continuous-archiving.html
```

---

## Restore Testing

**Restore tests must be run monthly** on a non-production instance to verify
backup integrity. The test verifies the backup is restorable, not just that the
file exists.

```bash
# Monthly restore test procedure:
# 1. Spin up a temporary PostgreSQL instance (Docker or RDS snapshot)
# 2. Download the most recent S3 backup
# 3. Run pg_restore against the temp instance
# 4. Run these validation queries:

psql $TEST_DATABASE_URL -c "
  -- Verify core tables are present and have rows
  SELECT 'organizations' AS tbl, COUNT(*) FROM organizations
  UNION ALL SELECT 'users', COUNT(*) FROM users
  UNION ALL SELECT 'calls', COUNT(*) FROM calls
  UNION ALL SELECT 'call_analyses', COUNT(*) FROM call_analyses
  UNION ALL SELECT 'audit_logs', COUNT(*) FROM audit_logs;
"

# 5. Destroy the temp instance
# 6. Log test result in ops log (date, backup filename, row counts, pass/fail)
```

Log restore test results in `/var/log/callanalyzer-restore-tests.log`.

---

## Encryption

| Layer | Method | Key management |
|-------|--------|---------------|
| EBS volume | AWS EBS encryption (AES-256) | AWS-managed CMK |
| S3 backups | Server-side encryption (SSE-S3 AES256) | AWS-managed |
| pg_dump file (in transit) | TLS (aws s3 cp uses HTTPS) | N/A |
| PHI fields (application layer) | AES-256-GCM (`phi-encryption.ts`) | `PHI_ENCRYPTION_KEY` env var |

The `PHI_ENCRYPTION_KEY` and `PHI_ENCRYPTION_KEY_PREV` (for key rotation) must
be backed up separately from the database. Store them in AWS Secrets Manager or
a password manager — **do not store them in the S3 backup bucket**.

```bash
# Back up PHI encryption key to AWS Secrets Manager
aws secretsmanager put-secret-value \
    --secret-id "observatory-qa/phi-encryption-key" \
    --secret-string "$(grep PHI_ENCRYPTION_KEY /opt/callanalyzer/.env)"
```

---

## Monitoring & Alerting

Add these checks to your monitoring system (CloudWatch, Datadog, etc.):

```bash
# 1. Check backup recency — alert if newest S3 backup is >26 hours old
NEWEST=$(aws s3 ls s3://$S3_BUCKET/backups/db/ \
    | sort | tail -1 | awk '{print $1" "$2}')
NEWEST_TS=$(date -d "$NEWEST" +%s 2>/dev/null || date -j -f "%Y-%m-%d %H:%M:%S" "$NEWEST" +%s)
NOW=$(date +%s)
AGE_HOURS=$(( (NOW - NEWEST_TS) / 3600 ))
if [ $AGE_HOURS -gt 26 ]; then
    echo "ALERT: Most recent backup is ${AGE_HOURS}h old (threshold: 26h)"
fi

# 2. Check backup file size — alert if <1KB (empty backup)
SIZE=$(aws s3 ls s3://$S3_BUCKET/backups/db/ | sort | tail -1 | awk '{print $3}')
if [ "${SIZE:-0}" -lt 1024 ]; then
    echo "ALERT: Most recent backup is suspiciously small (${SIZE} bytes)"
fi
```

CloudWatch Alarm recommended: monitor `/var/log/callanalyzer-backup.log` for
`"ERROR"` lines using a CloudWatch Logs metric filter.

---

## Checklist: New Environment Setup

- [ ] `DATABASE_URL` set in `.env`
- [ ] `S3_BUCKET` set in `.env` (backup bucket, separate from audio bucket)
- [ ] IAM role has `s3:PutObject`, `s3:GetObject`, `s3:ListBucket` on backup bucket
- [ ] S3 bucket has versioning enabled
- [ ] S3 bucket has lifecycle policy applied (see above)
- [ ] S3 bucket has public access blocked
- [ ] Cron job installed (`0 2 * * * /opt/callanalyzer/deploy/ec2/backup.sh ...`)
- [ ] First manual backup run succeeded
- [ ] First manual restore test succeeded on a temp DB
- [ ] `PHI_ENCRYPTION_KEY` backed up to AWS Secrets Manager
- [ ] CloudWatch alarm set for backup recency
- [ ] Backup log reviewed weekly by on-call engineer
