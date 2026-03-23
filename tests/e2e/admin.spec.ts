import { test, expect } from "@playwright/test";
import { login } from "./helpers";

test.describe("Admin Settings", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("admin page loads for admin user", async ({ page }) => {
    await page.goto("/admin");
    // Admin page should show user management
    const content = page.getByText(/user|manage|admin|team/i).first();
    await expect(content).toBeVisible({ timeout: 10000 });
  });

  test("settings page loads", async ({ page }) => {
    await page.goto("/admin/settings");
    // Should show settings tabs or content
    const content = page.getByText(/settings|organization|billing|branding|preferences/i).first();
    await expect(content).toBeVisible({ timeout: 10000 });
  });

  test("prompt templates page loads for admin", async ({ page }) => {
    await page.goto("/admin/templates");
    const content = page.getByText(/prompt|template|evaluation|category/i).first();
    await expect(content).toBeVisible({ timeout: 10000 });
  });

  test("A/B testing page loads for admin", async ({ page }) => {
    await page.goto("/admin/ab-testing");
    const content = page.getByText(/a\/b|model|test|comparison|upload/i).first();
    await expect(content).toBeVisible({ timeout: 10000 });
  });

  test("spend tracking page loads", async ({ page }) => {
    await page.goto("/admin/spend-tracking");
    const content = page.getByText(/spend|cost|usage|track/i).first();
    await expect(content).toBeVisible({ timeout: 10000 });
  });

  test("audit logs page loads", async ({ page }) => {
    await page.goto("/admin/audit-logs");
    const content = page.getByText(/audit|log|event|activity/i).first();
    await expect(content).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Admin API Access Control", () => {
  test("admin endpoints reject unauthenticated requests", async ({ playwright }) => {
    // Create a fresh request context with NO cookies to ensure unauthenticated
    const apiContext = await playwright.request.newContext({
      baseURL: process.env.BASE_URL || "http://localhost:5000",
    });

    try {
      // Use actual API routes (not /api/admin/users which doesn't exist)
      const endpoints = [
        "/api/users",
        "/api/prompt-templates",
        "/api/api-keys",
        "/api/billing/subscription",
      ];

      for (const endpoint of endpoints) {
        const response = await apiContext.get(endpoint);
        expect(response.status()).toBe(401);
      }
    } finally {
      await apiContext.dispose();
    }
  });

  test("viewer cannot access admin endpoints", async ({ playwright }) => {
    const apiContext = await playwright.request.newContext({
      baseURL: process.env.BASE_URL || "http://localhost:5000",
    });

    try {
      // Login as viewer
      const loginResponse = await apiContext.post("/api/auth/login", {
        data: { username: "viewer", password: "viewer123" },
      });
      expect(loginResponse.status()).toBe(200);

      // Admin endpoints should be forbidden
      const response = await apiContext.get("/api/users");
      expect([401, 403]).toContain(response.status());
    } finally {
      await apiContext.dispose();
    }
  });
});
