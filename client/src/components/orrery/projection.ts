/**
 * Orrery projection + brightness math.
 *
 * `TILT` (0.42) is the y-squash factor that gives the orrery its isometric
 * look — every y-coordinate in orbit math is multiplied by TILT before
 * rendering, while x stays unchanged. This is what makes circles read as
 * ellipses viewed from a 25°-ish angle.
 *
 * `orreryProject` is the canonical projector used by every screen.
 * `brightToColor` is the brightness ramp — a 0-1 input maps to one of five
 * named colors on the celestial palette. Used for planet fill, KPI accents,
 * and constellation node colors so the visual language stays consistent.
 */
import type { Theme } from "./theme";

export const TILT = 0.42;

export const orreryProject = (x: number, y: number, z = 0): [number, number] => [x, y * TILT - z];

export function brightToColor(brightness: number, t: Theme): string {
  if (brightness > 0.8) return t.bright;
  if (brightness > 0.65) return t.warm;
  if (brightness > 0.5) return t.cool;
  if (brightness > 0.35) return t.cold;
  return t.ice;
}
