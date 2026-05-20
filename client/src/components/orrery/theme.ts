/**
 * Orrery theme tokens — TypeScript port of archive/design-v1/directions/orrery-system.jsx.
 *
 * Two theme objects (light + dark) mirror the CSS custom properties defined in
 * client/src/index.css. Components that render inline styles (SVG fills, glow
 * gradients, KPI accents) read from these objects via `useOrreryTheme()`; the
 * hook tracks the `.dark` class on documentElement so theme changes propagate.
 *
 * Why both JS objects AND CSS vars? Some primitives (planet shadows, gradient
 * stops, hover halos) need to compute derived values at render time — easier
 * to do that with literal hex than `getComputedStyle()` calls. The CSS vars
 * cover everything else.
 */
import { useEffect, useState } from "react";

export type Theme = {
  name: "light" | "dark";
  bg: string;
  bgFlat: string;
  panel: string;
  panelBorder: string;
  panelStroke: string;
  ink: string;
  inkSoft: string;
  inkMute: string;
  haloBg: string;
  starCore: string;
  starGlow1: string;
  starGlow2: string;
  starOuter: string;
  orbit: string;
  orbitTick: string;
  bright: string;
  warm: string;
  cool: string;
  cold: string;
  ice: string;
  shadow: string;
  highlight: string;
  starfield: string;
  starfieldOpacity: number;
  amber: string;
  red: string;
  green: string;
  ringStroke: string;
  logoTint: string;
  logoTintGold: string;
};

export const ORRERY_LIGHT: Theme = {
  name: "light",
  bg: "linear-gradient(180deg, #f8faff 0%, #eef2f8 100%)",
  bgFlat: "#f4f6fb",
  panel: "rgba(255,255,255,0.72)",
  panelBorder: "rgba(20,30,60,0.06)",
  panelStroke: "rgba(20,30,60,0.04)",
  ink: "#0e1228",
  inkSoft: "#3c4566",
  inkMute: "#7a8198",
  haloBg: "rgba(34,184,207,0.22)",
  starCore: "#ffffff",
  starGlow1: "#a7e6f0",
  starGlow2: "#22b8cf",
  starOuter: "#0892a8",
  orbit: "rgba(20,30,60,0.10)",
  orbitTick: "rgba(20,30,60,0.20)",
  bright: "#0892a8",
  warm: "#22b8cf",
  cool: "#9ee5ed",
  cold: "#cdedf2",
  ice: "#e6f8fb",
  shadow: "rgba(20,30,60,0.18)",
  highlight: "rgba(255,255,255,0.65)",
  starfield: "#0e1228",
  starfieldOpacity: 0.1,
  amber: "#c08a2d",
  red: "#a8403c",
  green: "#22a06b",
  ringStroke: "rgba(8,146,168,0.55)",
  logoTint: "#1a1f3a",
  logoTintGold: "#a8762c",
};

export const ORRERY_DARK: Theme = {
  name: "dark",
  bg: "radial-gradient(ellipse at 50% 35%, #0c1538 0%, #04081a 70%)",
  bgFlat: "#04081a",
  panel: "rgba(255,255,255,0.045)",
  panelBorder: "rgba(255,255,255,0.10)",
  panelStroke: "rgba(255,255,255,0.06)",
  ink: "#f3f5fa",
  inkSoft: "#a0a8c0",
  inkMute: "#646b85",
  haloBg: "rgba(34,184,207,0.30)",
  starCore: "#ffffff",
  starGlow1: "#7ddef0",
  starGlow2: "#22b8cf",
  starOuter: "#0892a8",
  orbit: "rgba(180,200,255,0.16)",
  orbitTick: "rgba(180,200,255,0.40)",
  bright: "#4dd6e8",
  warm: "#22b8cf",
  cool: "#5fb1c2",
  cold: "#3a6878",
  ice: "#22384a",
  shadow: "rgba(0,0,0,0.45)",
  highlight: "rgba(255,255,255,0.45)",
  starfield: "#dde6ff",
  starfieldOpacity: 0.55,
  amber: "#e6b262",
  red: "#e07a73",
  green: "#7ed5a3",
  ringStroke: "rgba(77,214,232,0.65)",
  logoTint: "#f3f5fa",
  logoTintGold: "#e6b262",
};

/**
 * Returns the active orrery theme object based on the `.dark` class on
 * documentElement. Re-renders on class change via a MutationObserver on
 * `<html>`. Use this in components that need literal token values (e.g. SVG
 * gradient stops). For most styling, prefer the CSS custom properties defined
 * in `client/src/index.css`.
 */
export function useOrreryTheme(): Theme {
  const [isDark, setIsDark] = useState(() =>
    typeof document !== "undefined" ? document.documentElement.classList.contains("dark") : false,
  );

  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const update = () => setIsDark(root.classList.contains("dark"));
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return isDark ? ORRERY_DARK : ORRERY_LIGHT;
}
