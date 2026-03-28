/**
 * HIPAA PHI Access Audit Logger — Tamper-Evident Hash Chain
 *
 * Dual-write: structured Pino logs AND PostgreSQL audit_logs table.
 * Pino log output goes to stdout/Betterstack for real-time monitoring.
 * Database storage enables in-app audit viewer with search/pagination.
 *
 * TAMPER EVIDENCE: Each audit entry includes a SHA-256 hash computed from
 * the entry data + the previous entry's hash, forming a chain. If any row
 * is modified, deleted, or inserted out of order, the chain breaks and
 * verification detects the tampering.
 *
 * HIPAA: Never include PHI (call content, transcripts) in audit entries.
 * Only log metadata: event types, user IDs, resource IDs, timestamps.
 */
import { randomUUID, createHash } from "crypto";
import { logger } from "./logger";
import { redactPhi } from "../utils/phi-redactor";
import { validateUrl } from "../utils/url-validation";

export interface AuditEntry {
  timestamp?: string;
  event: string;
  orgId?: string;
  userId?: string;
  username?: string;
  role?: string;
  resourceType: string;
  resourceId?: string;
  ip?: string;
  userAgent?: string;
  detail?: string;
}

// Per-org chain state (in-memory cache; re-seeded from DB on first write)
const MAX_CHAIN_STATE_ENTRIES = 10_000;
const chainState = new Map<string, { prevHash: string; sequenceNum: number }>();

/**
 * Compute SHA-256 integrity hash for an audit entry in the chain.
 */
function computeIntegrityHash(
  prevHash: string,
  entry: { orgId: string; event: string; userId?: string; username?: string; resourceType: string; resourceId?: string; detail?: string; timestamp: string; sequenceNum: number }
): string {
  const payload = JSON.stringify({
    prevHash,
    orgId: entry.orgId,
    event: entry.event,
    userId: entry.userId || "",
    username: entry.username || "",
    resourceType: entry.resourceType,
    resourceId: entry.resourceId || "",
    detail: entry.detail || "",
    timestamp: entry.timestamp,
    sequenceNum: entry.sequenceNum,
  });
  return createHash("sha256").update(payload).digest("hex");
}

/**
 * Get or initialize the chain state for an org.
 * On first call, queries the DB for the latest entry to seed the chain.
 */
async function getChainState(orgId: string): Promise<{ prevHash: string; sequenceNum: number }> {
  if (chainState.has(orgId)) return chainState.get(orgId)!;

  // Seed from DB
  try {
    const { getDatabase } = await import("../db/index");
    const db = getDatabase();
    if (db) {
      const { auditLogs } = await import("../db/schema");
      const { eq, desc, isNotNull, and } = await import("drizzle-orm");
      const [latest] = await db.select({
        integrityHash: auditLogs.integrityHash,
        sequenceNum: auditLogs.sequenceNum,
      }).from(auditLogs)
        .where(and(eq(auditLogs.orgId, orgId), isNotNull(auditLogs.sequenceNum)))
        .orderBy(desc(auditLogs.sequenceNum))
        .limit(1);

      if (latest?.integrityHash && latest?.sequenceNum != null) {
        const state = { prevHash: latest.integrityHash, sequenceNum: latest.sequenceNum };
        chainState.set(orgId, state);
        return state;
      }
    }
  } catch (err) {
    logger.debug({ err, orgId }, "Database unavailable for audit chain state, starting fresh chain");
  }

  const state = { prevHash: "genesis", sequenceNum: 0 };
  chainState.set(orgId, state);
  return state;
}

// ── Anomaly detection ──────────────────────────────────────────────────────

/** In-memory tracker for failed login attempts per IP. Auto-cleaned every 15 min. */
const failedLoginsByIp = new Map<string, { count: number; windowStart: number }>();
const FAILED_LOGIN_WINDOW_MS = 15 * 60 * 1000;
const FAILED_LOGIN_THRESHOLD = 10;

// Clean up stale entries every 15 minutes
setInterval(() => {
  const cutoff = Date.now() - FAILED_LOGIN_WINDOW_MS;
  for (const [key, val] of Array.from(failedLoginsByIp.entries())) {
    if (val.windowStart < cutoff) failedLoginsByIp.delete(key);
  }
}, FAILED_LOGIN_WINDOW_MS).unref();

/**
 * Detect anomalous audit events and emit structured security alerts.
 * Called synchronously inside logPhiAccess — must be fast (no DB I/O).
 */
