/**
 * Data adapters — map real Drizzle schema shapes to orrery presentation data.
 *
 * Adapters are pure functions tested against fixtures matching the live
 * Call/CallAnalysis/SentimentAnalysis shapes in `shared/schema/`. They never
 * mutate input data. If a backend field is missing, adapters fall back to
 * safe defaults rather than throwing — the orrery should always render even
 * with degraded data.
 *
 * Industry-agnostic: no hardcoded category names, statuses, or labels.
 * All display strings come from the org's own data via the active lens.
 */
import type { CallWithDetails } from "@shared/schema";
// Import directly from the projection submodule (not the barrel) so this
// file is testable under Node's tsx runner — the barrel re-exports owl
// modules that import CSS, which Node can't load.
import type { PlanetData } from "@/components/orrery/OrreryPlanet";
import { TILT, orreryProject } from "@/components/orrery/projection";
import { LENSES, ORBIT_RADII, type LensId, type OrbitIndex } from "./orrery-lenses";

// ─── Call arc / moment types ─────────────────────────────────────────────

/**
 * A "moment" is a single point in time on the call's arc — a place worth
 * scrubbing to. The Atlas drill-in displays moments as colored dots along
 * an orbital arc; the clinical mode renders them as labeled peaks on a
 * horizontal quality curve.
 *
 * Tones map to celestial palette colors via brightToColor:
 *   warm    — positive turn (sentiment improving)
 *   cool    — negative turn (sentiment dropping)
 *   amber   — flagged (low_score / agent_misconduct)
 *   green   — exceptional turn
 *   neutral — no notable signal (used for "Moment N" filler)
 */
export type MomentTone = "warm" | "cool" | "amber" | "green" | "neutral";

export type Moment = {
  /** Stable id derived from time + label. */
  id: string;
  /** Time in seconds from the call start. */
  time: number;
  /** Display label — comes from analysis.topics[] when possible. */
  label: string;
  tone: MomentTone;
  /** Brightness 0-1 (drives the dot color via the celestial ramp). */
  brightness: number;
  /** Underlying sentiment at this moment, if available. */
  sentiment?: "positive" | "neutral" | "negative";
  /** Whether this moment carries a coaching/exceptional flag. */
  flagged?: boolean;
};

export type ClinicalTimelinePoint = {
  /** Time in seconds from the call start. */
  time: number;
  /** Quality 0-100 (mapped to Y axis). */
  quality: number;
};

export type CallTimeline = {
  moments: Moment[];
  /** Total call duration in seconds. */
  durationSec: number;
  /** Smoothed quality curve for the clinical timeline view. */
  points: ClinicalTimelinePoint[];
};

// ─── Galaxy spiral types ─────────────────────────────────────────────────

/** Raw shape returned by GET /api/dashboard/galaxy?month=YYYY-MM. */
export type GalaxyDayRow = {
  /** YYYY-MM-DD. */
  date: string;
  calls: number;
  /** Ratio 0-1 of scored calls that scored ≥7. Null if no calls were scored. */
  closeRate: number | null;
};

/** Spiral-positioned day, ready to render in the Galaxy view. */
export type GalaxyDay = {
  /** Day of month (1-31). */
  day: number;
  /** YYYY-MM-DD. */
  date: string;
  calls: number;
  closeRate: number | null;
  /** Spiral x coord (viewBox units). */
  px: number;
  /** Spiral y coord (viewBox units, isometric-projected). */
  py: number;
  /** Planet radius (log-scale of count). */
  sz: number;
  /** Brightness 0-1 from closeRate, falls back to mid when null. */
  br: number;
  weekend: boolean;
  /** Today's planet — gets the ring overlay. */
  anchor: boolean;
};

// ─── Constellation (pattern) types ───────────────────────────────────────

/** Pattern color band — drives constellation node tint + sidebar accents. */
export type PatternColor = "bright" | "warm" | "cool" | "cold" | "amber" | "red" | "green";

export type ConstellationNode = {
  /** Stable key — derived from the topic term. */
  key: string;
  label: string;
  /** Frequency within the cluster, 0-1. */
  weight: number;
  /** Node radius in viewBox units. */
  sz: number;
  px: number;
  py: number;
};

export type ConstellationEdge = {
  fromKey: string;
  toKey: string;
  /** Edge weight 0-1 — drives stroke opacity. */
  weight: number;
};

export type Constellation = {
  /** Stable id — cluster id from the backend. */
  id: string;
  /** Display label (e.g. "Insurance verification"). */
  label: string;
  /** Headline stat shown in the sidebar (e.g. "+18% vs prior week"). */
  stat: string;
  /** Cluster trend — drives the color. */
  trend: "rising" | "stable" | "declining";
  color: PatternColor;
  /** Total occurrences in the analysis window. */
  occurrences: number;
  /** Call ids that contribute to the cluster — for evidence drilldown. */
  callIds: string[];
  /** Optional short summary from the cluster service. */
  summary?: string;
  nodes: ConstellationNode[];
  edges: ConstellationEdge[];
};

