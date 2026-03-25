import type { Express, Request, Response, NextFunction } from "express";
import { createHash, randomBytes } from "crypto";
import { storage } from "../storage";
import { logger } from "../services/logger";
import { logPhiAccess } from "../services/audit-log";
import { syncSeatUsage } from "./billing";
import type { OrgSettings } from "../../shared/schema";

/**
 * SCIM 2.0 provisioning (Enterprise plan feature).
 *
 * Enables automated user lifecycle management from Identity Providers (Okta, Azure AD, etc.).
 * Supports create, read, update, deactivate, and list operations on Users.
 *
 * Authentication: Bearer token per org (generated via POST /api/admin/scim/token/rotate).
 * Base path: /api/scim/v2  (standard SCIM base URI)
 *
 * Implemented endpoints:
 *   GET    /api/scim/v2/ServiceProviderConfig  — capability advertisement
 *   GET    /api/scim/v2/Schemas                — schema definitions
 *   GET    /api/scim/v2/Users                  — list/filter users
 *   POST   /api/scim/v2/Users                  — provision (create) user
 *   GET    /api/scim/v2/Users/:id              — get user
 *   PUT    /api/scim/v2/Users/:id              — replace user
 *   PATCH  /api/scim/v2/Users/:id              — partial update (deactivate, rename, role change)
 *   DELETE /api/scim/v2/Users/:id              — deprovision user
 *
 * Role mapping: SCIM groups sent in the `roles` or custom extension are mapped to
 * Observatory roles (admin/manager/viewer). Falls back to "viewer" for unknown roles.
 */

const SCIM_CONTENT_TYPE = "application/scim+json";
const SCIM_USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User";
const SCIM_LIST_RESPONSE_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:ListResponse";
const SCIM_ERROR_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:Error";

// Observable extension for Observatory-specific attributes
const OBS_USER_EXT = "urn:ietf:params:scim:schemas:extension:observatory:2.0:User";

function scimError(res: Response, status: number, detail: string, scimType?: string): void {
  res.status(status).type(SCIM_CONTENT_TYPE).json({
    schemas: [SCIM_ERROR_SCHEMA],
    status: String(status),
    detail,
    ...(scimType ? { scimType } : {}),
  });
}

/**
 * Map an Observatory user to SCIM User resource representation.
 */
function toScimUser(user: {
  id: string;
  username: string;
  name: string;
  role: string;
  orgId: string;
  createdAt?: string;
}, orgSlug: string, active = true) {
  const [firstName, ...rest] = (user.name || "").split(" ");
  const lastName = rest.join(" ");

  return {
    schemas: [SCIM_USER_SCHEMA, OBS_USER_EXT],
    id: user.id,
    userName: user.username,
    name: {
      formatted: user.name,
      givenName: firstName || "",
      familyName: lastName || "",
    },
    emails: [{ value: user.username, primary: true, type: "work" }],
    active,
    meta: {
      resourceType: "User",
      created: user.createdAt || new Date().toISOString(),
      lastModified: user.createdAt || new Date().toISOString(),
      location: `/api/scim/v2/Users/${user.id}`,
      version: `W/"${createHash("md5").update(user.id + user.role).digest("hex").slice(0, 8)}"`,
    },
    // Observatory extension: expose role
    [OBS_USER_EXT]: {
      role: user.role,
      orgSlug,
    },
  };
}

/**
 * Map a SCIM role value to an Observatory role.
 */
function scimRoleToObs(scimRole: string | undefined): "admin" | "manager" | "viewer" {
  const map: Record<string, "admin" | "manager" | "viewer"> = {
    admin: "admin",
    administrator: "admin",
    manager: "manager",
    supervisor: "manager",
    viewer: "viewer",
    user: "viewer",
    member: "viewer",
    readonly: "viewer",
    read_only: "viewer",
  };
  return map[(scimRole || "").toLowerCase()] || "viewer";
}

/**
 * SCIM bearer token authentication middleware.
 * Reads the org from the token hash, sets req.orgId and req.orgSlug.
 */
