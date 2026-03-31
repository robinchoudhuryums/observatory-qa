/**
 * Incident Response & Breach Reporting Service
 *
 * HIPAA §164.408 requires covered entities to notify affected individuals
 * of breaches of unsecured PHI within 60 days. This service provides:
 *
 * - Incident declaration with severity classification
 * - Phase tracking (detection → containment → eradication → recovery → post-incident)
 * - Timeline logging for each incident
 * - Breach notification status tracking
 * - Action item management
 *
 * Storage: PostgreSQL when available (via security_incidents and breach_reports tables),
 * with in-memory fallback for development without a database.
 *
 * Multi-tenant: All incidents are org-scoped.
 */
import { randomUUID } from "crypto";
import { logger } from "./logger";
import { logPhiAccess } from "./audit-log";

// --- DB helpers (lazy import to avoid circular deps) ---
async function getDb() {
  try {
    const { getDatabase } = await import("../db/index");
    return getDatabase();
  } catch {
    return null;
  }
}

async function getDbTables() {
  try {
    return await import("../db/schema");
  } catch {
    return null;
  }
}

// --- Types ---

export type IncidentSeverity = "critical" | "high" | "medium" | "low";
export type IncidentPhase = "detection" | "containment" | "eradication" | "recovery" | "post_incident" | "closed";
export type BreachNotificationStatus =
  | "not_required"
  | "pending"
  | "individuals_notified"
  | "hhs_notified"
  | "complete";

export interface TimelineEntry {
  id: string;
  timestamp: string;
  description: string;
  addedBy: string;
}

export interface ActionItem {
  id: string;
  description: string;
  assignedTo?: string;
  status: "open" | "in_progress" | "completed";
  dueDate?: string;
  completedAt?: string;
}

export interface SecurityIncident {
  id: string;
  orgId: string;
  title: string;
  description: string;
  severity: IncidentSeverity;
  phase: IncidentPhase;
  declaredAt: string;
  declaredBy: string;
  closedAt?: string;
  affectedSystems: string[];
  estimatedAffectedRecords: number;
  phiInvolved: boolean;
  timeline: TimelineEntry[];
  actionItems: ActionItem[];
  breachNotification: BreachNotificationStatus;
  breachNotificationDeadline?: string; // 60 days from detection per HIPAA
  containedAt?: string;
  eradicatedAt?: string;
  recoveredAt?: string;
  rootCause?: string;
  lessonsLearned?: string;
}

export interface BreachReport {
  id: string;
  orgId: string;
  incidentId?: string;
  title: string;
  description: string;
  discoveredAt: string;
  reportedBy: string;
  affectedIndividuals: number;
  phiTypes: string[]; // e.g., ["names", "medical_records", "ssn"]
  notificationStatus: BreachNotificationStatus;
  notificationDeadline: string;
  individualsNotifiedAt?: string;
  hhsNotifiedAt?: string;
  mediaNotifiedAt?: string; // Required if >500 individuals affected
  correctiveActions: string[];
  createdAt: string;
  updatedAt: string;
}

// --- In-memory storage (org-scoped) ---
const incidents = new Map<string, SecurityIncident>(); // id → incident
const breachReports = new Map<string, BreachReport>(); // id → report

// --- Incident management ---

export function declareIncident(
  orgId: string,
  data: {
    title: string;
    description: string;
    severity: IncidentSeverity;
    declaredBy: string;
    affectedSystems?: string[];
    estimatedAffectedRecords?: number;
    phiInvolved?: boolean;
  },
): SecurityIncident {
  const id = randomUUID();
  const now = new Date().toISOString();

  // HIPAA: 60-day notification deadline from discovery
  const deadline = new Date();
  deadline.setDate(deadline.getDate() + 60);

  const incident: SecurityIncident = {
    id,
    orgId,
    title: data.title,
    description: data.description,
    severity: data.severity,
    phase: "detection",
    declaredAt: now,
    declaredBy: data.declaredBy,
    affectedSystems: data.affectedSystems || [],
    estimatedAffectedRecords: data.estimatedAffectedRecords || 0,
    phiInvolved: data.phiInvolved || false,
    timeline: [
      {
        id: randomUUID(),
        timestamp: now,
        description: `Incident declared by ${data.declaredBy}. Severity: ${data.severity}`,
        addedBy: data.declaredBy,
      },
    ],
    actionItems: [],
    breachNotification: data.phiInvolved ? "pending" : "not_required",
    breachNotificationDeadline: data.phiInvolved ? deadline.toISOString() : undefined,
  };

  incidents.set(id, incident);
  logger.warn(
    { orgId, incidentId: id, severity: data.severity, phiInvolved: data.phiInvolved },
    "Security incident declared",
  );

  // Persist to DB (fire-and-forget — in-memory is authoritative)
  persistIncidentToDb(incident).catch((err) =>
    logger.error({ err, incidentId: id }, "Failed to persist incident to DB"),
  );

  logPhiAccess({
    event: "incident_declared",
    orgId,
    userId: data.declaredBy,
    resourceType: "security_incident",
    resourceId: id,
    detail: `Severity: ${data.severity}, PHI involved: ${data.phiInvolved}`,
  });

  return incident;
}

