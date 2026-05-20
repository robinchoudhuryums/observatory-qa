/* global React */
/* eslint-disable */
// =============================================================================
//  ITERATION B · CARTOGRAPHY  — teal, motif pushed, serif display
//  Type: Newsreader (display, italic) · Inter Tight (body) · JetBrains Mono
//  Color: paper #fafafa, ink #0d1018, teal #0d6e6e
// =============================================================================

const cgInk = '#0d1018';
const cgInk2 = '#3a3f4a';
const cgInk3 = '#7d818c';
const cgPaper = '#fafafa';
const cgPanel = '#ffffff';
const cgLine = '#e6e6e3';
const cgLineSoft = '#efefec';
const cgTheme = {
  accent: '#0d6e6e',
  accentDeep: '#094545',
  accentSoft: '#e0eceb',
  accentLine: '#bcd6d0',
  serif: "'Newsreader', 'Instrument Serif', serif",
  body: "'Inter Tight', system-ui, sans-serif",
  mono: "'JetBrains Mono', monospace",
};

// Owl with star-eyes + small star above
function CgOwlMark({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      {/* tiny crowning star */}
      <path d="M16 1.5 L16.6 3.2 L18.3 3.4 L17 4.6 L17.4 6.3 L16 5.4 L14.6 6.3 L15 4.6 L13.7 3.4 L15.4 3.2 Z" fill={cgTheme.accent} />
      <circle cx="16" cy="17" r="13" stroke={cgInk} strokeWidth="1" fill="none" opacity="0.4" />
      <circle cx="11" cy="15" r="3.2" stroke={cgInk} strokeWidth="1.2" fill="none" />
      <circle cx="21" cy="15" r="3.2" stroke={cgInk} strokeWidth="1.2" fill="none" />
      {/* star pupils */}
      <path d="M11 13.6 L11.4 14.7 L12.5 14.8 L11.6 15.5 L11.9 16.6 L11 16 L10.1 16.6 L10.4 15.5 L9.5 14.8 L10.6 14.7 Z" fill={cgTheme.accent} />
      <path d="M21 13.6 L21.4 14.7 L22.5 14.8 L21.6 15.5 L21.9 16.6 L21 16 L20.1 16.6 L20.4 15.5 L19.5 14.8 L20.6 14.7 Z" fill={cgTheme.accent} />
      <path d="M14.5 19 L16 21.5 L17.5 19 Z" fill={cgInk} />
    </svg>
  );
}

// Coordinate-frame border — hairline ticks and corner registration marks
function CgCoordFrame({ children, padding = 24 }) {
  return (
    <div style={{ position: 'relative', padding }}>
      {/* corner registration marks */}
      {[[0, 0, 'tl'], [1, 0, 'tr'], [0, 1, 'bl'], [1, 1, 'br']].map(([x, y, k]) => (
        <svg key={k} width="14" height="14" viewBox="0 0 14 14" style={{ position: 'absolute', top: y ? 'auto' : 4, bottom: y ? 4 : 'auto', left: x ? 'auto' : 4, right: x ? 4 : 'auto' }}>
          <line x1={x ? 14 : 0} y1="7" x2={x ? 7 : 14} y2="7" stroke={cgTheme.accent} strokeWidth="0.8" />
          <line x1="7" y1={y ? 14 : 0} x2="7" y2={y ? 7 : 14} stroke={cgTheme.accent} strokeWidth="0.8" />
          <circle cx="7" cy="7" r="1" fill={cgTheme.accent} />
        </svg>
      ))}
      {children}
    </div>
  );
}

