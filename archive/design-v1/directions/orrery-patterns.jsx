/* global React */
/* eslint-disable */
const {
  useState, useMemo,
  ORRERY_LIGHT, ORRERY_DARK, TILT, orreryProject, brightToColor,
  OrreryTopBar, OrreryCenterStar, OrreryOrbitRing, OrreryStarfield,
  OrreryKpi, OrreryCard, OrreryTag, OrreryThemeToggle,
} = window;
// =============================================================================
//  Orrery — Patterns view (constellations between planets)
//  AI-detected patterns drawn as connecting lines between planets.
//  Each pattern gets a name (Insurance Snag · Plan Acceptance · Recall Drift).
// =============================================================================

function OrreryPatterns({ theme: themeProp = 'dark', onNavigate = null, onThemeChange = null, realism = 'normal', presentation = 'observatory', clinicalPatternHero = 'network', onPresentationChange = null, onClinicalPatternHeroChange = null }) {
  const [themeState, setThemeState] = useState(themeProp);
  const theme = onThemeChange ? themeProp : themeState;
  const setTheme = (next) => { if (onThemeChange) onThemeChange(next); else setThemeState(next); };
  const t = theme === 'light' ? ORRERY_LIGHT : ORRERY_DARK;
  const clinical = presentation === 'clinical';
  const [activePattern, setActivePattern] = useState(0);
  const [trackOpen, setTrackOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState(null);
  const [tracked, setTracked] = useState({}); // { [patternName]: trigger }
  const [toast, setToast] = useState(null);   // { pattern, trigger }
  const openTrack = (e) => {
    setAnchorRect(e.currentTarget.getBoundingClientRect());
    setTrackOpen(true);
  };
  const onTrackSaved = ({ trigger, pattern }) => {
    setTracked(prev => ({ ...prev, [pattern.name]: trigger }));
    setTrackOpen(false);
    setToast({ pattern, trigger });
  };

  // Fixed planet layout (same as dashboard for continuity)
  const orbits = [{ r: 14 }, { r: 24 }, { r: 34 }, { r: 44 }];
  const planets = [
    { id: 'cleanings',     o: 0, a: 0.4, sz: 2.6, br: 0.85, label: 'Cleanings' },
    { id: 'reschedules',   o: 0, a: 2.1, sz: 1.8, br: 0.72, label: 'Reschedules' },
    { id: 'newpatient',    o: 0, a: 4.6, sz: 1.4, br: 0.55, label: 'New patient' },
    { id: 'txplan',        o: 1, a: 0.9, sz: 3.4, br: 0.92, label: 'Tx plan review' },
    { id: 'pain',          o: 1, a: 3.0, sz: 2.0, br: 0.68, label: 'Pain · urgent' },
    { id: 'postop',        o: 1, a: 5.2, sz: 1.6, br: 0.41, label: 'Post-op follow-up' },
    { id: 'crowns',        o: 2, a: 0.2, sz: 2.2, br: 0.58, label: 'Crowns & bridges' },
    { id: 'ortho',         o: 2, a: 2.5, sz: 2.8, br: 0.78, label: 'Ortho consult' },
    { id: 'implant',       o: 2, a: 4.1, sz: 1.2, br: 0.32, label: 'Implant inquiry' },
    { id: 'specialist',    o: 3, a: 1.4, sz: 1.6, br: 0.61, label: 'Specialist refer' },
    { id: 'insurance',     o: 3, a: 3.8, sz: 1.3, br: 0.48, label: 'Insurance verify' },
    { id: 'records',       o: 3, a: 5.7, sz: 1.0, br: 0.22, label: 'Records request' },
  ];
  const projected = planets.map((p) => {
    const o = orbits[p.o];
    const x = Math.cos(p.a) * o.r;
    const y = Math.sin(p.a) * o.r;
    const [px, py] = orreryProject(x, y);
    return { ...p, px, py };
  });
  const byId = Object.fromEntries(projected.map((p) => [p.id, p]));

  const patterns = [
    {
      name: 'Insurance Snag',
      tag: 'PATTERN · 38 OCCURRENCES',
      color: t.amber,
      summary: 'Calls that hit insurance verification mid-conversation lose 23% in close rate. The constellation links the planets where this most often happens.',
      nodes: ['insurance', 'crowns', 'txplan', 'implant', 'specialist'],
      edges: [['insurance', 'crowns'], ['insurance', 'txplan'], ['insurance', 'implant'], ['insurance', 'specialist']],
      stat: '−23pt',
      statLabel: 'CLOSE RATE',
    },
    {
      name: 'Plan Acceptance',
      tag: 'PATTERN · 142 OCCURRENCES',
      color: t.bright,
      summary: 'Patients who reach Tx plan review after a routine cleaning close at 91%. The brightest path through your week.',
      nodes: ['cleanings', 'txplan', 'crowns', 'ortho'],
      edges: [['cleanings', 'txplan'], ['txplan', 'crowns'], ['txplan', 'ortho']],
      stat: '91%',
      statLabel: 'CLOSE RATE',
    },
    {
      name: 'Recall Drift',
      tag: 'PATTERN · 64 OCCURRENCES',
      color: t.cool,
      summary: 'Reschedules that bypass the cleanings planet drift outward — fewer end up booking. The constellation shows where to intervene.',
      nodes: ['reschedules', 'newpatient', 'pain', 'postop'],
      edges: [['reschedules', 'newpatient'], ['reschedules', 'postop'], ['postop', 'pain']],
      stat: '−18%',
      statLabel: 'BOOK RATE',
    },
  ];

  const active = patterns[activePattern];
  const isActiveNode = (id) => active.nodes.includes(id);

  return (
    <div style={{
      width: '100%', height: '100%', position: 'relative', overflow: 'hidden',
      background: t.bg, color: t.ink, fontFamily: "'Inter', sans-serif",
    }}>
      {!clinical && <div style={{ position: 'absolute', top: '40%', left: '32%', width: 600, height: 320, borderRadius: '50%', background: t.haloBg, filter: 'blur(140px)', pointerEvents: 'none' }} />}

      <OrreryTopBar t={t} view="PATTERNS" activeNav="Patterns" presentation={presentation} onNavigate={onNavigate}
        extra={<>
          {clinical && window.PatternHeroPicker && onClinicalPatternHeroChange && (
            <window.PatternHeroPicker t={t} value={clinicalPatternHero} onChange={onClinicalPatternHeroChange} />
          )}
          {window.PresentationBadge && onPresentationChange && (
            <window.PresentationBadge t={t} mode={presentation}
              onClick={() => onPresentationChange(clinical ? 'observatory' : 'clinical')} />
          )}
          <OrreryThemeToggle theme={theme} t={t} onToggle={() => setTheme(theme === 'light' ? 'dark' : 'light')} />
        </>} />

      <div style={{ padding: '20px 28px 6px' }}>
        <OrreryTag t={t}>{clinical ? '◆' : '◇'} {realism === 'pre-data'
          ? 'NOV · DAY 6 OF ~14'
          : (clinical ? 'APR · PATTERN DETECTION · LAST 30 DAYS' : 'APR · CONSTELLATIONS BETWEEN PLANETS')}</OrreryTag>
        <h1 style={{ fontFamily: '"Inter", system-ui, sans-serif', fontSize: 36, fontWeight: 400, letterSpacing: '-0.02em', margin: '4px 0 0', lineHeight: 1.05, color: t.ink, maxWidth: 760 }}>
          {realism === 'pre-data'
            ? (clinical
              ? <>Patterns are <span style={{ color: t.bright, fontWeight: 600 }}>still forming</span>.</>
              : <>Constellations are <span style={{ color: t.bright, fontWeight: 600, fontStyle: 'italic' }}>still forming</span>.</>)
            : (clinical
              ? <>Ory detected <span style={{ color: t.bright, fontWeight: 600 }}>three patterns</span> this month.</>
              : <>Ory drew <span style={{ color: t.bright, fontWeight: 600, fontStyle: 'italic' }}>three constellations</span> in your sky.</>)
          }
        </h1>
      </div>

      {realism !== 'normal' && window.DegradedNotice && (
        <div style={{ padding: '0 28px 4px' }}>
          {realism === 'partial' && (
            <window.DegradedNotice t={t} severity="info"
              message={clinical
                ? "Patterns shown reflect the morning's calls only. The map updates as the day completes."
                : "Patterns shown reflect the morning's calls only. The constellation map updates as the day completes."} />
          )}
          {realism === 'flat-day' && (
            <window.DegradedNotice t={t} severity="warn"
              message={clinical
                ? 'Only 6 days of data available — patterns are tentative. ~14 days needed for confident detection.'
                : 'Only 6 days of data available — patterns are tentative. Ory needs ~14 days to draw confident constellations.'} />
          )}
        </div>
      )}

      {realism === 'pre-data' ? (
        <div style={{ padding: '40px 28px', display: 'flex', justifyContent: 'center' }}>
          <OrreryCard t={t} style={{ maxWidth: 720, width: '100%', padding: '40px 32px', textAlign: 'center' }}>
            {clinical && window.ClinicalSignature ? (
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10 }}>
                <window.ClinicalSignature t={t} verb="STANDING BY" timestamp="DAY 6 OF ~14" confidence="low" />
              </div>
            ) : window.OwlSignature && (
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10 }}>
                <window.OwlSignature t={t} verb="WAITING" timestamp="DAY 6 OF ~14" confidence="low" />
              </div>
            )}
            {window.EmptyGlyph && <div style={{ display: 'flex', justifyContent: 'center', marginTop: 4 }}><window.EmptyGlyph t={t} kind="no-constellation" /></div>}
            <div style={{ fontFamily: '"Inter", system-ui, sans-serif', fontStyle: clinical ? 'normal' : 'italic', fontWeight: clinical ? 500 : 400, fontSize: 28, lineHeight: 1.2, color: t.ink, margin: '18px auto 0', maxWidth: 480 }}>
              {clinical
                ? 'Insufficient data. No patterns to surface yet.'
                : 'Three points of light. No lines yet.'}
            </div>
            <div style={{ fontSize: 13.5, color: t.inkSoft, lineHeight: 1.6, margin: '14px auto 0', maxWidth: 460 }}>
              {clinical
                ? <>Patterns surface when repeated relationships between call types, outcomes, or time-of-day reach significance. Detection requires <strong>~14 days</strong> of data.</>
                : <>Patterns surface as constellations — repeated relationships between call types, outcomes, or time of day. They need <strong>~14 days</strong> of data before I can draw them confidently.</>}
            </div>
            <div style={{ fontSize: 12.5, color: t.inkMute, lineHeight: 1.6, margin: '10px auto 0', maxWidth: 420, fontStyle: clinical ? 'normal' : 'italic' }}>
              {clinical ? 'Currently day 6.' : "You're on day 6. I'm watching."}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 22 }}>
              <button onClick={() => onNavigate && onNavigate('dashboard')}
                style={{ padding: '8px 14px', borderRadius: 7, border: `0.5px solid ${t.panelBorder}`, background: 'transparent', color: t.ink, fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>
                {clinical ? 'Back to Dashboard' : 'Back to Atlas'}
              </button>
              <button
                style={{ padding: '8px 14px', borderRadius: 7, border: 'none', background: t.ink, color: t.bgFlat, fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>
                Notify me when patterns form
              </button>
            </div>
          </OrreryCard>
        </div>
      ) : (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 14, padding: '14px 28px 24px', height: 'calc(100% - 188px)' }}>
        {/* Sky / Network */}
        {clinical && window.ClinicalPatternHero ? (
          <window.ClinicalPatternHero
            variant={clinicalPatternHero}
            t={t} patterns={patterns} planets={planets} byId={byId}
            activePattern={activePattern} setActivePattern={setActivePattern} />
        ) : (() => {
          // Pattern 2: celestial canvas always renders against dark sky,
          // even on a light page. Re-token SVG internals to ORRERY_DARK.
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
          width: '100%', aspectRatio: '116 / 56', maxHeight: 520,
          alignSelf: 'flex-start',
        }}>
          <svg viewBox="-58 -32 116 64" preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: '100%' }}>
            <OrreryStarfield t={skyT} count={70} />

            {/* faint orbits */}
            {orbits.map((o, i) => (
              <ellipse key={i} cx="0" cy="0" rx={o.r} ry={o.r * TILT}
                fill="none" stroke={skyT.orbit} strokeWidth="0.1" strokeDasharray="0.4 0.4" />
            ))}

            {/* center star */}
            <defs>
              <radialGradient id="pat-star" cx="0.5" cy="0.5" r="0.5">
                <stop offset="0%" stopColor={skyT.starCore} stopOpacity="1" />
                <stop offset="35%" stopColor={skyT.starGlow1} stopOpacity="0.85" />
                <stop offset="100%" stopColor={skyT.starOuter} stopOpacity="0" />
              </radialGradient>
            </defs>
            <circle cx="0" cy="0" r="6" fill="url(#pat-star)" />
            <circle cx="0" cy="0" r="1.4" fill={skyT.starCore} />

            {/* All planets — dim if not in active pattern */}
            {projected.map((p) => {
              const c = brightToColor(p.br, skyT);
              const inActive = isActiveNode(p.id);
              return (
                <g key={p.id} style={{ opacity: inActive ? 1 : 0.22, transition: 'opacity 250ms' }}>
                  <ellipse cx={p.px} cy={p.py + p.sz * 0.6} rx={p.sz * 0.9} ry={p.sz * 0.3}
                    fill={skyT.shadow} opacity={0.5} />
                  <circle cx={p.px} cy={p.py} r={p.sz} fill={c} />
                  <ellipse cx={p.px - p.sz * 0.3} cy={p.py - p.sz * 0.3}
                    rx={p.sz * 0.4} ry={p.sz * 0.3} fill={skyT.highlight} opacity={0.35} />
                  <path d={`M ${p.px} ${p.py - p.sz} A ${p.sz} ${p.sz} 0 0 1 ${p.px} ${p.py + p.sz} A ${p.sz * 0.55} ${p.sz} 0 0 1 ${p.px} ${p.py - p.sz} Z`}
                    fill="#000" opacity={0.5} />
                  {/* label only on active nodes */}
                  {inActive && (
                    <text x={p.px} y={p.py - p.sz - 1.2} textAnchor="middle"
                      fontSize="1.4" fill={skyT.ink} fontFamily='"Inter", system-ui, sans-serif' fontStyle="italic">{p.label}</text>
                  )}
                </g>
              );
            })}

            {/* Constellation edges */}
            {active.edges.map(([a, b], i) => {
              const A = byId[a], B = byId[b];
              if (!A || !B) return null;
              return (
                <g key={i}>
                  <line x1={A.px} y1={A.py} x2={B.px} y2={B.py}
                    stroke={active.color} strokeWidth="0.25" strokeDasharray="0.6 0.4" opacity="0.85" />
                  <circle cx={(A.px + B.px) / 2} cy={(A.py + B.py) / 2} r="0.3" fill={active.color} />
                </g>
              );
            })}

            {/* Constellation name floating */}
            <text x="0" y="-26" textAnchor="middle"
              fontSize="2.4" fill={active.color}
              fontFamily='"Inter", system-ui, sans-serif' fontStyle="italic" letterSpacing="0.05">
              ✧  {active.name}  ✧
            </text>
          </svg>

          {/* legend */}
          <div style={{ position: 'absolute', bottom: 14, left: 14, fontSize: 9.5, color: skyT.inkSoft, fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.08em' }}>
            DASHED LINES · CO-OCCURRENCE   ·   LIT NODES · IN PATTERN
          </div>
        </div>
          );
          })()}

        {/* Pattern picker rail */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <OrreryCard t={t} padded={false}>
            <div style={{ padding: '12px 14px', borderBottom: `0.5px solid ${t.panelBorder}` }}>
              <OrreryTag t={t}>{clinical ? '◆ THREE PATTERNS' : '◇ THREE CONSTELLATIONS'}</OrreryTag>
            </div>
            {patterns.map((p, i) => {
              const sel = i === activePattern;
              return (
                <div
                  key={i}
                  onClick={() => setActivePattern(i)}
                  style={{
                    padding: '14px 16px', cursor: 'pointer',
                    background: sel ? `${p.color}12` : 'transparent',
                    borderLeft: sel ? `2px solid ${p.color}` : '2px solid transparent',
                    borderBottom: i < patterns.length - 1 ? `0.5px solid ${t.panelBorder}` : 'none',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                    <OrreryTag t={t} color={p.color}>{p.tag}</OrreryTag>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                      {tracked[p.name] && (
                        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, letterSpacing: '0.12em', color: t.bright, padding: '2px 6px', borderRadius: 4, background: `${t.bright}1c`, border: `0.5px solid ${t.bright}55` }}>{clinical ? '◆ TRACKED' : '◇ TRACKED'}</span>
                      )}
                      <span style={{ fontFamily: '"Inter", system-ui, sans-serif', fontStyle: clinical ? 'normal' : 'italic', fontWeight: clinical ? 500 : 400, fontSize: 18, color: p.color }}>{p.stat}</span>
                    </div>
                  </div>
                  <div style={{ fontFamily: '"Inter", system-ui, sans-serif', fontSize: 18, color: t.ink, fontStyle: clinical ? 'normal' : 'italic', fontWeight: clinical ? 500 : 400 }}>{p.name}</div>
                  {sel && (
                    <div style={{ marginTop: 6, fontSize: 11.5, color: t.inkSoft, lineHeight: 1.45 }}>{clinical ? clinicalSummary(p) : p.summary}</div>
                  )}
                </div>
              );
            })}
          </OrreryCard>

          <OrreryCard t={t} style={{ background: `linear-gradient(135deg, ${active.color}1a, ${t.starOuter}10)`, borderLeft: `2px solid ${t.bright}` }}>
            {clinical && window.ClinicalSignature
              ? <window.ClinicalSignature t={t} verb="RECOMMENDED" confidence="med" />
              : window.OwlSignature
              ? <window.OwlSignature t={t} verb="SUGGESTED" confidence="med" />
              : <OrreryTag t={t}>◇ COACH THIS PATTERN</OrreryTag>}
            <div style={{ fontFamily: '"Inter", system-ui, sans-serif', fontStyle: clinical ? 'normal' : 'italic', fontWeight: clinical ? 500 : 400, fontSize: 16, lineHeight: 1.35, marginTop: 8, color: t.ink }}>
              {clinical
                ? 'A one-page coaching brief can be generated from this pattern: what to listen for, how to respond, two call moments to study.'
                : 'I can draft a one-page coaching brief from this constellation — what to listen for, how to respond, two real call moments to study.'}
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
              <button style={{ flex: 1, padding: '8px 0', borderRadius: 6, border: 'none', background: t.ink, color: t.bgFlat, fontSize: 11.5, fontWeight: 500, cursor: 'pointer' }}>Generate brief →</button>
              <button onClick={openTrack} style={{ flex: 1, padding: '8px 0', borderRadius: 6, background: tracked[active.name] ? `${t.bright}1c` : 'transparent', color: tracked[active.name] ? t.bright : t.ink, border: `0.5px solid ${tracked[active.name] ? t.bright : t.panelBorder}`, fontSize: 11.5, fontWeight: 500, cursor: 'pointer' }}>
                {tracked[active.name] ? (clinical ? '◆ Tracking' : '◇ Tracking') : 'Track pattern'}
              </button>
            </div>
          </OrreryCard>
        </div>
      </div>
      )}

      {window.TrackPatternPopover && (
        <window.TrackPatternPopover t={t} open={trackOpen}
          anchorRect={anchorRect}
          pattern={{ name: active.name, color: active.color, count: active.tag }}
          onClose={() => setTrackOpen(false)} onSaved={onTrackSaved} />
      )}
      {window.TrackPatternToast && (
        <window.TrackPatternToast t={t} open={!!toast}
          pattern={toast && toast.pattern} trigger={toast && toast.trigger}
          onClose={() => setToast(null)} />
      )}
    </div>
  );
}

window.OrreryPatterns = OrreryPatterns;

// Clinical-tone rewrites of the pattern summaries. Same fact-shape; less
// metaphor. We do it as a name-keyed lookup so the source data stays readable.
function clinicalSummary(p) {
  switch (p.name) {
    case 'Insurance Snag':
      return 'Calls that hit insurance verification mid-conversation lose 23% in close rate. Insurance verify is the central node; four clusters route through it.';
    case 'Plan Acceptance':
      return 'Patients who reach Tx plan review after a routine cleaning close at 91%. The strongest path through the week.';
    case 'Recall Drift':
      return 'Reschedules that bypass cleanings show lower booking rates downstream. The pattern identifies where to intervene.';
    default:
      return p.summary;
  }
}
