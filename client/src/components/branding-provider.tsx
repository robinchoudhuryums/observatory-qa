import { useEffect } from "react";
import { useOrganization } from "@/hooks/use-organization";

/**
 * Converts a hex color (e.g., "#3b82f6") to an HSL string for CSS variables.
 * Returns format: "h s% l%" (without the "hsl()" wrapper, matching shadcn format).
 */
function hexToHsl(hex: string): string | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return null;

  const r = parseInt(result[1], 16) / 255;
  const g = parseInt(result[2], 16) / 255;
  const b = parseInt(result[3], 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }

  return `${Math.round(h * 360)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%`;
}

/** Converts hex to "r, g, b" string for use in rgba(). */
function hexToRgb(hex: string): string | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return null;
  return `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}`;
}

/** All brand-related CSS custom properties we inject per-org. */
const BRAND_VARS = [
  "--primary",
  "--accent",
  "--ring",
  "--chart-1",
  "--brand-from",
  "--brand-to",
  "--brand-from-rgb",
  "--brand-to-rgb",
  "--celestial-bright",
  "--celestial-warm",
] as const;

/**
 * Injects CSS custom properties for org-specific branding into the
 * documentElement, overriding the default celestial palette set in
 * `client/src/index.css`.
 *
 * The redesign maps the org's `primaryColor` to the *celestial-bright* slot
 * (the deepest, most saturated point on the celestial ramp — what planets
 * fade towards as they get hotter), and `secondaryColor` to *celestial-warm*
 * (the everyday cyan body color). When only `primaryColor` is set, the
 * provider also drives the shadcn semantic vars (`--primary`, `--accent`,
 * `--ring`, `--chart-1`) so existing shadcn components track the brand.
 *
 * Defaults (when no branding configured — celestial cyan):
 *   bright: #0892a8  (light) / #4dd6e8 (dark — adjusted in index.css)
 *   warm:   #22b8cf
 *
 * The brand gradient pair stays in `--brand-from / --brand-to` for
 * components that draw gradient buttons or sidebar accents.
 */
export function BrandingProvider() {
  const { data: org } = useOrganization();
  const primaryColor = org?.settings?.branding?.primaryColor;
  const secondaryColor = org?.settings?.branding?.secondaryColor;

  useEffect(() => {
    const root = document.documentElement;

    // Default celestial palette. Bright = deep cyan, warm = main cyan.
    const fromHex = primaryColor || "#0892a8";
    const toHex = secondaryColor || "#22b8cf";

    const fromHsl = hexToHsl(fromHex);
    const toHsl = hexToHsl(toHex);
    const fromRgb = hexToRgb(fromHex);
    const toRgb = hexToRgb(toHex);

    if (fromHsl) root.style.setProperty("--brand-from", fromHsl);
    if (toHsl) root.style.setProperty("--brand-to", toHsl);
    if (fromRgb) root.style.setProperty("--brand-from-rgb", fromRgb);
    if (toRgb) root.style.setProperty("--brand-to-rgb", toRgb);

    // Celestial palette tracks the brand. `--celestial-bright` is the focal
    // point of the brightness ramp; setting it here updates planet fills,
    // KPI accents, and chart-1 simultaneously.
    if (primaryColor) {
      root.style.setProperty("--celestial-bright", primaryColor);
      const hsl = hexToHsl(primaryColor);
      if (hsl) {
        root.style.setProperty("--primary", `hsl(${hsl})`);
        root.style.setProperty("--accent", `hsl(${hsl})`);
        root.style.setProperty("--ring", `hsl(${hsl})`);
        root.style.setProperty("--chart-1", `hsl(${hsl})`);
      }
    }
    if (secondaryColor) {
      root.style.setProperty("--celestial-warm", secondaryColor);
    }

    return () => {
      for (const v of BRAND_VARS) root.style.removeProperty(v);
    };
  }, [primaryColor, secondaryColor]);

  return null;
}
