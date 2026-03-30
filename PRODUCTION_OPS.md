# Observatory QA — Production Operations Guide

## Pre-Launch Checklist

### Environment Validation
The server validates required environment variables on startup and refuses to start if critical config is missing. In production, the following will cause a startup failure:

| Variable | Required | Validation |
|----------|----------|-----------|
| `SESSION_SECRET` | Always | Must be set |
| `PHI_ENCRYPTION_KEY` | Production | 64-char hex (AES-256-GCM) |
| `DATABASE_URL` | When `STORAGE_BACKEND=postgres` | Must be set |
| `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` | Must be paired | Both or neither |

Warnings (non-fatal) are logged for:
- Missing `ASSEMBLYAI_API_KEY` (audio processing will fail)
- Weak `SESSION_SECRET` (< 16 chars or "dev-secret")
- Missing `STRIPE_WEBHOOK_SECRET` when Stripe is configured

### Generate PHI_ENCRYPTION_KEY
```bash
# Generate a random 64-char hex key (32 bytes = AES-256)
openssl rand -hex 32
# Output: e.g., a1b2c3d4e5f6...  (64 characters)
```

---

## Monitoring & Alerting

### Health Endpoints

| Endpoint | Auth | Purpose | Alert on |
|----------|------|---------|----------|
| `GET /api/health` | None | Full dependency check (DB, Redis, AI, S3) | HTTP 503 |
| `GET /api/health/ready` | None | Readiness probe (storage only) | HTTP 503 |
| `GET /api/health/live` | None | Liveness probe (process alive) | Connection refused |
| `GET /api/health/metrics` | None | Prometheus-compatible metrics | N/A (scrape target) |

### Setting Up Monitoring

**Option A: Cron-based (EC2)**
```bash
# Install the health monitor script
cp deploy/ec2/health-monitor.sh /opt/callanalyzer/scripts/
chmod +x /opt/callanalyzer/scripts/health-monitor.sh

# Add to crontab (checks every 5 minutes, alerts via webhook)
echo '*/5 * * * * APP_URL=https://your-domain.com ALERT_WEBHOOK_URL=https://hooks.slack.com/... /opt/callanalyzer/scripts/health-monitor.sh >> /var/log/observatory-health.log 2>&1' | crontab -
```

