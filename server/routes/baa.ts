/**
 * Business Associate Agreement (BAA) management routes.
 *
 * HIPAA §164.502(e) requires covered entities to maintain BAAs with every
 * sub-processor that handles PHI. These routes track BAA lifecycle:
 * creation, renewal, expiry alerting, and termination.
 *
 * All routes require admin role.
 */
import type { Express } from "express";
import { randomUUID } from "crypto";
import { storage } from "../storage";
import { requireAuth, requireRole, injectOrgContext } from "../auth";
import { logPhiAccess, auditContext } from "../services/audit-log";
import { asyncHandler, AppError } from "../middleware/error-handler";
import { logger } from "../services/logger";

/** Standard BAA vendor types for healthcare SaaS. */
const VENDOR_TYPES = [
  "cloud_provider",
  "transcription",
  "ai_analysis",
  "ehr",
  "email",
  "payment",
  "analytics",
  "hosting",
  "backup",
  "communication",
  "other",
] as const;

interface BaaRecord {
  id: string;
  orgId: string;
  vendorName: string;
  vendorType: string;
  description?: string;
  contactName?: string;
  contactEmail?: string;
  status: string;
  signedAt?: string;
  expiresAt?: string;
  renewalReminderDays?: number;
  signedBy?: string;
  vendorSignatory?: string;
  documentUrl?: string;
  notes?: string;
  phiCategories?: string[];
  createdAt?: string;
  updatedAt?: string;
}

