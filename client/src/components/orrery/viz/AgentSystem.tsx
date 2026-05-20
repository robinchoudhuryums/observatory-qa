/**
 * Mini-orrery per agent — used on the Coaching landing as a "team in
 * orbit" hero. Each agent renders as a small celestial system: a planet
 * (brightness = performance score), an orbital ring, and (optionally) a
 * hot-ring overlay when there's an active coaching session.
 *
 * Sized to fit ~8 per row at desktop width. Click navigates the parent
 * (parent owns the navigation handler — this component is pure
 * presentation). Industry-agnostic: no role labels assumed.
 */
import type { Theme } from "../theme";
import { brightToColor, TILT } from "../projection";
import type { CoachingAgent } from "@/lib/orrery-adapters";

type Props = {
  t: Theme;
  agent: CoachingAgent;
  selected?: boolean;
  onClick?: () => void;
};

export function AgentSystem({ t, agent, selected = false, onClick }: Props) {
  const color = brightToColor(agent.brightness, t);
  // Planet sized by call volume — log scale, clamped [0.6, 2.2].
  const planetSize =
    agent.callCount === 0 ? 1.0 : Math.max(0.6, Math.min(2.2, 0.6 + Math.log10(agent.callCount + 1) * 1.2));

  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={`agent-system-${agent.id}`}
      style={{
        cursor: onClick ? "pointer" : "default",
        background: "transparent",
        border: "none",
        padding: 8,
        textAlign: "center",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 6,
        width: "100%",
        borderRadius: 12,
        transition: "background 200ms",
        outline: selected ? `0.5px solid ${t.bright}` : "none",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = t.panel;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      <svg viewBox="-14 -10 28 20" style={{ width: "100%", height: "auto", maxWidth: 120 }}>
        {/* Orbit ring */}
        <ellipse
          cx="0"
          cy="0"
          rx="10"
          ry={10 * TILT}
          fill="none"
          stroke={t.orbit}
          strokeWidth="0.15"
          strokeDasharray="0.6 0.5"
        />
        {/* Hot/coaching glow halo */}
        {(agent.hasActiveSession || agent.flagged) && (
          <circle cx="0" cy="0" r={planetSize * 2.6} fill={t.amber} opacity={0.15} />
        )}
        {agent.exceptional && <circle cx="0" cy="0" r={planetSize * 2.6} fill={t.green} opacity={0.15} />}
        {/* Planet body */}
        <circle cx="0" cy="0" r={planetSize} fill={color} opacity={0.94} />
        {/* Specular highlight */}
        <ellipse
          cx={-planetSize * 0.3}
          cy={-planetSize * 0.3}
          rx={planetSize * 0.45}
          ry={planetSize * 0.35}
          fill={t.highlight}
          opacity={t.name === "dark" ? 0.35 : 0.55}
        />
        {/* Ring overlay when there's an active coaching session — visual
            cue that this agent has open work, matching the prototype's
            "Saturn-style" anchor styling. */}
        {agent.hasActiveSession && (
          <ellipse
            cx="0"
            cy="0"
            rx={planetSize * 1.8}
            ry={planetSize * 0.7}
            fill="none"
            stroke={t.ringStroke}
            strokeWidth="0.18"
          />
        )}
      </svg>

      <div
        style={{
          fontFamily: "'Inter', sans-serif",
          fontSize: 13,
          fontWeight: 500,
          color: t.ink,
          lineHeight: 1.2,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          width: "100%",
        }}
      >
        {agent.name}
      </div>
      <div
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 9.5,
          letterSpacing: "0.1em",
          color:
            agent.avgScore !== null && agent.avgScore >= 7
              ? t.green
              : agent.avgScore !== null && agent.avgScore < 4
                ? t.red
                : t.inkMute,
          textTransform: "uppercase",
        }}
      >
        {agent.avgScore !== null ? agent.avgScore.toFixed(1) : "—"} · {agent.callCount}{" "}
        {agent.callCount === 1 ? "call" : "calls"}
      </div>
    </button>
  );
}
