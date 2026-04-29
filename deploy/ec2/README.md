# Observatory QA — EC2 Deployment Guide (single-box stack)

**Estimated monthly cost:** ~$15/month (t3.small + 20GB gp3 + Elastic IP, after free tier). t3.micro saves $2/mo but is genuinely tight for this stack — see Sizing below.

This guide sets up Observatory QA on a single EC2 instance with everything (Node.js HTTP server, BullMQ workers, PostgreSQL+pgvector, Redis, Caddy) on the same box. Suitable for **staging / pre-PHI testing** and small production workloads.

> For production-with-PHI you'll likely want RDS PostgreSQL + ElastiCache Redis + multi-AZ + S3 separate from this scaffold. The single-box layout here is the launching pad, not the destination.

---

## Architecture

```
                     ┌────────────────────────────────────────────┐
                     │  EC2 instance (single box)                 │
Internet → Caddy ──→ │  Node.js (Express + WebSocket, :5000)      │
            (:443    │       ↕                                    │
        auto-TLS)    │  Node.js workers (BullMQ, separate proc)   │
                     │       ↕                                    │
                     │  PostgreSQL 16 + pgvector (localhost:5432) │
                     │  Redis 7 (localhost:6379)                  │
                     └────────────────────────────────────────────┘
                                  │
                                  ↓ outbound only
              S3 (audio archive) + Bedrock (Claude) + AssemblyAI + Stripe
```

- **EC2 t3.small** — 2 vCPU burstable, 2 GB RAM. Hosts everything on one instance.
- **Caddy** handles TLS termination (free Let's Encrypt certs, auto-renewal).
- **systemd** runs two units: `observatory-qa` (HTTP) and `observatory-qa-workers` (BullMQ).
- **PostgreSQL 16 + pgvector** local — used for structured data and RAG vector search. pgvector enables the HNSW index used by `searchRelevantChunks()`.
- **Redis 7** local — sessions, rate limiting, BullMQ queue backend, distributed pub/sub for WebSocket broadcasts (single-box so multi-instance coordination is moot but the interfaces are the same).
- **IAM instance role** — for S3 + Bedrock + (optionally) KMS + SES. No hardcoded AWS keys in `.env`.
- **EBS gp3 20GB** with encryption enabled.

### Sizing

| Instance | RAM | Cost/mo | Verdict |
|---|---|---|---|
| t3.micro | 1 GB | ~$13 | OOM-prone under any meaningful load — fine if you're uploading 1–2 calls/day to verify deploys. Workers + RAG indexing + Bedrock batch buffering will push past 1GB. |
| **t3.small** | **2 GB** | **~$15** | **Recommended for staging.** Comfortable headroom, no surprise restarts during demos. |
| t3.medium | 4 GB | ~$30 | Overkill for a single staging box; consider this only if you start running concurrent E2E from CI against the staging instance. |

The MemoryMax caps in the systemd units (800M main + 600M workers) are sized for t3.small. On t3.micro, drop both: `MemoryMax=500M` for the main service and `MemoryMax=350M` for workers.

---

## Prerequisites

1. A domain name with an A record you can point at the instance's Elastic IP (Caddy provisions Let's Encrypt certs against it).
2. An AWS account with EC2 + S3 + Bedrock + IAM access. Bedrock model access must be enabled in your target region (default `us-east-1`); see Bedrock console → Model access.
3. An AssemblyAI API key.
4. A repo URL the instance can clone from (HTTPS public clone, deploy key SSH, or GitHub PAT).
5. (Recommended) An S3 bucket for audio archive — separate from the staging instance so audio survives instance termination.

---

## Step 1: Launch EC2 Instance

### Via AWS Console
1. EC2 → Launch Instance
2. **Name**: `observatory-qa-staging`
3. **AMI**: Amazon Linux 2023 (`al2023-ami-*`)
4. **Instance type**: `t3.small` (or `t3.micro` per Sizing above)
5. **Key pair**: create or reuse an SSH key
6. **Network settings**:
   - VPC: default VPC (or your VPC)
   - Subnet: a public subnet in your AZ of choice
   - Auto-assign public IP: enable
   - Security group: create new, see rules below (or use `security-group.json`)
7. **Storage**: 20 GiB gp3, **Encryption: enabled**
8. **Advanced → IAM instance profile**: attach `ObservatoryQAEC2Role` (created in Step 2)
9. **Advanced → User data**: paste the contents of `user-data.sh`. Set the required env vars at the top by editing the script — `DOMAIN` and `REPO_URL` are the only ones you must fill in. Everything else auto-generates sensible defaults.
10. Launch

