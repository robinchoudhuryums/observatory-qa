/**
 * Orrery design system — barrel exports.
 *
 * Ports the JSX-in-Babel prototype primitives from `archive/design-v1/directions/` to
 * type-safe ES modules. Components stay presentation-only; data and routing
 * are passed in as props.
 *
 * Subpaths:
 *   ./owl       — brand/owl marks and persona animations
 *   ./realism   — empty / loading / low-confidence / degraded states
 */
export { ORRERY_LIGHT, ORRERY_DARK, useOrreryTheme, type Theme } from "./theme";
export { TILT, orreryProject, brightToColor } from "./projection";

export { OrreryTopBar, type NavKey } from "./OrreryTopBar";
export { OrreryCenterStar } from "./OrreryCenterStar";
export { OrreryOrbitRing } from "./OrreryOrbitRing";
export { OrreryPlanet, type PlanetData, type TrajectoryArrow } from "./OrreryPlanet";
export { OrreryStarfield } from "./OrreryStarfield";
export { OrreryKpi } from "./OrreryKpi";
export { OrreryCard } from "./OrreryCard";
export { OrreryTag } from "./OrreryTag";
export { OrreryThemeToggle } from "./OrreryThemeToggle";

export * from "./owl";
export * from "./realism";
export * from "./viz";
export * from "./overlays";
export * from "./shell";
