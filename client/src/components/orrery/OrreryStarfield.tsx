/**
 * Procedural starfield background. 60 stars scattered via deterministic sine
 * functions so layout is stable across renders. Star opacity scales with the
 * theme — light mode wants subtle stars (almost invisible), dark mode wants
 * a faint constellation.
 */
import type { Theme } from "./theme";

type Props = {
  t: Theme;
  count?: number;
  /** [xSpread, ySpread] in viewBox units; defaults match the standard ±50 viewBox. */
  spread?: [number, number];
};

export function OrreryStarfield({ t, count = 60, spread = [56, 28] }: Props) {
  return (
    <g>
      {Array.from({ length: count }).map((_, i) => {
        const x = Math.sin(i * 7.13 + 0.5) * spread[0];
        const y = Math.cos(i * 4.91 + 1.1) * spread[1];
        const r = 0.12 + (Math.sin(i * 3.7) + 1) * 0.1;
        const op = t.starfieldOpacity * (0.5 + (Math.cos(i * 2.3) + 1) * 0.5);
        return <circle key={i} cx={x} cy={y} r={r} fill={t.starfield} opacity={op} />;
      })}
    </g>
  );
}
