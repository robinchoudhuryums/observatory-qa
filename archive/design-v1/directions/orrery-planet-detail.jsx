/* global React */
/* eslint-disable */
const {
  useState,
  ORRERY_LIGHT, ORRERY_DARK, TILT, orreryProject, brightToColor,
  OrreryTopBar, OrreryCenterStar, OrreryOrbitRing, OrreryPlanet,
  OrreryStarfield, OrreryKpi, OrreryCard, OrreryTag, OrreryThemeToggle,
} = window;
// =============================================================================
//  Orrery — Planet Detail (drill-in to a single cluster)
//  Shows: the planet enlarged + its 19 individual calls as moons orbiting it,
//  KPI strip, list of calls beneath, mini "you are here" map back to the orrery.
// =============================================================================

function OrreryPlanetDetail({
  theme: themeProp = 'light',
  onNavigate = null, onThemeChange = null,
  planetLabel = 'Tx plan review',
}) {
  const [themeState, setThemeState] = useState(themeProp);
  const theme = onThemeChange ? themeProp : themeState;
  const setTheme = (next) => { if (onThemeChange) onThemeChange(next); else setThemeState(next); };
  const t = theme === 'light' ? ORRERY_LIGHT : ORRERY_DARK;
  const [selectedCall, setSelectedCall] = useState(2);

  // 19 calls become "moons" orbiting the planet, sized by call duration, brightness by individual score
  const calls = Array.from({ length: 19 }).map((_, i) => {
    const seedA = Math.sin(i * 1.31) * Math.cos(i * 0.71);
    const seedB = Math.sin(i * 0.91) * 0.5 + 0.5;
    const ring = i < 8 ? 0 : i < 14 ? 1 : 2;
    const a = (i / 19) * Math.PI * 2 + ring * 0.4;
    const sz = 0.8 + Math.abs(seedA) * 1.2;
    const br = Math.max(0.18, Math.min(1, seedB));
    return { idx: i, ring, a, sz, br, score: Math.round((br * 4 + 5) * 10) / 10, mins: Math.round(2 + Math.abs(seedA) * 9) };
  });

  const ringRadii = [10, 16, 22];
  const projected = calls.map((c) => {
    const r = ringRadii[c.ring];
    const x = Math.cos(c.a) * r;
    const y = Math.sin(c.a) * r;
    const [px, py] = orreryProject(x, y);
    return { ...c, px, py };
  }).sort((a, b) => a.py - b.py);

  const callList = [
    { name: 'Maria Hernandez',  time: '09:14', dur: '06:22', score: 9.2, status: 'CLOSED', plan: '$3.4k' },
    { name: 'Robert Chen',      time: '10:02', dur: '08:11', score: 8.8, status: 'CLOSED', plan: '$2.1k' },
    { name: 'Aaliyah Johnson',  time: '11:30', dur: '04:55', score: 9.5, status: 'CLOSED', plan: '$4.8k' },
    { name: 'David Park',       time: '12:18', dur: '03:41', score: 7.2, status: 'BOOKED', plan: '$1.2k' },
    { name: 'Lena Voss',        time: '13:44', dur: '07:08', score: 8.4, status: 'CLOSED', plan: '$2.9k' },
    { name: 'Marcus Bell',      time: '14:05', dur: '05:33', score: 8.0, status: 'CLOSED', plan: '$1.6k' },
    { name: 'Priya Shah',       time: '15:21', dur: '09:14', score: 9.1, status: 'CLOSED', plan: '$5.2k' },
    { name: 'Tomás Reyes',      time: '16:00', dur: '02:45', score: 6.4, status: 'PENDING', plan: '—' },
  ];

  return (
    <div style={{
      width: '100%', height: '100%', position: 'relative', overflow: 'hidden',
      background: t.bg, color: t.ink, fontFamily: "'Inter', sans-serif",
    }}>
      <div style={{ position: 'absolute', top: '32%', left: '38%', width: 520, height: 280, borderRadius: '50%', background: t.haloBg, filter: 'blur(120px)', pointerEvents: 'none' }} />

      <OrreryTopBar t={t} view="PLANET" activeNav="Atlas" onNavigate={onNavigate}
        extra={<OrreryThemeToggle theme={theme} t={t} onToggle={() => setTheme(theme === 'light' ? 'dark' : 'light')} />} />

      {/* Breadcrumb */}
      <div style={{ padding: '14px 28px 0', display: 'flex', alignItems: 'center', gap: 10 }}>
        <span onClick={() => onNavigate && onNavigate('dashboard')} style={{ cursor: onNavigate ? 'pointer' : 'default' }}>
          <OrreryTag t={t} color={t.inkMute}>← ORRERY</OrreryTag>
        </span>
        <span style={{ color: t.inkMute, fontSize: 11 }}>·</span>
        <OrreryTag t={t} color={t.inkMute}>MID · CLINICAL ORBIT</OrreryTag>
        <span style={{ color: t.inkMute, fontSize: 11 }}>·</span>
        <OrreryTag t={t} color={t.bright}>{planetLabel.toUpperCase()}</OrreryTag>
      </div>

      {/* Title */}
      <div style={{ padding: '8px 28px 4px' }}>
        <h1 style={{ fontFamily: '"Inter", system-ui, sans-serif', fontSize: 36, fontWeight: 400, letterSpacing: '-0.02em', margin: 0, lineHeight: 1.05, color: t.ink }}>
          <span style={{ fontStyle: 'italic' }}>Tx plan review</span> — <span style={{ color: t.bright, fontWeight: 600 }}>19 moons</span> in close orbit.
        </h1>
        <div style={{ fontSize: 13, color: t.inkSoft, marginTop: 4, maxWidth: 720, lineHeight: 1.5 }}>
          The brightest planet of the day, and the most consistent. Of 19 calls, 17 closed at 9.0+. Each moon below is one of those calls — bigger means longer, brighter means higher score.
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, padding: '14px 28px 24px', height: 'calc(100% - 220px)' }}>
        {/* Left: planet scene */}
        {(() => {
          // Pattern 2 — planet scene always dark.
          const isLightPage = t.name === 'light';
          const skyT = window.ORRERY_DARK || t;
          return (
        <div style={{
          position: 'relative', borderRadius: 14,
          background: isLightPage
            ? 'radial-gradient(ellipse at 50% 35%, #0c1538 0%, #04081a 75%)'
            : t.panel,
          backdropFilter: isLightPage ? 'none' : 'blur(8px)',
          border: `0.5px solid ${isLightPage ? 'rgba(255,255,255,0.06)' : t.panelBorder}`,
          boxShadow: isLightPage
            ? 'inset 0 0 0 1px rgba(255,255,255,0.04), 0 1px 2px rgba(20,30,60,0.10)'
            : 'none',
          overflow: 'hidden',
        }}>
          <svg viewBox="-32 -22 64 44" preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: '100%' }}>
            <OrreryStarfield t={skyT} count={30} spread={[30, 18]} />

            <defs>
              <radialGradient id="planet-detail-glow" cx="0.5" cy="0.5" r="0.5">
                <stop offset="0%" stopColor={skyT.bright} stopOpacity="0.55" />
                <stop offset="100%" stopColor={skyT.bright} stopOpacity="0" />
              </radialGradient>
              <radialGradient id="planet-detail-body" cx="0.4" cy="0.35" r="0.7">
                <stop offset="0%" stopColor={skyT.cool} />
                <stop offset="60%" stopColor={skyT.bright} />
                <stop offset="100%" stopColor={skyT.starOuter} />
              </radialGradient>
            </defs>

            {/* moon orbits */}
            {ringRadii.map((r, i) => (
              <ellipse key={i} cx="0" cy="0" rx={r} ry={r * TILT}
                fill="none" stroke={skyT.orbit} strokeWidth="0.12" strokeDasharray="0.4 0.4" />
            ))}

            {/* big planet glow */}
            <circle cx="0" cy="0" r="14" fill="url(#planet-detail-glow)" />
            {/* the planet itself */}
            <circle cx="0" cy="0" r="5" fill="url(#planet-detail-body)" />
            <ellipse cx="-1.5" cy="-1.5" rx="2.5" ry="1.8" fill={skyT.highlight} opacity={0.4} />
            <path d={`M 0 -5 A 5 5 0 0 1 0 5 A 2.5 5 0 0 1 0 -5 Z`}
              fill="#000" opacity={0.35} />
            {/* Saturn ring */}
            <ellipse cx="0" cy="0" rx="9" ry="3.6" fill="none" stroke={skyT.ringStroke} strokeWidth="0.25" />
            <ellipse cx="0" cy="0" rx="10.5" ry="4.2" fill="none" stroke={skyT.ringStroke} strokeWidth="0.18" opacity="0.5" />

            {/* moons (calls) */}
            {projected.map((m) => {
              const c = brightToColor(m.br, skyT);
              const isSel = m.idx === selectedCall;
              return (
                <g key={m.idx}
                  onClick={() => {
                    if (isSel && onNavigate) onNavigate('call', { callIdx: m.idx });
                    else setSelectedCall(m.idx);
                  }}
                  style={{ cursor: 'pointer' }}>
                  <ellipse cx={m.px} cy={m.py + m.sz * 0.5} rx={m.sz * 0.8} ry={m.sz * 0.2}
                    fill={skyT.shadow} opacity={0.4} />
                  {isSel && <circle cx={m.px} cy={m.py} r={m.sz * 2.2} fill={skyT.bright} opacity="0.18" />}
                  <circle cx={m.px} cy={m.py} r={m.sz} fill={c} opacity="0.92" />
                  <ellipse cx={m.px - m.sz * 0.3} cy={m.py - m.sz * 0.3}
                    rx={m.sz * 0.4} ry={m.sz * 0.3} fill={skyT.highlight} opacity={0.35} />
                  <path
                    d={`M ${m.px} ${m.py - m.sz} A ${m.sz} ${m.sz} 0 0 1 ${m.px} ${m.py + m.sz} A ${m.sz * 0.55} ${m.sz} 0 0 1 ${m.px} ${m.py - m.sz} Z`}
                    fill="#000" opacity={0.5}
                  />
                  {isSel && <circle cx={m.px} cy={m.py} r={m.sz + 0.6}
                    fill="none" stroke={skyT.bright} strokeWidth="0.2" />}
                </g>
              );
            })}
          </svg>

          {/* "You are here" mini-map — floating UI card, page-themed */}
          <div style={{ position: 'absolute', top: 14, right: 14, width: 130, height: 90, background: isLightPage ? '#fff' : (t.name === 'dark' ? 'rgba(0,0,0,0.4)' : 'rgba(255,255,255,0.85)'), borderRadius: 8, border: `0.5px solid ${t.panelBorder}`, padding: 8 }}>
            <OrreryTag t={t} color={t.inkMute} style={{ fontSize: 8.5 }}>YOU ARE HERE</OrreryTag>
            <svg viewBox="-30 -16 60 32" preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: 56 }}>
              {[14, 24, 34].map((r, i) => (
                <ellipse key={i} cx="0" cy="0" rx={r * 0.5} ry={r * 0.5 * TILT}
                  fill="none" stroke={t.orbit} strokeWidth="0.15" />
              ))}
              <circle cx="0" cy="0" r="1.5" fill={t.bright} />
              <circle cx={Math.cos(0.9) * 12} cy={Math.sin(0.9) * 12 * TILT} r="2" fill={t.bright} />
              <circle cx={Math.cos(0.9) * 12} cy={Math.sin(0.9) * 12 * TILT} r="3.5" fill="none" stroke={t.bright} strokeWidth="0.2" />
            </svg>
          </div>

          {/* Legend bottom */}
          <div style={{ position: 'absolute', bottom: 14, left: 14, fontSize: 9.5, color: skyT.inkSoft, fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.08em' }}>
            SIZE · DURATION   ·   BRIGHTNESS · INDIVIDUAL SCORE
          </div>
        </div>
          );
        })()}

        {/* Right: KPI + call list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            <OrreryKpi t={t} label="Calls" value="19" delta="+5" accentRamp="bright" />
            <OrreryKpi t={t} label="Avg score" value="9.1" delta="+0.4" accentRamp="warm" />
            <OrreryKpi t={t} label="Plans" value="$24k" delta="+18%" accentRamp="cool" />
          </div>

          <OrreryCard t={t} padded={false} style={{ overflow: 'hidden', flex: 1 }}>
            <div style={{ padding: '12px 14px 8px', borderBottom: `0.5px solid ${t.panelBorder}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <OrreryTag t={t}>◇ THE 19 CALLS</OrreryTag>
              <OrreryTag t={t} color={t.inkMute}>SORT · TIME ↓</OrreryTag>
            </div>
            <div style={{ overflow: 'auto', maxHeight: 'calc(100% - 38px)' }}>
              {callList.map((c, i) => {
                const isSel = i === selectedCall;
                return (
                  <div key={i}
                    onClick={() => {
                      if (isSel && onNavigate) onNavigate('call', { callIdx: i, callName: c.name });
                      else setSelectedCall(i);
                    }}
                    style={{
                      display: 'grid', gridTemplateColumns: '50px 1fr 70px 60px 70px',
                      alignItems: 'center', gap: 10,
                      padding: '11px 14px', cursor: 'pointer',
                      background: isSel ? `${t.bright}15` : 'transparent',
                      borderLeft: isSel ? `2px solid ${t.bright}` : '2px solid transparent',
                      borderBottom: `0.5px solid ${t.panelBorder}`,
                    }}
                  >
                    <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: t.inkSoft }}>{c.time}</span>
                    <div>
                      <div style={{ fontSize: 13, color: t.ink, fontWeight: 500 }}>{c.name}</div>
                      <div style={{ fontSize: 11, color: t.inkMute, marginTop: 1, fontFamily: "'JetBrains Mono', monospace" }}>{c.dur}</div>
                    </div>
                    <div style={{ fontFamily: '"Inter", system-ui, sans-serif', fontStyle: 'italic', fontSize: 19, color: t.ink, textAlign: 'right' }}>{c.score}</div>
                    <span style={{ fontSize: 9.5, fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.08em', color: c.status === 'CLOSED' ? t.green : c.status === 'BOOKED' ? t.bright : t.amber, textAlign: 'center' }}>{c.status}</span>
                    <span style={{ fontFamily: '"Inter", system-ui, sans-serif', fontStyle: 'italic', fontSize: 15, color: t.ink, textAlign: 'right' }}>{c.plan}</span>
                  </div>
                );
              })}
              <div style={{ padding: '12px 14px', textAlign: 'center', color: t.inkMute, fontSize: 11 }}>
                · 11 more ·
              </div>
            </div>
          </OrreryCard>
        </div>
      </div>
    </div>
  );
}

window.OrreryPlanetDetail = OrreryPlanetDetail;
