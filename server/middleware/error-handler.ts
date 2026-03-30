/**
 * Centralized error handling middleware.
 *
 * Provides:
 *   - AppError class for throwing structured errors from route handlers
 *   - asyncHandler wrapper to catch async errors without try/catch boilerplate
 *   - Global error handler middleware (registered last in Express chain)
 *
 * Usage:
 *   import { asyncHandler, AppError } from "../middleware/error-handler";
 *
 *   app.get("/api/resource/:id", asyncHandler(async (req, res) => {
 *     const item = await storage.getItem(req.params.id);
 *     if (!item) throw new AppError(404, "Resource not found", "OBS-RES-001");
 *     res.json(item);
 *   }));
 */
import type { Request, Response, NextFunction } from "express";
import { logger } from "../services/logger";

/**
 * Structured application error with HTTP status and error code.
 */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

/**
 * Wraps an async route handler to automatically catch errors
 * and pass them to Express error handling middleware.
 *
 * Eliminates the need for try/catch in every route handler.
 */
export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}

/**
 * Global error handler — register as the last middleware.
 *
 * Handles AppError (structured) and unknown errors (500).
 * Never leaks stack traces or internal details to clients (HIPAA).
 */
export function globalErrorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      message: err.message,
      ...(err.code ? { code: err.code } : {}),
    });
    return;
  }

  // Unexpected error — log internally, return generic message
  logger.error({ err }, "Unhandled error in request");
  res.status(500).json({
    message: "Internal server error",
    code: "OBS-INTERNAL-001",
  });
}