function detectAnomalies(entry: AuditEntry & { timestamp: string }): void {
  // 1. Brute-force: 10+ failed logins in 15 min from same IP
  if (entry.event === "login_failed") {
    const key = entry.ip || "unknown";
    const now = Date.now();
    const tracker = failedLoginsByIp.get(key) || { count: 0, windowStart: now };
    if (now - tracker.windowStart > FAILED_LOGIN_WINDOW_MS) {
      tracker.count = 1;
      tracker.windowStart = now;
    } else {
      tracker.count++;
    }
    failedLoginsByIp.set(key, tracker);

    if (tracker.count >= FAILED_LOGIN_THRESHOLD) {
      logger.warn(
        { ip: entry.ip, failedCount: tracker.count, orgId: entry.orgId, _securityAlert: "brute_force" },
        "[SECURITY_ALERT] Excessive failed login attempts — possible brute force",
      );
    }
  }

  // 2. Bulk data export
  if (entry.event === "audit_log_export" || entry.event === "call_export") {
    logger.warn(
      { username: entry.username, orgId: entry.orgId, ip: entry.ip, _securityAlert: "bulk_export" },
      "[SECURITY_ALERT] Bulk data export detected",
    );
  }

  // 3. PHI access outside business hours (06:00–22:00 UTC)
  const isPhiEvent = entry.event.includes("phi") || entry.event.includes("clinical")
    || entry.resourceType === "transcript" || entry.resourceType === "analysis";
  if (isPhiEvent) {
    const utcHour = new Date(entry.timestamp).getUTCHours();
    if (utcHour < 6 || utcHour >= 22) {
      logger.warn(
        { username: entry.username, utcHour, orgId: entry.orgId, resourceType: entry.resourceType, _securityAlert: "off_hours_phi" },
        "[SECURITY_ALERT] PHI access outside business hours (UTC)",
      );
    }
  }
}

// ── SIEM forwarding ────────────────────────────────────────────────────────

/** Cache of per-org SIEM URLs to avoid DB lookup on every log entry. TTL: 5 min. */
const siemUrlCache = new Map<string, { url: string | null; cachedAt: number }>();
const SIEM_CACHE_TTL_MS = 5 * 60 * 1000;

/** Look up the org's SIEM webhook URL (cached). Returns null if not configured. */
async function getSiemUrl(orgId: string): Promise<string | null> {
  const cached = siemUrlCache.get(orgId);
  if (cached && Date.now() - cached.cachedAt < SIEM_CACHE_TTL_MS) return cached.url;

  try {
    const { getDatabase } = await import("../db/index");
    const db = getDatabase();
    if (!db) return null;
    const { organizations } = await import("../db/schema");
    const { eq } = await import("drizzle-orm");
    const [org] = await db.select({ settings: organizations.settings })
      .from(organizations).where(eq(organizations.id, orgId)).limit(1);
    const url = (org?.settings as any)?.siemWebhookUrl || null;
    siemUrlCache.set(orgId, { url, cachedAt: Date.now() });
    return url;
  } catch {
    return null;
  }
}

/** Forward a single audit entry to the org's SIEM webhook endpoint. Fire-and-forget. */
async function forwardToSiem(entry: AuditEntry & { timestamp: string }, siemUrl: string): Promise<void> {
  // SSRF validation — reject private/internal network URLs
  const ssrfCheck = validateUrl(siemUrl);
  if (!ssrfCheck.valid) {
    logger.warn({ orgId: entry.orgId, reason: ssrfCheck.reason }, "SSRF: skipping SIEM webhook forward to blocked URL");
    return;
  }

  try {
    const payload = {
      source: "observatory-qa",
      version: "1",
      timestamp: entry.timestamp,
      orgId: entry.orgId,
      event: entry.event,
      userId: entry.userId,
      username: entry.username,
      role: entry.role,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
      ip: entry.ip,
      detail: entry.detail,
    };
    const resp = await fetch(siemUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Source": "observatory-qa-audit" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) {
      logger.debug({ status: resp.status, orgId: entry.orgId }, "SIEM webhook returned non-2xx");
    }
  } catch (err) {
    logger.debug({ err, orgId: entry.orgId }, "SIEM forward failed (non-blocking)");
  }
}

/**
 * Log a PHI access event. Writes to both Pino (stdout) and PostgreSQL.
 * DB write is non-blocking — failures are logged but never throw.
 */
