/**
 * Day Replay — full-screen overlay that animates today's calls as planets
 * popping into view across an 18-second timeline. Maps the day's actual call
 * uploadedAt timestamps to positions on a synthetic 9-hour business day,
 * then plays them back in compressed time.
 *
 * rAF-driven so we can pause/resume cleanly and respect tab visibility (the
 * browser throttles rAF when hidden, which naturally pauses the replay).
 *
 * Industry-agnostic: no copy mentions dental/medical workflows. The replay
 * is a pure visualization of the day's call arrival pattern.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CallWithDetails } from "@shared/schema";
import type { Theme } from "../theme";
import {
  OrreryCenterStar,
  OrreryOrbitRing,
  OrreryStarfield,
  OrreryTag,
  TILT,
  brightToColor,
} from "..";
import { LENSES, ORBIT_RADII } from "@/lib/orrery-lenses";

type Props = {
  t: Theme;
  calls: CallWithDetails[];
  open: boolean;
  onClose: () => void;
};

type ReplayPlanet = {
  /** Time the call appeared, normalized to 0-1 across the replay. */
  appearAt: number;
  px: number;
  py: number;
  sz: number;
  br: number;
  color: string;
};

const REPLAY_DURATION_SECONDS = 18;

export function DayReplay({ t, calls, open, onClose }: Props) {
  const [progress, setProgress] = useState(0);
  const [playing, setPlaying] = useState(true);
  const lastTsRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  // Compute replay planets from real calls. Mapped to ORBIT_RADII via the
  // "type" lens — gives the replay the same spatial layout as the Atlas hero.
  const replayPlanets = useMemo<ReplayPlanet[]>(() => {
    if (!open || calls.length === 0) return [];

    // Today's calls only, sorted by uploadedAt.
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const todays = calls
      .filter((c) => {
        if (!c.uploadedAt) return false;
        const t2 = new Date(c.uploadedAt);
        return t2 >= today && t2 < tomorrow;
      })
      .sort((a, b) => new Date(a.uploadedAt!).getTime() - new Date(b.uploadedAt!).getTime());

    if (todays.length === 0) return [];

    // Map each call's uploadedAt to a 0-1 progress value across the day.
    const first = new Date(todays[0].uploadedAt!).getTime();
    const last = new Date(todays[todays.length - 1].uploadedAt!).getTime();
    const span = Math.max(last - first, 1);

    // Assign orbit by category (stable hash → orbit 0-3).
    const lens = LENSES.type;
    const orbitForKey = (key: string): 0 | 1 | 2 | 3 => {
      let h = 0;
      for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
      return (Math.abs(h) % 4) as 0 | 1 | 2 | 3;
    };

    return todays.map((c, i) => {
      const key = lens.keyFor(c) || "uncategorized";
      const orbit = orbitForKey(key);
      const radius = ORBIT_RADII[orbit];
      // Distribute calls around the orbit by index to avoid collisions.
      const angle = (i / Math.max(todays.length, 1)) * Math.PI * 2 + orbit * 0.5;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius * TILT;

      // Brightness from performance score, fallback to mid.
      const scoreRaw = c.analysis?.performanceScore;
      const score = typeof scoreRaw === "string" ? parseFloat(scoreRaw) : (scoreRaw ?? 5);
      const br = Math.max(0, Math.min(1, (Number.isNaN(score) ? 5 : score) / 10));

      const appearAt = (new Date(c.uploadedAt!).getTime() - first) / span;
      return {
        appearAt,
        px: x,
        py: y,
        sz: 1.0 + br * 1.4,
        br,
        color: brightToColor(br, t),
      };
    });
  }, [calls, open, t]);

  // Replay clock — rAF loop, frame-rate independent via dt accumulation.
  // Naturally pauses when tab is hidden because requestAnimationFrame stops.
  useEffect(() => {
    if (!open || !playing) {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      lastTsRef.current = null;
      return;
    }
    const tick = (ts: number) => {
      if (lastTsRef.current === null) lastTsRef.current = ts;
      const dt = (ts - lastTsRef.current) / 1000;
      lastTsRef.current = ts;
      setProgress((p) => {
        const next = p + dt / REPLAY_DURATION_SECONDS;
        if (next >= 1) {
          setPlaying(false);
          return 1;
        }
        return next;
      });
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [open, playing]);

  // Reset state when the overlay closes.
  useEffect(() => {
    if (!open) {
      setProgress(0);
      setPlaying(true);
      lastTsRef.current = null;
    }
  }, [open]);

  const restart = useCallback(() => {
    setProgress(0);
    setPlaying(true);
    lastTsRef.current = null;
  }, []);

  if (!open) return null;

  const visibleCount = replayPlanets.filter((p) => p.appearAt <= progress).length;

  return (
    <div
      role="dialog"
      aria-label="Day replay"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        background: t.name === "dark" ? "rgba(4, 8, 26, 0.92)" : "rgba(14, 18, 40, 0.88)",
        backdropFilter: "blur(6px)",
        zIndex: 50,
        display: "flex",
        flexDirection: "column",
        animation: "celestial-pulse-in 320ms ease-out",
      }}
      onClick={onClose}
    >
      <div
        style={{ padding: "20px 28px", display: "flex", justifyContent: "space-between", alignItems: "center" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
          <OrreryTag t={t} color={t.bright}>
            ◇ DAY REPLAY
          </OrreryTag>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: t.inkSoft }}>
            {visibleCount} / {replayPlanets.length} calls
          </span>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button
            type="button"
            onClick={() => setPlaying((p) => !p)}
            style={controlButtonStyle(t)}
          >
            {playing ? "PAUSE" : "PLAY"}
          </button>
          <button type="button" onClick={restart} style={controlButtonStyle(t)}>
            RESTART
          </button>
          <button type="button" onClick={onClose} style={controlButtonStyle(t)}>
            CLOSE
          </button>
        </div>
      </div>

      <div
        style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 28px 28px" }}
        onClick={(e) => e.stopPropagation()}
      >
        {replayPlanets.length === 0 ? (
          <div
            style={{
              color: t.inkSoft,
              fontFamily: "'Instrument Serif', Georgia, serif",
              fontStyle: "italic",
              fontSize: 22,
              textAlign: "center",
            }}
          >
            No calls today yet — replay will fill in as calls arrive.
          </div>
        ) : (
          <svg
            viewBox="-50 -28 100 56"
            preserveAspectRatio="xMidYMid meet"
            style={{ width: "100%", maxWidth: 1100, height: "auto" }}
          >
            <OrreryStarfield t={t} count={80} spread={[48, 24]} />
            <OrreryOrbitRing r={14} t={t} dashed />
            <OrreryOrbitRing r={24} t={t} dashed />
            <OrreryOrbitRing r={34} t={t} dashed />
            <OrreryOrbitRing r={44} t={t} dashed />
            <OrreryCenterStar t={t} />
            {replayPlanets.map((p, i) => {
              const visible = p.appearAt <= progress;
              if (!visible) return null;
              // Star-pop animation: scale from 0 → 1.6 → 1 in 600ms.
              const age = progress - p.appearAt;
              const popPhase = Math.min(age / 0.05, 1); // 0..1 over the first 5% of replay time
              const scale = popPhase < 0.4 ? popPhase * 4 : 1 + (1 - popPhase) * 0.6;
              const sz = p.sz * Math.max(scale, 0.95);
              return (
                <g key={i}>
                  <circle cx={p.px} cy={p.py} r={sz * 2.2} fill={p.color} opacity={0.18} />
                  <circle cx={p.px} cy={p.py} r={sz} fill={p.color} opacity={0.95} />
                </g>
              );
            })}
          </svg>
        )}
      </div>

      <div
        style={{ padding: "0 28px 24px", display: "flex", alignItems: "center", gap: 14 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            flex: 1,
            height: 3,
            background: t.panelStroke,
            borderRadius: 100,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${progress * 100}%`,
              height: "100%",
              background: t.bright,
              transition: "width 80ms linear",
            }}
          />
        </div>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: t.inkMute, letterSpacing: "0.1em" }}>
          {Math.round(progress * 100)}%
        </span>
      </div>
    </div>
  );
}

function controlButtonStyle(t: Theme) {
  return {
    padding: "6px 14px",
    borderRadius: 6,
    background: "transparent",
    border: `0.5px solid ${t.panelBorder}`,
    fontSize: 10.5,
    color: t.inkSoft,
    fontFamily: "'JetBrains Mono', monospace",
    letterSpacing: "0.12em",
    cursor: "pointer",
  } as const;
}
