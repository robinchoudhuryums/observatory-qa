# Observatory QA — Comprehensive Codebase Audit Report

**Date**: 2026-03-22
**Codebase size**: ~60,000 lines (28.5k server, 23.8k client, 6.8k tests, 1.4k shared)
**Languages**: TypeScript (100%)

---

## Executive Summary

Observatory QA is an ambitious multi-tenant SaaS platform that has evolved rapidly from a single-tenant internal tool into a feature-rich product spanning call quality analysis, clinical documentation, EHR integration, and more. The architecture is thoughtful with strong HIPAA foundations, but the rapid feature expansion has introduced some technical debt, a critical CSRF bug, documentation drift, and scalability concerns that should be addressed before production healthcare deployments.

---

## Critical Issues (Must Fix)

### 1. CSRF Protection is Broken — Client Never Sends Token
**Severity**: Critical
**Location**: `server/index.ts:186-222` (server CSRF middleware) + `client/src/lib/queryClient.ts:10-24` (client apiRequest)

The server implements double-submit cookie CSRF protection requiring an `X-CSRF-Token` header on all mutation requests (POST/PATCH/DELETE/PUT). However, the client's `apiRequest()` function **never reads the csrf-token cookie or sends the X-CSRF-Token header**. This means:

- Either all POST/PATCH/DELETE mutations from the browser are silently failing with 403 (app is broken)
- Or the CSRF middleware was added after the app was built and was never properly integrated

**Fix**: Add CSRF token handling to `apiRequest()`:
```typescript
function getCsrfToken(): string {
  const match = document.cookie.match(/csrf-token=([^;]+)/);
  return match ? match[1] : "";
}

export async function apiRequest(method: string, url: string, data?: unknown): Promise<Response> {
  const headers: Record<string, string> = {};
  if (data) headers["Content-Type"] = "application/json";
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    headers["X-CSRF-Token"] = getCsrfToken();
  }
  // ... rest of fetch
}
```

### 2. Super-Admin Stats Loads All Data Into Memory
**Severity**: High (DoS vector)
**Location**: `server/routes/super-admin.ts:19-57`, lines 65-102

The `/api/super-admin/stats` and `/api/super-admin/organizations` endpoints call `storage.getAllCalls(org.id)` for **every organization**, loading all call records into memory just to count them. With 100 orgs averaging 1,000 calls each, this loads 100K records per request.

**Fix**: Add a `getCallCount(orgId)` method to the storage interface that does `SELECT COUNT(*) FROM calls WHERE org_id = $1`.

### 3. CLAUDE.md Documentation Drift — "No AWS SDK" Claim is False
**Severity**: Medium (misleading for contributors)
**Location**: `CLAUDE.md:850`

CLAUDE.md states: *"No AWS SDK: S3, Bedrock, and Titan Embed all use raw REST APIs with manual SigV4 signing"*

This is false. The codebase uses:
- `@aws-sdk/client-bedrock-runtime` in `server/services/bedrock.ts`
- `@aws-sdk/client-s3` in `server/services/s3.ts`
- `@aws-sdk/client-ses` in `server/services/email.ts`
- `@aws-sdk/credential-providers` across multiple files

---

## High Priority Issues

### 4. No Input Sanitization on Super-Admin Org Settings Update
**Location**: `server/routes/super-admin.ts:158-200`

The `PATCH /api/super-admin/organizations/:id` endpoint merges `req.body.settings` directly into org settings with only a `typeof settings === "object"` check. An attacker with super-admin access could inject arbitrary nested objects, potentially overwriting SSO config, EHR credentials, or other sensitive settings.

**Fix**: Validate settings against `orgSettingsSchema` from shared/schema.ts.

### 5. In-Memory Rate Limiting is Per-Instance Only
**Location**: `server/index.ts:29-75`

When Redis is unavailable, rate limiting falls back to in-memory `Map`. In a multi-instance deployment (load balancer), each instance has its own counter, effectively multiplying the rate limit by the number of instances.

The code does warn about this, but in production healthcare, this could allow brute-force attacks through load balancer distribution.

### 6. Login Lockout is Username-Based, Not IP-Based
**Location**: `server/auth.ts:18-53`

Account lockout tracks by username only (`loginAttempts` Map keyed by username). An attacker can lock out any user by sending 5 failed login attempts from any IP. The rate limiter on the login endpoint helps (5 per IP per 15 min), but an attacker with multiple IPs can still DoS specific accounts.

**Fix**: Track lockout by `username:ip` compound key, or add CAPTCHA after N failed attempts.