export function advanceIncidentPhase(orgId: string, incidentId: string, advancedBy: string): SecurityIncident | null {
  const incident = incidents.get(incidentId);
  if (!incident || incident.orgId !== orgId) return null;

  const phaseOrder: IncidentPhase[] = [
    "detection",
    "containment",
    "eradication",
    "recovery",
    "post_incident",
    "closed",
  ];
  const currentIdx = phaseOrder.indexOf(incident.phase);
  if (currentIdx >= phaseOrder.length - 1) return incident; // Already closed

  const nextPhase = phaseOrder[currentIdx + 1]!;
  const now = new Date().toISOString();

  incident.phase = nextPhase;

  // Track phase timestamps
  if (nextPhase === "containment") incident.containedAt = now;
  else if (nextPhase === "eradication") incident.eradicatedAt = now;
  else if (nextPhase === "recovery") incident.recoveredAt = now;
  else if (nextPhase === "closed") incident.closedAt = now;

  incident.timeline.push({
    id: randomUUID(),
    timestamp: now,
    description: `Phase advanced to ${nextPhase} by ${advancedBy}`,
    addedBy: advancedBy,
  });

  logger.info({ orgId, incidentId, phase: nextPhase }, "Incident phase advanced");

  persistIncidentToDb(incident).catch((err) =>
    logger.error({ err, incidentId }, "Failed to persist incident phase update to DB"),
  );

  return incident;
}

export function addTimelineEntry(
  orgId: string,
  incidentId: string,
  description: string,
  addedBy: string,
): SecurityIncident | null {
  const incident = incidents.get(incidentId);
  if (!incident || incident.orgId !== orgId) return null;

  incident.timeline.push({
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    description,
    addedBy,
  });
  return incident;
}

export function addActionItem(
  orgId: string,
  incidentId: string,
  item: {
    description: string;
    assignedTo?: string;
    dueDate?: string;
  },
): SecurityIncident | null {
  const incident = incidents.get(incidentId);
  if (!incident || incident.orgId !== orgId) return null;

  incident.actionItems.push({
    id: randomUUID(),
    description: item.description,
    assignedTo: item.assignedTo,
    status: "open",
    dueDate: item.dueDate,
  });
  return incident;
}

export function updateActionItem(
  orgId: string,
  incidentId: string,
  itemId: string,
  status: "open" | "in_progress" | "completed",
): SecurityIncident | null {
  const incident = incidents.get(incidentId);
  if (!incident || incident.orgId !== orgId) return null;

  const item = incident.actionItems.find((a) => a.id === itemId);
  if (!item) return null;

  item.status = status;
  if (status === "completed") item.completedAt = new Date().toISOString();
  return incident;
}

export function updateIncident(
  orgId: string,
  incidentId: string,
  updates: Partial<
    Pick<
      SecurityIncident,
      "title" | "description" | "severity" | "rootCause" | "lessonsLearned" | "estimatedAffectedRecords"
    >
  >,
): SecurityIncident | null {
  const incident = incidents.get(incidentId);
  if (!incident || incident.orgId !== orgId) return null;

  Object.assign(incident, updates);

  persistIncidentToDb(incident).catch((err) =>
    logger.error({ err, incidentId }, "Failed to persist incident update to DB"),
  );

  return incident;
}

export function getIncident(orgId: string, incidentId: string): SecurityIncident | null {
  const incident = incidents.get(incidentId);
  if (!incident || incident.orgId !== orgId) return null;
  return incident;
}

export function listIncidents(orgId: string): SecurityIncident[] {
  return Array.from(incidents.values())
    .filter((i) => i.orgId === orgId)
    .sort((a, b) => b.declaredAt.localeCompare(a.declaredAt));
}

// --- Breach reporting ---

