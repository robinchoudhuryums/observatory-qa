/**
 * Live session routes for real-time clinical recording and transcription.
 *
 * Flow:
 * 1. POST /api/live-sessions — create session, connect to AssemblyAI real-time
 * 2. Client streams audio via POST (base64 PCM16 chunks)
 * 3. Server relays to AssemblyAI, broadcasts transcript events back via WebSocket
 * 4. POST /api/live-sessions/:id/draft-note — generate a draft clinical note from accumulated transcript
 * 5. POST /api/live-sessions/:id/stop — end session, finalize into a Call record
 * 6. POST /api/live-sessions/:id/pause — pause/resume recording
 *
 * HIPAA: All endpoints require authentication, org-scoped, PHI audit logged.
 */
import type { Express } from "express";
import { asyncHandler } from "../middleware/error-handler";
import { requireAuth, requireRole, injectOrgContext } from "../auth";
import { storage } from "../storage";
import { logger } from "../services/logger";
import { logPhiAccess, auditContext } from "../services/audit-log";
import { RealtimeTranscriptionSession } from "../services/assemblyai-realtime";
import { broadcastLiveTranscript } from "../services/websocket";
import { getOrgAIProvider } from "../services/ai-factory";
import { parseJsonResponse, type PromptTemplateConfig } from "../services/ai-provider";
import { sanitizeStylePreferences } from "../services/clinical-validation";
import { encryptField } from "../services/phi-encryption";
import { notifyFlaggedCall } from "../services/notifications";
import { onCallAnalysisComplete } from "../services/proactive-alerts";
import { PLAN_DEFINITIONS, type PlanTier, type OrgSettings, type ClinicalNote } from "@shared/schema";

// Track active real-time transcription sessions
const activeSessions = new Map<string, RealtimeTranscriptionSession>();

// Track accumulated transcript per session (in-memory buffer for real-time performance)
const sessionTranscripts = new Map<string, string[]>();

// Track orgId per session (for cleanup)
const sessionOrgIds = new Map<string, string>();

// Draft note generation cooldown (prevent spamming)
const lastDraftTime = new Map<string, number>();
const DRAFT_COOLDOWN_MS = 15_000; // 15 seconds minimum between drafts

// Session activity tracking for orphan cleanup
const sessionLastActivity = new Map<string, number>();
const SESSION_MAX_IDLE_MS = 2 * 60 * 60 * 1000; // 2 hours max idle
const SESSION_MAX_DURATION_MS = 4 * 60 * 60 * 1000; // 4 hours absolute max
const sessionStartTimes = new Map<string, number>();

// Audio chunk limits
const MAX_AUDIO_CHUNK_SIZE = 200_000; // ~200KB per chunk (base64)
const AUDIO_RATE_LIMIT_MS = 100; // Max 10 chunks/second per session
const audioLastSent = new Map<string, number>();

// Continuous clinical-scribe mode: automatically regenerate draft note as new final segments arrive.
// Client opts in at session creation via { continuousDraftMode: true }.
const sessionContinuousMode = new Map<string, boolean>();
// Track new-segment count since last auto-draft per session — we trigger an auto-draft every
// CONTINUOUS_DRAFT_SEGMENT_THRESHOLD new final segments OR CONTINUOUS_DRAFT_INTERVAL_MS elapsed.
const sessionSegmentsSinceDraft = new Map<string, number>();
const sessionLastAutoDraftAt = new Map<string, number>();
// Flag: auto-draft is currently in flight for this session (prevents overlapping AI calls)
const sessionAutoDraftInFlight = new Map<string, boolean>();
const CONTINUOUS_DRAFT_SEGMENT_THRESHOLD = 3; // Draft every 3 new final segments
const CONTINUOUS_DRAFT_INTERVAL_MS = 20_000; // Or every 20s, whichever comes first
const CONTINUOUS_MIN_TRANSCRIPT_CHARS = 40; // Don't attempt a draft below this

/**
 * Clean up an orphaned or expired session.
 */
async function cleanupSession(sessionId: string) {
  const rtSession = activeSessions.get(sessionId);
  if (rtSession) {
    try {
      await rtSession.close();
    } catch {
      /* best effort */
    }
    activeSessions.delete(sessionId);
  }
  const orgId = sessionOrgIds.get(sessionId);
  if (orgId) {
    try {
      await storage.updateLiveSession(orgId, sessionId, {
        status: "failed",
        endedAt: new Date().toISOString(),
      });
    } catch {
      /* best effort */
    }
  }
  sessionTranscripts.delete(sessionId);
  lastDraftTime.delete(sessionId);
  sessionLastActivity.delete(sessionId);
  sessionStartTimes.delete(sessionId);
  sessionOrgIds.delete(sessionId);
  audioLastSent.delete(sessionId);
  sessionContinuousMode.delete(sessionId);
  sessionSegmentsSinceDraft.delete(sessionId);
  sessionLastAutoDraftAt.delete(sessionId);
  sessionAutoDraftInFlight.delete(sessionId);
  logger.info({ sessionId }, "Cleaned up orphaned/expired live session");
}

