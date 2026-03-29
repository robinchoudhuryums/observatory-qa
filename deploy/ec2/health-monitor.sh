#!/usr/bin/env bash
# Observatory QA — Production Health Monitor
#
# Checks the health endpoint and alerts via webhook on failures.
# Run via cron every 5 minutes:
#   */5 * * * * /opt/callanalyzer/scripts/health-monitor.sh >> /var/log/observatory-health.log 2>&1
#
# Environment:
#   APP_URL     - Base URL (default: http://localhost:5000)
#   ALERT_WEBHOOK_URL - Slack/Teams webhook for failure alerts (optional)
#   ALERT_EMAIL - Email for failure alerts via sendmail (optional)

set -euo pipefail

APP_URL="${APP_URL:-http://localhost:5000}"
HEALTH_URL="${APP_URL}/api/health"
READY_URL="${APP_URL}/api/health/ready"
TIMEOUT=10
MAX_RETRIES=2

# State file to prevent alert flooding (max 1 alert per 15 minutes)
STATE_FILE="/tmp/observatory-health-state"
ALERT_COOLDOWN=900  # 15 minutes

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; }

send_alert() {
  local subject="$1"
  local body="$2"

  # Slack/Teams webhook
  if [ -n "${ALERT_WEBHOOK_URL:-}" ]; then
    curl -sf -X POST "$ALERT_WEBHOOK_URL" \
      -H "Content-Type: application/json" \
      -d "{\"text\": \"🚨 *Observatory QA Alert*\n${subject}\n\`\`\`${body}\`\`\`\"}" \
      --max-time 10 2>/dev/null || true
  fi

  # Email (if sendmail available)
  if [ -n "${ALERT_EMAIL:-}" ] && command -v sendmail &>/dev/null; then
    echo -e "Subject: [ALERT] Observatory QA: ${subject}\n\n${body}" | sendmail "$ALERT_EMAIL" || true
  fi

  log "ALERT SENT: ${subject}"
}

check_alert_cooldown() {
  if [ -f "$STATE_FILE" ]; then
    local last_alert
    last_alert=$(cat "$STATE_FILE" 2>/dev/null || echo 0)
    local now
    now=$(date +%s)
    if (( now - last_alert < ALERT_COOLDOWN )); then
      return 1  # Still in cooldown
    fi
  fi
  date +%s > "$STATE_FILE"
  return 0
}

# --- Check health endpoint ---
check_health() {
  local url="$1"
  local label="$2"
  local attempt=0

  while (( attempt <= MAX_RETRIES )); do
    local http_code
    local response
    response=$(curl -sf -w "\n%{http_code}" --max-time "$TIMEOUT" "$url" 2>/dev/null) || {
      attempt=$((attempt + 1))
      if (( attempt <= MAX_RETRIES )); then
        log "WARN: ${label} check failed (attempt ${attempt}/${MAX_RETRIES}), retrying in 5s..."
        sleep 5
        continue
      fi
      log "FAIL: ${label} — connection failed after ${MAX_RETRIES} retries"
      return 1
    }

    http_code=$(echo "$response" | tail -1)
    local body
    body=$(echo "$response" | head -n -1)

    if [ "$http_code" = "200" ]; then
      log "OK: ${label} (HTTP ${http_code})"
      return 0
    elif [ "$http_code" = "503" ]; then
      log "DEGRADED: ${label} (HTTP ${http_code})"
      echo "$body"
      return 2  # Degraded but running
    else
      log "FAIL: ${label} (HTTP ${http_code})"
      return 1
    fi
  done
}

# --- Main ---

exit_code=0

if ! check_health "$HEALTH_URL" "Health"; then
  if check_alert_cooldown; then
    send_alert "Health check FAILED" "URL: ${HEALTH_URL}\nServer may be down or degraded.\nTime: $(date -u)"
  fi
  exit_code=1
elif ! check_health "$READY_URL" "Readiness"; then
  if check_alert_cooldown; then
    send_alert "Readiness check FAILED" "URL: ${READY_URL}\nStorage backend may be unavailable.\nTime: $(date -u)"
  fi
  exit_code=1
else
  # Clear state file on success (so next failure triggers immediately)
  rm -f "$STATE_FILE" 2>/dev/null || true
fi

exit $exit_code
