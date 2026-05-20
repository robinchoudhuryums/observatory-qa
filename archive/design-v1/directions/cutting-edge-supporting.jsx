/* global React */
/* eslint-disable */
const CE_IRIDESCENT = 'linear-gradient(105deg, #4dd6e8 0%, #22b8cf 50%, #0892a8 100%)';
const CY_300 = '#4dd6e8', CY_400 = '#22b8cf', CY_500 = '#0892a8';

// =============================================================================
//  KPI CLOSE-UP — single metric, ceremonial Stripe-precision view
// =============================================================================
function CuttingEdgeKpiCloseup() {
  // Bigger sample data for hero: 30 days
  const data = Array.from({ length: 30 }, (_, i) => {
    const trend = 50 + i * 1.6;
    const wave = Math.sin(i * 0.45) * 6;
    const noise = (Math.sin(i * 1.7) + Math.cos(i * 2.3)) * 3;
    return Math.max(40, Math.round((trend + wave + noise) * 10) / 10);
  });
  const max = Math.max(...data), min = Math.min(...data);
  const w = 100, h = 100;
  const pts = data.map((v, i) => [(i / (data.length - 1)) * w, h - ((v - min) / (max - min)) * 70 - 12]);
  const linePath = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x} ${y}`).join(' ');
  const areaPath = linePath + ` L ${w} ${h} L 0 ${h} Z`;

  return (
    <div style={{
      width: '100%', height: '100%',
      background: '#fbfbfd',
      fontFamily: "'Inter', sans-serif", color: '#1a1d2e',
      padding: '32px 40px',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Breadcrumb */}
      <div style={{ fontSize: 11.5, color: '#5a5f78', display: 'flex', gap: 8, fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.04em' }}>
        <span>Today</span><span>›</span><span>Booking velocity</span><span>›</span><span style={{ color: '#1a1d2e' }}>Detail</span>
      </div>

      {/* Hero metric */}
      <div style={{ marginTop: 22, paddingBottom: 20, borderBottom: '0.5px solid rgba(0,0,0,0.06)' }}>
        <div style={{ fontSize: 11.5, color: '#8a8fa3', letterSpacing: '0.04em', marginBottom: 8 }}>Booking velocity · 30 days</div>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
              <span style={{ fontFamily: "'Instrument Serif', serif", fontSize: 84, fontWeight: 400, lineHeight: 1, letterSpacing: '-0.03em', fontStyle: 'italic' }}>
                <span style={{
                  backgroundImage: CE_IRIDESCENT,
                  WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', WebkitTextFillColor: 'transparent',
                }}>$184,300</span>
              </span>
              <div>
                <div style={{ fontSize: 14, color: '#22a06b', fontWeight: 500 }}>↑ +22.4%</div>
                <div style={{ fontSize: 11, color: '#8a8fa3' }}>vs prior 30d</div>
              </div>
            </div>
            <div style={{ fontSize: 13, color: '#5a5f78', marginTop: 10, maxWidth: 540, lineHeight: 1.5 }}>
              Plans booked. Highest 30-day total since launch. Two outliers: a slow Tuesday (15 Apr) and an exceptional close on the 23rd.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 4, padding: 3, background: 'rgba(0,0,0,0.04)', borderRadius: 6 }}>
            {['7D', '30D', '90D', 'YTD', 'ALL'].map((p, i) => (
              <span key={i} style={{
                padding: '5px 11px', fontSize: 11, fontWeight: 500,
                background: i === 1 ? '#fff' : 'transparent',
                borderRadius: 4, color: i === 1 ? '#1a1d2e' : '#5a5f78',
                boxShadow: i === 1 ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
              }}>{p}</span>
            ))}
          </div>
        </div>
      </div>

      {/* Big chart */}
      <div style={{ flex: 1, padding: '24px 0 16px', position: 'relative' }}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
          <defs>
            <linearGradient id="kpi-line" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#ff5fa4" />
              <stop offset="33%" stopColor="#b76eff" />
              <stop offset="66%" stopColor="#6a8cff" />
              <stop offset="100%" stopColor="#4dd6e8" />
            </linearGradient>
            <linearGradient id="kpi-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#b76eff" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#4dd6e8" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[20, 40, 60, 80].map((y) => (
            <line key={y} x1="0" y1={y} x2="100" y2={y} stroke="rgba(0,0,0,0.04)" strokeWidth="0.12" />
          ))}
          <path d={areaPath} fill="url(#kpi-area)" />
          <path d={linePath} fill="none" stroke="url(#kpi-line)" strokeWidth="0.5" strokeLinecap="round" strokeLinejoin="round" />
          {/* outlier markers */}
          <circle cx={pts[12][0]} cy={pts[12][1]} r="1.0" fill="#fff" stroke="#ff5fa4" strokeWidth="0.4" />
          <circle cx={pts[22][0]} cy={pts[22][1]} r="1.0" fill="#fff" stroke="#4dffb0" strokeWidth="0.4" />
          <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="1.0" fill="#6a8cff" />
        </svg>
        {/* annotations */}
        <div style={{ position: 'absolute', left: '36%', top: '52%' }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, color: '#ff5fa4', letterSpacing: '0.08em' }}>15 APR · DIP</div>
          <div style={{ fontSize: 11, lineHeight: 1.4, maxWidth: 130, color: '#1a1d2e' }}>Insurance system outage stalled 6 close-ready calls.</div>
        </div>
        <div style={{ position: 'absolute', left: '69%', top: '14%' }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, color: '#22a06b', letterSpacing: '0.08em' }}>23 APR · PEAK</div>
          <div style={{ fontSize: 11, lineHeight: 1.4, maxWidth: 130, color: '#1a1d2e' }}>$14,200 in a single afternoon — Renée's run.</div>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: '#8a8fa3', fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.04em', paddingTop: 4 }}>
        <span>MAR 28</span><span>APR 04</span><span>APR 11</span><span>APR 18</span><span>APR 25</span>
      </div>

      {/* Bottom: breakdown grid */}
      <div style={{ marginTop: 22, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 0, background: '#fff', border: '0.5px solid rgba(0,0,0,0.06)', borderRadius: 10, overflow: 'hidden' }}>
        {[
          { l: 'Avg deal size', v: '$2,840', d: '+$120', accent: CY_500 },
          { l: 'Plans / call', v: '0.49', d: '+0.06', accent: CY_400 },
          { l: 'Avg time-to-close', v: '6.2 min', d: '-0:48', accent: CY_300 },
          { l: 'Repeat rate', v: '23%', d: '+4%', accent: CY_300 },
        ].map((k, i) => (
          <div key={i} style={{ padding: '18px 22px', borderRight: i < 3 ? '0.5px solid rgba(0,0,0,0.05)' : 'none', position: 'relative' }}>
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: k.accent }} />
            <div style={{ fontSize: 11, color: '#8a8fa3' }}>{k.l}</div>
            <div style={{ fontFamily: "'Instrument Serif', serif", fontSize: 28, fontWeight: 400, marginTop: 4, fontStyle: 'italic' }}>{k.v}</div>
            <div style={{ fontSize: 10.5, color: '#22a06b', marginTop: 2, fontFamily: "'JetBrains Mono', monospace" }}>↑ {k.d}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// =============================================================================
//  LIST VIEW — Mercury-precise calls table with iridescent score chips
// =============================================================================
function CuttingEdgeListView() {
  const rows = [
    { who: 'Maya Patel', topic: 'Treatment plan', dur: '12:04', when: '14:18', s: 9.1, status: 'closed', amt: '$3,400' },
    { who: 'James O\'Connor', topic: 'Insurance friction', dur: '04:11', when: '14:02', s: 4.2, status: 'flagged', amt: '—' },
    { who: 'Layla Brooks', topic: 'Treatment plan', dur: '11:54', when: '13:48', s: 6.4, status: 'open', amt: '$1,200' },
    { who: 'Ethan Park', topic: 'Insurance', dur: '08:10', when: '13:22', s: 2.7, status: 'flagged', amt: '—' },
    { who: 'Noor Khaled', topic: 'Treatment plan', dur: '14:01', when: '12:54', s: 8.4, status: 'closed', amt: '$4,100' },
    { who: 'Ari Nakamura', topic: 'Billing', dur: '06:28', when: '12:18', s: 7.0, status: 'closed', amt: '$680' },
    { who: 'Yui Tanaka', topic: 'Hygiene', dur: '03:54', when: '11:46', s: 8.0, status: 'closed', amt: '$420' },
    { who: 'Devon Reyes', topic: 'Billing', dur: '07:12', when: '11:08', s: 5.8, status: 'open', amt: '$0' },
    { who: 'Sora Lindqvist', topic: 'Treatment plan', dur: '10:32', when: '10:40', s: 8.7, status: 'closed', amt: '$2,800' },
    { who: 'Thiago Mendes', topic: 'Insurance', dur: '05:16', when: '10:14', s: 5.1, status: 'open', amt: '—' },
  ];
  const scoreColor = (s) => s >= 8 ? CY_500 : s >= 6 ? CY_400 : s >= 4 ? '#5a5f78' : '#1a1d2e';
  const scoreBg = (s) => s >= 8 ? 'rgba(8,146,168,0.10)' : s >= 6 ? 'rgba(34,184,207,0.10)' : s >= 4 ? 'rgba(0,0,0,0.05)' : 'rgba(0,0,0,0.08)';
  const statusStyle = {
    closed: { c: CY_500, bg: 'rgba(8,146,168,0.08)' },
    open: { c: '#5a5f78', bg: 'rgba(0,0,0,0.05)' },
    flagged: { c: '#1a1d2e', bg: 'rgba(0,0,0,0.07)' },
  };

  return (
    <div style={{
      width: '100%', height: '100%',
      background: '#fbfbfd',
      fontFamily: "'Inter', sans-serif", color: '#1a1d2e',
      padding: '28px 32px',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', paddingBottom: 18, borderBottom: '0.5px solid rgba(0,0,0,0.06)' }}>
        <div>
          <div style={{ fontSize: 11, color: '#8a8fa3', letterSpacing: '0.06em', fontFamily: "'JetBrains Mono', monospace" }}>◇ CALLS · ALL</div>
          <h1 style={{ fontFamily: "'Instrument Serif', serif", fontSize: 36, fontWeight: 400, fontStyle: 'italic', letterSpacing: '-0.02em', margin: '4px 0 0' }}>1,284 calls</h1>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ padding: '7px 12px', background: '#fff', border: '0.5px solid rgba(0,0,0,0.08)', borderRadius: 7, fontSize: 12, color: '#5a5f78', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>⌕</span> <span style={{ color: '#8a8fa3' }}>Search calls, callers, topics…</span>
            <span style={{ marginLeft: 24, fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: '#8a8fa3', padding: '1px 5px', background: 'rgba(0,0,0,0.05)', borderRadius: 3 }}>⌘K</span>
          </div>
          <button style={{ padding: '7px 13px', background: '#1a1d2e', color: '#fff', border: 'none', borderRadius: 7, fontSize: 12, fontWeight: 500 }}>Export</button>
        </div>
      </div>

      {/* Filter chips */}
      <div style={{ display: 'flex', gap: 8, padding: '14px 0', flexWrap: 'wrap' }}>
        {[
          { l: 'Today', active: true },
          { l: 'All time' },
          { l: 'Score ≥ 8', accent: '#22a06b' },
          { l: 'Flagged', accent: '#ff5fa4' },
          { l: 'Treatment plan' },
          { l: 'Insurance' },
          { l: '+ Add filter', muted: true },
        ].map((f, i) => (
          <span key={i} style={{
            padding: '5px 11px', fontSize: 12,
            background: f.active ? '#1a1d2e' : f.accent ? scoreBg(f.accent === '#22a06b' ? 9 : 3) : '#fff',
            color: f.active ? '#fff' : f.accent || (f.muted ? '#8a8fa3' : '#3a3f5e'),
            border: f.active || f.accent ? 'none' : '0.5px solid rgba(0,0,0,0.08)',
            borderRadius: 14, fontWeight: 500,
            display: 'inline-flex', alignItems: 'center', gap: 5,
          }}>
            {f.accent && <span style={{ width: 6, height: 6, borderRadius: '50%', background: f.accent }} />}
            {f.l}
          </span>
        ))}
      </div>

      {/* Table */}
      <div style={{ flex: 1, background: '#fff', border: '0.5px solid rgba(0,0,0,0.06)', borderRadius: 10, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'rgba(0,0,0,0.015)', textAlign: 'left' }}>
              {['Caller', 'Topic', 'When', 'Duration', 'Score', 'Status', 'Booked', ''].map((h) => (
                <th key={h} style={{ padding: '11px 14px', fontSize: 10.5, color: '#8a8fa3', fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase', borderBottom: '0.5px solid rgba(0,0,0,0.05)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} style={{ borderBottom: i < rows.length - 1 ? '0.5px solid rgba(0,0,0,0.04)' : 'none' }}>
                <td style={{ padding: '11px 14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{
                      width: 26, height: 26, borderRadius: '50%',
                      background: `linear-gradient(135deg, ${scoreColor(r.s)}, ${scoreColor(r.s)}88)`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 11, fontWeight: 600, color: '#fff',
                    }}>{r.who.split(' ').map((n) => n[0]).join('').slice(0, 2)}</div>
                    <span style={{ fontWeight: 500 }}>{r.who}</span>
                  </div>
                </td>
                <td style={{ padding: '11px 14px', color: '#5a5f78' }}>{r.topic}</td>
                <td style={{ padding: '11px 14px', color: '#5a5f78', fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>{r.when}</td>
                <td style={{ padding: '11px 14px', color: '#5a5f78', fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>{r.dur}</td>
                <td style={{ padding: '11px 14px' }}>
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '3px 9px', borderRadius: 12,
                    background: scoreBg(r.s), color: scoreColor(r.s),
                    fontFamily: "'Instrument Serif', serif", fontSize: 14, fontStyle: 'italic',
                  }}>
                    <span style={{ width: 5, height: 5, borderRadius: '50%', background: scoreColor(r.s) }} />
                    {r.s.toFixed(1)}
                  </span>
                </td>
                <td style={{ padding: '11px 14px' }}>
                  <span style={{
                    padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 500,
                    background: statusStyle[r.status].bg, color: statusStyle[r.status].c,
                    textTransform: 'capitalize',
                  }}>{r.status}</span>
                </td>
                <td style={{ padding: '11px 14px', color: r.amt === '—' ? '#8a8fa3' : '#1a1d2e', fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>{r.amt}</td>
                <td style={{ padding: '11px 14px', color: '#8a8fa3', textAlign: 'right' }}>›</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 4px 0', fontSize: 11.5, color: '#5a5f78' }}>
        <span>Showing 10 of 1,284</span>
        <div style={{ display: 'flex', gap: 4 }}>
          {['‹', '1', '2', '3', '…', '129', '›'].map((p, i) => (
            <span key={i} style={{
              padding: '4px 9px', fontSize: 11.5,
              background: p === '1' ? '#1a1d2e' : 'transparent', color: p === '1' ? '#fff' : '#5a5f78',
              borderRadius: 4, fontFamily: "'JetBrains Mono', monospace",
            }}>{p}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

// =============================================================================
//  LAUNCH / INTRO CARD for the section
// =============================================================================
function CuttingEdgeIntroCard() {
  return (
    <div style={{
      width: '100%', height: '100%', position: 'relative', overflow: 'hidden',
      background: '#fbfbfd', color: '#1a1d2e',
      fontFamily: "'Inter', sans-serif",
      padding: '48px 56px',
      display: 'flex', flexDirection: 'column', justifyContent: 'center',
    }}>
      {/* iridescent fog */}
      <div style={{ position: 'absolute', top: -120, right: -100, width: 540, height: 540, borderRadius: '50%', background: CY_300, filter: 'blur(110px)', opacity: 0.28, pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', bottom: -80, left: -80, width: 360, height: 360, borderRadius: '50%', background: CY_400, filter: 'blur(80px)', opacity: 0.16, pointerEvents: 'none' }} />

      <div style={{ position: 'relative', maxWidth: 760 }}>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#5a5f78', marginBottom: 16 }}>
          ◇ Direction · Cutting-edge clinical SaaS
        </div>
        <h1 style={{ fontFamily: "'Instrument Serif', serif", fontSize: 64, fontWeight: 400, fontStyle: 'italic', letterSpacing: '-0.025em', lineHeight: 1.0, margin: 0 }}>
          Five takes on a <span style={{
            backgroundImage: CE_IRIDESCENT,
            WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', WebkitTextFillColor: 'transparent',
          }}>modern clinical SaaS</span> dashboard.
        </h1>
        <p style={{ fontSize: 16, lineHeight: 1.55, color: '#3a3f5e', marginTop: 18, maxWidth: 620 }}>
          Arc/Raycast confidence with iridescent accents, paired with Stripe/Mercury data precision. Sans + serif accents. Mixed densities. Hero charts, heatmaps, isometric scenes, and network graphs. Some keep the owl as a quiet brand cue; others drop it for a cleaner ops feel.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginTop: 32 }}>
          {[
            { n: '01', name: 'Prism', tag: 'Glass + iridescent · hero chart' },
            { n: '02', name: 'Spectra', tag: 'Stripe-precise · spacious' },
            { n: '03', name: 'Atlas Op', tag: 'Bloomberg-dense · heatmap' },
            { n: '04', name: 'Topology', tag: 'Network graph · light' },
            { n: '05', name: 'Orrery', tag: 'Isometric · solar system' },
          ].map((d, i) => (
            <div key={i} style={{ padding: '12px 14px', background: 'rgba(255,255,255,0.6)', backdropFilter: 'blur(8px)', border: '0.5px solid rgba(0,0,0,0.05)', borderRadius: 8 }}>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, color: '#5a5f78', letterSpacing: '0.1em' }}>{d.n}</div>
              <div style={{ fontFamily: "'Instrument Serif', serif", fontSize: 18, fontStyle: 'italic', marginTop: 2 }}>{d.name}</div>
              <div style={{ fontSize: 10.5, color: '#5a5f78', marginTop: 3, lineHeight: 1.35 }}>{d.tag}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

window.CuttingEdgeKpiCloseup = CuttingEdgeKpiCloseup;
window.CuttingEdgeListView = CuttingEdgeListView;
window.CuttingEdgeIntroCard = CuttingEdgeIntroCard;
