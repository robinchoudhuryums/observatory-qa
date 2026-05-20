/**
 * Clinical mode equivalent of CallArc — horizontal time × quality chart.
 * Used when org.settings.presentation === "clinical".
 *
 * Catmull-Rom-smoothed curve through the timeline points, with moment
 * markers as labeled dots. Same data shape as CallArc, different rendering.
 */
import { useMemo } from "react";
import type { Theme } from "../theme";
import type { Moment, ClinicalTimelinePoint } from "@/lib/orrery-adapters";

type Props = {
  t: Theme;
  points: ClinicalTimelinePoint[];
  moments: Moment[];
  durationSec: number;
  selectedId?: string | null;
  onSelectMoment?: (moment: Moment | null) => void;
};

const WIDTH = 100;
const HEIGHT = 32;
const PAD_X = 6;
const PAD_Y = 4;

export function ClinicalCallTimeline({
  t,
  points,
  moments,
  durationSec,
  selectedId = null,
  onSelectMoment,
}: Props) {
  const xFor = (time: number): number => {
    const denom = durationSec || 1;
    return PAD_X + ((WIDTH - 2 * PAD_X) * Math.min(1, Math.max(0, time / denom)));
  };
  const yFor = (quality: number): number => {
    return HEIGHT - PAD_Y - ((HEIGHT - 2 * PAD_Y) * Math.min(100, Math.max(0, quality))) / 100;
  };

  const pathD = useMemo(() => catmullRomPath(points.map((p) => [xFor(p.time), yFor(p.quality)])), [points, durationSec]);
  const areaD = useMemo(() => {
    if (points.length === 0) return "";
    const lastX = xFor(points[points.length - 1].time);
    const firstX = xFor(points[0].time);
    return `${pathD} L ${lastX} ${HEIGHT - PAD_Y} L ${firstX} ${HEIGHT - PAD_Y} Z`;
  }, [pathD, points]);

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
      default:
        return t.inkSoft;
    }
  };

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      style={{
        width: "100%",
        height: 280,
        display: "block",
        background: t.panel,
        borderRadius: 14,
        border: `0.5px solid ${t.panelBorder}`,
      }}
      role="img"
      aria-label={`Call quality timeline with ${moments.length} moments`}
    >
      <defs>
        <linearGradient id="ccl-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={t.warm} stopOpacity="0.30" />
          <stop offset="100%" stopColor={t.warm} stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Gridlines at 25/50/75% quality. */}
      {[25, 50, 75].map((q) => (
        <line
          key={q}
          x1={PAD_X}
          y1={yFor(q)}
          x2={WIDTH - PAD_X}
          y2={yFor(q)}
          stroke={t.panelStroke}
          strokeWidth="0.15"
          strokeDasharray="0.4 0.4"
        />
      ))}

      {/* Area fill + curve. */}
      {points.length > 1 && (
        <>
          <path d={areaD} fill="url(#ccl-area)" />
          <path d={pathD} fill="none" stroke={t.warm} strokeWidth="0.4" strokeLinejoin="round" strokeLinecap="round" />
        </>
      )}

      {/* Moment dots. */}
      {moments.map((m) => {
        const cx = xFor(m.time);
        const cy = yFor(m.brightness * 100);
        const selected = m.id === selectedId;
        const color = colorFor(m);
        return (
          <g
            key={m.id}
            style={{ cursor: onSelectMoment ? "pointer" : "default" }}
            onClick={() => onSelectMoment?.(selected ? null : m)}
          >
            <circle cx={cx} cy={cy} r={selected ? 1.4 : 0.9} fill={color} opacity={0.95} />
            {selected && <circle cx={cx} cy={cy} r={2.2} fill="none" stroke={t.bright} strokeWidth="0.2" />}
          </g>
        );
      })}

      {/* Y-axis labels. */}
      {[0, 50, 100].map((q) => (
        <text
          key={q}
          x={1.5}
          y={yFor(q) + 0.8}
          fontFamily="'JetBrains Mono', monospace"
          fontSize="1.4"
          fill={t.inkMute}
          letterSpacing="0.1"
        >
          {q}%
        </text>
      ))}

      {/* X-axis bookends. */}
      <text
        x={PAD_X}
        y={HEIGHT - 1}
        fontFamily="'JetBrains Mono', monospace"
        fontSize="1.4"
        fill={t.inkMute}
      >
        0:00
      </text>
      <text
        x={WIDTH - PAD_X}
        y={HEIGHT - 1}
        textAnchor="end"
        fontFamily="'JetBrains Mono', monospace"
        fontSize="1.4"
        fill={t.inkMute}
      >
        {formatTime(durationSec)}
      </text>

      {moments.length === 0 && (
        <text
          x={WIDTH / 2}
          y={HEIGHT / 2}
          textAnchor="middle"
          fontFamily="'Inter', sans-serif"
          fontSize="2.2"
          fontStyle="italic"
          fill={t.inkSoft}
        >
          Timeline appears once transcript completes.
        </text>
      )}
    </svg>
  );
}

/**
 * Catmull-Rom spline through the given points, converted to a SVG path
 * by translating each pair of consecutive points into a cubic Bezier.
 * Cleaner than polyline for showing trend curves.
 */
function catmullRomPath(pts: Array<[number, number]>): string {
  if (pts.length < 2) return pts.map((p) => `M ${p[0]} ${p[1]}`).join(" ");
  const d: string[] = [`M ${pts[0][0]} ${pts[0][1]}`];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || pts[i + 1];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d.push(`C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2[0]} ${p2[1]}`);
  }
  return d.join(" ");
}

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const total = Math.floor(sec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
