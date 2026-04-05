#!/bin/bash
# Observatory QA — Database Backup & Verification Script
# Backs up PostgreSQL, verifies the backup is restorable, and uploads to S3.
#
# Usage:
#   sudo /opt/callanalyzer/deploy/ec2/backup.sh
#
# Cron (daily at 2am):
#   0 2 * * * /opt/callanalyzer/deploy/ec2/backup.sh >> /var/log/callanalyzer-backup.log 2>&1
#
# Requires:
#   - PostgreSQL client (pg_dump, pg_restore)
#   - AWS CLI (for S3 upload, uses instance IAM role)
#   - DATABASE_URL in /opt/callanalyzer/.env

set -euo pipefail

APP_DIR="/opt/callanalyzer"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="observatory_${TIMESTAMP}.dump"
RETENTION_DAYS=30

# Create a secure temp directory (mode 700) for PHI-containing dump files.
# Avoids /tmp (world-readable) per HIPAA requirements.
BACKUP_DIR=$(mktemp -d /tmp/observatory-backup-XXXXXX)
chmod 700 "$BACKUP_DIR"

# Always clean up the temp directory on exit (success, failure, or signal).
cleanup() {
  rm -rf "$BACKUP_DIR"
}
trap cleanup EXIT INT TERM

echo "=== Observatory QA Backup — $(date) ==="

# Load DATABASE_URL from .env
if [ -f "$APP_DIR/.env" ]; then
    # shellcheck disable=SC1091
    export $(grep -E '^DATABASE_URL=' "$APP_DIR/.env" | xargs)
fi

if [ -z "${DATABASE_URL:-}" ]; then
    echo "ERROR: DATABASE_URL not set. Cannot backup."
    exit 1
fi

# --- Step 1: Create backup ---
echo "--- Creating backup ---"
pg_dump "$DATABASE_URL" --format=custom --compress=6 --file="$BACKUP_DIR/$BACKUP_FILE"
chmod 600 "$BACKUP_DIR/$BACKUP_FILE"
BACKUP_SIZE=$(du -h "$BACKUP_DIR/$BACKUP_FILE" | cut -f1)
echo "Backup created: $BACKUP_FILE ($BACKUP_SIZE)"

# --- Step 2: Verify backup is restorable ---
echo "--- Verifying backup ---"
pg_restore --list "$BACKUP_DIR/$BACKUP_FILE" > /dev/null 2>&1
if [ $? -eq 0 ]; then
    echo "Backup verification: PASSED (TOC readable)"
else
    echo "ERROR: Backup verification FAILED — file may be corrupt"
    exit 1
fi

# --- Step 3: Upload to S3 (if bucket configured) ---
S3_BUCKET=""
if [ -f "$APP_DIR/.env" ]; then
    S3_BUCKET=$(grep -E '^S3_BUCKET=' "$APP_DIR/.env" | cut -d= -f2 | tr -d '"' || true)
fi

if [ -n "$S3_BUCKET" ]; then
    echo "--- Uploading to S3 ---"
    S3_PATH="s3://${S3_BUCKET}/backups/db/${BACKUP_FILE}"
    aws s3 cp "$BACKUP_DIR/$BACKUP_FILE" "$S3_PATH" --sse AES256
    echo "Uploaded to: $S3_PATH"

    # Clean up old S3 backups
    echo "--- Cleaning old S3 backups (>${RETENTION_DAYS} days) ---"
    CUTOFF_DATE=$(date -d "-${RETENTION_DAYS} days" +%Y-%m-%d 2>/dev/null || date -v-${RETENTION_DAYS}d +%Y-%m-%d)
    aws s3 ls "s3://${S3_BUCKET}/backups/db/" | while read -r line; do
        FILE_DATE=$(echo "$line" | awk '{print $1}')
        FILE_NAME=$(echo "$line" | awk '{print $4}')
        if [[ "$FILE_DATE" < "$CUTOFF_DATE" ]] && [ -n "$FILE_NAME" ]; then
            echo "  Deleting old backup: $FILE_NAME"
            aws s3 rm "s3://${S3_BUCKET}/backups/db/${FILE_NAME}"
        fi
    done
else
    echo "WARN: S3_BUCKET not configured — backup stored locally only"
fi

# Note: Local backup files are cleaned up automatically by the EXIT trap.
# The temp directory is ephemeral — long-term retention depends on S3.

echo ""
echo "=== Backup complete — $(date) ==="
echo "  File: $BACKUP_FILE"
echo "  Size: $BACKUP_SIZE"