async function scimAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) {
    scimError(res, 401, "Missing or invalid Authorization header");
    return;
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    scimError(res, 401, "Empty bearer token");
    return;
  }

  const tokenHash = createHash("sha256").update(token).digest("hex");

  try {
    // Find the org whose scimTokenHash matches
    // We search all orgs — in practice SCIM requests always include the token so this
    // resolves quickly. For high-volume deployments, a dedicated token-to-orgId index
    // can be added to the DB.
    const orgs = await storage.listOrganizations();
    const org = orgs.find((o: import("../../shared/schema").Organization) => {
      const settings = o.settings as OrgSettings | undefined;
      return settings?.scimEnabled && settings.scimTokenHash === tokenHash;
    });

    if (!org) {
      scimError(res, 401, "Invalid SCIM bearer token");
      return;
    }

    (req as any).orgId = org.id;
    (req as any).orgSlug = org.slug;
    (req as any).scimOrg = org;
    next();
  } catch (err) {
    logger.error({ err }, "SCIM auth error");
    scimError(res, 500, "Internal server error during authentication");
  }
}

export function registerScimRoutes(app: Express): void {

  // ── ServiceProviderConfig ─────────────────────────────────────────────────
  app.get("/api/scim/v2/ServiceProviderConfig", (_req, res) => {
    res.type(SCIM_CONTENT_TYPE).json({
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
      documentationUri: "https://observatory-qa.com/docs/scim",
      patch: { supported: true },
      bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
      filter: { supported: true, maxResults: 200 },
      changePassword: { supported: false },
      sort: { supported: false },
      etag: { supported: true },
      authenticationSchemes: [{
        type: "oauthbearertoken",
        name: "OAuth Bearer Token",
        description: "Authentication scheme using the OAuth Bearer Token standard",
        specUri: "http://www.rfc-editor.org/info/rfc6750",
        primary: true,
      }],
      meta: {
        resourceType: "ServiceProviderConfig",
        location: "/api/scim/v2/ServiceProviderConfig",
      },
    });
  });

  // ── Schemas ───────────────────────────────────────────────────────────────
  app.get("/api/scim/v2/Schemas", (_req, res) => {
    res.type(SCIM_CONTENT_TYPE).json({
      schemas: [SCIM_LIST_RESPONSE_SCHEMA],
      totalResults: 1,
      Resources: [{
        id: SCIM_USER_SCHEMA,
        name: "User",
        description: "User Account",
        attributes: [
          { name: "userName", type: "string", required: true, uniqueness: "server" },
          { name: "name", type: "complex", subAttributes: [
            { name: "formatted", type: "string" },
            { name: "givenName", type: "string" },
            { name: "familyName", type: "string" },
          ]},
          { name: "emails", type: "complex", multiValued: true },
          { name: "active", type: "boolean" },
        ],
        meta: { resourceType: "Schema", location: `/api/scim/v2/Schemas/${SCIM_USER_SCHEMA}` },
      }],
    });
  });

  // ── List / filter users ───────────────────────────────────────────────────
  app.get("/api/scim/v2/Users", scimAuth, async (req: Request, res: Response) => {
    const orgId = (req as any).orgId as string;
    const orgSlug = (req as any).orgSlug as string;

    const startIndex = Math.max(1, parseInt(req.query.startIndex as string || "1", 10));
    const count = Math.min(200, Math.max(1, parseInt(req.query.count as string || "100", 10)));
    const filter = (req.query.filter as string | undefined) || "";

    try {
      const allUsers = await storage.listUsersByOrg(orgId);

      // Apply SCIM filter (subset: userName eq "...", active eq true/false)
      let filtered = allUsers;
      if (filter) {
        const eqMatch = filter.match(/^(\w+)\s+eq\s+"([^"]+)"/i);
        if (eqMatch) {
          const [, attr, value] = eqMatch;
          const attrLower = attr.toLowerCase();
          filtered = allUsers.filter((u: import("../../shared/schema").User) => {
            if (attrLower === "username") return u.username.toLowerCase() === value.toLowerCase();
            if (attrLower === "emails.value") return u.username.toLowerCase() === value.toLowerCase();
            if (attrLower === "active") return String(value).toLowerCase() === "true";
            return true;
          });
        }
      }

      const total = filtered.length;
      const page = filtered.slice(startIndex - 1, startIndex - 1 + count);

      res.type(SCIM_CONTENT_TYPE).json({
        schemas: [SCIM_LIST_RESPONSE_SCHEMA],
        totalResults: total,
        startIndex,
        itemsPerPage: page.length,
        Resources: page.map((u: import("../../shared/schema").User) => toScimUser(u, orgSlug)),
      });
    } catch (err) {
      logger.error({ err, orgId }, "SCIM list users error");
      scimError(res, 500, "Failed to list users");
    }
  });

  // ── Get single user ───────────────────────────────────────────────────────
  app.get("/api/scim/v2/Users/:id", scimAuth, async (req: Request, res: Response) => {
    const orgId = (req as any).orgId as string;
    const orgSlug = (req as any).orgSlug as string;

    try {
      const user = await storage.getUser(req.params.id);
      if (!user || user.orgId !== orgId) {
        return scimError(res, 404, `User ${req.params.id} not found`);
      }
      res.type(SCIM_CONTENT_TYPE).json(toScimUser(user, orgSlug));
    } catch (err) {
      logger.error({ err }, "SCIM get user error");
      scimError(res, 500, "Failed to get user");
    }
  });

  // ── Create (provision) user ───────────────────────────────────────────────
  app.post("/api/scim/v2/Users", scimAuth, async (req: Request, res: Response) => {
    const orgId = (req as any).orgId as string;
    const orgSlug = (req as any).orgSlug as string;

    const { userName, name, emails, active, roles, [OBS_USER_EXT]: ext } = req.body as any;

    const email = userName || emails?.[0]?.value;
    if (!email) return scimError(res, 400, "userName is required", "invalidValue");

    // active=false at creation means provision but disable immediately (unusual but valid)
    if (active === false) {
      return scimError(res, 400, "Cannot create an inactive user. Create then PATCH active=false.", "invalidValue");
    }

    try {
      // Check for duplicate
      const existing = await storage.getUserByUsername(email, orgId);
      if (existing) {
        return scimError(res, 409, `User with userName "${email}" already exists`, "uniqueness");
      }

      const displayName =
        name?.formatted ||
        [name?.givenName, name?.familyName].filter(Boolean).join(" ") ||
        email.split("@")[0];

      // Role from SCIM roles array, extension, or default
      const scimRole = roles?.[0]?.value || ext?.role;
      const role = scimRoleToObs(scimRole);

      const newUser = await storage.createUser({
        orgId,
        username: email,
        passwordHash: `scim:${randomBytes(32).toString("hex")}`, // SCIM users login via SSO only
        name: displayName,
        role,
      });

      syncSeatUsage(orgId).catch(() => {});

      logPhiAccess({
        event: "user_created",
        orgId,
        resourceType: "user",
        resourceId: newUser.id,
        detail: `SCIM provisioned user: ${email} (role: ${role})`,
      });

      logger.info({ userId: newUser.id, email, orgId, role }, "SCIM: user provisioned");

      res.status(201)
        .type(SCIM_CONTENT_TYPE)
        .set("Location", `/api/scim/v2/Users/${newUser.id}`)
        .json(toScimUser(newUser, orgSlug));
    } catch (err) {
      logger.error({ err, orgId, email }, "SCIM create user error");
      scimError(res, 500, "Failed to create user");
    }
  });

  // ── Replace user (PUT) ────────────────────────────────────────────────────
  app.put("/api/scim/v2/Users/:id", scimAuth, async (req: Request, res: Response) => {
    const orgId = (req as any).orgId as string;
    const orgSlug = (req as any).orgSlug as string;

    try {
      const user = await storage.getUser(req.params.id);
      if (!user || user.orgId !== orgId) {
        return scimError(res, 404, `User ${req.params.id} not found`);
      }

      const { name, active, roles, [OBS_USER_EXT]: ext } = req.body as any;

      const displayName =
        name?.formatted ||
        [name?.givenName, name?.familyName].filter(Boolean).join(" ") ||
        user.name;

      const scimRole = roles?.[0]?.value || ext?.role;
      const role = scimRole ? scimRoleToObs(scimRole) : user.role;

      const updates: Record<string, unknown> = { name: displayName, role };

      // Deactivate: if active=false, mark user inactive by deleting session
      // (Observatory doesn't have a "disabled" flag on users yet, so we use role demotion)
      // A proper implementation would add an `active` boolean to the users table.
      if (active === false) {
        updates.role = "viewer"; // Demote to minimum access
        logger.info({ userId: user.id, orgId }, "SCIM PUT: user deactivated (role demoted to viewer)");
      }

      await storage.updateUser(orgId, user.id, updates as any);
      const updated = { ...user, ...updates };

      logPhiAccess({
        event: "user_updated",
        orgId,
        resourceType: "user",
        resourceId: user.id,
        detail: `SCIM PUT user: role=${role}, active=${active !== false}`,
      });

      res.type(SCIM_CONTENT_TYPE).json(toScimUser(updated as any, orgSlug, active !== false));
    } catch (err) {
      logger.error({ err }, "SCIM PUT user error");
      scimError(res, 500, "Failed to update user");
    }
  });

  // ── Partial update (PATCH) ────────────────────────────────────────────────
  // Supports Operations: replace (active, name, role), remove
  app.patch("/api/scim/v2/Users/:id", scimAuth, async (req: Request, res: Response) => {
    const orgId = (req as any).orgId as string;
    const orgSlug = (req as any).orgSlug as string;

    try {
      const user = await storage.getUser(req.params.id);
      if (!user || user.orgId !== orgId) {
        return scimError(res, 404, `User ${req.params.id} not found`);
      }

      const { Operations } = req.body as { Operations: Array<{ op: string; path?: string; value?: unknown }> };
      if (!Array.isArray(Operations)) {
        return scimError(res, 400, "Operations array required", "invalidValue");
      }

      const updates: Record<string, unknown> = {};
      let deactivate = false;

      for (const op of Operations) {
        const opType = (op.op || "").toLowerCase();
        const path = (op.path || "").toLowerCase();
        const value = op.value;

        if (opType === "replace" || opType === "add") {
          if (path === "active" || (typeof value === "object" && value !== null && "active" in (value as any))) {
            const activeVal = path === "active" ? value : (value as any).active;
            if (activeVal === false || activeVal === "false") deactivate = true;
          }
          if (path === "name.formatted" && typeof value === "string") updates.name = value;
          if (path === "name" && typeof value === "object" && value !== null) {
            const n = value as any;
            updates.name = n.formatted || [n.givenName, n.familyName].filter(Boolean).join(" ") || user.name;
          }
          // Role update via extension
          if (path === `${OBS_USER_EXT.toLowerCase()}:role` || path === "roles") {
            const roleVal = typeof value === "string" ? value : (value as any)?.[0]?.value;
            if (roleVal) updates.role = scimRoleToObs(roleVal);
          }
          // Handle SCIM standard patch without path (value is object of attributes)
          if (!path && typeof value === "object" && value !== null) {
            const v = value as Record<string, unknown>;
            if ("active" in v && (v.active === false || v.active === "false")) deactivate = true;
            if ("name" in v && typeof v.name === "object" && v.name !== null) {
              const n = v.name as any;
              updates.name = n.formatted || [n.givenName, n.familyName].filter(Boolean).join(" ");
            }
            if (OBS_USER_EXT in v && typeof (v[OBS_USER_EXT] as any)?.role === "string") {
              updates.role = scimRoleToObs((v[OBS_USER_EXT] as any).role);
            }
          }
        }
      }

      if (deactivate) {
        // No hard-delete: demote to viewer and deprovision password
        updates.role = "viewer";
        updates.passwordHash = `scim_deprovisioned:${randomBytes(16).toString("hex")}`;
        logger.info({ userId: user.id, orgId }, "SCIM PATCH: user deactivated");
      }

      if (Object.keys(updates).length > 0) {
        await storage.updateUser(orgId, user.id, updates as any);
      }

      const updated = { ...user, ...updates };

      logPhiAccess({
        event: "user_updated",
        orgId,
        resourceType: "user",
        resourceId: user.id,
        detail: `SCIM PATCH: ops=${Operations.length}, deactivate=${deactivate}`,
      });

      res.type(SCIM_CONTENT_TYPE).json(toScimUser(updated as any, orgSlug, !deactivate));
    } catch (err) {
      logger.error({ err }, "SCIM PATCH user error");
      scimError(res, 500, "Failed to patch user");
    }
  });

  // ── Delete (deprovision) user ─────────────────────────────────────────────
  app.delete("/api/scim/v2/Users/:id", scimAuth, async (req: Request, res: Response) => {
    const orgId = (req as any).orgId as string;

    try {
      const user = await storage.getUser(req.params.id);
      if (!user || user.orgId !== orgId) {
        return scimError(res, 404, `User ${req.params.id} not found`);
      }

      await storage.deleteUser(orgId, user.id);
      syncSeatUsage(orgId).catch(() => {});

      logPhiAccess({
        event: "user_deleted",
        orgId,
        resourceType: "user",
        resourceId: user.id,
        detail: `SCIM deprovisioned user: ${user.username}`,
      });

      logger.info({ userId: user.id, email: user.username, orgId }, "SCIM: user deprovisioned");

      res.status(204).send();
    } catch (err) {
      logger.error({ err }, "SCIM delete user error");
      scimError(res, 500, "Failed to delete user");
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Token management helpers (used by admin routes)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate a new SCIM bearer token. Returns the plaintext token (shown once)
 * and the hash + prefix for storage.
 */
export function generateScimToken(): { token: string; hash: string; prefix: string } {
  const token = `scim_${randomBytes(32).toString("base64url")}`;
  const hash = createHash("sha256").update(token).digest("hex");
  const prefix = token.slice(0, 12);
  return { token, hash, prefix };
}
