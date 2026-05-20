/* global React */
/* eslint-disable */
const { GradientText, IRIDESCENT, CYAN_300, CYAN_400, CYAN_500 } = window;
// =============================================================================
//  05 — ORRERY · isometric model of the practice's "solar system"
//  Center star = the practice today. Each planet = a call cluster, sized by
//  volume, brightened by close rate. Orbits ringed in iso perspective.
//  Subtle owl mark. Cyan-only palette.
// =============================================================================

function IsoDashboard() {
  // Iso projection: tilt the orbital plane
  const TILT = 0.42; // y-squash for isometric effect
  const iso = (x, y, z = 0) => [x, y * TILT - z];

  // 4 orbits, each a "shell" of call clusters
  const orbits = [
    { r: 14, label: 'Inner · routine', dim: 0.20 },
    { r: 24, label: 'Mid · clinical', dim: 0.16 },
    { r: 34, label: 'Outer · plans', dim: 0.12 },
    { r: 44, label: 'Far · referrals', dim: 0.09 },
  ];

  // Planets — each a call cluster.
  // angle in radians, orbit index, size (volume), brightness (close rate 0-1), label, hot
  const planets = [
    { o: 0, a: 0.4, sz: 2.6, br: 0.85, label: 'Cleanings',           ct: 38, hot: false },
    { o: 0, a: 2.1, sz: 1.8, br: 0.72, label: 'Reschedules',         ct: 22, hot: false },
    { o: 0, a: 4.6, sz: 1.4, br: 0.55, label: 'New patient',         ct: 14, hot: false },
    { o: 1, a: 0.9, sz: 3.4, br: 0.92, label: 'Tx plan review',      ct: 19, hot: true  },
    { o: 1, a: 3.0, sz: 2.0, br: 0.68, label: 'Pain / urgent',       ct: 11, hot: false },
    { o: 1, a: 5.2, sz: 1.6, br: 0.41, label: 'Post-op follow-up',   ct: 9,  hot: false },
    { o: 2, a: 0.2, sz: 2.2, br: 0.58, label: 'Crowns & bridges',    ct: 7,  hot: false },
    { o: 2, a: 2.5, sz: 2.8, br: 0.78, label: 'Ortho consult',       ct: 8,  hot: false },
    { o: 2, a: 4.1, sz: 1.2, br: 0.32, label: 'Implant inquiry',     ct: 4,  hot: false },
    { o: 3, a: 1.4, sz: 1.6, br: 0.61, label: 'Specialist refer',    ct: 5,  hot: false },
    { o: 3, a: 3.8, sz: 1.3, br: 0.48, label: 'Insurance verify',    ct: 6,  hot: false },
    { o: 3, a: 5.7, sz: 1.0, br: 0.22, label: 'Records request',     ct: 3,  hot: false },
  ];

  // brightness ramp
  const brightColor = (br) => {
    if (br > 0.8) return CYAN_500;
    if (br > 0.65) return CYAN_400;
    if (br > 0.5) return CYAN_300;
    if (br > 0.35) return '#9ee5ed';
    return '#cdedf2';
  };

  // Sort planets back-to-front by their projected y so closer ones overlap further
  const projected = planets.map((p) => {
    const o = orbits[p.o];
    const x = Math.cos(p.a) * o.r;
    const y = Math.sin(p.a) * o.r;
    const [px, py] = iso(x, y);
    return { ...p, px, py, orbitR: o.r };
  }).sort((a, b) => a.py - b.py);

  return (
    <div style={{
      width: '100%', height: '100%', position: 'relative', overflow: 'hidden',
      background: 'linear-gradient(180deg, #f6f8fb 0%, #eef2f8 100%)',
      fontFamily: "'Inter', sans-serif", color: '#1a1d2e',
    }}>
      {/* Soft cyan halo behind the orrery */}
      <div style={{ position: 'absolute', top: '38%', left: '32%', width: 600, height: 320, borderRadius: '50%', background: CYAN_300, filter: 'blur(140px)', opacity: 0.28, pointerEvents: 'none' }} />

      {/* Top bar */}
      <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 28px', borderBottom: '0.5px solid rgba(0,0,0,0.04)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <defs>
              <linearGradient id="iso-owl" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor={CYAN_300} />
                <stop offset="100%" stopColor={CYAN_500} />
              </linearGradient>
            </defs>
            <circle cx="8" cy="10" r="3" fill="url(#iso-owl)" opacity="0.35" />
            <circle cx="16" cy="10" r="3" fill="url(#iso-owl)" opacity="0.35" />
            <circle cx="8" cy="10" r="1.2" fill="#1a1d2e" />
            <circle cx="16" cy="10" r="1.2" fill="#1a1d2e" />
            <path d="M 11 13 L 12 15 L 13 13" stroke="#1a1d2e" strokeWidth="1" fill="none" />
          </svg>
          <span style={{ fontFamily: '"Inter", system-ui, sans-serif', fontStyle: 'italic', fontSize: 19 }}>Observatory</span>
        </div>
        <div style={{ display: 'flex', gap: 22, fontSize: 12.5, color: '#5a5f78' }}>
          <span style={{ color: '#1a1d2e', fontWeight: 500 }}>Atlas</span><span>Calls</span><span>Patterns</span><span>Reports</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ padding: '5px 10px', background: 'rgba(34,184,207,0.12)', borderRadius: 6, fontSize: 11, color: CYAN_500, fontFamily: "'JetBrains Mono', monospace" }}>VIEW · OBSERVATORY</div>
        </div>
      </div>

      {/* Header */}
      <div style={{ padding: '24px 28px 8px', position: 'relative' }}>
        <div style={{ fontSize: 10.5, color: '#5a5f78', letterSpacing: '0.12em', textTransform: 'uppercase', fontFamily: "'JetBrains Mono', monospace" }}>◇ Saturday · 26 April · clinical day-in-the-life</div>
        <h1 style={{ fontFamily: "'Instrument Serif', serif", fontSize: 38, fontWeight: 400, letterSpacing: '-0.02em', margin: '6px 0 0', lineHeight: 1.05, maxWidth: 720 }}>
          A model of <GradientText>134 calls</GradientText> in orbit — bigger planets carry more calls, brighter ones close.
        </h1>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 0, padding: '12px 28px 24px', position: 'relative', height: 'calc(100% - 200px)' }}>
        {/* Orrery scene */}
        <div style={{ position: 'relative', borderRadius: 14, background: 'rgba(255,255,255,0.6)', backdropFilter: 'blur(8px)', border: '0.5px solid rgba(0,0,0,0.05)', overflow: 'hidden' }}>
          <svg viewBox="-58 -32 116 64" preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: '100%' }}>
            <defs>
              <radialGradient id="orr-star" cx="0.5" cy="0.5" r="0.5">
                <stop offset="0%" stopColor="#fff" stopOpacity="1" />
                <stop offset="35%" stopColor={CYAN_300} stopOpacity="0.9" />
                <stop offset="100%" stopColor={CYAN_500} stopOpacity="0" />
              </radialGradient>
              <radialGradient id="orr-planet-glow" cx="0.5" cy="0.5" r="0.5">
                <stop offset="0%" stopColor={CYAN_400} stopOpacity="0.5" />
                <stop offset="100%" stopColor={CYAN_500} stopOpacity="0" />
              </radialGradient>
              <linearGradient id="orr-orbit-fade" x1="0" x2="1">
                <stop offset="0%" stopColor={CYAN_500} stopOpacity="0" />
                <stop offset="50%" stopColor={CYAN_500} stopOpacity="0.5" />
                <stop offset="100%" stopColor={CYAN_500} stopOpacity="0" />
              </linearGradient>
              <filter id="orr-blur" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="0.4" />
              </filter>
            </defs>

            {/* faint star field */}
            {Array.from({ length: 40 }).map((_, i) => {
              const x = (Math.sin(i * 7.13) * 56);
              const y = (Math.cos(i * 4.91) * 28);
              const r = 0.12 + (Math.sin(i * 3.7) + 1) * 0.08;
              return <circle key={i} cx={x} cy={y} r={r} fill="#1a1d2e" opacity={0.10 + (Math.cos(i * 2.3) + 1) * 0.05} />;
            })}

            {/* Orbits — drawn as iso ellipses */}
            {orbits.map((o, i) => (
              <g key={i}>
                <ellipse cx="0" cy="0" rx={o.r} ry={o.r * TILT} fill="none" stroke="rgba(26,29,46,0.10)" strokeWidth="0.15" strokeDasharray="0.6 0.5" />
                {/* tick marks */}
                {[0, Math.PI / 2, Math.PI, Math.PI * 1.5].map((ang, k) => {
                  const x = Math.cos(ang) * o.r;
                  const y = Math.sin(ang) * o.r;
                  const [px, py] = iso(x, y);
                  return <circle key={k} cx={px} cy={py} r="0.18" fill="rgba(26,29,46,0.20)" />;
                })}
              </g>
            ))}

            {/* Center star (the practice "today") */}
            <circle cx="0" cy="0" r="6" fill="url(#orr-star)" />
            <circle cx="0" cy="0" r="1.6" fill="#fff" stroke={CYAN_500} strokeWidth="0.2" />
            {/* star spikes */}
            {[0, Math.PI / 2].map((ang, i) => (
              <line key={i} x1={Math.cos(ang) * 3} y1={Math.sin(ang) * 3 * TILT} x2={Math.cos(ang) * -3} y2={Math.sin(ang) * -3 * TILT} stroke={CYAN_500} strokeWidth="0.15" opacity="0.5" />
            ))}

            {/* Planets */}
            {projected.map((p, i) => {
              const c = brightColor(p.br);
              return (
                <g key={i}>
                  {/* shadow puddle on the orbital plane */}
                  <ellipse cx={p.px} cy={p.py + p.sz * 0.6} rx={p.sz * 0.9} ry={p.sz * 0.3} fill="#1a1d2e" opacity="0.10" />
                  {/* glow if hot */}
                  {p.hot && <circle cx={p.px} cy={p.py} r={p.sz * 2.4} fill="url(#orr-planet-glow)" />}
                  {/* planet body — half-shaded for 3D feel */}
                  <circle cx={p.px} cy={p.py} r={p.sz} fill={c} opacity={0.92} />
                  {/* highlight crescent */}
                  <ellipse cx={p.px - p.sz * 0.3} cy={p.py - p.sz * 0.3} rx={p.sz * 0.45} ry={p.sz * 0.35} fill="#fff" opacity="0.55" />
                  {/* shadow side */}
                  <path
                    d={`M ${p.px} ${p.py - p.sz} A ${p.sz} ${p.sz} 0 0 1 ${p.px} ${p.py + p.sz} A ${p.sz * 0.55} ${p.sz} 0 0 1 ${p.px} ${p.py - p.sz} Z`}
                    fill="#1a1d2e" opacity="0.18"
                  />
                  {/* hot ring */}
                  {p.hot && (
                    <ellipse cx={p.px} cy={p.py} rx={p.sz * 1.7} ry={p.sz * 0.65} fill="none" stroke={CYAN_500} strokeWidth="0.18" opacity="0.7" />
                  )}
                </g>
              );
            })}

            {/* Annotation pin to the hot planet (Tx plan review) */}
            {(() => {
              const hot = projected.find((p) => p.hot);
              if (!hot) return null;
              return (
                <g>
                  <line x1={hot.px + hot.sz} y1={hot.py - hot.sz} x2={hot.px + 12} y2={hot.py - 14} stroke={CYAN_500} strokeWidth="0.18" />
                  <circle cx={hot.px + hot.sz} cy={hot.py - hot.sz} r="0.4" fill={CYAN_500} />
                </g>
              );
            })()}
          </svg>

          {/* Annotation card (HTML, positioned over the SVG) */}
          <div style={{ position: 'absolute', left: '60%', top: '20%', maxWidth: 200 }}>
            <div style={{ background: '#fff', borderRadius: 8, padding: '9px 12px', fontSize: 11, boxShadow: `0 8px 20px ${CYAN_500}33`, border: `0.5px solid ${CYAN_400}55` }}>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: CYAN_500, letterSpacing: '0.08em' }}>◇ BRIGHTEST PLANET</div>
              <div style={{ marginTop: 3, lineHeight: 1.4 }}>
                <strong style={{ fontWeight: 600 }}>Tx plan review</strong> — 19 calls · 92% close · $24k booked. The day's anchor.
              </div>
            </div>
          </div>

          {/* Legend — bottom left */}
          <div style={{ position: 'absolute', bottom: 14, left: 18, display: 'flex', gap: 14, fontSize: 10, color: '#5a5f78', fontFamily: "'JetBrains Mono', monospace", alignItems: 'center' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 9, height: 9, background: CYAN_500, borderRadius: '50%' }} />CLOSING
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 9, height: 9, background: CYAN_300, borderRadius: '50%' }} />CONVERTING
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 9, height: 9, background: '#cdedf2', borderRadius: '50%' }} />COOLING
            </span>
          </div>
          {/* axis labels */}
          <div style={{ position: 'absolute', bottom: 14, right: 18, fontSize: 10, color: '#5a5f78', fontFamily: "'JetBrains Mono', monospace" }}>radius · call type · size · volume · brightness · close rate</div>
        </div>

        {/* Right rail */}
        <div style={{ paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* KPI tiles */}
          {[
            { l: 'Today', v: '134', s: 'calls', d: '+18', c: CYAN_500 },
            { l: 'Avg score', v: '7.8', s: 'of 10', d: '+0.3', c: CYAN_400 },
            { l: 'Booked', v: '$184k', s: 'plans', d: '+22%', c: CYAN_300 },
          ].map((k, i) => (
            <div key={i} style={{ padding: '14px 18px', borderRadius: 12, background: 'rgba(255,255,255,0.7)', backdropFilter: 'blur(8px)', border: '0.5px solid rgba(0,0,0,0.05)', position: 'relative', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, ${k.c}, transparent)` }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span style={{ fontSize: 11, color: '#5a5f78', letterSpacing: '0.04em' }}>{k.l}</span>
                <span style={{ fontSize: 10, color: '#22a06b', fontFamily: "'JetBrains Mono', monospace" }}>↑ {k.d}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
                <span style={{ fontFamily: "'Instrument Serif', serif", fontSize: 30, fontStyle: 'italic', letterSpacing: '-0.02em' }}>{k.v}</span>
                <span style={{ fontSize: 11, color: '#5a5f78' }}>{k.s}</span>
              </div>
            </div>
          ))}

          {/* Daily story */}
          <div style={{ padding: '14px 18px', borderRadius: 12, background: 'linear-gradient(135deg, rgba(34,184,207,0.10), rgba(8,146,168,0.08))', border: '0.5px solid rgba(0,0,0,0.05)', flex: 1 }}>
            <div style={{ fontSize: 10.5, color: '#5a5f78', letterSpacing: '0.1em', textTransform: 'uppercase', fontFamily: "'JetBrains Mono', monospace", marginBottom: 6 }}>◇ The day in orbit</div>
            <div style={{ fontFamily: "'Instrument Serif', serif", fontStyle: 'italic', fontSize: 17, lineHeight: 1.35 }}>
              Tx plan review burned brightest. The inner orbit hummed quietly. Insurance verifications drifted in the cold outer dark.
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button style={{ flex: 1, padding: '8px 0', borderRadius: 7, border: 'none', background: '#1a1d2e', color: '#fff', fontSize: 11.5, fontWeight: 500 }}>Open replay</button>
              <button style={{ flex: 1, padding: '8px 0', borderRadius: 7, background: 'rgba(255,255,255,0.7)', color: '#1a1d2e', border: '0.5px solid rgba(0,0,0,0.08)', fontSize: 11.5, fontWeight: 500 }}>Coach orbit</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

window.IsoDashboard = IsoDashboard;
