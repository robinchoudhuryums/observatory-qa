# Observatory QA

AI-powered call quality analysis and clinical documentation for healthcare and compliance-driven organizations. Upload call recordings, get instant transcription, performance scoring, sentiment analysis, coaching insights, and compliance monitoring. Now with AI-powered clinical note generation (SOAP/DAP/BIRP), EHR integration, and provider style learning — all HIPAA-compliant.

## What It Does

1. **Upload** a call recording (audio file)
2. **Transcribe** automatically via AssemblyAI
3. **Analyze** with AI (AWS Bedrock Claude) — performance score, compliance flags, sentiment, coaching suggestions
4. **Ground** analysis in your organization's own documentation via RAG knowledge base
5. **Track** agent performance, coaching progress, and team trends over time

## Key Features

- **Multi-tenant SaaS** — self-service registration, per-org data isolation (including PostgreSQL Row-Level Security), team invitations, industry-specific setup (dental, medical, behavioral health, veterinary)
- **AI-powered analysis** — performance scoring (0-10 with sub-scores), compliance checks, sentiment tracking, action items, coaching suggestions
- **Clinical documentation (AI scribe)** — auto-generate SOAP, DAP, BIRP, and procedure notes from call recordings with provider attestation workflow
- **Clinical note amendments** — post-attestation amendment/addendum workflow (medical records compliance), FHIR R4 export, co-signature/supervising provider workflow, structured data extraction (vitals, medications, allergies)
- **Provider style learning** — AI analyzes provider's past notes to learn formatting preferences (abbreviation level, section emphasis, common phrases)
- **Clinical note templates** — 10+ specialty-specific templates (dental, behavioral health, pediatrics, cardiology, dermatology, etc.)
- **EHR integration** — Open Dental (bidirectional), Eaglesoft (read-focused) — patient lookup, appointment sync, clinical note push
- **RAG knowledge base** — upload company docs (handbooks, scripts, SOPs), AI references them during analysis
- **Custom evaluation templates** — per-call-category scoring criteria, required phrases, weighted scoring
- **A/B model testing** — compare AI models side-by-side with cost and latency tracking
- **Spend tracking** — per-call cost breakdown for transcription and AI analysis
- **Coaching system** — create coaching sessions from call analysis, track action plans
- **Role-based access** — viewer / manager / admin with hierarchical permissions
- **SSO** — SAML 2.0 single sign-on (Enterprise plan, per-org IDP configuration)
- **MFA** — TOTP-based multi-factor authentication, optional per-org enforcement
- **Billing** — Stripe integration with Free / Clinical Documentation ($49/mo) / Pro ($99/mo) / Enterprise ($499/mo) tiers
- **HIPAA compliant** — session timeouts, session fixation prevention, audit logging (PHI access on all sensitive endpoints), MFA, PHI field encryption (AES-256-GCM), PostgreSQL Row-Level Security (RLS) on all tenant-scoped tables, per-org KMS envelope encryption, org-scoped rate limiting, data retention, GDPR/CCPA data export and right-to-erasure
- **Learning Management System** — AI-generated training courses from call analysis, lesson tracking
- **Marketing attribution** — UTM parameter tracking, campaign source/medium, ROI calculation
- **Real-time clinical sessions** — Live transcription with AssemblyAI real-time streaming
- **Email management** — Template management, send history, email analytics
- **Super admin** — Platform-level admin (cross-org management) via `SUPER_ADMIN_USERS`
- **Error tracking** — Sentry integration (client + server) with HIPAA-safe PHI sanitization
- **Observability** — OpenTelemetry traces/metrics, WAF middleware, Pino structured logging + Betterstack
- **Data export** — CSV export for calls, employees, and performance data
- **Password reset** — Self-service forgot-password flow via email (SMTP or AWS SES)
- **Webhook-driven transcription** — AssemblyAI webhooks replace polling (set APP_BASE_URL to enable), with speaker identification (agent/patient), custom vocabulary per org, word-level confidence highlighting, language detection, and manual transcript corrections
- **GDPR/CCPA compliance** — per-org data export (right to access) and full data purge (right to erasure) via admin panel
- **Real-time updates** — WebSocket notifications for call processing status
- **CDN-ready** — Static assets with proper cache headers, configurable CDN origin
- **Dark mode** — full dark theme support

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Vite, TailwindCSS, shadcn/ui, Recharts, Wouter, TanStack Query |
| Backend | Express.js, TypeScript (ESM), Node.js |
| Database | PostgreSQL + Drizzle ORM (recommended) or S3 JSON files |
| AI | AWS Bedrock (Claude) |
| Transcription | AssemblyAI |
| RAG | pgvector, Amazon Titan Embed V2, BM25 hybrid search |
| Jobs | BullMQ (Redis-backed) |
| Auth | Passport.js (local + Google OAuth + SAML SSO), MFA (TOTP), session-based |
| Billing | Stripe |
| Logging | Pino + Betterstack |
| Error Tracking | Sentry (client + server) |
| Observability | OpenTelemetry (traces + metrics) |
| Email | AWS SES API or SMTP (Nodemailer) |
| E2E Testing | Playwright (Chromium) |

