/**
 * Sticky top bar used by every full/quiet-tier orrery screen. Composes:
 *   - Brand lockup (owl mark + wordmark) on the left, clickable to navigate home
 *   - Version pill (mono, "v2 · MODEL OF THE PRACTICE")
 *   - Nav links (Atlas / Calls / Patterns / Galaxy / Reports) in the center
 *   - Optional extras + view label on the right
 *
 * Clinical presentation mode (`presentation="clinical"`):
 *   - Lexicon swap: Atlas → Dashboard, Patterns → Trends, etc. via clinicalLex().
 *   - Hides the "Galaxy" tab (no clinical equivalent yet — a segment view will
 *     replace it in a later pass).
 *
 * The component is presentation-only; routing is handled by the consumer via
 * the `onNavigate` callback. `view` is the uppercase label shown in the view
 * pill on the right (e.g. "ATLAS", "PATTERNS", "COACHING").
 */
import type { ReactNode } from "react";
import type { Theme } from "./theme";
import { ObservatoryOwlMark } from "./owl/ObservatoryOwlMark";
import { ObservatoryWordmark } from "./owl/ObservatoryWordmark";

export type NavKey = "Atlas" | "Calls" | "Patterns" | "Galaxy" | "Reports";

type Props = {
  t: Theme;
  view?: string;
  activeNav?: NavKey;
  extra?: ReactNode;
  onNavigate?: ((destination: string) => void) | null;
  presentation?: "observatory" | "clinical";
  /**
   * Optional lexicon override. When in clinical mode the prototype calls
   * `window.clinicalLex(label, 'clinical')` to translate metaphor labels to
   * plain ones. Production wires this up via a `usePresentation()` hook;
   * for now we expose it as a prop so the top bar stays pure.
   */
  lexicon?: (key: string) => string;
};

const NAV_KEYS: NavKey[] = ["Atlas", "Calls", "Patterns", "Galaxy", "Reports"];
const NAV_MAP: Record<NavKey, string | null> = {
  Atlas: "dashboard",
  Calls: "planet",
  Patterns: "patterns",
  Galaxy: "galaxy",
  Reports: null,
};

export function OrreryTopBar({
  t,
  view = "OBSERVATORY",
  activeNav = "Atlas",
  extra = null,
  onNavigate = null,
  presentation = "observatory",
  lexicon,
}: Props) {
  const labelOf = (n: NavKey): string => {
    if (presentation === "clinical" && lexicon) return lexicon(n);
    return n;
  };
  const visibleNavs = presentation === "clinical" ? NAV_KEYS.filter((n) => n !== "Galaxy") : NAV_KEYS;
  const viewLabel = presentation === "clinical" && view === "ATLAS" ? "DASHBOARD" : view;
  const lockupCursor = onNavigate ? "pointer" : "default";

  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "16px 28px",
        borderBottom: `0.5px solid ${t.panelBorder}`,
      }}
    >
      <div
        style={{ display: "flex", alignItems: "center", gap: 12, cursor: lockupCursor }}
        onClick={() => onNavigate && onNavigate("dashboard")}
      >
        <ObservatoryOwlMark size={26} color={t.logoTint || t.ink} />
        <ObservatoryWordmark height={17} color={t.logoTint || t.ink} style={{ marginTop: 1 }} />
        <span
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 9.5,
            color: t.inkMute,
            letterSpacing: "0.16em",
            marginLeft: 8,
          }}
        >
          v2 · MODEL OF THE PRACTICE
        </span>
      </div>
      <div style={{ display: "flex", gap: 22, fontSize: 12.5, color: t.inkSoft }}>
        {visibleNavs.map((n) => {
          const dest = NAV_MAP[n];
          const clickable = onNavigate && dest;
          return (
            <span
              key={n}
              onClick={() => {
                if (clickable) onNavigate(dest);
              }}
              style={{
                color: n === activeNav ? t.ink : t.inkSoft,
                fontWeight: n === activeNav ? 500 : 400,
                cursor: clickable ? "pointer" : "default",
                transition: "color 150ms",
              }}
            >
              {labelOf(n)}
            </span>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        {extra}
        <div
          style={{
            padding: "5px 10px",
            background: `${t.bright}18`,
            borderRadius: 6,
            fontSize: 10.5,
            color: t.bright,
            fontFamily: "'JetBrains Mono', monospace",
            letterSpacing: "0.1em",
          }}
        >
          VIEW · {viewLabel}
        </div>
      </div>
    </div>
  );
}
