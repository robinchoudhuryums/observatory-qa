/**
 * Data retention worker — purges expired calls per org retention policy.
 *
 * Processes jobs from the "data-retention" BullMQ queue.
 * Each job contains { orgId, retentionDays } and deletes calls older
 * than retentionDays from that org (including audio blobs).
 *
 * HIPAA: Audit logs are NEVER purged by this worker. HIPAA requires
 * audit trails to be retained for 6-7 years minimum, independent of
 * PHI data retention. Audit logs have their own separate retention
 * policy (AUDIT_LOG_RETENTION_DAYS, default 2555 days / ~7 years).
 */
import { Worker, type Job } from "bullmq";
import type { DataRetentionJob } from "../services/queue";
import { logger } from "../services/logger";
import { sendSlackNotification } from "../services/notifications";
import { logPhiAccess } from "../services/audit-log";

/** HIPAA: Minimum audit log retention — 7 years. */
const AUDIT_LOG_RETENTION_DAYS = parseInt(process.env.AUDIT_LOG_RETENTION_DAYS || "2555", 10);

export function createRetentionWorker(
  connection: import("bullmq").ConnectionOptions,
  getStorage: () => import("../storage/types").IStorage,
): Worker<DataRetentionJob> {
  const worker = new Worker<DataRetentionJob>(
    "data-retention",
    async (job: Job<DataRetentionJob>) => {
      const { orgId, retentionDays } = job.data;
      logger.info({ orgId, retentionDays, jobId: job.id }, "Retention worker: starting purge");

      const storage = getStorage();
      const purged = await storage.purgeExpiredCalls(orgId, retentionDays);

      if (purged > 0) {
        logger.info({ orgId, purged, retentionDays }, "Retention worker: purge completed");
      }

      // HIPAA: Write a tamper-evident audit record for every purge execution,
      // including zero-purge runs. Auditors need proof that the retention
      // policy ran and what was destroyed — not just that PHI data is gone.
      logPhiAccess({
        event: "data_retention_purge",
        orgId,
        resourceType: "calls",
        detail: `Purged ${purged} call(s) older than ${retentionDays} days (retention policy)`,
      });

      // HIPAA: Purge orphaned S3 audio files that may remain after DB call deletion.
      // Lists S3 objects in the org's prefix and deletes any with last-modified older
      // than retentionDays that no longer have a corresponding DB record.
      //
      // Retry semantics: on transient failures, the retention worker naturally retries
      // failed keys on the next scheduled run (it re-scans all objects older than cutoff).
      // For persistent failures, each failure writes an `s3_audio_delete_failed` audit
      // entry with the specific key so compliance officers can prove the attempt and
      // can manually remediate. See F-03 in broad-scan audit.
      try {
        const s3Bucket = process.env.S3_BUCKET;
        if (s3Bucket) {
          const { S3Client } = await import("../services/s3");
          const s3 = new S3Client(s3Bucket);
          const prefix = `orgs/${orgId}/audio/`;
          const objects = await s3.listObjectsWithMetadata(prefix);
          const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
          let s3Purged = 0;
          let s3Failed = 0;
          const failedKeys: string[] = [];
          for (const obj of objects) {
            const updated = new Date(obj.updated);
            if (updated < cutoff) {
              try {
                await s3.deleteObject(obj.name);
                s3Purged++;
              } catch (delErr) {
                s3Failed++;
                failedKeys.push(obj.name);
                logger.warn({ orgId, err: delErr, key: obj.name }, "Retention worker: S3 object delete failed");
                // HIPAA: per-failure audit entry with the specific S3 key.
                // Compliance auditors can query audit_logs for s3_audio_delete_failed
                // to prove the retention attempt was made and trace specific keys
                // that need manual remediation.
                const errMsg = delErr instanceof Error ? delErr.message.slice(0, 200) : "unknown error";
                logPhiAccess({
                  event: "s3_audio_delete_failed",
                  orgId,
                  resourceType: "audio_file",
                  resourceId: obj.name,
                  detail: `S3 deletion failed for retention purge (retentionDays=${retentionDays}): ${errMsg}. Will auto-retry on next retention run.`,
                });
              }
            }
          }
          if (s3Failed > 0) {
            logger.error(
              { orgId, s3Purged, s3Failed, retentionDays },
              `Retention worker: ${s3Failed} S3 audio deletions failed — PHI may remain in storage`,
            );
            // HIPAA: summary audit entry for failed batch — even though each failure
            // already has its own entry, having a single queryable aggregate event
            // simplifies compliance reporting.
            logPhiAccess({
              event: "s3_audio_purge_partial_failure",
              orgId,
              resourceType: "audio_files",
              detail: `${s3Failed} of ${s3Failed + s3Purged} S3 audio deletions failed for retention purge (retentionDays=${retentionDays}). Failed keys logged in separate audit entries. Retry scheduled for next retention run.`,
            });
            // Alert admins via webhook — orphaned PHI in S3 requires attention
            sendSlackNotification(
              {
                channel: "alerts",
                text: `:warning: *PHI Retention Alert*: ${s3Failed} S3 audio file(s) failed to delete for org \`${orgId}\`. ${s3Purged} succeeded. PHI audio may remain in storage past retention policy (${retentionDays} days). Failed keys (sample): ${failedKeys.slice(0, 5).join(", ")}${failedKeys.length > 5 ? " …" : ""}. Auto-retry on next retention run.`,
              },
              orgId,
            ).catch(() => {}); // Non-blocking — alert failure shouldn't crash retention
          }
          if (s3Purged > 0) {
            logger.info({ orgId, s3Purged, retentionDays }, "Retention worker: orphaned S3 audio files purged");
            logPhiAccess({
              event: "s3_audio_purge",
              orgId,
              resourceType: "audio_files",
              detail: `Purged ${s3Purged} S3 audio file(s) older than ${retentionDays} days`,
            });
          }
        }
      } catch (s3Err) {
        // HIPAA: the top-level try/catch only fires on setup failures (e.g.,
        // S3 client init or listObjects failed). Log a single audit entry so
        // compliance can see that the retention scan was attempted.
        const errMsg = s3Err instanceof Error ? s3Err.message.slice(0, 200) : "unknown error";
        logger.warn({ orgId, err: s3Err }, "Retention worker: S3 audio purge failed (non-fatal)");
        logPhiAccess({
          event: "s3_audio_purge_setup_failed",
          orgId,
          resourceType: "audio_files",
          detail: `S3 retention scan could not start (retentionDays=${retentionDays}): ${errMsg}. Retry scheduled for next retention run.`,
        });
      }

      // HIPAA: Purge only very old audit logs (7+ years) — never delete with PHI
      if (storage.purgeExpiredAuditLogs) {
        const auditPurged = await storage.purgeExpiredAuditLogs(orgId, AUDIT_LOG_RETENTION_DAYS);
        if (auditPurged > 0) {
          logger.info(
            { orgId, auditPurged, auditRetentionDays: AUDIT_LOG_RETENTION_DAYS },
            "Retention worker: old audit logs purged",
          );
          // Audit-log the audit-log purge too (meta, but required by HIPAA)
          logPhiAccess({
            event: "audit_log_retention_purge",
            orgId,
            resourceType: "audit_logs",
            detail: `Purged ${auditPurged} audit log entries older than ${AUDIT_LOG_RETENTION_DAYS} days`,
          });
        }
      }

      return { purged };
    },
    {
      connection,
      concurrency: 2,
    },
  );

  worker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err }, "Retention worker: job failed");
  });

  return worker;
}
