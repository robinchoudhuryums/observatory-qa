/**
 * Zod-based request validation middleware.
 *
 * Validates req.body, req.query, or req.params against Zod schemas,
 * returning standardized 400 errors with field-level details.
 *
 * Usage:
 *   import { validateBody, validateQuery } from "../middleware/validate";
 *   import { z } from "zod";
 *
 *   const CreateEmployeeSchema = z.object({
 *     name: z.string().min(1),
 *     email: z.string().email(),
 *   });
 *
 *   app.post("/api/employees", validateBody(CreateEmployeeSchema), (req, res) => {
 *     // req.body is typed and validated
 *   });
 */
import type { Request, Response, NextFunction } from "express";
import type { ZodSchema, ZodError } from "zod";

function formatZodError(error: ZodError): { field: string; message: string }[] {
  return error.errors.map((e) => ({
    field: e.path.join("."),
    message: e.message,
  }));
}

/**
 * Validate request body against a Zod schema.
 * On failure, returns 400 with structured error details.
 */
export function validateBody<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({
        message: "Validation failed",
        code: "OBS-VALIDATION-001",
        errors: formatZodError(result.error),
      });
      return;
    }
    req.body = result.data;
    next();
  };
}

/**
 * Validate request query parameters against a Zod schema.
 * On failure, returns 400 with structured error details.
 */
export function validateQuery<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      res.status(400).json({
        message: "Invalid query parameters",
        code: "OBS-VALIDATION-002",
        errors: formatZodError(result.error),
      });
      return;
    }
    // Replace query with parsed (coerced) values
    (req as any).validatedQuery = result.data;
    next();
  };
}

/**
 * Validate request params against a Zod schema.
 * On failure, returns 400 with structured error details.
 */
export function validateParams<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      res.status(400).json({
        message: "Invalid path parameters",
        code: "OBS-VALIDATION-003",
        errors: formatZodError(result.error),
      });
      return;
    }
    next();
  };
}
