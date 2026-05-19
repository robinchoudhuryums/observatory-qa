/**
 * Wraps content in a dashed amber-bordered container with a "LOW CONFIDENCE"
 * header. Used when transcript / analysis confidence is below threshold and
 * we want to signal "take this with a grain of salt" without hiding the data.
 */
import type { ReactNode } from "react";
import type { Theme } from "../theme";

type Props = {
  t: Theme;
  reason: string;
  children: ReactNode;
};

export function UncertaintyHaze({ t, reason, children }: Props) {
  return (
    <div
      style={{
        position: "relative",
        border: `0.5px dashed ${t.amber}`,
        borderRadius: 10,
        padding: 14,
        background: `${t.amber}08`,
      }}
    >
      <div
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 9,
          color: t.amber,
          letterSpacing: "0.14em",
          marginBottom: 8,
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <span style={{ width: 5, height: 5, borderRadius: 3, background: t.amber }} />
        ◇ LOW CONFIDENCE · {reason}
      </div>
      {children}
    </div>
  );
}
