/**
 * Mono uppercase tag — the small JetBrains Mono pills used for section labels,
 * statuses, and "PATTERN · N OCCURRENCES" style metadata across the orrery.
 * Inherits ink-soft color by default; pass `color` for celestial accent variants.
 */
import type { CSSProperties, ReactNode } from "react";
import type { Theme } from "./theme";

type Props = {
  children: ReactNode;
  t: Theme;
  color?: string | null;
  style?: CSSProperties;
};

export function OrreryTag({ children, t, color = null, style = {} }: Props) {
  return (
    <span
      style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 9.5,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        color: color || t.inkSoft,
        ...style,
      }}
    >
      {children}
    </span>
  );
}
