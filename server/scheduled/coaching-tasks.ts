/**
 * Scheduled task: Coaching automation rules, effectiveness caching, follow-up reminders.
 */
import type { IStorage } from "../storage/types";
import { logger } from "../services/logger";

export async function runCoachingScheduledTasks(storage: IStorage, orgs?: any[]): Promise<void> {
  try {
    const { runAutomationRules, sweepEffectivenessSnapshots, getDueSoonSessions, getOverdueSessions } =
      await import("../services/coaching-engine");
    const { sendEmail } = await import("../services/email");
    if (!orgs) orgs = await storage.listOrganizations();
    for (const org of orgs) {
      if (org.status !== "active") continue;
      try {
        // Run automation rules daily
        const { triggered, sessionsCreated } = await runAutomationRules(org.id);
        if (sessionsCreated > 0)
          logger.info({ orgId: org.id, triggered, sessionsCreated }, "Automation rules created coaching sessions");

        // Cache effectiveness for completed sessions 30+ days old
        await sweepEffectivenessSnapshots(org.id);

        // Follow-up reminders: email managers about sessions due in 24h
        const dueSoon = await getDueSoonSessions(org.id, 24);
        if (dueSoon.length > 0) {
          // Group by assignedBy (manager)
          const byManager = new Map<string, typeof dueSoon>();
          for (const item of dueSoon) {
            const mgr = item.session.assignedBy;
            if (!byManager.has(mgr)) byManager.set(mgr, []);
            byManager.get(mgr)!.push(item);
          }
          for (const [manager, items] of Array.from(byManager)) {
            const list = items
              .map((i) => `• ${i.session.title} (${i.employeeName}, due in ${i.hoursUntilDue}h)`)
              .join("\n");
            // Email if manager name looks like an email; otherwise log for webhook delivery
            if (manager.includes("@")) {
              await sendEmail({
                to: manager,
                subject: `Coaching follow-up reminder — ${items.length} session(s) due soon`,
                text: `Hi,\n\nThe following coaching sessions are due within 24 hours:\n\n${list}\n\nPlease follow up with your team.`,
                html: `<p>The following coaching sessions are due within 24 hours:</p><ul>${items.map((i) => `<li>${i.session.title} — ${i.employeeName} (${i.hoursUntilDue}h)</li>`).join("")}</ul>`,
              }).catch(() => {});
            }
          }
        }

        // Log overdue count (webhook/Slack alert handled by existing notifications)
        const overdue = await getOverdueSessions(org.id);
        if (overdue.length > 0) {
          logger.warn({ orgId: org.id, count: overdue.length }, "Overdue coaching sessions");
        }
      } catch (err) {
        logger.warn({ err, orgId: org.id }, "Coaching scheduled tasks failed for org");
      }
    }
  } catch (err) {
    logger.error({ err }, "Coaching scheduled tasks runner failed");
  }
}
