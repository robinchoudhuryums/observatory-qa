/**
 * CSRF middleware (double-submit cookie).
 *
 * Lives in its own module so HTTP integration tests can mount the real
 * middleware on a fresh Express app without importing `server/index.ts` and
 * triggering its startup side effects (port binding, scheduled tasks, etc).
 *
 * - Sets a `csrf-token` cookie (readable by JS) on every response that doesn't
 *   already have one.
 * - For state-changing /api requests, requires the same token in the
 *   `x-csrf-token` header. Compared with timingSafeEqual.
 * - Skips: safe methods, non-/api paths, Stripe webhook (own sig), API key
 *   bearer auth, SCIM, SSO callbacks, AssemblyAI webhook, pre-auth paths
 *   (login/register/forgot/reset).
 */
import type { Request, RequestHandler } from "express";
import { randomBytes, timingSafeEqual } from "crypto";

function parseCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie || "";
  const match = header
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${name}=`));
  return match ? match.slice(name.length + 1) : undefined;
}

export const csrfMiddleware: RequestHandler = (req, res, next) => {
  if (!parseCookie(req, "csrf-token")) {
    const token = randomBytes(32).toString("hex");
    res.cookie("csrf-token", token, {
      httpOnly: false,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production" && !process.env.DISABLE_SECURE_COOKIE,
      path: "/",
    });
  }

  if (["GET", "HEAD", "OPTIONS"].includes(req.method) || !req.path.startsWith("/api")) {
    return next();
  }

  if (req.path === "/api/billing/webhook") return next();

  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer obs_k_")) return next();

  if (req.path.startsWith("/api/scim/")) return next();
  if (req.path.startsWith("/api/auth/sso/callback")) return next();
  if (req.path === "/api/webhooks/assemblyai") return next();

  const csrfExemptPaths = [
    "/api/auth/login",
    "/api/auth/register",
    "/api/auth/forgot-password",
    "/api/auth/reset-password",
  ];
  if (csrfExemptPaths.includes(req.path)) return next();

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
};