### 7. Missing File Type Validation on Audio Upload
**Location**: `server/routes/calls.ts:682`

The upload endpoint accepts any file through multer without validating the MIME type or file extension. While AssemblyAI will reject non-audio files, the file is still written to disk and potentially archived to S3 before rejection.

**Fix**: Add multer `fileFilter` to whitelist audio MIME types (audio/mpeg, audio/wav, audio/mp4, audio/flac, etc.).

### 8. Reference Doc Cache Not Invalidated on Document Upload
**Location**: `server/routes/calls.ts:27-52`

The `refDocCache` has a 5-minute TTL, but the `invalidateRefDocCache()` export is only called from within calls.ts. When reference documents are uploaded/deleted via onboarding routes, the cache isn't invalidated — stale data persists for up to 5 minutes.

---

## Medium Priority Issues

### 9. getAllCalls() Used for Counting in Multiple Routes
**Location**: `server/routes/gamification.ts:23`, `server/routes/revenue.ts:108`, `server/routes/emails.ts:225`

Multiple routes load all calls into memory when they only need counts or filtered subsets. This pattern won't scale beyond ~10K calls per org.

### 10. No Pagination on Several List Endpoints
**Location**: Various routes including `gamification.ts`, `revenue.ts`, `insurance-narratives.ts`

Several endpoints return unbounded result sets without pagination (limit/offset). As data grows, these will become slow and memory-intensive.

### 11. WebSocket Has No Authentication
**Location**: `server/services/websocket.ts`

Need to verify — WebSocket connections should validate session cookies before accepting connections. Broadcasting requires orgId, which is good for data isolation, but unauthenticated WebSocket connections could consume resources.

### 12. Replit Dev Dependencies in Production Bundle
**Location**: `package.json:116-118`

Three Replit-specific dev dependencies are present:
- `@replit/vite-plugin-cartographer`
- `@replit/vite-plugin-dev-banner`
- `@replit/vite-plugin-runtime-error-modal`

These are devDependencies so they won't affect production, but they suggest the project originated on Replit and these should be cleaned up for a production HIPAA deployment.

### 13. Missing Index on Frequently Queried Columns
Need to verify these indexes exist in `sync-schema.ts`:
- `calls.file_hash` (used for dedup on every upload)
- `calls.employee_id` (used in gamification, coaching, reports)
- `usage_events.created_at` (used in billing calculations)

### 14. Error Messages Could Leak Information
**Location**: `server/index.ts:337-347`

The error handler correctly hides details for 5xx errors but exposes the error message for 4xx errors. If any middleware or route handler throws an error with sensitive details in the message, it would be exposed to the client.

---

## Low Priority / Code Quality Issues

### 15. Inconsistent Error Response Patterns
Some routes use `errorResponse(ERROR_CODES.X, "message")` from the error-codes system, while others use plain `{ message: "..." }`. The error-codes system is well-designed but only partially adopted.

### 16. TypeScript `as any` Casts
Multiple instances of `as any` casts throughout the codebase, particularly in storage-related code and route handlers. These bypass TypeScript's type safety.

### 17. `@types/qrcode` in Dependencies (Not devDependencies)
**Location**: `package.json:68`

Type definitions should be in devDependencies.

### 18. No CI/CD Configuration
No `.github/workflows/`, `Jenkinsfile`, or equivalent CI configuration found. For a HIPAA-compliant product, automated testing on every PR is essential.

### 19. Test Files Excluded from Type Checking
**Location**: `tsconfig.json:3`

`"exclude": ["**/*.test.ts"]` means tests don't get type-checked by `npm run check`. Type errors in tests would go unnoticed until runtime.

---

## Architecture Strengths

1. **Robust multi-tenant isolation**: Every data access method requires `orgId` as the first parameter — cross-tenant data leakage is structurally prevented at the storage interface level
2. **Tamper-evident audit logging**: SHA-256 hash chain with sequence numbers makes audit log tampering detectable
3. **PHI encryption**: AES-256-GCM field-level encryption with versioned prefix (`enc_v1:`) for future key rotation
4. **Graceful degradation**: Every infrastructure dependency has a fallback — Redis, PostgreSQL, S3, Bedrock all degrade gracefully
5. **HIPAA security headers**: Comprehensive CSP, HSTS, X-Frame-Options, anti-MIME-sniffing
6. **Auto schema sync**: `sync-schema.ts` eliminates migration tooling in production — pragmatic for rapid iteration
7. **AI response hardening**: Score clamping, type validation, safe defaults prevent AI hallucination from corrupting data
8. **Strong password policy**: 12+ chars with complexity requirements for HIPAA
9. **Rate limiting with org-scoping**: Prevents one tenant's usage from blocking another
10. **Empty transcript guard**: Prevents generating junk analysis from silence/noise