export function registerBaaRoutes(app: Express): void {
  // List all BAAs for the org
  app.get(
    "/api/admin/baa",
    requireAuth, injectOrgContext, requireRole("admin"),
    asyncHandler(async (req, res) => {
      const orgId = req.orgId!;
      const baas = await storage.listBusinessAssociateAgreements?.(orgId);
      if (!baas) {
        // Storage backend doesn't support BAA (memory/cloud mode)
        res.json([]);
        return;
      }

      logPhiAccess({
        ...auditContext(req),
        event: "view_baa_list",
        resourceType: "baa",
        detail: `Listed ${baas.length} BAAs`,
      });

      res.json(baas);
    }),
  );

  // Get a single BAA
  app.get(
    "/api/admin/baa/:id",
    requireAuth, injectOrgContext, requireRole("admin"),
    asyncHandler(async (req, res) => {
      const baa = await storage.getBusinessAssociateAgreement?.(req.orgId!, req.params.id);
      if (!baa) throw new AppError(404, "BAA not found");
      res.json(baa);
    }),
  );

  // Create a new BAA record
  app.post(
    "/api/admin/baa",
    requireAuth, injectOrgContext, requireRole("admin"),
    asyncHandler(async (req, res) => {
      const { vendorName, vendorType, description, contactName, contactEmail, signedAt, expiresAt, renewalReminderDays, signedBy, vendorSignatory, documentUrl, notes, phiCategories } = req.body;

      if (!vendorName || typeof vendorName !== "string" || !vendorName.trim()) {
        throw new AppError(400, "vendorName is required");
      }
      if (!vendorType || !VENDOR_TYPES.includes(vendorType as any)) {
        throw new AppError(400, `vendorType must be one of: ${VENDOR_TYPES.join(", ")}`);
      }

      const id = randomUUID();
      const now = new Date().toISOString();

      const baa: BaaRecord = {
        id,
        orgId: req.orgId!,
        vendorName: vendorName.trim(),
        vendorType,
        description: typeof description === "string" ? description.slice(0, 2000) : undefined,
        contactName: typeof contactName === "string" ? contactName.slice(0, 255) : undefined,
        contactEmail: typeof contactEmail === "string" ? contactEmail.slice(0, 255) : undefined,
        status: "active",
        signedAt: typeof signedAt === "string" ? signedAt : undefined,
        expiresAt: typeof expiresAt === "string" ? expiresAt : undefined,
        renewalReminderDays: typeof renewalReminderDays === "number" ? Math.max(1, Math.min(365, renewalReminderDays)) : 30,
        signedBy: typeof signedBy === "string" ? signedBy.slice(0, 255) : undefined,
        vendorSignatory: typeof vendorSignatory === "string" ? vendorSignatory.slice(0, 255) : undefined,
        documentUrl: typeof documentUrl === "string" ? documentUrl.slice(0, 2000) : undefined,
        notes: typeof notes === "string" ? notes.slice(0, 5000) : undefined,
        phiCategories: Array.isArray(phiCategories) ? phiCategories.filter((c: unknown) => typeof c === "string").slice(0, 20) : [],
        createdAt: now,
        updatedAt: now,
      };

      const created = await storage.createBusinessAssociateAgreement?.(req.orgId!, baa);
      if (!created) throw new AppError(500, "BAA storage not available");

      logPhiAccess({
        ...auditContext(req),
        event: "create_baa",
        resourceType: "baa",
        resourceId: id,
        detail: `Created BAA for vendor: ${vendorName}`,
      });

      logger.info({ orgId: req.orgId, baaId: id, vendor: vendorName }, "BAA created");
      res.status(201).json(created);
    }),
  );

  // Update a BAA
  app.patch(
    "/api/admin/baa/:id",
    requireAuth, injectOrgContext, requireRole("admin"),
    asyncHandler(async (req, res) => {
      const existing = await storage.getBusinessAssociateAgreement?.(req.orgId!, req.params.id);
      if (!existing) throw new AppError(404, "BAA not found");

      const allowed = [
        "vendorName", "vendorType", "description", "contactName", "contactEmail",
        "status", "signedAt", "expiresAt", "renewalReminderDays", "signedBy",
        "vendorSignatory", "documentUrl", "notes", "phiCategories",
      ];
      const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
      for (const key of allowed) {
        if (req.body[key] !== undefined) updates[key] = req.body[key];
      }

      if (updates.status && !["active", "expired", "terminated", "pending"].includes(updates.status as string)) {
        throw new AppError(400, "status must be one of: active, expired, terminated, pending");
      }

      const updated = await storage.updateBusinessAssociateAgreement?.(req.orgId!, req.params.id, updates);
      if (!updated) throw new AppError(500, "Failed to update BAA");

      logPhiAccess({
        ...auditContext(req),
        event: "update_baa",
        resourceType: "baa",
        resourceId: req.params.id,
        detail: `Updated BAA: ${existing.vendorName}`,
      });

      res.json(updated);
    }),
  );

  // Delete a BAA (soft — changes status to terminated)
  app.delete(
    "/api/admin/baa/:id",
    requireAuth, injectOrgContext, requireRole("admin"),
    asyncHandler(async (req, res) => {
      const existing = await storage.getBusinessAssociateAgreement?.(req.orgId!, req.params.id);
      if (!existing) throw new AppError(404, "BAA not found");

      await storage.updateBusinessAssociateAgreement?.(req.orgId!, req.params.id, {
        status: "terminated",
        updatedAt: new Date().toISOString(),
      });

      logPhiAccess({
        ...auditContext(req),
        event: "terminate_baa",
        resourceType: "baa",
        resourceId: req.params.id,
        detail: `Terminated BAA: ${existing.vendorName}`,
      });

      res.json({ success: true, status: "terminated" });
    }),
  );

  // Get BAAs nearing expiry
  app.get(
    "/api/admin/baa/expiring",
    requireAuth, injectOrgContext, requireRole("admin"),
    asyncHandler(async (req, res) => {
      const baas = await storage.listBusinessAssociateAgreements?.(req.orgId!);
      if (!baas) { res.json([]); return; }

      const now = Date.now();
      const expiring = baas
        .filter((b: BaaRecord) => {
          if (b.status !== "active" || !b.expiresAt) return false;
          const expiryMs = new Date(b.expiresAt).getTime();
          const reminderMs = (b.renewalReminderDays || 30) * 24 * 60 * 60 * 1000;
          return expiryMs - now <= reminderMs;
        })
        .map((b: BaaRecord) => ({
          ...b,
          daysUntilExpiry: Math.ceil((new Date(b.expiresAt!).getTime() - now) / (24 * 60 * 60 * 1000)),
          urgency: (() => {
            const days = Math.ceil((new Date(b.expiresAt!).getTime() - now) / (24 * 60 * 60 * 1000));
            if (days <= 0) return "expired";
            if (days <= 7) return "critical";
            if (days <= 14) return "warning";
            return "upcoming";
          })(),
        }))
        .sort((a: any, b: any) => a.daysUntilExpiry - b.daysUntilExpiry);

      res.json(expiring);
    }),
  );

  // Get vendor types enum
  app.get("/api/admin/baa/vendor-types", requireAuth, injectOrgContext, requireRole("admin"), (_req, res) => {
    res.json(VENDOR_TYPES);
  });
}
