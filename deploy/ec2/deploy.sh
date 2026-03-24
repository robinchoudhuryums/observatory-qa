#!/bin/bash
# Observatory QA — Deployment / Update Script
# Run this on the EC2 instance to pull latest code and redeploy.
#
# Usage:
#   ssh ec2-user@YOUR_IP "sudo /opt/callanalyzer/deploy/ec2/deploy.sh"
#   OR from the instance:
#   sudo /opt/callanalyzer/deploy/ec2/deploy.sh [BRANCH]

set -euo pipefail

APP_DIR="/opt/callanalyzer"
APP_USER="callanalyzer"
BRANCH="${1:-main}"
TARGET_SHA="${2:-}"  # Optional: pin to a specific git SHA (passed by CI)

echo "=== Observatory QA Deploy — $(date) ==="
echo "Branch: $BRANCH"
[ -n "$TARGET_SHA" ] && echo "Target SHA: $TARGET_SHA"

cd "$APP_DIR"

# --- Pre-flight checks ---
echo "--- Pre-flight checks ---"
ENV_FILE="$APP_DIR/.env"
if [ ! -f "$ENV_FILE" ]; then
    echo "!!! ERROR: .env file not found at $ENV_FILE"
    echo "    Copy deploy/ec2/.env.example and fill in required values."
    exit 1
fi

# Verify critical env vars are set (not empty)
MISSING_VARS=()
for VAR in ASSEMBLYAI_API_KEY SESSION_SECRET; do
    if ! grep -qE "^${VAR}=.+" "$ENV_FILE"; then
        MISSING_VARS+=("$VAR")
    fi
done

if [ ${#MISSING_VARS[@]} -gt 0 ]; then
    echo "!!! WARNING: These required env vars appear empty in .env:"
    for VAR in "${MISSING_VARS[@]}"; do
        echo "    - $VAR"
    done
    echo "    Deploy will continue, but the app may not function correctly."
    echo ""
fi

# --- Pre-deploy database snapshot ---
echo "--- Pre-deploy database snapshot ---"
SNAPSHOT_TIMESTAMP=$(date +%Y%m%d_%H%M%S)
SNAPSHOT_DIR="/tmp/observatory-backups"
mkdir -p "$SNAPSHOT_DIR"

DATABASE_URL=""
if grep -qE '^DATABASE_URL=.+' "$ENV_FILE"; then
    DATABASE_URL=$(grep -E '^DATABASE_URL=' "$ENV_FILE" | cut -d= -f2- | tr -d '"')
fi

if [ -n "$DATABASE_URL" ]; then
    SNAPSHOT_FILE="$SNAPSHOT_DIR/pre_deploy_${SNAPSHOT_TIMESTAMP}.dump"
    pg_dump "$DATABASE_URL" --format=custom --compress=6 --file="$SNAPSHOT_FILE" \
        && echo "Pre-deploy snapshot: $SNAPSHOT_FILE ($(du -h "$SNAPSHOT_FILE" | cut -f1))" \
        || echo "WARNING: Pre-deploy snapshot failed — deploy continues without it"
else
    echo "WARN: DATABASE_URL not set — skipping pre-deploy snapshot"
fi

# Record current SHA for rollback reference
PREV_SHA=$(sudo -u "$APP_USER" git rev-parse HEAD 2>/dev/null || echo "unknown")
echo "Previous SHA: $PREV_SHA"
echo "$PREV_SHA" > "$SNAPSHOT_DIR/last_good_sha.txt"

# Pull latest code
echo "--- Pulling latest code ---"
sudo -u "$APP_USER" git fetch origin "$BRANCH"
sudo -u "$APP_USER" git checkout "$BRANCH"

if [ -n "$TARGET_SHA" ]; then
    # Pin to the exact SHA that CI built and tested
    sudo -u "$APP_USER" git checkout "$TARGET_SHA"
    echo "Pinned to SHA: $(sudo -u "$APP_USER" git rev-parse HEAD)"
else
    sudo -u "$APP_USER" git pull origin "$BRANCH"
fi

# Install dependencies
echo "--- Installing dependencies ---"
sudo -u "$APP_USER" npm ci --production=false

# Build
echo "--- Building ---"
sudo -u "$APP_USER" npm run build

# Prune dev dependencies
echo "--- Pruning dev dependencies ---"
sudo -u "$APP_USER" npm prune --production

# Restart the service
echo "--- Restarting Observatory QA ---"
systemctl restart callanalyzer

# Wait and check status
sleep 3
if systemctl is-active --quiet callanalyzer; then
    echo "--- Observatory QA is running ---"
    systemctl status callanalyzer --no-pager
else
    echo "!!! Observatory QA failed to start !!!"
    journalctl -u callanalyzer --no-pager -n 30
    echo ""
    echo "To roll back to the previous version:"
    echo "  sudo /opt/callanalyzer/deploy/ec2/rollback.sh $PREV_SHA"
    exit 1
fi

DEPLOYED_SHA=$(sudo -u "$APP_USER" git rev-parse HEAD)
echo ""
echo "=== Deploy complete — $(date) ==="
echo "  Deployed SHA: $DEPLOYED_SHA"
echo "  Previous SHA: $PREV_SHA"
echo "  To roll back: sudo /opt/callanalyzer/deploy/ec2/rollback.sh $PREV_SHA"
