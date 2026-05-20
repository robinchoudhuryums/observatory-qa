/**
 * Galaxy view — a logarithmic spiral of days in one month. Inner days are
 * tightly packed near the sun; outer days fan into the void. Each day's
 * planet size = call count (log-scale), brightness = close rate.
 *
 * Weekends rendered at 50% opacity. Today's planet (if the month matches)
 * gets a bright ring. Hover shows the day label + counts; click drills
 * into the day (currently → /transcripts filtered by date — Phase 3+
 * could add a per-day drill page).
 *
 * Industry-agnostic — colors come from `closeRate` which only requires
 * performance scoring (already universal in the AI analysis pipeline).
 */
import { useMemo } from "react";
import type { Theme } from "../theme";
import { brightToColor } from "../projection";
import { OrreryCenterStar } from "../OrreryCenterStar";
import { OrreryStarfield } from "../OrreryStarfield";
import type { GalaxyDay } from "@/lib/orrery-adapters";

type Props = {
  t: Theme;
  days: GalaxyDay[];
  hoveredDate?: string | null;
  onHover?: (date: string | null) => void;
  onSelectDay?: (day: GalaxyDay) => void;
};

export function Galaxy({ t, days, hoveredDate = null, onHover, onSelectDay }: Props) {
  const decorated = useMemo(
    () =>
      days.map((d) => ({
        ...d,
        color: d.calls === 0 ? t.inkMute : brightToColor(d.br, t),
      })),
    [days, t],
  );

  return (
    <svg
      viewBox="-50 -28 100 56"
      preserveAspectRatio="xMidYMid meet"
      style={{
        width: "100%",
        height: "auto",
        display: "block",
        background: t.bg,
        borderRadius: 14,
      }}
      role="img"
      aria-label={`Galaxy view: ${days.length} days`}
    >
      <OrreryStarfield t={t} count={80} spread={[48, 24]} />
      <OrreryCenterStar t={t} idSeed="galaxy" />

      {decorated.map((d) => {
        const isHovered = hoveredDate === d.date;
        const opacity = d.weekend ? 0.5 : 1;
        const sz = isHovered ? d.sz * 1.3 : d.sz;
        return (
          <g
            key={d.date}
            style={{ cursor: onSelectDay ? "pointer" : "default", opacity }}
            onMouseEnter={() => onHover?.(d.date)}
            onMouseLeave={() => onHover?.(null)}
            onClick={() => onSelectDay?.(d)}
          >
            {/* glow halo for hovered / anchor */}
            {(isHovered || d.anchor) && (
              <circle cx={d.px} cy={d.py} r={d.sz * 2.4} fill={d.color} opacity={d.anchor ? 0.25 : 0.15} />
            )}
            <circle cx={d.px} cy={d.py} r={sz} fill={d.color} opacity={d.calls === 0 ? 0.3 : 0.95} />
            {d.anchor && <circle cx={d.px} cy={d.py} r={d.sz + 0.9} fill="none" stroke={t.bright} strokeWidth="0.22" />}
            {/* day number label on hover or anchor */}
            {(isHovered || d.anchor) && (
              <text
                x={d.px}
                y={d.py + d.sz + 1.6}
                textAnchor="middle"
                fontFamily="'JetBrains Mono', monospace"
                fontSize="1.4"
                fill={t.ink}
                letterSpacing="0.1"
              >
                {d.day}
              </text>
            )}
          </g>
        );
      })}

      {days.length === 0 && (
        <text
          x="0"
          y="0"
          textAnchor="middle"
          fontFamily="'Instrument Serif', Georgia, serif"
          fontStyle="italic"
          fontSize="2.4"
          fill={t.inkSoft}
        >
          No data for this month yet.
        </text>
      )}
    </svg>
  );
}
