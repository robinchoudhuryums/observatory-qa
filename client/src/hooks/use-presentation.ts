import { useOrganization } from "./use-organization";
import type { IndustryType } from "@shared/schema";

/**
 * Presentation mode controls whether the UI uses the celestial metaphor
 * (observatory mode — planets, orbits, "the day in orbit") or flat charts
 * with plain labels (clinical mode — swimlanes, sankeys, "dashboard / trends").
 *
 * Resolution order:
 *   1. Explicit org.settings.presentation override.
 *   2. Industry-type derived default: healthcare/dental/medical/behavioral_health/
 *      veterinary → clinical; everything else → observatory.
 *   3. Final fallback: "observatory".
 *
 * The hook returns the resolved mode + a lexicon helper that translates
 * metaphor labels ("Atlas") to plain ones ("Dashboard") in clinical mode.
 * Labels not in the lexicon pass through unchanged.
 */
export type Presentation = "observatory" | "clinical";

const CLINICAL_INDUSTRIES: IndustryType[] = [
  "healthcare",
  "dental",
  "behavioral_health",
  "veterinary",
];

const CLINICAL_LEXICON: Record<string, string> = {
  Atlas: "Dashboard",
  ATLAS: "DASHBOARD",
  Galaxy: "History",
  GALAXY: "HISTORY",
  Patterns: "Trends",
  PATTERNS: "TRENDS",
  planet: "cluster",
  Planet: "Cluster",
  planets: "clusters",
  Planets: "Clusters",
  orbit: "group",
  Orbit: "Group",
  orbits: "groups",
  Orbits: "Groups",
  moment: "segment",
  Moment: "Segment",
  moments: "segments",
  Moments: "Segments",
  Constellation: "Pattern",
  constellation: "pattern",
};

export function usePresentation(): {
  presentation: Presentation;
  isClinical: boolean;
  /** Translate a label according to the active presentation mode. */
  lex: (key: string) => string;
} {
  const { data: org } = useOrganization();

  const explicit = org?.settings?.presentation as Presentation | undefined;
  const industry = (org?.settings?.industryType as IndustryType | undefined) || undefined;

  let presentation: Presentation;
  if (explicit === "observatory" || explicit === "clinical") {
    presentation = explicit;
  } else if (industry && CLINICAL_INDUSTRIES.includes(industry)) {
    presentation = "clinical";
  } else {
    presentation = "observatory";
  }

  const isClinical = presentation === "clinical";

  const lex = (key: string): string => {
    if (!isClinical) return key;
    return CLINICAL_LEXICON[key] ?? key;
  };

  return { presentation, isClinical, lex };
}