---

## Ratings

### 1. Viability as a Company: 7/10

**Strengths**:
- Addresses a real, validated market need (call center QA is a $2B+ market)
- Multi-vertical approach (dental, medical, behavioral health) expands TAM
- Feature breadth is impressive — covers the full lifecycle from upload to coaching
- Healthcare clinical documentation add-on creates a sticky, high-value upsell
- Pricing is reasonable with clear tier differentiation
- Multi-tenant architecture enables true SaaS economics

**Concerns**:
- Feature breadth may be too wide too early — 34 pages, 36 route files. Suggests "build everything" over "nail one thing"
- Gamification, marketing attribution, LMS, insurance narratives, and email management feel like scope creep from the core QA value prop
- No evidence of customer validation metrics (retention, NPS, MRR) in the codebase
- Single developer/small team risk (no CI/CD, no code review process)
- HIPAA compliance requires BAA with all vendors + formal security assessment before enterprise sales
- Competition from established players (Observe.AI, CallMiner, NICE) means go-to-market speed matters

### 2. Core Product — Call Quality Analysis: 8/10

**Strengths**:
- End-to-end pipeline: upload → transcription → AI analysis → coaching is well-implemented
- RAG system grounds AI analysis in org-specific documentation
- Custom prompt templates per call category
- Performance scoring with server-side validation and calibration
- Employee auto-assignment from detected names
- Webhook notifications for flagged calls
- Duplicate detection via file hash

**Gaps**:
- No real-time streaming transcription for live calls (AssemblyAI real-time routes exist but are thin)
- No speaker diarization in the transcript viewer
- No call recording (only upload existing recordings)
- Batch reanalysis exists but no A/B testing between prompt template versions

### 3. Clinical Documentation (AI Scribe): 6.5/10

**Strengths**:
- Multi-format note generation (SOAP, DAP, BIRP, HPI, procedure)
- Provider attestation workflow
- Style learning from previous notes
- PHI field encryption
- Clinical validation and completeness scoring

**Gaps**:
- EHR integrations are adapter stubs — Open Dental and Eaglesoft adapters need real-world testing
- No FHIR support (the standard for healthcare interoperability)
- Clinical templates are in-memory, not customizable per org
- No HL7 v2 integration path
- Missing clinical coding validation (ICD-10, CPT code verification)

### 4. HIPAA Compliance: 7.5/10

**Strong**:
- Session management (15-min idle timeout, secure cookies, session regeneration)
- Account lockout (5 failed attempts → 15-min lockout)
- Structured audit logging with tamper-evident hash chain
- PHI encryption at rest (AES-256-GCM)
- HTTPS enforcement in production
- Security headers (CSP, HSTS, X-Frame-Options)
- Rate limiting on auth endpoints
- Password complexity requirements (12+ chars)
- MFA support (TOTP)
- Data retention purge (per-org configurable)
- WAF (SQL injection, XSS, path traversal detection)

