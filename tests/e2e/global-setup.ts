import { request } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const baseURL = process.env.BASE_URL || "http://localhost:5000";

/**
 * Playwright global setup: log in as admin and viewer ONCE before all tests,
 * saving the authenticated storageState (cookies) to files. Tests then reuse
 * these states instead of logging in per-test, eliminating:
 * - ~35+ redundant login API calls
 * - Session accumulation in MemoryStore causing server degradation
 * - Intermittent cookie/sidebar timing failures
 */
async function globalSetup() {
  // Create admin session
  const adminContext = await request.newContext({ baseURL });
  const adminResponse = await adminContext.post("/api/auth/login", {
    data: { username: "admin", password: "admin123" },
  });
  if (adminResponse.status() !== 200) {
    throw new Error(`Admin login failed: ${adminResponse.status()}`);
  }
  await adminContext.storageState({
    path: path.resolve(__dirname, ".auth", "admin.json"),
  });
  await adminContext.dispose();

  // Create viewer session
  const viewerContext = await request.newContext({ baseURL });
  const viewerResponse = await viewerContext.post("/api/auth/login", {
    data: { username: "viewer", password: "viewer123" },
  });
  if (viewerResponse.status() !== 200) {
    throw new Error(`Viewer login failed: ${viewerResponse.status()}`);
  }
  await viewerContext.storageState({
    path: path.resolve(__dirname, ".auth", "viewer.json"),
  });
  await viewerContext.dispose();
}

export default globalSetup;
