/* global React */
/* eslint-disable */
// =============================================================================
//  ITERATION C · ALMANAC  (wildcard) — forest accent, field-guide energy
//  Type: Fraunces 300 italic display · Inter Tight body · IBM Plex Mono
//  Color: paper #fafafa, ink #0d1018, forest #1f6b3a
// =============================================================================

const alInk = '#0d1018';
const alInk2 = '#3a3f4a';
const alInk3 = '#7d818c';
const alPaper = '#fafafa';
const alPaperWarm = '#f4f2ea';
const alPanel = '#ffffff';
const alLine = '#dcd9d0';
const alLineSoft = '#e9e7df';
const alTheme = {
  accent: '#1f6b3a',
  accentDeep: '#0f4423',
  accentSoft: '#e3ece3',
  amber: '#b8852b',
  red: '#a23b3b',
  display: "'Fraunces', 'Newsreader', serif",
  body: "'Inter Tight', system-ui, sans-serif",
  mono: "'IBM Plex Mono', monospace",
};

// Owl mark + small constellation crowning above
function AlOwlMark({ size = 26 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 36" fill="none">
      <circle cx="6" cy="3" r="0.7" fill={alTheme.accent} />
      <circle cx="14" cy="2" r="0.9" fill={alTheme.accent} />
      <circle cx="22" cy="3" r="0.7" fill={alTheme.accent} />
      <circle cx="28" cy="5" r="0.5" fill={alTheme.accent} />
      <line x1="6" y1="3" x2="14" y2="2" stroke={alTheme.accent} strokeWidth="0.3" opacity="0.6" />
      <line x1="14" y1="2" x2="22" y2="3" stroke={alTheme.accent} strokeWidth="0.3" opacity="0.6" />
      <circle cx="16" cy="20" r="13" stroke={alInk} strokeWidth="1" fill="none" opacity="0.4" />
      <circle cx="11" cy="18" r="3" stroke={alInk} strokeWidth="1.2" fill="none" />
      <circle cx="21" cy="18" r="3" stroke={alInk} strokeWidth="1.2" fill="none" />
      <circle cx="11" cy="18" r="1.1" fill={alTheme.accent} />
      <circle cx="21" cy="18" r="1.1" fill={alTheme.accent} />
      <path d="M14.5 22 L16 24.5 L17.5 22 Z" fill={alInk} />
    </svg>
  );
}

// Wide starfield band (decorative)
function AlStarBand({ height = 60 }) {
  const stars = [];
  for (let i = 0; i < 80; i++) {
    stars.push({ x: (i * 13.7) % 100, y: (i * 7.3) % 100, r: 0.6 + ((i * 5) % 4) * 0.3, b: (i * 3) % 7 === 0 });
  }
  return (
    <div style={{ height, background: alInk, position: 'relative', overflow: 'hidden' }}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
        {stars.map((s, i) => (
          <circle key={i} cx={s.x} cy={s.y} r={s.b ? s.r * 1.6 : s.r} fill={s.b ? alTheme.accent : '#fff'} opacity={s.b ? 1 : 0.6} />
        ))}
        <line x1="0" y1="50" x2="100" y2="50" stroke={alTheme.accent} strokeWidth="0.08" opacity="0.4" />
      </svg>
    </div>
  );
}