## Quick Start

### Prerequisites
- Node.js 18+
- (Optional) PostgreSQL 15+ with pgvector extension
- (Optional) Redis 7+

### 1. Install
```bash
git clone <repo-url>
cd observatory-qa
npm install
```

### 2. Configure
```bash
cp .env.example .env
```

**Minimum required** (in-memory storage, no AI — good for exploring the UI):
```env
SESSION_SECRET=any-random-string-here
ASSEMBLYAI_API_KEY=your_key
AUTH_USERS=admin:password123:admin:Admin User:default
```

**Recommended** (PostgreSQL + Bedrock):
```env
SESSION_SECRET=your-secret
ASSEMBLYAI_API_KEY=your_key
AUTH_USERS=admin:SecurePass!:admin:Admin:default

STORAGE_BACKEND=postgres
DATABASE_URL=postgresql://user:pass@localhost:5432/observatory

AWS_ACCESS_KEY_ID=your_key
AWS_SECRET_ACCESS_KEY=your_secret
AWS_REGION=us-east-1

REDIS_URL=redis://localhost:6379
```

### 3. Set up database (if using PostgreSQL)
```bash
# Install pgvector extension (needed for RAG)
psql -d observatory -c "CREATE EXTENSION IF NOT EXISTS vector;"

# Schema auto-syncs on startup (sync-schema.ts creates tables/columns automatically)
# Or manually push schema:
npm run db:push
```

### 4. Run
```bash
npm run dev
```

Open http://localhost:5000. Login with credentials from `AUTH_USERS`.

### 5. (Optional) Start background workers
```bash
npm run workers   # Requires REDIS_URL
```

## Project Structure

```
client/src/
  pages/              # 34 route pages (dashboard, transcripts, clinical, ab-testing, LMS, marketing, etc.)
  components/         # UI components (shadcn/ui + custom)
  lib/                # Utilities (display-utils, error-reporting)

server/
  index.ts            # App entry point
  auth.ts             # Authentication + org context middleware
  routes/             # 36 modular route files (auth, SSO, calls, clinical, ehr, lms, marketing, etc.)
  services/           # AI provider (Bedrock), S3, Redis, RAG, Stripe, EHR adapters, Sentry, telemetry
  middleware/          # WAF, OpenTelemetry tracing
  services/ehr/       # EHR integration adapters (Open Dental, Eaglesoft)
  storage/            # Storage abstraction (PostgreSQL, S3, memory)
  db/                 # Drizzle ORM schema + PostgreSQL storage + auto schema sync
  workers/            # BullMQ worker processes

shared/
  schema.ts           # Zod schemas + TypeScript types (shared client/server)

data/dental/          # Dental-specific reference data (CDT codes, prompt templates)
deploy/ec2/           # EC2 deployment (Caddy, systemd, bootstrap script)
tests/                # 27 unit test files (Node test runner)
tests/e2e/            # 11 Playwright E2E spec files
```

## Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Dev server with Vite HMR (port 5000) |
| `npm run build` | Production build (Vite frontend + esbuild backend) |
| `npm run start` | Start production server |
| `npm run test` | Run unit test suite |
| `npm run test:e2e` | Run Playwright E2E tests |
| `npm run test:e2e:ui` | Open Playwright interactive UI |
| `npm run check` | TypeScript type check |
| `npm run workers` | Start BullMQ workers (requires Redis) |
| `npm run db:push` | Push Drizzle schema to PostgreSQL |
| `npm run db:studio` | Open Drizzle Studio (DB GUI) |
| `npm run db:migrate` | Run database migrations |
| `npm run seed` | Seed sample data |

## Storage Backends

The app supports multiple storage backends, chosen by environment configuration:

| Backend | Config | Best For |
|---------|--------|----------|
| **PostgreSQL** | `STORAGE_BACKEND=postgres` + `DATABASE_URL` | Production SaaS (recommended) |
| **S3** | `S3_BUCKET=your-bucket` | Single-tenant, AWS-native deployments |
| **Memory** | (no config) | Local development only (data lost on restart) |

When using PostgreSQL, add `S3_BUCKET` for audio file storage alongside the database.

## AI Provider

