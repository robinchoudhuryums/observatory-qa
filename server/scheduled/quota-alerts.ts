/**
 * Scheduled task: Proactive quota alerts.
 * Emails org admins when usage hits 80% or 100% of plan limits.
 */
import type { IStorage } from "../storage/types";
import { sendEmail, buildQuotaAlertEmail } from "../services/email";
import { logger } from "../services/logger";
import { PLAN_DEFINITIONS, type PlanTier } from "@shared/schema";

export async function runQuotaAlerts(storage: IStorage, orgs?: any[]): Promise<void> {
  try {
    if (!orgs) orgs = await storage.listOrganizations();
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const dashboardUrl = process.env.APP_BASE_URL || "https://app.observatory-qa.com";

    for (const org of orgs) {
      const sub = await storage.getSubscription(org.id);
      const tier = (sub?.planTier as PlanTier) || "free";
      const plan = PLAN_DEFINITIONS[tier];
      if (!plan) continue;

      const usage = await storage.getUsageSummary(org.id, periodStart);
      const usageMap: Record<string, number> = {};
      for (const u of usage) usageMap[u.eventType] = u.totalQuantity;

      const warnings: Array<{ label: string; used: number; limit: number; pct: number }> = [];
      const check = (label: string, eventType: string, limitKey: keyof typeof plan.limits) => {
        const limit = plan.limits[limitKey] as number;
        if (limit <= 0 || limit === -1) return;
        const used = usageMap[eventType] || 0;
        const pct = Math.round((used / limit) * 100);
        if (pct >= 80) warnings.push({ label, used, limit, pct });
      };

      check("Calls", "transcription", "callsPerMonth");
      check("AI Analyses", "ai_analysis", "aiAnalysesPerMonth");

      if (warnings.length === 0) continue;

      // Get admin/manager users with email addresses
      const users = await storage.listUsersByOrg(org.id);
      const recipients = users.filter(
        (u) => (u.role === "admin" || u.role === "manager") && u.username?.includes("@"),
      );
      if (recipients.length === 0) continue;

      const isExhausted = warnings.some((w) => w.pct >= 100);
      const orgName = org.name || org.slug || "Observatory QA";
      const emailTemplate = buildQuotaAlertEmail(orgName, warnings, isExhausted, dashboardUrl);

      await Promise.allSettled(recipients.map((user) => sendEmail({ ...emailTemplate, to: user.username })));

      logger.info(
        { orgId: org.id, warnings: warnings.length, isExhausted, recipients: recipients.length },
        "Quota alert emails sent",
      );
    }
  } catch (error) {
    logger.error({ err: error }, "Error during quota alert check");
  }
}
