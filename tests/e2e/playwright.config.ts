import { defineConfig } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
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
    // Setup project: logs in via real browser and saves auth state
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: "admin",
      dependencies: ["setup"],
      use: {
        browserName: "chromium",
        storageState: adminAuthFile,
      },
      // Run all specs except setup, unauthenticated, viewer, or isolated access
      testIgnore: /\b(api-health|auth|rbac|logout)\b/,
    },
    {
      name: "viewer",
      dependencies: ["setup"],
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
      },
      testMatch: /(api-health|auth)\.spec\.ts/,
    },
    {
      name: "logout",
      dependencies: ["admin"],
      use: {
        browserName: "chromium",
      },
      testMatch: /logout\.spec\.ts/,
    },
  ],
});
