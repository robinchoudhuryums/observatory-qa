/* global React */
/* eslint-disable */
const {
  useState,
  ORRERY_LIGHT, ORRERY_DARK, TILT, orreryProject, brightToColor,
  OrreryTopBar, OrreryStarfield, OrreryKpi, OrreryCard, OrreryTag, OrreryThemeToggle,
} = window;
// =============================================================================
//  Orrery — Galaxy view (zoomed-out month/quarter)
//  Each day is a "planetary system" — 31 of them arranged in a spiral galaxy.
//  Brighter days closed more, denser days had more calls.
// =============================================================================

function OrreryGalaxy({ theme: themeProp = 'dark', onNavigate = null, onThemeChange = null }) {
  const [themeState, setThemeState] = useState(themeProp);
  const theme = onThemeChange ? themeProp : themeState;
  const setTheme = (next) => { if (onThemeChange) onThemeChange(next); else setThemeState(next); };
  const t = theme === 'light' ? ORRERY_LIGHT : ORRERY_DARK;
  const [hoveredDay, setHoveredDay] = useState(17);

  // 31 days of April, arranged on a logarithmic spiral
  const days = Array.from({ length: 31 }).map((_, i) => {
    const tt = i / 30;
    const ang = tt * Math.PI * 3.2 + 0.4;
    const r = 6 + tt * 36;
    const x = Math.cos(ang) * r;
    const y = Math.sin(ang) * r;
    const seed = Math.sin(i * 1.27) * Math.cos(i * 0.61);
    const calls = Math.round(80 + Math.abs(seed) * 90 + (i % 7 === 0 ? -40 : 0));
    const close = Math.max(0.25, Math.min(0.95, 0.55 + seed * 0.3 + (i === 16 ? 0.2 : 0)));
    return { d: i + 1, x, y, calls, close, weekend: i % 7 === 5 || i % 7 === 6, anchor: i === 16, anomaly: i === 22 };
  });

  const projected = days.map((d) => {
    const [px, py] = orreryProject(d.x, d.y);
    return { ...d, px, py, sz: 0.8 + (d.calls / 200) * 2.6, color: brightToColor(d.close, t) };
  });

  const hov = projected.find((d) => d.d === hoveredDay);

  return (
    <div style={{
      width: '100%', height: '100%', position: 'relative', overflow: 'hidden',
      background: t.bg, color: t.ink, fontFamily: "'Inter', sans-serif",
    }}>
      <div style={{ position: 'absolute', top: '40%', left: '40%', width: 700, height: 360, borderRadius: '50%', background: t.haloBg, filter: 'blur(160px)', pointerEvents: 'none' }} />

      <OrreryTopBar t={t} view="GALAXY" activeNav="Galaxy" onNavigate={onNavigate}
        extra={<OrreryThemeToggle theme={theme} t={t} onToggle={() => setTheme(theme === 'light' ? 'dark' : 'light')} />} />

      <div style={{ padding: '20px 28px 6px' }}>
        <OrreryTag t={t}>◇ APRIL 2026 · 31 DAYS · GALAXY VIEW</OrreryTag>
        <h1 style={{ fontFamily: '"Inter", system-ui, sans-serif', fontSize: 36, fontWeight: 400, letterSpacing: '-0.02em', margin: '4px 0 0', lineHeight: 1.05, color: t.ink }}>
          A galaxy of <span style={{ color: t.bright, fontWeight: 600, fontStyle: 'italic' }}>4,128 calls</span> across the month — the spiral shows how the practice moved.
        </h1>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 14, padding: '14px 28px 24px', height: 'calc(100% - 178px)' }}>
        {(() => {
          // Pattern 2 — galaxy canvas always dark, even on light page.
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
          <svg viewBox="-50 -28 100 56" preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: '100%' }}>
            <OrreryStarfield t={skyT} count={80} />

            <defs>
              <radialGradient id="gal-core" cx="0.5" cy="0.5" r="0.5">
                <stop offset="0%" stopColor={skyT.starCore} stopOpacity="1" />
                <stop offset="40%" stopColor={skyT.warm} stopOpacity="0.7" />
                <stop offset="100%" stopColor={skyT.starOuter} stopOpacity="0" />
              </radialGradient>
              <radialGradient id="gal-arm" cx="0.5" cy="0.5" r="0.5">
                <stop offset="0%" stopColor={skyT.bright} stopOpacity="0.18" />
                <stop offset="100%" stopColor={skyT.bright} stopOpacity="0" />
              </radialGradient>
            </defs>

            {/* galaxy arm haze */}
            <ellipse cx="0" cy="0" rx="36" ry="14" fill="url(#gal-arm)" />
            {/* spiral arm guide */}
            <path d={(() => {
              const pts = [];
              for (let i = 0; i <= 40; i++) {
                const tt = i / 40;
                const ang = tt * Math.PI * 3.2 + 0.4;
                const r = 6 + tt * 36;
                const [px, py] = orreryProject(Math.cos(ang) * r, Math.sin(ang) * r);
                pts.push(`${i === 0 ? 'M' : 'L'} ${px} ${py}`);
              }
              return pts.join(' ');
            })()} fill="none" stroke={skyT.orbit} strokeWidth="0.12" strokeDasharray="0.4 0.4" />

            {/* core */}
            <circle cx="0" cy="0" r="6" fill="url(#gal-core)" />
            <circle cx="0" cy="0" r="1.4" fill={skyT.starCore} />

            {/* days */}
            {projected.map((d) => (
              <g key={d.d}
                onMouseEnter={() => setHoveredDay(d.d)}
                style={{ cursor: 'pointer' }}>
                {d.anchor && <circle cx={d.px} cy={d.py} r={d.sz * 2.6} fill={skyT.bright} opacity="0.22" />}
                {d.anomaly && <circle cx={d.px} cy={d.py} r={d.sz * 1.7} fill="none" stroke={skyT.amber} strokeWidth="0.16" strokeDasharray="0.4 0.3" />}
                <circle cx={d.px} cy={d.py} r={d.sz} fill={d.color} opacity={d.weekend ? 0.55 : 0.92} />
                <ellipse cx={d.px - d.sz * 0.3} cy={d.py - d.sz * 0.3} rx={d.sz * 0.4} ry={d.sz * 0.3} fill={skyT.highlight} opacity={0.3} />
                {hoveredDay === d.d && <circle cx={d.px} cy={d.py} r={d.sz + 0.7} fill="none" stroke={skyT.bright} strokeWidth="0.18" />}
              </g>
            ))}

            {/* axis labels */}
            <text x="-46" y="26" fontSize="1.4" fill={skyT.inkMute} fontFamily="'JetBrains Mono', monospace">CORE · MONTH START</text>
            <text x="46" y="26" textAnchor="end" fontSize="1.4" fill={skyT.inkMute} fontFamily="'JetBrains Mono', monospace">EDGE · MONTH END</text>
          </svg>

          {/* Hover card */}
          {hov && (
            <div style={{ position: 'absolute', top: 14, right: 14, padding: '12px 14px', borderRadius: 8,
              background: t.name === 'dark' ? 'rgba(0,0,0,0.55)' : '#fff',
              border: `0.5px solid ${t.panelBorder}`, color: t.ink, minWidth: 180,
            }}>
              <OrreryTag t={t} color={t.bright}>◇ APR {String(hov.d).padStart(2, '0')} {hov.weekend ? '· WEEKEND' : ''}</OrreryTag>
              <div style={{ fontFamily: '"Inter", system-ui, sans-serif', fontSize: 18, fontStyle: 'italic', marginTop: 4 }}>{hov.calls} calls · {Math.round(hov.close * 100)}% close</div>
              <div style={{ fontSize: 11, color: t.inkSoft, marginTop: 4, lineHeight: 1.4 }}>
                {hov.anchor && 'Brightest day of the month — your anchor.'}
                {hov.anomaly && 'Volume spike: 2.1σ above the monthly trend.'}
                {!hov.anchor && !hov.anomaly && 'Steady day. Tracking close to month average.'}
              </div>
            </div>
          )}
        </div>
          );
        })()}

        {/* Rail */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <OrreryKpi t={t} label="Calls" value="4,128" delta="+12%" accentRamp="bright" />
            <OrreryKpi t={t} label="Close" value="68%" delta="+4pt" accentRamp="warm" />
          </div>
          <OrreryKpi t={t} label="Booked plans" value="$5.2M" delta="+18%" accentRamp="cool" />

          <OrreryCard t={t} style={{ flex: 1, background: `linear-gradient(135deg, ${t.bright}1a, ${t.starOuter}10)` }}>
            <OrreryTag t={t}>◇ THE MONTH IN GALAXY</OrreryTag>
            <div style={{ fontFamily: '"Inter", system-ui, sans-serif', fontStyle: 'italic', fontSize: 17, lineHeight: 1.35, marginTop: 8, color: t.ink }}>
              April spiraled outward and got brighter. Apr 17 was your anchor day. Weekends sat quietly in the haze.
            </div>
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: `0.5px solid ${t.panelBorder}`, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                { tag: 'ANCHOR', c: t.bright, t: 'Apr 17', b: '184 calls · 89% close · the brightest day.' },
                { tag: 'SPIKE', c: t.amber, t: 'Apr 23', b: 'Volume +2.1σ — investigate the source.' },
                { tag: 'TRAJECTORY', c: t.green, t: 'Wk 4', b: '+18% close vs Wk 1. Trending toward bright.' },
              ].map((m, i) => (
                <div key={i} style={{ paddingLeft: 9, borderLeft: `2px solid ${m.c}` }}>
                  <OrreryTag t={t} color={m.c}>{m.tag}</OrreryTag>
                  <div style={{ fontSize: 12, color: t.ink, marginTop: 1, fontWeight: 500 }}>{m.t}</div>
                  <div style={{ fontSize: 11, color: t.inkSoft, marginTop: 1, lineHeight: 1.4 }}>{m.b}</div>
                </div>
              ))}
            </div>
          </OrreryCard>
        </div>
      </div>
    </div>
  );
}

window.OrreryGalaxy = OrreryGalaxy;
