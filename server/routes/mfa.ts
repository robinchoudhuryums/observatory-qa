/**
 * MFA (Multi-Factor Authentication) routes.
 *
 * HIPAA: MFA is a strongly recommended safeguard under the Security Rule.
 *
 * Endpoints:
 *   POST /api/auth/mfa/setup                          — Generate TOTP secret + QR code
 *   POST /api/auth/mfa/enable                         — Verify TOTP code & activate MFA
 *   POST /api/auth/mfa/verify                         — Verify TOTP during login (MFA challenge)
 *   POST /api/auth/mfa/disable                        — Disable MFA (requires current TOTP code)
 *   POST /api/auth/mfa/backup                         — Use a backup code during login
 *   GET  /api/auth/mfa/status                         — Get MFA enrollment status
 *   POST /api/auth/mfa/webauthn/register-options      — Begin WebAuthn registration
 *   POST /api/auth/mfa/webauthn/register-verify       — Complete WebAuthn registration
 *   POST /api/auth/mfa/webauthn/authenticate-options  — Begin WebAuthn authentication
 *   POST /api/auth/mfa/webauthn/authenticate-verify   — Complete WebAuthn authentication
 *   GET  /api/auth/mfa/webauthn/credentials           — List registered passkeys
 *   DELETE /api/auth/mfa/webauthn/credentials/:id     — Remove a passkey
 *   POST /api/auth/mfa/trusted-devices/revoke         — Revoke a trusted device
 *   GET  /api/auth/mfa/trusted-devices                — List trusted devices
 *   DELETE /api/auth/mfa/trusted-devices              — Revoke all trusted devices
 *   POST /api/auth/mfa/email-otp/send                 — Send email OTP (viewer/manager without smartphone)
 *   POST /api/auth/mfa/email-otp/verify               — Verify email OTP during login
 *   POST /api/auth/mfa/recovery/request               — Request emergency MFA bypass
 *   POST /api/auth/mfa/recovery/:token/verify-email   — Confirm email ownership for recovery
 *   POST /api/auth/mfa/recovery/:useToken/use         — Consume approved recovery token to login
 */
import type { Express } from "express";
import { generateSecret, generateURI, verify as verifyOtp } from "otplib";
import * as QRCode from "qrcode";
import { randomBytes, createHash } from "crypto";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import { requireAuth, injectOrgContext } from "../auth";
import { storage } from "../storage";
import { logPhiAccess, auditContext } from "../services/audit-log";
import { encryptMfaSecret, decryptMfaSecret } from "../services/phi-encryption";
import { logger } from "../services/logger";
import { sendEmail } from "../services/email";

// Rate limit MFA verification attempts (per session)
const mfaAttempts = new Map<string, { count: number; lastAttempt: number }>();
const MFA_MAX_ATTEMPTS = 5;
const MFA_LOCKOUT_MS = 15 * 60 * 1000;

function isMfaLocked(sessionId: string): boolean {
  const record = mfaAttempts.get(sessionId);
  if (!record || record.count < MFA_MAX_ATTEMPTS) return false;
  if (Date.now() - record.lastAttempt > MFA_LOCKOUT_MS) {
    mfaAttempts.delete(sessionId);
    return false;
  }
  return true;
}

function recordMfaAttempt(sessionId: string): void {
  const record = mfaAttempts.get(sessionId) || { count: 0, lastAttempt: 0 };
  record.count++;
  record.lastAttempt = Date.now();
  mfaAttempts.set(sessionId, record);
}

function clearMfaAttempts(sessionId: string): void {
  mfaAttempts.delete(sessionId);
}

// Prune stale MFA attempt records every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of Array.from(mfaAttempts)) {
    if (now - record.lastAttempt > MFA_LOCKOUT_MS * 2) mfaAttempts.delete(key);
  }
}, 5 * 60 * 1000).unref();

/**
 * Generate N random backup codes (8-char alphanumeric).
 * Returns { plain: string[], hashed: string[] }.
 */
function generateBackupCodes(count = 10): { plain: string[]; hashed: string[] } {
  const plain: string[] = [];
  const hashed: string[] = [];
  for (let i = 0; i < count; i++) {
    const code = randomBytes(4).toString("hex"); // 8 hex chars
    plain.push(code);
    hashed.push(createHash("sha256").update(code).digest("hex"));
  }
  return { plain, hashed };
}

function hashBackupCode(code: string): string {
  return createHash("sha256").update(code.toLowerCase().trim()).digest("hex");
}

