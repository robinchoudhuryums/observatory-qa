/**
 * MASTER BRAND owl mark — minimal linework, watchful, stars in the forehead
 * crown. Used in top-bar lockup, sign-in hero, marketing.
 *
 * The mark is rendered from a transparent PNG via CSS `mask-image` on a
 * `background-color`-tinted div. This makes the owl tintable to any color
 * (via `color` prop or `currentColor`) while preserving the exact illustration.
 *
 * Asset lives at `/orrery/owl-mark.png` (21 KB). Older Safari support for
 * `mask-image` is good (16.4+) — if we encounter rendering issues on older
 * browsers, swap in a hand-built SVG fallback by detecting via @supports.
 */
import type { CSSProperties } from "react";

const OWL_MARK_ASPECT = 215 / 203; // width / height of the source PNG
const OWL_MARK_SRC = "/orrery/owl-mark.png";

type Props = {
  size?: number;
  color?: string;
  style?: CSSProperties;
};

export function ObservatoryOwlMark({ size = 28, color = "currentColor", style }: Props) {
  const w = Math.round(size * OWL_MARK_ASPECT);
  const h = size;
  const useCurrent = color === "currentColor";
  return (
    <span
      style={{
        display: "inline-block",
        verticalAlign: "middle",
        lineHeight: 0,
        width: w,
        height: h,
        ...style,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          display: "block",
          width: "100%",
          height: "100%",
          backgroundColor: useCurrent ? "currentColor" : color,
          WebkitMaskImage: `url("${OWL_MARK_SRC}")`,
          maskImage: `url("${OWL_MARK_SRC}")`,
          WebkitMaskRepeat: "no-repeat",
          maskRepeat: "no-repeat",
          WebkitMaskSize: "contain",
          maskSize: "contain",
          WebkitMaskPosition: "center",
          maskPosition: "center",
        }}
      />
    </span>
  );
}