export function logPhiAccess(entry: AuditEntry): void {
  const timestamp = entry.timestamp || new Date().toISOString();
  const fullEntry = {
    ...entry,
    timestamp,
    detail: entry.detail ? redactPhi(entry.detail) : entry.detail,
  };

  // Always write to Pino (structured log)
  logger.info({
    ...entry,
    timestamp,
    _audit: "HIPAA_PHI",
  }, `[HIPAA_AUDIT] ${entry.event}`);

  // Anomaly detection (synchronous, no I/O)
  detectAnomalies(fullEntry);

  // Non-blocking DB write with tamper-evident hash chain
  persistAuditEntry(fullEntry).catch(() => {
    // Silently swallow — Pino log is the primary audit trail
  });

  // Non-blocking SIEM forwarding (if configured for org)
  if (entry.orgId) {
    getSiemUrl(entry.orgId).then(siemUrl => {
      if (siemUrl) forwardToSiem(fullEntry, siemUrl);
    }).catch(() => {});
  }
}

/**
 * Persist an audit entry to the audit_logs table with hash chain integrity.
 * Called fire-and-forget from logPhiAccess().
 */
async function persistAuditEntry(entry: AuditEntry & { timestamp: string }): Promise<void> {
  try {
    const { getDatabase } = await import("../db/index");
    const db = getDatabase();
    if (!db) return;

    const orgId = entry.orgId || "system";
    const state = await getChainState(orgId);
    const nextSeq = state.sequenceNum + 1;

    const integrityHash = computeIntegrityHash(state.prevHash, {
      orgId,
      event: entry.event,
      userId: entry.userId,
      username: entry.username,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
      detail: entry.detail,
      timestamp: entry.timestamp,
      sequenceNum: nextSeq,
    });

    const { auditLogs } = await import("../db/schema");
    await db.insert(auditLogs).values({
      id: randomUUID(),
      orgId,
      event: entry.event,
      userId: entry.userId,
      username: entry.username,
      role: entry.role,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
      ip: entry.ip,
      userAgent: entry.userAgent,
      detail: entry.detail,
      integrityHash,
      prevHash: state.prevHash,
      sequenceNum: nextSeq,
    });

    // Update chain state (evict oldest if at capacity)
    if (chainState.size >= MAX_CHAIN_STATE_ENTRIES && !chainState.has(orgId)) {
      const oldest = chainState.keys().next().value;
      if (oldest) chainState.delete(oldest);
    }
    chainState.set(orgId, { prevHash: integrityHash, sequenceNum: nextSeq });
  } catch (err) {
    logger.warn({ err, orgId: entry.orgId }, "Failed to persist audit log entry to database");
  }
}

/**
 * Verify the integrity of the audit log chain for an organization.
 * Returns { valid: boolean, checkedCount: number, brokenAt?: number }.
 */
export async function verifyAuditChain(orgId: string): Promise<{ valid: boolean; checkedCount: number; brokenAt?: number }> {
  const { getDatabase } = await import("../db/index");
  const db = getDatabase();
  if (!db) return { valid: true, checkedCount: 0 };

  const { auditLogs } = await import("../db/schema");
  const { eq, asc, isNotNull, and } = await import("drizzle-orm");

  const rows = await db.select().from(auditLogs)
    .where(and(eq(auditLogs.orgId, orgId), isNotNull(auditLogs.sequenceNum)))
    .orderBy(asc(auditLogs.sequenceNum));

  let prevHash = "genesis";
  for (const row of rows) {
    if (row.prevHash !== prevHash) {
      return { valid: false, checkedCount: rows.length, brokenAt: row.sequenceNum ?? undefined };
    }

    const expected = computeIntegrityHash(prevHash, {
      orgId: row.orgId,
      event: row.event,
      userId: row.userId ?? undefined,
      username: row.username ?? undefined,
      resourceType: row.resourceType,
      resourceId: row.resourceId ?? undefined,
      detail: row.detail ?? undefined,
      timestamp: row.createdAt?.toISOString() || "",
      sequenceNum: row.sequenceNum!,
    });

    if (row.integrityHash !== expected) {
      return { valid: false, checkedCount: rows.length, brokenAt: row.sequenceNum ?? undefined };
    }

    prevHash = row.integrityHash!;
  }

  return { valid: true, checkedCount: rows.length };
}

/**
 * Query audit logs from the database (for the audit viewer UI).
 */
