/* global React */
/* eslint-disable */
// =============================================================================
//  02 · CONSTELLATION  — dark editorial workspace, star-chart data viz
//  Type: Newsreader (display) + Inter Tight (text) + JetBrains Mono
//  Color: deep ink #07090d, paper-warm #f5efe1 accents, signal-violet #7a4cff
// =============================================================================

const coTheme = {
  bg: '#07090d',
  panel: '#0d1018',
  panelHi: '#131724',
  ink: '#f3ecdc',
  ink2: '#bdb5a3',
  ink3: '#7a7466',
  line: '#1c2230',
  lineSoft: '#15192280',
  violet: '#a587ff',
  violetDeep: '#7a4cff',
  amber: '#e9b34a',
  rose: '#ff6f78',
  green: '#7adda6',
  serif: "'Newsreader', 'Instrument Serif', serif",
  sans: "'Inter Tight', system-ui, sans-serif",
  mono: "'JetBrains Mono', monospace",
};

function CoOwl({ size = 22, color = coTheme.ink }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <circle cx="16" cy="16" r="13" stroke={color} strokeWidth="1" fill="none" opacity="0.4" />
      <circle cx="11" cy="14" r="3" stroke={color} strokeWidth="1.2" fill="none" />
      <circle cx="21" cy="14" r="3" stroke={color} strokeWidth="1.2" fill="none" />
      <circle cx="11" cy="14" r="1.1" fill={coTheme.violet} />
      <circle cx="21" cy="14" r="1.1" fill={coTheme.violet} />
      <path d="M14.5 18 L16 20.5 L17.5 18 Z" fill={color} />
    </svg>
  );
}

