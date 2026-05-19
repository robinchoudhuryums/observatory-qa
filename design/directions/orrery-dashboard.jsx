/* global React */
/* eslint-disable */
const {
  useState, useMemo,
  ORRERY_LIGHT, ORRERY_DARK, TILT, orreryProject, brightToColor,
  OrreryTopBar, OrreryCenterStar, OrreryOrbitRing, OrreryPlanet,
  OrreryStarfield, OrreryKpi, OrreryCard, OrreryTag, OrreryThemeToggle,
  LoadingPlanet, ProcessingBadge, DegradedNotice, RealismStyles,
} = window;
// =============================================================================
//  Orrery — Dashboard hero
//  Mapping A (default): orbit radius = call type cluster, planet size = volume,
//  brightness = close rate. Or pass `mapping="lifecycle"` for orbit = lifecycle stage.
// =============================================================================

function OrreryDashboard({
  theme: themeProp = 'light', mapping: mappingProp = 'type',
  onNavigate = null, onThemeChange = null, onMappingChange = null,
  showHeaderToggle = true,
  realism = 'normal', // 'normal' | 'flat-day' | 'partial'
  presentation = 'observatory', // 'observatory' | 'clinical'
  clinicalHero = 'swimlane', // 'swimlane' | 'scatter' | 'bars'
  onPresentationChange = null,
  onClinicalHeroChange = null,
}) {
  const clinical = presentation === 'clinical';
  const [themeState, setThemeState] = useState(themeProp);
  const theme = onThemeChange ? themeProp : themeState;
  const setTheme = (next) => { if (onThemeChange) onThemeChange(next); else setThemeState(next); };
  const mapping = mappingProp;
  const t = theme === 'light' ? ORRERY_LIGHT : ORRERY_DARK;
  const [hovered, setHovered] = useState(null);
  const [selected, setSelected] = useState(null);
  const [scrubHour, setScrubHour] = useState(14); // 6..20

  // ---- Data ----
  // orbit index, angle, size (volume), brightness (close rate), label, count, hot, anomaly, trajectory, coaching
  const orbitsType = [
    { r: 14, label: 'INNER · ROUTINE' },
    { r: 24, label: 'MID · CLINICAL' },
    { r: 34, label: 'OUTER · PLANS' },
    { r: 44, label: 'FAR · REFERRALS' },
  ];
  const orbitsLifecycle = [
    { r: 14, label: 'NEW PATIENT' },
    { r: 24, label: 'ACTIVE CARE' },
    { r: 34, label: 'RECALL & MAINTENANCE' },
    { r: 44, label: 'REFERRED OUT' },
  ];
  const orbits = mapping === 'lifecycle' ? orbitsLifecycle : orbitsType;

  const planets = [
    { o: 0, a: 0.4, sz: 2.6, br: 0.85, label: 'Cleanings',          ct: 38, score: 8.2 },
    { o: 0, a: 2.1, sz: 1.8, br: 0.72, label: 'Reschedules',        ct: 22, score: 7.4 },
    { o: 0, a: 4.6, sz: 1.4, br: 0.55, label: 'New patient',        ct: 14, score: 6.8 },
    { o: 1, a: 0.9, sz: 3.4, br: 0.92, label: 'Tx plan review',     ct: 19, score: 9.1, hot: true },
    { o: 1, a: 3.0, sz: 2.0, br: 0.68, label: 'Pain · urgent',      ct: 11, score: 7.0 },
    { o: 1, a: 5.2, sz: 1.6, br: 0.41, label: 'Post-op follow-up',  ct: 9,  score: 5.4, coaching: true },
    { o: 2, a: 0.2, sz: 2.2, br: 0.58, label: 'Crowns & bridges',   ct: 7,  score: 6.6 },
    { o: 2, a: 2.5, sz: 2.8, br: 0.78, label: 'Ortho consult',      ct: 8,  score: 8.0, trajectoryUp: true },
    { o: 2, a: 4.1, sz: 1.2, br: 0.32, label: 'Implant inquiry',    ct: 4,  score: 4.9, coaching: true },
    { o: 3, a: 1.4, sz: 1.6, br: 0.61, label: 'Specialist refer',   ct: 5,  score: 6.4 },
    { o: 3, a: 3.8, sz: 1.3, br: 0.48, label: 'Insurance verify',   ct: 6,  score: 5.8, anomaly: true },
    { o: 3, a: 5.7, sz: 1.0, br: 0.22, label: 'Records request',    ct: 3,  score: 4.5 },
  ];

  // Project planets to iso coords
  // Realism transforms applied to data
  const realPlanets = useMemo(() => {
    if (realism === 'day-1') return [];
    if (realism === 'day-1-afternoon') {
      // Just three planets — first day, mid-afternoon
      return [
        { o: 0, a: 1.6, sz: 2.0, br: 0.72, label: 'Cleanings',      ct: 4, score: 7.6 },
        { o: 1, a: 3.4, sz: 1.6, br: 0.58, label: 'New patient',    ct: 2, score: 6.5 },
        { o: 2, a: 0.8, sz: 1.4, br: 0.48, label: 'Reschedules',    ct: 1, score: 5.9 },
      ];
    }
    if (realism === 'flat-day') {
      // No anchor — everything mid-bright, smaller volumes, no hot/coaching/anomaly
      return planets.map((p) => ({
        ...p, br: 0.45 + (p.br - 0.5) * 0.15, ct: Math.max(1, Math.round(p.ct * 0.35)),
        hot: false, coaching: false, anomaly: false, trajectoryUp: false,
      }));
    }
    if (realism === 'partial') {
      // Mid-day: half the volumes, some pending
      return planets.map((p, i) => ({
        ...p, ct: Math.round(p.ct * 0.45), pending: i % 4 === 3,
      }));
    }
    return planets;
  }, [realism]);

  const projected = useMemo(() => realPlanets.map((p, idx) => {
    const o = orbits[p.o];
    const x = Math.cos(p.a) * o.r;
    const y = Math.sin(p.a) * o.r;
    const [px, py] = orreryProject(x, y);
    return { ...p, px, py, orbitR: o.r, idx };
  }).sort((a, b) => a.py - b.py), [orbits, realPlanets]);

  const hot = projected.find((p) => p.hot);
  const focused = selected !== null ? projected.find((p) => p.idx === selected) : null;
  const tipPlanet = hovered !== null ? projected.find((p) => p.idx === hovered) : null;
  const activePlanet = focused || tipPlanet;

  // Hour markers along the inner orbit (scrubber maps to angle in inner orbit)
  const scrubAngle = ((scrubHour - 6) / 14) * Math.PI * 2 - Math.PI / 2;
  const [scrubX, scrubY] = orreryProject(Math.cos(scrubAngle) * orbits[0].r, Math.sin(scrubAngle) * orbits[0].r);

  return (
    <div style={{
      width: '100%', height: '100%', position: 'relative', overflow: 'hidden',
      background: t.bg, color: t.ink, fontFamily: "'Inter', sans-serif",
    }}>
      {/* halo */}
      {!clinical && <div style={{ position: 'absolute', top: '38%', left: '32%', width: 600, height: 320, borderRadius: '50%', background: t.haloBg, filter: 'blur(140px)', pointerEvents: 'none' }} />}

      <OrreryTopBar t={t} view="ATLAS" activeNav="Atlas" presentation={presentation} onNavigate={onNavigate} extra={<>
        {clinical && window.HeroPicker && onClinicalHeroChange && (
          <window.HeroPicker t={t} value={clinicalHero} onChange={onClinicalHeroChange} />
        )}
        {window.PresentationBadge && onPresentationChange && (
          <window.PresentationBadge t={t} mode={presentation}
            onClick={() => onPresentationChange(clinical ? 'observatory' : 'clinical')} />
        )}
        <OrreryThemeToggle theme={theme} t={t} onToggle={() => setTheme(theme === 'light' ? 'dark' : 'light')} />
      </>} />

      {(() => {
        const accentSpan = (text) => (
          <span style={{ color: t.bright, fontWeight: clinical ? 600 : 600, fontStyle: clinical ? 'normal' : 'italic' }}>{text}</span>
        );
        const HEAD_OBS = {
          'normal':            { tag: 'SAT 26 APR · ',          h: <>A model of {accentSpan('134 calls')} in orbit — bigger planets carry more, brighter ones close.</> },
          'partial':           { tag: 'TUE 28 OCT · MID-DAY · ', h: <>So far today, {accentSpan('62 calls')} in orbit. The sky will fill as the day continues.</> },
          'flat-day':          { tag: 'WED 29 OCT · ',          h: <>A {accentSpan('quiet day')} — calls evenly distributed; no clear anchor in the sky.</> },
          'day-1':             { tag: 'MON 03 NOV · DAY 1 · ',  h: <>The {accentSpan('sky is empty')}. The first call lights the first planet.</> },
          'day-1-afternoon':   { tag: 'MON 03 NOV · DAY 1 · ',  h: <>{accentSpan('Three points of light')}. The sky is forming.</> },
          'low-confidence':    { tag: 'SAT 26 APR · ',          h: <>A model of {accentSpan('134 calls')} in orbit — bigger planets carry more, brighter ones close.</> },
          'transcribing':      { tag: 'SAT 26 APR · ',          h: <>A model of {accentSpan('134 calls')} in orbit — bigger planets carry more, brighter ones close.</> },
        };
        const HEAD_CLIN = {
          'normal':            { tag: 'SAT 26 APR · ',          h: <>{accentSpan('134 calls')} today. Larger clusters carry more volume; darker fills closed at higher rates.</> },
          'partial':           { tag: 'TUE 28 OCT · MID-DAY · ', h: <>{accentSpan('62 calls')} so far. The chart will continue to fill in as more calls complete.</> },
          'flat-day':          { tag: 'WED 29 OCT · ',          h: <>A {accentSpan('quiet day')} — calls evenly distributed; no single cluster dominated.</> },
          'day-1':             { tag: 'MON 03 NOV · DAY 1 · ',  h: <>{accentSpan('No calls yet')}. The first completed call will appear here.</> },
          'day-1-afternoon':   { tag: 'MON 03 NOV · DAY 1 · ',  h: <>{accentSpan('3 calls so far.')} Early data — patterns need ~14 days to stabilize.</> },
          'low-confidence':    { tag: 'SAT 26 APR · ',          h: <>{accentSpan('134 calls')} today. Larger clusters carry more volume; darker fills closed at higher rates.</> },
          'transcribing':      { tag: 'SAT 26 APR · ',          h: <>{accentSpan('134 calls')} today. Larger clusters carry more volume; darker fills closed at higher rates.</> },
        };
        const HEAD = clinical ? HEAD_CLIN : HEAD_OBS;
        const head = HEAD[realism] || HEAD.normal;
        const viewSlug = clinical ? 'BY CATEGORY · DAY VIEW' : (mapping === 'lifecycle' ? 'BY LIFECYCLE' : 'BY CALL TYPE') + ' · DAY-IN-THE-LIFE';
        return (
          <div style={{ padding: '22px 28px 6px', position: 'relative' }}>
            <OrreryTag t={t}>{clinical ? '◆' : '◇'} {head.tag}{viewSlug}</OrreryTag>
            <h1 style={{ fontFamily: '"Inter", system-ui, sans-serif', fontSize: 36, fontWeight: 400, letterSpacing: '-0.02em', margin: '4px 0 0', lineHeight: 1.05, maxWidth: 760, color: t.ink, fontStyle: clinical ? 'normal' : 'normal' }}>
              {head.h}
            </h1>
          </div>
        );
      })()}

      {/* Realism banners */}
      {realism !== 'normal' && realism !== 'low-confidence' && realism !== 'transcribing' && window.DegradedNotice && (
        <div style={{ padding: '0 28px 4px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {realism === 'partial' && (
            <window.DegradedNotice t={t} severity="warn"
              message={clinical
                ? '3 of 12 calls still processing. The dashboard will update as they complete.'
                : '3 of 12 calls still processing. The atlas will update as they land.'} />
          )}
          {realism === 'flat-day' && (
            <window.DegradedNotice t={t} severity="info"
              message="No clear top driver today — calls are evenly distributed in tone and outcome." />
          )}
          {realism === 'day-1' && (
            <window.DegradedNotice t={t} severity="info"
              message="Welcome. Your first call will appear here as soon as it completes." />
          )}
          {realism === 'day-1-afternoon' && (
            <window.DegradedNotice t={t} severity="info"
              message={clinical
                ? '3 calls in. Pattern detection needs ~14 days of data to stabilize.'
                : '3 calls in. Patterns and constellations need ~14 days of data — for now, the sky is forming.'} />
          )}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '10px 28px 24px', position: 'relative' }}>
        {/* Hero — full-width stage. The orrery (observatory mode) always
            renders against a dark sky, even on a light page (Pattern 2 —
            celestial canvases live in dark theme regardless of page chrome).
            Clinical heroes stay on page theme since they're chart-first. */}
        {clinical && window.ClinicalHero ? (
          <window.ClinicalHero
            variant={clinicalHero}
            t={t} planets={realPlanets} orbits={orbits} mapping={mapping}
            realism={realism}
            scrubHour={scrubHour} setScrubHour={setScrubHour}
            onNavigate={onNavigate} />
        ) : (() => {
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
          width: '100%', aspectRatio: '116 / 56',
          maxHeight: 520, alignSelf: 'stretch',
        }}>
          <svg viewBox="-58 -32 116 64" preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: '100%' }}>
            <OrreryStarfield t={skyT} count={60} />
            {orbits.map((o, i) => (
              <OrreryOrbitRing key={i} r={o.r} t={skyT} label={o.label} anchor={i % 2 === 0 ? 'right' : 'left'} />
            ))}

            {/* Scrubber dot on inner orbit */}
            <g>
              <circle cx={scrubX} cy={scrubY} r="0.55" fill={skyT.bright} opacity="0.9" />
              <circle cx={scrubX} cy={scrubY} r="1.4" fill={skyT.bright} opacity="0.18" />
              <line x1="0" y1="0" x2={scrubX} y2={scrubY} stroke={skyT.bright} strokeWidth="0.12" opacity="0.4" strokeDasharray="0.4 0.3" />
            </g>

            <g onClick={() => onNavigate && onNavigate('replay')} style={{ cursor: onNavigate ? 'pointer' : 'default' }}>
              <circle cx="0" cy="0" r="8" fill="transparent" />
              <OrreryCenterStar t={skyT} idSeed="dash" />
            </g>

            {/* Planets */}
            {projected.map((p) => (
              <OrreryPlanet
                key={p.idx} p={p} t={skyT}
                hovered={hovered === p.idx}
                onHover={() => setHovered(p.idx)}
                onLeave={() => setHovered(null)}
                onClick={() => setSelected(selected === p.idx ? null : p.idx)}
                showRing={p.hot}
                dim={focused && focused.idx !== p.idx}
                trajectory={p.trajectoryUp ? { dir: -Math.PI / 4, up: true } : null}
              />
            ))}

            {/* Hot annotation line */}
            {hot && !focused && !tipPlanet && (
              <g>
                <line x1={hot.px + hot.sz} y1={hot.py - hot.sz} x2={hot.px + 12} y2={hot.py - 14}
                  stroke={skyT.bright} strokeWidth="0.18" />
                <circle cx={hot.px + hot.sz} cy={hot.py - hot.sz} r="0.4" fill={skyT.bright} />
              </g>
            )}
          </svg>

          {/* Hover preview card */}
          {tipPlanet && !focused && (
            <div style={{
              position: 'absolute',
              left: `calc(50% + ${(tipPlanet.px / 116) * 100}% + 14px)`,
              top: `calc(50% + ${(tipPlanet.py / 64) * 100}% - 30px)`,
              maxWidth: 230,
              background: t.name === 'dark' ? 'rgba(12,21,56,0.92)' : '#fff',
              backdropFilter: 'blur(12px)',
              borderRadius: 8, padding: '11px 13px',
              fontSize: 11, lineHeight: 1.45,
              boxShadow: t.name === 'dark' ? '0 12px 36px rgba(0,0,0,0.5)' : `0 8px 22px ${t.bright}33`,
              border: `0.5px solid ${t.panelBorder}`,
              pointerEvents: 'none', transition: 'opacity 200ms', color: t.ink,
            }}>
              <OrreryTag t={t} color={t.bright}>◇ {tipPlanet.hot ? 'BRIGHTEST · ANCHOR' : tipPlanet.coaching ? 'COACHING · DIM' : tipPlanet.anomaly ? 'OUT OF ORBIT' : 'CLUSTER'}</OrreryTag>
              <div style={{ fontFamily: '"Inter", system-ui, sans-serif', fontSize: 18, marginTop: 3, lineHeight: 1.15 }}>{tipPlanet.label}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 8, fontSize: 10.5 }}>
                <div><div style={{ color: t.inkMute, fontFamily: "'JetBrains Mono', monospace", fontSize: 9 }}>CALLS</div><div style={{ fontFamily: '"Inter", system-ui, sans-serif', fontStyle: 'italic', fontSize: 16 }}>{tipPlanet.ct}</div></div>
                <div><div style={{ color: t.inkMute, fontFamily: "'JetBrains Mono', monospace", fontSize: 9 }}>SCORE</div><div style={{ fontFamily: '"Inter", system-ui, sans-serif', fontStyle: 'italic', fontSize: 16 }}>{tipPlanet.score}</div></div>
                <div><div style={{ color: t.inkMute, fontFamily: "'JetBrains Mono', monospace", fontSize: 9 }}>CLOSE</div><div style={{ fontFamily: '"Inter", system-ui, sans-serif', fontStyle: 'italic', fontSize: 16 }}>{Math.round(tipPlanet.br * 100)}%</div></div>
              </div>
            </div>
          )}

          {/* Focused (selected) detail card */}
          {focused && (
            <div style={{
              position: 'absolute', left: 18, top: 18, maxWidth: 280,
              background: t.name === 'dark' ? 'rgba(12,21,56,0.92)' : '#fff',
              backdropFilter: 'blur(12px)',
              borderRadius: 10, padding: '14px 16px',
              boxShadow: t.name === 'dark' ? '0 16px 40px rgba(0,0,0,0.55)' : `0 10px 28px ${t.bright}30`,
              border: `0.5px solid ${t.panelBorder}`, color: t.ink,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <OrreryTag t={t} color={t.bright}>◇ FOCUSED · {orbits[focused.o].label.split(' · ')[0]}</OrreryTag>
                <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', color: t.inkMute, cursor: 'pointer', fontSize: 14, padding: 0, lineHeight: 1 }}>×</button>
              </div>
              <div style={{ fontFamily: '"Inter", system-ui, sans-serif', fontSize: 22, marginTop: 4 }}>{focused.label}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginTop: 10, fontSize: 11 }}>
                {[
                  ['CALLS', focused.ct],
                  ['SCORE', focused.score],
                  ['CLOSE', `${Math.round(focused.br * 100)}%`],
                ].map(([l, v], i) => (
                  <div key={i}>
                    <div style={{ color: t.inkMute, fontFamily: "'JetBrains Mono', monospace", fontSize: 9 }}>{l}</div>
                    <div style={{ fontFamily: '"Inter", system-ui, sans-serif', fontStyle: 'italic', fontSize: 18 }}>{v}</div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: `0.5px solid ${t.panelBorder}`, fontSize: 11, lineHeight: 1.4, color: t.inkSoft }}>
                {focused.hot && 'Brightest planet of the day — your anchor. Patients are saying yes.'}
                {focused.coaching && 'Bright in volume, dim in close. The coaching opportunity sits here.'}
                {focused.anomaly && 'Out of usual orbit. Volume up 2.4σ vs last 30 days. Worth a look.'}
                {!focused.hot && !focused.coaching && !focused.anomaly && 'Steady cluster. Tracking close to last week.'}
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
                <button
                  onClick={() => onNavigate && onNavigate('planet', { planetId: focused.idx, planetLabel: focused.label })}
                  style={{ flex: 1, padding: '7px 0', borderRadius: 6, border: 'none', background: t.ink, color: t.bgFlat, fontSize: 11, fontWeight: 500, cursor: 'pointer' }}
                >Open planet →</button>
                <button style={{ flex: 1, padding: '7px 0', borderRadius: 6, background: 'transparent', color: t.ink, border: `0.5px solid ${t.panelBorder}`, fontSize: 11, fontWeight: 500, cursor: 'pointer' }}>Coach</button>
              </div>
            </div>
          )}

          {/* Hot anchor card (when nothing focused/hovered) */}
          {hot && !focused && !tipPlanet && (
            <div style={{ position: 'absolute', left: '60%', top: '20%', maxWidth: 200 }}>
              <div style={{ background: t.name === 'dark' ? 'rgba(12,21,56,0.92)' : '#fff', borderRadius: 8, padding: '9px 12px', fontSize: 11, boxShadow: t.name === 'dark' ? '0 8px 22px rgba(0,0,0,0.5)' : `0 8px 20px ${t.bright}33`, border: `0.5px solid ${t.panelBorder}`, color: t.ink }}>
                <OrreryTag t={t} color={t.bright}>◇ BRIGHTEST PLANET</OrreryTag>
                <div style={{ marginTop: 3, lineHeight: 1.4 }}><strong style={{ fontWeight: 600 }}>Tx plan review</strong> — 19 calls · 92% close · the day's anchor.</div>
              </div>
            </div>
          )}

          {/* Time scrubber */}
          <div style={{ position: 'absolute', bottom: 14, left: 18, right: 18, display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, letterSpacing: '0.12em', color: skyT.inkSoft, textTransform: 'uppercase' }}>HOUR</span>
            <div style={{ flex: 1, position: 'relative', height: 18, display: 'flex', alignItems: 'center' }}>
              <div style={{ position: 'absolute', left: 0, right: 0, height: 1, background: skyT.panelBorder }} />
              {/* hour ticks */}
              {Array.from({ length: 15 }).map((_, i) => {
                const hour = 6 + i;
                return (
                  <div key={i} style={{
                    position: 'absolute', left: `${(i / 14) * 100}%`,
                    top: scrubHour === hour ? 0 : 6, bottom: scrubHour === hour ? 0 : 6,
                    width: 1, background: scrubHour === hour ? skyT.bright : skyT.inkMute,
                    opacity: scrubHour === hour ? 1 : 0.4, transition: 'all 200ms',
                  }} />
                );
              })}
              <input
                type="range" min={6} max={20} step={1} value={scrubHour}
                onChange={(e) => setScrubHour(parseInt(e.target.value))}
                style={{ position: 'absolute', inset: 0, width: '100%', opacity: 0, cursor: 'pointer', margin: 0 }}
              />
            </div>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: skyT.bright, minWidth: 50, textAlign: 'right' }}>
              {String(scrubHour).padStart(2, '0')}:00
            </span>
          </div>

          {/* Legend */}
          <div style={{ position: 'absolute', top: 14, right: 18, display: 'flex', gap: 12, fontSize: 9.5, color: skyT.inkSoft, fontFamily: "'JetBrains Mono', monospace", alignItems: 'center', letterSpacing: '0.08em' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 9, height: 9, background: skyT.bright, borderRadius: '50%' }} />CLOSING</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 9, height: 9, background: skyT.cool, borderRadius: '50%' }} />WARM</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 9, height: 9, background: skyT.cold, borderRadius: '50%' }} />COOL</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 9, height: 9, border: `1px dashed ${skyT.amber}`, borderRadius: '50%' }} />ANOMALY</span>
          </div>
        </div>
          );
          })()}

        {/* Below-hero content — varies by realism state. The "right rail"
            is gone; content now distributes horizontally below the stage. */}
        {realism === 'day-1' ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, maxWidth: 1080, width: '100%', alignSelf: 'center' }}>
            <OrreryCard t={t} style={{ background: `linear-gradient(135deg, ${t.bright}1a, ${t.starOuter}10)`, padding: '18px 18px 16px', borderLeft: `2px solid ${t.bright}` }}>
              {clinical && window.ClinicalSignature
                ? <window.ClinicalSignature t={t} verb="STANDING BY" timestamp="DAY 1 · NO CALLS YET" confidence="med" />
                : window.OwlSignature
                ? <window.OwlSignature t={t} verb="WAITING" timestamp="DAY 1 · NO CALLS YET" confidence="med" />
                : <OrreryTag t={t}>◇ ORY · WAITING</OrreryTag>}
              <div style={{ fontFamily: '"Inter", system-ui, sans-serif', fontStyle: clinical ? 'normal' : 'italic', fontSize: 19, lineHeight: 1.3, marginTop: 10, color: t.ink, fontWeight: clinical ? 500 : 400 }}>
                {clinical ? 'Welcome to Observatory.' : 'Welcome to the observatory.'}
              </div>
              <div style={{ fontSize: 12.5, color: t.inkSoft, marginTop: 8, lineHeight: 1.55 }}>
                {clinical
                  ? 'Your first completed call will appear here. As more come in, a daily summary will form.'
                  : 'Your first call lights the first planet. As more come in, an atlas of the day will form here.'}
              </div>
            </OrreryCard>

            <OrreryCard t={t} style={{ padding: '14px 18px' }}>
              <OrreryTag t={t}>◇ GETTING STARTED</OrreryTag>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
                {[
                  { n: '01', title: 'Phone line connected', done: true, body: '(555) 240-1180 · forwarding active.' },
                  { n: '02', title: 'EHR sync', done: false, body: 'Connect Open Dental to enrich patient context.' },
                  { n: '03', title: 'Add your team', done: false, body: '2 of 5 seats invited.' },
                  { n: '04', title: 'First call', done: false, body: 'Waiting — usually within the first business hour.' },
                ].map((s, i) => (
                  <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <span style={{
                      flex: '0 0 18px', width: 18, height: 18, borderRadius: '50%',
                      border: `1px solid ${s.done ? t.green : t.panelBorder}`,
                      background: s.done ? t.green : 'transparent',
                      color: s.done ? t.bgFlat : t.inkMute,
                      fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, letterSpacing: '0.06em',
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      marginTop: 1,
                    }}>{s.done ? '✓' : s.n}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12.5, color: t.ink, fontWeight: 500, textDecoration: s.done ? 'line-through' : 'none', textDecorationColor: t.inkMute }}>{s.title}</div>
                      <div style={{ fontSize: 11, color: t.inkSoft, marginTop: 2, lineHeight: 1.45 }}>{s.body}</div>
                    </div>
                  </div>
                ))}
              </div>
              <button style={{ marginTop: 14, padding: '8px 12px', borderRadius: 7, border: 'none', background: t.ink, color: t.bgFlat, fontSize: 11.5, fontWeight: 500, width: '100%', cursor: 'pointer' }}>
                Continue setup →
              </button>
            </OrreryCard>
          </div>
        ) : realism === 'day-1-afternoon' ? (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
              <OrreryCard t={t} style={{ background: `linear-gradient(135deg, ${t.bright}1a, ${t.starOuter}10)`, padding: '14px 18px', borderLeft: `2px solid ${t.bright}`, gridColumn: 'span 2' }}>
                {clinical && window.ClinicalSignature
                  ? <window.ClinicalSignature t={t} verb="MONITORING" timestamp="DAY 1 · 2:14 PM" confidence="med" />
                  : window.OwlSignature
                  ? <window.OwlSignature t={t} verb="OBSERVING" timestamp="DAY 1 · 2:14 PM" confidence="med" />
                  : <OrreryTag t={t}>◇ ORY · OBSERVING</OrreryTag>}
                <div style={{ fontFamily: '"Inter", system-ui, sans-serif', fontStyle: clinical ? 'normal' : 'italic', fontSize: 17, lineHeight: 1.35, marginTop: 8, color: t.ink, fontWeight: clinical ? 500 : 400 }}>
                  {clinical
                    ? <>Three calls so far. The highest-closing leaned toward <span style={{ color: t.bright }}>cleanings</span>.</>
                    : <>Three calls so far. The brightest leans toward <span style={{ color: t.bright }}>cleanings</span>.</>}
                </div>
                <div style={{ fontSize: 12.5, color: t.inkMute, marginTop: 8, lineHeight: 1.55 }}>
                  {clinical
                    ? 'Pattern detection needs ~2 weeks of data. For now, each call is summarized as it completes.'
                    : <>Patterns and anchors take a few weeks to form. For now, I'm watching each call as it lands.</>}
                </div>
              </OrreryCard>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <OrreryKpi t={t} plain={clinical} label="Calls" value="3" sub="day 1" accentRamp="bright" />
                <OrreryKpi t={t} plain={clinical} label="Score" value="6.7" sub="of 10" accentRamp="warm" />
              </div>
            </div>
            <OrreryCard t={t} style={{ padding: '14px 18px' }}>
              <OrreryTag t={t}>◇ FIRST CALLS</OrreryTag>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginTop: 10 }}>
                {[
                  { time: '10:14', title: 'Cleanings · Maria L.', body: 'Booked. 6.8/10.' },
                  { time: '11:42', title: 'New patient · Eric T.', body: 'Wants to schedule a consult. 7.1/10.' },
                  { time: '13:58', title: 'Reschedules · Jen M.', body: 'Moved next Tue. 5.9/10.' },
                ].map((m, i) => (
                  <div key={i} style={{ paddingLeft: 9, borderLeft: `2px solid ${t.cool}` }}>
                    <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, color: t.inkMute, letterSpacing: '0.1em' }}>{m.time}</span>
                    <div style={{ fontSize: 12.5, color: t.ink, marginTop: 1, fontWeight: 500 }}>{m.title}</div>
                    <div style={{ fontSize: 11, color: t.inkSoft, marginTop: 1, lineHeight: 1.4 }}>{m.body}</div>
                  </div>
                ))}
              </div>
            </OrreryCard>
          </>
        ) : (
          <>
            {/* Row 1: Day-in-orbit summary + Ory noticed, side by side */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <OrreryCard t={t} style={{ background: `linear-gradient(135deg, ${t.bright}1a, ${t.starOuter}10)`, padding: '14px 18px', borderLeft: `2px solid ${t.bright}` }}>
                {clinical && window.ClinicalSignature
                  ? <window.ClinicalSignature t={t}
                      verb={realism === 'partial' ? 'MONITORING' : 'SUMMARY'}
                      timestamp={realism === 'partial' ? 'MID-DAY · IN PROGRESS' : 'END OF DAY · OPEN REPLAY'}
                      confidence={realism === 'flat-day' ? 'low' : realism === 'partial' ? 'med' : null} />
                  : window.OwlSignature
                  ? <window.OwlSignature t={t} verb={realism === 'partial' ? 'OBSERVING' : 'OBSERVED'}
                      timestamp={realism === 'partial' ? 'MID-DAY · STILL WATCHING' : 'DAY · CLICK SUN TO REPLAY'}
                      confidence={realism === 'flat-day' ? 'low' : realism === 'partial' ? 'med' : null} />
                  : <OrreryTag t={t}>◇ THE DAY IN ORBIT · CLICK SUN TO REPLAY</OrreryTag>}
                {realism === 'flat-day' ? (
                  <>
                    <div style={{ fontFamily: '"Inter", system-ui, sans-serif', fontStyle: clinical ? 'normal' : 'italic', fontSize: 17, lineHeight: 1.35, marginTop: 8, color: t.ink, fontWeight: clinical ? 500 : 400 }}>
                      {clinical
                        ? 'No standout cluster today. Calls were steady; no single category dominated.'
                        : 'Nothing burned brightest today. Calls came in steady; no planet pulled the sky.'}
                    </div>
                    <div style={{ fontSize: 12.5, color: t.inkSoft, marginTop: 8, lineHeight: 1.5 }}>
                      {clinical
                        ? 'Quiet days happen. Monitoring will resume tomorrow.'
                        : 'Quiet days happen. I\'ll keep watching for the next anchor.'}
                    </div>
                  </>
                ) : realism === 'partial' ? (
                  <>
                    <div style={{ fontFamily: '"Inter", system-ui, sans-serif', fontStyle: clinical ? 'normal' : 'italic', fontSize: 17, lineHeight: 1.35, marginTop: 8, color: t.ink, fontWeight: clinical ? 500 : 400 }}>
                      <strong style={{ fontWeight: 400, color: t.bright, fontStyle: 'normal', fontFamily: "'JetBrains Mono', monospace", fontSize: 13, letterSpacing: '0.06em' }}>SO FAR.</strong> {clinical
                        ? 'Tx plan review leading (8 calls). New patient warming.'
                        : 'Tx plan review trending bright (8 calls). New patient warming.'}
                    </div>
                    <div style={{ fontSize: 12.5, color: t.inkMute, marginTop: 8, lineHeight: 1.5 }}>
                      {clinical
                        ? 'Half a day to go. Top driver still forming.'
                        : 'Half a day to go. Anchors are still forming.'}
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ fontFamily: '"Inter", system-ui, sans-serif', fontStyle: clinical ? 'normal' : 'italic', fontSize: 18, lineHeight: 1.3, marginTop: 8, color: t.ink, fontWeight: clinical ? 500 : 400 }}>
                      <strong style={{ fontWeight: 400, color: t.bright, fontStyle: 'normal', fontFamily: "'JetBrains Mono', monospace", fontSize: 13, letterSpacing: '0.06em' }}>{clinical ? 'HIGH.' : 'BRIGHT.'}</strong> {clinical
                        ? 'Tx plan review closed highest. Two new patients accepted by lunch.'
                        : 'Tx plan review burned brightest. Two new patients said yes by lunch.'}
                    </div>
                    <div style={{ fontFamily: '"Inter", system-ui, sans-serif', fontStyle: clinical ? 'normal' : 'italic', fontSize: 16, lineHeight: 1.3, marginTop: 8, color: t.inkSoft }}>
                      <strong style={{ fontWeight: 400, color: t.amber, fontStyle: 'normal', fontFamily: "'JetBrains Mono', monospace", fontSize: 13, letterSpacing: '0.06em' }}>{clinical ? 'LOW.' : 'DIM.'}</strong> Post-op follow-ups closed at 41% — last week 62%.
                    </div>
                  </>
                )}
                <button
                  onClick={() => onNavigate && onNavigate('replay')}
                  disabled={realism === 'partial'}
                  style={{ marginTop: 12, padding: '8px 12px', borderRadius: 7, border: 'none',
                    background: realism === 'partial' ? (t.name === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)') : t.ink,
                    color: realism === 'partial' ? t.inkMute : t.bgFlat,
                    fontSize: 11.5, fontWeight: 500, width: '100%', cursor: realism === 'partial' ? 'default' : 'pointer' }}
                >{realism === 'partial' ? 'Day still in progress' : (clinical ? '▶ Open day replay' : '▶ Open day replay')}</button>
              </OrreryCard>

              <OrreryCard t={t} style={{ padding: '14px 18px', borderLeft: `2px solid ${t.bright}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  {clinical ? (
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: t.bright }} />
                  ) : window.OwlMark
                    ? <window.OwlMark size={18} t={t} state="attention" signal={true} />
                    : <span style={{ width: 8, height: 8, borderRadius: '50%', background: t.bright }} />}
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, letterSpacing: '0.14em', color: t.bright, textTransform: 'uppercase' }}>
                    {clinical ? '◆ AI Assist · Flagged' : '◇ Ory noticed'}
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {[
                    { kind: 'TRACKED',  title: 'Insurance Snag · 2 new instances', body: 'The pattern you\'re tracking surfaced twice since Monday. Both calls dropped 18-23pt at the cost moment.', cta: 'Open both →', dest: 'patterns', color: t.bright },
                    { kind: 'COACHING', title: 'Sarah · 2 of 4 tasks complete',    body: 'Halfway through the cost-handoff brief. Self-recorded 2 calls; next check-in due Friday.', cta: 'View session →', dest: 'coaching', color: t.warm },
                    { kind: 'ANOMALY',  title: 'Cleanings · brighter than usual',  body: '+12pt close rate today vs 30-day baseline. Want to investigate or just enjoy it?', cta: 'Investigate →', dest: null, color: t.green },
                  ].map((n, i) => (
                    <div key={i} style={{ paddingLeft: 11, borderLeft: `2px solid ${n.color}` }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                        <OrreryTag t={t} color={n.color}>{clinical ? '◆' : '◇'} {n.kind}</OrreryTag>
                        <button aria-label="Dismiss" style={{ background: 'transparent', border: 'none', color: t.inkMute, cursor: 'pointer', fontSize: 13, padding: 0, lineHeight: 1, opacity: 0.6 }}>✕</button>
                      </div>
                      <div style={{ fontSize: 12.5, color: t.ink, marginTop: 2, fontWeight: 500 }}>{n.title}</div>
                      <div style={{ fontSize: 11, color: t.inkSoft, marginTop: 2, lineHeight: 1.45 }}>{n.body}</div>
                      <button onClick={() => n.dest && onNavigate && onNavigate(n.dest)} style={{
                        marginTop: 6, padding: 0, background: 'transparent', border: 'none',
                        fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: '0.10em',
                        color: n.color, cursor: n.dest ? 'pointer' : 'default', textTransform: 'uppercase',
                      }}>{n.cta}</button>
                    </div>
                  ))}
                </div>
              </OrreryCard>
            </div>

            {/* Row 2: KPIs */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
              <OrreryKpi t={t} plain={clinical} label="Calls"  value="134"   delta="+18"   accentRamp="bright" />
              <OrreryKpi t={t} plain={clinical} label="Score"  value="7.8"   sub="of 10"   delta="+0.3"  accentRamp="warm" />
              <OrreryKpi t={t} plain={clinical} label="Booked" value="$184k" sub="plans"   delta="+22%"  accentRamp="cool" />
            </div>

            {/* Row 3: Today's moments — 4 across instead of stacked */}
            <OrreryCard t={t} style={{ padding: '14px 18px' }}>
              <OrreryTag t={t}>{clinical ? '◆ TODAY’S MOMENTS' : '◇ TODAY’S MOMENTS'}</OrreryTag>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginTop: 10 }}>
                {(clinical ? [
                  { tag: 'TOP DRIVER', color: t.bright, title: 'Tx plan review',     body: '92% close · today\'s top driver.' },
                  { tag: 'COACH',      color: t.amber,  title: 'Post-op follow-up', body: 'Low close where volume is high. −21pt vs last week.' },
                  { tag: 'ANOMALY',    color: t.amber,  title: 'Insurance verify',  body: 'Volume up 2.4σ vs 30-day avg. Pattern emerging.' },
                  { tag: 'TRENDING',   color: t.green,  title: 'Ortho consult',     body: '+18% close vs last week. Trending up.' },
                ] : [
                  { tag: 'ANCHOR',     color: t.bright, title: 'Tx plan review',     body: '92% close · the day\'s anchor.' },
                  { tag: 'COACH',      color: t.amber,  title: 'Post-op follow-up', body: 'Dim where it should be bright. -21pt vs last week.' },
                  { tag: 'ORBIT-OUT',  color: t.amber,  title: 'Insurance verify',  body: 'Volume up 2.4σ vs 30-day avg. Pattern emerging.' },
                  { tag: 'TRAJECTORY', color: t.green,  title: 'Ortho consult',     body: '+18% close vs last week. Trending toward bright.' },
                ]).map((m, i) => (
                  <div key={i} style={{ paddingLeft: 9, borderLeft: `2px solid ${m.color}` }}>
                    <OrreryTag t={t} color={m.color}>{m.tag}</OrreryTag>
                    <div style={{ fontSize: 12.5, color: t.ink, marginTop: 1, fontWeight: 500 }}>{m.title}</div>
                    <div style={{ fontSize: 11, color: t.inkSoft, marginTop: 1, lineHeight: 1.4 }}>{m.body}</div>
                  </div>
                ))}
              </div>
            </OrreryCard>
          </>
        )}
      </div>
    </div>
  );
}

window.OrreryDashboard = OrreryDashboard;
