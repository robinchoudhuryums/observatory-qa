/**
 * PatternsNetwork — clinical-mode equivalent of Constellation. Flat
 * node-link graph with the same data; no celestial chrome, no orbital
 * projection. Used when org.settings.presentation === "clinical".
 *
 * Sankey + Heatmap variants are deferred to a follow-on — the network
 * graph covers the majority case (showing topic relationships within a
 * cluster) and ships first.
 */
import { useMemo } from "react";
import type { Theme } from "../theme";
import type { Constellation as ConstellationData } from "@/lib/orrery-adapters";

type Props = {
  t: Theme;
  pattern: ConstellationData;
};

export function PatternsNetwork({ t, pattern }: Props) {
  // Map color name → theme value. Same mapping as Constellation; shared.
  const accentColor = useMemo(() => {
    switch (pattern.color) {
      case "bright":
        return t.bright;
      case "warm":
        return t.warm;
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

  // Build edges with resolved coords.
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
        background: t.panel,
        border: `0.5px solid ${t.panelBorder}`,
        borderRadius: 14,
      }}
      role="img"
      aria-label={`Pattern network: ${pattern.label}`}
    >
      {/* Edges — solid lines, weight drives stroke width. */}
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
            stroke={t.inkMute}
            strokeWidth={0.12 + edge.weight * 0.16}
            opacity={0.5 + edge.weight * 0.4}
          />
        );
      })}

      {/* Nodes — solid filled circles with labels. */}
      {pattern.nodes.map((node) => (
        <g key={node.key}>
          <circle cx={node.px} cy={node.py} r={node.sz} fill={accentColor} opacity={0.9} stroke={t.ink} strokeWidth="0.06" />
          <text
            x={node.px}
            y={node.py + node.sz + 0.9}
            textAnchor="middle"
            fontFamily="'Inter', sans-serif"
            fontSize="0.95"
            fill={t.ink}
          >
            {truncate(node.label, 20)}
          </text>
        </g>
      ))}
    </svg>
  );
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
