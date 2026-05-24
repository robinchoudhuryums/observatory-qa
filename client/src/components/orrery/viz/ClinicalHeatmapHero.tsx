/**
 * ClinicalHeatmapHero — co-occurrence heatmap showing which topics appear
 * together in calls. Rows and columns are topics; cell intensity shows
 * co-occurrence weight from the constellation edges.
 *
 * Sprint 3 (D7). Clinical-mode variant for the patterns view.
 */
import type { Theme } from "../theme";
import type { Constellation as ConstellationData } from "@/lib/orrery-adapters";
import { OrreryTag } from "../OrreryTag";

type Props = {
  t: Theme;
  pattern: ConstellationData;
};

export function ClinicalHeatmapHero({ t, pattern }: Props) {
  if (pattern.nodes.length < 2) {
    return (
      <div style={{ padding: 32, textAlign: "center" }}>
        <OrreryTag t={t}>◇ NOT ENOUGH TOPICS FOR HEATMAP</OrreryTag>
        <p style={{ color: t.inkSoft, marginTop: 8, fontSize: 13 }}>
          This pattern needs at least 2 topics to render a heatmap.
        </p>
      </div>
    );
  }

  const accentColor = pattern.color === "bright" ? t.bright : pattern.color === "amber" ? t.amber : t.warm;

  // Build a weight lookup from edge pairs.
  const weights = new Map<string, number>();
  for (const edge of pattern.edges) {
    weights.set(`${edge.fromKey}|${edge.toKey}`, edge.weight);
    weights.set(`${edge.toKey}|${edge.fromKey}`, edge.weight);
  }

  const n = pattern.nodes.length;
  const PAD = 12;
  const LABEL_W = 18;
  const gridSize = 100 - 2 * PAD - LABEL_W;
  const cellSize = gridSize / n;
  const SIZE = 100;

  return (
    <svg
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      preserveAspectRatio="xMidYMid meet"
      style={{
        width: "100%",
        height: 320,
        display: "block",
        background: t.panel,
        borderRadius: 14,
        border: `0.5px solid ${t.panelBorder}`,
      }}
      role="img"
      aria-label={`Heatmap: ${pattern.label}`}
    >
      {/* Row labels (left) */}
      {pattern.nodes.map((node, i) => (
        <text
          key={`rl-${node.key}`}
          x={PAD + LABEL_W - 1}
          y={PAD + LABEL_W + cellSize * i + cellSize / 2 + 0.6}
          textAnchor="end"
          fontFamily="'Inter', sans-serif"
          fontSize="1.6"
          fill={t.inkSoft}
          dominantBaseline="middle"
        >
          {node.label.length > 10 ? node.label.slice(0, 9) + "…" : node.label}
        </text>
      ))}

      {/* Column labels (top, rotated) */}
      {pattern.nodes.map((node, j) => (
        <text
          key={`cl-${node.key}`}
          x={PAD + LABEL_W + cellSize * j + cellSize / 2}
          y={PAD + LABEL_W - 2}
          textAnchor="end"
          fontFamily="'Inter', sans-serif"
          fontSize="1.6"
          fill={t.inkSoft}
          transform={`rotate(-45, ${PAD + LABEL_W + cellSize * j + cellSize / 2}, ${PAD + LABEL_W - 2})`}
        >
          {node.label.length > 10 ? node.label.slice(0, 9) + "…" : node.label}
        </text>
      ))}

      {/* Cells */}
      {pattern.nodes.map((rowNode, i) =>
        pattern.nodes.map((colNode, j) => {
          const w = i === j ? 1 : (weights.get(`${rowNode.key}|${colNode.key}`) ?? 0);
          return (
            <rect
              key={`${i}-${j}`}
              x={PAD + LABEL_W + cellSize * j + 0.3}
              y={PAD + LABEL_W + cellSize * i + 0.3}
              width={cellSize - 0.6}
              height={cellSize - 0.6}
              rx={0.5}
              fill={accentColor}
              opacity={w > 0 ? 0.15 + w * 0.65 : 0.04}
            />
          );
        }),
      )}
    </svg>
  );
}
