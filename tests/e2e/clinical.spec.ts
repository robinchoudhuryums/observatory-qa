import { test, expect } from "@playwright/test";
import { login } from "./helpers";

test.describe("Clinical Documentation", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("clinical dashboard loads", async ({ page }) => {
    await page.goto("/clinical");
    // Should see the clinical dashboard or a plan upgrade prompt
    const hasContent = page.getByText(/clinical|documentation|attestation|upgrade/i).first();
    await expect(hasContent).toBeVisible({ timeout: 10000 });
  });

  test("clinical templates page loads", async ({ page }) => {
    await page.goto("/clinical/templates");
    // Should show templates or upgrade prompt
    const content = page.getByText(/template|clinical|specialty|SOAP|upgrade/i).first();
    await expect(content).toBeVisible({ timeout: 10000 });
  });

  test("clinical upload page loads", async ({ page }) => {
    await page.goto("/clinical/upload");
    // Should show upload form or upgrade prompt
    const content = page.getByText(/upload|record|encounter|audio|upgrade/i).first();
    await expect(content).toBeVisible({ timeout: 10000 });
  });

  test("clinical notes page handles missing call gracefully", async ({ page }) => {
    await page.goto("/clinical/notes/nonexistent-id");
    // Should show not found or error, not crash
    const content = page.getByText(/not found|error|no.*note|upgrade/i).first();
    await expect(content).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Clinical API Access Control", () => {
  test("clinical endpoints require authentication", async ({ playwright }) => {
    const apiContext = await playwright.request.newContext({
      baseURL: process.env.BASE_URL || "http://localhost:5000",
    });
    try {
      const response = await apiContext.get("/api/clinical/metrics");
      expect(response.status()).toBe(401);
    } finally {
      await apiContext.dispose();
    }
  });

  test("clinical notes endpoint requires auth", async ({ playwright }) => {
    const apiContext = await playwright.request.newContext({
      baseURL: process.env.BASE_URL || "http://localhost:5000",
    });
    try {
      // Use valid UUID format to avoid 400 from UUID validation middleware
      const response = await apiContext.get("/api/clinical/notes/00000000-0000-0000-0000-000000000000");
      // Should be 401 (unauthenticated) not 400 (bad format)
      expect(response.status()).toBe(401);
    } finally {
      await apiContext.dispose();
    }
  });

  test("clinical templates are accessible when authenticated", async ({ playwright }) => {
    const apiContext = await playwright.request.newContext({
      baseURL: process.env.BASE_URL || "http://localhost:5000",
    });
    try {
      // Login first
      const loginResponse = await apiContext.post("/api/auth/login", {
        data: { username: "admin", password: "admin123" },
      });
      expect(loginResponse.status()).toBe(200);

      // Templates should be accessible (even if plan doesn't allow, the route exists)
      const templatesResponse = await apiContext.get("/api/clinical/templates");
      // Will be 200 or 403 depending on plan, but not 500
      expect([200, 403]).toContain(templatesResponse.status());
    } finally {
      await apiContext.dispose();
    }
  });
});