/**
 * Maximum planets the Atlas renders. Beyond this, the lowest-volume groups
 * collapse into a single "Other" planet. Matches the prototype's visual budget
 * — 12 planets keeps the orrery readable; 30+ becomes noise.
 */
export const MAX_PLANETS = 12;

/**
 * Per-orbit angular slot allocation. Inner orbits hold more planets (more
 * circumference), outer orbits hold fewer. Index = orbit, value = max slots.
 */
const SLOTS_PER_ORBIT: Record<OrbitIndex, number> = {
  0: 4,
  1: 4,
  2: 3,
  3: 2,
};

export type AtlasPlanet = PlanetData & {
  /** Display label for this planet (real category/agent/bucket name). */
  label: string;
  /** Number of calls represented. */
  count: number;
  /** Average performance score (0-10) — null if no calls have analysis. */
  avgScore: number | null;
  /** Orbit index 0-3. */
  orbit: OrbitIndex;
  /** Anchor planet today (highest-volume group). One per Atlas. */
  hot: boolean;
  /** At least one call in this group has a coaching flag (low_score). */
  coaching: boolean;
  /** Volume is unusually high or low vs trailing 7-day avg (>2x or <0.5x). */
  anomaly: boolean;
  /** At least one call in this group is exceptional. */
  exceptional: boolean;
  /** Stable group key (matches lens.keyFor). */
  groupKey: string;
};

/**
 * Convert a list of calls into orrery planets under the given lens.
 *
 * Algorithm:
 *  1. Filter to today's calls (per the user's local day boundary).
 *  2. Group by lens.keyFor() — drop calls the lens excludes (returns null).
 *  3. Rank groups by volume (call count, descending).
 *  4. Cap at MAX_PLANETS - 1; remaining low-volume groups collapse into
 *     a single "Other" planet on the outermost orbit.
 *  5. For each group: compute brightness from avg performance score,
 *     assign orbit via lens.assignOrbit(), place at a stable angle.
 *  6. Flag the highest-volume group as `hot` (the day's anchor).
 *  7. Flag groups with coaching/anomaly/exceptional signal.
 *  8. Project (x,y) → screen coords via orreryProject().
 *
 * The `historicalCalls` arg is used only for anomaly detection — pass the
 * trailing 7 days of calls so volume comparisons are meaningful. Omitting
 * it disables anomaly flagging without breaking anything.
 */
export function callsToPlanets(
  calls: CallWithDetails[],
  lensId: LensId,
  options: {
    /** Calls from the trailing 7 days (excluding today) for anomaly detection. */
    historicalCalls?: CallWithDetails[];
    /** Override "today" — useful for tests. Defaults to current local date. */
    now?: Date;
  } = {},
): AtlasPlanet[] {
  const lens = LENSES[lensId];
  const now = options.now || new Date();
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);

  // 1. Filter to today's calls.
  const todaysCalls = calls.filter((c) => {
    if (!c.uploadedAt) return false;
    const t = new Date(c.uploadedAt).getTime();
    return t >= todayStart.getTime() && t <= todayEnd.getTime();
  });
  if (todaysCalls.length === 0) return [];

  // 2. Group by lens key.
  const groups = new Map<string, CallWithDetails[]>();
  for (const call of todaysCalls) {
    const key = lens.keyFor(call);
    if (!key) continue;
    const bucket = groups.get(key);
    if (bucket) bucket.push(call);
    else groups.set(key, [call]);
  }
  if (groups.size === 0) return [];

  // 3. Rank by volume.
  const ranked = Array.from(groups.entries())
    .map(([key, members]) => ({ key, members }))
    .sort((a, b) => b.members.length - a.members.length);

  // 4. Cap at MAX_PLANETS - 1; collapse overflow into "Other".
  const visible = ranked.slice(0, MAX_PLANETS - 1);
  const overflow = ranked.slice(MAX_PLANETS - 1);
  const collapsedOther =
    overflow.length > 0
      ? {
          key: "__other__",
          members: overflow.flatMap((g) => g.members),
        }
      : null;
  const finalGroups = collapsedOther ? [...visible, collapsedOther] : visible;

  // 5/6/7. Build planets.
  // Track angle progression per orbit so planets don't pile up at the same θ.
  const orbitAngleCursors: Record<OrbitIndex, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
  const orbitOccupancy: Record<OrbitIndex, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };

  // Historical volume baselines for anomaly detection.
  const historicalByGroup = new Map<string, number>();
  if (options.historicalCalls) {
    for (const call of options.historicalCalls) {
      const key = lens.keyFor(call);
      if (!key) continue;
      historicalByGroup.set(key, (historicalByGroup.get(key) || 0) + 1);
    }
  }

  const totalVisibleGroups = finalGroups.length;
  const planets: AtlasPlanet[] = [];

  for (let rank = 0; rank < finalGroups.length; rank++) {
    const { key, members } = finalGroups[rank];
    const sample = members[0];
    const isOtherBucket = key === "__other__";

    // Group "Other" always lands on the outermost orbit.
    const orbit: OrbitIndex = isOtherBucket
      ? 3
      : lens.assignOrbit({ key, volumeRank: rank, totalGroups: totalVisibleGroups });

    // Size: log scale of count, clamped to [1.0, 3.4] viewBox units.
    const count = members.length;
    const sz = sizeForCount(count);

    // Brightness: avg performance score / 10. Null score → 0.5 (mid-ramp).
    const { avgScore, brightness } = aggregateScore(members);

    // Place at a stable angle for this orbit slot.
    const angle = pickAngle(orbit, orbitAngleCursors, orbitOccupancy);
    const x = Math.cos(angle) * ORBIT_RADII[orbit];
    const y = Math.sin(angle) * ORBIT_RADII[orbit];
    const [px, py] = orreryProject(x, y);

    // Anomaly: today's count vs trailing-7-day daily average for this group.
    const anomaly = detectAnomaly(key, count, historicalByGroup);

    // Coaching / exceptional signal from analysis flags.
    let coaching = false;
    let exceptional = false;
    for (const m of members) {
      const flags = m.analysis?.flags;
      if (!Array.isArray(flags)) continue;
      for (const f of flags) {
        if (f === "low_score" || f.startsWith("agent_misconduct")) coaching = true;
        if (f === "exceptional_call") exceptional = true;
      }
      if (coaching && exceptional) break;
    }

    planets.push({
      groupKey: key,
      label: isOtherBucket ? `Other · ${count} calls` : lens.labelFor(key, sample),
      count,
      avgScore,
      orbit,
      px,
      py,
      sz,
      br: brightness,
      hot: rank === 0 && !isOtherBucket, // The day's anchor — highest-volume named group.
      coaching,
      anomaly,
      exceptional,
    });
  }

  // Sort by py so back planets draw first (basic painter's-algorithm depth).
  return planets.sort((a, b) => a.py - b.py);
}

