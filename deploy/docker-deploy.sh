#!/bin/bash
# Observatory QA — Blue-Green Docker Deployment
#
# Zero-downtime deployment using Docker Compose blue-green strategy.
# Builds and starts a new "green" instance, verifies health, then
# switches traffic and stops the old "blue" instance.
#
# Usage:
#   ./deploy/docker-deploy.sh              # Build from current code
#   ./deploy/docker-deploy.sh --rollback   # Switch back to blue
#
# Prerequisites:
#   - Docker and Docker Compose installed
#   - .env file configured
#   - Caddy/nginx configured to upstream to localhost:5000 (blue) or 5001 (green)

set -euo pipefail

COMPOSE_FILES="-f docker-compose.yml -f docker-compose.prod.yml"
HEALTH_URL_BLUE="http://localhost:5000/api/health/ready"
HEALTH_URL_GREEN="http://localhost:5001/api/health/ready"
MAX_RETRIES=10
RETRY_INTERVAL=5

echo "=== Observatory QA Docker Deploy — $(date) ==="

# --- Rollback mode ---
if [[ "${1:-}" == "--rollback" ]]; then
    echo "--- Rolling back to blue instance ---"
    docker compose $COMPOSE_FILES stop app-green
    echo "Green instance stopped. Blue instance should be serving on :5000."
    echo "Verify: curl -s $HEALTH_URL_BLUE"
    exit 0
fi

# --- Step 1: Build new image ---
echo "--- Building new image ---"
docker compose $COMPOSE_FILES build app-green

# --- Step 2: Start green instance ---
echo "--- Starting green instance on :5001 ---"
docker compose $COMPOSE_FILES --profile deploy up -d app-green

# --- Step 3: Wait for green to be healthy ---
echo "--- Waiting for green instance to be ready ---"
for i in $(seq 1 $MAX_RETRIES); do
    STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$HEALTH_URL_GREEN" 2>/dev/null || echo "000")
    if [ "$STATUS" = "200" ]; then
        echo "Green instance is healthy!"
        break
    fi
    if [ "$i" = "$MAX_RETRIES" ]; then
        echo "ERROR: Green instance failed to become healthy after $MAX_RETRIES attempts"
        echo "Rolling back..."
        docker compose $COMPOSE_FILES stop app-green
        exit 1
    fi
    echo "  Attempt $i/$MAX_RETRIES: status=$STATUS, retrying in ${RETRY_INTERVAL}s..."
    sleep $RETRY_INTERVAL
done

# --- Step 4: Switch traffic ---
echo ""
echo "=== Green instance verified. Switch traffic now. ==="
echo ""
echo "To complete deployment:"
echo "  1. Update your reverse proxy to point to :5001 (green)"
echo "  2. Verify traffic is flowing to green"
echo "  3. Stop blue: docker compose $COMPOSE_FILES stop app"
echo ""
echo "To rollback:"
echo "  ./deploy/docker-deploy.sh --rollback"
echo ""
echo "=== Deploy ready — $(date) ==="
