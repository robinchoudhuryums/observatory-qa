import { test as setup, expect } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const authDir = path.resolve(__dirname, ".auth");

setup("login as admin", async ({ page }) => {
  // Ensure .auth directory exists
  fs.mkdirSync(authDir, { recursive: true });

  const baseURL = (process.env.BASE_URL || "http://localhost:5000").replace(/\/$/, "");

  // Login via API using the page's context request (shares cookies with browser)
  const response = await page.request.post(`${baseURL}/api/auth/login`, {
    data: { username: "admin", password: "admin123" },
  });

  if (response.status() !== 200) {
    throw new Error(`Admin login failed: ${response.status()}`);
  }

  // Verify the session works by navigating to the app
  await page.goto("/");
  await expect(page.locator("[data-testid='sidebar']")).toBeVisible({ timeout: 15000 });

  // Save authenticated state (cookies + localStorage)
  await page.context().storageState({
    path: path.resolve(authDir, "admin.json"),
  });
});

setup("login as viewer", async ({ page }) => {
  fs.mkdirSync(authDir, { recursive: true });

  const baseURL = (process.env.BASE_URL || "http://localhost:5000").replace(/\/$/, "");

  const response = await page.request.post(`${baseURL}/api/auth/login`, {
    data: { username: "viewer", password: "viewer123" },
  });

  if (response.status() !== 200) {
    throw new Error(`Viewer login failed: ${response.status()}`);
  }

  await page.goto("/");
  await expect(page.locator("[data-testid='sidebar']")).toBeVisible({ timeout: 15000 });

  await page.context().storageState({
    path: path.resolve(authDir, "viewer.json"),
  });
});