/**
 * Atlas presentation state derived from real data. The dashboard uses this
 * to pick a hero copy variant + decide whether to show the day-replay button.
 *
 *   day-1            — zero calls today AND no calls in trailing 7 days
 *   day-1-afternoon  — 1-5 calls today AND fewer than 14 days of history
 *   partial          — calls today but some still pending/processing
 *   flat-day         — every group within 1.5x of the average volume (no anchor)
 *   normal           — meaningful distribution, an anchor exists
 */
export type AtlasRealism = "day-1" | "day-1-afternoon" | "partial" | "flat-day" | "normal";

export function deriveAtlasRealism(
  todaysCalls: CallWithDetails[],
  historicalCalls: CallWithDetails[],
  options: { historyDays?: number } = {},
): AtlasRealism {
  const completed = todaysCalls.filter((c) => c.status === "completed");
  const pendingOrProcessing = todaysCalls.filter(
    (c) => c.status === "pending" || c.status === "processing",
  );
  const historyDays = options.historyDays ?? 7;

  if (completed.length === 0 && historicalCalls.length === 0) return "day-1";
  if (completed.length > 0 && completed.length <= 5 && historyDays < 14) return "day-1-afternoon";
  if (pendingOrProcessing.length > 0) return "partial";

  // Flat-day check: if no group exceeds 1.5x the average, there's no anchor.
  if (completed.length >= 6) {
    const byCategory = new Map<string, number>();
    for (const c of completed) {
      const key = c.callCategory || "__uncategorized__";
      byCategory.set(key, (byCategory.get(key) || 0) + 1);
    }
    const counts = Array.from(byCategory.values());
    if (counts.length > 0) {
      const max = Math.max(...counts);
      const avg = counts.reduce((s, n) => s + n, 0) / counts.length;
      if (max <= avg * 1.5) return "flat-day";
    }
  }

  return "normal";
}

// ----- internal helpers -----

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

/**
 * Log-scale size mapping. Count of 1 → 1.0 units; count of 50+ → 3.4 units.
 * Reads well across the typical range of dashboard volumes (1-200 calls/day).
 */
function sizeForCount(count: number): number {
  const minSize = 1.0;
  const maxSize = 3.4;
  if (count <= 1) return minSize;
  // log10(1) = 0, log10(100) = 2 → 0..2 range → minSize..maxSize.
  const t = Math.min(Math.log10(count) / 2, 1);
  return minSize + (maxSize - minSize) * t;
}

