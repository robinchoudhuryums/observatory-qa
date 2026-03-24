# E2E Test Mocking Strategy

This document describes how external services are mocked in Observatory QA's
Playwright E2E test suite and explains when each strategy should be used.

---

## Overview

E2E tests run against a live dev server (`npm run dev`) with real Express routes
and a real in-memory (or PostgreSQL test) storage backend. External services
(AssemblyAI, AWS Bedrock, Stripe, S3, Redis) are **not called** during E2E tests.
Instead, each service is replaced by one of the strategies below.

```
Browser (Playwright) → Express server → MemStorage
                                      ↳ AI: env-var gate (no key = skip)
                                      ↳ AssemblyAI: intercepted at route layer
                                      ↳ Stripe: env-var gate (no key = test mode)
                                      ↳ S3: disabled (no S3_BUCKET set)
                                      ↳ Redis: disabled (no REDIS_URL set)
```

---

## Required Environment Variables

Set these in `.env.test` or Playwright's `env` block in `playwright.config.ts`:

```bash
# Auth (always required)
AUTH_USERS="admin:admin123:admin:Admin User:default,viewer:viewer123:viewer:Viewer User:default"
SESSION_SECRET="e2e-test-secret-not-for-production"

# Storage — in-memory, no external dependencies
STORAGE_BACKEND="memory"

# Disable external services
# AWS_ACCESS_KEY_ID not set → Bedrock skipped, calls complete with default scores
# S3_BUCKET not set → audio files not archived (warning logged, test continues)
# REDIS_URL not set → in-memory sessions, no job queue
# STRIPE_SECRET_KEY not set → billing UI shows, checkout/webhook skipped
```

---

## Service-by-Service Strategy

### 1. AssemblyAI (Transcription)

**Strategy**: Route-level interception via `ASSEMBLYAI_API_KEY` check.

If `ASSEMBLYAI_API_KEY` is set, the real API is called — **not suitable for CI**.

For E2E tests, set a mock key and stub the transcription response:

```bash
ASSEMBLYAI_API_KEY="test_mock_key_for_e2e"
```

The transcription service detects this key and can be swapped for a test fixture
via `ASSEMBLYAI_MOCK_RESPONSE_PATH` pointing to a JSON file:

```json
{
  "status": "completed",
  "text": "Hello, thank you for calling. How can I help you today?",
  "confidence": 0.95,
  "words": [
    { "text": "Hello", "start": 0, "end": 500, "confidence": 0.98 }
  ]
}
```

**When to use real API**: Smoke tests against staging only. Never in CI unit/E2E suite.

---

### 2. AWS Bedrock (AI Analysis)

**Strategy**: Key absence → graceful degradation.

When `AWS_ACCESS_KEY_ID` is **not set**, the AI analysis step is skipped:
- Call is saved with `confidenceFactors.aiAnalysisCompleted = false`
- Performance score defaults to `5.0` (neutral)
- An amber "AI analysis unavailable" banner appears in the transcript view

E2E tests that need AI data should pre-seed call analyses directly via the API:

```typescript
// In test setup — bypass upload, inject analysis directly
const analysisResp = await page.request.post("/api/calls/upload", {
  // Use a 1-second silence MP3 fixture from tests/fixtures/
  multipart: { audioFile: { name: "silence.mp3", mimeType: "audio/mpeg", buffer: ... } }
});
```

For tests asserting on analysis content, seed via storage helper (unit tests) or
accept the default 5.0 score in E2E.

---

### 3. Stripe (Billing)

**Strategy**: Webhook replay + test mode price IDs.

**Checkout**: Set `STRIPE_SECRET_KEY=sk_test_...` + Stripe test mode. CI uses
Stripe's test clock to simulate subscription events without real payment.

**Webhooks**: Use Playwright's `page.request` to POST a pre-built Stripe event
payload directly to `/api/billing/webhook` with a mock signature:

```typescript
// Replaying a checkout.session.completed event
await page.request.post("/api/billing/webhook", {
  headers: {
    "stripe-signature": generateTestSignature(payload, STRIPE_WEBHOOK_SECRET),
    "content-type": "application/json",
  },
  data: JSON.stringify({
    type: "checkout.session.completed",
    data: { object: { metadata: { orgId: "default" }, subscription: "sub_test" } },
  }),
});
```

**For plan-gated UI tests**: Set the org's subscription directly via MemStorage
in the test setup hook (see `tests/e2e/fixtures.ts` extensions).

---

### 4. S3 (Audio Storage)

**Strategy**: Disabled — no `S3_BUCKET` env var.

When `S3_BUCKET` is not set, audio upload skips S3 archival with a warning log.
The file is processed in-memory and then garbage collected.

E2E tests that test audio playback use a fixture file served from a local path.
The `GET /api/calls/:id/audio` endpoint streams from disk (local path stored on
the call record) when S3 is unavailable.

---

### 5. Redis (Sessions / Rate Limiting / Job Queue)

**Strategy**: In-memory fallback — no `REDIS_URL` env var.

Without Redis:
- Sessions are stored in-memory (single-process, lost on restart — fine for tests)
- Rate limiting uses in-memory Map (resets on restart)
- BullMQ job processing falls back to in-process execution (synchronous-ish)
- WebSocket pub/sub is single-instance (no cross-process broadcasting)

