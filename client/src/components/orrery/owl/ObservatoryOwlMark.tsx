/**
 * MASTER BRAND owl mark — minimal linework, watchful, stars in the forehead
 * crown. Used in top-bar lockup, sign-in hero, marketing.
 *
 * Primary path: CSS `mask-image` on a `background-color`-tinted div. This
 * makes the owl tintable to any color via the `color` prop while preserving
 * the exact illustration from the PNG.
 *
 * Fallback path: for browsers without CSS `mask-image` support (primarily
 * older Safari < 15.4), renders the PNG directly as an `<img>`. Loses
 * tintability but preserves the mark. The detection uses a runtime
 * `CSS.supports` check — Phase 6 cross-browser hardening.
 *
 * Asset lives at `/orrery/owl-mark.png` (21 KB).
 */
import { useMemo, type CSSProperties } from "react";

const OWL_MARK_ASPECT = 215 / 203; // width / height of the source PNG
const OWL_MARK_SRC = "/orrery/owl-mark.png";

const supportsMaskImage =
  typeof CSS !== "undefined" && CSS.supports
    ? CSS.supports("mask-image", 'url("x")') || CSS.supports("-webkit-mask-image", 'url("x")')
    : true; // SSR fallback assumes modern browser

type Props = {
  size?: number;
  color?: string;
  style?: CSSProperties;
};

export function ObservatoryOwlMark({ size = 28, color = "currentColor", style }: Props) {
  const w = Math.round(size * OWL_MARK_ASPECT);
  const h = size;
  const useCurrent = color === "currentColor";

  if (!supportsMaskImage) {
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
        <img
          src={OWL_MARK_SRC}
          alt=""
          aria-hidden="true"
          width={w}
          height={h}
          style={{ display: "block", width: "100%", height: "100%", objectFit: "contain" }}
        />
      </span>
    );
  }

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
