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

// Re-export TILT so the dashboard doesn't need a second orrery import.
export { TILT };
