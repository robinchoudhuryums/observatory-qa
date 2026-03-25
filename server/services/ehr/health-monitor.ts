/**
 * EHR Connection Health Monitor
 *
 * Periodically checks the health of each org's EHR connection and sends
 * alerting notifications when a connection goes down or recovers.
 *
 * Health status is stored in the org's settings JSONB under `ehrHealthStatus`.
 * This allows the UI to surface stale/broken connections without making a
 * live request on every page load.
 *
 * Alert logic:
 *   - First failure:  alert sent immediately, `downSince` recorded
 *   - Subsequent failures: no repeated alerts (deduped via `downSince`)
 *   - Recovery:       alert sent once when connection is restored
 *
 * Scheduling: Called from the worker process every 15 minutes via setInterval.
 * The main server does NOT run health checks — they only run in the worker process.
 */

import { getEhrAdapter } from "./index.js";
import { decryptField } from "../phi-encryption.js";
import { resolveEhrCredentials } from "./secrets-manager.js";
import { sendSlackNotification } from "../notifications.js";
import { storage } from "../../storage/index.js";
import { logger } from "../logger.js";
import type { EhrConnectionConfig, EhrHealthStatus } from "./types.js";

/** How often to run health checks (ms) */
export const EHR_HEALTH_CHECK_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

/** Number of consecutive failures before the first alert is sent */
const ALERT_AFTER_FAILURES = 1;

/**
 * Check the EHR health for a single org.
 * Updates org settings with the new health status and sends alerts on transitions.
 */
export async function checkOrgEhrHealth(orgId: string): Promise<EhrHealthStatus | null> {
  let org: Awaited<ReturnType<typeof storage.getOrganization>>;
  try {
    org = await storage.getOrganization(orgId);
  } catch (err) {
    logger.warn({ err, orgId }, "EHR health check: could not load org");
    return null;
  }

  if (!org) return null;

  const settings = org.settings as any;
  const ehrConfig: (EhrConnectionConfig & { secretArn?: string }) | undefined = settings?.ehrConfig;

  if (!ehrConfig?.enabled || !ehrConfig?.system || ehrConfig.system === "mock") {
    return null; // Nothing to check
  }

  const adapter = getEhrAdapter(ehrConfig.system);
  if (!adapter) return null;

  const prevStatus: EhrHealthStatus | undefined = settings?.ehrHealthStatus;

  // Resolve credentials (Secrets Manager or decrypted PHI key)
  let resolvedConfig: EhrConnectionConfig;
  try {
    const decryptedKey = ehrConfig.apiKey ? decryptField(ehrConfig.apiKey) : undefined;
    resolvedConfig = await resolveEhrCredentials(ehrConfig, decryptedKey);
  } catch (err) {
    logger.warn({ err, orgId }, "EHR health check: could not resolve credentials");
    return null;
  }

  // Run the connection test
  let connected = false;
  let errorMessage: string | undefined;

  try {
    const result = await adapter.testConnection(resolvedConfig);
    connected = result.connected;
    errorMessage = result.error;
  } catch (err) {
    connected = false;
    errorMessage = err instanceof Error ? err.message : "Health check threw an exception";
  }

  const now = new Date().toISOString();
  const consecutiveFailures = connected
    ? 0
    : (prevStatus?.consecutiveFailures || 0) + 1;

  const newStatus: EhrHealthStatus = {
    orgId,
    system: ehrConfig.system,
    connected,
    lastChecked: now,
    lastError: connected ? undefined : errorMessage,
    consecutiveFailures,
    downSince: connected ? undefined : (prevStatus?.downSince || now),
    lastSuccessAt: connected ? now : prevStatus?.lastSuccessAt,
  };

  // Persist health status to org settings
  try {
    await storage.updateOrganization(orgId, {
      settings: { ...settings, ehrHealthStatus: newStatus } as any,
    });
  } catch (err) {
    logger.warn({ err, orgId }, "EHR health check: could not persist health status");
  }

  // --- Alerting ---

  const wasHealthy = prevStatus?.connected !== false; // undefined = first check, treat as healthy
  const isFirstFailure = !connected && wasHealthy;
  const isRecovery = connected && prevStatus?.connected === false;

  if (isFirstFailure && consecutiveFailures >= ALERT_AFTER_FAILURES) {
    await sendEhrAlert(org, "down", errorMessage);
  } else if (isRecovery) {
    const downSince = prevStatus?.downSince;
    await sendEhrAlert(org, "recovered", undefined, downSince);
  }

  logger.info({
    orgId,
    system: ehrConfig.system,
    connected,
    consecutiveFailures,
  }, "EHR health check completed");

  return newStatus;
}