function CoTopnav({ active = 'dashboard' }) {
  const items = [
    ['dashboard', 'Dashboard'],
    ['calls', 'Calls'],
    ['clinical', 'Clinical'],
    ['coaching', 'Coaching'],
    ['reports', 'Reports'],
    ['team', 'Team'],
  ];
  return (
    <header
      style={{
        background: coTheme.bg,
        borderBottom: `1px solid ${coTheme.line}`,
        padding: '14px 28px',
        display: 'flex',
        alignItems: 'center',
        gap: 28,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <CoOwl />
        <span style={{ fontFamily: coTheme.serif, fontSize: 22, color: coTheme.ink, letterSpacing: '-0.01em' }}>
          Observatory
        </span>
        <span style={{ fontFamily: coTheme.mono, fontSize: 10, color: coTheme.ink3, padding: '2px 6px', border: `1px solid ${coTheme.line}`, borderRadius: 3, marginLeft: 8 }}>
          westside-dental
        </span>
      </div>
      <nav style={{ display: 'flex', gap: 4, marginLeft: 24 }}>
        {items.map(([id, label]) => {
          const a = id === active;
          return (
            <div
              key={id}
              style={{
                padding: '6px 12px',
                fontSize: 13,
                color: a ? coTheme.ink : coTheme.ink2,
                fontFamily: coTheme.sans,
                fontWeight: a ? 500 : 400,
                borderBottom: a ? `1px solid ${coTheme.violet}` : '1px solid transparent',
                marginBottom: -15,
                paddingBottom: 14,
              }}
            >
              {label}
            </div>
          );
        })}
      </nav>
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div
          style={{
            padding: '6px 12px',
            background: coTheme.panel,
            border: `1px solid ${coTheme.line}`,
            borderRadius: 4,
            fontSize: 12,
            color: coTheme.ink3,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            width: 280,
            fontFamily: coTheme.mono,
          }}
        >
          <span>›</span> command…
          <span style={{ marginLeft: 'auto', color: coTheme.ink3, fontSize: 10 }}>⌘K</span>
        </div>
        <div style={{ width: 28, height: 28, borderRadius: '50%', background: coTheme.violetDeep, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 12, fontFamily: coTheme.serif }}>R</div>
      </div>
    </header>
  );
}

// Star-chart data viz: scatter calls in time x score space, color by sentiment
function CoStarChart({ height = 260 }) {
  const stars = [];
  for (let i = 0; i < 84; i++) {
    const x = (i * 47.3) % 100;
    const y = 12 + ((i * 17.7) % 70);
    const s = (i % 7 === 0) ? 'pos' : (i % 11 === 0) ? 'neg' : (i % 5 === 0) ? 'neu' : 'pos';
    const r = 1.2 + ((i * 3) % 4) * 0.5;
    stars.push({ x, y, s, r });
  }
  // Constellation lines (a few connections to suggest pattern)
  const lines = [
    [0, 12], [12, 23], [23, 30], [30, 41], [41, 55], [55, 70],
    [5, 17], [17, 29], [29, 44],
  ];
  const col = (s) => s === 'pos' ? coTheme.violet : s === 'neg' ? coTheme.rose : coTheme.amber;
  return (
    <div style={{ position: 'relative', height, background: 'radial-gradient(ellipse at 30% 20%, #1a1f33 0%, #0a0c14 70%)', borderRadius: 6, overflow: 'hidden', border: `1px solid ${coTheme.line}` }}>
      <svg viewBox="0 0 100 80" preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
        {/* faint grid */}
        {[20, 40, 60].map((y) => <line key={y} x1="0" x2="100" y1={y} y2={y} stroke={coTheme.line} strokeWidth="0.1" />)}
        {/* constellation lines */}
        {lines.map(([a, b], i) => {
          const A = stars[a]; const B = stars[b];
          if (!A || !B) return null;
          return <line key={i} x1={A.x} y1={A.y} x2={B.x} y2={B.y} stroke={coTheme.violet} strokeWidth="0.15" opacity="0.5" />;
        })}
        {/* stars */}
        {stars.map((s, i) => (
          <g key={i}>
            <circle cx={s.x} cy={s.y} r={s.r * 1.6} fill={col(s.s)} opacity="0.15" />
            <circle cx={s.x} cy={s.y} r={s.r * 0.5} fill={col(s.s)} />
          </g>
        ))}
      </svg>
      <div style={{ position: 'absolute', top: 12, left: 14, fontFamily: coTheme.mono, fontSize: 10, color: coTheme.ink3, textTransform: 'uppercase', letterSpacing: '0.12em' }}>
        Score × Time · 30d · 1,284 calls
      </div>
      <div style={{ position: 'absolute', bottom: 10, right: 14, fontFamily: coTheme.mono, fontSize: 10, color: coTheme.ink3, display: 'flex', gap: 12 }}>
        <span><span style={{ display: 'inline-block', width: 6, height: 6, background: coTheme.violet, borderRadius: '50%', marginRight: 5 }} />pos</span>
        <span><span style={{ display: 'inline-block', width: 6, height: 6, background: coTheme.amber, borderRadius: '50%', marginRight: 5 }} />neu</span>
        <span><span style={{ display: 'inline-block', width: 6, height: 6, background: coTheme.rose, borderRadius: '50%', marginRight: 5 }} />neg</span>
      </div>
    </div>
  );
}

function CoCard({ children, style }) {
  return (
    <div
      style={{
        background: coTheme.panel,
        border: `1px solid ${coTheme.line}`,
        borderRadius: 6,
        padding: '20px 22px',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// ============================================================================
//  ARTBOARD 1 · App shell
// ============================================================================
function ConstellationShell() {
  return (
    <div style={{ width: '100%', height: '100%', background: coTheme.bg, color: coTheme.ink, fontFamily: coTheme.sans, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <CoTopnav active="dashboard" />
      <div style={{ flex: 1, padding: '40px 60px', display: 'flex', flexDirection: 'column', gap: 28 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div>
            <div style={{ fontFamily: coTheme.mono, fontSize: 11, color: coTheme.violet, letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: 14 }}>
              ★ Tuesday · 26 April · 14:42 PT
            </div>
            <h1 style={{ fontFamily: coTheme.serif, fontSize: 84, fontWeight: 300, margin: 0, lineHeight: 0.95, letterSpacing: '-0.03em' }}>
              Today the sky is <span style={{ fontStyle: 'italic', color: coTheme.violet }}>clear</span>.
            </h1>
            <div style={{ fontSize: 16, color: coTheme.ink2, marginTop: 16, maxWidth: 560 }}>
              42 calls observed · avg 7.84 · 4 anomalies flagged for review.
            </div>
          </div>
          <div style={{ fontFamily: coTheme.mono, fontSize: 11, color: coTheme.ink3, textAlign: 'right' }}>
            <div>RA 14h 02m</div>
            <div>DEC +42°</div>
            <div style={{ color: coTheme.violet, marginTop: 6 }}>seeing: excellent</div>
          </div>
        </div>

        <CoStarChart height={320} />

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
          {[
            ['Calls', '1,284', '+18%'],
            ['Avg score', '7.84', '+0.31'],
            ['Sentiment', '68%', '+4%'],
            ['Pending notes', '12', 'oldest 2h'],
          ].map(([k, v, d]) => (
            <div key={k} style={{ borderTop: `1px solid ${coTheme.line}`, paddingTop: 14 }}>
              <div style={{ fontFamily: coTheme.mono, fontSize: 10, color: coTheme.ink3, textTransform: 'uppercase', letterSpacing: '0.12em' }}>{k}</div>
              <div style={{ fontFamily: coTheme.serif, fontSize: 36, marginTop: 6 }}>{v}</div>
              <div style={{ fontFamily: coTheme.mono, fontSize: 11, color: coTheme.violet }}>{d}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
//  ARTBOARD 2 · Dashboard
// ============================================================================
function ConstellationDashboard() {
  const calls = [
    ['14:02', 'Maya P.', 'Treatment plan', 9.1, 'pos', '12:04'],
    ['13:48', 'Devon W.', 'New patient', 8.4, 'pos', '08:21'],
    ['13:12', 'Sara L.', 'Insurance', 5.2, 'neg', '14:57'],
    ['12:55', 'Maya P.', 'Recall', 7.8, 'pos', '04:11'],
    ['12:30', 'Jordan T.', 'Billing', 6.0, 'neu', '09:42'],
    ['11:58', 'Devon W.', 'Treatment plan', 8.9, 'pos', '15:30'],
  ];
  return (
    <div style={{ width: '100%', height: '100%', background: coTheme.bg, color: coTheme.ink, fontFamily: coTheme.sans, display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
      <CoTopnav active="dashboard" />
      <div style={{ padding: '36px 48px', display: 'flex', flexDirection: 'column', gap: 28 }}>
        {/* Editorial header */}
        <div>
          <div style={{ fontFamily: coTheme.mono, fontSize: 11, color: coTheme.violet, letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: 12 }}>
            ★ Volume CXVII · No. 117 · April 26, 2026
          </div>
          <h1 style={{ fontFamily: coTheme.serif, fontSize: 64, fontWeight: 300, margin: 0, lineHeight: 1, letterSpacing: '-0.03em' }}>
            The day's <span style={{ fontStyle: 'italic', color: coTheme.violet }}>observations</span>.
          </h1>
        </div>

        {/* Hero star chart with side stats */}
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 18 }}>
          <CoStarChart height={360} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {[
              ['Calls observed', '1,284', '+18% vs prior 30d', coTheme.violet],
              ['Mean score', '7.84', '+0.31', coTheme.green],
              ['Sentiment+', '68%', '+4 pts', coTheme.violet],
              ['Anomalies', '04', 'flagged for review', coTheme.rose],
            ].map(([k, v, d, c]) => (
              <div key={k} style={{ borderLeft: `2px solid ${c}`, paddingLeft: 14 }}>
                <div style={{ fontFamily: coTheme.mono, fontSize: 10, color: coTheme.ink3, textTransform: 'uppercase', letterSpacing: '0.12em' }}>{k}</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
                  <span style={{ fontFamily: coTheme.serif, fontSize: 38, lineHeight: 1.05 }}>{v}</span>
                  <span style={{ fontFamily: coTheme.mono, fontSize: 11, color: coTheme.ink3 }}>{d}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Calls log + sidebar */}
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 18 }}>
          <CoCard style={{ padding: 0 }}>
            <div style={{ padding: '16px 22px', borderBottom: `1px solid ${coTheme.line}`, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <div style={{ fontFamily: coTheme.serif, fontSize: 22 }}>Recent transmissions</div>
              <div style={{ fontFamily: coTheme.mono, fontSize: 11, color: coTheme.violet }}>view all →</div>
            </div>
            <div>
              {calls.map(([t, ag, cat, sc, sn, dur], i) => (
                <div key={i} style={{ padding: '14px 22px', borderTop: i === 0 ? 'none' : `1px solid ${coTheme.line}`, display: 'grid', gridTemplateColumns: '60px 140px 1fr 70px 80px 60px', alignItems: 'center', gap: 12, fontSize: 13.5 }}>
                  <span style={{ fontFamily: coTheme.mono, fontSize: 11, color: coTheme.ink3 }}>{t}</span>
                  <span>{ag}</span>
                  <span style={{ color: coTheme.ink2 }}>{cat}</span>
                  <span style={{ fontFamily: coTheme.serif, fontSize: 22, color: sc < 6 ? coTheme.rose : coTheme.ink }}>{sc.toFixed(1)}</span>
                  <span style={{ fontFamily: coTheme.mono, fontSize: 11, color: sn === 'pos' ? coTheme.violet : sn === 'neg' ? coTheme.rose : coTheme.amber, textTransform: 'uppercase', letterSpacing: '0.08em' }}>● {sn}</span>
                  <span style={{ fontFamily: coTheme.mono, fontSize: 11, color: coTheme.ink3 }}>{dur}</span>
                </div>
              ))}
            </div>
          </CoCard>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <CoCard>
              <div style={{ fontFamily: coTheme.mono, fontSize: 10, color: coTheme.ink3, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 12 }}>Constellation of the week</div>
              <div style={{ fontFamily: coTheme.serif, fontSize: 26, lineHeight: 1.15, fontStyle: 'italic', color: coTheme.violet }}>"The reluctant insurance call"</div>
              <div style={{ fontSize: 13, color: coTheme.ink2, marginTop: 10, lineHeight: 1.5 }}>
                14 calls cluster around a recurring pattern — patients pushing back on insurance coverage. Avg score 5.4. Suggests a coaching opportunity around verification scripts.
              </div>
              <div style={{ marginTop: 12, fontFamily: coTheme.mono, fontSize: 11, color: coTheme.violet }}>open cluster →</div>
            </CoCard>
            <CoCard>
              <div style={{ fontFamily: coTheme.mono, fontSize: 10, color: coTheme.ink3, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 10 }}>Bright stars</div>
              {[['Maya P.', 9.1], ['Devon W.', 8.7], ['Jordan T.', 8.2]].map(([n, s]) => (
                <div key={n} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderTop: `1px solid ${coTheme.line}` }}>
                  <span style={{ fontSize: 14 }}>{n}</span>
                  <span style={{ fontFamily: coTheme.serif, fontSize: 22, color: coTheme.violet }}>{s.toFixed(1)}</span>
                </div>
              ))}
            </CoCard>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
//  ARTBOARD 3 · Clinical scribe (live transcript)
// ============================================================================
function ConstellationClinical() {
  return (
    <div style={{ width: '100%', height: '100%', background: coTheme.bg, color: coTheme.ink, fontFamily: coTheme.sans, display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
      <CoTopnav active="clinical" />
      <div style={{ padding: '32px 48px', display: 'flex', flexDirection: 'column', gap: 22 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div>
            <div style={{ fontFamily: coTheme.mono, fontSize: 11, color: coTheme.violet, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 8 }}>
              ● recording · encounter #4821
            </div>
            <h1 style={{ fontFamily: coTheme.serif, fontSize: 52, fontWeight: 300, margin: 0, lineHeight: 1.05, letterSpacing: '-0.02em' }}>
              Margaret Holloway, <span style={{ fontStyle: 'italic', color: coTheme.ink2 }}>62F</span>
            </h1>
            <div style={{ fontFamily: coTheme.mono, fontSize: 11, color: coTheme.ink3, marginTop: 8, display: 'flex', gap: 14 }}>
              <span>APR 26 · 14:02</span><span>DR REYES</span><span>operative · SOAP</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={{ padding: '8px 14px', background: coTheme.panel, border: `1px solid ${coTheme.line}`, borderRadius: 4, color: coTheme.ink, fontSize: 12, fontFamily: coTheme.sans }}>edit</button>
            <button style={{ padding: '8px 14px', background: coTheme.violetDeep, color: '#fff', border: 'none', borderRadius: 4, fontSize: 12, fontFamily: coTheme.sans, fontWeight: 500 }}>✓ attest</button>
          </div>
        </div>

        {/* Live waveform strip */}
        <CoCard style={{ padding: '16px 22px', display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ width: 10, height: 10, background: coTheme.rose, borderRadius: '50%' }} />
          <span style={{ fontFamily: coTheme.mono, fontSize: 11, color: coTheme.rose, textTransform: 'uppercase', letterSpacing: '0.14em' }}>LIVE</span>
          <span style={{ fontFamily: coTheme.mono, fontSize: 11, color: coTheme.ink3 }}>03:24 / —</span>
          <div style={{ flex: 1, height: 24, position: 'relative' }}>
            <svg viewBox="0 0 300 24" preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
              {Array.from({ length: 120 }).map((_, i) => {
                const h = 3 + ((i * 13) % 17);
                return <rect key={i} x={i * 2.5} y={(24 - h) / 2} width="1.4" height={h} fill={i < 50 ? coTheme.violet : coTheme.line} rx="0.6" />;
              })}
            </svg>
          </div>
          <span style={{ fontFamily: coTheme.mono, fontSize: 11, color: coTheme.violet }}>en-US · 96% conf</span>
        </CoCard>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
          {/* Transcript */}
          <CoCard style={{ padding: 0 }}>
            <div style={{ padding: '14px 22px', borderBottom: `1px solid ${coTheme.line}`, display: 'flex', justifyContent: 'space-between' }}>
              <div style={{ fontFamily: coTheme.serif, fontSize: 20 }}>Transcript</div>
              <div style={{ fontFamily: coTheme.mono, fontSize: 11, color: coTheme.ink3 }}>2 speakers · 12:04</div>
            </div>
            <div style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 16, fontSize: 13.5, lineHeight: 1.55 }}>
              {[
                ['DR.R', 'How long has the pain been waking you up at night?', true],
                ['PT', "About a week now. It started just being cold-sensitive but now it just throbs.", false],
                ['DR.R', 'Any swelling, anything that feels hot to the touch?', true],
                ['PT', 'No swelling. No fever. Just the tooth itself.', false],
                ['DR.R', "Looking at the X-ray, the decay has reached the nerve. We're going to need to do a pulpotomy today and schedule the root canal.", true, true],
                ['PT', 'Whatever you think is best.', false],
              ].map(([sp, t, isDr, hl], i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '60px 1fr', gap: 12 }}>
                  <span style={{ fontFamily: coTheme.mono, fontSize: 10.5, color: isDr ? coTheme.violet : coTheme.ink3, letterSpacing: '0.06em' }}>{sp}</span>
                  <span style={{ color: hl ? coTheme.ink : coTheme.ink2, background: hl ? 'rgba(165,135,255,0.08)' : 'transparent', padding: hl ? '4px 8px' : 0, borderRadius: hl ? 3 : 0, borderLeft: hl ? `2px solid ${coTheme.violet}` : 'none' }}>{t}</span>
                </div>
              ))}
            </div>
          </CoCard>

          {/* SOAP note */}
          <CoCard style={{ padding: 0 }}>
            <div style={{ padding: '14px 22px', borderBottom: `1px solid ${coTheme.line}`, display: 'flex', justifyContent: 'space-between' }}>
              <div style={{ fontFamily: coTheme.serif, fontSize: 20 }}>SOAP draft <span style={{ color: coTheme.amber, fontFamily: coTheme.mono, fontSize: 11, marginLeft: 8 }}>● drafting</span></div>
              <div style={{ fontFamily: coTheme.mono, fontSize: 11, color: coTheme.ink3 }}>v0.4 · auto</div>
            </div>
            <div style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <div style={{ fontFamily: coTheme.mono, fontSize: 10, color: coTheme.violet, textTransform: 'uppercase', letterSpacing: '0.14em', marginBottom: 4 }}>Chief complaint</div>
                <div style={{ fontFamily: coTheme.serif, fontSize: 17, fontStyle: 'italic', color: coTheme.ink, lineHeight: 1.4 }}>"Persistent ache, lower right molar, worse with cold for the past two weeks."</div>
              </div>
              {[
                ['Subjective', 'Gradual onset cold sensitivity #31, now spontaneous, waking patient at night. No prior trauma. OTC ibuprofen partially effective.'],
                ['Objective', 'Tooth #31 — deep distal caries to pulp on radiograph. Percussion tender. Cold test prolonged. Probing depths WNL. Adjacent teeth normal.'],
                ['Assessment', 'Symptomatic irreversible pulpitis #31, secondary to deep distal carious lesion. Tooth restorable.'],
              ].map(([k, v]) => (
                <div key={k}>
                  <div style={{ fontFamily: coTheme.mono, fontSize: 10, color: coTheme.violet, textTransform: 'uppercase', letterSpacing: '0.14em', marginBottom: 4 }}>{k}</div>
                  <div style={{ fontSize: 13.5, color: coTheme.ink2, lineHeight: 1.55 }}>{v}</div>
                </div>
              ))}
              <div>
                <div style={{ fontFamily: coTheme.mono, fontSize: 10, color: coTheme.violet, textTransform: 'uppercase', letterSpacing: '0.14em', marginBottom: 6 }}>Plan</div>
                <ol style={{ paddingLeft: 18, margin: 0, fontSize: 13.5, color: coTheme.ink2, lineHeight: 1.7 }}>
                  <li>Pulpotomy #31 today, RCT within 1 week.</li>
                  <li>Rx amoxicillin 500 mg TID × 7d.</li>
                  <li>Crown buildup post-RCT.</li>
                  <li>Hygiene recall 6 months.</li>
                </ol>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', paddingTop: 8, borderTop: `1px solid ${coTheme.line}` }}>
                {[['K04.01', 'icd'], ['D3220', 'cdt'], ['D2950', 'cdt']].map(([c, t]) => (
                  <span key={c} style={{ fontFamily: coTheme.mono, fontSize: 11, padding: '3px 8px', background: 'rgba(165,135,255,0.08)', color: coTheme.violet, border: `1px solid ${coTheme.line}`, borderRadius: 3 }}>{c}</span>
                ))}
              </div>
            </div>
          </CoCard>
        </div>
      </div>
    </div>
  );
}

window.ConstellationShell = ConstellationShell;
window.ConstellationDashboard = ConstellationDashboard;
window.ConstellationClinical = ConstellationClinical;
