/**
 * Master brand lockup — line owl + wordmark side by side. The top-bar's
 * default brand mark. Owl and wordmark colors can be tinted independently;
 * leave them as `currentColor` to inherit from a parent text color.
 */
import type { CSSProperties } from "react";
import { ObservatoryOwlMark } from "./ObservatoryOwlMark";
import { ObservatoryWordmark } from "./ObservatoryWordmark";

type Props = {
  height?: number;
  gap?: number;
  color?: string;
  style?: CSSProperties;
  owlColor?: string | null;
  wordColor?: string | null;
};

export function ObservatoryLockup({
  height = 32,
  gap = 12,
  color = "currentColor",
  style,
  owlColor = null,
  wordColor = null,
}: Props) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap, color, ...style }}>
      <ObservatoryOwlMark size={Math.round(height * 1.05)} color={owlColor || "currentColor"} />
      <ObservatoryWordmark height={height * 0.62} color={wordColor || "currentColor"} />
    </span>
  );
}
