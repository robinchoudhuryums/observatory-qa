/**
 * Scheduled task: Weekly digest.
 * Sends coaching/performance digest to org webhook.
 */
import type { IStorage } from "../storage/types";
import { logger } from "../services/logger";

export async function runWeeklyDigest(storage: IStorage, orgs?: any[]): Promise<void> {
  try {
    const webhookUrl = process.env.WEBHOOK_DIGEST_URL;
    if (!webhookUrl) return;

    const { generateWeeklyDigest } = await import("../services/proactive-alerts");
    const { sendSlackNotification } = await import("../services/notifications");
    if (!orgs) orgs = await storage.listOrganizations();

    for (const org of orgs) {
      try {
        const digest = await generateWeeklyDigest(org.id);
        if (digest.totalCalls === 0) continue;

        const text = [
          `*Weekly Digest: ${org.name}*`,
          `Calls: ${digest.totalCalls} | Avg Score: ${digest.avgScore} | Flagged: ${digest.flaggedCalls}`,
          `Sentiment: +${digest.sentiment.positive} / ~${digest.sentiment.neutral} / -${digest.sentiment.negative}`,
          digest.agentsNeedingAttention.length > 0
            ? `Agents needing attention: ${digest.agentsNeedingAttention.map((a) => a.name).join(", ")}`
            : "No agents flagged for review",
        ].join("\n");

        await sendSlackNotification({ channel: "digest", text, blocks: [] });
        logger.info({ orgId: org.id, totalCalls: digest.totalCalls }, "Weekly digest sent");
      } catch (orgErr) {
        logger.warn({ err: orgErr, orgId: org.id }, "Failed to send weekly digest for org");
      }
    }
  } catch (error) {
    logger.error({ err: error }, "Error during weekly digest generation");
  }
}