function aggregateScore(calls: CallWithDetails[]): {
  avgScore: number | null;
  brightness: number;
} {
  let total = 0;
  let scored = 0;
  for (const c of calls) {
    const raw = c.analysis?.performanceScore;
    if (typeof raw === "string") {
      const n = parseFloat(raw);
      if (!Number.isNaN(n)) {
        total += n;
        scored++;
      }
    } else if (typeof raw === "number") {
      total += raw;
      scored++;
    }
  }
  if (scored === 0) return { avgScore: null, brightness: 0.5 };
  const avg = total / scored;
  return { avgScore: avg, brightness: Math.max(0, Math.min(1, avg / 10)) };
}

/**
 * Pick an angle for the next planet on the given orbit. Spreads planets
 * across the orbit by deterministic increments so successive renders stay
 * stable (no random jitter).
 */
function pickAngle(
  orbit: OrbitIndex,
  cursors: Record<OrbitIndex, number>,
  occupancy: Record<OrbitIndex, number>,
): number {
  const slot = occupancy[orbit];
  const slots = SLOTS_PER_ORBIT[orbit];
  occupancy[orbit] = slot + 1;
  // Start the first planet at an offset angle so it doesn't sit at 3 o'clock;
  // gives the orrery a slightly tilted, hand-placed feel.
  const offset = 0.4 + orbit * 0.6;
  const angle = offset + (slot / slots) * Math.PI * 2;
  cursors[orbit] = angle;
  return angle;
}

function detectAnomaly(
  key: string,
  todayCount: number,
  historicalByGroup: Map<string, number>,
): boolean {
  const historicalTotal = historicalByGroup.get(key) || 0;
  if (historicalTotal === 0) return false;
  // Trailing 7-day daily average.
  const dailyAvg = historicalTotal / 7;
  if (dailyAvg < 1) return false; // Too little history to call it anomalous.
  return todayCount > dailyAvg * 2 || todayCount < dailyAvg * 0.5;
}

// ─── Moment detection ────────────────────────────────────────────────────

/**
 * Maximum moments rendered on the call arc. Beyond this, the arc gets
 * crowded and labels overlap. Matches the prototype's visual budget.
 */
const MAX_MOMENTS = 10;
const MIN_MOMENTS = 3;
const TARGET_MOMENTS = 8;
const SHORT_CALL_THRESHOLD_SEC = 60;
const LONG_CALL_THRESHOLD_SEC = 30 * 60;

type SentimentSegmentLike = {
  start?: number;
  end?: number;
  sentiment?: string;
  score?: number;
};

type TranscriptLike = {
  words?: Array<{ start?: number; end?: number; speaker?: string }>;
};

type AnalysisLike = {
  topics?: unknown;
  flags?: unknown;
};

/**
 * Detect notable moments in a call from sentiment segments, speaker turns,
 * and analysis flags. Industry-agnostic — relies only on data shapes that
 * exist for every channel (voice/email/chat/sms) and every industry.
 *
 * Algorithm (closed in §9 of the implementation plan):
 *   1. Bucket the call by sentiment shift boundaries (segments[]). If <8
 *      boundaries exist, supplement with speaker-turn boundaries (first
 *      transition per speaker after a 5-second silence).
 *   2. Pick the timestamp where |sentiment.score - prev.score| is maximal
 *      within each bucket as the moment anchor.
 *   3. Tone: warm if score > 0.6, cool if < 0.4, amber on coaching flag,
 *      green on exceptional flag.
 *   4. Label: nearest topic by timestamp proximity; falls back to "Moment N".
 *   5. Short calls (<60s): collapse to 3 moments (greeting / middle / close).
 *   6. Long calls (>30min): cap at MAX_MOMENTS, prefer largest sentiment swings.
 *   7. No sentiment data: even time-spacing, 6 moments, neutral tone.
 *
 * Returns moments sorted by time ascending. Pure function — safe to call
 * during render.
 */
