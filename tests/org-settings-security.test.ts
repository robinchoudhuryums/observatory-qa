/**
 * Org settings exposure and validation (F53 / F54) and the WAF admin routes (F36).
 *
 * Real csrfMiddleware + setupAuth + login + admin routes on Express with
 * MemStorage. Before the fix:
 *   - GET /api/organization returned stored settings verbatim to every role
 *     (oidcClientSecret, scimTokenHash, encryptedDataKey, webhook URLs);
 *   - the settings PATCH accepted retentionDays: 0 (purges every call),
 *     server-managed fields (scimTokenHash, encryptedDataKey, …) and a
 *     plaintext ehrConfig.apiKey, and stored oidcClientSecret in plaintext;
 *   - any tenant admin could block/unblock IPs in the process-global WAF.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { csrfMiddleware } from "../server/middleware/csrf.js";
import { setupAuth } from "../server/auth.js";
import { registerAuthRoutes } from "../server/routes/auth.js";
import { registerAdminRoutes, redactOrgForRole } from "../server/routes/admin.js";
import { storage } from "../server/storage/index.js";
import { decryptField } from "../server/services/phi-encryption.js";
import { unblockIp } from "../server/middleware/waf.js";

process.env.PHI_ENCRYPTION_KEY = process.env.PHI_ENCRYPTION_KEY || "a".repeat(64);

interface Res {
  status: number;
  body: any;
  cookies: string[];
}

function request(
  server: http.Server,
  method: string,
  path: string,
  opts: { body?: unknown; cookie?: string; csrfToken?: string } = {},
): Promise<Res> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    const bodyStr = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (bodyStr) headers["Content-Length"] = Buffer.byteLength(bodyStr).toString();
    if (opts.cookie) headers["Cookie"] = opts.cookie;
    if (opts.csrfToken) headers["X-CSRF-Token"] = opts.csrfToken;
    const req = http.request({ hostname: "127.0.0.1", port: addr.port, method, path, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString();
        let body: any = raw;
        try {
          body = raw ? JSON.parse(raw) : null;
        } catch {
          /* keep raw */
        }
        const sc = res.headers["set-cookie"];
        resolve({ status: res.statusCode!, body, cookies: Array.isArray(sc) ? sc : sc ? [sc] : [] });
      });
    });
    req.on("error", reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function cookieValue(lines: string[], name: string): string | undefined {
  for (const line of lines) {
    const [k, v] = line.split(";")[0].split("=");
    if (k === name) return v;
  }
  return undefined;
}

const SEEDED = {
  oidcClientSecret: "plain-oidc-secret",
  scimTokenHash: "seeded-scim-hash",
  scimTokenPrefix: "obs_scim",
  encryptedDataKey: "seeded-dek",
  kmsKeyId: "arn:aws:kms:seeded",
  mfaRequiredEnabledAt: "2026-01-01T00:00:00.000Z",
  webhookUrl: "https://hooks.slack.com/services/T000/B000/XXXX",
  siemWebhookUrl: "https://siem.example.com/ingest",
  ehrConfig: { system: "open_dental", baseUrl: "https://api.opendental.com", apiKey: "enc_v1:seeded", enabled: true },
  retentionDays: 90,
};

describe("Org settings security", () => {
  let server: http.Server;
  let orgId: string;

  before(async () => {
    process.env.SESSION_SECRET = process.env.SESSION_SECRET || "org-settings-test-secret";
    process.env.AUTH_USERS =
      "os-admin:password123:admin:OS Admin:default,os-viewer:password123:viewer:OS Viewer:default";
    process.env.SUPER_ADMIN_USERS = "os-super:password123:Platform Ops";
    process.env.DISABLE_SECURE_COOKIE = "true";

    const app = express();
    app.use(express.json());
    app.use(csrfMiddleware);
    await setupAuth(app);
    registerAuthRoutes(app);
    registerAdminRoutes(app);
    app.get("/api/test/public", (_req, res) => res.json({ ok: true }));

    const org = await storage.getOrganizationBySlug("default");
    orgId = org!.id;
    await storage.updateOrganization(orgId, { settings: { ...(org!.settings || {}), ...SEEDED } as any });
    await storage.upsertSubscription(orgId, { orgId, planTier: "enterprise", status: "active" } as any);

    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  });

  after(async () => {
    unblockIp("203.0.113.77");
    await new Promise<void>((r) => server.close(() => r()));
  });

  async function loginAs(username: string) {
    const seed = await request(server, "GET", "/api/test/public");
    const csrfToken = cookieValue(seed.cookies, "csrf-token")!;
    const res = await request(server, "POST", "/api/auth/login", {
      body: { username, password: "password123" },
      cookie: `csrf-token=${csrfToken}`,
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const sid = cookieValue(res.cookies, "connect.sid")!;
    return { csrfToken, cookie: `csrf-token=${csrfToken}; connect.sid=${sid}` };
  }

  describe("GET /api/organization (F53)", () => {
    it("never sends secrets or key material, even to admins", async () => {
      const a = await loginAs("os-admin");
      const res = await request(server, "GET", "/api/organization", { cookie: a.cookie });
      assert.equal(res.status, 200);
      const s = res.body.settings;
      for (const key of ["oidcClientSecret", "scimTokenHash", "encryptedDataKey", "kmsKeyId"]) {
        assert.equal(s[key], undefined, `${key} must not be sent`);
      }
      assert.equal(s.ehrConfig.apiKey, undefined, "EHR API key must not be sent");
      assert.equal(s.webhookUrl, SEEDED.webhookUrl, "admins still see their own integration config");
      assert.equal(s.oidcClientSecretConfigured, true);
    });

    it("hides integration config from non-admins", async () => {
      const v = await loginAs("os-viewer");
      const res = await request(server, "GET", "/api/organization", { cookie: v.cookie });
      assert.equal(res.status, 200);
      const s = res.body.settings;
      for (const key of [
        "oidcClientSecret",
        "scimTokenHash",
        "encryptedDataKey",
        "kmsKeyId",
        "webhookUrl",
        "siemWebhookUrl",
        "ehrConfig",
        "scimTokenPrefix",
      ]) {
        assert.equal(s[key], undefined, `${key} must not be sent to a viewer`);
      }
      assert.equal(s.retentionDays, 90, "ordinary settings are still visible");
    });

    it("redactOrgForRole does not mutate the stored object", () => {
      const org = { id: "o", settings: { oidcClientSecret: "x", webhookUrl: "https://a.example.com" } };
      redactOrgForRole(org, "viewer");
      assert.equal(org.settings.oidcClientSecret, "x");
    });
  });

  describe("PATCH /api/organization/settings (F54)", () => {
    it("rejects retentionDays below 1, fractional or absurd", async () => {
      const a = await loginAs("os-admin");
      for (const retentionDays of [0, -5, 30.5, 100000]) {
        const res = await request(server, "PATCH", "/api/organization/settings", {
          body: { retentionDays },
          cookie: a.cookie,
          csrfToken: a.csrfToken,
        });
        assert.equal(res.status, 400, `retentionDays ${retentionDays} must be rejected`);
      }
      const stored = await storage.getOrganization(orgId);
      assert.equal(stored!.settings!.retentionDays, 90);
    });

    it("ignores server-managed fields and plaintext ehrConfig", async () => {
      const a = await loginAs("os-admin");
      const res = await request(server, "PATCH", "/api/organization/settings", {
        body: {
          scimTokenHash: "attacker-hash",
          scimTokenPrefix: "attacker",
          encryptedDataKey: "attacker-dek",
          kmsKeyId: "attacker-arn",
          mfaRequiredEnabledAt: "1999-01-01T00:00:00.000Z",
          ehrConfig: { system: "open_dental", baseUrl: "https://evil.example.com", apiKey: "PLAINTEXT", enabled: true },
          retentionDays: 60,
        },
        cookie: a.cookie,
        csrfToken: a.csrfToken,
      });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const s = (await storage.getOrganization(orgId))!.settings as any;
      assert.equal(s.retentionDays, 60, "legitimate field applied");
      assert.equal(s.scimTokenHash, SEEDED.scimTokenHash);
      assert.equal(s.scimTokenPrefix, SEEDED.scimTokenPrefix);
      assert.equal(s.encryptedDataKey, SEEDED.encryptedDataKey);
      assert.equal(s.kmsKeyId, SEEDED.kmsKeyId);
      assert.equal(s.mfaRequiredEnabledAt, SEEDED.mfaRequiredEnabledAt);
      assert.deepEqual(s.ehrConfig, SEEDED.ehrConfig);
      // The PATCH response is redacted too.
      assert.equal(res.body.settings.scimTokenHash, undefined);
      assert.equal(res.body.settings.oidcClientSecret, undefined);
    });

    it("stores oidcClientSecret encrypted", async () => {
      const a = await loginAs("os-admin");
      const res = await request(server, "PATCH", "/api/organization/settings", {
        body: { oidcClientSecret: "rotated-secret" },
        cookie: a.cookie,
        csrfToken: a.csrfToken,
      });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const stored = ((await storage.getOrganization(orgId))!.settings as any).oidcClientSecret as string;
      assert.ok(stored.startsWith("enc_v1:"), "secret must be encrypted at rest");
      assert.equal(decryptField(stored), "rotated-secret");
    });
  });

  describe("WAF admin routes (F36)", () => {
    it("a tenant admin cannot block IPs or read WAF stats", async () => {
      const a = await loginAs("os-admin");
      const block = await request(server, "POST", "/api/admin/waf/block-ip", {
        body: { ip: "203.0.113.77" },
        cookie: a.cookie,
        csrfToken: a.csrfToken,
      });
      assert.equal(block.status, 403);
      const unblock = await request(server, "POST", "/api/admin/waf/unblock-ip", {
        body: { ip: "203.0.113.77" },
        cookie: a.cookie,
        csrfToken: a.csrfToken,
      });
      assert.equal(unblock.status, 403);
      const stats = await request(server, "GET", "/api/admin/waf-stats", { cookie: a.cookie });
      assert.equal(stats.status, 403);
    });

    it("a super admin can", async () => {
      const s = await loginAs("os-super");
      const block = await request(server, "POST", "/api/admin/waf/block-ip", {
        body: { ip: "203.0.113.77" },
        cookie: s.cookie,
        csrfToken: s.csrfToken,
      });
      assert.equal(block.status, 200);
      const stats = await request(server, "GET", "/api/admin/waf-stats", { cookie: s.cookie });
      assert.equal(stats.status, 200);
    });
  });
});
