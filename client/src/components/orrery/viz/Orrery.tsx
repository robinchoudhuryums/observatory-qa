/**
 * Composed orrery hero visualization. The dashboard's main viz — orbit rings,
 * planets, center star, starfield, all in one SVG.
 *
 * This component is presentation-only: it takes pre-projected planets
 * (already through `callsToPlanets`) and renders them. State for hover,
 * selection, and the hour scrubber is owned by the parent so it survives
 * across lens switches.
 *
 * The orrery always renders against a dark "sky" canvas (the celestial bg),
 * even on a light-theme page. This is the prototype's "Pattern 2" — celestial
 * canvases live in dark theme regardless of page chrome — and keeps the
 * starfield + planet glows readable.
 *
 * Layout: 4 fixed orbits at radii [14, 24, 34, 44] in a ±50-unit viewBox.
 * Aspect ratio is intentionally wide (`viewBox="-50 -28 100 56"`) to match
 * the prototype and read as a sky band, not a square.
 */
import { useMemo } from "react";
import type { Theme } from "../theme";
import { OrreryCenterStar, OrreryOrbitRing, OrreryPlanet, OrreryStarfield } from "..";
import type { AtlasPlanet } from "@/lib/orrery-adapters";

type Props = {
  t: Theme;
  planets: AtlasPlanet[];
  /** Currently hovered planet groupKey (drives hover ring). */
  hoveredKey?: string | null;
  /** Currently selected planet groupKey (persists on click). */
  selectedKey?: string | null;
  onHover?: (key: string | null) => void;
  onSelect?: (key: string | null) => void;
  /** Dimmed mode — used during day-replay overlay to fade base layer. */
  dimmed?: boolean;
};

export function Orrery({
  t,
  planets,
  hoveredKey = null,
  selectedKey = null,
  onHover,
  onSelect,
  dimmed = false,
}: Props) {
  // Memo the projected planets to avoid recomputing on hover.
  // (callsToPlanets already projects; this just stabilizes the array.)
  const visible = useMemo(() => planets, [planets]);

  return (
    <svg
      viewBox="-50 -28 100 56"
      preserveAspectRatio="xMidYMid meet"
      style={{
        width: "100%",
        height: "auto",
        display: "block",
        background: t.bg,
        borderRadius: 16,
      }}
      role="img"
      aria-label={`Orrery showing ${visible.length} call groups in orbit`}
    >
      <OrreryStarfield t={t} count={70} spread={[48, 24]} />
      <OrreryOrbitRing r={14} t={t} dashed />
      <OrreryOrbitRing r={24} t={t} dashed />
      <OrreryOrbitRing r={34} t={t} dashed />
      <OrreryOrbitRing r={44} t={t} dashed />
      <OrreryCenterStar t={t} />
      {visible.map((p) => {
        const isHovered = hoveredKey === p.groupKey;
        const isSelected = selectedKey === p.groupKey;
        return (
          <OrreryPlanet
            key={p.groupKey}
            p={p}
            t={t}
            hovered={isHovered || isSelected}
            onHover={() => onHover?.(p.groupKey)}
            onLeave={() => onHover?.(null)}
            onClick={() => onSelect?.(p.groupKey === selectedKey ? null : p.groupKey)}
            showRing={p.hot}
            dim={dimmed && !isSelected && !isHovered}
          />
        );
      })}
    </svg>
  );
}