export function transcriptToMoments(
  transcript: TranscriptLike | undefined,
  sentiment: { segments?: unknown; overallSentiment?: string } | undefined,
  analysis: AnalysisLike | undefined,
  durationSec: number,
): Moment[] {
  // Normalize topics + flags to safe arrays. (CallAnalysis.topics is
  // sometimes returned as a string, sometimes an array of objects/strings.)
  const topics = normalizeTopics(analysis?.topics);
  const flags = Array.isArray(analysis?.flags)
    ? (analysis.flags as string[]).filter((f) => typeof f === "string")
    : [];
  const hasCoachingFlag = flags.some((f) => f === "low_score" || f.startsWith("agent_misconduct"));
  const hasExceptionalFlag = flags.includes("exceptional_call");

  // Short call: 3 moments, evenly spaced.
  if (durationSec > 0 && durationSec < SHORT_CALL_THRESHOLD_SEC) {
    return makeEvenMoments(durationSec, 3, ["Greeting", "Middle", "Close"], topics, {
      coaching: hasCoachingFlag,
      exceptional: hasExceptionalFlag,
    });
  }

  const segments = normalizeSegments(sentiment?.segments);
  // No sentiment data at all: even time-spacing, 6 moments, neutral tone.
  if (segments.length === 0) {
    const count = Math.min(MAX_MOMENTS, Math.max(MIN_MOMENTS, 6));
    return makeEvenMoments(durationSec || 600, count, undefined, topics, {
      coaching: hasCoachingFlag,
      exceptional: hasExceptionalFlag,
    });
  }

  // Build candidate moments from sentiment-shift boundaries.
  const candidates: Moment[] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const prev = i > 0 ? segments[i - 1] : null;
    const score = seg.score ?? 0.5;
    const prevScore = prev?.score ?? 0.5;
    const swing = Math.abs(score - prevScore);
    const time = (seg.start ?? 0) / 1000; // AssemblyAI sentiment segments are ms.
    const tone = pickTone(seg.sentiment, score, hasCoachingFlag, hasExceptionalFlag);
    candidates.push({
      id: `m-${time.toFixed(2)}-${i}`,
      time,
      label: nearestTopic(topics, time) || `Moment ${i + 1}`,
      tone,
      brightness: Math.max(0, Math.min(1, score)),
      sentiment: normalizeSentimentName(seg.sentiment),
      flagged: hasCoachingFlag || hasExceptionalFlag,
      // Internal: swing magnitude for importance ranking. Stripped before return.
      // @ts-expect-error _swing is an internal-only ranking field stripped before return.
      _swing: swing,
    });
  }

  // Supplement with speaker-turn boundaries when sentiment data is sparse.
  if (candidates.length < TARGET_MOMENTS && transcript?.words) {
    const turns = detectSpeakerTurns(transcript.words);
    for (const turn of turns) {
      if (candidates.some((c) => Math.abs(c.time - turn) < 3)) continue; // dedupe near existing
      candidates.push({
        id: `m-turn-${turn.toFixed(2)}`,
        time: turn,
        label: nearestTopic(topics, turn) || `Speaker turn`,
        tone: "neutral",
        brightness: 0.5,
        // @ts-expect-error _swing is an internal-only ranking field (see above).
        _swing: 0,
      });
      if (candidates.length >= TARGET_MOMENTS * 1.5) break;
    }
  }

  // Long call: rank by swing magnitude, keep top MAX_MOMENTS.
  let kept = candidates;
  if (durationSec > LONG_CALL_THRESHOLD_SEC || candidates.length > MAX_MOMENTS) {
    kept = candidates
      // @ts-expect-error _swing is internal — present on candidates only.
      .sort((a, b) => (b._swing || 0) - (a._swing || 0))
      .slice(0, MAX_MOMENTS);
  } else if (candidates.length > TARGET_MOMENTS) {
    // Trim to TARGET_MOMENTS, biased toward largest swings.
    kept = candidates
      // @ts-expect-error _swing is internal — present on candidates only.
      .sort((a, b) => (b._swing || 0) - (a._swing || 0))
      .slice(0, TARGET_MOMENTS);
  }

  // Sort by time and strip internal swing field.
  return kept
    .sort((a, b) => a.time - b.time)
    .map(({ ...m }) => {
      // @ts-expect-error Strip internal _swing field before returning to consumers.
      delete m._swing;
      return m;
    });
}

/**
 * Build a smoothed quality curve for the clinical-mode timeline view.
 * Samples sentiment.segments[].score across the call duration; if no
 * sentiment data exists, returns a flat line at 50% with the moments
 * as the only data points.
 */
export function callToClinicalTimeline(
  transcript: TranscriptLike | undefined,
  sentiment: { segments?: unknown } | undefined,
  analysis: AnalysisLike | undefined,
  durationSec: number,
): CallTimeline {
  const moments = transcriptToMoments(transcript, sentiment, analysis, durationSec);
  const segments = normalizeSegments(sentiment?.segments);
  const duration = durationSec || moments[moments.length - 1]?.time || 60;

  let points: ClinicalTimelinePoint[];
  if (segments.length > 0) {
    points = segments.map((seg) => ({
      time: (seg.start ?? 0) / 1000,
      quality: Math.round(Math.max(0, Math.min(1, seg.score ?? 0.5)) * 100),
    }));
    // Ensure endpoints anchor at start (0) and end (duration).
    if (points[0]?.time > 0) points.unshift({ time: 0, quality: points[0].quality });
    if (points[points.length - 1]?.time < duration) {
      points.push({ time: duration, quality: points[points.length - 1].quality });
    }
  } else {
    // No sentiment data — interpolate quality at each moment from brightness.
    points = moments.map((m) => ({
      time: m.time,
      quality: Math.round(m.brightness * 100),
    }));
    if (points.length === 0 || points[0].time > 0) {
      points.unshift({ time: 0, quality: 50 });
    }
    if (points[points.length - 1].time < duration) {
      points.push({ time: duration, quality: 50 });
    }
  }

  return { moments, durationSec: duration, points };
}

// ─── moment helpers ──────────────────────────────────────────────────────

