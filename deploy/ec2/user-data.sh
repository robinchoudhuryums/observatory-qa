#!/bin/bash
# Observatory QA — EC2 User Data (bootstrap) Script
#
# Runs once on first boot when launching the EC2 instance. Installs the full
# single-box stack (Node.js + Caddy + PostgreSQL 16 with pgvector + Redis 7),
# clones the app, and stages systemd units. Operator finishes by editing
# /opt/observatory-qa/.env and starting the services.
#
# Usage:
#   Paste into EC2 Launch → Advanced Details → User Data
#   OR pass via: aws ec2 run-instances --user-data file://deploy/ec2/user-data.sh
#
# Required env vars at launch:
#   DOMAIN     — public hostname pointed at this instance's Elastic IP
#   REPO_URL   — git URL of this repo (HTTPS or SSH with deploy key)
#
# Optional env vars at launch:
#   PG_PASSWORD     — postgres password for the observatory_qa role.
#                     Auto-generated if unset; written into .env.
#   SESSION_SECRET  — auto-generated 64-hex if unset.
#   PHI_KEY         — auto-generated 64-hex if unset. KEEP A BACKUP — losing
#                     this key permanently destroys access to PHI data.
#
# Prerequisites:
#   - Amazon Linux 2023 AMI (al2023-ami-*)
#   - t3.small recommended (1GB t3.micro is tight; see observatory-qa.service)
#   - Security group with ports 22, 80, 443 open
#   - IAM instance profile with bedrock:InvokeModel + S3 access (see
#     deploy/ec2/security-group.json for the policy template)
#   - Single-AZ EBS gp3 with encryption enabled

set -euo pipefail
exec > >(tee /var/log/observatory-qa-setup.log) 2>&1

# === REQUIRED ===
DOMAIN="${DOMAIN:?'Set DOMAIN env var (e.g., qa.yourcompany.com)'}"
REPO_URL="${REPO_URL:?'Set REPO_URL env var (e.g., https://github.com/org/observatory-qa.git)'}"

# === Optional with auto-defaults ===
SESSION_SECRET="${SESSION_SECRET:-$(openssl rand -hex 32)}"
PHI_KEY="${PHI_KEY:-$(openssl rand -hex 32)}"
PG_PASSWORD="${PG_PASSWORD:-$(openssl rand -hex 16)}"

APP_USER="observatory-qa"
APP_DIR="/opt/observatory-qa"
PG_DB="observatory_qa"
PG_USER="observatory_qa"

echo "=== Observatory QA EC2 Setup — $(date) ==="

# ─── System updates ─────────────────────────────────────────────────────
dnf update -y

# ─── Node.js 20 LTS ─────────────────────────────────────────────────────
dnf install -y nodejs20 npm git
node --version
npm --version

# ─── Caddy (TLS termination + reverse proxy) ────────────────────────────
dnf install -y 'dnf-command(copr)'
dnf copr enable -y @caddy/caddy
dnf install -y caddy
mkdir -p /var/log/caddy
chown caddy:caddy /var/log/caddy

# ─── PostgreSQL 16 + pgvector ───────────────────────────────────────────
# AL2023 ships postgresql15-server in the default repo; the postgresql16
# packages live in the amazon-linux-extras-style PGDG repo. Use the upstream
# PGDG repo for both to ensure pgvector is available.
dnf install -y "https://download.postgresql.org/pub/repos/yum/reporpms/EL-9-x86_64/pgdg-redhat-repo-latest.noarch.rpm" \
    || echo "WARN: PGDG repo install failed — falling back to distro postgresql15"

# Disable AL2023 default postgresql module if present (otherwise it conflicts)
dnf -qy module disable postgresql 2>/dev/null || true

# Try PG16 first; fall back to PG15 if PGDG repo wasn't reachable.
if dnf install -y postgresql16-server postgresql16-contrib pgvector_16; then
    PG_VERSION=16
    PG_DATA=/var/lib/pgsql/16/data
    PG_BIN=/usr/pgsql-16/bin
elif dnf install -y postgresql15-server postgresql15-contrib pgvector_15; then
    PG_VERSION=15
    PG_DATA=/var/lib/pgsql/15/data
    PG_BIN=/usr/pgsql-15/bin
else
    echo "ERROR: Could not install PostgreSQL with pgvector. Aborting."
    exit 1
fi

echo "Installed PostgreSQL ${PG_VERSION} with pgvector"

# Initialize the cluster (idempotent — bails out if already initialized)
if [ ! -s "${PG_DATA}/PG_VERSION" ]; then
    "${PG_BIN}/postgresql-${PG_VERSION}-setup" initdb
fi

# Tune for t3.small (2GB RAM). Comment-out the heuristic-defaulted settings
# and append explicit values. Idempotent — only appends if our marker is
# absent.
PG_CONF="${PG_DATA}/postgresql.conf"
if ! grep -q "# observatory-qa: tuning" "$PG_CONF"; then
    cat >> "$PG_CONF" <<PGCONF

# observatory-qa: tuning for t3.small (2GB RAM)
shared_buffers = 256MB
effective_cache_size = 1GB
work_mem = 4MB
maintenance_work_mem = 64MB
max_connections = 50
PGCONF
fi

# Enable + start postgres
systemctl enable "postgresql-${PG_VERSION}"
systemctl start "postgresql-${PG_VERSION}"

# Create the app role + database. Idempotent via DO blocks / IF NOT EXISTS.
sudo -u postgres psql <<SQL
DO \$\$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${PG_USER}') THEN
        CREATE ROLE ${PG_USER} LOGIN PASSWORD '${PG_PASSWORD}';
    END IF;
END
\$\$;
SQL