**Gaps**:
- **CSRF protection is broken** (critical — see Issue #1)
- No BAA documentation/tracking for vendors (AssemblyAI, AWS, Stripe)
- No formal risk assessment or security policy documentation
- No automatic session termination after password change
- No IP allowlisting for admin/clinical routes
- PHI encryption key management is env-var-only (should use KMS/Vault in production)
- No data loss prevention (DLP) — PHI could be exported via CSV without additional controls
- Audit logs don't capture data export events separately
- No penetration test evidence
- MFA is opt-in (should be mandatory for clinical users at minimum)

### 5. UI/UX: 7/10

**Strengths**:
- Clean, modern design with shadcn/ui + Tailwind
- Dark mode support
- Custom branding per org (colors, logo)
- Onboarding tour for new users
- Feedback widget (floating button with page context)
- Responsive layout with sidebar navigation
- Loading states with custom owl animation
- Error boundaries for graceful failure

**Concerns**:
- 34 pages is a LOT of surface area — likely overwhelming for new users
- No evidence of user research or usability testing
- Navigation hierarchy may be confusing (clinical docs, insurance narratives, gamification, LMS, marketing all in one app)
- No keyboard navigation or accessibility audit results
- No internationalization (i18n) support despite noting Spanish language as a roadmap item

### 6. Code Quality: 7/10

**Strengths**:
- TypeScript strict mode enabled
- Consistent project structure (routes/services/storage separation)
- Well-documented CLAUDE.md with comprehensive architecture overview
- Shared Zod schemas for client/server validation
- Error code system (OBS-{DOMAIN}-{NUMBER})
- Memory-bounded caches with TTL and max-entry limits
- Proper cleanup on errors (file deletion, status updates)

**Concerns**:
- `as any` casts scattered throughout
- Tests excluded from type checking
- No CI/CD pipeline
- CLAUDE.md has factual errors (AWS SDK claim)
- Inconsistent error response patterns (error-codes vs plain objects)
- Some routes load entire datasets into memory
- Dev dependencies from Replit still present

### 7. Testing: 5.5/10

**Strengths**:
- 27 unit test files covering major features
- 11 E2E test specs covering critical flows
- Tests cover security-critical areas (RBAC, multi-tenant isolation, PHI encryption, audit logging)

**Concerns**:
- No CSRF testing
- Tests excluded from type checking
- No test coverage measurement
- No integration tests (testing routes with real database)
- E2E tests likely require manual dev server startup
- No CI/CD means tests may not run regularly
- Missing tests for: WebSocket behavior, rate limiting, file upload validation, concurrent access

### 8. Scalability: 5/10

**Strengths**:
- PostgreSQL + pgvector is a solid foundation
- BullMQ for background jobs with retry
- Redis for distributed sessions and rate limiting
- Reference doc cache with TTL

**Concerns**:
- `getAllCalls()` loaded into memory across many routes
- No pagination on several list endpoints
- Super-admin stats is O(N*M) where N=orgs, M=calls — gets worse with growth
- No connection pooling configuration visible
- No database query optimization (no EXPLAIN plans, no query logging)
- No CDN for audio file serving (streams through Node.js)
- Single-process architecture (no clustering, no horizontal scaling plan)
- In-memory caches don't work across instances

### 9. DevOps & Operations: 4.5/10

**Strengths**:
- EC2 deployment guide with Caddy + systemd
- Render.com staging configuration
- Pino structured logging + Betterstack
- Sentry error tracking (both client and server)
- OpenTelemetry instrumentation (opt-in)
- Graceful shutdown handlers

**Concerns**:
- No CI/CD configuration at all
- No Dockerfile (containerization)
- No infrastructure-as-code (Terraform, CloudFormation)
- No health check endpoint monitoring configuration
- No automated backup strategy documented
- No disaster recovery plan
- No load testing results or performance benchmarks
- No staging/production environment parity documentation
- No secrets management (everything via env vars)

---

## Recommended Priority Actions

### Immediate (Before Any Production Healthcare Deployment)
1. **Fix CSRF token integration** in the client
2. **Add `getCallCount()` to storage interface** — stop loading all calls into memory
3. **Set up CI/CD** with automated tests on every PR
4. **Conduct formal HIPAA security assessment**
5. **Document and execute BAA agreements** with AssemblyAI, AWS, Stripe

### Short-Term (Next 1-2 Sprints)
6. **Add pagination** to all list endpoints
7. **Validate super-admin settings updates** against Zod schema
8. **Add file type validation** on audio upload
9. **Add CSRF token to E2E tests** and fix any broken flows
10. **Containerize the application** (Dockerfile)
11. **Set up proper secrets management** (AWS Secrets Manager or similar)

### Medium-Term (Next Quarter)
12. **Focus the product** — consider which features are core vs. nice-to-have
13. **Add FHIR support** for EHR integrations (essential for healthcare adoption)
14. **Implement horizontal scaling** — extract in-memory caches to Redis, add clustering
15. **Add comprehensive integration tests**
16. **Implement proper key management** for PHI encryption (KMS/Vault)

### Long-Term
17. **SOC 2 Type II certification** (table stakes for enterprise healthcare sales)
18. **Performance benchmarking and optimization**
19. **Internationalization framework**
20. **Disaster recovery testing**

---

## Summary

Observatory QA is an impressive engineering effort with a strong architectural foundation. The multi-tenant data isolation, HIPAA-aware security controls, and AI analysis pipeline are well-implemented. The platform's breadth — spanning QA, clinical docs, EHR, gamification, LMS, marketing, and more — demonstrates ambitious vision but may benefit from strategic focus.

The most critical issue is the broken CSRF integration, followed by memory-scaling concerns in data-loading patterns. Addressing these, along with establishing CI/CD and proper HIPAA documentation, would significantly strengthen the product's readiness for production healthcare deployments.

**Overall Project Score: 6.5/10** — Strong foundation with clear gaps in operational maturity and production readiness. With focused effort on the critical issues and DevOps infrastructure, this could move to 8+ within a quarter.
