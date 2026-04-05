/**
 * Scheduled task: Nightly audit chain integrity verification.
 * Verifies the hash chain of HIPAA audit logs for each org.
 */
import type { IStorage } from "../storage/types";
import { logger } from "../services/logger";

export async function runAuditChainVerify(storage: IStorage, orgs?: any[]): Promise<void> {
  try {
    const { verifyAuditChain, logPhiAccess: logAuditAlert } = await import("../services/audit-log");
    if (!orgs) orgs = await storage.listOrganizations();
    let brokenCount = 0;

    for (const org of orgs) {
      try {
        const result = await verifyAuditChain(org.id);
        if (!result.valid) {
          brokenCount++;
          logger.error(
            { orgId: org.id, brokenAt: result.brokenAt, checkedCount: result.checkedCount },
            "[HIPAA_ALERT] Audit chain integrity BROKEN — possible tampering detected",
          );
          // Log a security alert into the audit trail itself
          logAuditAlert({
            event: "audit_chain_tamper_detected",
            orgId: org.id,
            resourceType: "audit_logs",
            ip: "localhost",
            userAgent: "audit-chain-verifier",
            role: "system",
            detail: `Chain broken at sequence ${result.brokenAt} of ${result.checkedCount} entries`,
          });
        } else if (result.checkedCount > 0) {
          logger.info(
            { orgId: org.id, checkedCount: result.checkedCount },
            "Nightly audit chain verification: OK",
          );
        }
      } catch (orgErr) {
        logger.warn({ err: orgErr, orgId: org.id }, "Audit chain verify failed for org");
      }
    }

    if (brokenCount > 0) {
      logger.error({ brokenCount }, `[HIPAA_ALERT] ${brokenCount} org(s) have broken audit chains`);
    }
  } catch (error) {
    logger.error({ err: error }, "Nightly audit chain verification failed");
  }
}
