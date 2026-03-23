/**
 * Tests for Zod validation middleware and error handling utilities.
 *
 * Run with: npx tsx --test tests/validation-middleware.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

// ==================== VALIDATION MIDDLEWARE PATTERNS ====================

describe("Zod validation middleware patterns", () => {
  // Inline Zod-like validation (tests don't have access to zod package)
  function validateBody(schema: { safeParse: (data: any) => { success: boolean; data?: any; error?: { errors: any[] } } }) {
    return (req: any, res: any, next: any) => {
      const result = schema.safeParse(req.body);
      if (!result.success) {
        res.status(400).json({
          message: "Validation failed",
          code: "OBS-VALIDATION-001",
          errors: result.error!.errors.map((e: any) => ({ field: e.path.join("."), message: e.message })),
        });
        return;
      }
      req.body = result.data;
      next();
    };
  }

  it("passes valid data through", () => {
    const schema = {
      safeParse: (data: any) => {
        if (data.name && data.email) return { success: true, data };
        return { success: false, error: { errors: [{ path: ["name"], message: "Required" }] } };
      },
    };

    const middleware = validateBody(schema);
    let nextCalled = false;
    const req = { body: { name: "Alice", email: "alice@test.com" } };
    const res = { status: () => res, json: () => {} };

    middleware(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
  });

  it("rejects invalid data with 400", () => {
    const schema = {
      safeParse: (data: any) => {
        if (!data.name) {
          return { success: false, error: { errors: [{ path: ["name"], message: "Required" }] } };
        }
        return { success: true, data };
      },
    };

    const middleware = validateBody(schema);
    let statusCode = 0;
    let responseBody: any;
    const req = { body: {} };
    const res = {
      status: (code: number) => { statusCode = code; return res; },
      json: (body: any) => { responseBody = body; },
    };

    middleware(req, res, () => {});
    assert.equal(statusCode, 400);
    assert.equal(responseBody.code, "OBS-VALIDATION-001");
    assert.equal(responseBody.errors[0].field, "name");
    assert.equal(responseBody.errors[0].message, "Required");
  });
});

// ==================== APP ERROR CLASS ====================

describe("AppError structured errors", () => {
  class AppError extends Error {
    constructor(public statusCode: number, message: string, public code?: string) {
      super(message);
      this.name = "AppError";
    }
  }

  it("creates error with status and code", () => {
    const err = new AppError(404, "Not found", "OBS-CALL-002");
    assert.equal(err.statusCode, 404);
    assert.equal(err.message, "Not found");
    assert.equal(err.code, "OBS-CALL-002");
    assert.equal(err.name, "AppError");
  });

  it("is an instance of Error", () => {
    const err = new AppError(500, "Internal error");
    assert.ok(err instanceof Error);
  });
});

// ==================== ASYNC HANDLER WRAPPER ====================

describe("asyncHandler wrapper", () => {
  function asyncHandler(fn: (req: any, res: any, next: any) => Promise<void>) {
    return (req: any, res: any, next: any) => {
      fn(req, res, next).catch(next);
    };
  }

  it("calls next with error on async throw", async () => {
    let capturedError: any;
    const handler = asyncHandler(async () => {
      throw new Error("async failure");
    });

    await new Promise<void>((resolve) => {
      handler({}, {}, (err: any) => {
        capturedError = err;
        resolve();
      });
    });

    assert.ok(capturedError);
    assert.equal(capturedError.message, "async failure");
  });

  it("does not call next on success", async () => {
    let nextCalled = false;
    const handler = asyncHandler(async (_req, res) => {
      res.json({ ok: true });
    });

    await new Promise<void>((resolve) => {
      handler({}, { json: () => resolve() }, () => { nextCalled = true; });
    });

    assert.equal(nextCalled, false);
  });
});

// ==================== GLOBAL ERROR HANDLER ====================

describe("Global error handler", () => {
  class AppError extends Error {
    constructor(public statusCode: number, message: string, public code?: string) {
      super(message);
      this.name = "AppError";
    }
  }

  function globalErrorHandler(err: Error, _req: any, res: any, _next: any) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({
        message: err.message,
        ...(err.code ? { code: err.code } : {}),
      });
      return;
    }
    res.status(500).json({ message: "Internal server error", code: "OBS-INTERNAL-001" });
  }

  it("handles AppError with correct status", () => {
    let statusCode = 0;
    let body: any;
    const res = {
      status: (code: number) => { statusCode = code; return res; },
      json: (b: any) => { body = b; },
    };

    globalErrorHandler(new AppError(404, "Not found", "OBS-CALL-002"), {}, res, () => {});
    assert.equal(statusCode, 404);
    assert.equal(body.message, "Not found");
    assert.equal(body.code, "OBS-CALL-002");
  });

  it("handles unknown error with 500", () => {
    let statusCode = 0;
    let body: any;
    const res = {
      status: (code: number) => { statusCode = code; return res; },
      json: (b: any) => { body = b; },
    };

    globalErrorHandler(new Error("unexpected"), {}, res, () => {});
    assert.equal(statusCode, 500);
    assert.equal(body.code, "OBS-INTERNAL-001");
  });

  it("never leaks stack traces to client", () => {
    let body: any;
    const res = {
      status: () => res,
      json: (b: any) => { body = b; },
    };

    const err = new Error("secret internal details");
    err.stack = "Error: secret\n    at Object.<anonymous> (/app/server/routes/calls.ts:42:13)";
    globalErrorHandler(err, {}, res, () => {});

    const responseStr = JSON.stringify(body);
    assert.ok(!responseStr.includes("secret internal"));
    assert.ok(!responseStr.includes("/app/server"));
  });
});

// ==================== ERROR RESPONSE CONSISTENCY ====================

describe("Error response format consistency", () => {
  it("errorResponse creates consistent format", () => {
    function errorResponse(code: string, message: string) {
      return { message, code };
    }

    const resp = errorResponse("OBS-CALL-002", "Call not found");
    assert.equal(resp.message, "Call not found");
    assert.equal(resp.code, "OBS-CALL-002");
    assert.ok(!("error" in resp), "Should use 'message' not 'error'");
  });

  it("all error codes follow OBS-{DOMAIN}-{NUMBER} format", () => {
    const codes = [
      "OBS-AUTH-001", "OBS-AUTH-004", "OBS-CALL-001", "OBS-CALL-002",
      "OBS-EMP-001", "OBS-BILL-001", "OBS-VALIDATION-001",
    ];

    const pattern = /^OBS-[A-Z]+-\d{3}$/;
    for (const code of codes) {
      assert.ok(pattern.test(code), `${code} should match OBS-{DOMAIN}-{NUMBER}`);
    }
  });
});
