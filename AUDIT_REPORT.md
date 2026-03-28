# Observatory QA - Comprehensive Codebase Audit Report

**Date**: 2026-03-28
**Codebase**: 327 TypeScript files, ~63,500 LOC
**Tests**: 57 unit test files + 12 E2E specs

---

## Executive Summary

Observatory QA is an ambitious, feature-rich SaaS platform with impressive breadth — spanning call quality analysis, clinical documentation, RAG knowledge base, gamification, insurance narratives, revenue tracking, calibration, LMS, and more. The architecture is well-structured with clear separation of concerns and thoughtful multi-tenant design.

However, the rapid feature expansion has outpaced hardening. The audit identified **~150 issues** across security, correctness, performance, and code quality. The most pressing concerns are in **security infrastructure** (SSO, MFA, audit logging) and **data integrity** (encryption fallbacks, race conditions). HIPAA compliance has solid foundations but meaningful gaps remain in encryption enforcement, audit completeness, and PHI redaction.

---

## Critical Issues (Must Fix)

### 1. ~~PHI Encryption Becomes No-Op When Key Missing~~ FIXED
**File**: `server/services/phi-encryption.ts`
~~`encryptField()` returns plaintext unchanged if `PHI_ENCRYPTION_KEY` is not set.~~
**Fixed**: `encryptField()` now throws in production if key is missing. Dev mode logs a warning. Added `PhiDecryptionContext` audit logging to `decryptClinicalNotePhi()`.

### 2. SSO RelayState CSRF Vulnerability
**File**: `server/routes/sso.ts:239-242`
RelayState is user-controlled. An attacker can craft a SP-initiated request to log into a victim org by manipulating the RelayState parameter during SAML flow.
**Fix**: Store orgSlug in signed session state, not RelayState. Validate orgSlug matches on callback.

### 3. MFA Session ID Spoofing via IP Fallback
**File**: `server/routes/mfa.ts:205`
`sessionId = req.sessionID || req.ip || "unknown"` — falls back to spoofable `req.ip`, allowing attackers to bypass MFA rate limits.
**Fix**: Require cryptographic session ID. Reject if unavailable.

### 4. ~~Audit Log Hash Chain Race Condition~~ FIXED
**File**: `server/services/audit-log.ts`
~~Concurrent `persistAuditEntry()` calls can both compute the same sequence number.~~
**Fixed**: Added per-org promise-chain mutex (`withChainLock()`) to serialize concurrent writes.

### 5. Incident Response Stored In-Memory Only
**File**: `server/services/incident-response.ts:87-89`
Security incidents are stored in a `Map`. Service restart = all incident history lost. Violates HIPAA audit requirements.
**Fix**: Persist to database immediately.

### 6. ~~Upload Slot Resource Leak on Duplicate Files~~ FIXED
**File**: `server/routes/calls.ts`
~~Upload slot was never released on duplicate detection.~~
**Fixed**: Now calls `releaseUploadSlot(orgId)` and returns 409 with `{ duplicate: true, existingCallId }`.

### 7. Per-Org DEK Generation Race Condition
**File**: `server/services/org-encryption.ts:95-99`
Two concurrent requests for a new org can both generate DEKs, overwriting each other. Use a database lock or conditional update.

### 8. WAF ReDoS Vulnerability (mitigated)
**File**: `server/middleware/waf.ts:24`
SQL injection regex patterns with `.*` quantifier. Mitigated by `MAX_SCAN_LENGTH` (100KB) limit on scanned input, but regex patterns could still be improved.

---

## High Severity Issues

### Security
- **Backup code comparison not constant-time** (`mfa.ts`) — timing attack vector
- **TOCTOU race in URL validation** (`url-validation.ts:97-115`) — DNS rebinding SSRF
- **IPv6 link-local bypass incomplete** (`url-validation.ts:50`) — missing ULA ranges
- **Prompt injection bypass via Unicode homoglyphs** (`ai-guardrails.ts:13-29`)
- **Certificate expiry not checked at SSO login** (`sso.ts`) — expired certs still accepted
- **SAML replay possible** with `validateInResponseTo: "IfPresent"` (`sso.ts:271`)
- **Trusted device token format guessable** (`mfa.ts:279`) — userId in cookie
- **Unsafe SQL string interpolation** in sync-schema.ts helper functions

