/* global React */
/* eslint-disable */
// =============================================================================
//  CONSTELLATION · LIGHT — three iterations
//  All share: paper #fafafa background, dark ink, owl mark, "constellation" DNA
//  Differ in: accent color, type pairing, density, motif intensity
// =============================================================================

// ---------- shared ink + helpers ----------
const baseInk = '#0d1018';
const baseInk2 = '#3a3f4a';
const baseInk3 = '#7d818c';
const basePaper = '#fafafa';
const basePanel = '#ffffff';
const baseLine = '#e6e6e3';
const baseLineSoft = '#efefec';

function ClOwl({ size = 22, color = baseInk, accent }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <circle cx="16" cy="16" r="13" stroke={color} strokeWidth="1" fill="none" opacity="0.35" />
      <circle cx="11" cy="14" r="3" stroke={color} strokeWidth="1.2" fill="none" />
      <circle cx="21" cy="14" r="3" stroke={color} strokeWidth="1.2" fill="none" />
      <circle cx="11" cy="14" r="1.1" fill={accent || color} />
      <circle cx="21" cy="14" r="1.1" fill={accent || color} />
      <path d="M14.5 18 L16 20.5 L17.5 18 Z" fill={color} />
    </svg>
  );
}

// Star-chart for light backgrounds — re-tuned colors
function ClStarChart({ height = 240, accent, faint = false }) {
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
  const col = (s) => s === 'pos' ? accent : s === 'neg' ? '#c4452a' : '#b8852b';
  return (
    <div style={{ position: 'relative', height, background: faint ? 'transparent' : '#f4f3ee', borderRadius: 4, overflow: 'hidden', border: faint ? 'none' : `1px solid ${baseLine}` }}>
      <svg viewBox="0 0 100 80" preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
        {[20, 40, 60].map((y) => <line key={y} x1="0" x2="100" y1={y} y2={y} stroke={baseLine} strokeWidth="0.1" />)}
        {lines.map(([a, b], i) => {
          const A = stars[a]; const B = stars[b];
          if (!A || !B) return null;
          return <line key={i} x1={A.x} y1={A.y} x2={B.x} y2={B.y} stroke={accent} strokeWidth="0.15" opacity="0.45" />;
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
//  ITERATION A · OPERATIONS  — rust accent, dense ops-forward table, grotesk
//  Type: Inter Tight (display) · Inter (body) · IBM Plex Mono
// =============================================================================
const opTheme = {
  accent: '#a8501f',
  accentSoft: '#fbeee5',
  accentLine: '#e8c9b0',
  display: "'Inter Tight', system-ui, sans-serif",
  body: "'Inter', system-ui, sans-serif",
  mono: "'IBM Plex Mono', monospace",
};

function OpTopnav({ active = 'dashboard' }) {
  const items = ['Dashboard', 'Calls', 'Clinical', 'Coaching', 'Reports', 'Team'];
  return (
    <header style={{ background: basePanel, borderBottom: `1px solid ${baseLine}`, padding: '12px 24px', display: 'flex', alignItems: 'center', gap: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <ClOwl size={20} color={baseInk} accent={opTheme.accent} />
        <span style={{ fontFamily: opTheme.display, fontSize: 17, fontWeight: 600, letterSpacing: '-0.02em', color: baseInk }}>Observatory</span>
        <span style={{ fontFamily: opTheme.mono, fontSize: 10, color: baseInk3, padding: '2px 6px', border: `1px solid ${baseLine}`, borderRadius: 3, marginLeft: 4 }}>westside-dental</span>
      </div>
      <nav style={{ display: 'flex', gap: 2, marginLeft: 16 }}>
        {items.map((label) => {
          const a = label.toLowerCase() === active;
          return (
            <div key={label} style={{ padding: '6px 11px', fontSize: 13, color: a ? baseInk : baseInk2, fontFamily: opTheme.body, fontWeight: a ? 600 : 400, borderBottom: a ? `2px solid ${opTheme.accent}` : '2px solid transparent', marginBottom: -13, paddingBottom: 14 }}>{label}</div>
          );
        })}
      </nav>
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ padding: '5px 10px', background: '#f3f3f0', border: `1px solid ${baseLine}`, borderRadius: 3, fontSize: 12, color: baseInk3, display: 'flex', alignItems: 'center', gap: 8, width: 240, fontFamily: opTheme.mono }}>
          <span>›</span> jump to… <span style={{ marginLeft: 'auto', fontSize: 10 }}>⌘K</span>
        </div>
        <div style={{ width: 26, height: 26, borderRadius: '50%', background: opTheme.accent, color: '#fff', fontSize: 12, fontFamily: opTheme.display, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>R</div>
      </div>
    </header>
  );
}

function OpShell() {
  const stats = [
    ['Calls', '1,284', '+18%', true],
    ['Avg score', '7.84', '+0.31', true],
    ['Sentiment+', '68%', '+4 pts', true],
    ['Notes pending', '12', 'oldest 2h', false],
  ];
  return (
    <div style={{ width: '100%', height: '100%', background: basePaper, color: baseInk, fontFamily: opTheme.body, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <OpTopnav active="dashboard" />
      <div style={{ flex: 1, padding: '32px 40px', display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <div>
            <div style={{ fontFamily: opTheme.mono, fontSize: 11, color: opTheme.accent, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 6, fontWeight: 500 }}>Tue · 26 Apr · 14:42 PT</div>
            <h1 style={{ fontFamily: opTheme.display, fontSize: 44, fontWeight: 600, margin: 0, lineHeight: 1.05, letterSpacing: '-0.025em' }}>
              42 calls observed today.
            </h1>
            <div style={{ fontSize: 14.5, color: baseInk2, marginTop: 8 }}>Avg score 7.84 · 4 anomalies flagged for review.</div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button style={{ padding: '7px 12px', background: 'transparent', border: `1px solid ${baseLine}`, borderRadius: 4, fontSize: 12.5, color: baseInk2, fontFamily: opTheme.body }}>Export</button>
            <button style={{ padding: '7px 12px', background: opTheme.accent, color: '#fff', border: 'none', borderRadius: 4, fontSize: 12.5, fontWeight: 500, fontFamily: opTheme.body }}>+ New review</button>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 0, border: `1px solid ${baseLine}`, borderRadius: 6, background: basePanel }}>
          {stats.map(([k, v, d, up], i) => (
            <div key={k} style={{ padding: '16px 18px', borderRight: i < 3 ? `1px solid ${baseLine}` : 'none' }}>
              <div style={{ fontFamily: opTheme.mono, fontSize: 10, color: baseInk3, textTransform: 'uppercase', letterSpacing: '0.12em' }}>{k}</div>
              <div style={{ fontFamily: opTheme.display, fontSize: 32, fontWeight: 600, marginTop: 4, letterSpacing: '-0.02em' }}>{v}</div>
              <div style={{ fontFamily: opTheme.mono, fontSize: 11, color: up ? opTheme.accent : baseInk3 }}>{d}</div>
            </div>
          ))}
        </div>
        <ClStarChart height={300} accent={opTheme.accent} />
      </div>
    </div>
  );
}

function OpDashboard() {
  const calls = [
    ['14:02', 'Maya P.', 'Treatment plan', 9.1, 'pos', '12:04', '✓'],
    ['13:48', 'Devon W.', 'New patient', 8.4, 'pos', '08:21', '✓'],
    ['13:12', 'Sara L.', 'Insurance', 5.2, 'neg', '14:57', '⚑'],
    ['12:55', 'Maya P.', 'Recall', 7.8, 'pos', '04:11', '✓'],
    ['12:30', 'Jordan T.', 'Billing', 6.0, 'neu', '09:42', '◎'],
    ['11:58', 'Devon W.', 'Treatment plan', 8.9, 'pos', '15:30', '✓'],
    ['11:14', 'Sara L.', 'New patient', 7.1, 'neu', '06:19', '✓'],
    ['10:42', 'Maya P.', 'Insurance', 8.0, 'pos', '07:08', '✓'],
    ['10:18', 'Jordan T.', 'Recall', 7.5, 'neu', '03:54', '✓'],
    ['09:56', 'Devon W.', 'Billing', 4.9, 'neg', '18:22', '⚑'],
    ['09:30', 'Maya P.', 'Treatment plan', 8.6, 'pos', '11:14', '✓'],
    ['09:02', 'Sara L.', 'Recall', 7.0, 'neu', '04:48', '✓'],
  ];
  return (
    <div style={{ width: '100%', height: '100%', background: basePaper, color: baseInk, fontFamily: opTheme.body, display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
      <OpTopnav active="dashboard" />
      <div style={{ padding: '24px 32px', display: 'flex', flexDirection: 'column', gap: 18 }}>
        {/* Compact header strip */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 24, paddingBottom: 12, borderBottom: `1px solid ${baseLine}` }}>
          <h1 style={{ fontFamily: opTheme.display, fontSize: 26, fontWeight: 600, margin: 0, letterSpacing: '-0.02em' }}>Operations</h1>
          <div style={{ display: 'flex', gap: 4, fontFamily: opTheme.mono, fontSize: 11 }}>
            {['1d', '7d', '30d', '90d', 'YTD'].map((p) => (
              <span key={p} style={{ padding: '3px 9px', borderRadius: 3, background: p === '30d' ? opTheme.accent : 'transparent', color: p === '30d' ? '#fff' : baseInk2, fontWeight: p === '30d' ? 500 : 400 }}>{p}</span>
            ))}
          </div>
          <div style={{ marginLeft: 'auto', fontFamily: opTheme.mono, fontSize: 11, color: baseInk3 }}>updated 14:42 · live</div>
        </div>

        {/* Dense KPI strip + small star-chart */}
        <div style={{ display: 'grid', gridTemplateColumns: '3fr 1.4fr', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', border: `1px solid ${baseLine}`, borderRadius: 4, background: basePanel }}>
            {[
              ['Calls observed', '1,284', '+18% vs prior'],
              ['Mean score', '7.84', '+0.31'],
              ['Sentiment positive', '68%', '+4 pts'],
              ['Pending attestation', '12', 'oldest 2h'],
            ].map(([k, v, d], i) => (
              <div key={k} style={{ padding: '14px 16px', borderRight: i < 3 ? `1px solid ${baseLine}` : 'none' }}>
                <div style={{ fontFamily: opTheme.mono, fontSize: 10, color: baseInk3, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{k}</div>
                <div style={{ fontFamily: opTheme.display, fontSize: 26, fontWeight: 600, marginTop: 4, letterSpacing: '-0.02em' }}>{v}</div>
                <div style={{ fontFamily: opTheme.mono, fontSize: 10.5, color: opTheme.accent }}>{d}</div>
              </div>
            ))}
          </div>
          <div style={{ border: `1px solid ${baseLine}`, borderRadius: 4, background: basePanel, padding: 8, position: 'relative' }}>
            <div style={{ fontFamily: opTheme.mono, fontSize: 9.5, color: baseInk3, textTransform: 'uppercase', letterSpacing: '0.1em', position: 'absolute', top: 10, left: 12, zIndex: 1 }}>Score × time · 30d</div>
            <ClStarChart height={108} accent={opTheme.accent} />
          </div>
        </div>

        {/* DENSE table — the centerpiece */}
        <div style={{ border: `1px solid ${baseLine}`, borderRadius: 4, background: basePanel, overflow: 'hidden' }}>
          <div style={{ padding: '10px 16px', borderBottom: `1px solid ${baseLine}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f7f6f1' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <span style={{ fontFamily: opTheme.display, fontSize: 14, fontWeight: 600 }}>Recent calls</span>
              <span style={{ fontFamily: opTheme.mono, fontSize: 11, color: baseInk3 }}>1,284 total · showing 12</span>
            </div>
            <div style={{ display: 'flex', gap: 6, fontFamily: opTheme.mono, fontSize: 11 }}>
              {['All', 'Flagged', 'Pos', 'Neg', 'Pending'].map((f) => (
                <span key={f} style={{ padding: '3px 8px', border: `1px solid ${f === 'All' ? opTheme.accent : baseLine}`, borderRadius: 3, color: f === 'All' ? opTheme.accent : baseInk2, background: f === 'All' ? opTheme.accentSoft : '#fff' }}>{f}</span>
              ))}
            </div>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#fbfaf6', borderBottom: `1px solid ${baseLine}`, fontFamily: opTheme.mono, fontSize: 10, color: baseInk3, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                {['', 'Time', 'Agent', 'Topic', 'Score', 'Sentiment', 'Duration', 'Status'].map((h, i) => (
                  <th key={h+i} style={{ padding: '8px 14px', textAlign: i === 4 ? 'right' : 'left', fontWeight: 500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {calls.map(([t, ag, cat, sc, sn, dur, st], i) => (
                <tr key={i} style={{ borderBottom: `1px solid ${baseLineSoft}` }}>
                  <td style={{ padding: '9px 0 9px 14px', width: 16, color: st === '⚑' ? opTheme.accent : baseInk3, fontFamily: opTheme.mono, fontSize: 13 }}>{st}</td>
                  <td style={{ padding: '9px 14px', fontFamily: opTheme.mono, color: baseInk3, fontSize: 12 }}>{t}</td>
                  <td style={{ padding: '9px 14px', fontWeight: 500 }}>{ag}</td>
                  <td style={{ padding: '9px 14px', color: baseInk2 }}>{cat}</td>
                  <td style={{ padding: '9px 14px', textAlign: 'right', fontFamily: opTheme.mono, fontWeight: 600, color: sc < 6 ? '#c4452a' : baseInk }}>{sc.toFixed(1)}</td>
                  <td style={{ padding: '9px 14px', fontFamily: opTheme.mono, fontSize: 11.5, color: sn === 'pos' ? opTheme.accent : sn === 'neg' ? '#c4452a' : '#b8852b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>● {sn}</td>
                  <td style={{ padding: '9px 14px', fontFamily: opTheme.mono, fontSize: 12, color: baseInk3 }}>{dur}</td>
                  <td style={{ padding: '9px 14px', fontFamily: opTheme.mono, fontSize: 11, color: baseInk3 }}>{st === '⚑' ? 'review' : st === '◎' ? 'pending' : 'analyzed'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function OpClinical() {
  return (
    <div style={{ width: '100%', height: '100%', background: basePaper, color: baseInk, fontFamily: opTheme.body, display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
      <OpTopnav active="clinical" />
      <div style={{ padding: '24px 32px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', paddingBottom: 12, borderBottom: `1px solid ${baseLine}` }}>
          <div>
            <div style={{ fontFamily: opTheme.mono, fontSize: 11, color: '#c4452a', letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 4, display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ width: 6, height: 6, background: '#c4452a', borderRadius: '50%' }} />Recording · #4821
            </div>
            <h1 style={{ fontFamily: opTheme.display, fontSize: 32, fontWeight: 600, margin: 0, letterSpacing: '-0.02em' }}>Margaret Holloway, 62F</h1>
            <div style={{ fontFamily: opTheme.mono, fontSize: 11, color: baseInk3, marginTop: 4 }}>APR 26 · 14:02 · DR REYES · operative</div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button style={{ padding: '7px 12px', background: 'transparent', border: `1px solid ${baseLine}`, borderRadius: 4, fontSize: 12.5, color: baseInk2 }}>Edit</button>
            <button style={{ padding: '7px 14px', background: opTheme.accent, color: '#fff', border: 'none', borderRadius: 4, fontSize: 12.5, fontWeight: 500 }}>✓ Attest & sign</button>
          </div>
        </div>

        {/* Live waveform */}
        <div style={{ background: basePanel, border: `1px solid ${baseLine}`, borderRadius: 4, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ fontFamily: opTheme.mono, fontSize: 11, color: '#c4452a', fontWeight: 600 }}>● 03:24</span>
          <div style={{ flex: 1, height: 22 }}>
            <svg viewBox="0 0 300 22" preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
              {Array.from({ length: 120 }).map((_, i) => {
                const h = 2 + ((i * 13) % 16);
                return <rect key={i} x={i * 2.5} y={(22 - h) / 2} width="1.4" height={h} fill={i < 50 ? opTheme.accent : baseLine} />;
              })}
            </svg>
          </div>
          <span style={{ fontFamily: opTheme.mono, fontSize: 11, color: baseInk3 }}>en-US · 96% · 2 spk</span>
        </div>

        {/* Two columns */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div style={{ background: basePanel, border: `1px solid ${baseLine}`, borderRadius: 4 }}>
            <div style={{ padding: '12px 16px', borderBottom: `1px solid ${baseLine}`, display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontFamily: opTheme.display, fontWeight: 600, fontSize: 14 }}>Transcript</span>
              <span style={{ fontFamily: opTheme.mono, fontSize: 11, color: baseInk3 }}>verbatim · 12:04</span>
            </div>
            <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13, lineHeight: 1.55 }}>
              {[
                ['DR.R', 'How long has the pain been waking you up at night?'],
                ['PT', "About a week. Started cold-sensitive but now it just throbs.", true],
                ['DR.R', 'Any swelling, anything hot to the touch?'],
                ['PT', 'No swelling. No fever. Just the tooth.'],
                ['DR.R', "X-ray shows decay has reached the nerve. We'll do a pulpotomy today and schedule the root canal.", false, true],
                ['PT', 'Whatever you think is best.'],
              ].map(([sp, t, hl, hl2], i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '50px 1fr', gap: 10 }}>
                  <span style={{ fontFamily: opTheme.mono, fontSize: 10, color: sp === 'DR.R' ? opTheme.accent : baseInk3, fontWeight: 500, letterSpacing: '0.06em' }}>{sp}</span>
                  <span style={{ background: hl || hl2 ? opTheme.accentSoft : 'transparent', padding: hl || hl2 ? '4px 8px' : 0, borderRadius: hl || hl2 ? 3 : 0, borderLeft: hl || hl2 ? `2px solid ${opTheme.accent}` : 'none', color: hl || hl2 ? baseInk : baseInk2 }}>{t}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ background: basePanel, border: `1px solid ${baseLine}`, borderRadius: 4 }}>
            <div style={{ padding: '12px 16px', borderBottom: `1px solid ${baseLine}`, display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontFamily: opTheme.display, fontWeight: 600, fontSize: 14 }}>SOAP draft</span>
              <span style={{ fontFamily: opTheme.mono, fontSize: 11, color: '#b8852b' }}>● drafting · v0.4</span>
            </div>
            <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <div style={{ fontFamily: opTheme.mono, fontSize: 10, color: opTheme.accent, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 4 }}>Chief complaint</div>
                <div style={{ fontSize: 14, color: baseInk, fontWeight: 500, lineHeight: 1.4 }}>Persistent ache, lower right molar, worse with cold for two weeks.</div>
              </div>
              {[
                ['S', 'Subjective', 'Gradual onset cold sensitivity #31, now spontaneous, waking patient at night. No prior trauma. OTC ibuprofen partially effective.'],
                ['O', 'Objective', 'Tooth #31 — deep distal caries to pulp on radiograph. Percussion tender. Cold test prolonged. Probing depths WNL.'],
                ['A', 'Assessment', 'Symptomatic irreversible pulpitis #31, secondary to deep distal carious lesion. Tooth restorable.'],
              ].map(([k, l, v]) => (
                <div key={k}>
                  <div style={{ fontFamily: opTheme.mono, fontSize: 10, color: opTheme.accent, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 4 }}>{l}</div>
                  <div style={{ fontSize: 13, color: baseInk2, lineHeight: 1.55 }}>{v}</div>
                </div>
              ))}
              <div>
                <div style={{ fontFamily: opTheme.mono, fontSize: 10, color: opTheme.accent, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 4 }}>Plan</div>
                <ol style={{ paddingLeft: 18, margin: 0, fontSize: 13, color: baseInk2, lineHeight: 1.65 }}>
                  <li>Pulpotomy #31 today, RCT within 1 week.</li>
                  <li>Rx amoxicillin 500 mg TID × 7d.</li>
                  <li>Crown buildup post-RCT.</li>
                  <li>Hygiene recall 6 months.</li>
                </ol>
              </div>
              <div style={{ display: 'flex', gap: 6, paddingTop: 10, borderTop: `1px solid ${baseLine}` }}>
                {[['K04.01', 'icd'], ['D3220', 'cdt'], ['D2950', 'cdt']].map(([c]) => (
                  <span key={c} style={{ fontFamily: opTheme.mono, fontSize: 10.5, padding: '3px 7px', background: opTheme.accentSoft, color: opTheme.accent, border: `1px solid ${opTheme.accentLine}`, borderRadius: 3, fontWeight: 500 }}>{c}</span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

window.OpShell = OpShell;
window.OpDashboard = OpDashboard;
window.OpClinical = OpClinical;
