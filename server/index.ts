// OpenTelemetry must be initialised before any other imports that should be
// auto-instrumented (HTTP, Express, pg).  The call is a no-op when
// OTEL_ENABLED !== "true", so existing deployments are unaffected.
import { initTelemetry, shutdownTelemetry } from "./services/telemetry";

import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes/index";
import { setupVite, serveStatic, log } from "./vite";
import { setupAuth } from "./auth";
import { storage, initPostgresStorage } from "./storage";
import { setupWebSocket } from "./services/websocket";
import { logger } from "./services/logger";
import { initRedis, checkRateLimit, closeRedis, getRedisStatus } from "./services/redis";
import { initQueues, enqueueRetention, closeQueues } from "./services/queue";
import { initEmail, sendEmail, buildQuotaAlertEmail } from "./services/email";
import { isPhiEncryptionEnabled } from "./services/phi-encryption";
import { wafMiddleware } from "./middleware/waf";
import { correlationIdMiddleware } from "./middleware/correlation-id";
import { tracingMiddleware } from "./middleware/tracing";
import { initSentry, sentryErrorMiddleware, flushSentry } from "./services/sentry";
import { PLAN_DEFINITIONS, type PlanTier } from "@shared/schema";

// Initialize Sentry early (before Express middleware) so it captures all errors
initSentry();

const app = express();

// --- In-memory sliding window rate limiter (fallback when Redis unavailable) ---
// Tracks individual request timestamps per key for accurate sliding window behavior
const MAX_RATE_LIMIT_ENTRIES = 50_000;
const rateLimitMap = new Map<string, number[]>();
function rateLimitKey(req: Request, includeOrg: boolean): string {
  const orgPart = includeOrg && req.orgId ? `:org:${req.orgId}` : "";
  return `${req.ip}:${req.path}${orgPart}`;
}

function setRateLimitHeaders(res: Response, limit: number, remaining: number, resetSeconds: number): void {
  res.setHeader("X-RateLimit-Limit", limit.toString());
  res.setHeader("X-RateLimit-Remaining", Math.max(0, remaining).toString());
  res.setHeader("X-RateLimit-Reset", Math.ceil(resetSeconds).toString());
}

function inMemoryRateLimit(windowMs: number, maxRequests: number, includeOrg = false) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = rateLimitKey(req, includeOrg);
    const now = Date.now();
    const windowStart = now - windowMs;

    // Get existing timestamps and filter out expired ones
    let timestamps = rateLimitMap.get(key) || [];
    timestamps = timestamps.filter((ts) => ts > windowStart);

    const resetSeconds = timestamps.length > 0 ? (timestamps[0] + windowMs - now) / 1000 : windowMs / 1000;

    if (timestamps.length >= maxRequests) {
      rateLimitMap.set(key, timestamps);
      setRateLimitHeaders(res, maxRequests, 0, resetSeconds);
      res.setHeader("Retry-After", Math.ceil(resetSeconds).toString());
      return res.status(429).json({ message: "Too many requests. Please try again later." });
    }

    // Record this request (enforce hard cap to prevent unbounded growth)
    timestamps.push(now);
    if (rateLimitMap.size >= MAX_RATE_LIMIT_ENTRIES && !rateLimitMap.has(key)) {
      // Evict oldest entry when at capacity
      const oldest = rateLimitMap.keys().next().value;
      if (oldest) rateLimitMap.delete(oldest);
    }
    rateLimitMap.set(key, timestamps);

    setRateLimitHeaders(res, maxRequests, maxRequests - timestamps.length, resetSeconds);
    return next();
  };
}

// --- Distributed rate limiter (Redis-backed when available) ---
let redisAvailable = false;

function distributedRateLimit(windowMs: number, maxRequests: number, includeOrg = false) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!redisAvailable) {
      // Fall back to in-memory sliding window
      return inMemoryRateLimit(windowMs, maxRequests, includeOrg)(req, res, next);
    }

    const key = rateLimitKey(req, includeOrg);
    try {
      const result = await checkRateLimit(key, windowMs, maxRequests);
      const resetSeconds = Math.ceil(result.resetMs / 1000);
      setRateLimitHeaders(res, maxRequests, result.remaining, resetSeconds);
      if (!result.allowed) {
        res.setHeader("Retry-After", resetSeconds.toString());
        return res.status(429).json({ message: "Too many requests. Please try again later." });
      }
      return next();
    } catch {
      // Redis error — fall through to allow the request
      return next();
    }
  };
}