The platform uses AWS Bedrock (Claude) for AI analysis. HIPAA-eligible with BAA. Default model: `claude-sonnet-4-6`.

Configure with `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_REGION`. Per-org model override available via org settings (`bedrockModel`).

**If AI analysis fails** (403 errors, bad credentials), calls still complete with default scores (5.0, neutral sentiment). The UI clearly indicates when AI analysis was unavailable. Common fixes:
- Verify IAM user has `bedrock:InvokeModel` permission
- Ensure Bedrock model access is enabled in your AWS region
- Remove `AWS_SESSION_TOKEN` unless using temporary STS credentials
- Note: `AI_PROVIDER` env var is not used — the code always uses Bedrock

## Plan Tiers

| Feature | Free | Starter ($79/mo) | Professional ($149/mo) | Enterprise ($999/mo) |
|---------|------|-----------------|----------------------|---------------------|
| Calls/month | 50 | 300 | 1,000 | Unlimited |
| Storage | 500 MB | 5 GB | 20 GB | 500 GB |
| Base Seats | 3 | 5 (+$12/seat) | 10 (+$18/seat) | 25 (+$25/seat) |
| RAG Knowledge Base | - | Yes | Yes | Yes |
| Custom Templates | - | Yes | Yes | Yes |
| Clinical Notes (AI Scribe) | - | - | Yes | Yes |
| SSO | - | - | - | Yes |

## Deployment

### EC2 (Production HIPAA)
See [`deploy/ec2/README.md`](deploy/ec2/README.md) for a lean EC2 setup (~$13/month):
- Amazon Linux 2023 + Caddy (auto TLS) + systemd
- IAM instance role for S3 + Bedrock (no hardcoded keys)

### Render.com (Staging)
- Build: `npm run build`
- Start: `npm run start`
- Configure env vars in Render dashboard

## HIPAA Compliance

Observatory QA implements healthcare-grade security controls:

- **Encryption**: TLS in transit (Caddy/Render), encrypted at rest (EBS, S3 SSE, PostgreSQL)
- **Access control**: Role-based permissions, 15-min session idle timeout, account lockout after 5 failed attempts, MFA (TOTP)
- **Audit logging**: Tamper-evident structured JSON logs with integrity hashes for all PHI access
- **PHI encryption**: AES-256-GCM application-level field encryption for sensitive data
- **Data retention**: Auto-purge calls per org policy (configurable, default 90 days)
- **Tenant isolation**: All data access requires org context — cross-org access is structurally impossible. Per-org username uniqueness, org-scoped rate limiting, org-scoped WebSocket broadcasts
- **PostgreSQL Row-Level Security** — Database-level tenant isolation via RLS policies on all 27 tenant-scoped tables, enforced at the PostgreSQL layer independent of application code
- **Per-org KMS encryption** — Envelope encryption with AWS KMS: per-org AES-256 data encryption keys (DEK), encrypted master key stored per org, 30-min cache, graceful fallback to shared PHI_ENCRYPTION_KEY
- **GDPR/CCPA** — Data export (right to access) and full org purge (right to erasure) with confirmation token
- **Security headers**: CSP, HSTS, X-Frame-Options, X-Content-Type-Options, X-XSS-Protection

## Testing

```bash
npm run test
```

27 unit test files covering schemas, routes, multi-tenancy, RBAC, billing, API keys, clinical workflows, EHR, PHI encryption, SSO, and more. Uses Node.js built-in test runner via tsx. Plus 11 Playwright E2E specs for browser-level testing.

### E2E Tests (Playwright)
```bash
npm run test:e2e      # headless Chromium
npm run test:e2e:ui   # interactive browser UI
```
Requires the dev server running on port 5000 (or set `BASE_URL`). Test auth users: `admin/admin123`, `viewer/viewer123`.

## Environment Variables

See [`.env.example`](.env.example) for the full list. Key new additions:
- `EMAIL_PROVIDER=ses` — Use AWS SES API for email (reuses existing AWS credentials)
- `SENTRY_DSN` / `VITE_SENTRY_DSN` — Error tracking (server / client)
- `CDN_ORIGIN` — CDN domain for static asset URLs and CSP headers
- `OTEL_ENABLED=true` — Enable OpenTelemetry traces and metrics
- `SUPER_ADMIN_USERS` — Platform-level admin users (cross-org)
- `ASSEMBLYAI_WEBHOOK_SECRET` — Webhook token verification for AssemblyAI webhooks (falls back to SESSION_SECRET)
- `AWS_KMS_KEY_ID` — AWS KMS CMK ARN for per-org envelope encryption (optional; uses shared key if not set)
- `PHI_ENCRYPTION_KEY` — 64-char hex for AES-256-GCM field-level PHI encryption

## License

MIT
