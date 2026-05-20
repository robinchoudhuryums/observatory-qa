/**
 * Section card — translucent panel with a soft border. The common container
 * for sidebars, evidence lists, and right-rail overlays in the orrery. Pass
 * `padded={false}` when the children manage their own padding (e.g. SVG
 * hero with no margins).
 */
import type { CSSProperties, ReactNode } from "react";
import type { Theme } from "./theme";

type Props = {
  t: Theme;
  children: ReactNode;
  style?: CSSProperties;
  padded?: boolean;
};

export function OrreryCard({ t, children, style = {}, padded = true }: Props) {
  return (
    <div
      style={{
        borderRadius: 14,
        background: t.panel,
        backdropFilter: "blur(8px)",
        border: `0.5px solid ${t.panelBorder}`,
        padding: padded ? "16px 18px" : 0,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
