#!/bin/bash
# Observatory QA — Deployment / Update Script
# Run this on the EC2 instance to pull latest code and redeploy.
#
# Usage:
#   ssh ec2-user@YOUR_IP "sudo /opt/observatory-qa/deploy/ec2/deploy.sh"
#   OR from the instance:
#   sudo /opt/observatory-qa/deploy/ec2/deploy.sh [BRANCH] [SHA]
#   sudo /opt/observatory-qa/deploy/ec2/deploy.sh --force [BRANCH] [SHA]
#
# Flags:
#   --force    Skip pre-flight env var checks (use with caution — production
#              startup will still reject missing/invalid PHI_ENCRYPTION_KEY,
#              SESSION_SECRET, or DATABASE_URL, so --force only suppresses
#              the noisy script-level error)

set -euo pipefail

APP_DIR="/opt/observatory-qa"
APP_USER="observatory-qa"
APP_SERVICE="observatory-qa"
WORKERS_SERVICE="observatory-qa-workers"
LOG_FILE="/var/log/observatory-qa-deploy.log"
SNAPSHOT_DIR="/tmp/observatory-backups"
PREVIOUS_SHA_FILE="/opt/observatory-qa/.previous-sha"
HEALTH_URL="http://localhost:5000/api/health"
HEALTH_MAX_RETRIES=10
HEALTH_RETRY_INTERVAL=5

# ─── Parse flags ────────────────────────────────────────────────────────────

FORCE_DEPLOY=false
POSITIONAL_ARGS=()

for arg in "$@"; do
    case "$arg" in
        --force)
            FORCE_DEPLOY=true
            ;;
        *)
            POSITIONAL_ARGS+=("$arg")
            ;;
    esac
done

BRANCH="${POSITIONAL_ARGS[0]:-main}"
TARGET_SHA="${POSITIONAL_ARGS[1]:-}"  # Optional: pin to a specific git SHA (passed by CI)

# ─── Logging ────────────────────────────────────────────────────────────────

mkdir -p "$(dirname "$LOG_FILE")"

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" | tee -a "$LOG_FILE"; }
log_section() { log ""; log "=== $* ==="; }
die() { log "FATAL: $*"; exit 1; }

log_section "Observatory QA Deploy — $(date)"
log "Branch: $BRANCH"
log "Force: $FORCE_DEPLOY"
[ -n "$TARGET_SHA" ] && log "Target SHA: $TARGET_SHA"

# ─── Pre-flight checks ─────────────────────────────────────────────────────

log_section "Pre-flight checks"

[ -d "$APP_DIR" ] || die "App directory $APP_DIR not found"

ENV_FILE="$APP_DIR/.env"
if [ ! -f "$ENV_FILE" ]; then
    die ".env file not found at $ENV_FILE — copy deploy/ec2/.env.example and fill in required values."
fi

# Pre-flight env validation. This mirrors the runtime checks in
# server/index.ts so we fail fast on the deploy host instead of letting
# the production server start, exit(1), and leave the user staring at a
# half-deployed instance. Each check has a clear error message naming the
# missing/invalid variable.
#
# `--force` suppresses these checks but the runtime validators inside
# server/index.ts still apply, so a forced deploy of a misconfigured .env
# will simply fail later in `systemctl start observatory-qa`.

ERRORS=()

# Helper: extract a value from .env, stripping optional double quotes.
get_env() {
    local var="$1"
    grep -E "^${var}=" "$ENV_FILE" 2>/dev/null | head -n 1 | cut -d= -f2- | tr -d '"' || true
}

# 1. ASSEMBLYAI_API_KEY — non-empty
ASSEMBLY_KEY=$(get_env ASSEMBLYAI_API_KEY)
if [ -z "$ASSEMBLY_KEY" ]; then
    ERRORS+=("ASSEMBLYAI_API_KEY is missing or empty (required for transcription)")
fi

# 2. SESSION_SECRET — non-empty AND ≥ 32 chars (server/index.ts rejects shorter
#    in production; cookie signing security requires reasonable entropy)
SESSION=$(get_env SESSION_SECRET)
if [ -z "$SESSION" ]; then
    ERRORS+=("SESSION_SECRET is missing or empty (required for cookie signing)")
elif [ "${#SESSION}" -lt 32 ]; then
    ERRORS+=("SESSION_SECRET is too short (${#SESSION} chars) — production requires at least 32. Generate with: openssl rand -hex 32")
