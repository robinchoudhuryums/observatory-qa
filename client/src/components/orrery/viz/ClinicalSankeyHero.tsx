/**
 * ClinicalSankeyHero — Sankey-style flow diagram showing how calls flow
 * between cluster topics. Left column = source topics, right column =
 * destination topics, connecting bands = co-occurrence strength.
 *
 * Sprint 3 (D7). Clinical-mode variant for the patterns view. Same
 * ConstellationData input as Constellation/PatternsNetwork.
 */
import type { Theme } from "../theme";
import type { Constellation as ConstellationData } from "@/lib/orrery-adapters";
import { OrreryTag } from "../OrreryTag";

type Props = {
  t: Theme;
  pattern: ConstellationData;
};

export function ClinicalSankeyHero({ t, pattern }: Props) {
  if (pattern.nodes.length < 2) {
    return (
      <div style={{ padding: 32, textAlign: "center" }}>
        <OrreryTag t={t}>◇ NOT ENOUGH TOPICS FOR SANKEY</OrreryTag>
        <p style={{ color: t.inkSoft, marginTop: 8, fontSize: 13 }}>
          This pattern needs at least 2 topics to render a flow diagram.
        </p>
      </div>
    );
  }

  const accentColor =
    pattern.color === "bright"
      ? t.bright
      : pattern.color === "amber"
        ? t.amber
        : pattern.color === "red"
          ? t.red
          : t.warm;

  const WIDTH = 100;
  const HEIGHT = 40;
  const PAD = 8;
  const nodeH = (HEIGHT - 2 * PAD) / Math.max(pattern.nodes.length, 1);
  const leftX = PAD + 8;
  const rightX = WIDTH - PAD - 8;

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="xMidYMid meet"
      style={{
        width: "100%",
        height: 280,
        display: "block",
        background: t.panel,
        borderRadius: 14,
        border: `0.5px solid ${t.panelBorder}`,
      }}
      role="img"
      aria-label={`Sankey flow: ${pattern.label}`}
    >
      {/* Left-side topic labels */}
      {pattern.nodes.map((node, i) => {
        const y = PAD + nodeH * i + nodeH / 2;
        return (
          <g key={`l-${node.key}`}>
            <rect
              x={leftX - 3}
              y={y - nodeH * 0.35}
              width={6}
              height={nodeH * 0.7}
              rx={1}
              fill={accentColor}
              opacity={0.7 - i * 0.08}
            />
            <text
              x={leftX + 5}
              y={y + 1}
              fontFamily="'Inter', sans-serif"
              fontSize="1.8"
              fill={t.ink}
              dominantBaseline="middle"
            >
              {node.label.length > 14 ? node.label.slice(0, 13) + "…" : node.label}
            </text>
          </g>
        );
      })}

      {/* Bands — connect each edge from left node to right node */}
      {pattern.edges.map((edge, i) => {
        const fromIdx = pattern.nodes.findIndex((n) => n.key === edge.fromKey);
        const toIdx = pattern.nodes.findIndex((n) => n.key === edge.toKey);
        if (fromIdx === -1 || toIdx === -1) return null;
        const y1 = PAD + nodeH * fromIdx + nodeH / 2;
        const y2 = PAD + nodeH * toIdx + nodeH / 2;
        const bandWidth = Math.max(nodeH * 0.3 * edge.weight, 0.5);
        return (
          <path
            key={i}
            d={`M ${leftX + 3} ${y1} C ${(leftX + rightX) / 2} ${y1}, ${(leftX + rightX) / 2} ${y2}, ${rightX - 3} ${y2}`}
            fill="none"
            stroke={accentColor}
            strokeWidth={bandWidth}
            opacity={0.3 + edge.weight * 0.4}
          />
        );
      })}

      {/* Right-side topic labels */}
      {pattern.nodes.map((node, i) => {
        const y = PAD + nodeH * i + nodeH / 2;
        return (
          <g key={`r-${node.key}`}>
            <rect
              x={rightX - 3}
              y={y - nodeH * 0.35}
              width={6}
              height={nodeH * 0.7}
              rx={1}
              fill={accentColor}
              opacity={0.5 - i * 0.06}
            />
            <text
              x={rightX - 5}
              y={y + 1}
              textAnchor="end"
              fontFamily="'Inter', sans-serif"
              fontSize="1.8"
              fill={t.inkSoft}
              dominantBaseline="middle"
            >
              {node.label.length > 14 ? node.label.slice(0, 13) + "…" : node.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