### Data Integrity
- **Empty orgId fallback to ""** in pg-storage.ts:179 — creates degenerate records
- **Unbounded query in getAllCalls** — no LIMIT, potential OOM for large orgs
- ~~**speakerRoleMap logic error**~~ FIXED — now maps `{ A: "agent", B: "customer" }` instead of `{ agentSpeaker: "A" }`
- ~~**Circuit breaker race condition**~~ FIXED — probe slot claim moved into `getCircuitDecision()` for atomic check-and-set
- **NaN propagation** in rate limiter when `checkRateLimit()` returns unexpected structure

### HIPAA Gaps (all items below FIXED)
- ~~**No audit logging for PHI decryption**~~ — FIXED: `decryptClinicalNotePhi()` now logs `PHI_DECRYPT` audit events
- ~~**FAQ analytics logs unredacted query text**~~ — FIXED: sample queries now PHI-redacted via `redactPhi()`
- ~~**Sentry strips all request data**~~ — FIXED: now uses selective `redactPhi()` instead of blanket `[REDACTED]`
- ~~**Auth deserialize swallows exceptions**~~ — FIXED: now logs with `logger.error()`
- ~~**Org suspension check silently fails**~~ — FIXED: now denies with 503 `OBS-AUTH-007`

---

## Medium Severity Issues (Selected)

| Category | Issue | Location |
|----------|-------|----------|
| Performance | Chunker `findNaturalBreak` greedy regex O(n^2) | `chunker.ts:46` |
| Performance | Dashboard recalculates trend data on every render | `dashboard.tsx:94-135` |
| Performance | Coaching engine loads ALL calls then takes 10 | `coaching-engine.ts:53` |
| Performance | Admin reanalysis fires-and-forgets without rate limit | `admin.ts:164-203` |
| Performance | Cleanup interval copies entire Map to Array | `auth.ts:28` |
| Security | WAF logs may contain query params with PHI | `waf.ts:185-192` |
| Security | NPI number stored in plaintext | `clinical.ts:161` |
| Security | SSN regex false positives on 9-digit codes | `phi-redactor.ts:12` |
| ~~UX~~ | ~~Idle timeout "Stay Logged In" button is a no-op~~ FIXED | `App.tsx:312` |
| ~~UX~~ | ~~localStorage.clear() on logout clears preferences~~ FIXED | `use-idle-timeout.ts:31` |
| ~~UX~~ | ~~Upload isUploading never cleared on error~~ (was already correct — finally block clears it) | `upload.tsx:54` |
| ~~UX~~ | ~~Duplicate upload returns 200 instead of 409~~ FIXED — returns 409 + releases upload slot | `calls.ts:228` |
| Code Quality | Duplicate SESSION_ABSOLUTE_MAX_MS constant | `auth.ts:281,473` |
| Code Quality | `as any` type assertions (6 locations) | `auth.ts` |
| ~~Code Quality~~ | ~~Inconsistent flag filtering logic~~ FIXED — all use `some()` | `dashboard.tsx:74-81` |
| ~~Code Quality~~ | ~~display-utils array check after object check~~ FIXED | `display-utils.ts` |

---

## Test Coverage Analysis

### Current Coverage
- **57 unit test files** covering core features
- **12 E2E specs** covering critical user flows
- Good coverage of: schemas, RBAC, multi-tenant isolation, billing, pipeline

### Critical Test Gaps

