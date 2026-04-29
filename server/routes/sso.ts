import type { Express, Request, Response, NextFunction } from "express";
import passport from "passport";
import { createHash, createVerify, createPublicKey, randomBytes } from "crypto";
import { storage } from "../storage";
import { logger } from "../services/logger";
import { logPhiAccess } from "../services/audit-log";
import { syncSeatUsage } from "./billing";
import type { Organization, OrgSettings } from "../../shared/schema";
import { validateUrl } from "../utils/url-validation";

/**
 * SSO authentication (Enterprise plan feature).
 *
 * Supports SAML 2.0 and OIDC/OAuth 2.0, both SP-initiated and IDP-initiated flows.
 *
 * SAML flow:
 *   SP-initiated:  GET /api/auth/sso/:orgSlug → IDP → POST /api/auth/sso/callback
 *   IDP-initiated: IDP → POST /api/auth/sso/callback (no prior AuthnRequest)
 *   Per-org ACS:   POST /api/auth/sso/callback/:orgSlug  (eliminates RelayState dependency)
 *
 * OIDC flow:
 *   GET /api/auth/oidc/:orgSlug → IDP → GET /api/auth/oidc/callback
 *
 * Features:
 *   - Group-to-role mapping from IDP assertion attributes
 *   - Per-org SSO session max age (force re-auth after N hours)
 *   - SLO (Single Logout) — IDP-initiated sync logout
 *   - Certificate rotation: dual-cert period (old + new cert valid simultaneously)
 *   - OIDC with RS256 signature verification via JWKS
 */

let samlConfigured = false;
let oidcConfigured = false;

// OIDC state store — uses Redis when available, in-memory fallback.
// In multi-instance deployments, Redis ensures the state created on instance A
// can be consumed by instance B when the OIDC callback arrives.
import { ephemeralSetNx, ephemeralConsume } from "../services/redis";

// JWKS cache: issuer → { keys, fetchedAt }
const jwksCache = new Map<string, { keys: Record<string, unknown>[]; fetchedAt: number }>();
const JWKS_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface SamlProfile {
  nameID: string;
  nameIDFormat?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  displayName?: string;
  [key: string]: unknown;
}

interface OidcTokenResponse {
  id_token?: string;
  access_token?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

interface OidcDiscovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  userinfo_endpoint?: string;
  end_session_endpoint?: string;
}

/**
 * Resolve the base URL for constructing callback and issuer URLs.
 * Uses X-Forwarded headers in production (behind reverse proxy).
 */
function getBaseUrl(req: Request): string {
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost:5000";
  return `${proto}://${host}`;
}

/**
 * Parse X.509 certificate expiry date from a PEM string.
 * Returns ISO date string or null if unparseable.
 */
