/**
 * Appointment-Driven Call Matching
 *
 * When a call is uploaded or a clinical session starts, this service attempts
 * to automatically match the call to a scheduled EHR appointment based on:
 *   1. Time proximity — call timestamp vs appointment start time (±30 min window)
 *   2. Provider name similarity — if a provider name was detected in the call
 *
 * On a successful match, the appointment's patient demographics and scheduled
 * procedure codes are returned so the clinical note can be pre-populated.
 *
 * Confidence levels:
 *   "high"   — Single appointment in the time window, provider matches (or only one apt)
 *   "medium" — Multiple appointments in window, picked the closest; or time match only
 *   "low"    — Matched only on provider name with loose time window
 *
 * Usage:
 *   const match = await matchCallToAppointment({
 *     orgId,
 *     callTimestamp: call.uploadedAt,
 *     detectedProviderName: analysis.detectedAgentName,
 *   });
 *   if (match.matched) {
 *     // pre-populate note with match.appointment and match.patient
 *   }
 */

import { getEhrAdapter } from "./index.js";
import { decryptField } from "../phi-encryption.js";
import { resolveEhrCredentials } from "./secrets-manager.js";
import { storage } from "../../storage/index.js";
import { logger } from "../logger.js";
import type { EhrAppointment, EhrPatient, AppointmentMatchResult, EhrConnectionConfig } from "./types.js";

/** Maximum time delta (ms) between call start and appointment start for a match */
const MATCH_WINDOW_MS = 30 * 60 * 1000; // ±30 minutes

/** Wider window used when falling back to provider-name-only match */
const WIDE_MATCH_WINDOW_MS = 60 * 60 * 1000; // ±60 minutes

interface MatchOptions {
  orgId: string;
  /** Timestamp of when the call occurred (ISO string or Date) */
  callTimestamp: string | Date;
  /** Provider/agent name detected by AI analysis (optional) */
  detectedProviderName?: string;
}

/**
 * Attempt to match an inbound call to an EHR appointment.
 * Returns null if the org has no EHR configured or the check fails.
 */
