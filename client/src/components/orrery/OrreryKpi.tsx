/**
 * KPI tile — translucent panel with an Instrument Serif italic value and a
 * mono uppercase label. Top accent bar gradients from the chosen ramp color
 * (defaults to `bright`) into transparent, suggesting a focused beam.
 */
import type { CSSProperties, ReactNode } from "react";
import type { Theme } from "./theme";

type AccentRamp = "bright" | "warm" | "cool" | "cold" | "ice" | "amber" | "red" | "green";

type Props = {
  t: Theme;
  label: string;
  value: ReactNode;
  /** Small subtitle next to the value, e.g. "calls" or "%". */
  sub?: ReactNode;
  /** Optional delta indicator (e.g. "+18%"). Rendered as green ↑. */
  delta?: string | null;
  /** Which celestial ramp color powers the top accent bar. */
  accentRamp?: AccentRamp;
  icon?: ReactNode;
  /** When true, value renders in upright Inter instead of italic serif. */
  plain?: boolean;
};

export function OrreryKpi({ t, label, value, sub, delta = null, accentRamp = "bright", plain = false }: Props) {
  const accent = t[accentRamp];

  const wrapStyle: CSSProperties = {
    padding: "14px 18px",
    borderRadius: 12,
    background: t.panel,
    backdropFilter: "blur(8px)",
    border: `0.5px solid ${t.panelBorder}`,
    position: "relative",
    overflow: "hidden",
  };
  const barStyle: CSSProperties = {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 2,
    background: `linear-gradient(90deg, ${accent}, transparent)`,
  };
  const labelStyle: CSSProperties = {
    fontSize: 10.5,
    color: t.inkSoft,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    fontFamily: "'JetBrains Mono', monospace",
  };
  const valueStyle: CSSProperties = {
    fontFamily: "'Inter', system-ui, sans-serif",
    fontSize: 30,
    fontStyle: "normal",
    fontWeight: 500,
    letterSpacing: "-0.02em",
    color: t.ink,
  };

  return (
    <div style={wrapStyle}>
      <div style={barStyle} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={labelStyle}>{label}</span>
        {delta && (
          <span style={{ fontSize: 10, color: t.green, fontFamily: "'JetBrains Mono', monospace" }}>↑ {delta}</span>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 4 }}>
        <span style={valueStyle}>{value}</span>
        {sub && <span style={{ fontSize: 11, color: t.inkSoft }}>{sub}</span>}
      </div>
    </div>
  );
}
