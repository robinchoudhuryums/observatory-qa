/**
 * Skeleton planet — rendered in-place of a real planet that's still being
 * processed. A soft pulsing disc with a rotating dashed ring. Pure SVG SMIL
 * animations so it works without any JS scheduler.
 *
 * Coordinates are in the parent SVG's viewBox space; consumers pass `cx/cy`
 * at the projected position the real planet would occupy.
 */
import type { Theme } from "../theme";

type Props = {
  cx: number;
  cy: number;
  /** Radius in viewBox units. Real planets are typically 1.4–3.0. */
  r?: number;
  t: Theme;
};

export function LoadingPlanet({ cx, cy, r = 1.6, t }: Props) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill={t.panelBorder} opacity="0.35">
        <animate attributeName="opacity" values="0.18;0.42;0.18" dur="1.6s" repeatCount="indefinite" />
      </circle>
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke={t.inkMute}
        strokeWidth="0.12"
        strokeDasharray="1 1.5"
        opacity="0.7"
      >
        <animateTransform
          attributeName="transform"
          type="rotate"
          from="0"
          to="360"
          dur="3s"
          repeatCount="indefinite"
        />
      </circle>
    </g>
  );
}
