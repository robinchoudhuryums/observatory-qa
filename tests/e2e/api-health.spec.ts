import { test, expect } from "@playwright/test";

test.describe("API Health Tests", () => {
  test("GET /api/health returns 200", async ({ playwright }) => {
    const apiContext = await playwright.request.newContext({
      baseURL: process.env.BASE_URL || "http://localhost:5000",
    });
    try {
      const response = await apiContext.get("/api/health");
      expect(response.status()).toBe(200);

      const body = await response.json();
      expect(body).toBeDefined();
    } finally {
      await apiContext.dispose();
    }
  });

  test("GET /api/auth/me without auth returns 401", async ({ playwright }) => {
    const apiContext = await playwright.request.newContext({
      baseURL: process.env.BASE_URL || "http://localhost:5000",
    });
    try {
      const response = await apiContext.get("/api/auth/me");
      expect(response.status()).toBe(401);
    } finally {
      await apiContext.dispose();
    }
  });

  test("POST /api/auth/login with bad credentials returns 401", async ({ playwright }) => {
    const apiContext = await playwright.request.newContext({
      baseURL: process.env.BASE_URL || "http://localhost:5000",
    });
    try {
      const response = await apiContext.post("/api/auth/login", {
        data: { username: "admin", password: "wrongpassword" },
      });
      expect(response.status()).toBe(401);
    } finally {
      await apiContext.dispose();
    }
  });

  test("POST /api/auth/login with good credentials returns 200", async ({ playwright }) => {
    const apiContext = await playwright.request.newContext({
      baseURL: process.env.BASE_URL || "http://localhost:5000",
    });
    try {
      const response = await apiContext.post("/api/auth/login", {
        data: { username: "admin", password: "admin123" },
      });
      expect(response.status()).toBe(200);

      const body = await response.json();
      expect(body).toBeDefined();
      expect(body.username || body.user?.username || body.name).toBeDefined();
    } finally {
      await apiContext.dispose();
    }
  });
});
