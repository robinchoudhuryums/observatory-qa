/**
 * Dashed ellipse representing one orbital ring. Four tick marks at cardinal
 * points anchor the eye and double as drop targets for "where would this
 * planet land" interactions. Optional label sits to the right (or left) of
 * the ring at the equator.
 */
import type { Theme } from "./theme";
import { TILT } from "./projection";

type Props = {
  /** Ring radius in viewBox units. */
  r: number;
  t: Theme;
  dashed?: boolean;
  label?: string | null;
  anchor?: "left" | "right";
};

export function OrreryOrbitRing({ r, t, dashed = true, label = null, anchor = "right" }: Props) {
  return (
    <g>
      <ellipse
        cx="0"
        cy="0"
        rx={r}
        ry={r * TILT}
        fill="none"
        stroke={t.orbit}
        strokeWidth="0.15"
        strokeDasharray={dashed ? "0.6 0.5" : "0"}
      />
      {[0, Math.PI / 2, Math.PI, Math.PI * 1.5].map((ang, k) => {
        const x = Math.cos(ang) * r;
        const y = Math.sin(ang) * r * TILT;
        return <circle key={k} cx={x} cy={y} r="0.18" fill={t.orbitTick} />;
      })}
      {label && (
        <text
          x={anchor === "right" ? r + 1.5 : -r - 1.5}
          y={0.4}
          textAnchor={anchor === "right" ? "start" : "end"}
          fontFamily="'JetBrains Mono', monospace"
          fontSize="1.4"
          fill={t.inkMute}
          letterSpacing="0.1"
        >
          {label}
        </text>
      )}
    </g>
  );
}
