/**
 * A single planet in the orrery. Composes:
 *   - shadow puddle (cast below the planet, hints at light direction)
 *   - hot/hover glow halo (only when p.hot or hovered)
 *   - optional trajectory arrow (up = green, down = red)
 *   - planet body (filled circle, color from brightness ramp)
 *   - terminator (dark crescent suggesting the lit/unlit boundary)
 *   - highlight (specular bright crescent on the top-left)
 *   - optional ring (Saturn-style hot indicator)
 *   - optional anomaly halo (dashed amber ring for off-pattern data)
 *   - hover ring (thin cyan outline when hovered)
 *
 * Coordinates are in the parent SVG's viewBox space; `px/py/sz` are projected
 * positions and size already computed by the consumer.
 */
import type { CSSProperties } from "react";
import type { Theme } from "./theme";
import { brightToColor, TILT } from "./projection";

export type PlanetData = {
  /** Projected x. */
  px: number;
  /** Projected y. */
  py: number;
  /** Planet radius (viewBox units). */
  sz: number;
  /** Brightness 0–1; maps to color via brightToColor. */
  br: number;
  /** Adds halo + bright ring glow. */
  hot?: boolean;
  /** Dashed amber halo for off-pattern observations. */
  anomaly?: boolean;
};

export type TrajectoryArrow = {
  /** Direction in radians. */
  dir: number;
  /** Green up arrow vs red down arrow. */
  up: boolean;
};

type Props = {
  p: PlanetData;
  t: Theme;
  hovered?: boolean;
  onHover?: () => void;
  onLeave?: () => void;
  onClick?: () => void;
  /** Saturn-style ring overlay (used for "today's anchor" planets). */
  showRing?: boolean;
  /** Dim when in a lens that's hiding this planet. */
  dim?: boolean;
  /** Optional trajectory arrow extending from the planet. */
  trajectory?: TrajectoryArrow | null;
};

export function OrreryPlanet({
  p,
  t,
  hovered = false,
  onHover,
  onLeave,
  onClick,
  showRing = false,
  dim = false,
  trajectory = null,
}: Props) {
  const c = brightToColor(p.br, t);
  const style: CSSProperties = {
    cursor: onClick ? "pointer" : "default",
    opacity: dim ? 0.32 : 1,
    transition: "opacity 200ms",
  };
  return (
    <g onMouseEnter={onHover} onMouseLeave={onLeave} onClick={onClick} style={style}>
      {/* shadow puddle */}
      <ellipse
        cx={p.px}
        cy={p.py + p.sz * 0.6}
        rx={p.sz * 0.9}
        ry={p.sz * 0.3}
        fill={t.shadow}
        opacity={t.name === "dark" ? 0.55 : 0.13}
      />
      {/* hot/hovered glow */}
      {(p.hot || hovered) && (
        <circle
          cx={p.px}
          cy={p.py}
          r={p.sz * 2.6}
          fill={t.bright}
          opacity={hovered ? 0.2 : 0.14}
          filter="blur(0.2px)"
        />
      )}
      {/* trajectory arrow */}
      {trajectory &&
        (() => {
          const dx = Math.cos(trajectory.dir) * (p.sz + 0.8);
          const dy = Math.sin(trajectory.dir) * (p.sz + 0.8) * TILT;
          return (
            <g>
              <line
                x1={p.px}
                y1={p.py}
                x2={p.px + dx}
                y2={p.py + dy}
                stroke={trajectory.up ? t.green : t.red}
                strokeWidth="0.2"
                strokeLinecap="round"
              />
              <circle cx={p.px + dx} cy={p.py + dy} r="0.35" fill={trajectory.up ? t.green : t.red} />
            </g>
          );
        })()}
      {/* planet body */}
      <circle cx={p.px} cy={p.py} r={p.sz} fill={c} opacity={dim ? 0.5 : 0.94} />
      {/* highlight (specular crescent) */}
      <ellipse
        cx={p.px - p.sz * 0.3}
        cy={p.py - p.sz * 0.3}
        rx={p.sz * 0.45}
        ry={p.sz * 0.35}
        fill={t.highlight}
        opacity={t.name === "dark" ? 0.35 : 0.55}
      />
      {/* terminator (shadow crescent) */}
      <path
        d={`M ${p.px} ${p.py - p.sz} A ${p.sz} ${p.sz} 0 0 1 ${p.px} ${p.py + p.sz} A ${p.sz * 0.55} ${p.sz} 0 0 1 ${p.px} ${p.py - p.sz} Z`}
        fill={t.name === "dark" ? "#000" : "#0e1228"}
        opacity={t.name === "dark" ? 0.55 : 0.18}
      />
      {/* hot ring */}
      {showRing && (
        <ellipse
          cx={p.px}
          cy={p.py}
          rx={p.sz * 1.7}
          ry={p.sz * 0.65}
          fill="none"
          stroke={t.ringStroke}
          strokeWidth="0.2"
        />
      )}
      {/* anomaly halo */}
      {p.anomaly && (
        <circle
          cx={p.px}
          cy={p.py}
          r={p.sz * 1.5}
          fill="none"
          stroke={t.amber}
          strokeWidth="0.16"
          strokeDasharray="0.4 0.3"
        />
      )}
      {/* hover ring */}
      {hovered && <circle cx={p.px} cy={p.py} r={p.sz + 0.8} fill="none" stroke={t.bright} strokeWidth="0.18" />}
    </g>
  );
}
