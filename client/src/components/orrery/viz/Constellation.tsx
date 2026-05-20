/**
 * Constellation — observatory-mode pattern visualization. Topics in a
 * cluster render as planets connected by dotted "constellation lines";
 * the primary topic sits at the center, secondary topics radiate out.
 *
 * Color comes from the cluster's trend (rising/stable/declining) — see
 * patternsToConstellations() in orrery-adapters.ts.
 *
 * Clinical-mode equivalent (`PatternsNetwork`) renders the same data as
 * a flat node-link graph for clinical orgs that prefer plain charts.
 */
import { useMemo } from "react";
import type { Theme } from "../theme";
import { OrreryCenterStar } from "../OrreryCenterStar";
import { OrreryStarfield } from "../OrreryStarfield";
import type { Constellation as ConstellationData } from "@/lib/orrery-adapters";

type Props = {
  t: Theme;
  pattern: ConstellationData;
  /** When true, the viz dims to indicate a non-selected pattern in a multi-pattern view. */
  dimmed?: boolean;
};

export function Constellation({ t, pattern, dimmed = false }: Props) {
  // Resolve color ramp once.
  const accentColor = useMemo(() => {
    switch (pattern.color) {
      case "bright":
        return t.bright;
      case "warm":
        return t.warm;
      case "cool":
        return t.cool;
      case "cold":
        return t.cold;
      case "amber":
        return t.amber;
      case "red":
        return t.red;
      case "green":
        return t.green;
      default:
        return t.warm;
    }
  }, [pattern.color, t]);

  // Build a quick lookup from key → node so we can resolve edge endpoints.
  const nodeByKey = useMemo(() => {
    const map = new Map<string, ConstellationData["nodes"][number]>();
    for (const n of pattern.nodes) map.set(n.key, n);
    return map;
  }, [pattern.nodes]);

  return (
    <svg
      viewBox="-15 -10 30 20"
      preserveAspectRatio="xMidYMid meet"
      style={{
        width: "100%",
        height: "auto",
        display: "block",
        background: t.bg,
        borderRadius: 14,
        opacity: dimmed ? 0.4 : 1,
        transition: "opacity 200ms",
      }}
      role="img"
      aria-label={`Constellation: ${pattern.label}`}
    >
      <OrreryStarfield t={t} count={30} spread={[14, 9]} />

      {/* Constellation edges — drawn first so nodes overlap them. */}
      {pattern.edges.map((edge, i) => {
        const from = nodeByKey.get(edge.fromKey);
        const to = nodeByKey.get(edge.toKey);
        if (!from || !to) return null;
        return (
          <line
            key={i}
            x1={from.px}
            y1={from.py}
            x2={to.px}
            y2={to.py}
            stroke={accentColor}
            strokeWidth="0.12"
            opacity={edge.weight}
            strokeDasharray="0.4 0.5"
          />
        );
      })}

      <OrreryCenterStar t={t} idSeed={`pattern-${pattern.id}`} />

      {/* Nodes. */}
      {pattern.nodes.map((node) => (
        <g key={node.key}>
          <circle cx={node.px} cy={node.py} r={node.sz * 1.8} fill={accentColor} opacity={0.18} />
          <circle cx={node.px} cy={node.py} r={node.sz} fill={accentColor} opacity={0.95} />
          {/* label below the node */}
          <text
            x={node.px}
            y={node.py + node.sz + 0.8}
            textAnchor="middle"
            fontFamily="'Inter', sans-serif"
            fontSize="0.9"
            fontStyle="italic"
            fill={t.ink}
          >
            {truncate(node.label, 18)}
          </text>
        </g>
      ))}
    </svg>
  );
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