### Security Group rules

| Type  | Port | Source     | Purpose |
|-------|------|------------|---------|
| SSH   | 22   | Your IP/32 | Admin access (NEVER 0.0.0.0/0) |
| HTTP  | 80   | 0.0.0.0/0  | Caddy ACME challenge + HTTP→HTTPS redirect |
| HTTPS | 443  | 0.0.0.0/0  | Application traffic |

PostgreSQL (5432) and Redis (6379) stay closed to the public internet — both bind to `localhost` on the instance and are only accessed by the app and workers.

### Allocate Elastic IP
1. EC2 → Elastic IPs → Allocate
2. Associate with your instance
3. Update your DNS A record to point at the Elastic IP

---

## Step 2: IAM Instance Role

Create an IAM role so the app accesses S3 + Bedrock without hardcoded keys.

1. IAM → Roles → Create Role → Trusted entity: AWS Service → EC2
2. Create an inline policy from `security-group.json` `_iam_role.Statement`. Replace `YOUR_BUCKET`, `YOUR_KEY_ID`, and `YOUR_ACCOUNT_ID` placeholders.
3. Name: `ObservatoryQAEC2Role`
4. Attach to the EC2 instance: Actions → Security → Modify IAM Role

The minimal policy covers S3 (audio archive) + Bedrock (model invocation). Add KMS + SES only if you enable per-org encryption or AWS SES email.

---

## Step 3: First-boot operator finish

`user-data.sh` runs once on first boot and installs the full stack: Node.js 20, Caddy, PostgreSQL 16 + pgvector, Redis 7, the app code, and both systemd units. It auto-generates `SESSION_SECRET`, `PHI_ENCRYPTION_KEY`, and the postgres password.

SSH in once it's done (~3-5 minutes after instance launch):
```bash
ssh -i your-key.pem ec2-user@YOUR_ELASTIC_IP
sudo cat /var/log/observatory-qa-setup.log    # verify bootstrap succeeded end-to-end
```

You'll see the generated secrets at the bottom of the setup log. **Copy `PHI_ENCRYPTION_KEY` to a secure vault before doing anything else** — losing this key permanently destroys access to any PHI fields encrypted with it.

### Fill in the operator-required vars

```bash
sudo nano /opt/observatory-qa/.env
```

Required:
- `ASSEMBLYAI_API_KEY` — from your AssemblyAI dashboard
- `AUTH_USERS` — format `user:pass:role:displayName:orgSlug` (comma-separated). Example: `admin:SecurePass123!:admin:Staging Admin:default`