export function registerMfaRoutes(app: Express): void {
  // ==================== MFA SETUP ====================
  // Step 1: Generate a TOTP secret and QR code URL (does NOT enable MFA yet)
  app.post("/api/auth/mfa/setup", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const user = await storage.getUser(req.user!.id);
      if (!user) return res.status(404).json({ message: "User not found" });

      if (user.mfaEnabled) {
        return res.status(400).json({ message: "MFA is already enabled. Disable it first to reconfigure." });
      }

      // Generate TOTP secret
      const secret = generateSecret();

      // Store encrypted secret (not yet enabled — user must verify first)
      const encryptedSecret = encryptMfaSecret(secret);
      await storage.updateUser(req.orgId!, user.id, { mfaSecret: encryptedSecret } as any);

      // Generate QR code for authenticator app
      const org = await storage.getOrganization(req.orgId!);
      const issuer = org?.settings?.branding?.appName || "Observatory QA";
      const otpAuthUrl = generateURI({ issuer, label: user.username, secret });
      const qrCodeDataUrl = await QRCode.toDataURL(otpAuthUrl);

      logPhiAccess({
        ...auditContext(req),
        event: "mfa_setup_initiated",
        resourceType: "auth",
        detail: "TOTP secret generated for MFA setup",
      });

      res.json({
        secret, // Show to user for manual entry
        qrCode: qrCodeDataUrl,
        message: "Scan the QR code with your authenticator app, then verify with a code to enable MFA.",
      });
    } catch (error) {
      logger.error({ err: error }, "MFA setup failed");
      res.status(500).json({ message: "Failed to set up MFA" });
    }
  });

  // ==================== MFA ENABLE ====================
  // Step 2: Verify a TOTP code to confirm setup and activate MFA
  app.post("/api/auth/mfa/enable", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const { code } = req.body;
      if (!code || typeof code !== "string") {
        return res.status(400).json({ message: "Verification code is required" });
      }

      const user = await storage.getUser(req.user!.id);
      if (!user) return res.status(404).json({ message: "User not found" });
      if (user.mfaEnabled) return res.status(400).json({ message: "MFA is already enabled" });
      if (!user.mfaSecret) return res.status(400).json({ message: "Run MFA setup first" });

      const secret = decryptMfaSecret(user.mfaSecret);
      const isValid = (await verifyOtp({ token: code.trim(), secret })).valid;

      if (!isValid) {
        logPhiAccess({
          ...auditContext(req),
          event: "mfa_enable_failed",
          resourceType: "auth",
          detail: "Invalid TOTP code during MFA enable",
        });
        return res.status(400).json({ message: "Invalid verification code. Check your authenticator app and try again." });
      }

      // Generate backup codes
      const { plain, hashed } = generateBackupCodes(10);

      // Enable MFA
      await storage.updateUser(req.orgId!, user.id, {
        mfaEnabled: true,
        mfaBackupCodes: hashed,
      } as any);

      logPhiAccess({
        ...auditContext(req),
        event: "mfa_enabled",
        resourceType: "auth",
        detail: "MFA enabled via TOTP verification",
      });

      res.json({
        message: "MFA enabled successfully.",
        backupCodes: plain,
        warning: "Save these backup codes securely. They will not be shown again.",
      });
    } catch (error) {
      logger.error({ err: error }, "MFA enable failed");
      res.status(500).json({ message: "Failed to enable MFA" });
    }
  });

  // ==================== MFA VERIFY (login challenge) ====================
  // Called after password auth succeeds for MFA-enabled users
  app.post("/api/auth/mfa/verify", async (req, res) => {
    try {
      const { userId, code, trustDevice } = req.body;
      if (!userId || !code) {
        return res.status(400).json({ message: "userId and code are required" });
      }

      const sessionId = req.sessionID || req.ip || "unknown";
      if (isMfaLocked(sessionId)) {
        return res.status(429).json({ message: "Too many MFA attempts. Try again later." });
      }

      const user = await storage.getUser(userId);
      if (!user || !user.mfaEnabled || !user.mfaSecret) {
        return res.status(400).json({ message: "MFA not configured for this user" });
      }

      const secret = decryptMfaSecret(user.mfaSecret);
      const isValid = (await verifyOtp({ token: code.trim(), secret })).valid;

      if (!isValid) {
        recordMfaAttempt(sessionId);
        logPhiAccess({
          userId: user.id,
          username: user.username,
          orgId: user.orgId,
          event: "mfa_verify_failed",
          resourceType: "auth",
          ip: (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket?.remoteAddress,
        });
        return res.status(401).json({ message: "Invalid MFA code" });
      }

      clearMfaAttempts(sessionId);

      // Complete login — create session
      const org = await storage.getOrganization(user.orgId);
      const sessionUser = {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
        orgId: user.orgId,
        orgSlug: org?.slug || "default",
      };

      // Regenerate session before login to prevent session fixation
      req.session.regenerate((regenErr) => {
        if (regenErr) {
          logger.error({ err: regenErr }, "Session regeneration failed after MFA verify");
          return res.status(500).json({ message: "Login failed" });
        }

        req.login(sessionUser, async (loginErr) => {
          if (loginErr) {
            logger.error({ err: loginErr }, "Session creation failed after MFA verify");
            return res.status(500).json({ message: "Login failed" });
          }

          logPhiAccess({
            userId: user.id,
            username: user.username,
            orgId: user.orgId,
            event: "mfa_verify_success",
            resourceType: "auth",
            detail: "MFA verification completed, session created",
            ip: (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket?.remoteAddress,
          });

          const responseBody: any = { ...sessionUser };
          if (trustDevice) {
            const token = randomBytes(32).toString("hex");
            const tokenHash = createHash("sha256").update(token).digest("hex");
            const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
            const deviceName = req.headers["user-agent"]?.substring(0, 100) || "Unknown device";
            const dbUser = await storage.getUser(user.id);
            const devices: any[] = (dbUser as any)?.mfaTrustedDevices || [];
            const active = devices.filter((d: any) => new Date(d.expiresAt) > new Date());
            await storage.updateUser(user.orgId, user.id, {
              mfaTrustedDevices: [...active, { tokenHash, name: deviceName, createdAt: new Date().toISOString(), expiresAt }],
            } as any);
            res.cookie("mfa_td", `${user.id}:${token}`, {
              httpOnly: true, sameSite: "lax",
              secure: process.env.NODE_ENV === "production",
              maxAge: 30 * 24 * 60 * 60 * 1000,
            });
            responseBody.trustedDeviceSet = true;
          }

          res.json(responseBody);
        });
      });
    } catch (error) {
      logger.error({ err: error }, "MFA verification failed");
      res.status(500).json({ message: "MFA verification failed" });
    }
  });

  // ==================== MFA BACKUP CODE ====================
  // Use a backup code when authenticator app is unavailable
  app.post("/api/auth/mfa/backup", async (req, res) => {
    try {
      const { userId, backupCode } = req.body;
      if (!userId || !backupCode) {
        return res.status(400).json({ message: "userId and backupCode are required" });
      }

      const sessionId = req.sessionID || req.ip || "unknown";
      if (isMfaLocked(sessionId)) {
        return res.status(429).json({ message: "Too many MFA attempts. Try again later." });
      }

      const user = await storage.getUser(userId);
      if (!user || !user.mfaEnabled) {
        return res.status(400).json({ message: "MFA not configured for this user" });
      }

      const backupCodes = user.mfaBackupCodes || [];
      const hashedInput = hashBackupCode(backupCode);
      const codeIndex = backupCodes.indexOf(hashedInput);

      if (codeIndex === -1) {
        recordMfaAttempt(sessionId);
        logPhiAccess({
          userId: user.id,
          username: user.username,
          orgId: user.orgId,
          event: "mfa_backup_failed",
          resourceType: "auth",
          ip: (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket?.remoteAddress,
        });
        return res.status(401).json({ message: "Invalid backup code" });
      }

      // Remove used backup code (one-time use)
      const remainingCodes = [...backupCodes];
      remainingCodes.splice(codeIndex, 1);
      await storage.updateUser(user.orgId, user.id, { mfaBackupCodes: remainingCodes } as any);

      clearMfaAttempts(sessionId);

      // Complete login
      const org = await storage.getOrganization(user.orgId);
      const sessionUser = {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
        orgId: user.orgId,
        orgSlug: org?.slug || "default",
      };

      // Regenerate session before login to prevent session fixation
      req.session.regenerate((regenErr) => {
        if (regenErr) return res.status(500).json({ message: "Login failed" });

        req.login(sessionUser, (loginErr) => {
          if (loginErr) return res.status(500).json({ message: "Login failed" });

          logPhiAccess({
            userId: user.id,
            username: user.username,
            orgId: user.orgId,
            event: "mfa_backup_used",
            resourceType: "auth",
            detail: `Backup code used. ${remainingCodes.length} remaining.`,
            ip: (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket?.remoteAddress,
          });

          res.json({
            ...sessionUser,
            warning: `Backup code accepted. You have ${remainingCodes.length} backup codes remaining.`,
          });
        });
      });
    } catch (error) {
      logger.error({ err: error }, "Backup code verification failed");
      res.status(500).json({ message: "Backup code verification failed" });
    }
  });

  // ==================== MFA DISABLE ====================
  app.post("/api/auth/mfa/disable", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const { code } = req.body;
      if (!code) return res.status(400).json({ message: "Current MFA code is required to disable MFA" });

      const user = await storage.getUser(req.user!.id);
      if (!user) return res.status(404).json({ message: "User not found" });
      if (!user.mfaEnabled || !user.mfaSecret) {
        return res.status(400).json({ message: "MFA is not enabled" });
      }

      // Check if org enforces MFA
      const org = await storage.getOrganization(req.orgId!);
      if (org?.settings?.mfaRequired) {
        return res.status(403).json({ message: "Your organization requires MFA. Contact an admin to change this policy." });
      }

      const secret = decryptMfaSecret(user.mfaSecret);
      const isValid = (await verifyOtp({ token: code.trim(), secret })).valid;
      if (!isValid) {
        logPhiAccess({
          ...auditContext(req),
          event: "mfa_disable_failed",
          resourceType: "auth",
          detail: "Invalid TOTP code during MFA disable",
        });
        return res.status(401).json({ message: "Invalid MFA code" });
      }

      await storage.updateUser(req.orgId!, user.id, {
        mfaEnabled: false,
        mfaSecret: undefined,
        mfaBackupCodes: undefined,
      } as any);

      logPhiAccess({
        ...auditContext(req),
        event: "mfa_disabled",
        resourceType: "auth",
        detail: "MFA disabled by user",
      });

      res.json({ message: "MFA has been disabled." });
    } catch (error) {
      logger.error({ err: error }, "MFA disable failed");
      res.status(500).json({ message: "Failed to disable MFA" });
    }
  });

  // ==================== MFA STATUS ====================
  app.get("/api/auth/mfa/status", requireAuth, async (req, res) => {
    try {
      const user = await storage.getUser(req.user!.id);
      if (!user) return res.status(404).json({ message: "User not found" });

      const org = await storage.getOrganization(user.orgId);
      const mfaRequired = org?.settings?.mfaRequired || false;
      const enrollmentDeadline = (user as any).mfaEnrollmentDeadline || null;
      const gracePeriodDaysLeft = enrollmentDeadline
        ? Math.max(0, Math.ceil((new Date(enrollmentDeadline).getTime() - Date.now()) / 86400000))
        : null;

      res.json({
        mfaEnabled: user.mfaEnabled || false,
        mfaRequired,
        backupCodesRemaining: user.mfaBackupCodes?.length || 0,
        webauthnCredentials: ((user as any).webauthnCredentials || []).map((c: any) => ({
          credentialId: c.credentialId,
          name: c.name,
          createdAt: c.createdAt,
          transports: c.transports,
        })),
        trustedDevices: ((user as any).mfaTrustedDevices || [])
          .filter((d: any) => new Date(d.expiresAt) > new Date())
          .map((d: any) => ({ name: d.name, createdAt: d.createdAt, expiresAt: d.expiresAt })),
        enrollmentDeadline,
        gracePeriodDaysLeft,
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to get MFA status" });
    }
  });

  // ==================== WEBAUTHN REGISTRATION ====================

  app.post("/api/auth/mfa/webauthn/register-options", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const user = await storage.getUser(req.user!.id);
      if (!user) return res.status(404).json({ message: "User not found" });

      const org = await storage.getOrganization(req.orgId!);
      const rpName = org?.settings?.branding?.appName || "Observatory QA";
      const hostname = req.hostname || "localhost";
      const existingCredentials = ((user as any).webauthnCredentials || []) as Array<{ credentialId: string; transports?: string[] }>;

      const options = await generateRegistrationOptions({
        rpName,
        rpID: hostname,
        userName: user.username,
        userDisplayName: user.name,
        attestationType: "none",
        authenticatorSelection: {
          residentKey: "preferred",
          userVerification: "preferred",
        },
        excludeCredentials: existingCredentials.map((c) => ({
          id: c.credentialId,
          transports: (c.transports || []) as any,
        })),
      });

      // Store challenge in session for verification
      (req.session as any).webauthnChallenge = options.challenge;

      res.json(options);
    } catch (error) {
      logger.error({ err: error }, "WebAuthn register-options failed");
      res.status(500).json({ message: "Failed to generate registration options" });
    }
  });

  app.post("/api/auth/mfa/webauthn/register-verify", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const { response, credentialName } = req.body as { response: any; credentialName?: string };
      const expectedChallenge = (req.session as any).webauthnChallenge;
      if (!expectedChallenge) return res.status(400).json({ message: "No registration challenge found. Start registration again." });

      const hostname = req.hostname || "localhost";
      const expectedOrigin = `${req.protocol}://${req.get("host") || hostname}`;

      let verification;
      try {
        verification = await verifyRegistrationResponse({
          response,
          expectedChallenge,
          expectedOrigin,
          expectedRPID: hostname,
          requireUserVerification: false,
        });
      } catch (err) {
        logger.warn({ err }, "WebAuthn registration verification failed");
        return res.status(400).json({ message: "WebAuthn verification failed. Please try again." });
      }

      if (!verification.verified || !verification.registrationInfo) {
        return res.status(400).json({ message: "WebAuthn registration not verified" });
      }

      delete (req.session as any).webauthnChallenge;

      const { credential } = verification.registrationInfo;
      const user = await storage.getUser(req.user!.id);
      if (!user) return res.status(404).json({ message: "User not found" });

      const existing: any[] = (user as any).webauthnCredentials || [];
      const newCredential = {
        credentialId: isoBase64URL.fromBuffer(credential.id as unknown as Uint8Array),
        publicKey: isoBase64URL.fromBuffer(credential.publicKey as unknown as Uint8Array),
        counter: credential.counter,
        transports: response.response.transports || [],
        name: credentialName || `Passkey ${existing.length + 1}`,
        createdAt: new Date().toISOString(),
      };

      await storage.updateUser(req.orgId!, user.id, {
        webauthnCredentials: [...existing, newCredential],
      } as any);

      logPhiAccess({
        ...auditContext(req),
        event: "webauthn_registered",
        resourceType: "auth",
        detail: `WebAuthn credential registered: ${newCredential.name}`,
      });

      res.json({ message: "Passkey registered successfully.", credentialId: newCredential.credentialId, name: newCredential.name });
    } catch (error) {
      logger.error({ err: error }, "WebAuthn register-verify failed");
      res.status(500).json({ message: "Failed to verify registration" });
    }
  });

  // ==================== WEBAUTHN AUTHENTICATION ====================

  app.post("/api/auth/mfa/webauthn/authenticate-options", async (req, res) => {
    try {
      const { userId } = req.body;
      if (!userId) return res.status(400).json({ message: "userId is required" });

      const user = await storage.getUser(userId);
      if (!user) return res.status(400).json({ message: "User not found" });

      const existingCredentials = ((user as any).webauthnCredentials || []) as Array<{ credentialId: string; transports?: string[] }>;
      const hostname = req.hostname || "localhost";

      const options = await generateAuthenticationOptions({
        rpID: hostname,
        userVerification: "preferred",
        allowCredentials: existingCredentials.map((c) => ({
          id: c.credentialId,
          transports: (c.transports || []) as any,
        })),
      });

      (req.session as any).webauthnChallenge = options.challenge;

      res.json(options);
    } catch (error) {
      logger.error({ err: error }, "WebAuthn authenticate-options failed");
      res.status(500).json({ message: "Failed to generate authentication options" });
    }
  });

  app.post("/api/auth/mfa/webauthn/authenticate-verify", async (req, res) => {
    try {
      const { userId, response, trustDevice } = req.body as {
        userId: string;
        response: any;
        trustDevice?: boolean;
      };
      if (!userId || !response) return res.status(400).json({ message: "userId and response are required" });

      const sessionId = req.sessionID || req.ip || "unknown";
      if (isMfaLocked(sessionId)) return res.status(429).json({ message: "Too many MFA attempts. Try again later." });

      const expectedChallenge = (req.session as any).webauthnChallenge;
      if (!expectedChallenge) return res.status(400).json({ message: "No authentication challenge found." });

      const user = await storage.getUser(userId);
      if (!user) return res.status(400).json({ message: "User not found" });

      const credentials: any[] = (user as any).webauthnCredentials || [];
      const credentialId = response.id;
      const storedCredential = credentials.find((c) => c.credentialId === credentialId);
      if (!storedCredential) {
        recordMfaAttempt(sessionId);
        return res.status(400).json({ message: "Credential not registered for this user" });
      }

      const hostname = req.hostname || "localhost";
      const expectedOrigin = `${req.protocol}://${req.get("host") || hostname}`;

      let verification;
      try {
        verification = await verifyAuthenticationResponse({
          response,
          expectedChallenge,
          expectedOrigin,
          expectedRPID: hostname,
          credential: {
            id: storedCredential.credentialId,
            publicKey: isoBase64URL.toBuffer(storedCredential.publicKey) as unknown as Uint8Array,
            counter: storedCredential.counter,
            transports: (storedCredential.transports || []) as any,
          },
        });
      } catch (err) {
        recordMfaAttempt(sessionId);
        logger.warn({ err }, "WebAuthn authentication verification failed");
        return res.status(401).json({ message: "WebAuthn verification failed" });
      }

      if (!verification.verified) {
        recordMfaAttempt(sessionId);
        return res.status(401).json({ message: "WebAuthn authentication not verified" });
      }

      delete (req.session as any).webauthnChallenge;
      clearMfaAttempts(sessionId);

      // Update counter
      storedCredential.counter = verification.authenticationInfo.newCounter;
      await storage.updateUser(user.orgId, user.id, { webauthnCredentials: credentials } as any);

      const org = await storage.getOrganization(user.orgId);
      const sessionUser = {
        id: user.id, username: user.username, name: user.name,
        role: user.role, orgId: user.orgId, orgSlug: org?.slug || "default",
      };

      req.session.regenerate((regenErr) => {
        if (regenErr) return res.status(500).json({ message: "Login failed" });

        req.login(sessionUser, async (loginErr) => {
          if (loginErr) return res.status(500).json({ message: "Login failed" });

          logPhiAccess({
            userId: user.id, username: user.username, orgId: user.orgId,
            event: "webauthn_login_success", resourceType: "auth",
            detail: `WebAuthn authentication completed`,
            ip: (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket?.remoteAddress,
          });

          const responseBody: any = { ...sessionUser };
          if (trustDevice) {
            const token = randomBytes(32).toString("hex");
            const tokenHash = createHash("sha256").update(token).digest("hex");
            const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
            const deviceName = req.headers["user-agent"]?.substring(0, 100) || "Unknown device";
            const devices: any[] = (user as any).mfaTrustedDevices || [];
            // Prune expired devices
            const active = devices.filter((d: any) => new Date(d.expiresAt) > new Date());
            await storage.updateUser(user.orgId, user.id, {
              mfaTrustedDevices: [...active, { tokenHash, name: deviceName, createdAt: new Date().toISOString(), expiresAt }],
            } as any);
            res.cookie("mfa_td", `${user.id}:${token}`, {
              httpOnly: true, sameSite: "lax",
              secure: process.env.NODE_ENV === "production",
              maxAge: 30 * 24 * 60 * 60 * 1000,
            });
            responseBody.trustedDeviceSet = true;
          }

          res.json(responseBody);
        });
      });
    } catch (error) {
      logger.error({ err: error }, "WebAuthn authenticate-verify failed");
      res.status(500).json({ message: "WebAuthn authentication failed" });
    }
  });

  // ==================== WEBAUTHN CREDENTIAL MANAGEMENT ====================

  app.get("/api/auth/mfa/webauthn/credentials", requireAuth, async (req, res) => {
    try {
      const user = await storage.getUser(req.user!.id);
      if (!user) return res.status(404).json({ message: "User not found" });

      const credentials = ((user as any).webauthnCredentials || []).map((c: any) => ({
        credentialId: c.credentialId,
        name: c.name,
        createdAt: c.createdAt,
        transports: c.transports,
      }));

      res.json({ credentials });
    } catch (error) {
      res.status(500).json({ message: "Failed to list WebAuthn credentials" });
    }
  });

  app.delete("/api/auth/mfa/webauthn/credentials/:credentialId", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const user = await storage.getUser(req.user!.id);
      if (!user) return res.status(404).json({ message: "User not found" });

      const { credentialId } = req.params;
      const credentials: any[] = (user as any).webauthnCredentials || [];
      const filtered = credentials.filter((c) => c.credentialId !== credentialId);

      if (filtered.length === credentials.length) {
        return res.status(404).json({ message: "Credential not found" });
      }

      await storage.updateUser(req.orgId!, user.id, { webauthnCredentials: filtered } as any);

      logPhiAccess({
        ...auditContext(req),
        event: "webauthn_credential_removed",
        resourceType: "auth",
        detail: `Passkey removed: ${credentialId.substring(0, 16)}...`,
      });

      res.json({ message: "Passkey removed." });
    } catch (error) {
      res.status(500).json({ message: "Failed to remove passkey" });
    }
  });

  // ==================== TRUSTED DEVICE MANAGEMENT ====================

  app.get("/api/auth/mfa/trusted-devices", requireAuth, async (req, res) => {
    try {
      const user = await storage.getUser(req.user!.id);
      if (!user) return res.status(404).json({ message: "User not found" });

      const devices = ((user as any).mfaTrustedDevices || [])
        .filter((d: any) => new Date(d.expiresAt) > new Date())
        .map((d: any) => ({ name: d.name, createdAt: d.createdAt, expiresAt: d.expiresAt }));

      res.json({ devices });
    } catch (error) {
      res.status(500).json({ message: "Failed to list trusted devices" });
    }
  });

  app.delete("/api/auth/mfa/trusted-devices", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const user = await storage.getUser(req.user!.id);
      if (!user) return res.status(404).json({ message: "User not found" });

      await storage.updateUser(req.orgId!, user.id, { mfaTrustedDevices: [] } as any);
      res.clearCookie("mfa_td");

      logPhiAccess({
        ...auditContext(req),
        event: "trusted_devices_revoked_all",
        resourceType: "auth",
        detail: "All trusted devices revoked",
      });

      res.json({ message: "All trusted devices revoked." });
    } catch (error) {
      res.status(500).json({ message: "Failed to revoke trusted devices" });
    }
  });

  // ==================== EMAIL OTP (viewer/manager fallback) ====================
  // For clinical staff without smartphones — send a 6-digit OTP via email

  // In-memory email OTP store (userId → { code, expiresAt, attempts })
  // Note: for multi-instance deployments, move this to Redis
  const emailOtpStore = new Map<string, { codeHash: string; expiresAt: number; attempts: number }>();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of Array.from(emailOtpStore)) {
      if (v.expiresAt < now) emailOtpStore.delete(k);
    }
  }, 5 * 60 * 1000).unref();

  app.post("/api/auth/mfa/email-otp/send", async (req, res) => {
    try {
      const { userId } = req.body;
      if (!userId) return res.status(400).json({ message: "userId is required" });

      const user = await storage.getUser(userId);
      if (!user) return res.status(400).json({ message: "User not found" });

      // Only viewer/manager — admins should use TOTP or WebAuthn
      if (user.role === "admin") {
        return res.status(403).json({ message: "Admins must use TOTP or WebAuthn for MFA." });
      }

      // Rate limit: don't allow resend within 60 seconds
      const existing = emailOtpStore.get(userId);
      if (existing && existing.expiresAt - 9 * 60 * 1000 > Date.now()) {
        return res.status(429).json({ message: "OTP recently sent. Please wait before requesting another." });
      }

      const otp = String(Math.floor(100000 + Math.random() * 900000)); // 6 digits
      const codeHash = createHash("sha256").update(otp).digest("hex");
      emailOtpStore.set(userId, { codeHash, expiresAt: Date.now() + 10 * 60 * 1000, attempts: 0 });

      // Get user email (username may be email)
      const userEmail = user.username.includes("@") ? user.username : null;
      if (!userEmail) {
        return res.status(400).json({ message: "No email address found for this account." });
      }

      await sendEmail({
        to: userEmail,
        subject: "Your Observatory QA login code",
        text: `Your one-time login code is: ${otp}\n\nThis code expires in 10 minutes.\n\nIf you did not request this, contact your administrator.`,
        html: `<p>Your one-time login code is: <strong>${otp}</strong></p><p>This code expires in 10 minutes.</p><p>If you did not request this, contact your administrator.</p>`,
      });

      logPhiAccess({
        userId: user.id, username: user.username, orgId: user.orgId,
        event: "email_otp_sent", resourceType: "auth",
        detail: "Email OTP sent for MFA login",
        ip: (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket?.remoteAddress,
      });

      res.json({ message: "OTP sent to your email address." });
    } catch (error) {
      logger.error({ err: error }, "Email OTP send failed");
      res.status(500).json({ message: "Failed to send OTP" });
    }
  });

  app.post("/api/auth/mfa/email-otp/verify", async (req, res) => {
    try {
      const { userId, otp } = req.body;
      if (!userId || !otp) return res.status(400).json({ message: "userId and otp are required" });

      const sessionId = req.sessionID || req.ip || "unknown";
      if (isMfaLocked(sessionId)) return res.status(429).json({ message: "Too many MFA attempts. Try again later." });

      const stored = emailOtpStore.get(userId);
      if (!stored) return res.status(400).json({ message: "No OTP found. Request a new one." });
      if (stored.expiresAt < Date.now()) {
        emailOtpStore.delete(userId);
        return res.status(400).json({ message: "OTP has expired. Request a new one." });
      }

      stored.attempts++;
      if (stored.attempts > 5) {
        emailOtpStore.delete(userId);
        recordMfaAttempt(sessionId);
        return res.status(429).json({ message: "Too many OTP attempts." });
      }

      const inputHash = createHash("sha256").update(String(otp).trim()).digest("hex");
      if (inputHash !== stored.codeHash) {
        recordMfaAttempt(sessionId);
        return res.status(401).json({ message: "Invalid OTP." });
      }

      emailOtpStore.delete(userId);
      clearMfaAttempts(sessionId);

      const user = await storage.getUser(userId);
      if (!user) return res.status(400).json({ message: "User not found" });

      const org = await storage.getOrganization(user.orgId);
      const sessionUser = {
        id: user.id, username: user.username, name: user.name,
        role: user.role, orgId: user.orgId, orgSlug: org?.slug || "default",
      };

      req.session.regenerate((regenErr) => {
        if (regenErr) return res.status(500).json({ message: "Login failed" });

        req.login(sessionUser, (loginErr) => {
          if (loginErr) return res.status(500).json({ message: "Login failed" });

          logPhiAccess({
            userId: user.id, username: user.username, orgId: user.orgId,
            event: "email_otp_verify_success", resourceType: "auth",
            detail: "Email OTP verification completed, session created",
            ip: (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket?.remoteAddress,
          });

          res.json(sessionUser);
        });
      });
    } catch (error) {
      logger.error({ err: error }, "Email OTP verify failed");
      res.status(500).json({ message: "Email OTP verification failed" });
    }
  });

  // ==================== MFA RECOVERY (emergency bypass) ====================
  // Flow: user requests bypass → email verified → admin approves → one-time login token

  // In-memory recovery store: token → { userId, orgId, emailVerified, status, useTokenHash, useTokenExpiresAt }
  // For production/multi-instance: persist to mfa_recovery_requests table
  const recoveryStore = new Map<string, {
    userId: string; orgId: string; tokenHash: string;
    emailVerified: boolean; status: "pending" | "email_verified" | "approved" | "denied" | "used";
    useTokenHash?: string; useTokenExpiresAt?: number; createdAt: number;
  }>();
  setInterval(() => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const [k, v] of Array.from(recoveryStore)) {
      if (v.createdAt < cutoff) recoveryStore.delete(k);
    }
  }, 60 * 60 * 1000).unref();

  // Step 1: User requests bypass
  app.post("/api/auth/mfa/recovery/request", async (req, res) => {
    try {
      const { userId } = req.body;
      if (!userId) return res.status(400).json({ message: "userId is required" });

      const user = await storage.getUser(userId);
      if (!user) return res.status(400).json({ message: "User not found" });
      if (!user.mfaEnabled) return res.status(400).json({ message: "MFA is not enabled for this account" });

      // Rate limit: one active request per user
      for (const [, v] of Array.from(recoveryStore)) {
        if (v.userId === userId && v.status !== "used" && v.status !== "denied" && v.createdAt > Date.now() - 24 * 60 * 60 * 1000) {
          return res.status(429).json({ message: "A recovery request is already pending." });
        }
      }

      const token = randomBytes(32).toString("hex");
      const tokenHash = createHash("sha256").update(token).digest("hex");
      recoveryStore.set(tokenHash, {
        userId: user.id, orgId: user.orgId, tokenHash,
        emailVerified: false, status: "pending", createdAt: Date.now(),
      });

      // Send email to verify ownership
      const userEmail = user.username.includes("@") ? user.username : null;
      if (userEmail) {
        const verifyLink = `${process.env.APP_BASE_URL || ""}/mfa-recovery?token=${token}`;
        await sendEmail({
          to: userEmail,
          subject: "MFA Recovery Request — Observatory QA",
          text: `An MFA bypass was requested for your account.\n\nTo proceed, verify your email by clicking:\n${verifyLink}\n\nThis link expires in 24 hours. If you did not request this, contact your administrator immediately.`,
          html: `<p>An MFA bypass was requested for your account.</p><p><a href="${verifyLink}">Verify your email to proceed</a></p><p>This link expires in 24 hours. If you did not request this, contact your administrator immediately.</p>`,
        });
      }

      logPhiAccess({
        userId: user.id, username: user.username, orgId: user.orgId,
        event: "mfa_recovery_requested", resourceType: "auth",
        detail: "Emergency MFA bypass requested",
        ip: (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket?.remoteAddress,
      });

      res.json({ message: "Recovery request submitted. Check your email to verify ownership, then wait for admin approval." });
    } catch (error) {
      logger.error({ err: error }, "MFA recovery request failed");
      res.status(500).json({ message: "Failed to submit recovery request" });
    }
  });

  // Step 2: User clicks email verification link
  app.post("/api/auth/mfa/recovery/:token/verify-email", async (req, res) => {
    try {
      const { token } = req.params;
      const tokenHash = createHash("sha256").update(token).digest("hex");
      const record = recoveryStore.get(tokenHash);

      if (!record || record.createdAt < Date.now() - 24 * 60 * 60 * 1000) {
        return res.status(400).json({ message: "Invalid or expired recovery token" });
      }
      if (record.status !== "pending") {
        return res.status(400).json({ message: "This recovery request has already been processed" });
      }

      record.emailVerified = true;
      record.status = "email_verified";
      recoveryStore.set(tokenHash, record);

      // Notify org admins that a recovery request needs approval
      const user = await storage.getUser(record.userId);
      if (user) {
        const admins = await storage.listUsersByOrg(record.orgId);
        const adminEmails = admins
          .filter((u) => u.role === "admin" && u.username.includes("@"))
          .map((u) => u.username);

        for (const adminEmail of adminEmails) {
          await sendEmail({
            to: adminEmail,
            subject: "Action Required: MFA Recovery Approval — Observatory QA",
            text: `User ${user.name} (${user.username}) has verified their email for an emergency MFA bypass.\n\nPlease review and approve or deny this request in the admin panel under Admin → MFA Recovery Requests.`,
            html: `<p>User <strong>${user.name}</strong> (${user.username}) has verified their email for an emergency MFA bypass.</p><p>Please review and approve or deny this request in the admin panel under <strong>Admin → MFA Recovery Requests</strong>.</p>`,
          }).catch(() => {}); // don't fail if email bounces
        }

        logPhiAccess({
          userId: user.id, username: user.username, orgId: user.orgId,
          event: "mfa_recovery_email_verified", resourceType: "auth",
          detail: "Email verified for MFA recovery request",
          ip: (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket?.remoteAddress,
        });
      }

      res.json({ message: "Email verified. Your recovery request is now pending admin approval." });
    } catch (error) {
      logger.error({ err: error }, "MFA recovery email verify failed");
      res.status(500).json({ message: "Failed to verify email" });
    }
  });

  // Step 3: Consume admin-approved use-token to complete login
  app.post("/api/auth/mfa/recovery/:useToken/use", async (req, res) => {
    try {
      const { useToken } = req.params;
      const useTokenHash = createHash("sha256").update(useToken).digest("hex");

      // Find record by useTokenHash
      let foundKey: string | undefined;
      let record: typeof recoveryStore extends Map<string, infer V> ? V : never = undefined as any;
      for (const [k, v] of Array.from(recoveryStore)) {
        if (v.useTokenHash === useTokenHash) {
          foundKey = k;
          record = v;
          break;
        }
      }

      if (!foundKey || !record || record.status !== "approved") {
        return res.status(400).json({ message: "Invalid or unapproved recovery token" });
      }
      if (record.useTokenExpiresAt && record.useTokenExpiresAt < Date.now()) {
        record.status = "used";
        recoveryStore.set(foundKey, record);
        return res.status(400).json({ message: "Recovery token has expired" });
      }

      // Mark as used
      record.status = "used";
      recoveryStore.set(foundKey, record);

      const user = await storage.getUser(record.userId);
      if (!user) return res.status(400).json({ message: "User not found" });

      const org = await storage.getOrganization(user.orgId);
      const sessionUser = {
        id: user.id, username: user.username, name: user.name,
        role: user.role, orgId: user.orgId, orgSlug: org?.slug || "default",
      };

      req.session.regenerate((regenErr) => {
        if (regenErr) return res.status(500).json({ message: "Login failed" });

        req.login(sessionUser, (loginErr) => {
          if (loginErr) return res.status(500).json({ message: "Login failed" });

          logPhiAccess({
            userId: user.id, username: user.username, orgId: user.orgId,
            event: "mfa_recovery_used", resourceType: "auth",
            detail: "MFA recovery token used — emergency bypass login completed",
            ip: (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket?.remoteAddress,
          });

          res.json({
            ...sessionUser,
            warning: "Emergency MFA bypass used. Please re-enroll in MFA immediately.",
          });
        });
      });
    } catch (error) {
      logger.error({ err: error }, "MFA recovery use failed");
      res.status(500).json({ message: "Failed to use recovery token" });
    }
  });

  // Export recovery store for admin routes to use
  (app as any).__mfaRecoveryStore = recoveryStore;
}
