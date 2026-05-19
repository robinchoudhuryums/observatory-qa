/* global React */
/* eslint-disable */
const { useState: useStateReplay, useEffect: useEffectReplay, useRef: useRefReplay } = React;

// Day-replay overlay — simulates the day's calls landing one-by-one as bright stars
function OrreryDayReplay({ theme = 'dark', onClose = null }) {
  const t = theme === 'light' ? window.ORRERY_LIGHT : window.ORRERY_DARK;
  const [progress, setProgress] = useStateReplay(0); // 0..1
  const [playing, setPlaying] = useStateReplay(true);
  const rafRef = useRefReplay(null);
  const lastRef = useRefReplay(null);

  useEffectReplay(() => {
    if (!playing) {
      lastRef.current = null;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      return;
    }
    const tick = (ts) => {
      if (!lastRef.current) lastRef.current = ts;
      const dt = (ts - lastRef.current) / 1000;
      lastRef.current = ts;
      setProgress((p) => {
        const next = p + dt / 18; // 18s for full day
        if (next >= 1) { setPlaying(false); return 1; }
        return next;
      });
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [playing]);

  // build 24 calls scattered across orbits
  const calls = Array.from({ length: 24 }).map((_, i) => {
    const seedA = Math.sin(i * 1.31 + 0.5) * Math.cos(i * 0.71);
    const seedB = Math.sin(i * 0.91 + 1.2) * 0.5 + 0.5;
    const ring = i % 4;
    const a = (i / 24) * Math.PI * 2 + ring * 0.3;
    const sz = 0.7 + Math.abs(seedA) * 1.0;
    const br = Math.max(0.2, Math.min(1, seedB));
    const tHit = (i / 24) + (Math.abs(seedA) * 0.04);
    return { idx: i, ring, a, sz, br, tHit, score: Math.round((br * 4 + 5) * 10) / 10 };
  });
  const ringRadii = [12, 18, 24, 30];
  const projected = calls.map((c) => {
    const r = ringRadii[c.ring];
    const x = Math.cos(c.a) * r;
    const y = Math.sin(c.a) * r;
    const [px, py] = window.orreryProject(x, y);
    return { ...c, px, py };
  });

  const visible = projected.filter((c) => c.tHit <= progress);
  const closed = visible.filter((c) => c.br > 0.6).length;
  const totalSoFar = visible.length;

  // turn progress into hh:mm
  const minutesIn = Math.round(progress * 9 * 60); // 9-hour day
  const hr = 9 + Math.floor(minutesIn / 60);
  const mn = minutesIn % 60;
  const timeLabel = `${String(hr).padStart(2, '0')}:${String(mn).padStart(2, '0')}`;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 50,
        background: 'rgba(4, 8, 26, 0.92)',
        backdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        animation: 'orrery-overlay-in 320ms ease-out',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose && onClose(); }}
    >
      <style>{`
        @keyframes orrery-overlay-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes orrery-star-pop {
          0% { transform: scale(0); opacity: 0; }
          40% { transform: scale(1.6); opacity: 1; }
          100% { transform: scale(1); opacity: 0.95; }
        }
      `}</style>
      <div style={{
        width: 'min(1200px, 92vw)', height: 'min(720px, 88vh)',
        background: t.bg, borderRadius: 14, position: 'relative',
        border: `0.5px solid ${t.panelBorder}`,
        boxShadow: '0 30px 100px rgba(0,0,0,0.6)',
        overflow: 'hidden',
        color: t.ink, fontFamily: "'Inter', sans-serif",
      }}>
        {/* Halo */}
        <div style={{ position: 'absolute', top: '40%', left: '50%', transform: 'translate(-50%, -50%)', width: 700, height: 360, borderRadius: '50%', background: t.haloBg, filter: 'blur(160px)', pointerEvents: 'none' }} />

        {/* Header */}
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, padding: '20px 28px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 3 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <window.OrreryTag t={t} color={t.bright}>◇ DAY REPLAY</window.OrreryTag>
            <span style={{ fontFamily: '"Inter", system-ui, sans-serif', fontStyle: 'italic', fontSize: 28, color: t.ink, letterSpacing: '-0.01em' }}>Tuesday, March 18</span>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: `0.5px solid ${t.panelBorder}`, color: t.inkSoft, padding: '6px 14px', borderRadius: 6, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', letterSpacing: '0.05em' }}
          >Close ✕</button>
        </div>

        {/* Stage */}
        <svg viewBox="-44 -28 88 56" preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: '100%', position: 'absolute', inset: 0, zIndex: 1 }}>
          <window.OrreryStarfield t={t} count={70} />
          <defs>
            <radialGradient id="replay-star" cx="0.5" cy="0.5" r="0.5">
              <stop offset="0%" stopColor={t.starCore} stopOpacity="1" />
              <stop offset="35%" stopColor={t.starGlow1} stopOpacity="0.85" />
              <stop offset="100%" stopColor={t.starOuter} stopOpacity="0" />
            </radialGradient>
          </defs>
          {ringRadii.map((r, i) => (
            <ellipse key={i} cx="0" cy="0" rx={r} ry={r * window.TILT}
              fill="none" stroke={t.orbit} strokeWidth="0.12" strokeDasharray="0.4 0.4" opacity="0.6" />
          ))}
          <window.OrreryCenterStar t={t} idSeed="replay" />
          {visible.map((c) => {
            const color = window.brightToColor(c.br, t);
            const age = (progress - c.tHit) / 0.05;
            const scale = Math.min(1, age);
            return (
              <g key={c.idx} style={{ transformOrigin: `${c.px}px ${c.py}px`, transform: `scale(${scale})`, transition: 'transform 280ms ease-out' }}>
                <circle cx={c.px} cy={c.py} r={c.sz * 0.45} fill={color} opacity="0.4" filter="blur(0.6px)" />
                <circle cx={c.px} cy={c.py} r={c.sz * 0.28} fill={color} />
                <circle cx={c.px} cy={c.py} r={c.sz * 0.12} fill={t.starCore} opacity="0.8" />
              </g>
            );
          })}
        </svg>

        {/* Bottom HUD */}
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '20px 28px', zIndex: 3, background: `linear-gradient(180deg, transparent, ${t.bgFlat}d0)` }}>
          {/* timeline */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
            <button
              onClick={() => setPlaying(!playing)}
              style={{ width: 36, height: 36, borderRadius: 18, border: 'none', background: t.ink, color: t.bgFlat, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}
            >{playing ? '❚❚' : '▶'}</button>
            <div style={{ flex: 1, height: 4, background: t.panelBorder, borderRadius: 2, position: 'relative', cursor: 'pointer' }}
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const x = (e.clientX - rect.left) / rect.width;
                setProgress(Math.max(0, Math.min(1, x)));
                setPlaying(false);
              }}>
              <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${progress * 100}%`, background: `linear-gradient(90deg, ${t.warm}, ${t.bright})`, borderRadius: 2 }} />
              <div style={{ position: 'absolute', left: `${progress * 100}%`, top: '50%', transform: 'translate(-50%, -50%)', width: 14, height: 14, borderRadius: 7, background: t.bright, boxShadow: `0 0 12px ${t.bright}` }} />
            </div>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: t.ink, letterSpacing: '0.06em' }}>{timeLabel}</span>
          </div>

          {/* tickers */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 18, paddingTop: 12, borderTop: `0.5px solid ${t.panelBorder}` }}>
            <div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, color: t.inkMute, letterSpacing: '0.14em' }}>CALLS LANDED</div>
              <div style={{ fontFamily: '"Inter", system-ui, sans-serif', fontSize: 28, color: t.ink, marginTop: 2 }}>{totalSoFar}</div>
            </div>
            <div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, color: t.inkMute, letterSpacing: '0.14em' }}>BRIGHT (CLOSED)</div>
              <div style={{ fontFamily: '"Inter", system-ui, sans-serif', fontSize: 28, color: t.bright, marginTop: 2 }}>{closed}</div>
            </div>
            <div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, color: t.inkMute, letterSpacing: '0.14em' }}>CLOSE RATE</div>
              <div style={{ fontFamily: '"Inter", system-ui, sans-serif', fontSize: 28, color: t.ink, marginTop: 2 }}>{totalSoFar > 0 ? Math.round(closed / totalSoFar * 100) : 0}<span style={{ fontSize: 16, color: t.inkSoft }}>%</span></div>
            </div>
            <div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, color: t.inkMute, letterSpacing: '0.14em' }}>NEXT CALL</div>
              <div style={{ fontFamily: '"Inter", system-ui, sans-serif', fontStyle: 'italic', fontSize: 17, color: t.inkSoft, marginTop: 8 }}>
                {progress >= 1 ? 'Day complete' : 'Incoming…'}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

window.OrreryDayReplay = OrreryDayReplay;