/**
 * Periodic cleanup of orphaned live sessions.
 * Runs every 5 minutes, closes sessions that exceed max idle or max duration.
 */
const cleanupInterval = setInterval(
  async () => {
    const now = Date.now();
    for (const [sessionId, lastActivity] of Array.from(sessionLastActivity)) {
      const startTime = sessionStartTimes.get(sessionId) || lastActivity;
      const idle = now - lastActivity;
      const totalDuration = now - startTime;

      if (idle > SESSION_MAX_IDLE_MS || totalDuration > SESSION_MAX_DURATION_MS) {
        logger.warn({ sessionId, idleMs: idle, totalMs: totalDuration }, "Cleaning up expired live session");
        await cleanupSession(sessionId);
      }
    }
  },
  5 * 60 * 1000,
);
cleanupInterval.unref(); // Don't prevent process exit

// Time-based trigger for continuous clinical-scribe mode: scan sessions every 5 seconds
// and fire maybeTriggerAutoDraft so that idle sessions (no new segments for a while)
// still get refreshed drafts. The per-session guards inside maybeTriggerAutoDraft
// enforce the actual trigger logic (segment-count OR time threshold).
const continuousDraftInterval = setInterval(() => {
  for (const [sessionId, enabled] of Array.from(sessionContinuousMode)) {
    if (!enabled) continue;
    const orgId = sessionOrgIds.get(sessionId);
    if (!orgId) continue;
    maybeTriggerAutoDraft(sessionId, orgId);
  }
}, 5_000);
continuousDraftInterval.unref();

/**
 * Encrypt PHI fields in a clinical note object.
 */
function encryptNotePhi(note: Record<string, unknown>): Record<string, unknown> {
  const phiFields = [
    "subjective",
    "objective",
    "assessment",
    "hpiNarrative",
    "chiefComplaint",
    "chief_complaint",
    "hpi_narrative",
  ] as const;
  const encrypted = { ...note };
  for (const field of phiFields) {
    const val = encrypted[field];
    if (val && typeof val === "string") {
      try {
        encrypted[field] = encryptField(val);
      } catch {
        /* encryption not configured */
      }
    }
  }
  return encrypted;
}

/**
 * Convert snake_case AI clinical note to camelCase ClinicalNote for storage.
 */
function toClinicalNoteForStorage(raw: Record<string, unknown>, defaultFormat: string): ClinicalNote {
  return {
    format: (raw.format as string) || defaultFormat || "soap",
    providerAttested: false,
    specialty: raw.specialty as string | undefined,
    chiefComplaint: (raw.chief_complaint || raw.chiefComplaint) as string | undefined,
    subjective: raw.subjective as string | undefined,
    objective: raw.objective as string | undefined,
    assessment: raw.assessment as string | undefined,
    plan: raw.plan as string[] | undefined,
    hpiNarrative: (raw.hpi_narrative || raw.hpiNarrative) as string | undefined,
    followUp: (raw.follow_up || raw.followUp) as string | undefined,
    icd10Codes: (raw.icd10_codes || raw.icd10Codes) as ClinicalNote["icd10Codes"],
    cptCodes: (raw.cpt_codes || raw.cptCodes) as ClinicalNote["cptCodes"],
    prescriptions: raw.prescriptions as ClinicalNote["prescriptions"],
    documentationCompleteness: (raw.documentation_completeness || raw.documentationCompleteness) as number | undefined,
    clinicalAccuracy: (raw.clinical_accuracy || raw.clinicalAccuracy) as number | undefined,
    missingSections: (raw.missing_sections || raw.missingSections) as string[] | undefined,
    // DAP/BIRP fields
    data: raw.data as string | undefined,
    behavior: raw.behavior as string | undefined,
    intervention: raw.intervention as string | undefined,
    response: raw.response as string | undefined,
    // Dental fields
    cdtCodes: (raw.cdt_codes || raw.cdtCodes) as ClinicalNote["cdtCodes"],
    toothNumbers: (raw.tooth_numbers || raw.toothNumbers) as string[] | undefined,
    quadrants: raw.quadrants as string[] | undefined,
    periodontalFindings: (raw.periodontal_findings || raw.periodontalFindings) as Record<string, string> | undefined,
  };
}

/**
 * Load style preferences and build template config for a clinical session.
 */