| Area | Status | Risk |
|------|--------|------|
| Clinical note amendments/cosignature | NOT TESTED | HIPAA compliance |
| SSO certificate rotation | NOT TESTED | Authentication failures |
| MFA grace period enforcement | NOT TESTED | Security bypass |
| Insurance narrative deadlines | NOT TESTED | Business logic |
| Revenue attribution funnel | NOT TESTED | Financial accuracy |
| Calibration blind mode | NOT TESTED | Data leakage |
| Cross-org isolation boundary tests | MINIMAL | Tenant data leak |
| HIPAA audit trail completeness | NOT TESTED | Compliance |
| Email routes | NO TEST FILE | No coverage |
| Live session routes | MINIMAL | Clinical feature |
| Patient journey routes | NO DEDICATED TEST | PHI feature |

### Schema Validation Gaps
- No conditional validation (SSO config dependencies, clinical workflow constraints)
- No format validation for NPI, ICD-10, CPT, CDT codes
- No ISO 8601 timestamp format validation
- No PEM certificate format validation
- `retentionDays` allows 0/negative values (no min/max)
- Insurance codes accepted without format checking

---

## Architecture Observations

### Strengths
1. **Clean multi-tenant design** — orgId enforced at every storage layer + RLS defense-in-depth
2. **Graceful degradation** — every infrastructure dependency has a fallback path
3. **Exceptional documentation** — CLAUDE.md is one of the best project docs I've seen
4. **Defense-in-depth** — PostgreSQL RLS + application-layer isolation + middleware checks
5. **Modular route structure** — 38 route files with clear responsibility separation
6. **Auto schema sync** — eliminates migration tooling pain in production
7. **AI response hardening** — multiple layers of validation and clamping on AI outputs
8. **Comprehensive feature set** — covers the full QA + clinical + billing lifecycle

### Concerns
1. **Feature sprawl** — 34 pages, 38 route files, 30+ services. Maintenance burden is very high
2. **In-memory fallbacks mask production issues** — incident response, OIDC state, email OTP, SCIM token lookup all use in-memory stores that break in multi-instance deployments
3. **Schema sync vs. migrations** — auto-sync is convenient but risky for production data changes (column renames, type changes)
4. ~~**No visible CI/CD pipeline**~~ FIXED — comprehensive GitHub Actions pipeline with lint gate, tests + coverage, security audit + secret scanning, Docker build, E2E tests, quality gate, staging/production deploy
5. **Many features are "90% done"** — impressive breadth but several features lack the final 10% of hardening
6. **`as any` usage** — defeats TypeScript's value proposition in security-critical auth code

---

## Future Recommendations

### Immediate (P0)
1. Fix all 8 critical issues listed above
2. Add `PHI_ENCRYPTION_KEY` validation at startup (fail if missing in production)
3. Implement database persistence for incident response
4. Add constant-time comparison for all secret comparisons

### Short-term (1-2 sprints)
1. Add conditional schema validation with Zod `.superRefine()`
2. Implement proper LRU caches (replace `Map.keys().next()` pattern)
3. Add integration tests for SSO, MFA, and clinical workflows
4. Add `npm audit` to CI/CD pipeline
5. Move OIDC state and email OTP to Redis
6. Type the auth session properly (remove `as any`)

### Medium-term (1-2 months)
1. Extract security middleware into shared library
2. Add OpenTelemetry coverage for all critical paths
3. Implement proper state machine validation for status transitions
4. Add load testing for multi-tenant scenarios
5. Penetration testing for SSO, MFA, WAF

### Long-term
1. SOC 2 Type II preparation
2. Database read replicas for analytics queries
3. Event-sourced audit log with immutable storage (S3 Object Lock)
4. Multi-region deployment for HIPAA disaster recovery
5. Consider microservice extraction (clinical, billing, core)

---

## Dependency Notes

- AWS SDK v3 (`^3.1014.0`) — consider pinning exact versions for production stability
- `@types/express` pinned without `^` — may cause type drift
- ~~No `npm audit` in CI/CD pipeline~~ FIXED — security job runs `npm audit --audit-level=high` + secret scanning
- ~~No `engines` field in package.json~~ FIXED — added `engines` (node>=20, npm>=10) + `.nvmrc`
- Passport `^0.7.0` — verify latest security patches applied
