import type { Express } from "express";
import passport from "passport";
import { createHash } from "crypto";
import { storage } from "../storage";
import { logger } from "../services/logger";
import { logPhiAccess } from "../services/audit-log";

export function registerAuthRoutes(app: Express): void {
  // ==================== AUTH ROUTES (unauthenticated) ====================
  // Users are managed via AUTH_USERS environment variable (no registration)

  // Login — now MFA-aware
  app.post("/api/auth/login", (req, res, next) => {
    passport.authenticate("local", async (err: any, user: Express.User | false, info: any) => {
      if (err) return next(err);
      if (!user) {
        // Forward ambiguity info (username exists in multiple orgs)
        if (info?.code === "OBS-AUTH-008") {
          return res.status(409).json({
            message: info.message,
            errorCode: info.code,
            orgSlugs: info.orgSlugs,
          });
        }
        return res.status(401).json({ message: "Invalid credentials", errorCode: "OBS-AUTH-001" });
      }

      // Check if user has MFA enabled — if so, return challenge instead of session
      try {
        const dbUser = await storage.getUser(user.id);
        if (dbUser?.mfaEnabled) {
          // Check trusted device cookie — skip MFA challenge if device is trusted
          const tdCookie = req.cookies?.mfa_td as string | undefined;
          if (tdCookie) {
            const colonIdx = tdCookie.indexOf(":");
            if (colonIdx !== -1) {
              const cookieUserId = tdCookie.substring(0, colonIdx);
              const cookieToken = tdCookie.substring(colonIdx + 1);
              if (cookieUserId === user.id) {
                const tokenHash = createHash("sha256").update(cookieToken).digest("hex");
                const devices: any[] = (dbUser as any).mfaTrustedDevices || [];
                const trustedDevice = devices.find(
                  (d: any) => d.tokenHash === tokenHash && new Date(d.expiresAt) > new Date(),
                );
                if (trustedDevice) {
                  // Trusted device — proceed to session creation directly
                  req.login(user, (loginErr) => {
                    if (loginErr) return next(loginErr);
                    logPhiAccess({
                      event: "session_created",
                      orgId: user.orgId,
                      userId: user.id,
                      username: user.username,
                      role: user.role,
                      resourceType: "auth",
                      ip:
                        (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket?.remoteAddress,
                      detail: "Login via trusted device (MFA skipped)",
                    });
                    res.json({
                      id: user.id,
                      username: user.username,
                      name: user.name,
                      role: user.role,
                      orgId: user.orgId,
                      orgSlug: user.orgSlug,
                    });
                  });
                  return;
                }
              }
            }
          }
          // Don't create a session yet — require MFA verification
          return res.json({
            mfaRequired: true,
            userId: user.id,
            message: "MFA verification required",
          });
        }

        // Check if org enforces MFA and user hasn't set it up yet
        const org = await storage.getOrganization(user.orgId);
        if (org?.settings?.mfaRequired && !dbUser?.mfaEnabled) {
          // Check grace period deadline
          const enrollmentDeadline = (dbUser as any)?.mfaEnrollmentDeadline;
          if (enrollmentDeadline && new Date(enrollmentDeadline) < new Date()) {
            // Grace period expired — block login, force MFA enrollment
            return res.status(403).json({
              message:
                "MFA enrollment deadline has passed. You must enroll in MFA to continue. Contact your administrator.",
              mfaEnrollmentExpired: true,
              errorCode: "OBS-AUTH-007",
            });
          }

          // Allow login but flag that MFA setup is required
          // Note: passport 0.7+ handles session regeneration internally in req.login()
          req.login(user, (loginErr) => {
            if (loginErr) return next(loginErr);
            res.json({
              id: user.id,
              username: user.username,
              name: user.name,
              role: user.role,
              orgId: user.orgId,
              orgSlug: user.orgSlug,
              mfaSetupRequired: true,
              enrollmentDeadline: enrollmentDeadline || null,
              message: "Your organization requires MFA. Please set it up immediately.",
            });
          });
          return;
        }
      } catch (err) {
        logger.debug({ err }, "MFA check skipped — user lookup failed (e.g. env user)");
      }

      // Session fixation protection: passport 0.7+ automatically regenerates the
      // session inside req.login(), so no manual req.session.regenerate() is needed.
      req.login(user, (loginErr) => {
        if (loginErr) return next(loginErr);
        // HIPAA: log session creation with IP/UA (LocalStrategy only has username context)
        logPhiAccess({
          event: "session_created",
          orgId: user.orgId,
          userId: user.id,
          username: user.username,
          role: user.role,
          resourceType: "auth",
          ip: (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket?.remoteAddress,
          userAgent: req.headers["user-agent"],
          detail: "Interactive login session established",
        });
        res.json({
          id: user.id,
          username: user.username,
          name: user.name,
          role: user.role,
          orgId: user.orgId,
          orgSlug: user.orgSlug,
        });
      });
    })(req, res, next);
  });

  // Logout — destroy session to clear server-side session data
  app.post("/api/auth/logout", (req, res) => {
    // HIPAA: audit before destroying session so user identity is still available
    if (req.user) {
      const user = req.user as { id?: string; username?: string; role?: string; orgId?: string };
      logPhiAccess({
        event: "logout",
        orgId: user.orgId,
        userId: user.id,
        username: user.username,
        role: user.role,
        resourceType: "auth",
        ip: (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket?.remoteAddress,
        userAgent: req.headers["user-agent"],
        detail: "Session terminated by user",
      });
    }
    req.logout((err) => {
      if (err) {
        res.status(500).json({ message: "Failed to logout" });
        return;
      }
      req.session.destroy(() => {
        // Always clear the cookie regardless of destroy success/failure
        res.clearCookie("connect.sid");
        res.json({ message: "Logged out" });
      });
    });
  });

  // Get current session user
  app.get("/api/auth/me", (req, res) => {
    if (req.isAuthenticated() && req.user) {
      res.json(req.user);
    } else {
      res.status(401).json({ message: "Not authenticated" });
    }
  });
}