function normalizeSegments(raw: unknown): SentimentSegmentLike[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((s): s is SentimentSegmentLike => typeof s === "object" && s !== null);
}

function normalizeTopics(raw: unknown): Array<{ time?: number; label: string }> {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((t) => {
      if (typeof t === "string") return { label: t };
      if (typeof t === "object" && t !== null) {
        const obj = t as Record<string, unknown>;
        const label =
          typeof obj.label === "string"
            ? obj.label
            : typeof obj.text === "string"
              ? obj.text
              : typeof obj.name === "string"
                ? obj.name
                : null;
        if (!label) return null;
        const time =
          typeof obj.time === "number"
            ? obj.time
            : typeof obj.start === "number"
              ? obj.start / 1000
              : undefined;
        return { label, time };
      }
      return null;
    })
    .filter((t): t is { time?: number; label: string } => t !== null);
}

function nearestTopic(
  topics: Array<{ time?: number; label: string }>,
  time: number,
): string | null {
  if (topics.length === 0) return null;
  // Topics with timestamps win; pick the closest within 30s.
  const withTime = topics.filter((t) => typeof t.time === "number");
  if (withTime.length > 0) {
    let best: { dist: number; label: string } | null = null;
    for (const t of withTime) {
      const dist = Math.abs((t.time as number) - time);
      if (dist <= 30 && (!best || dist < best.dist)) best = { dist, label: t.label };
    }
    if (best) return best.label;
  }
  // Otherwise, round-robin through the labeled list by time slot.
  const slot = Math.floor((time / Math.max(60, 1)) % topics.length);
  return topics[slot]?.label || null;
}

function pickTone(
  sentimentName: string | undefined,
  score: number,
  hasCoachingFlag: boolean,
  hasExceptionalFlag: boolean,
): MomentTone {
  if (hasExceptionalFlag && score > 0.7) return "green";
  if (hasCoachingFlag && score < 0.4) return "amber";
  const s = sentimentName?.toUpperCase();
  if (s === "POSITIVE" || score > 0.6) return "warm";
  if (s === "NEGATIVE" || score < 0.4) return "cool";
  return "neutral";
}

function normalizeSentimentName(
  raw: string | undefined,
): "positive" | "neutral" | "negative" | undefined {
  if (!raw) return undefined;
  const s = raw.toUpperCase();
  if (s === "POSITIVE") return "positive";
  if (s === "NEGATIVE") return "negative";
  if (s === "NEUTRAL") return "neutral";
  return undefined;
}

function detectSpeakerTurns(
  words: Array<{ start?: number; end?: number; speaker?: string }>,
): number[] {
  const turns: number[] = [];
  let lastSpeaker: string | undefined = undefined;
  let lastEnd = 0;
  for (const w of words) {
    if (!w.speaker || typeof w.start !== "number") continue;
    const startSec = w.start / 1000;
    if (w.speaker !== lastSpeaker && startSec - lastEnd > 5) {
      turns.push(startSec);
    }
    lastSpeaker = w.speaker;
    if (typeof w.end === "number") lastEnd = w.end / 1000;
  }
  return turns;
}

function makeEvenMoments(
  durationSec: number,
  count: number,
  presetLabels: string[] | undefined,
  topics: Array<{ time?: number; label: string }>,
  flagFlags: { coaching: boolean; exceptional: boolean },
): Moment[] {
  const moments: Moment[] = [];
  for (let i = 0; i < count; i++) {
    const time = (durationSec * (i + 0.5)) / count;
    const presetLabel = presetLabels?.[i];
    const topicLabel = nearestTopic(topics, time);
    const label = presetLabel || topicLabel || `Moment ${i + 1}`;
    let tone: MomentTone = "neutral";
    if (flagFlags.exceptional && i === count - 1) tone = "green";
    if (flagFlags.coaching && i === Math.floor(count / 2)) tone = "amber";
    moments.push({
      id: `m-even-${i}`,
      time,
      label,
      tone,
      brightness: 0.5,
      flagged: flagFlags.coaching || flagFlags.exceptional,
    });
  }
  return moments;
}

// ─── Coaching: per-agent mini-orrery types ────────────────────────────────

export type CoachingAgent = {
  /** Employee id (stable key for React lists + drilldown). */
  id: string;
  name: string;
  role: string | null;
  /** 0-1, drives planet brightness. From avgPerformanceScore / 10. */
  brightness: number;
  /** Average performance score 0-10 (raw). Null if no calls scored yet. */
  avgScore: number | null;
  /** Number of completed calls in the lookback window. */
  callCount: number;
  /** Has at least one active coaching session. */
  hasActiveSession: boolean;
  /** Has at least one call flagged for coaching (low_score / agent_misconduct). */
  flagged: boolean;
  /** Has at least one call flagged as exceptional. */
  exceptional: boolean;
};

type CoachingSessionLike = {
  employeeId?: string;
  status?: string;
};

