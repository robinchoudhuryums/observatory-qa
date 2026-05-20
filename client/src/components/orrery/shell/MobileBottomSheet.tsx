/**
 * Mobile bottom sheet — three snap heights (peek / half / full) with drag
 * handle. Used on the Atlas under the `md` breakpoint so the orrery hero
 * stays visible as the primary surface while the KPI strip + planet list
 * live in a draggable sheet below.
 *
 * Drag interaction is built on pointer events with manual snap thresholds
 * (no library) — the surface is simple enough that hand-rolling stays
 * cheaper than pulling in vaul/react-spring. If we hit edge cases (nested
 * scroll, multi-touch) in Phase 6 hardening, we can swap to vaul.
 *
 * Heights:
 *   peek — 18vh (just the handle + title)
 *   half — 50vh (KPI strip + first 3 planets)
 *   full — 85vh (everything)
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { Theme } from "../theme";

export type SnapHeight = "peek" | "half" | "full";

const SNAP_VH: Record<SnapHeight, number> = {
  peek: 18,
  half: 50,
  full: 85,
};

type Props = {
  t: Theme;
  initialSnap?: SnapHeight;
  /** Called when the user snaps to a new height. */
  onSnapChange?: (snap: SnapHeight) => void;
  children: ReactNode;
};

export function MobileBottomSheet({ t, initialSnap = "half", onSnapChange, children }: Props) {
  const [snap, setSnap] = useState<SnapHeight>(initialSnap);
  const dragStartY = useRef<number | null>(null);
  const dragStartVh = useRef<number | null>(null);
  const [dragOffsetVh, setDragOffsetVh] = useState(0);
  const sheetRef = useRef<HTMLDivElement>(null);

  const targetVh = SNAP_VH[snap] - dragOffsetVh;
  const heightVh = Math.max(10, Math.min(95, targetVh));

  const setSnapAndNotify = useCallback(
    (next: SnapHeight) => {
      setSnap(next);
      onSnapChange?.(next);
    },
    [onSnapChange],
  );

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    dragStartY.current = e.clientY;
    dragStartVh.current = window.innerHeight / 100;
    (e.target as Element).setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (dragStartY.current === null || dragStartVh.current === null) return;
    const dy = e.clientY - dragStartY.current; // positive = drag down = shrink
    const dvh = dy / dragStartVh.current;
    setDragOffsetVh(dvh);
  }, []);

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (dragStartY.current === null) return;
      const finalVh = SNAP_VH[snap] - dragOffsetVh;
      // Snap to the nearest of the three heights.
      const distances: { snap: SnapHeight; dist: number }[] = (
        ["peek", "half", "full"] as SnapHeight[]
      ).map((s) => ({ snap: s, dist: Math.abs(SNAP_VH[s] - finalVh) }));
      distances.sort((a, b) => a.dist - b.dist);
      setSnapAndNotify(distances[0].snap);
      dragStartY.current = null;
      dragStartVh.current = null;
      setDragOffsetVh(0);
      (e.target as Element).releasePointerCapture(e.pointerId);
    },
    [snap, dragOffsetVh, setSnapAndNotify],
  );

  // ESC key returns to peek.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && snap !== "peek") {
        setSnapAndNotify("peek");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [snap, setSnapAndNotify]);

  return (
    <div
      ref={sheetRef}
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        height: `${heightVh}vh`,
        background: t.name === "dark" ? "#06091c" : "#ffffff",
        borderTop: `0.5px solid ${t.panelBorder}`,
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        boxShadow: t.name === "dark" ? "0 -20px 50px rgba(0,0,0,0.5)" : "0 -8px 24px rgba(20,30,60,0.08)",
        zIndex: 30,
        display: "flex",
        flexDirection: "column",
        transition: dragStartY.current === null ? "height 280ms cubic-bezier(0.22, 1, 0.36, 1)" : "none",
        touchAction: "none",
      }}
      aria-label="Atlas detail sheet"
    >
      {/* Drag handle */}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{
          padding: "10px 0 6px",
          display: "flex",
          justifyContent: "center",
          cursor: "grab",
          touchAction: "none",
        }}
        aria-label="Drag to resize"
      >
        <div
          style={{
            width: 40,
            height: 4,
            borderRadius: 100,
            background: t.inkMute,
            opacity: 0.4,
          }}
        />
      </div>

      <div style={{ flex: 1, overflow: snap === "full" ? "auto" : "hidden", padding: "8px 18px 24px" }}>
        {children}
      </div>
    </div>
  );
}