async function buildClinicalTemplateConfig(
  orgId: string,
  userId: string,
  encounterType: string,
  noteFormat?: string,
): Promise<PromptTemplateConfig | undefined> {
  const template = await storage.getPromptTemplateByCategory(orgId, encounterType).catch(() => undefined);

  let templateConfig: PromptTemplateConfig | undefined = template
    ? {
        evaluationCriteria: template.evaluationCriteria,
        requiredPhrases: template.requiredPhrases as PromptTemplateConfig["requiredPhrases"],
        scoringWeights: template.scoringWeights as PromptTemplateConfig["scoringWeights"],
        additionalInstructions: template.additionalInstructions || undefined,
      }
    : undefined;

  // Inject note format
  if (noteFormat) {
    if (!templateConfig) templateConfig = {} as PromptTemplateConfig;
    if (!templateConfig.providerStylePreferences) templateConfig.providerStylePreferences = {};
    templateConfig.providerStylePreferences.noteFormat = noteFormat;
  }

  // Load provider style preferences (style learning integration)
  try {
    const org = await storage.getOrganization(orgId);
    const providerPrefs = userId && (org?.settings as any)?.providerStylePreferences?.[userId];
    if (providerPrefs) {
      if (!templateConfig) templateConfig = {} as PromptTemplateConfig;
      const sanitizedPrefs = sanitizeStylePreferences(providerPrefs);
      templateConfig.providerStylePreferences = sanitizedPrefs as any;
      if (sanitizedPrefs.defaultSpecialty) {
        templateConfig.clinicalSpecialty = sanitizedPrefs.defaultSpecialty as string;
      }
    }
  } catch (err) {
    logger.warn({ orgId, err }, "Failed to load provider style preferences (continuing without)");
  }

  return templateConfig;
}

/**
 * Generate a draft clinical note from the accumulated transcript for a session.
 * Extracted as a shared helper so both the manual /draft-note endpoint and the
 * continuous-mode auto-draft loop can use the same pipeline.
 *
 * Returns { displayNote, encryptedNote } on success, or null when there is not
 * enough transcript or the AI provider doesn't produce a clinical_note.
 */
async function generateDraftNoteForSession(
  orgId: string,
  sessionId: string,
  userId: string,
): Promise<{ displayNote: ClinicalNote; encryptedNote: ClinicalNote } | null> {
  const session = await storage.getLiveSession(orgId, sessionId);
  if (!session) return null;

  const segments = sessionTranscripts.get(sessionId) || [];
  const fullTranscript = segments.join(" ").trim();
  if (fullTranscript.length < CONTINUOUS_MIN_TRANSCRIPT_CHARS) return null;

  const org = await storage.getOrganization(orgId);
  const orgSettings = (org?.settings || null) as OrgSettings | null;

  const templateConfig = await buildClinicalTemplateConfig(
    orgId,
    userId,
    session.encounterType || "clinical_encounter",
    session.noteFormat,
  );

  const draftTranscript = `[LIVE RECORDING - IN PROGRESS]\n\n${fullTranscript}\n\n[Note: This is a partial recording. Generate a draft note based on available information. Mark any sections with insufficient data as "Pending - encounter in progress".]`;
  const provider = getOrgAIProvider(orgId, orgSettings);
  const result = await provider.analyzeCallTranscript(
    draftTranscript,
    sessionId,
    session.encounterType,
    templateConfig,
  );

  const parsed = parseJsonResponse(JSON.stringify(result), sessionId);
  const draftNoteRaw = parsed.clinical_note || null;
  if (!draftNoteRaw) return null;

  const encryptedRaw = encryptNotePhi(draftNoteRaw as Record<string, unknown>);
  const encryptedNote = toClinicalNoteForStorage(encryptedRaw, session.noteFormat || "soap");
  const displayNote = toClinicalNoteForStorage(draftNoteRaw as Record<string, unknown>, session.noteFormat || "soap");

  await storage.updateLiveSession(orgId, sessionId, {
    draftClinicalNote: encryptedNote,
    transcriptText: fullTranscript,
    durationSeconds: Math.round((Date.now() - new Date(session.startedAt || Date.now()).getTime()) / 1000),
  });

  return { displayNote, encryptedNote };
}

/**
 * Trigger an auto-draft for a continuous-mode session. Fire-and-forget — errors are
 * logged but never propagated to the realtime transcript callback (which must stay
 * responsive). Skips if another auto-draft is already in flight for this session.
 */
function maybeTriggerAutoDraft(sessionId: string, orgId: string): void {
  if (!sessionContinuousMode.get(sessionId)) return;
  if (sessionAutoDraftInFlight.get(sessionId)) return;

  const segmentsSince = sessionSegmentsSinceDraft.get(sessionId) || 0;
  const lastDraftAt = sessionLastAutoDraftAt.get(sessionId) || 0;
  const timeSinceLast = Date.now() - lastDraftAt;
  const segmentTrigger = segmentsSince >= CONTINUOUS_DRAFT_SEGMENT_THRESHOLD;
  const timeTrigger = timeSinceLast >= CONTINUOUS_DRAFT_INTERVAL_MS && segmentsSince > 0;
  if (!segmentTrigger && !timeTrigger) return;

  sessionAutoDraftInFlight.set(sessionId, true);
  // Reset counters BEFORE the async call so new segments during this draft are
  // counted against the next threshold and won't re-trigger this same draft.
  sessionSegmentsSinceDraft.set(sessionId, 0);
  sessionLastAutoDraftAt.set(sessionId, Date.now());

  // Resolve the session's creator for provider style learning — fall back to session creator
  (async () => {
    try {
      const session = await storage.getLiveSession(orgId, sessionId);
      if (!session) return;
      const userId = session.createdBy;
      const result = await generateDraftNoteForSession(orgId, sessionId, userId);
      if (result) {
        broadcastLiveTranscript(sessionId, "draft_note", { draftNote: result.displayNote, autoDrafted: true }, orgId);
        logPhiAccess({
          event: "live_draft_note_auto_generated",
          orgId,
          resourceType: "live_session",
          resourceId: sessionId,
          detail: "Continuous clinical-scribe auto-draft",
        });
      }
    } catch (err) {
      logger.warn({ err, sessionId, orgId }, "Continuous clinical-scribe auto-draft failed");
    } finally {
      sessionAutoDraftInFlight.set(sessionId, false);
    }
  })();
}

