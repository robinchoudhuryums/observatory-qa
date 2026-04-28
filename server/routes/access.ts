import type { Express } from "express";
import { storage } from "../storage";
import { requireAuth, requireRole, injectOrgContext } from "../auth";
import { insertAccessRequestSchema } from "@shared/schema";
import { z } from "zod";
import { asyncHandler, AppError } from "../middleware/error-handler";

const accessRequestUpdateSchema = z
  .object({
    status: z.enum(["approved", "denied"]),
  })
  .strict();

export function registerAccessRoutes(app: Express): void {
  // Submit an access request (public — anyone can request from login page)
  app.post(
    "/api/access-requests",
    asyncHandler(async (req, res) => {
      const parsed = insertAccessRequestSchema.safeParse(req.body);
      if (!parsed.success) throw new AppError(400, "Invalid request data");

      const orgSlug = req.body.orgSlug || process.env.DEFAULT_ORG_SLUG || "default";
      const org = await storage.getOrganizationBySlug(orgSlug);
      if (!org) throw new AppError(400, "Organization not found");

      const request = await storage.createAccessRequest(org.id, parsed.data);
      res.status(201).json({
        message: "Access request submitted. An administrator will review your request.",
        id: request.id,
      });
    }),
  );

  // List all access requests
  app.get(
    "/api/access-requests",
    requireAuth,
    injectOrgContext,
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const requests = await storage.getAllAccessRequests(req.orgId!);
      res.json(requests);
    }),
  );

  // Approve or deny an access request
  app.patch(
    "/api/access-requests/:id",
    requireAuth,
    injectOrgContext,
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const parsed = accessRequestUpdateSchema.safeParse(req.body);
      if (!parsed.success) throw new AppError(400, "Status must be 'approved' or 'denied'");

      const updated = await storage.updateAccessRequest(req.orgId!, req.params.id, {
        status: parsed.data.status,
        reviewedBy: req.user?.username,
        reviewedAt: new Date().toISOString(),
      });
      if (!updated) throw new AppError(404, "Access request not found");

      res.json(updated);
    }),
  );
}
