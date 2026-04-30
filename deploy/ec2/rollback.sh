#!/bin/bash
# Observatory QA — Rollback Script
#
# Rolls the application back to a previous git commit or a named SHA.
# Takes a pre-rollback DB snapshot, reverts the code, and verifies health.
#
# Usage:
#   sudo /opt/observatory-qa/deploy/ec2/rollback.sh               # roll back 1 commit
#   sudo /opt/observatory-qa/deploy/ec2/rollback.sh <SHA>         # roll back to specific SHA
#   sudo /opt/observatory-qa/deploy/ec2/rollback.sh --list        # show recent commits
#
# After a failed rollback, restore the database from backup:
#   See docs/operations/ROLLBACK_PROCEDURES.md for DB restore steps.

set -euo pipefail

APP_DIR="/opt/observatory-qa"
APP_USER="observatory-qa"
LOG_FILE="/var/log/observatory-qa-rollback.log"
TARGET_SHA="${1:-}"

# ─── Logging ────────────────────────────────────────────────────────────────

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" | tee -a "$LOG_FILE"; }
log_section() { log ""; log "=== $* ==="; }
die() { log "ERROR: $*"; exit 1; }

log_section "Observatory QA Rollback — $(date)"

# ─── Show recent commits and exit ────────────────────────────────────────────

if [ "${TARGET_SHA}" = "--list" ]; then
    log "Recent commits (use SHA as argument to rollback.sh):"
    cd "$APP_DIR"
    sudo -u "$APP_USER" git log --oneline -15
    exit 0
fi

# ─── Pre-flight checks ───────────────────────────────────────────────────────

log_section "Pre-flight checks"

[ -d "$APP_DIR" ] || die "App directory $APP_DIR not found"
[ -f "$APP_DIR/.env" ] || die ".env file not found at $APP_DIR/.env"

cd "$APP_DIR"

CURRENT_SHA=$(sudo -u "$APP_USER" git rev-parse HEAD)
CURRENT_BRANCH=$(sudo -u "$APP_USER" git rev-parse --abbrev-ref HEAD)
log "Current SHA:    $CURRENT_SHA"
log "Current branch: $CURRENT_BRANCH"

# Determine rollback target
if [ -z "$TARGET_SHA" ]; then
    TARGET_SHA=$(sudo -u "$APP_USER" git rev-parse HEAD~1)
    log "No target SHA given — rolling back 1 commit to: $TARGET_SHA"
else
    # Verify the SHA exists
    sudo -u "$APP_USER" git rev-parse --verify "$TARGET_SHA^{commit}" > /dev/null 2>&1 \
        || die "SHA $TARGET_SHA not found in git history"
    log "Rolling back to specified SHA: $TARGET_SHA"
fi

TARGET_MSG=$(sudo -u "$APP_USER" git log --oneline -1 "$TARGET_SHA" 2>/dev/null || echo "(unknown)")
log "Target commit:  $TARGET_MSG"

# ─── Pre-rollback database snapshot ─────────────────────────────────────────

log_section "Pre-rollback database snapshot"

SNAPSHOT_TIMESTAMP=$(date +%Y%m%d_%H%M%S)
SNAPSHOT_FILE="/tmp/observatory-backups/pre_rollback_${SNAPSHOT_TIMESTAMP}.dump"
mkdir -p /tmp/observatory-backups

# Load DATABASE_URL from .env
DATABASE_URL=""
if grep -qE '^DATABASE_URL=.+' "$APP_DIR/.env"; then
    DATABASE_URL=$(grep -E '^DATABASE_URL=' "$APP_DIR/.env" | cut -d= -f2- | tr -d '"')
fi

if [ -n "$DATABASE_URL" ]; then
    log "Taking pre-rollback DB snapshot: $SNAPSHOT_FILE"
    pg_dump "$DATABASE_URL" --format=custom --compress=6 --file="$SNAPSHOT_FILE" \
        && log "Pre-rollback snapshot complete ($(du -h "$SNAPSHOT_FILE" | cut -f1))" \
        || log "WARNING: Pre-rollback snapshot failed — proceeding without it"
else
    log "WARNING: DATABASE_URL not set — skipping pre-rollback DB snapshot"
fi

# ─── Code rollback ───────────────────────────────────────────────────────────

log_section "Code rollback"

# Stash any unexpected local changes so checkout succeeds
sudo -u "$APP_USER" git stash --quiet 2>/dev/null || true

# Check out the target commit
sudo -u "$APP_USER" git checkout "$TARGET_SHA"

log "Checked out: $(sudo -u "$APP_USER" git log --oneline -1)"

# ─── Rebuild ─────────────────────────────────────────────────────────────────

log_section "Rebuilding at rollback SHA"

sudo -u "$APP_USER" npm ci --production=false \
    || die "npm ci failed at rollback SHA $TARGET_SHA"

sudo -u "$APP_USER" npm run build \
    || die "Build failed at rollback SHA $TARGET_SHA — rollback aborted, previous version still running"

sudo -u "$APP_USER" npm prune --production

# ─── Restart service ─────────────────────────────────────────────────────────

log_section "Restarting service"

# Restart both units. Workers must be restarted too — they share the same
# build artifact and a rollback to an older commit can change worker code
# (BullMQ job processors, retention logic, RAG indexing).
systemctl restart observatory-qa
systemctl restart observatory-qa-workers \
    || log "WARN: workers restart failed — background jobs paused, HTTP traffic unaffected"
sleep 5

# ─── Health check ────────────────────────────────────────────────────────────

log_section "Health check"

HEALTH_URL="http://localhost:5000/api/health"
MAX_RETRIES=10
RETRY_INTERVAL=5

for i in $(seq 1 $MAX_RETRIES); do
    STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$HEALTH_URL" 2>/dev/null || echo "000")
    if [ "$STATUS" = "200" ]; then
        log "Service healthy (HTTP $STATUS) on attempt $i"
        break
    fi
    log "Attempt $i/$MAX_RETRIES: HTTP $STATUS — retrying in ${RETRY_INTERVAL}s..."
    sleep $RETRY_INTERVAL

    if [ "$i" = "$MAX_RETRIES" ]; then
        log "ERROR: Service unhealthy after rollback — manual intervention required"
        log "  Journals: journalctl -u observatory-qa -n 50 --no-pager"
        if [ -n "$DATABASE_URL" ] && [ -f "$SNAPSHOT_FILE" ]; then
            log "  DB snapshot available: $SNAPSHOT_FILE"
            log "  See docs/operations/ROLLBACK_PROCEDURES.md for DB restore steps"
        fi
        exit 1
    fi
done

# ─── Summary ─────────────────────────────────────────────────────────────────

log_section "Rollback complete"
log "  Rolled back FROM: $CURRENT_SHA"
log "  Rolled back TO:   $TARGET_SHA"
log "  Main service:     $(systemctl is-active observatory-qa)"
log "  Workers service:  $(systemctl is-active observatory-qa-workers)"
if [ -f "$SNAPSHOT_FILE" ]; then
    log "  DB snapshot:      $SNAPSHOT_FILE"
fi
log ""
log "  To forward-deploy again when the issue is fixed:"
log "    sudo /opt/observatory-qa/deploy/ec2/deploy.sh"
log ""
log "  To investigate the bad deploy:"
log "    journalctl -u observatory-qa --since '30 min ago' --no-pager"
log "    git log --oneline $TARGET_SHA..$CURRENT_SHA"
