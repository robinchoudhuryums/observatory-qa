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
import { redactPhi } from "../utils/phi-redactor";

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
      // Strip PHI patterns from error messages using the shared redactor
      if (event.message) {
        event.message = redactPhi(event.message);
      }
      // Selectively redact PHI from request body instead of blanket stripping.
      // This preserves debugging context (error types, status codes) while
      // removing PHI patterns (SSN, phone, email, MRN, addresses).
      if (event.request?.data) {
        if (typeof event.request.data === "string") {
          event.request.data = redactPhi(event.request.data);
        } else {
          // For non-string data, redact the stringified form
          event.request.data = redactPhi(JSON.stringify(event.request.data));
        }
      }
      // Redact PHI from exception values/messages
      if (event.exception?.values) {
        for (const ex of event.exception.values) {
          if (ex.value) ex.value = redactPhi(ex.value);
        }
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

/** @deprecated Use redactPhi() from phi-redactor.ts instead — kept for backward compatibility */
function sanitizeForHipaa(message: string): string {
  return redactPhi(message);
}