# CREATE DATABASE can't run inside a DO block. Skip if it exists.
DB_EXISTS=$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${PG_DB}'" || true)
if [ -z "$DB_EXISTS" ]; then
    sudo -u postgres createdb -O "${PG_USER}" "${PG_DB}"
fi

# Install pgvector extension (must be done as superuser per-database).
sudo -u postgres psql -d "${PG_DB}" -c "CREATE EXTENSION IF NOT EXISTS vector;"

# ─── Redis 7 ────────────────────────────────────────────────────────────
dnf install -y redis6  # AL2023 ships redis6; functionally compatible with the redis 7 client features the app needs
systemctl enable redis6
systemctl start redis6

# ─── Application user ───────────────────────────────────────────────────
useradd --system --shell /usr/sbin/nologin --home-dir "${APP_DIR}" "${APP_USER}" 2>/dev/null || true
mkdir -p "${APP_DIR}"
chown "${APP_USER}:${APP_USER}" "${APP_DIR}"

# ─── Clone and build the app ────────────────────────────────────────────
cd "${APP_DIR}"
sudo -u "${APP_USER}" git clone "${REPO_URL}" .
sudo -u "${APP_USER}" npm ci --production=false
sudo -u "${APP_USER}" npm run build
sudo -u "${APP_USER}" npm prune --production

# ─── Stage .env ─────────────────────────────────────────────────────────
# IMPORTANT: ASSEMBLYAI_API_KEY and AUTH_USERS MUST be filled in by the
# operator before starting the services. The bootstrap fills in everything
# else with sensible staging defaults / generated secrets.
cat > "${APP_DIR}/.env" <<ENVFILE
# === REQUIRED — operator must fill in before first start ===
ASSEMBLYAI_API_KEY=                        # Get from https://www.assemblyai.com/
AUTH_USERS=                                # Format: user:pass:role:displayName:orgSlug (comma-separated)

# === Auto-generated at bootstrap (KEEP A BACKUP — see README) ===
SESSION_SECRET=${SESSION_SECRET}
PHI_ENCRYPTION_KEY=${PHI_KEY}

# === Storage backend ===
STORAGE_BACKEND=postgres
DATABASE_URL=postgresql://${PG_USER}:${PG_PASSWORD}@localhost:5432/${PG_DB}

# === Redis (sessions, rate limit, BullMQ queues, pub/sub) ===
REDIS_URL=redis://localhost:6379
REQUIRE_REDIS=true                         # Fail-fast in production if Redis goes down

# === AWS (Bedrock + S3) ===
# Prefer the IAM instance role over hardcoded keys. Leave the access keys
# commented; the AWS SDK picks up the instance role automatically.
# AWS_ACCESS_KEY_ID=
# AWS_SECRET_ACCESS_KEY=
AWS_REGION=us-east-1
S3_BUCKET=                                 # S3 bucket for audio archive (optional but recommended)

# === Application ===
NODE_ENV=production
PORT=5000
APP_BASE_URL=https://${DOMAIN}
RETENTION_DAYS=90

# === Optional ===
# BETTERSTACK_SOURCE_TOKEN=                # Log aggregation
# SENTRY_DSN=                              # Server error tracking
# STRIPE_SECRET_KEY=                       # Billing
# STRIPE_WEBHOOK_SECRET=
# AWS_KMS_KEY_ID=                          # Per-org PHI envelope encryption
ENVFILE

chown "${APP_USER}:${APP_USER}" "${APP_DIR}/.env"
chmod 600 "${APP_DIR}/.env"

# ─── Install systemd units from the repo ────────────────────────────────
cp "${APP_DIR}/deploy/ec2/observatory-qa.service" /etc/systemd/system/observatory-qa.service
cp "${APP_DIR}/deploy/ec2/observatory-qa-workers.service" /etc/systemd/system/observatory-qa-workers.service
systemctl daemon-reload
systemctl enable observatory-qa observatory-qa-workers

# ─── Install Caddyfile ──────────────────────────────────────────────────
# Substitute the operator's DOMAIN into the template Caddy config.
sed "s/{\\\$DOMAIN}/${DOMAIN}/g" "${APP_DIR}/deploy/ec2/Caddyfile" > /etc/caddy/Caddyfile
systemctl enable caddy

# ─── Done ───────────────────────────────────────────────────────────────
cat <<DONE

=== SETUP COMPLETE ===

Generated secrets (keep these — they are also written into ${APP_DIR}/.env):
  SESSION_SECRET=${SESSION_SECRET}
  PHI_ENCRYPTION_KEY=${PHI_KEY}
  PG password=${PG_PASSWORD}

PostgreSQL ${PG_VERSION} with pgvector running on localhost:5432
Redis running on localhost:6379

Next steps (operator):
  1. Edit ${APP_DIR}/.env — fill in ASSEMBLYAI_API_KEY and AUTH_USERS.
  2. (Optional) Fill in S3_BUCKET, STRIPE_*, BETTERSTACK_SOURCE_TOKEN, SENTRY_DSN.
  3. Point your domain's DNS A record to this instance's Elastic IP.
  4. Start services in order:
       sudo systemctl start observatory-qa
       sudo systemctl start observatory-qa-workers
       sudo systemctl start caddy
  5. Verify:
       curl -I https://${DOMAIN}/api/health
       sudo journalctl -u observatory-qa -n 50 --no-pager

PHI ENCRYPTION KEY BACKUP — CRITICAL:
  PHI_ENCRYPTION_KEY in ${APP_DIR}/.env is the AES-256-GCM master key for
  every PHI field encrypted in the database. Losing it makes existing PHI
  data permanently unrecoverable. Copy it out of the .env file to a secure
  vault (1Password / AWS Secrets Manager / Vault) before the first call is
  uploaded.

DONE