function AlTopnav({ active = 'dashboard' }) {
  const items = ['Dashboard', 'Calls', 'Clinical', 'Coaching', 'Reports', 'Team'];
  return (
    <>
      <AlStarBand height={44} />
      <header style={{ background: alPaper, borderBottom: `1px solid ${alLine}`, padding: '14px 32px', display: 'flex', alignItems: 'center', gap: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <AlOwlMark />
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
            <span style={{ fontFamily: alTheme.display, fontSize: 22, color: alInk, letterSpacing: '-0.015em', fontWeight: 400, fontStyle: 'italic' }}>Observatory</span>
            <span style={{ fontFamily: alTheme.mono, fontSize: 9, color: alInk3, letterSpacing: '0.16em', textTransform: 'uppercase', marginTop: 3 }}>an almanac of calls</span>
          </div>
        </div>
        <nav style={{ display: 'flex', gap: 0, marginLeft: 28 }}>
          {items.map((label, i) => {
            const a = label.toLowerCase() === active;
            return (
              <div key={label} style={{ padding: '6px 14px', fontSize: 13, color: a ? alInk : alInk2, fontFamily: alTheme.body, fontWeight: a ? 500 : 400, borderBottom: a ? `2px solid ${alTheme.accent}` : '2px solid transparent', marginBottom: -15, paddingBottom: 14, borderRight: i < items.length - 1 ? `1px solid ${alLineSoft}` : 'none' }}>{label}</div>
            );
          })}
        </nav>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontFamily: alTheme.mono, fontSize: 10, color: alInk3, letterSpacing: '0.1em' }}>⌘K</span>
          <div style={{ width: 28, height: 28, borderRadius: '50%', background: alTheme.accentDeep, color: '#fff', fontSize: 13, fontFamily: alTheme.display, fontStyle: 'italic', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>R</div>
        </div>
      </header>
    </>
  );
}

// Almanac star-chart (warm-paper variant)
function AlStarChart({ height = 220 }) {
  const stars = [];
  for (let i = 0; i < 84; i++) {
    const x = (i * 47.3) % 100;
    const y = 12 + ((i * 17.7) % 70);
    const s = (i % 7 === 0) ? 'pos' : (i % 11 === 0) ? 'neg' : (i % 5 === 0) ? 'neu' : 'pos';
    const r = 1.2 + ((i * 3) % 4) * 0.5;
    stars.push({ x, y, s, r });
  }
  const lines = [[0, 12], [12, 23], [23, 30], [30, 41], [41, 55], [5, 17], [17, 29]];
  const col = (s) => s === 'pos' ? alTheme.accent : s === 'neg' ? alTheme.red : alTheme.amber;
  return (
    <div style={{ position: 'relative', height, background: alPaperWarm, borderRadius: 4, overflow: 'hidden', border: `1px solid ${alLine}` }}>
      <svg viewBox="0 0 100 80" preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
        {lines.map(([a, b], i) => {
          const A = stars[a]; const B = stars[b];
          if (!A || !B) return null;
          return <line key={i} x1={A.x} y1={A.y} x2={B.x} y2={B.y} stroke={alTheme.accent} strokeWidth="0.18" opacity="0.5" />;
        })}
        {stars.map((s, i) => (
          <g key={i}>
            <circle cx={s.x} cy={s.y} r={s.r * 1.6} fill={col(s.s)} opacity="0.18" />
            <circle cx={s.x} cy={s.y} r={s.r * 0.55} fill={col(s.s)} />
          </g>
        ))}
      </svg>
    </div>
  );
}

// =============================================================================
//  ARTBOARD · App shell — almanac field-report cover
// =============================================================================
function AlShell() {
  return (
    <div style={{ width: '100%', height: '100%', background: alPaper, color: alInk, fontFamily: alTheme.body, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <AlTopnav active="dashboard" />
      <div style={{ flex: 1, padding: '40px 56px', display: 'flex', flexDirection: 'column', gap: 28 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 40 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: alTheme.mono, fontSize: 11, color: alTheme.accent, letterSpacing: '0.18em', textTransform: 'uppercase', marginBottom: 10 }}>
              ❋ The Daily Almanac · Tue · 26 Apr 2026
            </div>
            <h1 style={{ fontFamily: alTheme.display, fontSize: 96, fontWeight: 300, fontStyle: 'italic', margin: 0, lineHeight: 0.92, letterSpacing: '-0.03em' }}>
              Forty-two<br />
              <span style={{ fontStyle: 'normal', fontWeight: 400, color: alTheme.accent }}>conversations,</span><br />
              <span style={{ fontWeight: 300 }}>worth a look.</span>
            </h1>
          </div>
          <div style={{ width: 280, fontFamily: alTheme.body, fontSize: 13.5, lineHeight: 1.6, color: alInk2, columnCount: 1, borderLeft: `1px solid ${alLine}`, paddingLeft: 22 }}>
            <span style={{ fontFamily: alTheme.display, fontSize: 56, fontWeight: 300, color: alTheme.accentDeep, float: 'left', lineHeight: 0.85, marginRight: 8, marginTop: 4 }}>A</span>verage score climbs to 7.84 — up 0.31 over the prior week, paced by a sharp rise in treatment-plan acceptance. Four calls flagged for coaching review.
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 0, borderTop: `1px solid ${alInk}`, borderBottom: `1px solid ${alInk}` }}>
          {[['Calls', '1,284'], ['Avg score', '7.84'], ['Sentiment+', '68%'], ['Pending', '12']].map(([k, v], i) => (
            <div key={k} style={{ padding: '18px 20px', borderRight: i < 3 ? `1px solid ${alLine}` : 'none' }}>
              <div style={{ fontFamily: alTheme.mono, fontSize: 10, color: alInk3, textTransform: 'uppercase', letterSpacing: '0.14em' }}>{k}</div>
              <div style={{ fontFamily: alTheme.display, fontSize: 44, fontStyle: 'italic', fontWeight: 300, marginTop: 4, letterSpacing: '-0.02em' }}>{v}</div>
            </div>
          ))}
        </div>
        <AlStarChart height={200} />
      </div>
    </div>
  );
}

// =============================================================================
//  ARTBOARD · Dashboard — daily field report
// =============================================================================
function AlDashboard() {
  const calls = [
    ['14:02', 'Maya P.', 'Treatment plan', 9.1, 'pos', '12:04'],
    ['13:48', 'Devon W.', 'New patient', 8.4, 'pos', '08:21'],
    ['13:12', 'Sara L.', 'Insurance', 5.2, 'neg', '14:57'],
    ['12:55', 'Maya P.', 'Recall', 7.8, 'pos', '04:11'],
    ['12:30', 'Jordan T.', 'Billing', 6.0, 'neu', '09:42'],
    ['11:58', 'Devon W.', 'Treatment plan', 8.9, 'pos', '15:30'],
    ['11:14', 'Sara L.', 'New patient', 7.1, 'neu', '06:19'],
    ['10:42', 'Maya P.', 'Insurance', 8.0, 'pos', '07:08'],
    ['10:18', 'Jordan T.', 'Recall', 7.5, 'neu', '03:54'],
    ['09:56', 'Devon W.', 'Billing', 4.9, 'neg', '18:22'],
  ];
  return (
    <div style={{ width: '100%', height: '100%', background: alPaper, color: alInk, fontFamily: alTheme.body, display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
      <AlTopnav active="dashboard" />
      <div style={{ padding: '36px 48px', display: 'flex', flexDirection: 'column', gap: 28 }}>
        <div style={{ borderBottom: `1px solid ${alInk}`, paddingBottom: 22 }}>
          <div style={{ fontFamily: alTheme.mono, fontSize: 11, color: alTheme.accent, letterSpacing: '0.18em', textTransform: 'uppercase', marginBottom: 12, display: 'flex', justifyContent: 'space-between' }}>
            <span>❋ Volume CXVII · No. 117 · April 26, 2026</span>
            <span>edition · pacific · pp. 1–4</span>
          </div>
          <h1 style={{ fontFamily: alTheme.display, fontSize: 72, fontWeight: 300, fontStyle: 'italic', margin: 0, lineHeight: 0.95, letterSpacing: '-0.025em' }}>
            A clear day for <span style={{ fontStyle: 'normal', color: alTheme.accent }}>conversation.</span>
          </h1>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 28, marginTop: 22 }}>
            <div style={{ fontSize: 14, lineHeight: 1.65, color: alInk2 }}>
              <span style={{ fontFamily: alTheme.display, fontSize: 48, fontWeight: 300, color: alTheme.accentDeep, float: 'left', lineHeight: 0.85, marginRight: 10, marginTop: 4 }}>M</span>ean call score climbs for the fifth straight day, paced by stronger treatment-plan presentations and a notable drop in transfer escalations. Maya P. and Devon W. both broke 8.5 today.
            </div>
            {[['+18%', 'volume'], ['+0.31', 'mean score'], ['68%', 'sentiment+']].map(([v, k]) => (
              <div key={k} style={{ borderLeft: `1px solid ${alLine}`, paddingLeft: 16 }}>
                <div style={{ fontFamily: alTheme.display, fontSize: 40, fontWeight: 300, fontStyle: 'italic', lineHeight: 1, color: alInk, letterSpacing: '-0.02em' }}>{v}</div>
                <div style={{ fontFamily: alTheme.mono, fontSize: 10, color: alInk3, textTransform: 'uppercase', letterSpacing: '0.14em', marginTop: 6 }}>{k}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Star band as decorative spread */}
        <div style={{ position: 'relative' }}>
          <AlStarBand height={56} />
          <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', fontFamily: alTheme.display, fontSize: 22, fontStyle: 'italic', color: '#fff', letterSpacing: '0.14em', textTransform: 'lowercase' }}>
            ❋ &nbsp; the day's observations &nbsp; ❋
          </div>
        </div>

        {/* Two-column field report */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 36 }}>
          {/* Calls — newspaper-style headlines */}
          <div>
            <div style={{ fontFamily: alTheme.display, fontSize: 28, fontStyle: 'italic', fontWeight: 300, marginBottom: 14, paddingBottom: 8, borderBottom: `1px solid ${alInk}` }}>
              Today's headlines.
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${alLine}`, fontFamily: alTheme.mono, fontSize: 10, color: alInk3, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                  {['Time', 'Agent', 'Topic', 'Score', 'Sent', 'Dur'].map((h, i) => (
                    <th key={h} style={{ padding: '10px 12px', textAlign: i === 3 ? 'right' : 'left', fontWeight: 500 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {calls.map(([t, ag, cat, sc, sn, dur], i) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${alLineSoft}` }}>
                    <td style={{ padding: '11px 12px', fontFamily: alTheme.mono, fontSize: 11.5, color: alInk3 }}>{t}</td>
                    <td style={{ padding: '11px 12px', fontFamily: alTheme.display, fontSize: 16, fontStyle: 'italic' }}>{ag}</td>
                    <td style={{ padding: '11px 12px', color: alInk2 }}>{cat}</td>
                    <td style={{ padding: '11px 12px', textAlign: 'right', fontFamily: alTheme.display, fontSize: 22, fontWeight: 300, color: sc < 6 ? alTheme.red : alInk }}>{sc.toFixed(1)}</td>
                    <td style={{ padding: '11px 12px', fontFamily: alTheme.mono, fontSize: 11, color: sn === 'pos' ? alTheme.accent : sn === 'neg' ? alTheme.red : alTheme.amber, textTransform: 'uppercase', letterSpacing: '0.06em' }}>● {sn}</td>
                    <td style={{ padding: '11px 12px', fontFamily: alTheme.mono, fontSize: 11.5, color: alInk3 }}>{dur}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Editorial sidebar — feature with drop cap */}
          <aside style={{ borderLeft: `1px solid ${alInk}`, paddingLeft: 26 }}>
            <div style={{ fontFamily: alTheme.mono, fontSize: 10, color: alTheme.accent, letterSpacing: '0.18em', textTransform: 'uppercase', marginBottom: 6 }}>Field note · pattern of the week</div>
            <div style={{ fontFamily: alTheme.display, fontSize: 32, fontStyle: 'italic', fontWeight: 300, lineHeight: 1.1, letterSpacing: '-0.02em', marginBottom: 14 }}>
              The reluctant <span style={{ fontStyle: 'normal', color: alTheme.accent }}>insurance call.</span>
            </div>
            <div style={{ fontSize: 14, lineHeight: 1.65, color: alInk2 }}>
              <span style={{ fontFamily: alTheme.display, fontSize: 48, fontWeight: 300, color: alTheme.accentDeep, float: 'left', lineHeight: 0.85, marginRight: 10, marginTop: 4 }}>F</span>ourteen calls cluster around a single pattern: patients pushing back the moment coverage is mentioned. Mean score 5.4. Three ended without a booking — worth a coaching pass on verification scripts.
            </div>
            <div style={{ fontFamily: alTheme.mono, fontSize: 11, color: alTheme.accent, marginTop: 14, textTransform: 'uppercase', letterSpacing: '0.14em' }}>
              ❋ open the cluster
            </div>

            <div style={{ marginTop: 28, paddingTop: 18, borderTop: `1px solid ${alLine}` }}>
              <div style={{ fontFamily: alTheme.mono, fontSize: 10, color: alInk3, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 10 }}>Bright stars · this week</div>
              {[['Maya P.', 9.1], ['Devon W.', 8.7], ['Jordan T.', 8.2], ['Sara L.', 6.4]].map(([n, s], i) => (
                <div key={n} style={{ display: 'grid', gridTemplateColumns: '20px 1fr 60px', alignItems: 'baseline', padding: '8px 0', borderTop: i === 0 ? 'none' : `1px solid ${alLineSoft}` }}>
                  <span style={{ fontFamily: alTheme.display, fontSize: 16, fontStyle: 'italic', color: alInk3 }}>{i + 1}.</span>
                  <span style={{ fontSize: 14 }}>{n}</span>
                  <span style={{ fontFamily: alTheme.display, fontSize: 24, fontStyle: 'italic', fontWeight: 300, color: s < 7 ? alTheme.red : alTheme.accent, textAlign: 'right' }}>{s.toFixed(1)}</span>
                </div>
              ))}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
//  ARTBOARD · Clinical scribe — almanac entry energy
// =============================================================================
function AlClinical() {
  return (
    <div style={{ width: '100%', height: '100%', background: alPaper, color: alInk, fontFamily: alTheme.body, display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
      <AlTopnav active="clinical" />
      <div style={{ padding: '32px 48px', display: 'flex', flexDirection: 'column', gap: 22 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', borderBottom: `1px solid ${alInk}`, paddingBottom: 18 }}>
          <div>
            <div style={{ fontFamily: alTheme.mono, fontSize: 11, color: alTheme.red, letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 7, height: 7, background: alTheme.red, borderRadius: '50%' }} />Recording · entry #4821
            </div>
            <h1 style={{ fontFamily: alTheme.display, fontSize: 60, fontWeight: 300, fontStyle: 'italic', margin: 0, lineHeight: 1, letterSpacing: '-0.025em' }}>
              Margaret Holloway, <span style={{ fontStyle: 'normal', color: alInk2 }}>62F.</span>
            </h1>
            <div style={{ fontFamily: alTheme.mono, fontSize: 11, color: alInk3, marginTop: 8, display: 'flex', gap: 14 }}>
              <span>APR 26 · 14:02</span><span>DR REYES</span><span>operative · SOAP</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={{ padding: '8px 14px', background: 'transparent', border: `1px solid ${alLine}`, borderRadius: 4, color: alInk, fontSize: 12, fontFamily: alTheme.body }}>edit</button>
            <button style={{ padding: '8px 16px', background: alTheme.accentDeep, color: '#fff', border: 'none', borderRadius: 4, fontSize: 12, fontFamily: alTheme.body, fontWeight: 500 }}>❋ attest & sign</button>
          </div>
        </div>

        {/* Live waveform on warm paper */}
        <div style={{ background: alPaperWarm, border: `1px solid ${alLine}`, borderRadius: 4, padding: '14px 22px', display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ width: 9, height: 9, background: alTheme.red, borderRadius: '50%' }} />
          <span style={{ fontFamily: alTheme.mono, fontSize: 11, color: alTheme.red, textTransform: 'uppercase', letterSpacing: '0.14em', fontWeight: 600 }}>LIVE 03:24</span>
          <div style={{ flex: 1, height: 24 }}>
            <svg viewBox="0 0 300 24" preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
              {Array.from({ length: 120 }).map((_, i) => {
                const h = 3 + ((i * 13) % 17);
                return <rect key={i} x={i * 2.5} y={(24 - h) / 2} width="1.4" height={h} fill={i < 50 ? alTheme.accent : alLine} />;
              })}
            </svg>
          </div>
          <span style={{ fontFamily: alTheme.mono, fontSize: 11, color: alTheme.accent }}>en-US · 96% · 2 spk</span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32 }}>
          {/* Transcript — magazine column */}
          <div style={{ borderRight: `1px solid ${alLine}`, paddingRight: 24 }}>
            <div style={{ fontFamily: alTheme.display, fontSize: 24, fontStyle: 'italic', fontWeight: 300, marginBottom: 10, paddingBottom: 8, borderBottom: `1px solid ${alInk}` }}>
              The conversation.
            </div>

            <div style={{ fontFamily: alTheme.display, fontSize: 26, fontStyle: 'italic', fontWeight: 300, lineHeight: 1.2, color: alTheme.accent, margin: '14px 0 22px', paddingLeft: 14, borderLeft: `3px solid ${alTheme.accent}` }}>
              "It started cold-sensitive — but now it just throbs."
            </div>

            {[
              ['DR. REYES', 'How long has the pain been waking you up at night?'],
              ['HOLLOWAY', 'About a week. It started just being cold-sensitive but now it just throbs.', true],
              ['DR. REYES', 'Any swelling, anything that feels hot to the touch?'],
              ['HOLLOWAY', 'No swelling. No fever. Just the tooth itself.'],
              ['DR. REYES', "Looking at the X-ray, the decay has reached the nerve. We're going to need to do a pulpotomy today and schedule the root canal.", true],
              ['HOLLOWAY', 'Whatever you think is best.'],
            ].map(([sp, t, hl], i) => (
              <div key={i} style={{ marginBottom: 14, fontSize: 14, lineHeight: 1.6, color: alInk2 }}>
                <div style={{ fontFamily: alTheme.mono, fontSize: 10, color: sp === 'DR. REYES' ? alTheme.accent : alInk3, fontWeight: 600, letterSpacing: '0.16em', marginBottom: 4 }}>{sp}</div>
                <div style={{ background: hl ? alTheme.accentSoft : 'transparent', padding: hl ? '6px 10px' : 0, borderLeft: hl ? `2px solid ${alTheme.accent}` : 'none', color: hl ? alInk : alInk2 }}>{t}</div>
              </div>
            ))}
          </div>

          {/* SOAP — almanac entry */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10, paddingBottom: 8, borderBottom: `1px solid ${alInk}` }}>
              <div style={{ fontFamily: alTheme.display, fontSize: 24, fontStyle: 'italic', fontWeight: 300 }}>The chart, drafted.</div>
              <div style={{ fontFamily: alTheme.mono, fontSize: 11, color: alTheme.amber }}>● auto v0.4</div>
            </div>

            <div style={{ marginTop: 14, marginBottom: 18 }}>
              <div style={{ fontFamily: alTheme.mono, fontSize: 10, color: alTheme.accent, letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: 6 }}>Chief complaint</div>
              <div style={{ fontFamily: alTheme.display, fontSize: 22, fontStyle: 'italic', fontWeight: 300, lineHeight: 1.3, letterSpacing: '-0.015em' }}>
                "Persistent ache, lower right molar, worse with cold for two weeks."
              </div>
            </div>

            {[
              ['Subjective', 'Gradual onset cold sensitivity #31, now spontaneous, waking patient at night. No prior trauma. OTC ibuprofen partially effective.'],
              ['Objective', 'Tooth #31 — deep distal caries to pulp on radiograph. Percussion tender. Cold test prolonged. Probing depths WNL.'],
              ['Assessment', 'Symptomatic irreversible pulpitis #31, secondary to deep distal carious lesion. Tooth restorable.'],
            ].map(([k, v]) => (
              <div key={k} style={{ marginBottom: 14, paddingBottom: 12, borderBottom: `1px solid ${alLineSoft}` }}>
                <div style={{ fontFamily: alTheme.mono, fontSize: 10, color: alTheme.accent, letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: 4 }}>{k}</div>
                <div style={{ fontSize: 14, color: alInk2, lineHeight: 1.6 }}>{v}</div>
              </div>
            ))}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontFamily: alTheme.mono, fontSize: 10, color: alTheme.accent, letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: 6 }}>Plan</div>
              <ol style={{ paddingLeft: 18, margin: 0, fontSize: 14, color: alInk2, lineHeight: 1.7 }}>
                <li><strong style={{ color: alInk, fontFamily: alTheme.display, fontStyle: 'italic', fontWeight: 400 }}>Pulpotomy #31</strong> today, RCT within 1 week.</li>
                <li>Rx <strong style={{ color: alInk, fontFamily: alTheme.display, fontStyle: 'italic', fontWeight: 400 }}>amoxicillin 500 mg TID × 7d</strong>.</li>
                <li>Crown buildup post-RCT.</li>
                <li>Hygiene recall 6 months.</li>
              </ol>
            </div>
            <div style={{ display: 'flex', gap: 6, paddingTop: 12, borderTop: `1px solid ${alInk}` }}>
              {[['K04.01', 'ICD'], ['D3220', 'CDT'], ['D2950', 'CDT']].map(([c, t]) => (
                <span key={c} style={{ fontFamily: alTheme.mono, fontSize: 11, padding: '4px 8px', background: alTheme.accentDeep, color: '#fff', fontWeight: 500, letterSpacing: '0.04em' }}>{t} · {c}</span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

window.AlShell = AlShell;
window.AlDashboard = AlDashboard;
window.AlClinical = AlClinical;
