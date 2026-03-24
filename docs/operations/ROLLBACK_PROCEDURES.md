# Rollback Procedures

This document covers how to roll back a failed Observatory QA deployment across
all supported environments and infrastructure layers.

---

## Decision Tree: When to Roll Back

```
Deploy complete?
    │
    ├── No (build failed in CI) ──────────────────► Fix code, re-push. No rollback needed.
    │
    └── Yes (deployed to server)
            │
            ├── Service starts? ──────────────────► No → Immediate rollback (Section 1)
            │
            └── Service starts
                    │
                    ├── Health check passes? ──────► No → Immediate rollback (Section 1)
                    │
                    └── Health check passes
                            │
                            ├── Error rate spike?  ► Yes → Rollback within 30 min (Section 1)
                            │
                            ├── Data corruption?   ► Yes → Rollback + DB restore (Section 2)
                            │
                            └── Performance drop?  ► Investigate before rollback
```

**Default decision**: If the health check fails or errors spike within 15 minutes
of deploy, roll back immediately. Investigate afterward.

---

## Section 1: Application Rollback (EC2 Production)

### Option A: Automated rollback (preferred)

The `rollback.sh` script takes a pre-rollback DB snapshot, reverts to the
previous commit, rebuilds, restarts, and verifies health.

```bash
# Roll back to the previous commit
sudo /opt/callanalyzer/deploy/ec2/rollback.sh

# Roll back to a specific SHA
sudo /opt/callanalyzer/deploy/ec2/rollback.sh <SHA>

# List recent commits to choose a target
sudo /opt/callanalyzer/deploy/ec2/rollback.sh --list
```

The script logs to `/var/log/callanalyzer-rollback.log`.

**Expected output:**
```
=== Pre-flight checks ===
Current SHA:    abc123...
Rolling back 1 commit to: def456...

=== Pre-rollback database snapshot ===
Pre-rollback snapshot complete (2.3M)

=== Code rollback ===
...
=== Health check ===
Service healthy (HTTP 200) on attempt 2

=== Rollback complete ===
  Rolled back FROM: abc123...
  Rolled back TO:   def456...
```

### Option B: Manual rollback

Use this if `rollback.sh` itself fails or is not available.

```bash
cd /opt/callanalyzer

# 1. See recent commits
sudo -u callanalyzer git log --oneline -10

# 2. Check out previous commit
sudo -u callanalyzer git checkout <PREVIOUS_SHA>

# 3. Rebuild
sudo -u callanalyzer npm ci --production=false
sudo -u callanalyzer npm run build
sudo -u callanalyzer npm prune --production

# 4. Restart
sudo systemctl restart callanalyzer

# 5. Verify
sleep 5
curl -f http://localhost:5000/api/health && echo "OK" || echo "FAILED"
systemctl status callanalyzer
```

### Option C: Rollback via Docker (Blue/Green)

If running the Docker blue/green setup (`docker-compose.prod.yml`):

```bash
# Switch traffic back to the previous container
# (Caddy/nginx must be updated to point to the old port)

# List running containers
docker ps

# The blue container should still be running if deploy failed mid-green
# Verify blue is healthy
curl -f http://localhost:5000/api/health

# If blue is gone (e.g. it was stopped during deploy):
docker-compose -f docker-compose.prod.yml up -d app
```

---

## Section 2: Database Rollback

Database rollback is **only needed** when a deploy introduced a destructive data
migration (e.g. wrong column drop, corrupted data).

**Schema changes via `sync-schema.ts` use `IF NOT EXISTS` and `IF EXISTS` guards,
making them safe and non-destructive. A schema-only rollback is usually unnecessary.**

When a rollback also requires database recovery:

### Step 1: Stop the application

```bash
sudo systemctl stop callanalyzer
```

### Step 2: Identify the right backup

```bash
# Pre-deploy snapshots (taken automatically by deploy.sh)
ls -lt /tmp/observatory-backups/pre_deploy_*.dump | head -5

# Daily S3 backups
aws s3 ls s3://$S3_BUCKET/backups/db/ | sort | tail -10
```

Choose the snapshot **taken immediately before the bad deploy**.

### Step 3: Restore

```bash
# Load DATABASE_URL
export $(grep DATABASE_URL /opt/callanalyzer/.env | xargs)

# Restore using pg_restore with --clean (drops existing objects first)
pg_restore \
    --dbname="$DATABASE_URL" \
    --clean \
    --if-exists \
    --no-owner \
    --no-acl \
    --verbose \
    /tmp/observatory-backups/pre_deploy_YYYYMMDD_HHMMSS.dump
```

### Step 4: Verify restoration

```bash
psql "$DATABASE_URL" -c "
  SELECT 'organizations' AS tbl, COUNT(*) FROM organizations
  UNION ALL SELECT 'calls', COUNT(*) FROM calls
  UNION ALL SELECT 'audit_logs', COUNT(*) FROM audit_logs;
"
```

### Step 5: Restart the application

