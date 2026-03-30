import { AsyncLocalStorage } from "async_hooks";
import { randomUUID } from "crypto";
import type { Request, Response, NextFunction } from "express";

interface CorrelationContext {
  correlationId: string;
}

export const correlationStore = new AsyncLocalStorage<CorrelationContext>();

export function getCorrelationId(): string | undefined {
  return correlationStore.getStore()?.correlationId;
}

export function correlationIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const correlationId =
    (req.headers["x-correlation-id"] as string) || (req.headers["x-request-id"] as string) || randomUUID();
  res.setHeader("X-Correlation-Id", correlationId);
  correlationStore.run({ correlationId }, () => {
    next();
  });
}