/**
 * Run health checks for ALL orgs that have EHR integrations configured.
 * Called periodically by the worker process.
 */
export async function runEhrHealthChecks(): Promise<void> {
  let orgs: Awaited<ReturnType<typeof storage.listOrganizations>>;

  try {
    orgs = "listOrganizations" in storage
      ? await (storage as any).listOrganizations()
      : [];
  } catch (err) {
    logger.warn({ err }, "EHR health checks: could not list organizations");
    return;
  }

  if (!orgs?.length) return;

  // Filter to orgs with enabled EHR integrations (skip mock)
  const ehrOrgs = orgs.filter((org: any) => {
    const ehrConfig = org.settings?.ehrConfig;
    return ehrConfig?.enabled && ehrConfig?.system && ehrConfig.system !== "mock";
  });

  if (!ehrOrgs.length) return;

  logger.info({ count: ehrOrgs.length }, "Running EHR health checks");

  // Check sequentially to avoid hammering multiple EHRs at once
  for (const org of ehrOrgs) {
    try {
      await checkOrgEhrHealth(org.id);
    } catch (err) {
      logger.warn({ err, orgId: org.id }, "EHR health check failed for org");
    }
    // Small delay between checks to spread load
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
}

/**
 * Start the periodic EHR health check scheduler.
 * Returns the interval handle (call clearInterval to stop).
 */
export function startEhrHealthMonitor(): ReturnType<typeof setInterval> {
  logger.info({ intervalMs: EHR_HEALTH_CHECK_INTERVAL_MS }, "EHR health monitor started");

  // Run once at startup (after a short delay)
  setTimeout(() => runEhrHealthChecks().catch(err => {
    logger.warn({ err }, "Initial EHR health check failed");
  }), 30_000); // 30s delay at startup

  return setInterval(() => {
    runEhrHealthChecks().catch(err => {
      logger.warn({ err }, "Periodic EHR health check failed");
    });
  }, EHR_HEALTH_CHECK_INTERVAL_MS);
}

// --- Alert helpers ---

async function sendEhrAlert(
  org: { id: string; name?: string; slug?: string; settings?: any },
  event: "down" | "recovered",
  errorMessage?: string,
  downSince?: string,
): Promise<void> {
  const orgName = org.name || org.slug || org.id;
  const system = (org.settings as any)?.ehrConfig?.system || "EHR";

  const isDown = event === "down";
  const emoji = isDown ? ":red_circle:" : ":large_green_circle:";
  const title = isDown
    ? `${emoji} EHR Connection Down — ${orgName}`
    : `${emoji} EHR Connection Restored — ${orgName}`;

  const fields = [
    { type: "mrkdwn" as const, text: `*System:*\n${system}` },
    { type: "mrkdwn" as const, text: `*Org:*\n${orgName}` },
  ];

  if (isDown && errorMessage) {
    fields.push({ type: "mrkdwn" as const, text: `*Error:*\n${errorMessage.slice(0, 200)}` });
  }

  if (!isDown && downSince) {
    const downMinutes = Math.round((Date.now() - new Date(downSince).getTime()) / 60000);
    fields.push({ type: "mrkdwn" as const, text: `*Down for:*\n${downMinutes} minutes` });
  }

  try {
    await sendSlackNotification({
      text: title,
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: title, emoji: true },
        },
        {
          type: "section",
          fields,
        },
      ],
    }, org.id);
  } catch (err) {
    logger.warn({ err, orgId: org.id }, "Failed to send EHR health alert");
  }
}