Recommended (uncomment and fill in `.env`):
- `S3_BUCKET` — for audio archive (otherwise audio lives only on this instance's EBS volume; data loss risk on instance termination)
- `BETTERSTACK_SOURCE_TOKEN` — log aggregation
- `SENTRY_DSN` and `VITE_SENTRY_DSN` — error tracking
- `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` — billing (skip for non-billing staging)

Auto-generated and pre-filled — leave as-is unless rotating:
- `SESSION_SECRET`, `PHI_ENCRYPTION_KEY`, `DATABASE_URL` (with the postgres password)

### Start the services

```bash
sudo systemctl start observatory-qa
sudo systemctl start observatory-qa-workers
sudo systemctl start caddy
```

### Verify

```bash
sudo systemctl status observatory-qa observatory-qa-workers caddy
curl -I https://YOUR_DOMAIN/api/health
sudo journalctl -u observatory-qa -n 50 --no-pager
```

`/api/health` returns 200 once Caddy has provisioned a Let's Encrypt cert (~30 seconds on first request).

---

## Step 4: HIPAA compliance checklist (single-box)

| Requirement | How it's met |
|-------------|---|
| Encryption in transit | Caddy auto-TLS (Let's Encrypt) |
| Encryption at rest | EBS encryption + S3 SSE on the audio archive bucket |
| Access control | Role-based auth (viewer/manager/admin), MFA (TOTP/WebAuthn), session timeouts |
| Audit logging | `audit_logs` table with tamper-evident hash chain + Caddy access log + journald |
| Account lockout | 5 failed attempts → 15-min lockout per username (Redis-backed) |
| Data retention | Auto-purge after `RETENTION_DAYS` (default 90, per-org override) |
| Network security | Security group restricts to 22/80/443 only; PG and Redis bind to localhost |
| No hardcoded secrets | IAM instance role for AWS, encrypted `.env` (mode 600) for app secrets |
| PHI encryption | AES-256-GCM via `PHI_ENCRYPTION_KEY` (64 hex chars). Server **refuses to start** in production without this key |

> The single-box layout mixes the application instance with PHI database storage. For production-with-PHI, separate them: RDS PostgreSQL with multi-AZ, ElastiCache Redis, and dedicated S3 buckets per data class. The deploy scripts here generalize cleanly — `DATABASE_URL` and `REDIS_URL` already point wherever you set them.

---

## Ongoing operations

### Deploy a new version

```bash
sudo /opt/observatory-qa/deploy/ec2/deploy.sh main
# or pin to a specific git SHA (CI-driven):
sudo /opt/observatory-qa/deploy/ec2/deploy.sh main <SHA>
```

`deploy.sh` does:
1. Pre-flight env validation (PHI key length, SESSION_SECRET length, DATABASE_URL when postgres backend, REDIS_URL when REQUIRE_REDIS=true)
2. Pre-deploy DB snapshot (`pg_dump --format=custom`)
3. `git fetch + checkout`, `npm ci`, `npm run build`, `npm prune`
4. Restart `observatory-qa` AND `observatory-qa-workers`
5. Health-check `/api/health` (10 retries, 5s apart)
6. Auto-rollback to previous SHA if health check fails (rebuilds + restarts at the rollback SHA)

### Roll back manually

```bash
sudo /opt/observatory-qa/deploy/ec2/rollback.sh         # roll back 1 commit
sudo /opt/observatory-qa/deploy/ec2/rollback.sh <SHA>   # roll back to specific SHA
sudo /opt/observatory-qa/deploy/ec2/rollback.sh --list  # show recent commits
```

### View logs

```bash
sudo journalctl -u observatory-qa -f            # main HTTP server
sudo journalctl -u observatory-qa-workers -f    # BullMQ workers
sudo tail -f /var/log/caddy/access.log          # Caddy access log
sudo cat /var/log/observatory-qa-setup.log      # first-boot bootstrap log
```

### Database backup

`backup.sh` does a `pg_dump --format=custom` + verifies it's restorable + uploads to S3 (if `S3_BUCKET` is set):

```bash
# One-shot
sudo /opt/observatory-qa/deploy/ec2/backup.sh

# Daily cron at 2am UTC
echo '0 2 * * * /opt/observatory-qa/deploy/ec2/backup.sh >> /var/log/observatory-qa-backup.log 2>&1' | sudo tee -a /etc/crontab
```

### Health monitoring (cron)

```bash
# Every 5 minutes — alerts via Slack/Teams webhook on failure
echo '*/5 * * * * ALERT_WEBHOOK_URL="https://hooks.slack.com/..." /opt/observatory-qa/deploy/ec2/health-monitor.sh >> /var/log/observatory-qa-health.log 2>&1' | sudo tee -a /etc/crontab
```

### Cost monitoring

CloudWatch → Alarms → Create Alarm → Metric `EstimatedCharges` → threshold > $25 → email via SNS.

---

## Files in this directory

| File | Purpose |
|------|---------|
| `Caddyfile` | Caddy reverse proxy + auto-TLS config (template — substitutes `$DOMAIN`) |
| `observatory-qa.service` | systemd unit for the main HTTP server |
| `observatory-qa-workers.service` | systemd unit for the BullMQ worker process |
| `user-data.sh` | EC2 first-boot bootstrap (installs full stack, generates secrets, stages units) |
| `deploy.sh` | Code update / redeployment with pre-flight + auto-rollback |
| `rollback.sh` | Manual rollback to previous SHA + DB snapshot |
| `backup.sh` | DB backup with verification + S3 upload + retention purge |
| `health-monitor.sh` | Cron-driven health check with Slack/Teams alerts |
| `security-group.json` | AWS security group + IAM policy reference (CLI-friendly) |
| `README.md` | This file |

---

## Render.com (legacy staging — non-PHI only)

Render is still available as a parallel deployment target for non-PHI testing:
- Build: `npm run build`, Start: `npm run start`
- Environment vars in Render dashboard
- IaC via `render.yaml` (web + worker + Redis + PostgreSQL)
- URL: `https://observatory-qa-product.onrender.com`
- Use Render for demo / preview builds shared with stakeholders. Use this EC2 setup for any deployment that will hold PHI.
