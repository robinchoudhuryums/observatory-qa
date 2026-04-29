import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "html",
  timeout: 60_000,
  expect: { timeout: 15_000 },

  use: {
    baseURL: process.env.BASE_URL || "http://localhost:5000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    viewport: { width: 1280, height: 720 },
    actionTimeout: 15_000,
  },

  webServer: process.env.CI
    ? {
        command: "npm run start",
        port: 5000,
        timeout: 90_000,
        reuseExistingServer: false,
        env: {
          NODE_ENV: "production",
          PORT: "5000",
          DISABLE_SECURE_COOKIE: "true",
          SESSION_SECRET: "e2e-test-secret-32plus-chars-required-by-prod-env-validator",
          ASSEMBLYAI_API_KEY: "test-key",
          AUTH_USERS: "admin:admin123:admin:Test Admin:default,viewer:viewer123:viewer:Test Viewer:default",
          PHI_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          E2E_TESTING: "true",
          // Forward PG/Redis env vars from CI runner into the webServer.
          // When unset, the server falls back to MemStorage + in-memory ratelimit
          // (current behavior). When set, the server runs against real PostgreSQL
          // — this is the path the e2e-postgres CI job exercises so we catch
          // RLS, transaction, and PG-only bugs before they hit production.
          ...(process.env.DATABASE_URL ? { DATABASE_URL: process.env.DATABASE_URL } : {}),
          ...(process.env.STORAGE_BACKEND ? { STORAGE_BACKEND: process.env.STORAGE_BACKEND } : {}),
          ...(process.env.REDIS_URL ? { REDIS_URL: process.env.REDIS_URL } : {}),
        },
      }
    : undefined,

  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
      // Exclude setup file from test matching
      testIgnore: /auth\.setup\.ts/,
    },
  ],
});