function CgTopnav({ active = 'dashboard' }) {
  const items = ['Dashboard', 'Calls', 'Clinical', 'Coaching', 'Reports', 'Team'];
  return (
    <header style={{ background: cgPanel, borderBottom: `1px solid ${cgLine}`, padding: '14px 28px', display: 'flex', alignItems: 'center', gap: 28, position: 'relative' }}>
      {/* hairline tick row above the nav */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 5, display: 'flex' }}>
        {Array.from({ length: 60 }).map((_, i) => (
          <span key={i} style={{ flex: 1, borderLeft: i % 5 === 0 ? `1px solid ${cgTheme.accent}` : `1px solid ${cgLine}`, height: i % 5 === 0 ? 5 : 3 }} />
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <CgOwlMark />
        <span style={{ fontFamily: cgTheme.serif, fontSize: 24, color: cgInk, letterSpacing: '-0.015em', fontWeight: 400 }}>Observatory</span>
        <span style={{ fontFamily: cgTheme.mono, fontSize: 10, color: cgInk3, padding: '2px 6px', border: `1px solid ${cgLine}`, borderRadius: 3, marginLeft: 8 }}>westside-dental</span>
      </div>
      <nav style={{ display: 'flex', gap: 4, marginLeft: 24 }}>
        {items.map((label) => {
          const a = label.toLowerCase() === active;
          return (
            <div key={label} style={{ padding: '6px 12px', fontSize: 13, color: a ? cgInk : cgInk2, fontFamily: cgTheme.body, fontWeight: a ? 500 : 400, borderBottom: a ? `1px solid ${cgTheme.accent}` : '1px solid transparent', marginBottom: -15, paddingBottom: 14, display: 'flex', alignItems: 'center', gap: 5 }}>
              {a && <span style={{ color: cgTheme.accent, fontFamily: cgTheme.mono, fontSize: 9 }}>★</span>}
              {label}
            </div>
          );
        })}
      </nav>
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ padding: '6px 12px', background: '#f3f3f0', border: `1px solid ${cgLine}`, borderRadius: 4, fontSize: 12, color: cgInk3, display: 'flex', alignItems: 'center', gap: 8, width: 280, fontFamily: cgTheme.mono }}>
          <span>›</span> command…
          <span style={{ marginLeft: 'auto', fontSize: 10 }}>⌘K</span>
        </div>
        <div style={{ width: 28, height: 28, borderRadius: '50%', background: cgTheme.accentDeep, color: '#fff', fontSize: 13, fontFamily: cgTheme.serif, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>R</div>
      </div>
    </header>
  );
}

// Decorative star-chart with thick coord overlay + RA/DEC
function CgStarChart({ height = 260 }) {
  const stars = [];
  for (let i = 0; i < 84; i++) {
    const x = (i * 47.3) % 100;
    const y = 12 + ((i * 17.7) % 70);
    const s = (i % 7 === 0) ? 'pos' : (i % 11 === 0) ? 'neg' : (i % 5 === 0) ? 'neu' : 'pos';
    const r = 1.2 + ((i * 3) % 4) * 0.5;
    stars.push({ x, y, s, r });
  }
  const lines = [
    [0, 12], [12, 23], [23, 30], [30, 41], [41, 55], [55, 70],
    [5, 17], [17, 29], [29, 44],
  ];
  const col = (s) => s === 'pos' ? cgTheme.accent : s === 'neg' ? '#c4452a' : '#b8852b';
  return (
    <div style={{ position: 'relative', height, background: '#f4f3ee', borderRadius: 4, overflow: 'hidden', border: `1px solid ${cgLine}` }}>
      <svg viewBox="0 0 100 80" preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
        {/* coord grid */}
        {[10, 20, 30, 40, 50, 60, 70].map((y) => <line key={y} x1="0" x2="100" y1={y} y2={y} stroke={cgTheme.accent} strokeWidth="0.08" opacity={y % 20 === 0 ? 0.5 : 0.2} />)}
        {[10, 20, 30, 40, 50, 60, 70, 80, 90].map((x) => <line key={x} x1={x} x2={x} y1="0" y2="80" stroke={cgTheme.accent} strokeWidth="0.08" opacity={x % 20 === 0 ? 0.5 : 0.2} />)}
        {/* constellation lines */}
        {lines.map(([a, b], i) => {
          const A = stars[a]; const B = stars[b];
          if (!A || !B) return null;
          return <line key={i} x1={A.x} y1={A.y} x2={B.x} y2={B.y} stroke={cgTheme.accent} strokeWidth="0.18" opacity="0.6" />;
        })}
        {stars.map((s, i) => (
          <g key={i}>
            <circle cx={s.x} cy={s.y} r={s.r * 1.6} fill={col(s.s)} opacity="0.18" />
            <circle cx={s.x} cy={s.y} r={s.r * 0.55} fill={col(s.s)} />
            {i % 13 === 0 && <text x={s.x + 1.5} y={s.y - 1} fontSize="2" fontFamily="JetBrains Mono" fill={cgTheme.accent} opacity="0.7">·{i}</text>}
          </g>
        ))}
      </svg>
      <div style={{ position: 'absolute', top: 10, left: 14, fontFamily: cgTheme.mono, fontSize: 10, color: cgTheme.accent, textTransform: 'uppercase', letterSpacing: '0.14em' }}>
        ✦ Score × Time · 30d · 1,284 calls
      </div>
      <div style={{ position: 'absolute', bottom: 8, left: 14, fontFamily: cgTheme.mono, fontSize: 9, color: cgInk3, letterSpacing: '0.08em' }}>
        RA 14ʰ 02ᵐ · DEC +42°
      </div>
      <div style={{ position: 'absolute', top: 10, right: 14, fontFamily: cgTheme.mono, fontSize: 9, color: cgInk3 }}>
        seeing: ★★★★☆
      </div>
    </div>
  );
}

// =============================================================================
//  ARTBOARD · App shell
// =============================================================================
function CgShell() {
  return (
    <div style={{ width: '100%', height: '100%', background: cgPaper, color: cgInk, fontFamily: cgTheme.body, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <CgTopnav active="dashboard" />
      <div style={{ flex: 1, padding: '36px 56px', display: 'flex', flexDirection: 'column', gap: 26 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div>
            <div style={{ fontFamily: cgTheme.mono, fontSize: 11, color: cgTheme.accent, letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>✦</span> Tuesday · 26 April · 14:42 PT
            </div>
            <h1 style={{ fontFamily: cgTheme.serif, fontSize: 80, fontWeight: 300, margin: 0, lineHeight: 0.95, letterSpacing: '-0.025em', color: cgInk }}>
              Today the sky is <span style={{ fontStyle: 'italic', color: cgTheme.accent }}>clear</span>.
            </h1>
            <div style={{ fontSize: 16, color: cgInk2, marginTop: 16, maxWidth: 540 }}>
              42 calls observed · avg 7.84 · 4 anomalies flagged for review.
            </div>
          </div>
          <div style={{ fontFamily: cgTheme.mono, fontSize: 10, color: cgInk3, textAlign: 'right', lineHeight: 1.7 }}>
            <div>RA <span style={{ color: cgInk }}>14ʰ 02ᵐ</span></div>
            <div>DEC <span style={{ color: cgInk }}>+42°</span></div>
            <div style={{ color: cgTheme.accent, marginTop: 6 }}>seeing: ★★★★☆ excellent</div>
          </div>
        </div>

        <CgStarChart height={300} />

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 0 }}>
          {[
            ['Calls', '1,284', '+18%'],
            ['Avg score', '7.84', '+0.31'],
            ['Sentiment', '68%', '+4 pts'],
            ['Pending', '12', 'oldest 2h'],
          ].map(([k, v, d], i) => (
            <div key={k} style={{ borderTop: `1px solid ${cgLine}`, paddingTop: 14, paddingRight: 18, marginRight: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <div style={{ fontFamily: cgTheme.mono, fontSize: 10, color: cgInk3, textTransform: 'uppercase', letterSpacing: '0.12em' }}>{k}</div>
                <span style={{ fontFamily: cgTheme.mono, fontSize: 9, color: cgTheme.accent }}>{String(i + 1).padStart(2, '0')}</span>
              </div>
              <div style={{ fontFamily: cgTheme.serif, fontSize: 38, marginTop: 4, fontWeight: 400, letterSpacing: '-0.02em' }}>{v}</div>
              <div style={{ fontFamily: cgTheme.mono, fontSize: 11, color: cgTheme.accent }}>{d}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// =============================================================================
//  ARTBOARD · Dashboard — table foregrounded, star-chart sidekick
// =============================================================================
function CgDashboard() {
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
    <div style={{ width: '100%', height: '100%', background: cgPaper, color: cgInk, fontFamily: cgTheme.body, display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
      <CgTopnav active="dashboard" />
      <div style={{ padding: '32px 48px', display: 'flex', flexDirection: 'column', gap: 24 }}>
        {/* Editorial header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 40 }}>
          <div>
            <div style={{ fontFamily: cgTheme.mono, fontSize: 11, color: cgTheme.accent, letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: 10 }}>
              ✦ Volume CXVII · April 26, 2026
            </div>
            <h1 style={{ fontFamily: cgTheme.serif, fontSize: 56, fontWeight: 300, margin: 0, lineHeight: 1, letterSpacing: '-0.025em' }}>
              The day's <span style={{ fontStyle: 'italic', color: cgTheme.accent }}>observations</span>.
            </h1>
          </div>
          {/* Mini coord-card with star chart */}
          <div style={{ width: 320, border: `1px solid ${cgLine}`, background: cgPanel, padding: 8, borderRadius: 4 }}>
            <CgStarChart height={140} />
          </div>
        </div>

        {/* KPI strip */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 0, borderTop: `1px solid ${cgLine}`, borderBottom: `1px solid ${cgLine}` }}>
          {[
            ['Calls observed', '1,284', '+18% prior 30d', '01'],
            ['Mean score', '7.84', '+0.31', '02'],
            ['Sentiment+', '68%', '+4 pts', '03'],
            ['Anomalies', '04', 'flagged', '04'],
          ].map(([k, v, d, n], i) => (
            <div key={k} style={{ padding: '18px 20px', borderRight: i < 3 ? `1px solid ${cgLine}` : 'none', position: 'relative' }}>
              <span style={{ position: 'absolute', top: 8, right: 10, fontFamily: cgTheme.mono, fontSize: 9, color: cgTheme.accent }}>★ {n}</span>
              <div style={{ fontFamily: cgTheme.mono, fontSize: 10, color: cgInk3, textTransform: 'uppercase', letterSpacing: '0.12em' }}>{k}</div>
              <div style={{ fontFamily: cgTheme.serif, fontSize: 42, marginTop: 4, fontWeight: 400, letterSpacing: '-0.025em' }}>{v}</div>
              <div style={{ fontFamily: cgTheme.mono, fontSize: 11, color: cgTheme.accent }}>{d}</div>
            </div>
          ))}
        </div>

        {/* Main: foregrounded table with editorial sidebar */}
        <div style={{ display: 'grid', gridTemplateColumns: '2.2fr 1fr', gap: 24 }}>
          <div style={{ background: cgPanel, border: `1px solid ${cgLine}`, borderRadius: 4 }}>
            <div style={{ padding: '16px 22px', borderBottom: `1px solid ${cgLine}`, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <div style={{ fontFamily: cgTheme.serif, fontSize: 24, fontWeight: 400 }}>Recent <span style={{ fontStyle: 'italic', color: cgTheme.accent }}>transmissions</span></div>
              <div style={{ fontFamily: cgTheme.mono, fontSize: 11, color: cgInk3 }}>view all 1,284 →</div>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${cgLine}`, fontFamily: cgTheme.mono, fontSize: 10, color: cgInk3, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                  {['Time', 'Agent', 'Topic', 'Score', 'Sentiment', 'Dur'].map((h, i) => (
                    <th key={h} style={{ padding: '10px 16px', textAlign: i === 3 ? 'right' : 'left', fontWeight: 500 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {calls.map(([t, ag, cat, sc, sn, dur], i) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${cgLineSoft}` }}>
                    <td style={{ padding: '12px 16px', fontFamily: cgTheme.mono, fontSize: 12, color: cgInk3 }}>{t}</td>
                    <td style={{ padding: '12px 16px', fontFamily: cgTheme.serif, fontSize: 16 }}>{ag}</td>
                    <td style={{ padding: '12px 16px', color: cgInk2 }}>{cat}</td>
                    <td style={{ padding: '12px 16px', textAlign: 'right', fontFamily: cgTheme.serif, fontSize: 22, fontWeight: 400, color: sc < 6 ? '#c4452a' : cgInk }}>{sc.toFixed(1)}</td>
                    <td style={{ padding: '12px 16px', fontFamily: cgTheme.mono, fontSize: 11, color: sn === 'pos' ? cgTheme.accent : sn === 'neg' ? '#c4452a' : '#b8852b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>● {sn}</td>
                    <td style={{ padding: '12px 16px', fontFamily: cgTheme.mono, fontSize: 12, color: cgInk3 }}>{dur}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Editorial sidebar */}
          <aside style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <CgCoordFrame padding={18}>
              <div style={{ fontFamily: cgTheme.mono, fontSize: 10, color: cgTheme.accent, textTransform: 'uppercase', letterSpacing: '0.16em', marginBottom: 8 }}>Constellation of the week</div>
              <div style={{ fontFamily: cgTheme.serif, fontSize: 26, lineHeight: 1.15, fontStyle: 'italic', color: cgTheme.accentDeep, fontWeight: 400 }}>"The reluctant insurance call"</div>
              <div style={{ fontSize: 13.5, color: cgInk2, marginTop: 12, lineHeight: 1.55 }}>
                14 calls cluster around a recurring pattern — patients pushing back on insurance coverage. Avg score 5.4. Suggests a coaching opportunity around verification scripts.
              </div>
              <div style={{ marginTop: 14, fontFamily: cgTheme.mono, fontSize: 11, color: cgTheme.accent }}>open cluster ✦</div>
            </CgCoordFrame>
            <div style={{ background: cgPanel, border: `1px solid ${cgLine}`, borderRadius: 4, padding: '16px 18px' }}>
              <div style={{ fontFamily: cgTheme.mono, fontSize: 10, color: cgInk3, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 10 }}>Bright stars · this week</div>
              {[['Maya P.', 9.1, '★★★'], ['Devon W.', 8.7, '★★★'], ['Jordan T.', 8.2, '★★']].map(([n, s, st]) => (
                <div key={n} style={{ display: 'grid', gridTemplateColumns: '1fr 50px 60px', alignItems: 'baseline', padding: '8px 0', borderTop: `1px solid ${cgLineSoft}`, fontSize: 14 }}>
                  <span>{n}</span>
                  <span style={{ fontFamily: cgTheme.mono, fontSize: 10, color: cgTheme.accent }}>{st}</span>
                  <span style={{ fontFamily: cgTheme.serif, fontSize: 22, color: cgTheme.accentDeep, textAlign: 'right' }}>{s.toFixed(1)}</span>
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
//  ARTBOARD · Clinical scribe
// =============================================================================
function CgClinical() {
  return (
    <div style={{ width: '100%', height: '100%', background: cgPaper, color: cgInk, fontFamily: cgTheme.body, display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
      <CgTopnav active="clinical" />
      <div style={{ padding: '28px 48px', display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div>
            <div style={{ fontFamily: cgTheme.mono, fontSize: 11, color: '#c4452a', letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 7, height: 7, background: '#c4452a', borderRadius: '50%' }} />Recording · encounter #4821
            </div>
            <h1 style={{ fontFamily: cgTheme.serif, fontSize: 48, fontWeight: 300, margin: 0, lineHeight: 1.05, letterSpacing: '-0.02em' }}>
              Margaret Holloway, <span style={{ fontStyle: 'italic', color: cgInk2 }}>62F</span>
            </h1>
            <div style={{ fontFamily: cgTheme.mono, fontSize: 11, color: cgInk3, marginTop: 8, display: 'flex', gap: 14 }}>
              <span>APR 26 · 14:02</span><span>DR REYES</span><span>operative · SOAP</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={{ padding: '8px 14px', background: 'transparent', border: `1px solid ${cgLine}`, borderRadius: 4, color: cgInk, fontSize: 12, fontFamily: cgTheme.body }}>edit</button>
            <button style={{ padding: '8px 16px', background: cgTheme.accentDeep, color: '#fff', border: 'none', borderRadius: 4, fontSize: 12, fontFamily: cgTheme.body, fontWeight: 500 }}>✦ attest & sign</button>
          </div>
        </div>

        {/* Live waveform with coord ticks */}
        <div style={{ background: cgPanel, border: `1px solid ${cgLine}`, borderRadius: 4, padding: '14px 22px', display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ width: 9, height: 9, background: '#c4452a', borderRadius: '50%' }} />
          <span style={{ fontFamily: cgTheme.mono, fontSize: 11, color: '#c4452a', textTransform: 'uppercase', letterSpacing: '0.14em', fontWeight: 600 }}>LIVE</span>
          <span style={{ fontFamily: cgTheme.mono, fontSize: 11, color: cgInk3 }}>03:24 / —</span>
          <div style={{ flex: 1, height: 24, position: 'relative' }}>
            <svg viewBox="0 0 300 24" preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
              {Array.from({ length: 120 }).map((_, i) => {
                const h = 3 + ((i * 13) % 17);
                return <rect key={i} x={i * 2.5} y={(24 - h) / 2} width="1.4" height={h} fill={i < 50 ? cgTheme.accent : cgLine} />;
              })}
            </svg>
          </div>
          <span style={{ fontFamily: cgTheme.mono, fontSize: 11, color: cgTheme.accent }}>en-US · 96% conf</span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <div style={{ background: cgPanel, border: `1px solid ${cgLine}`, borderRadius: 4 }}>
            <div style={{ padding: '16px 22px', borderBottom: `1px solid ${cgLine}`, display: 'flex', justifyContent: 'space-between' }}>
              <div style={{ fontFamily: cgTheme.serif, fontSize: 22, fontWeight: 400 }}>Transcript</div>
              <div style={{ fontFamily: cgTheme.mono, fontSize: 11, color: cgInk3 }}>2 speakers · 12:04</div>
            </div>
            <div style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 16, fontSize: 13.5, lineHeight: 1.55 }}>
              {[
                ['DR.R', 'How long has the pain been waking you up at night?', true],
                ['PT', "About a week now. Started cold-sensitive but now it just throbs.", false, true],
                ['DR.R', 'Any swelling, anything that feels hot to the touch?', true],
                ['PT', 'No swelling. No fever. Just the tooth itself.', false],
                ['DR.R', "Looking at the X-ray, the decay has reached the nerve. We're going to need to do a pulpotomy today and schedule the root canal.", true, true],
                ['PT', 'Whatever you think is best.', false],
              ].map(([sp, t, isDr, hl], i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '60px 1fr', gap: 12 }}>
                  <span style={{ fontFamily: cgTheme.mono, fontSize: 10.5, color: isDr ? cgTheme.accent : cgInk3, fontWeight: 500, letterSpacing: '0.06em' }}>{sp}</span>
                  <span style={{ color: hl ? cgInk : cgInk2, background: hl ? cgTheme.accentSoft : 'transparent', padding: hl ? '4px 10px' : 0, borderRadius: hl ? 3 : 0, borderLeft: hl ? `2px solid ${cgTheme.accent}` : 'none' }}>{t}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ background: cgPanel, border: `1px solid ${cgLine}`, borderRadius: 4 }}>
            <div style={{ padding: '16px 22px', borderBottom: `1px solid ${cgLine}`, display: 'flex', justifyContent: 'space-between' }}>
              <div style={{ fontFamily: cgTheme.serif, fontSize: 22, fontWeight: 400 }}>SOAP <span style={{ fontStyle: 'italic', color: cgTheme.accent }}>draft</span> <span style={{ color: '#b8852b', fontFamily: cgTheme.mono, fontSize: 11, marginLeft: 8 }}>● drafting</span></div>
              <div style={{ fontFamily: cgTheme.mono, fontSize: 11, color: cgInk3 }}>v0.4 · auto</div>
            </div>
            <div style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <div style={{ fontFamily: cgTheme.mono, fontSize: 10, color: cgTheme.accent, textTransform: 'uppercase', letterSpacing: '0.14em', marginBottom: 4 }}>Chief complaint</div>
                <div style={{ fontFamily: cgTheme.serif, fontSize: 20, fontStyle: 'italic', color: cgInk, lineHeight: 1.35, fontWeight: 400 }}>"Persistent ache, lower right molar, worse with cold for the past two weeks."</div>
              </div>
              {[
                ['Subjective', 'Gradual onset cold sensitivity #31, now spontaneous, waking patient at night. No prior trauma. OTC ibuprofen partially effective.'],
                ['Objective', 'Tooth #31 — deep distal caries to pulp on radiograph. Percussion tender. Cold test prolonged. Probing depths WNL. Adjacent teeth normal.'],
                ['Assessment', 'Symptomatic irreversible pulpitis #31, secondary to deep distal carious lesion. Tooth restorable.'],
              ].map(([k, v]) => (
                <div key={k}>
                  <div style={{ fontFamily: cgTheme.mono, fontSize: 10, color: cgTheme.accent, textTransform: 'uppercase', letterSpacing: '0.14em', marginBottom: 4 }}>{k}</div>
                  <div style={{ fontSize: 13.5, color: cgInk2, lineHeight: 1.55 }}>{v}</div>
                </div>
              ))}
              <div>
                <div style={{ fontFamily: cgTheme.mono, fontSize: 10, color: cgTheme.accent, textTransform: 'uppercase', letterSpacing: '0.14em', marginBottom: 6 }}>Plan</div>
                <ol style={{ paddingLeft: 18, margin: 0, fontSize: 13.5, color: cgInk2, lineHeight: 1.7 }}>
                  <li>Pulpotomy #31 today, RCT within 1 week.</li>
                  <li>Rx amoxicillin 500 mg TID × 7d.</li>
                  <li>Crown buildup post-RCT.</li>
                  <li>Hygiene recall 6 months.</li>
                </ol>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', paddingTop: 8, borderTop: `1px solid ${cgLine}` }}>
                {['K04.01', 'D3220', 'D2950'].map((c) => (
                  <span key={c} style={{ fontFamily: cgTheme.mono, fontSize: 11, padding: '3px 8px', background: cgTheme.accentSoft, color: cgTheme.accentDeep, border: `1px solid ${cgTheme.accentLine}`, borderRadius: 3 }}>{c}</span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

window.CgShell = CgShell;
window.CgDashboard = CgDashboard;
window.CgClinical = CgClinical;
