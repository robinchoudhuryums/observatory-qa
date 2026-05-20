/**
 * Atlas lens definitions.
 *
 * A lens controls how calls are grouped into planets and which orbit each
 * planet lands on. All lenses ship in v1; they're industry-agnostic so the
 * Atlas reads sensibly for dental, medical, behavioral health, contact center,
 * legal, financial, and any other industry the codebase supports.
 *
 * Lens choice does NOT change the underlying call data — only how it's
 * projected onto the orrery. Switching lenses is a client-side recompute.
 *
 *   type      — group by Call.callCategory. Most signal for ops managers.
 *   recency   — group by hour-of-day bucket. Shows when the team is busy.
 *   sentiment — group by sentiment outcome. Surfaces overall call quality.
 *   agent     — group by employee. Helps spot per-agent volume distribution.
 *
 * The 4 orbit rings are fixed (`14, 24, 34, 44` in viewBox units). Each lens
 * defines an `assignOrbit` function that returns an orbit index 0-3 given a
 * group key and an ordered list of all group keys (so volume-rank-based
 * lenses can put the top-volume group on the innermost orbit).
 *
 * Group keys can be any string — the adapter normalizes display labels via
 * `labelFor()`. Categories that overflow the 12-planet cap collapse into a
 * single "Other" planet on the outermost orbit; this keeps the orrery
 * readable when an org has 30+ call categories.
 */
import type { CallWithDetails } from "@shared/schema";

export type LensId = "type" | "recency" | "sentiment" | "agent";

/**
 * Fixed orbit radii (viewBox units). The Atlas hero SVG uses a ±50 viewBox,
 * so these stay well inside the visible area with room for labels.
 */
export const ORBIT_RADII = [14, 24, 34, 44] as const;
export type OrbitIndex = 0 | 1 | 2 | 3;

export type Lens = {
  id: LensId;
  label: string;
  /** One-line description shown in the lens switcher tooltip. */
  description: string;
  /**
   * Group key for a single call. Returning `null` excludes the call from
   * the lens (e.g., recency excludes calls without uploadedAt).
   */
  keyFor: (call: CallWithDetails) => string | null;
  /**
   * Display label for a group key. Lens may apply formatting (e.g. recency
   * turns "morning" into "Morning (6am–noon)"). Default is the key itself.
   */
  labelFor: (key: string, sampleCall?: CallWithDetails) => string;
  /**
   * Assigns a group to one of 4 orbits. `volumeRank` is the group's 0-indexed
   * rank by total call count (0 = highest volume).
   */
  assignOrbit: (params: { key: string; volumeRank: number; totalGroups: number }) => OrbitIndex;
};

/**
 * Distribute groups across 4 orbits by volume rank. Top-volume group lands
 * on the innermost orbit (closest to the sun, most prominent). Used by the
 * type and agent lenses where there's no natural ordering.
 */
function distributeByVolume({ volumeRank, totalGroups }: { volumeRank: number; totalGroups: number }): OrbitIndex {
  // Spread the groups roughly evenly across the 4 orbits, but cap so the top
  // 3 always go on the innermost orbit (most prominent slots).
  if (totalGroups <= 4) return Math.min(volumeRank, 3) as OrbitIndex;
  const perOrbit = Math.ceil(totalGroups / 4);
  return Math.min(Math.floor(volumeRank / perOrbit), 3) as OrbitIndex;
}

/** Hour-of-day bucket for the recency lens. Operates on the user's local time. */
function recencyBucket(date: Date): string {
  const h = date.getHours();
  if (h >= 6 && h < 12) return "morning";
  if (h >= 12 && h < 17) return "afternoon";
  if (h >= 17 && h < 22) return "evening";
  return "off-hours";
}

const RECENCY_LABELS: Record<string, string> = {
  morning: "Morning · 6am–noon",
  afternoon: "Afternoon · noon–5pm",
  evening: "Evening · 5pm–10pm",
  "off-hours": "Off-hours · 10pm–6am",
};
// Recency uses fixed orbits — morning innermost (workday peak), off-hours outermost.
const RECENCY_ORBIT_BY_BUCKET: Record<string, OrbitIndex> = {
  morning: 0,
  afternoon: 1,
  evening: 2,
  "off-hours": 3,
};

const SENTIMENT_LABELS: Record<string, string> = {
  positive: "Positive",
  neutral: "Neutral",
  negative: "Negative",
  unknown: "Unscored",
};
// Sentiment uses fixed orbits — positive innermost (good outcomes drawn close
// to the sun), negative far out. This is a value judgment but it matches the
// celestial "brightness = good" metaphor.
const SENTIMENT_ORBIT_BY_BUCKET: Record<string, OrbitIndex> = {
  positive: 0,
  neutral: 1,
  negative: 2,
  unknown: 3,
};

export const LENSES: Record<LensId, Lens> = {
  type: {
    id: "type",
    label: "By type",
    description: "Group calls by category — most signal for ops",
    keyFor: (call) => call.callCategory || "uncategorized",
    labelFor: (key) => {
      if (key === "uncategorized") return "Uncategorized";
      // The category is a free-form org-defined string. We'd ideally look up
      // CALL_CATEGORIES for a friendly label, but org-custom categories won't
      // be in that list — falling back to the raw key is correct.
      return formatKey(key);
    },
    assignOrbit: distributeByVolume,
  },
  recency: {
    id: "recency",
    label: "By time",
    description: "Group calls by hour of day — shows when the team is busy",
    keyFor: (call) => {
      if (!call.uploadedAt) return null;
      const d = new Date(call.uploadedAt);
      if (Number.isNaN(d.getTime())) return null;
      return recencyBucket(d);
    },
    labelFor: (key) => RECENCY_LABELS[key] || formatKey(key),
    assignOrbit: ({ key }) => RECENCY_ORBIT_BY_BUCKET[key] ?? 3,
  },
  sentiment: {
    id: "sentiment",
    label: "By sentiment",
    description: "Group calls by sentiment outcome",
    keyFor: (call) => call.sentiment?.overallSentiment?.toLowerCase() || "unknown",
    labelFor: (key) => SENTIMENT_LABELS[key] || formatKey(key),
    assignOrbit: ({ key }) => SENTIMENT_ORBIT_BY_BUCKET[key] ?? 3,
  },
  agent: {
    id: "agent",
    label: "By agent",
    description: "Group calls by employee — see per-agent distribution",
    keyFor: (call) => call.employee?.id || call.employeeId || "unassigned",
    labelFor: (key, sample) => {
      if (key === "unassigned") return "Unassigned";
      return sample?.employee?.name || formatKey(key);
    },
    assignOrbit: distributeByVolume,
  },
};

/** Convert "dental_treatment" → "Dental treatment", "morning" → "Morning". */
function formatKey(key: string): string {
  return key.replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
