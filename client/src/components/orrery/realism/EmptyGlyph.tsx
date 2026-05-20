/**
 * Decorative empty-state glyph variants. Each is a small SVG illustration
 * pegged to the celestial palette, used by `EmptyState` to give a no-data
 * screen visual character without resorting to a generic icon.
 *
 *   flat-orbit     — single orbit, no planets. "The day was quiet."
 *   no-constellation — three disconnected dots. Patterns not yet formed.
 *   thin-data      — orbit + one small planet. "We have a little, not much."
 *   cloud          — soft concentric rings. Generic "nothing here yet."
 */
import type { Theme } from "../theme";

type Props = {
  t: Theme;
  kind?: "flat-orbit" | "no-constellation" | "thin-data" | "cloud";
};

export function EmptyGlyph({ t, kind = "flat-orbit" }: Props) {
  const stroke = t.orbit;
  if (kind === "flat-orbit") {
    return (
      <svg width="120" height="60" viewBox="-30 -15 60 30" style={{ opacity: 0.7 }}>
        <ellipse cx="0" cy="0" rx="22" ry="9" fill="none" stroke={stroke} strokeWidth="0.4" strokeDasharray="0.8 0.8" />
        <circle cx="0" cy="0" r="2" fill={t.starGlow1} opacity="0.5" />
        <circle cx="0" cy="0" r="0.8" fill={t.starCore} />
      </svg>
    );
  }
  if (kind === "no-constellation") {
    return (
      <svg width="120" height="60" viewBox="-30 -15 60 30" style={{ opacity: 0.7 }}>
        <circle cx="-14" cy="-4" r="1.2" fill={t.cool} />
        <circle cx="6" cy="3" r="1.2" fill={t.cool} />
        <circle cx="16" cy="-6" r="1.2" fill={t.cool} />
      </svg>
    );
  }
  if (kind === "thin-data") {
    return (
      <svg width="120" height="60" viewBox="-30 -15 60 30" style={{ opacity: 0.7 }}>
        <ellipse cx="0" cy="0" rx="22" ry="9" fill="none" stroke={stroke} strokeWidth="0.3" opacity="0.5" />
        <circle cx="-12" cy="3" r="1.4" fill={t.cool} />
      </svg>
    );
  }
  // cloud
  return (
    <svg width="120" height="60" viewBox="-30 -15 60 30" style={{ opacity: 0.7 }}>
      <circle cx="0" cy="0" r="9" fill="none" stroke={stroke} strokeWidth="0.4" />
      <circle
        cx="0"
        cy="0"
        r="9"
        fill="none"
        stroke={stroke}
        strokeWidth="0.4"
        strokeDasharray="0.6 1.2"
        opacity="0.5"
      />
    </svg>
  );
}