This fallback is fully functional for E2E tests.

---

### 6. Email (SES / SMTP)

**Strategy**: Console fallback — no `SMTP_HOST` or `EMAIL_PROVIDER` set.

When no email provider is configured, `sendEmail()` logs the email to console
with `[EMAIL_CONSOLE]` prefix. This is always enabled in test environments.

To assert that an email was "sent" in E2E, check server logs or instrument the
email service with a test listener via env var `EMAIL_TEST_CAPTURE=true`.

---

## Playwright Fixtures Pattern

**File: `tests/e2e/fixtures.ts`**

All authenticated E2E tests use custom fixtures that handle login automatically:

```typescript
import { test as base, expect } from "@playwright/test";

// Admin fixture — full access
export const adminTest = base.extend({
  page: async ({ page }, use) => {
    const resp = await page.request.post("/api/auth/login", {
      data: { username: "admin", password: "admin123" },
    });
    if (resp.status() !== 200) throw new Error(`Login failed: ${resp.status()}`);
    await resp.json(); // Finalize cookie storage
    await use(page);
  },
});

// Manager fixture — can edit, cannot manage users
export const managerTest = base.extend({
  page: async ({ page }, use) => {
    const resp = await page.request.post("/api/auth/login", {
      data: { username: "manager", password: "manager123" },
    });
    await resp.json();
    await use(page);
  },
});

// Viewer fixture — read-only
export const viewerTest = base.extend({
  page: async ({ page }, use) => {
    const resp = await page.request.post("/api/auth/login", {
      data: { username: "viewer", password: "viewer123" },
    });
    await resp.json();
    await use(page);
  },
});

export { expect };
```

---

## Test Data Seeding

Pre-seeding call data for tests that need existing calls (e.g. transcript viewer,
reports, coaching sessions) is done via direct API calls in the fixture:

```typescript
// Extended fixture with seeded call data
export const adminTestWithData = base.extend({
  page: async ({ page }, use) => {
    // Login
    await page.request.post("/api/auth/login", {
      data: { username: "admin", password: "admin123" },
    }).then(r => r.json());

    // Upload a test fixture (pre-recorded silence + pre-seeded analysis)
    // OR use a dedicated test-data seeding endpoint
    await page.request.post("/api/test/seed", {
      data: { calls: 5, employees: 3 },
    });

    await use(page);

    // Cleanup (optional — MemStorage resets on server restart)
    await page.request.post("/api/test/reset");
  },
});
```

**Note**: The `/api/test/seed` and `/api/test/reset` endpoints are only registered
when `NODE_ENV=test`. They are gated by `requireSuperAdmin` middleware so they
cannot be accidentally triggered in production.

---

## Intercepting Fetch in E2E Tests

For tests that need to assert on outgoing HTTP calls (e.g. webhook delivery),
use Playwright's `page.route()` to intercept:

```typescript
test("webhook is sent when call is flagged", async ({ page }) => {
  let webhookPayload: unknown;

  // Intercept outgoing webhook POST
  await page.route("https://hooks.slack.com/**", async (route) => {
    webhookPayload = JSON.parse(route.request().postData() || "{}");
    await route.fulfill({ status: 200, body: "ok" });
  });

  // Trigger upload that produces a low_score flag
  // ... upload fixture + wait for processing ...

  // Assert webhook was called
  expect(webhookPayload).toBeTruthy();
  expect((webhookPayload as any).text).toContain("Low Score");
});
```

---

## CI Configuration (`playwright.config.ts`)

```typescript
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  use: {
    baseURL: "http://localhost:5000",
    // Extra HTTP headers for test identification
    extraHTTPHeaders: { "X-Test-Run": "e2e" },
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:5000/api/health",
    reuseExistingServer: !process.env.CI,
    env: {
      NODE_ENV: "test",
      STORAGE_BACKEND: "memory",
      SESSION_SECRET: "e2e-test-secret",
      AUTH_USERS: "admin:admin123:admin:Admin User:default,viewer:viewer123:viewer:Viewer User:default",
      // External services disabled
      DISABLE_SECURE_COOKIE: "true",
    },
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
  ],
  reporter: process.env.CI ? "github" : "html",
});
```

---

## What Not to Mock

These should **not** be mocked in E2E tests:

| Component | Reason |
|-----------|--------|
| Express routes | The main thing under test |
| MemStorage | Fast, deterministic, no side effects |
| Passport.js auth | Test the real auth middleware |
| Zod validation | Test real validation errors |
| RBAC middleware | Critical security — must be real |
| Session management | Must use real session store |

---

## When to Write Unit vs E2E Tests

| Scenario | Test Type | Reason |
|----------|-----------|--------|
| Business logic (scoring, flag rules) | Unit | Fast, deterministic |
| Multi-org data isolation | Unit | MemStorage is sufficient |
| PHI encryption/decryption | Unit | No browser needed |
| Auth flow (login, logout, MFA) | E2E | Requires browser cookies |
| File upload dropzone interaction | E2E | Requires real drag-and-drop |
| RBAC: button visibility per role | E2E | Requires rendered UI |
| API response shape | Unit | Direct HTTP testing |
| Webhook retry logic | Unit | No browser needed |
| Plan-gated feature visibility | E2E | Requires real UI rendering |
| Clinical note attestation flow | E2E | Multi-step browser workflow |
