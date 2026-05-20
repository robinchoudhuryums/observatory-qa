/* global React */
/* eslint-disable */
const {
  ORRERY_LIGHT, ORRERY_DARK, OrreryOwl, OrreryStarfield, orreryProject, TILT,
} = window;
// =============================================================================
//  Orrery — Intro card for the Orrery World canvas section
// =============================================================================

function OrreryIntroCard() {
  const t = ORRERY_DARK;
  // sample planets for the intro hero
  const planets = [
    { o: 0, a: 0.4, sz: 2.2, br: 0.85 },
    { o: 0, a: 2.8, sz: 1.6, br: 0.7 },
    { o: 1, a: 1.0, sz: 3.0, br: 0.92 },
    { o: 1, a: 3.5, sz: 1.8, br: 0.45 },
    { o: 2, a: 0.5, sz: 2.0, br: 0.6 },
    { o: 2, a: 4.5, sz: 1.4, br: 0.4 },
  ];
  const orbits = [12, 22, 32];
  const proj = planets.map((p) => {
    const r = orbits[p.o];
    const x = Math.cos(p.a) * r;
    const y = Math.sin(p.a) * r;
    const [px, py] = orreryProject(x, y);
    return { ...p, px, py };
  });

  return (
    <div style={{
      width: '100%', height: '100%', position: 'relative', overflow: 'hidden',
      background: t.bg, color: t.ink, fontFamily: "'Inter', sans-serif",
      display: 'grid', gridTemplateColumns: '1.1fr 1fr',
    }}>
      {/* Left — pitch */}
      <div style={{ padding: '48px 48px 36px', display: 'flex', flexDirection: 'column', justifyContent: 'center', position: 'relative', zIndex: 2 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
          <OrreryOwl size={20} t={t} />
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10.5, color: t.bright, letterSpacing: '0.18em', textTransform: 'uppercase' }}>◇ OBSERVATORY WORLD · 5 SCREENS</span>
        </div>
        <h2 style={{ fontFamily: '"Inter", system-ui, sans-serif', fontSize: 52, fontWeight: 400, letterSpacing: '-0.025em', margin: 0, lineHeight: 1.0, color: t.ink }}>
          A model of the<br/>
          <span style={{ fontStyle: 'italic', color: t.bright, fontWeight: 600 }}>practice in orbit.</span>
        </h2>
        <div style={{ fontSize: 14, lineHeight: 1.6, color: t.inkSoft, marginTop: 18, maxWidth: 480 }}>
          Each call cluster is a planet around the practice's central star — sized by volume, brightened by close rate. The full system: dashboard, planet detail, call detail, galaxy view, and constellations.
        </div>
        <div style={{ marginTop: 28, paddingTop: 20, borderTop: `0.5px solid ${t.panelBorder}`, display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
          {[
            { n: 'I', name: 'Dashboard', tag: 'Hero · interactive' },
            { n: 'II', name: 'Planet', tag: 'Drill into a cluster' },
            { n: 'III', name: 'Call', tag: 'Single call as arc' },
            { n: 'IV', name: 'Galaxy', tag: 'Zoom out · month' },
            { n: 'V', name: 'Patterns', tag: 'Constellations' },
          ].map((s, i) => (
            <div key={i}>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, color: t.bright, letterSpacing: '0.1em' }}>{s.n}</div>
              <div style={{ fontFamily: '"Inter", system-ui, sans-serif', fontStyle: 'italic', fontSize: 17, color: t.ink, marginTop: 2 }}>{s.name}</div>
              <div style={{ fontSize: 10.5, color: t.inkMute, marginTop: 2, lineHeight: 1.3 }}>{s.tag}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Right — orrery preview */}
      <div style={{ position: 'relative', borderLeft: `0.5px solid ${t.panelBorder}` }}>
        <div style={{ position: 'absolute', top: '40%', left: '50%', transform: 'translate(-50%, -50%)', width: 400, height: 240, borderRadius: '50%', background: t.haloBg, filter: 'blur(120px)' }} />
        <svg viewBox="-44 -28 88 56" preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: '100%', position: 'relative', zIndex: 1 }}>
          <OrreryStarfield t={t} count={50} />
          <defs>
            <radialGradient id="intro-star" cx="0.5" cy="0.5" r="0.5">
              <stop offset="0%" stopColor={t.starCore} stopOpacity="1" />
              <stop offset="35%" stopColor={t.starGlow1} stopOpacity="0.85" />
              <stop offset="100%" stopColor={t.starOuter} stopOpacity="0" />
            </radialGradient>
          </defs>
          {orbits.map((r, i) => (
            <ellipse key={i} cx="0" cy="0" rx={r} ry={r * TILT}
              fill="none" stroke={t.orbit} strokeWidth="0.12" strokeDasharray="0.5 0.5" />
          ))}
          <circle cx="0" cy="0" r="6" fill="url(#intro-star)" />
          <circle cx="0" cy="0" r="1.4" fill={t.starCore} />
          {proj.map((p, i) => {
            const c = p.br > 0.8 ? t.bright : p.br > 0.6 ? t.warm : p.br > 0.4 ? t.cool : t.cold;
            return (
              <g key={i}>
                <ellipse cx={p.px} cy={p.py + p.sz * 0.5} rx={p.sz * 0.8} ry={p.sz * 0.25}
                  fill="#000" opacity="0.4" />
                <circle cx={p.px} cy={p.py} r={p.sz} fill={c} opacity="0.95" />
                <ellipse cx={p.px - p.sz * 0.3} cy={p.py - p.sz * 0.3}
                  rx={p.sz * 0.4} ry={p.sz * 0.3} fill="#fff" opacity="0.4" />
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

window.OrreryIntroCard = OrreryIntroCard;
