/**
 * Centralized error reporting via Sentry.
 *
 * Initializes Sentry on the client side when VITE_SENTRY_DSN is set.
 * Falls back to structured console logging when Sentry is not configured.
 */
import * as Sentry from "@sentry/react";

let sentryInitialized = false;

/**
 * Initialize Sentry. Call once at app startup (main.tsx).
 */
export function initErrorReporting(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) {
    console.info("[ErrorReporting] VITE_SENTRY_DSN not set — errors logged to console only"); // eslint-disable-line no-console
    return;
  }

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE || "development",
    release: import.meta.env.VITE_APP_VERSION || "dev",
    // Sample 100% of errors, 10% of transactions in production
    sampleRate: 1.0,
    tracesSampleRate: import.meta.env.MODE === "production" ? 0.1 : 1.0,
    // Don't send PII — HIPAA compliance
    sendDefaultPii: false,
    // Filter out noisy browser extension errors
    ignoreErrors: [
      "ResizeObserver loop",
      "Non-Error promise rejection",
      /Loading chunk \d+ failed/,
      /Failed to fetch dynamically imported module/,
    ],
    beforeSend(event) {
      // Strip any PHI that might leak into error messages
      if (event.message) {
        event.message = sanitizeForHipaa(event.message);
      }
      return event;
    },
  });

  sentryInitialized = true;
  console.info("[ErrorReporting] Sentry initialized"); // eslint-disable-line no-console
}

interface ErrorContext {
  component?: string;
  action?: string;
  userId?: string;
  extra?: Record<string, unknown>;
}

export function reportError(error: unknown, context?: ErrorContext): void {
  const errorObj = error instanceof Error ? error : new Error(String(error));

  if (sentryInitialized) {
    // Sentry is active — send to Sentry only. Avoid console.error in production
    // because browser devtools can capture values from React component stacks
    // or stringified error objects that may contain PHI (HIPAA concern).
    Sentry.withScope((scope) => {
      if (context?.component) scope.setTag("component", context.component);
      if (context?.action) scope.setTag("action", context.action);
      if (context?.userId) scope.setUser({ id: context.userId });
      if (context?.extra) scope.setExtras(context.extra);
      Sentry.captureException(errorObj);
    });
  } else {
    // Sentry not configured — fall back to console for dev visibility only.

    console.error("[APP_ERROR]", {
      timestamp: new Date().toISOString(),
      message: errorObj.message,
      component: context?.component,
      action: context?.action,
      ...(import.meta.env.DEV ? { stack: errorObj.stack, extra: context?.extra } : {}),
    });
  }
}

/**
 * Set the current user context for Sentry (call after login).
 */
export function setErrorReportingUser(user: { id: string; orgId?: string; role?: string } | null): void {
  if (!sentryInitialized) return;
  if (user) {
    Sentry.setUser({ id: user.id, orgId: user.orgId, role: user.role } as Record<string, unknown>);
  } else {
    Sentry.setUser(null);
  }
}

/**
 * Wrap an async function to catch and report errors automatically.
 */
export function withErrorReporting<T extends (...args: unknown[]) => Promise<unknown>>(
  fn: T,
  context?: ErrorContext,
): T {
  return (async (...args: unknown[]) => {
    try {
      return await fn(...args);
    } catch (error) {
      reportError(error, context);
      throw error;
    }
  }) as T;
}

/** Strip patterns that might contain PHI from error messages */
function sanitizeForHipaa(message: string): string {
  // Redact potential SSN patterns
  message = message.replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[REDACTED-SSN]");
  // Redact potential phone numbers
  message = message.replace(/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, "[REDACTED-PHONE]");
  // Redact email addresses
  message = message.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, "[REDACTED-EMAIL]");
  return message;
}
