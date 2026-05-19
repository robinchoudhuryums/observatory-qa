/**
 * The center "star" — the sun at the origin of the orrery. A radial gradient
 * disc with a bright core, soft glow, and crosshair lines suggesting an
 * observation reticle. Pure SVG, no animation; sized in viewBox units so it
 * inherits the parent SVG's coordinate space (orrery screens use a ±50-unit
 * viewBox).
 */
import type { Theme } from "./theme";
import { TILT } from "./projection";

type Props = {
  t: Theme;
  /** Stable seed so multiple stars on a page get unique gradient IDs. */
  idSeed?: string;
};

export function OrreryCenterStar({ t, idSeed = "a" }: Props) {
  const gradId = `orr-star-${idSeed}`;
  return (
    <g>
      <defs>
        <radialGradient id={gradId} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor={t.starCore} stopOpacity="1" />
          <stop offset="35%" stopColor={t.starGlow1} stopOpacity="0.85" />
          <stop offset="100%" stopColor={t.starOuter} stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="0" cy="0" r="6" fill={`url(#${gradId})`} />
      <circle cx="0" cy="0" r="1.6" fill={t.starCore} stroke={t.bright} strokeWidth="0.2" />
      {[0, Math.PI / 2].map((ang, i) => (
        <line
          key={i}
          x1={Math.cos(ang) * 3}
          y1={Math.sin(ang) * 3 * TILT}
          x2={Math.cos(ang) * -3}
          y2={Math.sin(ang) * -3 * TILT}
          stroke={t.bright}
          strokeWidth="0.15"
          opacity="0.5"
        />
      ))}
    </g>
  );
}