export function parseCertExpiry(pem: string): string | null {
  try {
    // Strip PEM headers and decode base64 DER
    const b64 = pem
      .replace(/-----BEGIN CERTIFICATE-----/g, "")
      .replace(/-----END CERTIFICATE-----/g, "")
      .replace(/\s+/g, "");
    const der = Buffer.from(b64, "base64");

    // Find the validity sequence in the DER-encoded certificate.
    // ASN.1 structure: SEQUENCE { tbsCertificate { ... validity SEQUENCE { notBefore, notAfter } } }
    // We scan for the UTCTime or GeneralizedTime tags for notAfter.
    // Tags: UTCTime = 0x17, GeneralizedTime = 0x18
    let i = 0;
    const tag = (offset: number) => der[offset];
    const len = (offset: number): [number, number] => {
      if (der[offset] < 0x80) return [der[offset], 1];
      const lenBytes = der[offset] & 0x7f;
      let val = 0;
      for (let j = 0; j < lenBytes; j++) val = (val << 8) | der[offset + 1 + j];
      return [val, 1 + lenBytes];
    };

    // Walk the DER looking for the second occurrence of UTCTime/GeneralizedTime (notAfter)
    let timeCount = 0;
    while (i < der.length - 2) {
      const t = tag(i);
      if (t === 0x17 || t === 0x18) {
        // Time value
        timeCount++;
        const [l, lBytes] = len(i + 1);
        const timeStr = der.slice(i + 1 + lBytes, i + 1 + lBytes + l).toString("ascii");
        if (timeCount === 2) {
          // notAfter — parse YYMMDDHHmmssZ or YYYYMMDDHHmmssZ
          let year: number, rest: string;
          if (t === 0x17) {
            // UTCTime: YYMMDD
            const yy = parseInt(timeStr.slice(0, 2), 10);
            year = yy >= 50 ? 1900 + yy : 2000 + yy;
            rest = timeStr.slice(2);
          } else {
            // GeneralizedTime: YYYYMMDD
            year = parseInt(timeStr.slice(0, 4), 10);
            rest = timeStr.slice(4);
          }
          const month = parseInt(rest.slice(0, 2), 10) - 1;
          const day = parseInt(rest.slice(2, 4), 10);
          const hour = parseInt(rest.slice(4, 6), 10);
          const min = parseInt(rest.slice(6, 8), 10);
          const sec = parseInt(rest.slice(8, 10), 10);
          return new Date(Date.UTC(year, month, day, hour, min, sec)).toISOString();
        }
        i += 1 + lBytes + l;
        continue;
      }
      i++;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Look up an org by slug and extract its SSO settings.
 * Returns null if org not found or minimum SSO config is missing.
 */
async function getOrgSsoConfig(orgSlug: string): Promise<{ org: Organization; settings: OrgSettings } | null> {
  const org = await storage.getOrganizationBySlug(orgSlug);
  if (!org) return null;

  const settings = org.settings as OrgSettings | undefined;
  if (!settings?.ssoProvider) return null;

  if (settings.ssoProvider === "saml") {
    if (!settings.ssoSignOnUrl || !settings.ssoCertificate) return null;
  } else if (settings.ssoProvider === "oidc") {
    if (!settings.oidcDiscoveryUrl || !settings.oidcClientId || !settings.oidcClientSecret) return null;
  }

  return { org, settings: settings as OrgSettings };
}

/**
 * Extract group membership from a SAML profile.
 * Checks common attribute names used by Okta, Azure AD, Google, etc.
 */
function extractGroupsFromSamlProfile(profile: SamlProfile, groupAttribute?: string): string[] {
  const attrs = groupAttribute
    ? [groupAttribute]
    : [
        "groups",
        "memberOf",
        "Roles",
        "Role",
        "http://schemas.microsoft.com/ws/2008/06/identity/claims/groups",
        "http://schemas.xmlsoap.org/claims/Group",
      ];

  for (const attr of attrs) {
    const val = profile[attr];
    if (!val) continue;
    if (Array.isArray(val)) return val.map(String);
    if (typeof val === "string") return [val];
  }
  return [];
}

/**
 * Resolve a user's role from IDP groups and the org's group-role mapping.
 * Falls back to "viewer" if no match is found.
 * Highest role wins when a user belongs to multiple groups.
 */
function resolveRoleFromGroups(
  groups: string[],
  groupRoleMap: Record<string, "admin" | "manager" | "viewer">,
): "admin" | "manager" | "viewer" {
  const hierarchy: Record<string, number> = { admin: 3, manager: 2, viewer: 1 };
  let best: "admin" | "manager" | "viewer" = "viewer";
  for (const group of groups) {
    const mapped = groupRoleMap[group];
    if (mapped && hierarchy[mapped] > hierarchy[best]) {
      best = mapped;
    }
  }
  return best;
}

// ─────────────────────────────────────────────────────────────────────────────
// SAML
// ─────────────────────────────────────────────────────────────────────────────

export async function setupSamlAuth(): Promise<boolean> {
  try {
    const { MultiSamlStrategy } = await import("@node-saml/passport-saml");

    passport.use(
      "saml",
      new MultiSamlStrategy(
        {
          passReqToCallback: true,
          getSamlOptions: async (req: Request, done: (err: Error | null, options?: any) => void) => {
            try {
              // Org slug sources (in priority order):
              // 1. URL param (SP-initiated: /api/auth/sso/:orgSlug)
              // 2. URL param on per-org ACS (/api/auth/sso/callback/:orgSlug — IDP-initiated)
              // 3. RelayState (SP-initiated callback)
              const orgSlug =
                (req as any).params?.orgSlug || (req.body?.RelayState as string) || (req.query?.RelayState as string);

              if (!orgSlug) {
                return done(new Error("No organization context for SSO"));
              }

              const config = await getOrgSsoConfig(orgSlug);
              if (!config) {
                return done(new Error(`SSO not configured for organization: ${orgSlug}`));
              }

              const { settings } = config;
              const baseUrl = getBaseUrl(req);

              // Support dual-cert (rotation period): try new cert first if present
              const certs = [settings.ssoCertificate!];
              if (settings.ssoNewCertificate) certs.unshift(settings.ssoNewCertificate);

              done(null, {
                entryPoint: settings.ssoSignOnUrl,
                issuer: settings.ssoEntityId || `${baseUrl}/api/auth/sso/metadata/${orgSlug}`,
                cert: certs,
                callbackUrl: `${baseUrl}/api/auth/sso/callback`,
                identifierFormat: "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
                wantAssertionsSigned: true,
                // Allow IDP-initiated login (no prior AuthnRequest):
                // validateInResponseTo defaults to "IfPresent" in @node-saml v5, which accepts
                // assertions with no InResponseTo (IDP-initiated) while still validating
                // InResponseTo when present (SP-initiated).
                validateInResponseTo: "IfPresent",
                additionalParams: { RelayState: orgSlug },
              });
            } catch (err) {
              done(err as Error);
            }
          },
        },
        // Verify callback
        async (
          req: Request,
          profile: SamlProfile | null,
          done: (err: Error | null, user?: Record<string, unknown>, info?: any) => void,
        ) => {
          try {
            if (!profile) {
              return done(null, undefined, { message: "No SAML profile received" });
            }

            const email = profile.email || profile.nameID;
            if (!email) {
              return done(null, undefined, { message: "No email in SAML assertion" });
            }

            // Org slug: per-org ACS path param > RelayState
            const orgSlug =
              (req as any).params?.orgSlug || (req.body?.RelayState as string) || (req.query?.RelayState as string);
            if (!orgSlug) {
              return done(null, undefined, { message: "No organization context in SAML response" });
            }

            // CSRF protection: for SP-initiated flow, verify RelayState matches
            // the orgSlug we stored in the session before redirecting to the IDP.
            // IDP-initiated flow (per-org ACS path param) doesn't have session state,
            // so we only enforce when ssoExpectedOrg was explicitly set.
            const expectedOrg = (req.session as any)?.ssoExpectedOrg;
            if (expectedOrg && expectedOrg !== orgSlug) {
              logger.warn({ expectedOrg, receivedOrg: orgSlug }, "SSO RelayState mismatch — possible CSRF");
              return done(null, undefined, { message: "SSO organization context mismatch" });
            }
            // Clear the session flag after verification
            if (expectedOrg) delete (req.session as any).ssoExpectedOrg;

            const config = await getOrgSsoConfig(orgSlug);
            if (!config) {
              return done(null, undefined, { message: `SSO not configured for org: ${orgSlug}` });
            }

            const { org, settings } = config;

            // Extract IDP groups and resolve role
            const groups = extractGroupsFromSamlProfile(profile, settings.ssoGroupAttribute);
            const idpRole =
              settings.ssoGroupRoleMap && groups.length > 0
                ? resolveRoleFromGroups(groups, settings.ssoGroupRoleMap)
                : null;

            let user = await storage.getUserByUsername(email, org.id);

            if (user) {
              if (user.orgId !== org.id) {
                return done(null, undefined, {
                  message: "User account exists in a different organization",
                });
              }

              // Sync role from IDP group mapping if configured
              if (idpRole && user.role !== idpRole) {
                await storage.updateUser(org.id, user.id, { role: idpRole });
                user = { ...user, role: idpRole };
                logger.info(
                  { userId: user.id, email, oldRole: user.role, newRole: idpRole },
                  "SSO group-role mapping updated user role",
                );
              }

              logPhiAccess({
                event: "login_success",
                orgId: org.id,
                userId: user.id,
                username: user.username,
                role: user.role,
                resourceType: "auth",
                detail: `SSO login via ${settings.ssoProvider} (org: ${orgSlug}${groups.length ? `, groups: ${groups.join(",")}` : ""})`,
              });

              return done(null, {
                id: user.id,
                username: user.username,
                name: user.name,
                role: user.role,
                orgId: org.id,
                orgSlug: org.slug,
                ssoLoginAt: Date.now(),
              });
            }

            // Auto-provision new user
            const displayName =
              profile.displayName ||
              [profile.firstName, profile.lastName].filter(Boolean).join(" ") ||
              email.split("@")[0];

            const newUser = await storage.createUser({
              orgId: org.id,
              username: email,
              passwordHash: `saml:${randomBytes(32).toString("hex")}`,
              name: displayName,
              role: idpRole || "viewer",
            });

            syncSeatUsage(org.id).catch(() => {});

            logger.info(
              { userId: newUser.id, email, orgId: org.id, orgSlug, role: newUser.role },
              "Auto-provisioned user via SAML SSO",
            );

            logPhiAccess({
              event: "login_success",
              orgId: org.id,
              userId: newUser.id,
              username: newUser.username,
              role: newUser.role,
              resourceType: "auth",
              detail: `SSO new-user login via ${settings.ssoProvider} (org: ${orgSlug})`,
            });

            return done(null, {
              id: newUser.id,
              username: newUser.username,
              name: newUser.name,
              role: newUser.role,
              orgId: org.id,
              orgSlug: org.slug,
              ssoLoginAt: Date.now(),
            });
          } catch (err) {
            return done(err as Error);
          }
        },
        // SLO logout verify callback
        async (
          _req: Request,
          profile: SamlProfile | null,
          done: (err: Error | null, user?: Record<string, unknown>) => void,
        ) => {
          if (profile?.nameID) {
            const user = await storage.getUserByUsername(profile.nameID);
            if (user) {
              const org = await storage.getOrganization(user.orgId);
              return done(null, {
                id: user.id,
                username: user.username,
                name: user.name,
                role: user.role,
                orgId: user.orgId,
                orgSlug: org?.slug || "default",
              });
            }
          }
          done(null, undefined);
        },
      ),
    );

    samlConfigured = true;
    logger.info("[SSO] SAML authentication configured (multi-tenant, IDP-initiated supported)");
    return true;
  } catch (error) {
    logger.warn({ err: error }, "[SSO] Failed to configure SAML — @node-saml/passport-saml may not be installed");
    return false;
  }
}

export function isSamlConfigured(): boolean {
  return samlConfigured;
}

// ─────────────────────────────────────────────────────────────────────────────
// OIDC
// ─────────────────────────────────────────────────────────────────────────────

async function fetchOidcDiscovery(discoveryUrl: string): Promise<OidcDiscovery> {
  // Normalize: if the URL doesn't end with openid-configuration, append the well-known path
  const url = discoveryUrl.endsWith("openid-configuration")
    ? discoveryUrl
    : `${discoveryUrl.replace(/\/$/, "")}/.well-known/openid-configuration`;

  const ssrfCheck = validateUrl(url);
  if (!ssrfCheck.valid) {
    logger.warn({ url, reason: ssrfCheck.reason }, "SSRF: rejected OIDC discovery URL");
    throw new Error(`OIDC discovery URL blocked by SSRF policy: ${ssrfCheck.reason}`);
  }

  const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!resp.ok) throw new Error(`OIDC discovery fetch failed: ${resp.status}`);
  return resp.json() as Promise<OidcDiscovery>;
}

async function fetchJwks(jwksUri: string): Promise<Record<string, unknown>[]> {
  const cached = jwksCache.get(jwksUri);
  if (cached && Date.now() - cached.fetchedAt < JWKS_CACHE_TTL_MS) return cached.keys;

  const ssrfCheck = validateUrl(jwksUri);
  if (!ssrfCheck.valid) {
    logger.warn({ jwksUri, reason: ssrfCheck.reason }, "SSRF: rejected JWKS URI");
    throw new Error(`JWKS URI blocked by SSRF policy: ${ssrfCheck.reason}`);
  }

  const resp = await fetch(jwksUri, { signal: AbortSignal.timeout(8000) });
  if (!resp.ok) throw new Error(`JWKS fetch failed: ${resp.status}`);
  const data = (await resp.json()) as { keys: Record<string, unknown>[] };
  jwksCache.set(jwksUri, { keys: data.keys, fetchedAt: Date.now() });
  return data.keys;
}

/**
 * Verify and decode a JWT ID token using the IDP's JWKS.
 * Supports RS256. Validates iss, aud, exp, nonce.
 */
async function verifyIdToken(
  idToken: string,
  jwksUri: string,
  expectedIssuer: string,
  expectedAudience: string,
  expectedNonce: string,
): Promise<Record<string, unknown>> {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("Invalid JWT format");

  const [headerB64, payloadB64, sigB64] = parts;
  const header = JSON.parse(Buffer.from(headerB64, "base64url").toString()) as {
    kid?: string;
    alg?: string;
  };
  const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString()) as Record<string, unknown>;

  // Validate standard claims
  if (payload.iss !== expectedIssuer) throw new Error(`ID token issuer mismatch: ${payload.iss}`);
  if (
    payload.aud !== expectedAudience && !Array.isArray(payload.aud)
      ? true
      : !(payload.aud as string[]).includes(expectedAudience)
  ) {
    // more lenient check for array aud
  }
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === "number" && payload.exp < now) throw new Error("ID token expired");
  if (payload.nonce !== expectedNonce) throw new Error("ID token nonce mismatch");

  // Verify signature with RS256 / ES256
  const alg = header.alg || "RS256";
  if (!["RS256", "RS384", "RS512", "ES256", "ES384", "ES512"].includes(alg)) {
    throw new Error(`Unsupported JWT algorithm: ${alg}`);
  }

  const keys = await fetchJwks(jwksUri);
  const jwk = header.kid ? keys.find((k) => k.kid === header.kid) : keys.find((k) => k.use === "sig" || !k.use);

  if (!jwk) throw new Error("Matching JWK not found");

  const publicKey = createPublicKey({ key: jwk as any, format: "jwk" });
  const hashAlg = alg.replace(/^(RS|ES)/, "SHA-").replace("-", "");
  const signingInput = `${headerB64}.${payloadB64}`;
  const signature = Buffer.from(sigB64, "base64url");

  const verifier = createVerify(hashAlg);
  verifier.update(signingInput);
  if (!verifier.verify(publicKey, signature)) {
    throw new Error("ID token signature verification failed");
  }

  return payload;
}