// Clean up expired in-memory rate limit entries every 5 minutes
const rateLimitCleanupTimer = setInterval(
  () => {
    const now = Date.now();
    rateLimitMap.forEach((timestamps, key) => {
      // Remove keys where all timestamps have expired (oldest possible window is 1 hour for registration)
      const maxWindowMs = 60 * 60 * 1000;
      const filtered = timestamps.filter((ts) => ts > now - maxWindowMs);
      if (filtered.length === 0) {
        rateLimitMap.delete(key);
      } else {
        rateLimitMap.set(key, filtered);
      }
    });
  },
  5 * 60 * 1000,
);

// Trust reverse proxy (Render, Heroku, etc.) so secure cookies and
// x-forwarded-proto work correctly behind their load balancer.
if (process.env.NODE_ENV === "production" && !process.env.DISABLE_SECURE_COOKIE) {
  app.set("trust proxy", 1);
}

// HIPAA: Enforce HTTPS in production (redirect HTTP → HTTPS)
app.use((req, res, next) => {
  if (
    process.env.NODE_ENV === "production" &&
    req.headers["x-forwarded-proto"] !== "https" &&
    !req.hostname.startsWith("localhost") &&
    !req.hostname.startsWith("127.0.0.1")
  ) {
    return res.redirect(301, `https://${req.hostname}${req.originalUrl}`);
  }
  next();
});

// Correlation ID: per-request tracing via AsyncLocalStorage
app.use(correlationIdMiddleware);

// WAF: Application-level firewall (SQL injection, XSS, path traversal, anomaly scoring)
app.use(wafMiddleware);

// Stripe webhook needs raw body for signature verification
app.use("/api/billing/webhook", express.raw({ type: "application/json" }));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "1mb" }));

// HIPAA: Security headers including Content-Security-Policy
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(self), geolocation=()");
  // CSP: restrict resource loading to same-origin and trusted CDNs
  // NOTE: style-src 'unsafe-inline' is required because Recharts renders chart elements with
  // inline styles (dynamically computed positions, colors, dimensions) and Framer Motion uses
  // inline transforms for animations. Removing it would break all charts and transitions.
  // script-src is properly locked down to 'self' only (no unsafe-inline for scripts).
  // CDN_ORIGIN: Set to your CDN domain (e.g. https://cdn.observatory-qa.com) to allow assets
  // served from CloudFront/Cloudflare. When not set, only 'self' is allowed.
  const cdnOrigin = process.env.CDN_ORIGIN || "";
  const cdnDirective = cdnOrigin ? ` ${cdnOrigin}` : "";
  const sentryDsn = process.env.SENTRY_DSN || "";
  const sentryDirective = sentryDsn ? " https://*.ingest.sentry.io" : "";
  const isProduction = process.env.NODE_ENV === "production";
  const upgradeInsecure = isProduction ? " upgrade-insecure-requests;" : "";
  res.setHeader(
    "Content-Security-Policy",
    `default-src 'self'${cdnDirective}; script-src 'self'${cdnDirective}; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com${cdnDirective}; font-src 'self' https://fonts.gstatic.com${cdnDirective}; img-src 'self' data: blob:${cdnDirective}; media-src 'self' blob:${cdnDirective}; connect-src 'self' wss:${sentryDirective}${cdnDirective}; worker-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none';${upgradeInsecure}`,
  );
  // Only set no-cache on API routes — static assets need caching for performance
  if (req.path.startsWith("/api")) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
  }
  next();
});

// CSRF protection: double-submit cookie pattern
// State-changing API requests must include X-CSRF-Token header matching the csrf cookie
import { randomBytes, timingSafeEqual } from "crypto";

function parseCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie || "";
  const match = header
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${name}=`));
  return match ? match.slice(name.length + 1) : undefined;
}

app.use((req, res, next) => {
  // Set CSRF cookie on all responses if not already present
  if (!parseCookie(req, "csrf-token")) {
    const token = randomBytes(32).toString("hex");
    res.cookie("csrf-token", token, {
      httpOnly: false, // Must be readable by JS to send in header
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production" && !process.env.DISABLE_SECURE_COOKIE,
      path: "/",
    });
  }

  // Skip CSRF checks for safe methods and non-API routes
  if (["GET", "HEAD", "OPTIONS"].includes(req.method) || !req.path.startsWith("/api")) {
    return next();
  }

  // Skip CSRF for Stripe webhooks (uses its own signature verification)
  if (req.path === "/api/billing/webhook") return next();

  // Skip CSRF for API key authenticated requests (no browser session)
  if (req.headers["x-api-key"]) return next();

  // Skip CSRF for login/register/forgot-password (pre-auth, no session yet)
  const csrfExemptPaths = [
    "/api/auth/login",
    "/api/auth/register",
    "/api/auth/forgot-password",
    "/api/auth/reset-password",
  ];
  if (csrfExemptPaths.includes(req.path)) return next();

  // Verify CSRF token
  const cookieToken = parseCookie(req, "csrf-token");
  const headerToken = req.headers["x-csrf-token"] as string | undefined;
  if (
    !cookieToken ||
    !headerToken ||
    cookieToken.length !== headerToken.length ||
    !timingSafeEqual(Buffer.from(cookieToken), Buffer.from(headerToken))
  ) {
    res.status(403).json({ message: "Invalid or missing CSRF token", code: "OBS-AUTH-CSRF" });
    return;
  }

  next();
});

// HIPAA: Audit logging middleware - logs all API access with user identity but never PHI
app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      const user = req.user;
      const userId = user ? `${user.username}(${user.role})` : "anonymous";
      const orgSlug = user?.orgSlug || "-";
      logger.info(
        {
          type: "audit",
          org: orgSlug,
          user: userId,
          method: req.method,
          path,
          status: res.statusCode,
          durationMs: duration,
        },
        `${req.method} ${path} ${res.statusCode}`,
      );
    }
  });

  next();
});

// HIPAA: Rate limiting on login endpoint (5 attempts per 15 minutes per IP)
// In E2E testing, relax limits to avoid 429s from repeated test logins
const isE2E = process.env.E2E_TESTING === "true";
const loginRateLimit = isE2E ? 500 : 5;
app.post("/api/auth/login", distributedRateLimit(15 * 60 * 1000, loginRateLimit) as any);
// Rate limit registration: 3 per hour per IP
app.post("/api/auth/register", distributedRateLimit(60 * 60 * 1000, 3) as any);
// Rate limit password reset: 5 per 15 minutes per IP (prevent token brute-force & enumeration)
app.post("/api/auth/forgot-password", distributedRateLimit(15 * 60 * 1000, 5) as any);
app.post("/api/auth/reset-password", distributedRateLimit(15 * 60 * 1000, 5) as any);
// HIPAA: Read rate limiting to prevent bulk data exfiltration
// Org-scoped so one tenant's usage doesn't block another on shared IPs
app.get("/api/calls", distributedRateLimit(60 * 1000, 100, true) as any);
app.post("/api/calls/upload", distributedRateLimit(60 * 1000, 30, true) as any);
app.use("/api/export", distributedRateLimit(60 * 1000, 10, true) as any);
app.post("/api/onboarding/rag/search", distributedRateLimit(60 * 1000, 20, true) as any);
// Tighter limits on individual PHI detail reads (transcript, analysis, sentiment)
app.get("/api/calls/:id/transcript", distributedRateLimit(60 * 1000, 30, true) as any);
app.get("/api/calls/:id/analysis", distributedRateLimit(60 * 1000, 30, true) as any);
app.get("/api/calls/:id/sentiment", distributedRateLimit(60 * 1000, 30, true) as any);
app.use("/api/calls", distributedRateLimit(60 * 1000, 60, true) as any);
app.use("/api/employees", distributedRateLimit(60 * 1000, 60, true) as any);
// Tighter limits on clinical/EHR (PHI-heavy endpoints)
app.use("/api/clinical", distributedRateLimit(60 * 1000, 40, true) as any);
app.use("/api/ehr", distributedRateLimit(60 * 1000, 20, true) as any);
// Style learning is computationally expensive — stricter limit
app.post("/api/clinical/style-learning/analyze", distributedRateLimit(60 * 1000, 3, true) as any);

(async () => {
  // --- Pre-flight environment validation ---
  // Catch misconfigurations before anything starts. Prevents silent failures
  // and data loss (e.g., PHI stored unencrypted because key is missing).
  const isProduction = process.env.NODE_ENV === "production";
  const envErrors: string[] = [];
  const envWarnings: string[] = [];

  // Required always
  if (!process.env.SESSION_SECRET) envErrors.push("SESSION_SECRET is required (cookie signing)");
  if (!process.env.ASSEMBLYAI_API_KEY) envWarnings.push("ASSEMBLYAI_API_KEY not set — audio processing will fail");

  // Required in production
  if (isProduction) {
    if (!process.env.PHI_ENCRYPTION_KEY)
      envErrors.push("PHI_ENCRYPTION_KEY required in production (64-char hex for AES-256-GCM)");
    else if (process.env.PHI_ENCRYPTION_KEY.length !== 64)
      envErrors.push("PHI_ENCRYPTION_KEY must be exactly 64 hex characters");
    if (!process.env.DATABASE_URL && process.env.STORAGE_BACKEND === "postgres")
      envErrors.push("DATABASE_URL required when STORAGE_BACKEND=postgres");
    if (process.env.SESSION_SECRET === "dev-secret")
      envErrors.push("SESSION_SECRET is set to 'dev-secret' — use a random 32+ character string in production");
    else if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length < 32)
      envErrors.push(`SESSION_SECRET is too short (${process.env.SESSION_SECRET.length} chars) — must be at least 32 characters in production`);
  }

  // PHI encryption (HIPAA requirement in production)
  if (isProduction && !isPhiEncryptionEnabled()) {
    envErrors.push("PHI_ENCRYPTION_KEY required in production — PHI must never be stored unencrypted");
  }

  // AI provider
  if (process.env.AWS_ACCESS_KEY_ID && !process.env.AWS_SECRET_ACCESS_KEY)
    envErrors.push("AWS_SECRET_ACCESS_KEY required when AWS_ACCESS_KEY_ID is set");
  if (process.env.AWS_SECRET_ACCESS_KEY && !process.env.AWS_ACCESS_KEY_ID)
    envErrors.push("AWS_ACCESS_KEY_ID required when AWS_SECRET_ACCESS_KEY is set");

  // Stripe
  if (process.env.STRIPE_SECRET_KEY && !process.env.STRIPE_WEBHOOK_SECRET)
    envWarnings.push("STRIPE_WEBHOOK_SECRET not set — Stripe webhooks will fail signature verification");

  // Log and exit on errors
  for (const w of envWarnings) logger.warn(`[ENV] ${w}`);
  if (envErrors.length > 0) {
    for (const e of envErrors) logger.error(`[ENV] ${e}`);
    logger.error(`${envErrors.length} environment configuration error(s) — fix these before starting`);
    process.exit(1);
  }

  // --- Infrastructure initialization ---

  // 0. Initialize OpenTelemetry (must be early to instrument HTTP, Express, pg)
  await initTelemetry();

  // 1. Initialize Redis (sessions, rate limiting, pub/sub, queue backend)
  const redis = initRedis();
  redisAvailable = redis !== null;
  if (redisAvailable) {
    logger.info("Redis available — using distributed sessions, rate limiting, and job queues");
  } else if (process.env.NODE_ENV === "production") {
    if (process.env.REQUIRE_REDIS === "true") {
      logger.error(
        "REDIS_URL not configured in production with REQUIRE_REDIS=true. In-memory sessions will be lost on restart " +
          "and rate limiting will not work across instances. Set REDIS_URL to continue.",
      );
      process.exit(1);
    } else {
      logger.warn(
        "WARNING: Running in production without Redis. Rate limiting is in-memory only (single-instance). " +
          "Set REDIS_URL for distributed rate limiting.",
      );
    }
  }

  // 2. Initialize PostgreSQL storage if configured
  const pgInitialized = await initPostgresStorage();
  if (pgInitialized) {
    logger.info("PostgreSQL storage backend active");
  } else if (process.env.DATABASE_URL) {
    // DATABASE_URL is set but PostgreSQL failed to connect — fail fast in production
    // to prevent silent fallback to in-memory storage (which loses data on restart)
    if (process.env.NODE_ENV === "production") {
      logger.error(
        "PostgreSQL is configured (DATABASE_URL set) but unavailable. Refusing to start in production with in-memory fallback.",
      );
      process.exit(1);
    } else {
      logger.warn(
        "PostgreSQL is configured (DATABASE_URL set) but unavailable. Falling back to in-memory storage for development.",
      );
    }
  }

  // 3. Initialize BullMQ job queues
  const queuesReady = initQueues();
  if (queuesReady) {
    logger.info("BullMQ job queues active");
  }

  // 4. Initialize email transport
  initEmail();

  // 5. HIPAA: Validate PHI encryption key — warn if clinical features may store plaintext
  if (!isPhiEncryptionEnabled()) {
    logger.warn(
      "PHI_ENCRYPTION_KEY is not configured — clinical notes and PHI fields will be stored in plaintext. " +
        "Set PHI_ENCRYPTION_KEY (64 hex chars) for HIPAA-compliant PHI encryption at rest.",
    );
  }

  // Authentication (must come before routes) - async to hash env var passwords on startup
  await setupAuth(app);

  // OpenTelemetry: request tracing (trace IDs, span attributes, duration metrics)
  app.use(tracingMiddleware);

  const server = await registerRoutes(app);

  // Sentry error middleware: captures unhandled errors before the final handler
  app.use(sentryErrorMiddleware);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    if (status >= 500) {
      logger.error({ status, err: message }, "Internal server error");
      res.status(status).json({ message: "Internal Server Error" });
    } else {
      res.status(status).json({ message });
    }
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  server.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);

      // WebSocket: real-time call processing notifications
      setupWebSocket(server);

      // HIPAA: Data retention — purge calls older than configured days
      // Runs across all organizations; uses per-org retentionDays from settings (falls back to env/default 90)
      const defaultRetentionDays = parseInt(process.env.RETENTION_DAYS || "90", 10);
      const runRetention = async () => {
        try {
          const currentStorage = (await import("./storage")).storage;
          const orgs = await currentStorage.listOrganizations();
          let totalPurged = 0;
          for (const org of orgs) {
            const orgRetention = org.settings?.retentionDays ?? defaultRetentionDays;

            // Use job queue if available (non-blocking, durable)
            if (queuesReady) {
              await enqueueRetention(org.id, orgRetention);
            } else {
              // Fallback: run inline
              const purged = await currentStorage.purgeExpiredCalls(org.id, orgRetention);
              if (purged > 0) {
                const { logPhiAccess } = await import("./services/audit-log");
                logPhiAccess({
                  orgId: org.id,
                  userId: "system",
                  username: "system:retention",
                  role: "admin",
                  ip: "localhost",
                  userAgent: "retention-scheduler",
                  event: "data_retention_purge",
                  resourceType: "call",
                  detail: `Purged ${purged} calls older than ${orgRetention} days`,
                });
                logger.info({ org: org.slug, purged, retentionDays: orgRetention }, "Retention purge completed");
                totalPurged += purged;
              }
            }
          }
          if (!queuesReady && totalPurged > 0) {
            logger.info({ totalPurged }, "Retention purge complete across all orgs");
          }
        } catch (error) {
          logger.error({ err: error }, "Error during retention purge");
        }
      };

      // Trial auto-downgrade: check for expired trial subscriptions daily
      const runTrialDowngrade = async () => {
        try {
          const currentStorage = (await import("./storage")).storage;
          const orgs = await currentStorage.listOrganizations();
          const now = new Date();
          let downgraded = 0;

          for (const org of orgs) {
            const sub = await currentStorage.getSubscription(org.id);
            if (!sub) continue;

            // Downgrade expired trials
            if (sub.status === "trialing" && sub.currentPeriodEnd) {
              const trialEnd = new Date(sub.currentPeriodEnd);
              if (now > trialEnd) {
                await currentStorage.upsertSubscription(org.id, {
                  orgId: org.id,
                  planTier: "free",
                  status: "active",
                  billingInterval: "monthly",
                  cancelAtPeriodEnd: false,
                });
                const { logPhiAccess } = await import("./services/audit-log");
                logPhiAccess({
                  orgId: org.id,
                  userId: "system",
                  username: "system:trial-downgrade",
                  role: "admin",
                  ip: "localhost",
                  userAgent: "trial-scheduler",
                  event: "subscription_auto_downgraded",
                  resourceType: "subscription",
                  detail: `Trial expired — From: ${sub.planTier}, To: free`,
                });
                logger.info(
                  { orgId: org.id, orgSlug: org.slug, previousTier: sub.planTier },
                  "Trial expired — downgraded to free",
                );
                downgraded++;

                // Notify org admins about the downgrade
                try {
                  const { buildTrialDowngradeEmail, sendEmail } = await import("./services/email");
                  const users = await currentStorage.listUsersByOrg(org.id);
                  const admins = users.filter((u: any) => u.role === "admin");
                  const dashboardUrl = process.env.APP_URL || `https://${org.slug}.observatory-qa.com`;
                  for (const admin of admins) {
                    if (!admin.username?.includes("@")) continue; // skip non-email usernames
                    const emailOpts = buildTrialDowngradeEmail(org.name, dashboardUrl);
                    emailOpts.to = admin.username;
                    await sendEmail(emailOpts);
                  }
                } catch (emailErr) {
                  logger.warn({ err: emailErr, orgId: org.id }, "Failed to send trial downgrade email");
                }
              }
            }
          }

          if (downgraded > 0) {
            logger.info({ downgraded }, "Trial auto-downgrade complete");
          }
        } catch (error) {
          logger.error({ err: error }, "Error during trial auto-downgrade");
        }
      };

      // Proactive quota alerts: email org admins when usage hits 80% or 100%
      const runQuotaAlerts = async () => {
        try {
          const currentStorage = (await import("./storage")).storage;
          const orgs = await currentStorage.listOrganizations();
          const now = new Date();
          const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
          const dashboardUrl = process.env.APP_URL || "https://app.observatory-qa.com";

          for (const org of orgs) {
            const sub = await currentStorage.getSubscription(org.id);
            const tier = (sub?.planTier as PlanTier) || "free";
            const plan = PLAN_DEFINITIONS[tier];
            if (!plan) continue;

            const usage = await currentStorage.getUsageSummary(org.id, periodStart);
            const usageMap: Record<string, number> = {};
            for (const u of usage) usageMap[u.eventType] = u.totalQuantity;

            const warnings: Array<{ label: string; used: number; limit: number; pct: number }> = [];
            const check = (label: string, eventType: string, limitKey: keyof typeof plan.limits) => {
              const limit = plan.limits[limitKey] as number;
              if (limit <= 0 || limit === -1) return;
              const used = usageMap[eventType] || 0;
              const pct = Math.round((used / limit) * 100);
              if (pct >= 80) warnings.push({ label, used, limit, pct });
            };

            check("Calls", "transcription", "callsPerMonth");
            check("AI Analyses", "ai_analysis", "aiAnalysesPerMonth");

            if (warnings.length === 0) continue;

            // Get admin/manager users with email addresses
            const users = await currentStorage.listUsersByOrg(org.id);
            const recipients = users.filter(
              (u) => (u.role === "admin" || u.role === "manager") && u.username?.includes("@"),
            );
            if (recipients.length === 0) continue;

            const isExhausted = warnings.some((w) => w.pct >= 100);
            const orgName = org.name || org.slug || "Observatory QA";
            const emailTemplate = buildQuotaAlertEmail(orgName, warnings, isExhausted, dashboardUrl);

            await Promise.allSettled(recipients.map((user) => sendEmail({ ...emailTemplate, to: user.username })));

            logger.info(
              { orgId: org.id, warnings: warnings.length, isExhausted, recipients: recipients.length },
              "Quota alert emails sent",
            );
          }
        } catch (error) {
          logger.error({ err: error }, "Error during quota alert check");
        }
      };

      // Weekly digest — sends coaching/performance digest to org webhook
      const runWeeklyDigest = async () => {
        try {
          const webhookUrl = process.env.WEBHOOK_DIGEST_URL;
          if (!webhookUrl) return;

          const { generateWeeklyDigest } = await import("./services/proactive-alerts");
          const { sendSlackNotification } = await import("./services/notifications");
          const orgs = await storage.listOrganizations();

          for (const org of orgs) {
            try {
              const digest = await generateWeeklyDigest(org.id);
              if (digest.totalCalls === 0) continue;

              const text = [
                `*Weekly Digest: ${org.name}*`,
                `Calls: ${digest.totalCalls} | Avg Score: ${digest.avgScore} | Flagged: ${digest.flaggedCalls}`,
                `Sentiment: +${digest.sentiment.positive} / ~${digest.sentiment.neutral} / -${digest.sentiment.negative}`,
                digest.agentsNeedingAttention.length > 0
                  ? `Agents needing attention: ${digest.agentsNeedingAttention.map((a) => a.name).join(", ")}`
                  : "No agents flagged for review",
              ].join("\n");

              await sendSlackNotification({ channel: "digest", text, blocks: [] });
              logger.info({ orgId: org.id, totalCalls: digest.totalCalls }, "Weekly digest sent");
            } catch (orgErr) {
              logger.warn({ err: orgErr, orgId: org.id }, "Failed to send weekly digest for org");
            }
          }
        } catch (error) {
          logger.error({ err: error }, "Error during weekly digest generation");
        }
      };

      // Nightly audit chain integrity verification (2am UTC daily)
      const runAuditChainVerify = async () => {
        try {
          const { verifyAuditChain, logPhiAccess: logAuditAlert } = await import("./services/audit-log");
          const orgs = await storage.listOrganizations();
          let brokenCount = 0;

          for (const org of orgs) {
            try {
              const result = await verifyAuditChain(org.id);
              if (!result.valid) {
                brokenCount++;
                logger.error(
                  { orgId: org.id, brokenAt: result.brokenAt, checkedCount: result.checkedCount },
                  "[HIPAA_ALERT] Audit chain integrity BROKEN — possible tampering detected",
                );
                // Log a security alert into the audit trail itself
                logAuditAlert({
                  event: "audit_chain_tamper_detected",
                  orgId: org.id,
                  resourceType: "audit_logs",
                  ip: "localhost",
                  userAgent: "audit-chain-verifier",
                  role: "system",
                  detail: `Chain broken at sequence ${result.brokenAt} of ${result.checkedCount} entries`,
                });
              } else if (result.checkedCount > 0) {
                logger.info(
                  { orgId: org.id, checkedCount: result.checkedCount },
                  "Nightly audit chain verification: OK",
                );
              }
            } catch (orgErr) {
              logger.warn({ err: orgErr, orgId: org.id }, "Audit chain verify failed for org");
            }
          }

          if (brokenCount > 0) {
            logger.error({ brokenCount }, `[HIPAA_ALERT] ${brokenCount} org(s) have broken audit chains`);
          }
        } catch (error) {
          logger.error({ err: error }, "Nightly audit chain verification failed");
        }
      };

      // Run once on startup (after 30s delay to let auth settle)
      const retentionStartupTimer = setTimeout(() => {
        runRetention();
        runTrialDowngrade();
      }, 30_000);
      // Run quota alerts daily at a slight offset (60s after startup, then every 24h)
      const quotaAlertStartupTimer = setTimeout(runQuotaAlerts, 60_000);
      // Then run daily (every 24 hours)
      const retentionDailyTimer = setInterval(runRetention, 24 * 60 * 60 * 1000);
      const trialDowngradeTimer = setInterval(runTrialDowngrade, 24 * 60 * 60 * 1000);
      const quotaAlertDailyTimer = setInterval(runQuotaAlerts, 24 * 60 * 60 * 1000);
      // Weekly digest (every 7 days)
      const weeklyDigestTimer = setInterval(runWeeklyDigest, 7 * 24 * 60 * 60 * 1000);
      // Run nightly audit chain verification (daily, with startup delay of 120s to avoid boot noise)
      const auditChainStartupTimer = setTimeout(runAuditChainVerify, 120_000);
      const auditChainDailyTimer = setInterval(runAuditChainVerify, 24 * 60 * 60 * 1000);

      // --- Coaching: automation rules + effectiveness caching + follow-up reminders ---
      const runCoachingScheduledTasks = async () => {
        try {
          const { runAutomationRules, sweepEffectivenessSnapshots, getDueSoonSessions, getOverdueSessions } =
            await import("./services/coaching-engine");
          const { sendEmail } = await import("./services/email");
          const orgs = await storage.listOrganizations();
          for (const org of orgs) {
            if (org.status !== "active") continue;
            try {
              // Run automation rules daily
              const { triggered, sessionsCreated } = await runAutomationRules(org.id);
              if (sessionsCreated > 0)
                logger.info(
                  { orgId: org.id, triggered, sessionsCreated },
                  "Automation rules created coaching sessions",
                );

              // Cache effectiveness for completed sessions 30+ days old
              await sweepEffectivenessSnapshots(org.id);

              // Follow-up reminders: email managers about sessions due in 24h
              const dueSoon = await getDueSoonSessions(org.id, 24);
              if (dueSoon.length > 0) {
                // Group by assignedBy (manager)
                const byManager = new Map<string, typeof dueSoon>();
                for (const item of dueSoon) {
                  const mgr = item.session.assignedBy;
                  if (!byManager.has(mgr)) byManager.set(mgr, []);
                  byManager.get(mgr)!.push(item);
                }
                for (const [manager, items] of Array.from(byManager)) {
                  const list = items
                    .map((i) => `• ${i.session.title} (${i.employeeName}, due in ${i.hoursUntilDue}h)`)
                    .join("\n");
                  // Email if manager name looks like an email; otherwise log for webhook delivery
                  if (manager.includes("@")) {
                    await sendEmail({
                      to: manager,
                      subject: `Coaching follow-up reminder — ${items.length} session(s) due soon`,
                      text: `Hi,\n\nThe following coaching sessions are due within 24 hours:\n\n${list}\n\nPlease follow up with your team.`,
                      html: `<p>The following coaching sessions are due within 24 hours:</p><ul>${items.map((i) => `<li>${i.session.title} — ${i.employeeName} (${i.hoursUntilDue}h)</li>`).join("")}</ul>`,
                    }).catch(() => {});
                  }
                }
              }

              // Log overdue count (webhook/Slack alert handled by existing notifications)
              const overdue = await getOverdueSessions(org.id);
              if (overdue.length > 0) {
                logger.warn({ orgId: org.id, count: overdue.length }, "Overdue coaching sessions");
              }
            } catch (err) {
              logger.warn({ err, orgId: org.id }, "Coaching scheduled tasks failed for org");
            }
          }
        } catch (err) {
          logger.error({ err }, "Coaching scheduled tasks runner failed");
        }
      };
      const coachingStartupTimer = setTimeout(runCoachingScheduledTasks, 90_000);
      const coachingDailyTimer = setInterval(runCoachingScheduledTasks, 24 * 60 * 60 * 1000);

      // Graceful shutdown with HTTP connection draining
      let isShuttingDown = false;
      const DRAIN_TIMEOUT_MS = parseInt(process.env.SHUTDOWN_DRAIN_TIMEOUT || "15000", 10);

      const shutdown = async (signal: string) => {
        if (isShuttingDown) return;
        isShuttingDown = true;
        logger.info({ signal, drainTimeoutMs: DRAIN_TIMEOUT_MS }, "Graceful shutdown initiated");

        // Clear all background timers
        clearInterval(rateLimitCleanupTimer);
        clearTimeout(retentionStartupTimer);
        clearTimeout(quotaAlertStartupTimer);
        clearInterval(retentionDailyTimer);
        clearInterval(trialDowngradeTimer);
        clearInterval(quotaAlertDailyTimer);
        clearInterval(weeklyDigestTimer);
        clearTimeout(auditChainStartupTimer);
        clearInterval(auditChainDailyTimer);
        clearTimeout(coachingStartupTimer);
        clearInterval(coachingDailyTimer);

        // Stop accepting new connections and drain existing ones
        server.close(() => {
          logger.info("HTTP server closed — all connections drained");
        });

        // Force-close after drain timeout to prevent hanging
        const forceTimer = setTimeout(() => {
          logger.warn("Drain timeout reached — forcing shutdown");
          process.exit(1);
        }, DRAIN_TIMEOUT_MS);
        forceTimer.unref();

        // Close infrastructure in parallel
        const { closeWebSocket } = await import("./services/websocket");
        await Promise.all([closeQueues(), closeRedis(), closeWebSocket()]);

        // Close DB if PostgreSQL was initialized
        if (pgInitialized) {
          const { closeDatabase } = await import("./db/index");
          await closeDatabase();
        }

        // Close RAG worker pool if active
        try {
          const { closeRagWorkerPool } = await import("./services/rag-worker");
          await closeRagWorkerPool();
        } catch (err) {
          logger.debug({ err }, "RAG worker pool not initialized, skipping cleanup");
        }

        // Flush any pending OpenTelemetry spans/metrics
        await shutdownTelemetry();
        // Flush pending Sentry events before exit
        await flushSentry();

        clearTimeout(forceTimer);
        logger.info("Shutdown complete");
        process.exit(0);
      };
      process.on("SIGTERM", () => shutdown("SIGTERM"));
      process.on("SIGINT", () => shutdown("SIGINT"));
    },
  );

  // Global safety nets — catch promises and exceptions that slip through
  process.on("unhandledRejection", (reason: unknown) => {
    logger.error({ err: reason }, "Unhandled promise rejection");
  });
  process.on("uncaughtException", (error: Error) => {
    logger.error({ err: error }, "Uncaught exception — shutting down");
    process.exit(1);
  });
})();