export function createBreachReport(
  orgId: string,
  data: {
    title: string;
    description: string;
    reportedBy: string;
    incidentId?: string;
    affectedIndividuals: number;
    phiTypes: string[];
    correctiveActions?: string[];
  },
): BreachReport {
  const id = randomUUID();
  const now = new Date().toISOString();

  // HIPAA §164.408: 60-day notification deadline
  const deadline = new Date();
  deadline.setDate(deadline.getDate() + 60);

  const report: BreachReport = {
    id,
    orgId,
    incidentId: data.incidentId,
    title: data.title,
    description: data.description,
    discoveredAt: now,
    reportedBy: data.reportedBy,
    affectedIndividuals: data.affectedIndividuals,
    phiTypes: data.phiTypes,
    notificationStatus: "pending",
    notificationDeadline: deadline.toISOString(),
    correctiveActions: data.correctiveActions || [],
    createdAt: now,
    updatedAt: now,
  };

  breachReports.set(id, report);
  logger.warn({ orgId, breachId: id, affected: data.affectedIndividuals }, "HIPAA breach report filed");

  // Persist to DB
  persistBreachReportToDb(report).catch((err) =>
    logger.error({ err, breachId: id }, "Failed to persist breach report to DB"),
  );

  logPhiAccess({
    event: "breach_report_filed",
    orgId,
    userId: data.reportedBy,
    resourceType: "breach_report",
    resourceId: id,
    detail: `Affected: ${data.affectedIndividuals}, PHI types: ${data.phiTypes.join(", ")}`,
  });

  return report;
}

export function updateBreachReport(
  orgId: string,
  reportId: string,
  updates: Partial<
    Pick<
      BreachReport,
      "notificationStatus" | "individualsNotifiedAt" | "hhsNotifiedAt" | "mediaNotifiedAt" | "correctiveActions"
    >
  >,
): BreachReport | null {
  const report = breachReports.get(reportId);
  if (!report || report.orgId !== orgId) return null;

  Object.assign(report, updates, { updatedAt: new Date().toISOString() });

  // Auto-advance notification status
  if (updates.individualsNotifiedAt && updates.hhsNotifiedAt) {
    report.notificationStatus = "complete";
  } else if (updates.hhsNotifiedAt) {
    report.notificationStatus = "hhs_notified";
  } else if (updates.individualsNotifiedAt) {
    report.notificationStatus = "individuals_notified";
  }

  logger.info({ orgId, breachId: reportId, status: report.notificationStatus }, "Breach report updated");

  // Persist updated report to DB
  persistBreachReportToDb(report).catch((err) =>
    logger.error({ err, breachId: reportId }, "Failed to persist breach report update to DB"),
  );

  return report;
}