type PerformerLike = {
  id: string;
  name: string;
  role?: string;
  avgPerformanceScore?: number | null;
  totalCalls?: number;
};

type EmployeeLike = {
  id: string;
  name: string;
  role?: string;
  status?: string;
};

/**
 * Build per-agent mini-orrery data from real /api/performance,
 * /api/employees, /api/coaching responses.
 *
 * Returns one CoachingAgent per active employee. Employees who appear in
 * performance results get their scores; those who don't (no calls yet)
 * still appear with avgScore=null and brightness mid-ramp.
 *
 * Industry-agnostic — no assumptions about role names or call types. Works
 * the same for a dental practice, contact center, or law firm.
 */
export function agentsToCoachingSystems(
  employees: EmployeeLike[],
  performers: PerformerLike[],
  sessions: CoachingSessionLike[],
  callsWithDetails: Array<{
    employeeId?: string | null;
    analysis?: { flags?: unknown } | null;
  }>,
): CoachingAgent[] {
  const performerById = new Map(performers.map((p) => [p.id, p]));
  // Active session = anything not completed/dismissed.
  const activeByEmployee = new Set(
    sessions
      .filter((s) => s.status !== "completed" && s.status !== "dismissed")
      .map((s) => s.employeeId)
      .filter((id): id is string => typeof id === "string"),
  );
  // Flag scan — derive coaching/exceptional booleans without re-fetching.
  const flagsByEmployee = new Map<string, { flagged: boolean; exceptional: boolean }>();
  for (const c of callsWithDetails) {
    if (!c.employeeId) continue;
    const flags = Array.isArray(c.analysis?.flags) ? (c.analysis.flags as string[]) : [];
    if (flags.length === 0) continue;
    const entry = flagsByEmployee.get(c.employeeId) || { flagged: false, exceptional: false };
    for (const f of flags) {
      if (f === "low_score" || f.startsWith("agent_misconduct")) entry.flagged = true;
      if (f === "exceptional_call") entry.exceptional = true;
    }
    flagsByEmployee.set(c.employeeId, entry);
  }

  return employees
    .filter((e) => e.status !== "Inactive")
    .map((emp) => {
      const perf = performerById.get(emp.id);
      const avgScore = perf?.avgPerformanceScore ?? null;
      const brightness =
        avgScore === null || avgScore === undefined
          ? 0.5
          : Math.max(0.05, Math.min(1, avgScore / 10));
      const flagData = flagsByEmployee.get(emp.id) || { flagged: false, exceptional: false };
      return {
        id: emp.id,
        name: emp.name,
        role: emp.role ?? perf?.role ?? null,
        brightness,
        avgScore,
        callCount: perf?.totalCalls ?? 0,
        hasActiveSession: activeByEmployee.has(emp.id),
        flagged: flagData.flagged,
        exceptional: flagData.exceptional,
      };
    })
    .sort((a, b) => {
      // Brightest first — front-load the team's anchors.
      if (b.brightness !== a.brightness) return b.brightness - a.brightness;
      return a.name.localeCompare(b.name);
    });
}

// ─── Galaxy: map day rows to spiral positions ────────────────────────────

/**
 * Position each day on a logarithmic spiral, innermost at day 1, outermost
 * at the last day of the month. Inspired by `directions/orrery-galaxy.jsx`.
 *
 * Brightness comes from closeRate (deeper cyan = more wins). Days without
 * scored calls (closeRate null) get a mid-ramp brightness so they're still
 * visible but read as "we don't know yet". Weekends are dimmed via the
 * `weekend` flag (Galaxy viz uses this to draw at 50% opacity).
 *
 * The `anchor` flag highlights today's planet when the input month matches
 * the current month. Other months don't get an anchor.
 */
export function dayBucketsToGalaxy(
  rows: GalaxyDayRow[],
  options: { now?: Date } = {},
): GalaxyDay[] {
  if (rows.length === 0) return [];
  const now = options.now || new Date();
  const todayKey = now.toISOString().slice(0, 10);

  // Sort by date ascending (the endpoint already sorts, but be defensive).
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  const total = sorted.length;

  return sorted.map((row, i) => {
    // Spiral: angle increases by ~108° per step (golden-ish), radius grows
    // logarithmically so inner days are tightly packed and outer days spread.
    const t = i / Math.max(total - 1, 1);
    const angle = i * 1.88; // ~108° per step in radians
    const radius = 8 + Math.log(1 + t * 9) * 12;
    const px = Math.cos(angle) * radius;
    const py = Math.sin(angle) * radius * TILT;

    // Size: log of call count, clamped to [0.6, 2.6].
    const sz = row.calls === 0 ? 0.4 : Math.max(0.6, Math.min(2.6, 0.6 + Math.log10(row.calls + 1) * 1.4));

    // Brightness from closeRate. Null → 0.45 (mid-low — readable, but not
    // claiming a strong outcome).
    const br =
      row.closeRate === null
        ? 0.45
        : Math.max(0.05, Math.min(1, row.closeRate));

    const d = new Date(`${row.date}T00:00:00Z`);
    const dow = d.getUTCDay(); // 0 = Sunday, 6 = Saturday
    const weekend = dow === 0 || dow === 6;
    const day = parseInt(row.date.slice(8, 10), 10);

    return {
      day,
      date: row.date,
      calls: row.calls,
      closeRate: row.closeRate,
      px,
      py,
      sz,
      br,
      weekend,
      anchor: row.date === todayKey,
    };
  });
}