fi

# 3. PHI_ENCRYPTION_KEY — exactly 64 hex chars (AES-256-GCM key length)
PHI_KEY=$(get_env PHI_ENCRYPTION_KEY)
if [ -z "$PHI_KEY" ]; then
    ERRORS+=("PHI_ENCRYPTION_KEY is missing — production refuses to start without it (HIPAA: PHI must never be stored unencrypted)")
elif [ "${#PHI_KEY}" -ne 64 ]; then
    ERRORS+=("PHI_ENCRYPTION_KEY must be exactly 64 hex chars (got ${#PHI_KEY}). Generate with: openssl rand -hex 32")
elif ! [[ "$PHI_KEY" =~ ^[0-9a-fA-F]{64}$ ]]; then
    ERRORS+=("PHI_ENCRYPTION_KEY contains non-hex characters — must be 64 chars in [0-9a-fA-F]")
fi

# 4. DATABASE_URL — required when STORAGE_BACKEND=postgres (the recommended
#    production backend; the staging deploy hard-codes this)
STORAGE=$(get_env STORAGE_BACKEND)
DB_URL=$(get_env DATABASE_URL)
if [ "$STORAGE" = "postgres" ] && [ -z "$DB_URL" ]; then
    ERRORS+=("DATABASE_URL is missing but STORAGE_BACKEND=postgres — server/index.ts will exit(1) on startup")
fi

# 5. REDIS_URL — non-fatal warning. Required for distributed sessions /
#    rate-limit / queues. Production sets REQUIRE_REDIS=true to make this
#    fatal at runtime; we mirror that here.
REQUIRE_REDIS=$(get_env REQUIRE_REDIS)
REDIS=$(get_env REDIS_URL)
if [ "$REQUIRE_REDIS" = "true" ] && [ -z "$REDIS" ]; then
    ERRORS+=("REDIS_URL is missing but REQUIRE_REDIS=true — server/index.ts will exit(1) on startup")
fi

