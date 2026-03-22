import type { Express } from "express";
import { storage } from "../storage";
import { requireAuth, requireRole, injectOrgContext } from "../auth";
import { insertAccessRequestSchema } from "@shared/schema";
import { z } from "zod";
import { logger } from "../services/logger";
import { parsePagination, paginateArray } from "./helpers";

export function registerAccessRoutes(app: Express): void {
  // ==================== ACCESS REQUEST ROUTES (unauthenticated) ====================

  // Submit an access request (public — anyone can request from login page)
  // orgSlug is required in the body to scope to the correct organization
  app.post("/api/access-requests", async (req, res) => {
    try {
      const parsed = insertAccessRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ message: "Invalid request data", errors: parsed.error.flatten() });
        return;
      }
      // Resolve org from slug in body, or use default
      const orgSlug = req.body.orgSlug || process.env.DEFAULT_ORG_SLUG || "default";
      const org = await storage.getOrganizationBySlug(orgSlug);
      if (!org) {
        res.status(400).json({ message: "Organization not found" });
        return;
      }
      const request = await storage.createAccessRequest(org.id, parsed.data);
      res.status(201).json({ message: "Access request submitted. An administrator will review your request.", id: request.id });
    } catch (error) {
      logger.error({ err: error }, "Failed to submit access request");
      res.status(500).json({ message: "Failed to submit access request" });
    }
  });

  // ==================== ACCESS REQUEST ADMIN ROUTES (admin only) ====================

  // List all access requests (paginated)
  app.get("/api/access-requests", requireAuth, injectOrgContext, requireRole("admin"), async (req, res) => {
    try {
      const { limit, offset } = parsePagination(req.query);
      const requests = await storage.getAllAccessRequests(req.orgId!);
      res.json(paginateArray(requests, limit, offset));
    } catch (error) {
      logger.error({ err: error }, "Failed to fetch access requests");
      res.status(500).json({ message: "Failed to fetch access requests" });
    }
  });

  // Approve or deny an access request
  const accessRequestUpdateSchema = z.object({
    status: z.enum(["approved", "denied"]),
  }).strict();

  app.patch("/api/access-requests/:id", requireAuth, injectOrgContext, requireRole("admin"), async (req, res) => {
    try {
      const parsed = accessRequestUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ message: "Status must be 'approved' or 'denied'" });
        return;
      }
      const updated = await storage.updateAccessRequest(req.orgId!, req.params.id, {
        status: parsed.data.status,
        reviewedBy: req.user?.username,
        reviewedAt: new Date().toISOString(),
      });
      if (!updated) {
        res.status(404).json({ message: "Access request not found" });
        return;
      }
      res.json(updated);
    } catch (error) {
      logger.error({ err: error }, "Failed to update access request");
      res.status(500).json({ message: "Failed to update access request" });
    }
  });
}
