import { defineConfig } from "@playwright/test";
import path from "path";

const adminAuthFile = path.resolve(__dirname, ".auth", "admin.json");
const viewerAuthFile = path.resolve(__dirname, ".auth", "viewer.json");

export default defineConfig({
  testDir: ".",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "html",
  timeout: 30_000,

  // Log in once before all tests, saving auth state to .auth/ files
  globalSetup: "./global-setup.ts",

  use: {
    baseURL: process.env.BASE_URL || "http://localhost:5000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    viewport: { width: 1280, height: 720 },
  },

  webServer: process.env.CI
    ? {
        command: "npm run start",
        port: 5000,
        timeout: 60_000,
        reuseExistingServer: false,
        env: {
          NODE_ENV: "production",
          PORT: "5000",
          DISABLE_SECURE_COOKIE: "true",
          SESSION_SECRET: "e2e-test-secret",
          ASSEMBLYAI_API_KEY: "test-key",
          AUTH_USERS: "admin:admin123:admin:Test Admin:default,viewer:viewer123:viewer:Test Viewer:default",
          E2E_TESTING: "true",
        },
      }
    : undefined,

  projects: [
    {
      name: "admin",
      use: {
        browserName: "chromium",
        storageState: adminAuthFile,
      },
      // Run all specs except those that need unauthenticated or viewer access
      testIgnore: /\b(api-health|auth|rbac)\b/,
    },
    {
      name: "viewer",
      use: {
        browserName: "chromium",
        storageState: viewerAuthFile,
      },
      testMatch: /rbac\.spec\.ts/,
    },
    {
      name: "unauthenticated",
      use: {
        browserName: "chromium",
        // No storageState — fresh context without cookies
      },
      testMatch: /(api-health|auth)\.spec\.ts/,
    },
  ],
});