```bash
# Code should already be rolled back (Section 1)
sudo systemctl start callanalyzer
curl -f http://localhost:5000/api/health
```

For detailed restore procedures including WAL/PITR, see
[DATABASE_BACKUP_STRATEGY.md](DATABASE_BACKUP_STRATEGY.md).

---

## Section 3: Rollback on Render.com (Staging)

Render.com keeps previous deploys and supports one-click rollback.

### Via Render Dashboard

1. Go to **Dashboard → Observatory QA service → Deploys**
2. Find the last green deploy (before the broken one)
3. Click **"Rollback to this deploy"**
4. Render redeploys the previous image/commit without a CI run
5. Wait for the status to show **"Live"**
6. Verify: `curl https://observatory-qa-product.onrender.com/api/health`

### Via Render CLI

```bash
# Install Render CLI if not present
npm install -g @render-com/cli

render deploys list --service <SERVICE_ID>
render deploys rollback --service <SERVICE_ID> --deploy <DEPLOY_ID>
```

---

## Section 4: Docker Blue/Green Rollback

The `docker-compose.prod.yml` runs a blue (active) and green (standby) container.
During a rolling deploy, traffic stays on blue until green is verified healthy.

### Abort a green deploy mid-flight

```bash
# Stop the green container without switching traffic
docker-compose -f docker-compose.prod.yml --profile deploy stop app-green
docker-compose -f docker-compose.prod.yml --profile deploy rm -f app-green

# Blue continues serving traffic uninterrupted
```

### Rollback after traffic has switched to green

```bash
# Bring blue back up at the previous image tag
OLD_TAG=<previous SHA>
docker pull ghcr.io/your-org/observatory-qa:$OLD_TAG

# Update docker-compose.prod.yml to pin the blue service to OLD_TAG
# then:
docker-compose -f docker-compose.prod.yml up -d --no-deps app

# Switch traffic back to blue (update Caddy/nginx upstream port to 5000)
# then stop green
docker-compose -f docker-compose.prod.yml --profile deploy stop app-green
```

---

## Section 5: Emergency Rollback Checklist

Use this checklist when a production incident requires immediate rollback.

```
TIME TO COMPLETE: ~10 minutes for application rollback, ~30 min with DB restore

[ ] 1. Confirm the incident — verify health check is failing:
        curl -f https://your-domain.com/api/health || echo "FAILED"

[ ] 2. Notify team (Slack #incidents or on-call):
        "Initiating rollback of deploy <SHA> due to <reason>"

[ ] 3. Run rollback script:
        ssh ec2-user@<EC2_HOST>
        sudo /opt/callanalyzer/deploy/ec2/rollback.sh

[ ] 4. Verify rollback succeeded:
        curl -f https://your-domain.com/api/health
        sudo systemctl status callanalyzer

[ ] 5. If data corruption suspected — restore from pre-deploy snapshot:
        (See Section 2 above)

[ ] 6. Verify application functionality:
        - Login works
        - Dashboard loads
        - Call upload works (smoke test)
        - No error spikes in logs

[ ] 7. Create incident report:
        - What broke
        - When detected
        - Time to rollback (TTR)
        - Root cause (follow up)
        - Prevention action item

[ ] 8. Keep the bad commit reverted until root cause is fixed and re-tested
```

---

## Post-Rollback: Investigating the Bad Commit

```bash
# Compare the reverted commit to the rollback target
git log --oneline <rollback_target>..<bad_sha>

# Show the full diff
git diff <rollback_target> <bad_sha>

# Check logs around deploy time
journalctl -u callanalyzer --since "2026-01-01 14:00:00" --until "2026-01-01 15:00:00" --no-pager

# Check sync-schema errors
journalctl -u callanalyzer --no-pager | grep -i "schema sync\|migration\|ERROR" | tail -30
```

---

## Pre-Deploy Snapshot Location

Both `deploy.sh` and `rollback.sh` automatically take a pre-action DB snapshot:

| Script | Snapshot prefix | Location |
|--------|----------------|----------|
| `deploy.sh` | `pre_deploy_YYYYMMDD_HHMMSS.dump` | `/tmp/observatory-backups/` |
| `rollback.sh` | `pre_rollback_YYYYMMDD_HHMMSS.dump` | `/tmp/observatory-backups/` |

Local snapshots are cleaned up by the daily `backup.sh` cron (files older than
30 days are deleted). The daily cron also uploads to S3.

---

## Rollback Timing Guidelines

| Scenario | Recommended action | Time limit |
|----------|--------------------|------------|
| Build failed in CI | Fix code, re-push | No limit (nothing deployed) |
| Service won't start | Immediate rollback | Within 5 minutes |
| Health check failing | Immediate rollback | Within 5 minutes |
| Error rate spike | Rollback unless trivial fix < 15 min | Within 30 minutes |
| Data corruption detected | Rollback + DB restore | Immediately |
| Performance regression | Investigate first; rollback if no fix in 1hr | Within 1 hour |
| Minor visual bug | Fix forward (patch deploy) | No rollback needed |