// ─── Constellations: map clusters to pattern visualizations ──────────────

/** Maximum nodes per constellation. Keeps the viz readable. */
const MAX_CONSTELLATION_NODES = 6;

type ClusterLike = {
  id: string;
  label: string;
  topics?: unknown;
  callCount?: number;
  callIds?: unknown;
  avgScore?: number | null;
  trend?: string;
  recentCallIds?: unknown;
};

/**
 * Map TopicCluster[] (from /api/insights/clusters) to Constellation[] (the
 * shape the viz needs).
 *
 * Algorithm:
 *   1. Pick up to MAX_CONSTELLATION_NODES topics per cluster, weighted by
 *      cluster.callCount and the topic's order (first topic = primary).
 *   2. Connect each node to the primary node ("hub-and-spoke" baseline),
 *      with thinner edges between secondary nodes that co-occur often.
 *   3. Position nodes in a constellation layout — hub at center, spokes
 *      arranged on a circle.
 *   4. Color from trend: rising → bright, stable → warm, declining → amber.
 *   5. Stat line: human-readable summary of trend + count.
 *
 * Industry-agnostic — topic terms come from the org's own analysis output;
 * nothing dental-specific is assumed.
 */
export function patternsToConstellations(clusters: ClusterLike[]): Constellation[] {
  return clusters
    .filter((c) => c && c.id && Array.isArray(c.topics))
    .map((cluster) => {
      const topics = (cluster.topics as unknown[]).filter(
        (t): t is string => typeof t === "string" && t.trim().length > 0,
      );
      const nodes = topicsToNodes(topics);
      const edges = nodesToEdges(nodes);

      const trend: "rising" | "stable" | "declining" =
        cluster.trend === "rising" || cluster.trend === "declining" ? cluster.trend : "stable";
      const color: PatternColor =
        trend === "rising" ? "bright" : trend === "declining" ? "amber" : "warm";

      const occurrences = typeof cluster.callCount === "number" ? cluster.callCount : 0;
      const trendVerb =
        trend === "rising"
          ? "Rising"
          : trend === "declining"
            ? "Declining"
            : "Stable";
      const stat = `${trendVerb} · ${occurrences} ${occurrences === 1 ? "call" : "calls"}`;

      const callIds = Array.isArray(cluster.callIds) ? (cluster.callIds as string[]) : [];

      return {
        id: cluster.id,
        label: cluster.label,
        stat,
        trend,
        color,
        occurrences,
        callIds,
        nodes,
        edges,
      };
    });
}

function topicsToNodes(topics: string[]): ConstellationNode[] {
  if (topics.length === 0) return [];
  const trimmed = topics.slice(0, MAX_CONSTELLATION_NODES);
  // First topic = hub at center; remaining laid out on a ring.
  return trimmed.map((topic, i) => {
    const key = topic.toLowerCase().replace(/\s+/g, "_");
    if (i === 0) {
      return { key, label: topic, weight: 1, sz: 1.6, px: 0, py: 0 };
    }
    const angle = ((i - 1) / Math.max(trimmed.length - 1, 1)) * Math.PI * 2;
    const radius = 9;
    return {
      key,
      label: topic,
      weight: 1 - i / trimmed.length,
      sz: 1.0,
      px: Math.cos(angle) * radius,
      py: Math.sin(angle) * radius * TILT,
    };
  });
}

function nodesToEdges(nodes: ConstellationNode[]): ConstellationEdge[] {
  if (nodes.length < 2) return [];
  const hub = nodes[0];
  // Hub-and-spoke: every non-hub node connects to the hub.
  const edges: ConstellationEdge[] = [];
  for (let i = 1; i < nodes.length; i++) {
    edges.push({ fromKey: hub.key, toKey: nodes[i].key, weight: 0.8 - i * 0.08 });
  }
  // Secondary ring edges between adjacent non-hub nodes — thin, suggest
  // co-occurrence. Cycles around so the last node connects back to first.
  if (nodes.length >= 4) {
    for (let i = 1; i < nodes.length; i++) {
      const j = i === nodes.length - 1 ? 1 : i + 1;
      edges.push({ fromKey: nodes[i].key, toKey: nodes[j].key, weight: 0.25 });
    }
  }
  return edges;
}

// Re-export TILT so the dashboard doesn't need a second orrery import.
export { TILT };