**Option B: Betterstack (recommended for production)**
1. Sign up at [betterstack.com](https://betterstack.com)
2. Create a monitor: URL = `https://your-domain.com/api/health`, check every 60s
3. Set `BETTERSTACK_SOURCE_TOKEN` in `.env` for log aggregation
4. Alerts go to your on-call schedule (email, Slack, PagerDuty)

**Option C: Prometheus + Grafana**
- Scrape target: `https://your-domain.com/api/health/metrics`
- Scrape interval: 15s
- Dashboard includes: heap usage, request latency p50/p95/p99, error rate, uptime

### Key Metrics to Monitor
- **Response time p95** > 2s → investigate slow queries
- **Heap usage** > 80% of total → memory leak or unbounded query
- **Error rate** > 5% of requests → check Sentry for error patterns
- **Circuit breaker OPEN** → Bedrock is down, calls complete with default scores
- **Redis disconnected** → sessions are in-memory only (not distributed)

---

## Rate Limits

### Current Configuration

| Endpoint | Window | Max Requests | Key | Notes |
|----------|--------|-------------|-----|-------|
| `POST /api/auth/login` | 15 min | 5 | IP only | Account lockout after 5 failures |
| `POST /api/auth/register` | 15 min | 3 | IP only | |
| `POST /api/auth/forgot-password` | 15 min | 3 | IP only | |
| `GET /api/calls` | 1 min | 100 | IP + orgId | |
| `POST /api/calls/upload` | 1 min | 30 | IP + orgId | |
| `GET /api/export/*` | 1 min | 10 | IP + orgId | |
| `POST /api/onboarding/rag/search` | 1 min | 20 | IP + orgId | |
| `GET /api/calls/:id/transcript` | 1 min | 30 | IP + orgId | PHI endpoint |
| `GET /api/calls/:id/analysis` | 1 min | 30 | IP + orgId | PHI endpoint |
| `GET /api/calls/:id/sentiment` | 1 min | 30 | IP + orgId | PHI endpoint |
| `GET /api/calls/*` | 1 min | 60 | IP + orgId | Catch-all |
| `GET /api/employees/*` | 1 min | 60 | IP + orgId | |
| `GET /api/clinical/*` | 1 min | 40 | IP + orgId | PHI-heavy |
| `GET /api/ehr/*` | 1 min | 20 | IP + orgId | External API |
| `POST /api/clinical/style-learning/analyze` | 1 min | 3 | IP + orgId | Expensive AI call |

### Tuning for Your Traffic
- **Low-traffic orgs (< 10 users)**: Default limits are fine
- **Medium-traffic (10-50 users)**: Consider raising `GET /api/calls` to 200/min
- **High-traffic (50+ users)**: Requires Redis for distributed rate limiting; consider per-user limits

### Rate Limit Headers
All rate-limited responses include:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 87
X-RateLimit-Reset: 45    (seconds until window resets)
```

On limit exceeded, returns `429 Too Many Requests`.

---

## Stripe Price Setup

Create these prices in the Stripe Dashboard (Products → Add product) and set the corresponding env vars:

### Flat-Rate Subscription Prices
| Env Var | Product | Amount | Billing |
|---------|---------|--------|---------|
| `STRIPE_PRICE_STARTER_MONTHLY` | Observatory QA Starter | $79.00 | Monthly recurring |
| `STRIPE_PRICE_STARTER_YEARLY` | Observatory QA Starter (Annual) | $756.00 | Yearly recurring ($63/mo) |
| `STRIPE_PRICE_PROFESSIONAL_MONTHLY` | Observatory QA Professional | $199.00 | Monthly recurring |
| `STRIPE_PRICE_PROFESSIONAL_YEARLY` | Observatory QA Professional (Annual) | $1,908.00 | Yearly recurring ($159/mo) |
| `STRIPE_PRICE_ENTERPRISE_MONTHLY` | Observatory QA Enterprise | $999.00 | Monthly recurring |
| `STRIPE_PRICE_ENTERPRISE_YEARLY` | Observatory QA Enterprise (Annual) | $9,588.00 | Yearly recurring ($799/mo) |

### Add-On Prices
| Env Var | Product | Amount | Billing |
|---------|---------|--------|---------|
| `STRIPE_PRICE_CLINICAL_ADDON_MONTHLY` | Clinical Documentation Add-On | $49.00 | Monthly recurring |

### Metered Prices (Per-Seat)
| Env Var | Product | Amount | Type |
|---------|---------|--------|------|
| `STRIPE_PRICE_STARTER_SEATS` | Starter Additional Seats | $15.00/unit | Metered (usage_type=metered) |
| `STRIPE_PRICE_PROFESSIONAL_SEATS` | Professional Additional Seats | $20.00/unit | Metered |

### Metered Prices (Per-Call Overage)
| Env Var | Product | Amount | Type |
|---------|---------|--------|------|
| `STRIPE_PRICE_STARTER_OVERAGE` | Starter Call Overage | $0.35/unit | Metered |
| `STRIPE_PRICE_PROFESSIONAL_OVERAGE` | Professional Call Overage | $0.25/unit | Metered |
| `STRIPE_PRICE_ENTERPRISE_OVERAGE` | Enterprise Call Overage | $0.15/unit | Metered |

**Important:** Use Stripe's test mode first. All price IDs start with `price_` (e.g., `price_1abc...`). Copy the price ID from the Stripe Dashboard into your `.env`.

---

## Stripe Webhook Test Plan

### Setup
1. Set `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` in `.env`
2. Register webhook endpoint in Stripe Dashboard:
   - URL: `https://your-domain.com/api/billing/webhook`
   - Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_succeeded`, `invoice.payment_failed`

### Test Procedure

**Step 1: Verify webhook endpoint is reachable**
```bash
# From your local machine or CI:
curl -s -o /dev/null -w "%{http_code}" https://your-domain.com/api/billing/webhook
# Expected: 400 (no Stripe signature) — NOT 404
```

**Step 2: Use Stripe CLI for local testing**
```bash
# Install Stripe CLI
brew install stripe/stripe-cli/stripe  # macOS

# Forward webhooks to local server
stripe listen --forward-to http://localhost:5000/api/billing/webhook

# In another terminal, trigger test events:
stripe trigger checkout.session.completed
stripe trigger customer.subscription.updated
stripe trigger invoice.payment_failed
```

**Step 3: Verify subscription flow end-to-end**
1. Create a test org (register via `/auth`)
2. Go to billing page, click "Upgrade to Starter"
3. Complete Stripe checkout with test card `4242 4242 4242 4242`
4. Verify:
   - [ ] Subscription appears in `/api/billing/subscription`
   - [ ] Plan limits are enforced (try uploading > free tier calls)
   - [ ] Stripe customer portal works (`/api/billing/portal`)

**Step 4: Test failure scenarios**
```bash
# Trigger payment failure
stripe trigger invoice.payment_failed

# Verify:
# - Subscription status changes to "past_due"
# - Grace period applies (default: 7 days)
# - After grace period, subscription is suspended
```

**Step 5: Verify webhook signature**
```bash
# Send request WITHOUT Stripe signature — should be rejected
curl -X POST https://your-domain.com/api/billing/webhook \
  -H "Content-Type: application/json" \
  -d '{"type":"checkout.session.completed"}'
# Expected: 400 (signature verification failed)
```

### Common Issues
- **Webhook returns 500**: Check that `express.raw()` middleware is applied before `express.json()` for the webhook route (already configured in `server/index.ts`)
- **Signature mismatch**: Verify `STRIPE_WEBHOOK_SECRET` matches the webhook endpoint in Stripe Dashboard (not the API key)
- **Events not arriving**: Check Stripe Dashboard → Developers → Webhooks → Recent events for delivery status

---

## Backup & Recovery

### Daily Backups (EC2)
```bash
# The backup script handles: pg_dump, verification, S3 upload, local cleanup
/opt/callanalyzer/deploy/ec2/backup.sh

# Verify backups exist:
aws s3 ls s3://your-bucket/backups/ --recursive | tail -5
```

### Restore Procedure
```bash
# 1. Download backup
aws s3 cp s3://your-bucket/backups/observatory-2026-03-28.dump.gz ./

# 2. Decompress
gunzip observatory-2026-03-28.dump.gz

# 3. Restore (creates tables, replaces existing data)
pg_restore --clean --if-exists -d observatory observatory-2026-03-28.dump

# 4. Verify
psql -d observatory -c "SELECT count(*) FROM organizations;"
```

### Rollback
```bash
# Use the rollback script to revert to a previous git SHA
/opt/callanalyzer/deploy/ec2/rollback.sh --list  # Show recent deploys
/opt/callanalyzer/deploy/ec2/rollback.sh          # Revert to previous
```

---

## Incident Response (Quick Reference)

| Symptom | Check | Action |
|---------|-------|--------|
| Server not responding | `curl /api/health/live` | `sudo systemctl restart callanalyzer` |
| 503 on health check | Check `/api/health` JSON for failed checks | Fix the failing dependency (DB, Redis) |
| AI analysis returning defaults (5.0) | Check circuit breaker in `/api/health` | Verify AWS credentials, Bedrock access |
| "PHI_ENCRYPTION_KEY not configured" | Check `.env` | Set the key and restart |
| High memory usage | Check `/api/health/metrics` | Restart; investigate if recurring |
| Login failures spiking | Check audit logs | Possible brute force — WAF should auto-block |
| Stripe webhooks failing | Check Stripe Dashboard → Webhooks | Verify `STRIPE_WEBHOOK_SECRET` matches |
