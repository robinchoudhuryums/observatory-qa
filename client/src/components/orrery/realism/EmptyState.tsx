/**
 * Empty state — used when a screen has nothing meaningful to render yet.
 * Composes a decorative glyph + optional Ory attribution + a title and body,
 * with an optional action button. Uses italic Instrument Serif for the title
 * to keep the brand voice even when there's no data.
 */
import type { ReactNode } from "react";
import type { Theme } from "../theme";
import { EmptyGlyph } from "./EmptyGlyph";

type Props = {
  t: Theme;
  glyph?: "flat-orbit" | "no-constellation" | "thin-data" | "cloud";
  title: ReactNode;
  body: ReactNode;
  action?: ReactNode;
  /** Optional Ory attribution above the title — e.g. "noticing nothing yet". */
  owlVerb?: string | null;
};

export function EmptyState({ t, glyph = "flat-orbit", title, body, action = null, owlVerb = null }: Props) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        padding: "40px 24px",
        textAlign: "center",
        color: t.ink,
        fontFamily: "'Inter', sans-serif",
      }}
    >
      <EmptyGlyph t={t} kind={glyph} />
      {owlVerb && (
        <span
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 9.5,
            color: t.inkMute,
            letterSpacing: "0.14em",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          ◇ ORY · {owlVerb}
        </span>
      )}
      <div
        style={{
          fontFamily: "'Instrument Serif', Georgia, serif",
          fontStyle: "italic",
          fontSize: 22,
          lineHeight: 1.2,
          color: t.ink,
          maxWidth: 380,
        }}
      >
        {title}
      </div>
      <div style={{ fontSize: 13, lineHeight: 1.55, color: t.inkSoft, maxWidth: 380 }}>{body}</div>
      {action}
    </div>
  );
}
