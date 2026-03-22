/**
 * Server-side Sentry integration.
 *
 * Initializes Sentry for Node.js when SENTRY_DSN is set.
 * Provides Express middleware for error capture and request context.
 *
 * HIPAA: sendDefaultPii is disabled, and beforeSend strips potential PHI patterns.
 */
import * as Sentry from "@sentry/node";
import type { Request, Response, NextFunction } from "express";
import { logger } from "./logger";

let initialized = false;

/**
 * Initialize Sentry for the server. Call once before Express middleware setup.
 */
export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    logger.info("SENTRY_DSN not set — server errors logged via Pino only");
    return;
  }

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || "development",
    release: process.env.APP_VERSION || "dev",
    // Sample 100% of errors, 10% of transactions in production
    sampleRate: 1.0,
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
    // HIPAA: never send PII automatically
    sendDefaultPii: false,
    ignoreErrors: [
      "ECONNRESET",
      "EPIPE",
      "ECONNREFUSED",
      "socket hang up",
    ],
    beforeSend(event) {
      // Strip PHI patterns from error messages
      if (event.message) {
        event.message = sanitizeForHipaa(event.message);
      }
      // Strip request body to prevent PHI leakage (transcripts, clinical notes)
      if (event.request?.data) {
        event.request.data = "[REDACTED]";
      }
      return event;
    },
  });

  initialized = true;
  logger.info("Sentry initialized for server error tracking");
}

/**
 * Express middleware: captures unhandled errors and sends to Sentry.
 * Place AFTER all routes but BEFORE the final error handler.
 */
export function sentryErrorMiddleware(err: Error, req: Request, res: Response, next: NextFunction): void {
  if (!initialized) {
    next(err);
    return;
  }

  Sentry.withScope((scope) => {
    // Add org context without exposing user PII
    const orgId = (req as any).orgId;
    if (orgId) scope.setTag("orgId", orgId);

    const user = (req as any).user;
    if (user?.id) scope.setUser({ id: String(user.id) });

    scope.setTag("path", req.path);
    scope.setTag("method", req.method);

    Sentry.captureException(err);
  });

  next(err);
}

/**
 * Capture a non-fatal error/warning to Sentry.
 */
export function captureServerError(error: unknown, context?: Record<string, string>): void {
  if (!initialized) return;
  const errorObj = error instanceof Error ? error : new Error(String(error));

  Sentry.withScope((scope) => {
    if (context) {
      Object.entries(context).forEach(([key, value]) => scope.setTag(key, value));
    }
    Sentry.captureException(errorObj);
  });
}

/**
 * Flush Sentry events before shutdown. Call during graceful shutdown.
 */
export async function flushSentry(timeoutMs = 2000): Promise<void> {
  if (!initialized) return;
  await Sentry.close(timeoutMs);
}

function sanitizeForHipaa(message: string): string {
  message = message.replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[REDACTED-SSN]");
  message = message.replace(/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, "[REDACTED-PHONE]");
  message = message.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, "[REDACTED-EMAIL]");
  return message;
}