export async function queryAuditLogs(options: {
  orgId: string;
  event?: string;
  userId?: string;
  username?: string;
  resourceType?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
}): Promise<{ entries: AuditEntry[]; total: number }> {
  const { getDatabase } = await import("../db/index");
  const db = getDatabase();
  if (!db) return { entries: [], total: 0 };

  const { auditLogs } = await import("../db/schema");
  const { eq, and, desc, gte, lte, count, ilike } = await import("drizzle-orm");

  const conditions = [eq(auditLogs.orgId, options.orgId)];
  if (options.event) conditions.push(eq(auditLogs.event, options.event));
  if (options.userId) conditions.push(eq(auditLogs.userId, options.userId));
  if (options.username) conditions.push(ilike(auditLogs.username, `%${options.username}%`));
  if (options.resourceType) conditions.push(eq(auditLogs.resourceType, options.resourceType));
  if (options.from) conditions.push(gte(auditLogs.createdAt, options.from));
  if (options.to) conditions.push(lte(auditLogs.createdAt, options.to));

  const where = and(...conditions);
  const pageLimit = Math.min(options.limit || 50, 200);
  const pageOffset = options.offset || 0;

  const [rows, countResult] = await Promise.all([
    db.select().from(auditLogs)
      .where(where)
      .orderBy(desc(auditLogs.createdAt))
      .limit(pageLimit)
      .offset(pageOffset),
    db.select({ count: count() }).from(auditLogs).where(where),
  ]);

  const entries: AuditEntry[] = rows.map(r => ({
    event: r.event,
    orgId: r.orgId,
    userId: r.userId || undefined,
    username: r.username || undefined,
    role: r.role || undefined,
    resourceType: r.resourceType,
    resourceId: r.resourceId || undefined,
    ip: r.ip || undefined,
    userAgent: r.userAgent || undefined,
    detail: r.detail || undefined,
    timestamp: r.createdAt?.toISOString(),
  }));

  return { entries, total: countResult[0]?.count || 0 };
}

/**
 * Export audit logs for a date range (HIPAA auditor export).
 * No pagination cap — returns up to maxRows rows (default 50,000).
 * Used by GET /api/admin/audit-logs/export.
 */
export async function exportAuditLogs(options: {
  orgId: string;
  event?: string;
  username?: string;
  userId?: string;
  resourceType?: string;
  from?: Date;
  to?: Date;
  maxRows?: number;
}): Promise<AuditEntry[]> {
  const { getDatabase } = await import("../db/index");
  const db = getDatabase();
  if (!db) return [];

  const { auditLogs } = await import("../db/schema");
  const { eq, and, asc, gte, lte, ilike } = await import("drizzle-orm");

  const conditions = [eq(auditLogs.orgId, options.orgId)];
  if (options.event) conditions.push(eq(auditLogs.event, options.event));
  if (options.userId) conditions.push(eq(auditLogs.userId, options.userId));
  if (options.username) conditions.push(ilike(auditLogs.username, `%${options.username}%`));
  if (options.resourceType) conditions.push(eq(auditLogs.resourceType, options.resourceType));
  if (options.from) conditions.push(gte(auditLogs.createdAt, options.from));
  if (options.to) conditions.push(lte(auditLogs.createdAt, options.to));

  const cap = Math.min(options.maxRows ?? 50_000, 50_000);

  const rows = await db.select().from(auditLogs)
    .where(and(...conditions))
    .orderBy(asc(auditLogs.createdAt))
    .limit(cap);

  return rows.map(r => ({
    event: r.event,
    orgId: r.orgId,
    userId: r.userId || undefined,
    username: r.username || undefined,
    role: r.role || undefined,
    resourceType: r.resourceType,
    resourceId: r.resourceId || undefined,
    ip: r.ip || undefined,
    userAgent: r.userAgent || undefined,
    detail: r.detail || undefined,
    timestamp: r.createdAt?.toISOString(),
  }));
}

/**
 * Helper to extract audit-relevant fields from an Express request.
 */
export function auditContext(req: any): Pick<AuditEntry, "orgId" | "userId" | "username" | "role" | "ip" | "userAgent"> {
  const user = req.user as { id?: string; username?: string; role?: string; orgId?: string } | undefined;
  return {
    orgId: user?.orgId || req.orgId,
    userId: user?.id,
    username: user?.username,
    role: user?.role,
    ip: (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket?.remoteAddress,
    userAgent: req.headers["user-agent"],
  };
}