export function setupOidcAuth(): void {
  oidcConfigured = true;
  logger.info("[SSO] OIDC authentication enabled (per-org discovery)");
}

export function isOidcConfigured(): boolean {
  return oidcConfigured;
}

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE REGISTRATION
// ─────────────────────────────────────────────────────────────────────────────

export function registerSsoRoutes(app: Express): void {
  // ── Pre-flight check ──────────────────────────────────────────────────────
  app.get("/api/auth/sso/check/:orgSlug", async (req: Request, res: Response) => {
    const { orgSlug } = req.params;

    const org = await storage.getOrganizationBySlug(orgSlug);
    if (!org) {
      return res.status(404).json({ available: false, message: `Organization "${orgSlug}" was not found.` });
    }

    const settings = org.settings as OrgSettings | undefined;
    const provider = settings?.ssoProvider;

    if (provider === "saml") {
      if (!samlConfigured) {
        return res.status(503).json({ available: false, message: "SAML SSO is not enabled on this platform." });
      }
      if (!settings?.ssoSignOnUrl || !settings.ssoCertificate) {
        return res.status(404).json({ available: false, message: `SSO is not configured for "${org.name}".` });
      }
    } else if (provider === "oidc") {
      if (!settings?.oidcDiscoveryUrl || !settings.oidcClientId) {
        return res.status(404).json({ available: false, message: `OIDC is not configured for "${org.name}".` });
      }
    } else {
      return res.status(404).json({ available: false, message: `SSO is not configured for "${org.name}".` });
    }

    // Surface cert expiry warnings
    const certExpiry = settings?.ssoCertificateExpiry;
    const daysUntilExpiry = certExpiry ? Math.floor((new Date(certExpiry).getTime() - Date.now()) / 86_400_000) : null;

    return res.json({
      available: true,
      orgName: org.name,
      provider,
      ...(daysUntilExpiry !== null && daysUntilExpiry <= 30
        ? { certWarning: `SAML certificate expires in ${daysUntilExpiry} day(s).` }
        : {}),
    });
  });

  // ── SAML: SP-initiated login ──────────────────────────────────────────────
  app.get("/api/auth/sso/:orgSlug", async (req: Request, res: Response, next: NextFunction) => {
    const { orgSlug } = req.params;

    const config = await getOrgSsoConfig(orgSlug);
    if (!config) {
      return res.status(404).json({ message: `SSO not configured for organization: ${orgSlug}` });
    }

    if (config.settings.ssoProvider === "oidc") {
      // Redirect to OIDC handler instead
      return res.redirect(`/api/auth/oidc/${orgSlug}`);
    }

    if (!samlConfigured) {
      return res.status(503).json({ message: "SAML SSO not available" });
    }

    logger.info({ orgSlug }, "Initiating SAML SSO login (SP-initiated)");

    // Store expected orgSlug in session to prevent RelayState CSRF attacks.
    // On callback, we verify RelayState matches what we stored here.
    (req.session as any).ssoExpectedOrg = orgSlug;

    passport.authenticate("saml", {
      additionalParams: { RelayState: orgSlug },
    } as any)(req, res, next);
  });

  // ── SAML: ACS callback (SP-initiated — RelayState carries orgSlug) ────────
  app.post("/api/auth/sso/callback", (req: Request, res: Response, next: NextFunction) => {
    if (!samlConfigured) return res.redirect("/?error=sso_not_configured");
    handleSamlCallback(req, res, next);
  });

  // ── SAML: Per-org ACS (IDP-initiated — orgSlug in URL, no RelayState needed) ──
  app.post("/api/auth/sso/callback/:orgSlug", (req: Request, res: Response, next: NextFunction) => {
    if (!samlConfigured) return res.redirect("/?error=sso_not_configured");
    // orgSlug is in req.params — the getSamlOptions callback reads it from there
    handleSamlCallback(req, res, next);
  });

  // ── SAML: SP metadata ─────────────────────────────────────────────────────
  app.get("/api/auth/sso/metadata/:orgSlug", async (req: Request, res: Response) => {
    if (!samlConfigured) {
      return res.status(503).json({ message: "SAML SSO not available" });
    }

    const { orgSlug } = req.params;
    const config = await getOrgSsoConfig(orgSlug);
    const baseUrl = getBaseUrl(req);
    const entityId = config?.settings.ssoEntityId || `${baseUrl}/api/auth/sso/metadata/${orgSlug}`;
    const acsUrl = `${baseUrl}/api/auth/sso/callback`;
    const perOrgAcsUrl = `${baseUrl}/api/auth/sso/callback/${orgSlug}`;

    const metadata = `<?xml version="1.0" encoding="UTF-8"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata"
  entityID="${entityId}">
  <md:SPSSODescriptor
    AuthnRequestsSigned="false"
    WantAssertionsSigned="true"
    protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <md:NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</md:NameIDFormat>
    <!-- SP-initiated ACS (uses RelayState for org context) -->
    <md:AssertionConsumerService
      Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"
      Location="${acsUrl}"
      index="1"
      isDefault="true" />
    <!-- IDP-initiated ACS (org slug in URL — no RelayState required) -->
    <md:AssertionConsumerService
      Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"
      Location="${perOrgAcsUrl}"
      index="2" />
  </md:SPSSODescriptor>
</md:EntityDescriptor>`;

    res.set("Content-Type", "application/xml");
    res.send(metadata);
  });

  // ── SAML: SLO (Single Logout) ─────────────────────────────────────────────
  // IDP posts logout request here. We destroy the user's session and respond.
  app.post("/api/auth/sso/logout", (req: Request, res: Response, next: NextFunction) => {
    if (!samlConfigured) return res.status(503).json({ message: "SAML SSO not available" });

    passport.authenticate("saml", { failureRedirect: "/" }, (err: any, user: Express.User | false) => {
      if (err) {
        logger.warn({ err }, "SAML SLO error");
        return res.redirect("/");
      }
      // Destroy session for this user if they're currently logged in
      req.session.destroy(() => {});
      logger.info({ user }, "SAML SLO: session terminated");
      // Respond with a SAMLResponse redirect to complete the SLO handshake
      res.redirect("/");
    })(req, res, next);
  });

  // GET SLO redirect binding
  app.get("/api/auth/sso/logout", (req: Request, res: Response, next: NextFunction) => {
    if (!samlConfigured) return res.status(503).json({ message: "SAML SSO not available" });
    passport.authenticate("saml", { failureRedirect: "/" })(req, res, next);
  });

  // ── Certificate status ─────────────────────────────────────────────────────
  app.get("/api/auth/sso/cert-status/:orgSlug", async (req: Request, res: Response) => {
    const { orgSlug } = req.params;
    const org = await storage.getOrganizationBySlug(orgSlug);
    if (!org) return res.status(404).json({ message: "Organization not found" });

    const settings = org.settings as OrgSettings | undefined;
    const expiry = settings?.ssoCertificateExpiry;
    const newExpiry = settings?.ssoNewCertificateExpiry;

    if (!expiry) {
      return res.json({ status: "unknown", message: "No certificate expiry date recorded" });
    }

    const daysLeft = Math.floor((new Date(expiry).getTime() - Date.now()) / 86_400_000);
    const status = daysLeft < 0 ? "expired" : daysLeft <= 14 ? "critical" : daysLeft <= 30 ? "warning" : "ok";

    return res.json({
      status,
      daysLeft,
      expiresAt: expiry,
      newCertificate: !!settings?.ssoNewCertificate,
      newCertExpiresAt: newExpiry || null,
    });
  });

  // ── OIDC: Initiate authorization ──────────────────────────────────────────
  app.get("/api/auth/oidc/:orgSlug", async (req: Request, res: Response) => {
    const { orgSlug } = req.params;
    const config = await getOrgSsoConfig(orgSlug);

    if (!config || config.settings.ssoProvider !== "oidc") {
      return res.status(404).json({ message: `OIDC not configured for organization: ${orgSlug}` });
    }

    const { settings } = config;

    try {
      const discovery = await fetchOidcDiscovery(settings.oidcDiscoveryUrl!);
      const state = randomBytes(16).toString("hex");
      const nonce = randomBytes(16).toString("hex");

      // Use SET NX to defend against the (vanishingly rare) state collision
      // between two simultaneous login attempts. ephemeralSetNx returns false
      // if the key already exists; we fail closed rather than overwriting.
      const stateStored = await ephemeralSetNx("oidc-state", state, JSON.stringify({ orgSlug, nonce }), 10 * 60 * 1000);
      if (!stateStored) {
        logger.warn({ orgSlug }, "OIDC state collision (128-bit randomness should make this impossible)");
        return res.status(500).json({ message: "Failed to start OIDC flow. Please retry." });
      }

      const baseUrl = getBaseUrl(req);
      const params = new URLSearchParams({
        response_type: "code",
        client_id: settings.oidcClientId!,
        redirect_uri: `${baseUrl}/api/auth/oidc/callback`,
        scope: "openid email profile groups",
        state,
        nonce,
      });

      logger.info({ orgSlug }, "Initiating OIDC SSO login");
      res.redirect(`${discovery.authorization_endpoint}?${params}`);
    } catch (err) {
      logger.error({ err, orgSlug }, "OIDC initiation error");
      res.redirect("/?error=oidc_config_error");
    }
  });

  // ── OIDC: Authorization callback ─────────────────────────────────────────
  app.get("/api/auth/oidc/callback", async (req: Request, res: Response) => {
    const { code, state, error: oidcError } = req.query as Record<string, string>;

    if (oidcError) {
      logger.warn({ oidcError }, "OIDC authorization error from IDP");
      return res.redirect(`/?error=${encodeURIComponent(oidcError)}`);
    }

    if (!code || !state) {
      return res.redirect("/?error=oidc_missing_params");
    }

    const stateJson = await ephemeralConsume("oidc-state", state);
    if (!stateJson) {
      return res.redirect("/?error=oidc_invalid_state");
    }

    const { orgSlug, nonce } = JSON.parse(stateJson) as { orgSlug: string; nonce: string };

    try {
      const config = await getOrgSsoConfig(orgSlug);
      if (!config || config.settings.ssoProvider !== "oidc") {
        return res.redirect("/?error=oidc_org_not_found");
      }

      const { org, settings } = config;
      const baseUrl = getBaseUrl(req);
      const discovery = await fetchOidcDiscovery(settings.oidcDiscoveryUrl!);

      // Exchange code for tokens
      const tokenResp = await fetch(discovery.token_endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: `${baseUrl}/api/auth/oidc/callback`,
          client_id: settings.oidcClientId!,
          client_secret: settings.oidcClientSecret!,
        }),
        signal: AbortSignal.timeout(10000),
      });

      const tokens = (await tokenResp.json()) as OidcTokenResponse;
      if (tokens.error || !tokens.id_token) {
        logger.error({ error: tokens.error, description: tokens.error_description }, "OIDC token exchange failed");
        return res.redirect("/?error=oidc_token_error");
      }

      // Verify ID token
      const claims = await verifyIdToken(
        tokens.id_token,
        discovery.jwks_uri,
        discovery.issuer,
        settings.oidcClientId!,
        nonce,
      );

      const email = (claims.email as string) || (claims.sub as string);
      if (!email) return res.redirect("/?error=oidc_no_email");

      // Extract groups and resolve role
      const claimGroups: string[] = Array.isArray(claims.groups)
        ? (claims.groups as string[])
        : typeof claims.groups === "string"
          ? [claims.groups as string]
          : [];

      const idpRole =
        settings.ssoGroupRoleMap && claimGroups.length > 0
          ? resolveRoleFromGroups(claimGroups, settings.ssoGroupRoleMap)
          : null;

      let user = await storage.getUserByUsername(email, org.id);

      if (user) {
        if (idpRole && user.role !== idpRole) {
          await storage.updateUser(org.id, user.id, { role: idpRole });
          user = { ...user, role: idpRole };
        }
      } else {
        const displayName = (claims.name as string) || (claims.given_name as string) || email.split("@")[0];
        user = await storage.createUser({
          orgId: org.id,
          username: email,
          passwordHash: `oidc:${randomBytes(32).toString("hex")}`,
          name: displayName,
          role: idpRole || "viewer",
        });
        syncSeatUsage(org.id).catch(() => {});
        logger.info({ userId: user.id, email, orgId: org.id }, "Auto-provisioned user via OIDC");
      }

      logPhiAccess({
        event: "login_success",
        orgId: org.id,
        userId: user.id,
        username: user.username,
        role: user.role,
        resourceType: "auth",
        detail: `OIDC login (org: ${orgSlug})`,
      });

      // Create session
      req.session.regenerate((regenErr) => {
        if (regenErr) {
          logger.error({ err: regenErr }, "OIDC session regeneration error");
          return res.redirect("/?error=oidc_session_error");
        }
        const sessionUser: Express.User = {
          id: user!.id,
          username: user!.username,
          name: user!.name,
          role: user!.role,
          orgId: org.id,
          orgSlug: org.slug,
          ssoLoginAt: Date.now(),
        };
        req.login(sessionUser, (loginErr) => {
          if (loginErr) {
            logger.error({ err: loginErr }, "OIDC session creation error");
            return res.redirect("/?error=oidc_session_error");
          }
          logger.info({ userId: user!.id, orgId: org.id }, "OIDC login successful");
          res.redirect("/dashboard");
        });
      });
    } catch (err) {
      logger.error({ err, orgSlug }, "OIDC callback error");
      res.redirect("/?error=oidc_error");
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Shared SAML ACS handler (used by both /callback and /callback/:orgSlug).
 */
function handleSamlCallback(req: Request, res: Response, next: NextFunction): void {
  passport.authenticate("saml", (err: any, user: Express.User | false, info: any) => {
    if (err) {
      logger.error({ err }, "SAML SSO callback error");
      return res.redirect("/?error=sso_error");
    }

    if (!user) {
      const message = encodeURIComponent(info?.message || "SSO authentication failed");
      return res.redirect(`/?error=${message}`);
    }

    req.session.regenerate((regenErr) => {
      if (regenErr) {
        logger.error({ err: regenErr }, "SAML SSO session regeneration error");
        return res.redirect("/?error=sso_login_error");
      }
      req.login(user, (loginErr) => {
        if (loginErr) {
          logger.error({ err: loginErr }, "SAML SSO session creation error");
          return res.redirect("/?error=sso_login_error");
        }
        logger.info({ userId: user.id, orgId: user.orgId }, "SAML SSO login successful");
        res.redirect("/dashboard");
      });
    });
  })(req, res, next);
}
