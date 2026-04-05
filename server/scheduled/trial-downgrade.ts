/**
 * Scheduled task: Trial auto-downgrade.
 * Checks for expired trial subscriptions and downgrades to free tier.
 */
import type { IStorage } from "../storage/types";
import { logger } from "../services/logger";

export async function runTrialDowngrade(storage: IStorage, orgs?: any[]): Promise<void> {
  try {
    if (!orgs) orgs = await storage.listOrganizations();
    const now = new Date();
    let downgraded = 0;

    for (const org of orgs) {
      const sub = await storage.getSubscription(org.id);
      if (!sub) continue;

      // Downgrade expired trials
      if (sub.status === "trialing" && sub.currentPeriodEnd) {
        const trialEnd = new Date(sub.currentPeriodEnd);
        if (now > trialEnd) {
          await storage.upsertSubscription(org.id, {
            orgId: org.id,
            planTier: "free",
            status: "active",
            billingInterval: "monthly",
            cancelAtPeriodEnd: false,
          });
          const { logPhiAccess } = await import("../services/audit-log");
          logPhiAccess({
            orgId: org.id,
            userId: "system",
            username: "system:trial-downgrade",
            role: "admin",
            ip: "localhost",
            userAgent: "trial-scheduler",
            event: "subscription_auto_downgraded",
            resourceType: "subscription",
            detail: `Trial expired — From: ${sub.planTier}, To: free`,
          });
          logger.info(
            { orgId: org.id, orgSlug: org.slug, previousTier: sub.planTier },
            "Trial expired — downgraded to free",
          );
          downgraded++;

          // Notify org admins about the downgrade
          try {
            const { buildTrialDowngradeEmail, sendEmail } = await import("../services/email");
            const users = await storage.listUsersByOrg(org.id);
            const admins = users.filter((u: any) => u.role === "admin");
            const dashboardUrl = process.env.APP_BASE_URL || `https://${org.slug}.observatory-qa.com`;
            for (const admin of admins) {
              if (!admin.username?.includes("@")) continue; // skip non-email usernames
              const emailOpts = buildTrialDowngradeEmail(org.name, dashboardUrl);
              emailOpts.to = admin.username;
              await sendEmail(emailOpts);
            }
          } catch (emailErr) {
            logger.warn({ err: emailErr, orgId: org.id }, "Failed to send trial downgrade email");
          }
        }
      }
    }

    if (downgraded > 0) {
      logger.info({ downgraded }, "Trial auto-downgrade complete");
    }
  } catch (error) {
    logger.error({ err: error }, "Error during trial auto-downgrade");
  }
}
