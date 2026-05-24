/**
 * Call arc — orbital visualization of a single call's moments. Points
 * are placed along a semicircular arc from -π/2 (greeting) to +π/2
 * (close), colored by tone (warm/cool/amber/green/neutral).
 *
 * Hover shows the moment label + time; click scrubs the audio (the
 * parent passes `onSelectMoment` which talks to the audio element).
 *
 * Industry-agnostic — moments come from the adapter, not hardcoded.
 * Empty calls (no moments) render the arc alone with no points, with
 * a copy line about transcript pending.
 */
import { useMemo } from "react";
import type { Theme } from "../theme";
import { brightToColor, TILT } from "../projection";
import { OrreryStarfield } from "../OrreryStarfield";
import type { Moment } from "@/lib/orrery-adapters";

type Props = {
  t: Theme;
  moments: Moment[];
  /** Total call duration in seconds — used for arc time labels. */
  durationSec: number;
  /** Currently selected moment id (drives the highlighted point). */
  selectedId?: string | null;
  onSelectMoment?: (moment: Moment | null) => void;
};

const ARC_RADIUS = 22;
const ARC_START_ANGLE = -Math.PI * 0.95; // upper-left
const ARC_END_ANGLE = -Math.PI * 0.05; // upper-right

export function CallArc({ t, moments, durationSec, selectedId = null, onSelectMoment }: Props) {
  const points = useMemo(() => {
    if (moments.length === 0) return [];
    const denom = durationSec > 0 ? durationSec : Math.max(...moments.map((m) => m.time), 1);
    return moments.map((m) => {
      // Map time → arc angle (greeting at start angle, close at end).
      const t01 = denom > 0 ? Math.min(1, Math.max(0, m.time / denom)) : 0;
      const ang = ARC_START_ANGLE + (ARC_END_ANGLE - ARC_START_ANGLE) * t01;
      const px = Math.cos(ang) * ARC_RADIUS;
      const py = Math.sin(ang) * ARC_RADIUS * TILT;
      return { moment: m, px, py, ang };
    });
  }, [moments, durationSec]);

  // Color a moment by tone, mapping celestial palette names to theme values.
  const colorFor = (m: Moment): string => {
    switch (m.tone) {
      case "warm":
        return t.warm;
      case "cool":
        return t.cool;
      case "amber":
        return t.amber;
      case "green":
        return t.green;
      case "neutral":
      default:
        return brightToColor(m.brightness, t);
    }
  };

  return (
    <svg
      viewBox="-30 -20 60 32"
      preserveAspectRatio="xMidYMid meet"
      style={{
        width: "100%",
        height: "auto",
        display: "block",
        background: t.bg,
        borderRadius: 14,
      }}
      role="img"
      aria-label={`Call arc with ${moments.length} moments`}
    >
      <OrreryStarfield t={t} count={40} spread={[28, 14]} />

      {/* The arc itself — a dashed half-ellipse. */}
      <path
        d={arcPath(ARC_RADIUS, TILT, ARC_START_ANGLE, ARC_END_ANGLE)}
        fill="none"
        stroke={t.orbit}
        strokeWidth="0.2"
        strokeDasharray="0.6 0.5"
      />

      {/* Greeting / Close anchor labels. */}
      <text
        x={Math.cos(ARC_START_ANGLE) * (ARC_RADIUS + 2)}
        y={Math.sin(ARC_START_ANGLE) * (ARC_RADIUS + 2) * TILT}
        textAnchor="end"
        fontFamily="'JetBrains Mono', monospace"
        fontSize="1.2"
        fill={t.inkMute}
        letterSpacing="0.12"
      >
        START · 0:00
      </text>
      <text
        x={Math.cos(ARC_END_ANGLE) * (ARC_RADIUS + 2)}
        y={Math.sin(ARC_END_ANGLE) * (ARC_RADIUS + 2) * TILT}
        textAnchor="start"
        fontFamily="'JetBrains Mono', monospace"
        fontSize="1.2"
        fill={t.inkMute}
        letterSpacing="0.12"
      >
        END · {formatTime(durationSec)}
      </text>

      {/* Moments. */}
      {points.map(({ moment: m, px, py }) => {
        const selected = m.id === selectedId;
        const sz = selected ? 1.4 : m.flagged ? 1.1 : 0.9;
        const color = colorFor(m);
        return (
          <g
            key={m.id}
            style={{ cursor: onSelectMoment ? "pointer" : "default" }}
            onClick={() => onSelectMoment?.(selected ? null : m)}
            onKeyDown={
              onSelectMoment
                ? (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelectMoment(selected ? null : m);
                    }
                  }
                : undefined
            }
            role={onSelectMoment ? "button" : undefined}
            tabIndex={onSelectMoment ? 0 : undefined}
            aria-label={`Moment: ${m.label} at ${formatTime(m.time)}`}
          >
            {/* halo */}
            <circle cx={px} cy={py} r={sz * 2.4} fill={color} opacity={selected ? 0.3 : 0.18} />
            {/* dot */}
            <circle cx={px} cy={py} r={sz} fill={color} opacity={0.95} />
            {/* selected ring */}
            {selected && <circle cx={px} cy={py} r={sz + 0.8} fill="none" stroke={t.bright} strokeWidth="0.2" />}
            {/* label */}
            <text
              x={px}
              y={py + sz + 1.8}
              textAnchor="middle"
              fontFamily="'Inter', sans-serif"
              fontSize="1.3"
              fill={selected ? t.ink : t.inkSoft}
              fontStyle="italic"
            >
              {truncate(m.label, 22)}
            </text>
            <text
              x={px}
              y={py + sz + 3.2}
              textAnchor="middle"
              fontFamily="'JetBrains Mono', monospace"
              fontSize="0.95"
              fill={t.inkMute}
              letterSpacing="0.1"
            >
              {formatTime(m.time)}
            </text>
          </g>
        );
      })}

      {moments.length === 0 && (
        <text
          x="0"
          y="0"
          textAnchor="middle"
          fontFamily="'Instrument Serif', Georgia, serif"
          fontSize="2.4"
          fontStyle="italic"
          fill={t.inkSoft}
        >
          Moments will appear here once the transcript completes.
        </text>
      )}
    </svg>
  );
}

function arcPath(r: number, tilt: number, startAng: number, endAng: number): string {
  const x1 = Math.cos(startAng) * r;
  const y1 = Math.sin(startAng) * r * tilt;
  const x2 = Math.cos(endAng) * r;
  const y2 = Math.sin(endAng) * r * tilt;
  const largeArc = Math.abs(endAng - startAng) > Math.PI ? 1 : 0;
  return `M ${x1} ${y1} A ${r} ${r * tilt} 0 ${largeArc} 1 ${x2} ${y2}`;
}

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const total = Math.floor(sec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