export async function matchCallToAppointment(
  opts: MatchOptions,
): Promise<AppointmentMatchResult | null> {
  const { orgId, callTimestamp, detectedProviderName } = opts;

  // Load org EHR config
  let org: Awaited<ReturnType<typeof storage.getOrganization>>;
  try {
    org = await storage.getOrganization(orgId);
  } catch (err) {
    logger.debug({ err, orgId }, "Appointment matcher: could not load org");
    return null;
  }

  const settings = org?.settings as any;
  const ehrConfig: (EhrConnectionConfig & { secretArn?: string }) | undefined = settings?.ehrConfig;

  if (!ehrConfig?.enabled || !ehrConfig?.system || ehrConfig.system === "mock") {
    return null;
  }

  const adapter = getEhrAdapter(ehrConfig.system);
  if (!adapter) return null;

  // Resolve credentials
  let resolvedConfig: EhrConnectionConfig;
  try {
    const decryptedKey = ehrConfig.apiKey ? decryptField(ehrConfig.apiKey) : undefined;
    resolvedConfig = await resolveEhrCredentials(ehrConfig, decryptedKey);
  } catch {
    return null;
  }

  const callDate = typeof callTimestamp === "string" ? new Date(callTimestamp) : callTimestamp;
  const dateStr = callDate.toISOString().split("T")[0]!;

  // Fetch today's appointments (or the day of the call)
  let appointments: EhrAppointment[] = [];
  try {
    appointments = await adapter.getAppointments(resolvedConfig, {
      startDate: dateStr,
      endDate: dateStr,
    });
  } catch (err) {
    logger.debug({ err, orgId }, "Appointment matcher: could not fetch appointments");
    return null;
  }

  if (!appointments.length) {
    return { matched: false, confidence: "low" as const, matchReason: "No appointments scheduled for this date" };
  }

  // Filter to active (non-cancelled) appointments
  const activeApts = appointments.filter(
    a => a.status !== "cancelled" && a.status !== "no_show"
  );

  // Score each appointment
  const scored = activeApts.map(apt => ({
    apt,
    timeDeltaMs: Math.abs(appointmentStartMs(apt, dateStr) - callDate.getTime()),
    providerMatch: detectedProviderName
      ? providerNameSimilarity(apt.providerName, detectedProviderName)
      : null,
  }));

  // Primary filter: within ±30 min window
  const inWindow = scored.filter(s => s.timeDeltaMs <= MATCH_WINDOW_MS);

  // If nothing in tight window, try wide window with provider match
  const candidates = inWindow.length > 0
    ? inWindow
    : (detectedProviderName
      ? scored.filter(s => s.timeDeltaMs <= WIDE_MATCH_WINDOW_MS && (s.providerMatch || 0) > 0.5)
      : []);

  if (!candidates.length) {
    return {
      matched: false,
      confidence: "low" as const,
      matchReason: `No appointments within ${MATCH_WINDOW_MS / 60000} minutes of call time`,
    };
  }

  // Sort: provider match (desc) then time delta (asc)
  candidates.sort((a, b) => {
    const provDiff = (b.providerMatch || 0) - (a.providerMatch || 0);
    if (Math.abs(provDiff) > 0.3) return provDiff;
    return a.timeDeltaMs - b.timeDeltaMs;
  });

  const best = candidates[0]!;
  const isFromWideWindow = !inWindow.includes(best);

  let confidence: AppointmentMatchResult["confidence"];
  if (inWindow.length === 1 && (!detectedProviderName || (best.providerMatch || 0) > 0.7)) {
    confidence = "high";
  } else if (isFromWideWindow) {
    confidence = "low";
  } else {
    confidence = "medium";
  }

  const matchReason = buildMatchReason(best.apt, best.timeDeltaMs, best.providerMatch, inWindow.length);

  // Optionally fetch patient data for the matched appointment
  let patient: EhrPatient | undefined;
  if (best.apt.patientId && confidence !== "low") {
    try {
      patient = await adapter.getPatient(resolvedConfig, best.apt.patientId) || undefined;
    } catch {
      // Patient lookup is best-effort
    }
  }

  logger.info({
    orgId,
    appointmentId: best.apt.ehrAppointmentId,
    patientId: best.apt.patientId,
    confidence,
    timeDeltaMinutes: Math.round(best.timeDeltaMs / 60000),
  }, "Call matched to EHR appointment");

  return {
    matched: true,
    appointment: best.apt,
    patient,
    confidence,
    matchReason,
  };
}

// --- Helpers ---

/**
 * Convert appointment date + startTime to milliseconds since epoch.
 * Handles "HH:mm" and "HH:mm:ss" time formats.
 */
function appointmentStartMs(apt: EhrAppointment, fallbackDate: string): number {
  const date = apt.date || fallbackDate;
  const time = apt.startTime || "09:00";
  try {
    return new Date(`${date}T${time.slice(0, 5)}:00`).getTime();
  } catch {
    return new Date(date).getTime();
  }
}

/**
 * Compute a 0–1 similarity score between two provider name strings.
 * Uses token overlap (Jaccard similarity on words).
 */
function providerNameSimilarity(ehrName: string, detectedName: string): number {
  if (!ehrName || !detectedName) return 0;

  const normalize = (s: string) =>
    s.toLowerCase()
      .replace(/\b(dr|dds|md|dmd|np|pa|rn|lcsw|lpc|phd|do|ot|pt)\b\.?/gi, "")
      .replace(/[^a-z\s]/g, "")
      .split(/\s+/)
      .filter(Boolean);

  const aArr = normalize(ehrName);
  const bArr = normalize(detectedName);

  if (aArr.length === 0 || bArr.length === 0) return 0;

  const a = new Set(aArr);
  const b = new Set(bArr);
  const intersectionSize = aArr.filter(x => b.has(x)).length;
  const unionSize = new Set(aArr.concat(bArr)).size;

  return intersectionSize / unionSize;
}

function buildMatchReason(
  apt: EhrAppointment,
  timeDeltaMs: number,
  providerMatch: number | null,
  candidateCount: number,
): string {
  const parts: string[] = [];
  const mins = Math.round(timeDeltaMs / 60000);
  parts.push(`${mins}min from appointment start`);
  if (providerMatch !== null) {
    parts.push(`provider similarity ${Math.round(providerMatch * 100)}%`);
  }
  if (candidateCount > 1) {
    parts.push(`${candidateCount} candidates`);
  }
  return parts.join(", ");
}