if [ ${#ERRORS[@]} -gt 0 ]; then
    if [ "$FORCE_DEPLOY" = true ]; then
        log "WARNING: --force flag set, continuing despite ${#ERRORS[@]} pre-flight error(s):"
        for E in "${ERRORS[@]}"; do
            log "    - $E"
        done
        log "NOTE: server/index.ts performs the same checks at startup — a forced deploy will likely fail there."
    else
        log "ERROR: pre-flight env validation failed (${#ERRORS[@]} issue(s)):"
        for E in "${ERRORS[@]}"; do
            log "    - $E"
        done
        die "Aborting deploy. Fix the issues above in $ENV_FILE, or use --force to bypass (not recommended)."
    fi
fi

# 6. Soft warnings for recommended-but-optional vars
for OPT in S3_BUCKET APP_BASE_URL; do
    if [ -z "$(get_env "$OPT")" ]; then
        log "WARN: $OPT is not set — see deploy/ec2/README.md for the impact"
    fi
done

# Verify both service units exist
for SVC in "${APP_SERVICE}.service" "${WORKERS_SERVICE}.service"; do
    if ! systemctl list-unit-files "$SVC" &>/dev/null; then
        log "WARNING: $SVC unit not found in /etc/systemd/system — restart may fail. Re-copy from ${APP_DIR}/deploy/ec2/."
    fi
done

log "Pre-flight checks passed (${#ERRORS[@]} hard errors, see WARNs above for soft issues)"

cd "$APP_DIR"

# ─── Save current version for rollback ──────────────────────────────────────

log_section "Recording current version"

PREV_SHA=$(sudo -u "$APP_USER" git rev-parse HEAD 2>/dev/null || echo "unknown")
log "Previous SHA: $PREV_SHA"

# Persist the SHA to a well-known location for rollback
mkdir -p "$(dirname "$PREVIOUS_SHA_FILE")"
echo "$PREV_SHA" > "$PREVIOUS_SHA_FILE"
log "Saved previous SHA to $PREVIOUS_SHA_FILE"

# ─── Pre-deploy database snapshot ──────────────────────────────────────────

log_section "Pre-deploy database snapshot"

SNAPSHOT_TIMESTAMP=$(date +%Y%m%d_%H%M%S)
mkdir -p "$SNAPSHOT_DIR"

DATABASE_URL=""
if grep -qE '^DATABASE_URL=.+' "$ENV_FILE"; then
    DATABASE_URL=$(grep -E '^DATABASE_URL=' "$ENV_FILE" | cut -d= -f2- | tr -d '"')
fi

SNAPSHOT_FILE=""
if [ -n "$DATABASE_URL" ]; then
    SNAPSHOT_FILE="$SNAPSHOT_DIR/pre_deploy_${SNAPSHOT_TIMESTAMP}.dump"
    if pg_dump "$DATABASE_URL" --format=custom --compress=6 --file="$SNAPSHOT_FILE" 2>>"$LOG_FILE"; then
        log "Pre-deploy snapshot: $SNAPSHOT_FILE ($(du -h "$SNAPSHOT_FILE" | cut -f1))"
    else
        log "WARNING: Pre-deploy snapshot failed — deploy continues without it"
        SNAPSHOT_FILE=""
    fi
else
    log "WARN: DATABASE_URL not set — skipping pre-deploy snapshot"
fi

# Also save the previous SHA to the backup directory for quick reference
echo "$PREV_SHA" > "$SNAPSHOT_DIR/last_good_sha.txt"

# ─── Health check function ──────────────────────────────────────────────────

check_health() {
    local label="${1:-service}"
    local retries="${2:-$HEALTH_MAX_RETRIES}"
    local interval="${3:-$HEALTH_RETRY_INTERVAL}"

    for i in $(seq 1 "$retries"); do
        STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$HEALTH_URL" 2>/dev/null || echo "000")
        if [ "$STATUS" = "200" ]; then
            log "Health check passed for $label (HTTP 200) on attempt $i"
            return 0
        fi
        log "Health check attempt $i/$retries for $label: HTTP $STATUS — retrying in ${interval}s..."
        sleep "$interval"
    done

    log "ERROR: Health check failed for $label after $retries attempts"
    return 1
}

# ─── Build and deploy function ──────────────────────────────────────────────

build_and_restart() {
    local label="${1:-deploy}"

    log "--- Installing dependencies ($label) ---"
    sudo -u "$APP_USER" npm ci --production=false \
        || { log "ERROR: npm ci failed during $label"; return 1; }

    log "--- Building ($label) ---"
    sudo -u "$APP_USER" npm run build \
        || { log "ERROR: Build failed during $label"; return 1; }

    log "--- Pruning dev dependencies ($label) ---"
    sudo -u "$APP_USER" npm prune --production \
        || { log "WARNING: npm prune failed during $label (non-fatal)"; }

    log "--- Restarting Observatory QA ($label) — main + workers ---"
    # Restart both units. The main HTTP server is the gating health check
    # (workers only enqueue/consume background jobs); failing the workers
    # restart is logged but doesn't block the deploy.
    systemctl restart "$APP_SERVICE" \
        || { log "ERROR: systemctl restart $APP_SERVICE failed during $label"; return 1; }
    systemctl restart "$WORKERS_SERVICE" \
        || { log "WARN: systemctl restart $WORKERS_SERVICE failed during $label (background jobs paused; HTTP traffic unaffected)"; }

    # Give the main service a moment to start before health checking
    sleep 3

    # Verify the main process is at least running
    if ! systemctl is-active --quiet "$APP_SERVICE"; then
        log "ERROR: $APP_SERVICE service is not active after restart ($label)"
        journalctl -u "$APP_SERVICE" --no-pager -n 30 2>>"$LOG_FILE" || true
        return 1
    fi

    return 0
}

# ─── Rollback function ─────────────────────────────────────────────────────

perform_rollback() {
    local rollback_sha="$1"
    local failed_sha
    failed_sha=$(sudo -u "$APP_USER" git rev-parse HEAD 2>/dev/null || echo "unknown")

    log_section "AUTOMATIC ROLLBACK — reverting to $rollback_sha"
    log "Failed SHA: $failed_sha"
    log "Rollback target: $rollback_sha"

    # Log the rollback event with full context
    local rollback_log="/var/log/observatory-qa-rollback-events.log"
    {
        echo "---"
        echo "timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
        echo "event: automatic_rollback"
        echo "failed_sha: $failed_sha"
        echo "rollback_sha: $rollback_sha"
        echo "trigger: health_check_failure"
        echo "branch: $BRANCH"
    } >> "$rollback_log"

    # Stash any local changes so checkout succeeds
    sudo -u "$APP_USER" git stash --quiet 2>/dev/null || true

    # Checkout the previous good version
    if ! sudo -u "$APP_USER" git checkout "$rollback_sha" 2>>"$LOG_FILE"; then
        log "FATAL: Could not checkout rollback SHA $rollback_sha — manual intervention required"
        log "  Run: sudo /opt/observatory-qa/deploy/ec2/rollback.sh $rollback_sha"
        return 1
    fi

    log "Checked out rollback SHA: $(sudo -u "$APP_USER" git log --oneline -1)"

    # Rebuild at the rollback SHA
    if ! build_and_restart "rollback"; then
        log "FATAL: Build or restart failed during rollback — manual intervention required"
        log "  Journals: journalctl -u observatory-qa -n 50 --no-pager"
        return 1
    fi

    # Health check the rolled-back version
    if check_health "rollback" "$HEALTH_MAX_RETRIES" "$HEALTH_RETRY_INTERVAL"; then
        log "Rollback successful — service is healthy at $rollback_sha"
        {
            echo "result: success"
            echo "---"
        } >> "$rollback_log"
        return 0
    else
        log "FATAL: Rolled-back version also failing health checks — manual intervention required"
        log "  Journals: journalctl -u observatory-qa -n 50 --no-pager"
        if [ -n "$SNAPSHOT_FILE" ] && [ -f "$SNAPSHOT_FILE" ]; then
            log "  DB snapshot available: $SNAPSHOT_FILE"
        fi
        {
            echo "result: failed"
            echo "---"
        } >> "$rollback_log"
        return 1
    fi
}

# ─── Pull latest code ──────────────────────────────────────────────────────

log_section "Pulling latest code"

sudo -u "$APP_USER" git fetch origin "$BRANCH" \
    || die "git fetch failed — check network and SSH keys"

sudo -u "$APP_USER" git checkout "$BRANCH" \
    || die "git checkout $BRANCH failed"

if [ -n "$TARGET_SHA" ]; then
    # Pin to the exact SHA that CI built and tested
    sudo -u "$APP_USER" git checkout "$TARGET_SHA" \
        || die "git checkout $TARGET_SHA failed — SHA may not exist in fetched history"
    log "Pinned to SHA: $(sudo -u "$APP_USER" git rev-parse HEAD)"
else
    sudo -u "$APP_USER" git pull origin "$BRANCH" \
        || die "git pull failed"
fi

DEPLOYED_SHA=$(sudo -u "$APP_USER" git rev-parse HEAD)
log "Deploying SHA: $DEPLOYED_SHA"

# ─── Build, restart, health check ──────────────────────────────────────────

log_section "Building and deploying"

if ! build_and_restart "deploy"; then
    log "Build or restart failed — attempting automatic rollback"
    if [ "$PREV_SHA" != "unknown" ]; then
        if perform_rollback "$PREV_SHA"; then
            die "Deploy failed but rollback succeeded. Service is running at $PREV_SHA. Fix the issue and redeploy."
        else
            die "Deploy failed AND rollback failed. Manual intervention required."
        fi
    else
        die "Deploy failed and no previous SHA available for rollback. Manual intervention required."
    fi
fi

# ─── Post-deploy health check ──────────────────────────────────────────────

log_section "Post-deploy health check"

if check_health "deploy" "$HEALTH_MAX_RETRIES" "$HEALTH_RETRY_INTERVAL"; then
    log "Deploy health check passed"
else
    log "Health check failed after deploy — attempting automatic rollback"
    if [ "$PREV_SHA" != "unknown" ]; then
        if perform_rollback "$PREV_SHA"; then
            die "Deploy health check failed but rollback succeeded. Service is running at $PREV_SHA. Investigate: journalctl -u observatory-qa --since '30 min ago'"
        else
            die "Deploy health check failed AND rollback failed. Manual intervention required."
        fi
    else
        die "Deploy health check failed and no previous SHA available for rollback."
    fi
fi

# ─── Summary ────────────────────────────────────────────────────────────────

log_section "Deploy complete"
log "  Deployed SHA:  $DEPLOYED_SHA"
log "  Previous SHA:  $PREV_SHA"
log "  Main service:  $(systemctl is-active "$APP_SERVICE")"
log "  Workers:       $(systemctl is-active "$WORKERS_SERVICE")"
log ""
log "  To roll back:  sudo /opt/observatory-qa/deploy/ec2/rollback.sh $PREV_SHA"
log "  Full log:      $LOG_FILE"
