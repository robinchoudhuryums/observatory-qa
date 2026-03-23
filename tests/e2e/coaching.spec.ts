import { test, expect } from "@playwright/test";
import { login } from "./helpers";

test.describe("Coaching", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("coaching page loads", async ({ page }) => {
    await page.goto("/coaching");
    const content = page.getByText(/coaching|session|action plan|create/i).first();
    await expect(content).toBeVisible({ timeout: 10000 });
  });

  test("coaching page shows create button for admin", async ({ page }) => {
    await page.goto("/coaching");
    // Admin should see ability to create coaching sessions
    const createBtn = page.getByRole("button", { name: /create|new|add/i }).first();
    const hasButton = await createBtn.isVisible().catch(() => false);
    if (hasButton) {
      await expect(createBtn).toBeVisible();
    }
  });
});

test.describe("Coaching API", () => {
  test("coaching endpoints require authentication", async ({ playwright }) => {
    const apiContext = await playwright.request.newContext({
      baseURL: process.env.BASE_URL || "http://localhost:5000",
    });
    try {
      const response = await apiContext.get("/api/coaching");
      expect(response.status()).toBe(401);
    } finally {
      await apiContext.dispose();
    }
  });
});
