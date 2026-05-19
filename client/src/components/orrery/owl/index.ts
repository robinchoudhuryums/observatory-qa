/**
 * Owl + brand asset barrel.
 *
 *   ObservatoryOwlMark        — minimal line owl (master brand)
 *   ObservatoryWordmark       — "Observatory" lettering
 *   ObservatoryLockup         — owl + wordmark together (top bar default)
 *   ObservatoryFilledOwl      — persona owl, full body (Ory in showcases)
 *   ObservatoryFilledOwlHead  — head-only crop (signatures, FAB, small sizes)
 *   ObservatoryLayeredOwl     — animation-ready persona owl with state machine
 *
 * Owl animation keyframes (obsOwlBlink, etc.) load when ObservatoryLayeredOwl
 * is imported; the CSS is bundled via `./owl-animations.css`.
 */
export { ObservatoryOwlMark } from "./ObservatoryOwlMark";
export { ObservatoryWordmark } from "./ObservatoryWordmark";
export { ObservatoryLockup } from "./ObservatoryLockup";
export { ObservatoryFilledOwl, ObservatoryFilledOwlHead } from "./ObservatoryFilledOwl";
export { ObservatoryLayeredOwl, type OwlState } from "./ObservatoryLayeredOwl";