export function listBreachReports(orgId: string): BreachReport[] {
  return Array.from(breachReports.values())
    .filter((r) => r.orgId === orgId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getBreachReport(orgId: string, reportId: string): BreachReport | null {
  const report = breachReports.get(reportId);
  if (!report || report.orgId !== orgId) return null;
  return report;
}

// --- DB persistence helpers ---

async function persistIncidentToDb(incident: SecurityIncident): Promise<void> {
  const db = await getDb();
  const tables = await getDbTables();
  if (!db || !tables?.securityIncidents) return;

  const { eq } = await import("drizzle-orm");
  const existing = await db
    .select({ id: tables.securityIncidents.id })
    .from(tables.securityIncidents)
    .where(eq(tables.securityIncidents.id, incident.id))
    .limit(1);

  const row = {
    id: incident.id,
    orgId: incident.orgId,
    title: incident.title,
    description: incident.description,
    severity: incident.severity,
    phase: incident.phase,
    declaredAt: new Date(incident.declaredAt),
    declaredBy: incident.declaredBy,
    closedAt: incident.closedAt ? new Date(incident.closedAt) : null,
    affectedSystems: incident.affectedSystems,
    estimatedAffectedRecords: incident.estimatedAffectedRecords,
    phiInvolved: incident.phiInvolved,
    timeline: incident.timeline,
    actionItems: incident.actionItems,
    breachNotification: incident.breachNotification,
    breachNotificationDeadline: incident.breachNotificationDeadline
      ? new Date(incident.breachNotificationDeadline)
      : null,
    containedAt: incident.containedAt ? new Date(incident.containedAt) : null,
    eradicatedAt: incident.eradicatedAt ? new Date(incident.eradicatedAt) : null,
    recoveredAt: incident.recoveredAt ? new Date(incident.recoveredAt) : null,
    rootCause: incident.rootCause || null,
    lessonsLearned: incident.lessonsLearned || null,
  };

  if (existing.length > 0) {
    await db.update(tables.securityIncidents).set(row).where(eq(tables.securityIncidents.id, incident.id));
  } else {
    await db.insert(tables.securityIncidents).values(row);
  }
}

async function persistBreachReportToDb(report: BreachReport): Promise<void> {
  const db = await getDb();
  const tables = await getDbTables();
  if (!db || !tables?.breachReports) return;

  const { eq } = await import("drizzle-orm");
  const existing = await db
    .select({ id: tables.breachReports.id })
    .from(tables.breachReports)
    .where(eq(tables.breachReports.id, report.id))
    .limit(1);

  const row = {
    id: report.id,
    orgId: report.orgId,
    incidentId: report.incidentId || null,
    title: report.title,
    description: report.description,
    discoveredAt: new Date(report.discoveredAt),
    reportedBy: report.reportedBy,
    affectedIndividuals: report.affectedIndividuals,
    phiTypes: report.phiTypes,
    notificationStatus: report.notificationStatus,
    notificationDeadline: new Date(report.notificationDeadline),
    individualsNotifiedAt: report.individualsNotifiedAt ? new Date(report.individualsNotifiedAt) : null,
    hhsNotifiedAt: report.hhsNotifiedAt ? new Date(report.hhsNotifiedAt) : null,
    mediaNotifiedAt: report.mediaNotifiedAt ? new Date(report.mediaNotifiedAt) : null,
    correctiveActions: report.correctiveActions,
    createdAt: new Date(report.createdAt),
    updatedAt: new Date(report.updatedAt),
  };

  if (existing.length > 0) {
    await db.update(tables.breachReports).set(row).where(eq(tables.breachReports.id, report.id));
  } else {
    await db.insert(tables.breachReports).values(row);
  }
}

// --- Breach notification email ---

/**
 * Send breach notification email to affected individuals.
 * HIPAA §164.404 requires notification within 60 days of discovery.
 *
 * @param orgId - Organization that experienced the breach
 * @param reportId - Breach report ID
 * @param recipientEmails - Email addresses of affected individuals
 * @returns Number of emails sent
 */
export async function sendBreachNotificationEmails(
  orgId: string,
  reportId: string,
  recipientEmails: string[],
): Promise<number> {
  const report = breachReports.get(reportId);
  if (!report || report.orgId !== orgId) {
    throw new Error("Breach report not found");
  }

  const { sendEmail } = await import("./email");

  let sentCount = 0;
  for (const email of recipientEmails) {
    try {
      await sendEmail({
        to: email,
        subject: `Important Notice: Data Security Incident — ${report.title}`,
        text: buildBreachNotificationText(report),
        html: buildBreachNotificationHtml(report),
      });
      sentCount++;
    } catch (err) {
      logger.error({ err, email: "[redacted]", breachId: reportId }, "Failed to send breach notification");
    }
  }

  if (sentCount > 0) {
    const now = new Date().toISOString();
    updateBreachReport(orgId, reportId, {
      individualsNotifiedAt: now,
      notificationStatus: "individuals_notified",
    });

    logPhiAccess({
      event: "breach_notification_sent",
      orgId,
      resourceType: "breach_report",
      resourceId: reportId,
      detail: `Notified ${sentCount} of ${recipientEmails.length} affected individuals`,
    });
  }

  return sentCount;
}

function buildBreachNotificationText(report: BreachReport): string {
  return `NOTICE OF DATA SECURITY INCIDENT

Date of Notice: ${new Date().toLocaleDateString()}
Date of Discovery: ${new Date(report.discoveredAt).toLocaleDateString()}

Dear Individual,

We are writing to inform you of a data security incident that may have affected your personal health information.

WHAT HAPPENED:
${report.description}

WHAT INFORMATION WAS INVOLVED:
The following types of information may have been affected: ${report.phiTypes.join(", ")}.

WHAT WE ARE DOING:
${report.correctiveActions.map((a, i) => `${i + 1}. ${a}`).join("\n")}

WHAT YOU CAN DO:
- Monitor your health insurance statements for any unfamiliar charges
- Review your medical records for accuracy
- Consider placing a fraud alert on your credit file

For questions, please contact our Privacy Officer.

This notice is being provided pursuant to the Health Insurance Portability and Accountability Act (HIPAA).`;
}

function buildBreachNotificationHtml(report: BreachReport): string {
  return `<!DOCTYPE html>
<html><body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
<h2 style="color: #dc2626;">Notice of Data Security Incident</h2>
<p><strong>Date of Notice:</strong> ${new Date().toLocaleDateString()}<br>
<strong>Date of Discovery:</strong> ${new Date(report.discoveredAt).toLocaleDateString()}</p>
<p>Dear Individual,</p>
<p>We are writing to inform you of a data security incident that may have affected your personal health information.</p>
<h3>What Happened</h3>
<p>${report.description}</p>
<h3>What Information Was Involved</h3>
<p>The following types of information may have been affected: <strong>${report.phiTypes.join(", ")}</strong>.</p>
<h3>What We Are Doing</h3>
<ol>${report.correctiveActions.map((a) => `<li>${a}</li>`).join("")}</ol>
<h3>What You Can Do</h3>
<ul>
<li>Monitor your health insurance statements for any unfamiliar charges</li>
<li>Review your medical records for accuracy</li>
<li>Consider placing a fraud alert on your credit file</li>
</ul>
<p>For questions, please contact our Privacy Officer.</p>
<p style="color: #666; font-size: 12px;">This notice is being provided pursuant to the Health Insurance Portability and Accountability Act (HIPAA).</p>
</body></html>`;
}