/**
 * Middleware to ensure clinical documentation plan.
 */
function requireClinicalPlan() {
  return async (req: any, res: any, next: any) => {
    const orgId = req.orgId;
    if (!orgId) {
      res.status(403).json({ message: "Organization context required" });
      return;
    }
    try {
      const sub = await storage.getSubscription(orgId);
      const tier = (sub?.planTier as PlanTier) || "free";
      const plan = PLAN_DEFINITIONS[tier];
      if (!plan?.limits?.clinicalDocumentationEnabled) {
        res.status(403).json({ message: "Clinical documentation requires a Clinical plan", upgrade: true });
        return;
      }
      next();
    } catch {
      next();
    }
  };
}

export function registerLiveSessionRoutes(app: Express): void {
  /**
   * POST /api/live-sessions — Start a new live recording session.
   * Creates session record and returns session ID for WebSocket audio streaming.
   */
  app.post(
    "/api/live-sessions",
    requireAuth,
    requireRole("manager", "admin"),
    injectOrgContext,
    requireClinicalPlan(),
    asyncHandler(async (req, res) => {
      const orgId = req.orgId!;
      const user = req.user!;
      const { specialty, noteFormat, encounterType, consentObtained, consentMethod, continuousDraftMode } = req.body;

      // HIPAA §164.508 requires explicit, auditable consent. Reject sessions
      // without structured metadata — the boolean alone is not enough for a
      // compliance audit to prove consent was captured. See F-12 in broad-scan audit.
      if (!consentObtained) {
        res.status(400).json({ message: "Patient consent must be obtained before recording" });
        return;
      }
      const validMethods = ["verbal", "written", "electronic"] as const;
      if (!consentMethod || !validMethods.includes(consentMethod)) {
        res.status(400).json({
          message:
            "consentMethod is required and must be one of: verbal, written, electronic. " +
            "This proves the consent capture was recorded, not just claimed.",
          code: "OBS-CLINICAL-CONSENT-METHOD-REQUIRED",
        });
        return;
      }

      const consentCapturedAt = new Date().toISOString();
      const session = await storage.createLiveSession(orgId, {
        orgId,
        createdBy: user.id,
        specialty,
        noteFormat: noteFormat || "soap",
        encounterType: encounterType || "clinical_encounter",
        consentObtained: true,
        consentMethod,
        consentCapturedAt,
        consentCapturedBy: user.id,
      });

      // HIPAA audit event — compliance officers need a tamper-evident record
      // that consent was captured, who captured it, and the method.
      logPhiAccess({
        ...auditContext(req),
        event: "clinical_consent_obtained",
        resourceType: "live_session",
        resourceId: session.id,
        detail: `Patient consent captured via ${consentMethod} by ${user.name || user.username || user.id}`,
      });

      // Initialize in-memory tracking
      const now = Date.now();
      sessionTranscripts.set(session.id, []);
      sessionOrgIds.set(session.id, orgId);
      sessionLastActivity.set(session.id, now);
      sessionStartTimes.set(session.id, now);
      // Continuous clinical-scribe mode: opt-in at session creation. When enabled, the
      // server auto-regenerates the draft note as new final segments arrive (every
      // CONTINUOUS_DRAFT_SEGMENT_THRESHOLD segments or CONTINUOUS_DRAFT_INTERVAL_MS elapsed).
      if (continuousDraftMode === true) {
        sessionContinuousMode.set(session.id, true);
        sessionSegmentsSinceDraft.set(session.id, 0);
        sessionLastAutoDraftAt.set(session.id, now);
        sessionAutoDraftInFlight.set(session.id, false);
      }

      // Connect to AssemblyAI real-time transcription
      const apiKey = process.env.ASSEMBLYAI_API_KEY;
      let transcriptionConnected = false;
      if (apiKey) {
        const rtSession = new RealtimeTranscriptionSession(apiKey, 16000, (event) => {
          sessionLastActivity.set(session.id, Date.now());

          if (event.type === "final" && event.text.trim()) {
            const segments = sessionTranscripts.get(session.id);
            if (segments) {
              segments.push(event.text);
            }
            // Increment new-segment counter for continuous-mode auto-drafting
            if (sessionContinuousMode.get(session.id)) {
              const prev = sessionSegmentsSinceDraft.get(session.id) || 0;
              sessionSegmentsSinceDraft.set(session.id, prev + 1);
              maybeTriggerAutoDraft(session.id, orgId);
            }
            broadcastLiveTranscript(
              session.id,
              "final",
              {
                text: event.text,
                confidence: event.confidence,
                words: event.words,
              },
              orgId,
            );
          } else if (event.type === "partial") {
            broadcastLiveTranscript(
              session.id,
              "partial",
              {
                text: event.text,
              },
              orgId,
            );
          } else if (event.type === "error") {
            broadcastLiveTranscript(
              session.id,
              "error",
              {
                text: event.text,
              },
              orgId,
            );
          }
        });

        try {
          await rtSession.connect();
          activeSessions.set(session.id, rtSession);
          transcriptionConnected = true;
        } catch (err) {
          logger.error({ err }, "Failed to connect AssemblyAI real-time");
        }
      } else {
        logger.warn("ASSEMBLYAI_API_KEY not configured — live transcription disabled");
      }

      logPhiAccess({
        ...auditContext(req),
        event: "live_session_started",
        resourceType: "live_session",
        resourceId: session.id,
      });

      res.json({ ...session, transcriptionConnected });
    }),
  );

  /**
   * POST /api/live-sessions/:id/audio — Receive audio chunk from client.
   * Expects JSON body with { audio: "<base64 PCM16 data>" }.
   * Rate-limited per session and size-limited per chunk.
   */
  app.post(
    "/api/live-sessions/:id/audio",
    requireAuth,
    injectOrgContext,
    requireClinicalPlan(),
    asyncHandler(async (req, res) => {
      const orgId = req.orgId!;
      const { id } = req.params;
      const { audio } = req.body;

      if (!audio || typeof audio !== "string") {
        res.status(400).json({ message: "audio field required (base64 PCM16 string)" });
        return;
      }

      // Validate chunk size
      if (audio.length > MAX_AUDIO_CHUNK_SIZE) {
        res.status(413).json({ message: `Audio chunk too large (max ${MAX_AUDIO_CHUNK_SIZE} chars)` });
        return;
      }

      // Validate base64 format
      if (!/^[A-Za-z0-9+/]+=*$/.test(audio)) {
        res.status(400).json({ message: "Invalid base64 audio data" });
        return;
      }

      // Per-session rate limit on audio chunks
      const lastSent = audioLastSent.get(id) || 0;
      const now = Date.now();
      if (now - lastSent < AUDIO_RATE_LIMIT_MS) {
        // Silently accept but skip — don't error on slight timing overlap
        res.json({ ok: true, skipped: true });
        return;
      }
      audioLastSent.set(id, now);

      const rtSession = activeSessions.get(id);
      if (!rtSession || !rtSession.isConnected) {
        res.status(404).json({ message: "No active transcription session" });
        return;
      }

      // Verify session belongs to this org
      const sessionOrg = sessionOrgIds.get(id);
      if (sessionOrg !== orgId) {
        res.status(404).json({ message: "Session not found" });
        return;
      }

      sessionLastActivity.set(id, now);
      rtSession.sendAudio(audio);
      res.json({ ok: true });
    }),
  );

  /**
   * POST /api/live-sessions/:id/draft-note — Generate a draft clinical note from current transcript.
   * Rate-limited to one request per 15 seconds per session.
   */
  app.post(
    "/api/live-sessions/:id/draft-note",
    requireAuth,
    injectOrgContext,
    requireClinicalPlan(),
    asyncHandler(async (req, res) => {
      const orgId = req.orgId!;
      const user = req.user!;
      const { id } = req.params;

      // Rate limit
      const lastTime = lastDraftTime.get(id) || 0;
      if (Date.now() - lastTime < DRAFT_COOLDOWN_MS) {
        res.status(429).json({
          message: "Draft note generation is rate limited",
          retryAfterMs: DRAFT_COOLDOWN_MS - (Date.now() - lastTime),
        });
        return;
      }

      const session = await storage.getLiveSession(orgId, id);
      if (!session) {
        res.status(404).json({ message: "Session not found" });
        return;
      }

      // Get accumulated transcript
      const segments = sessionTranscripts.get(id) || [];
      const fullTranscript = segments.join(" ").trim();

      if (fullTranscript.length < 20) {
        res.status(400).json({ message: "Not enough transcript text to generate a note (minimum ~20 characters)" });
        return;
      }

      lastDraftTime.set(id, Date.now());

      // Get org for settings
      const org = await storage.getOrganization(orgId);
      const orgSettings = (org?.settings || null) as OrgSettings | null;

      // Build template with style learning preferences
      const templateConfig = await buildClinicalTemplateConfig(
        orgId,
        user.id,
        session.encounterType || "clinical_encounter",
        session.noteFormat,
      );

      // Call AI with transcript text — let the provider build its own system/user prompts
      const draftTranscript = `[LIVE RECORDING - IN PROGRESS]\n\n${fullTranscript}\n\n[Note: This is a partial recording. Generate a draft note based on available information. Mark any sections with insufficient data as "Pending - encounter in progress".]`;
      const provider = getOrgAIProvider(orgId, orgSettings);
      const result = await provider.analyzeCallTranscript(draftTranscript, id, session.encounterType, templateConfig);

      const parsed = parseJsonResponse(JSON.stringify(result), id);
      const draftNoteRaw = parsed.clinical_note || null;

      if (draftNoteRaw) {
        // Encrypt PHI before storing draft note
        const encryptedRaw = encryptNotePhi(draftNoteRaw as Record<string, unknown>);
        const draftNote = toClinicalNoteForStorage(encryptedRaw, session.noteFormat || "soap");

        await storage.updateLiveSession(orgId, id, {
          draftClinicalNote: draftNote,
          transcriptText: fullTranscript,
          durationSeconds: Math.round((Date.now() - new Date(session.startedAt || Date.now()).getTime()) / 1000),
        });

        // Broadcast draft note update (send unencrypted to client for display)
        const displayNote = toClinicalNoteForStorage(
          draftNoteRaw as Record<string, unknown>,
          session.noteFormat || "soap",
        );
        broadcastLiveTranscript(id, "draft_note", { draftNote: displayNote }, orgId);

        logPhiAccess({
          ...auditContext(req),
          event: "live_draft_note_generated",
          resourceType: "live_session",
          resourceId: id,
        });

        res.json({ draftNote: displayNote, transcriptLength: fullTranscript.length });
      } else {
        res.json({ draftNote: null, transcriptLength: fullTranscript.length });
      }
    }),
  );

  /**
   * POST /api/live-sessions/:id/pause — Pause or resume the session.
   */
  app.post(
    "/api/live-sessions/:id/pause",
    requireAuth,
    injectOrgContext,
    asyncHandler(async (req, res) => {
      const orgId = req.orgId!;
      const { id } = req.params;

      const session = await storage.getLiveSession(orgId, id);
      if (!session) {
        res.status(404).json({ message: "Session not found" });
        return;
      }

      const newStatus = session.status === "active" ? "paused" : "active";
      const updated = await storage.updateLiveSession(orgId, id, { status: newStatus as any });
      sessionLastActivity.set(id, Date.now());
      res.json(updated);
    }),
  );

  /**
   * POST /api/live-sessions/:id/revoke-consent — Patient revokes recording consent mid-session.
   * HIPAA §164.508 requires patients to be able to revoke consent at any time.
   * This immediately stops recording, closes the AssemblyAI connection, marks consent
   * as revoked with a timestamp, and preserves the audit trail showing that consent
   * was originally obtained and then revoked.
   */
  app.post(
    "/api/live-sessions/:id/revoke-consent",
    requireAuth,
    injectOrgContext,
    asyncHandler(async (req, res) => {
      const orgId = req.orgId!;
      const user = req.user!;
      const { id } = req.params;

      const session = await storage.getLiveSession(orgId, id);
      if (!session) {
        res.status(404).json({ message: "Session not found" });
        return;
      }

      if (session.status === "completed") {
        res.status(400).json({ message: "Session already completed — consent cannot be revoked retroactively" });
        return;
      }

      if (session.consentRevokedAt) {
        res.status(400).json({ message: "Consent has already been revoked for this session" });
        return;
      }

      // Stop recording immediately — close the AssemblyAI real-time connection
      const rtSession = activeSessions.get(id);
      if (rtSession) {
        try {
          await rtSession.close();
        } catch {
          /* best effort */
        }
        activeSessions.delete(id);
      }

      // Clean up all in-memory buffers for this session
      await cleanupSession(id);

      // Mark consent as revoked in the database
      const consentRevokedAt = new Date().toISOString();
      const updated = await storage.updateLiveSession(orgId, id, {
        status: "completed" as any,
        consentRevokedAt,
        consentRevokedBy: user.id,
      });

      // HIPAA audit event — tamper-evident record of consent revocation
      logPhiAccess({
        ...auditContext(req),
        event: "clinical_consent_revoked",
        resourceType: "live_session",
        resourceId: id,
        detail:
          `Patient consent revoked by ${user.name || user.username || user.id}. ` +
          `Original consent: ${session.consentMethod} at ${session.consentCapturedAt}. ` +
          `Session duration before revocation: ${Math.round((Date.now() - new Date(session.startedAt || consentRevokedAt).getTime()) / 1000)}s`,
      });

      logger.info(
        { sessionId: id, orgId, revokedBy: user.id },
        "Patient consent revoked — live session stopped and marked",
      );

      res.json({
        ...updated,
        message:
          "Consent revoked. Recording has been stopped. The session transcript up to this point is preserved for the audit trail.",
      });
    }),
  );

  /**
   * POST /api/live-sessions/:id/stop — End the session and finalize.
   * Creates a Call record from the accumulated transcript and generates the final clinical note.
   * Also creates sentiment analysis and tracks usage for billing.
   */
  app.post(
    "/api/live-sessions/:id/stop",
    requireAuth,
    injectOrgContext,
    requireClinicalPlan(),
    asyncHandler(async (req, res) => {
      const orgId = req.orgId!;
      const user = req.user!;
      const { id } = req.params;

      const session = await storage.getLiveSession(orgId, id);
      if (!session) {
        res.status(404).json({ message: "Session not found" });
        return;
      }

      if (session.status === "completed") {
        res.status(400).json({ message: "Session already completed" });
        return;
      }

      // Close AssemblyAI real-time connection
      const rtSession = activeSessions.get(id);
      if (rtSession) {
        await rtSession.close();
        activeSessions.delete(id);
      }

      // Get final transcript
      const segments = sessionTranscripts.get(id) || [];
      const finalTranscript = segments.join(" ").trim();

      // Clean up all in-memory buffers
      sessionTranscripts.delete(id);
      lastDraftTime.delete(id);
      sessionLastActivity.delete(id);
      sessionStartTimes.delete(id);
      sessionOrgIds.delete(id);
      audioLastSent.delete(id);

      const now = new Date();
      const durationSeconds = Math.round((now.getTime() - new Date(session.startedAt || now).getTime()) / 1000);

      // Create Call + transcript + sentiment atomically.
      // AI analysis happens after this transaction (long-running Bedrock call).
      let call: any;
      await storage.withTransaction(async () => {
        call = await storage.createCall(orgId, {
          orgId,
          fileName: `live-session-${now.toISOString().replace(/[:.]/g, "-")}.webm`,
          status: "completed",
          duration: durationSeconds,
          callCategory: session.encounterType,
          tags: ["live_recording"],
        });

        if (finalTranscript.length > 0) {
          await storage.createTranscript(orgId, {
            orgId,
            callId: call.id,
            text: finalTranscript,
            confidence: "0.90",
          });
        }

        await storage.createSentimentAnalysis(orgId, {
          orgId,
          callId: call.id,
          overallSentiment: "neutral",
          overallScore: "0.5",
          segments: [],
        });
      });

      // Generate final clinical note with full context
      let finalNote = session.draftClinicalNote;
      if (finalTranscript.length >= 10) {
        try {
          const org = await storage.getOrganization(orgId);
          const orgSettings = (org?.settings || null) as OrgSettings | null;

          // Build template config with style learning
          const templateConfig = await buildClinicalTemplateConfig(
            orgId,
            user.id,
            session.encounterType || "clinical_encounter",
            session.noteFormat,
          );

          const provider = getOrgAIProvider(orgId, orgSettings);
          const result = await provider.analyzeCallTranscript(
            finalTranscript,
            call.id,
            session.encounterType,
            templateConfig,
          );
          const parsed = parseJsonResponse(JSON.stringify(result), call.id);

          // Build clinical note: prefer AI-generated, fallback to draft
          const clinicalNoteRaw = parsed.clinical_note || null;
          let cnForStorage: ClinicalNote | undefined;

          if (clinicalNoteRaw) {
            const encrypted = encryptNotePhi(clinicalNoteRaw as Record<string, unknown>);
            cnForStorage = toClinicalNoteForStorage(encrypted, session.noteFormat || "soap");
          } else if (finalNote) {
            cnForStorage = finalNote;
          }

          // Server-side flag enforcement (matches calls.ts pattern)
          const existingFlags: string[] = Array.isArray(parsed.flags) ? [...parsed.flags] : [];
          const perfScore = parsed.performance_score ?? 5.0;
          if (perfScore <= 2.0 && !existingFlags.includes("low_score")) {
            existingFlags.push("low_score");
          }
          if (perfScore >= 9.0 && !existingFlags.includes("exceptional_call")) {
            existingFlags.push("exceptional_call");
          }

          const analysis = await storage.createCallAnalysis(orgId, {
            orgId,
            callId: call.id,
            performanceScore: perfScore.toString(),
            summary: parsed.summary,
            topics: parsed.topics,
            feedback: parsed.feedback as any,
            flags: existingFlags,
            detectedAgentName: parsed.detected_agent_name || undefined,
            subScores: {
              compliance: parsed.sub_scores?.compliance,
              customerExperience: parsed.sub_scores?.customer_experience,
              communication: parsed.sub_scores?.communication,
              resolution: parsed.sub_scores?.resolution,
            },
            clinicalNote: cnForStorage,
            confidenceScore: "0.85",
            confidenceFactors: {
              transcriptConfidence: 0.9,
              wordCount: finalTranscript.split(/\s+/).length,
              callDurationSeconds: durationSeconds,
              transcriptLength: finalTranscript.length,
              aiAnalysisCompleted: true,
              overallScore: 0.85,
            },
          });

          // Auto-assign to employee based on detected agent name
          let assignedEmployeeId: string | undefined;
          if (parsed.detected_agent_name) {
            const detectedName = parsed.detected_agent_name.toLowerCase().trim();
            if (detectedName) {
              try {
                const allEmployees = await storage.getAllEmployees(orgId);
                const activeEmployees = allEmployees.filter((emp) => !emp.status || emp.status === "Active");
                const matchingEmployees = activeEmployees.filter((emp) => {
                  const empName = emp.name.toLowerCase().trim();
                  const nameParts = empName.split(/\s+/);
                  return (
                    empName === detectedName ||
                    nameParts[0] === detectedName ||
                    nameParts[nameParts.length - 1] === detectedName
                  );
                });
                if (matchingEmployees.length === 1) {
                  assignedEmployeeId = matchingEmployees[0].id;
                  logger.info(
                    { callId: call.id, employeeId: assignedEmployeeId, detectedName },
                    "Auto-assigned live session call to employee",
                  );
                } else if (matchingEmployees.length > 1) {
                  const exactMatch = matchingEmployees.find((emp) => emp.name.toLowerCase().trim() === detectedName);
                  if (exactMatch) {
                    assignedEmployeeId = exactMatch.id;
                  } else {
                    logger.info(
                      { callId: call.id, detectedName, candidates: matchingEmployees.length },
                      "Ambiguous agent name in live session — skipping auto-assignment",
                    );
                  }
                }
                if (assignedEmployeeId) {
                  await storage.updateCall(orgId, call.id, { employeeId: assignedEmployeeId });
                }
              } catch (empErr) {
                logger.warn({ callId: call.id, err: empErr }, "Failed to auto-assign employee (non-blocking)");
              }
            }
          }

          // Send webhook notification for flagged calls (non-blocking)
          if (existingFlags.length > 0) {
            notifyFlaggedCall({
              event: "call_flagged",
              callId: call.id,
              orgId,
              flags: existingFlags,
              performanceScore: perfScore,
              agentName: parsed.detected_agent_name || undefined,
              fileName: call.fileName || undefined,
              summary: typeof parsed.summary === "string" ? parsed.summary : undefined,
              timestamp: new Date().toISOString(),
            }).catch((notifErr) => {
              logger.warn(
                { callId: call.id, err: notifErr },
                "Failed to send flagged call notification (non-blocking)",
              );
            });
          }

          // Auto-generate coaching recommendations (non-blocking)
          onCallAnalysisComplete(orgId, call.id, assignedEmployeeId).catch((coachErr) => {
            logger.warn(
              { callId: call.id, err: coachErr },
              "Failed to generate coaching recommendations (non-blocking)",
            );
          });

          finalNote = cnForStorage || finalNote;
        } catch (err) {
          logger.error({ err }, "Failed to generate final clinical note for live session");
        }
      }

      // Track usage for billing
      try {
        await storage.recordUsageEvent({
          orgId,
          eventType: "transcription",
          quantity: 1,
          metadata: { callId: call.id, source: "live_session", durationSeconds },
        });
        await storage.recordUsageEvent({
          orgId,
          eventType: "ai_analysis",
          quantity: 1,
          metadata: { callId: call.id, source: "live_session" },
        });
      } catch (err) {
        logger.warn({ err }, "Failed to record usage events for live session");
      }

      // Update session as completed
      await storage.updateLiveSession(orgId, id, {
        status: "completed",
        transcriptText: finalTranscript,
        durationSeconds,
        callId: call.id,
        endedAt: now.toISOString(),
        draftClinicalNote: finalNote,
      });

      // Broadcast session end
      broadcastLiveTranscript(id, "session_end", { callId: call.id }, orgId);

      logPhiAccess({
        ...auditContext(req),
        event: "live_session_completed",
        resourceType: "live_session",
        resourceId: id,
        detail: `Call ${call.id} created from live session`,
      });

      res.json({
        session: { ...session, status: "completed", callId: call.id, endedAt: now.toISOString() },
        callId: call.id,
        transcriptLength: finalTranscript.length,
        durationSeconds,
      });
    }),
  );

  /**
   * GET /api/live-sessions — List sessions for the current user.
   */
  app.get(
    "/api/live-sessions",
    requireAuth,
    injectOrgContext,
    asyncHandler(async (req, res) => {
      const orgId = req.orgId!;
      const user = req.user!;

      const sessions = await storage.getLiveSessionsByUser(orgId, user.id);
      res.json(sessions);
    }),
  );

  /**
   * GET /api/live-sessions/:id — Get a specific session.
   */
  app.get(
    "/api/live-sessions/:id",
    requireAuth,
    injectOrgContext,
    asyncHandler(async (req, res) => {
      const orgId = req.orgId!;
      const { id } = req.params;

      const session = await storage.getLiveSession(orgId, id);
      if (!session) {
        res.status(404).json({ message: "Session not found" });
        return;
      }

      // Include current transcript buffer for active sessions
      const segments = sessionTranscripts.get(id);
      const currentTranscript = segments ? segments.join(" ") : session.transcriptText;

      res.json({ ...session, transcriptText: currentTranscript });
    }),
  );
}
