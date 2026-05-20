/* global React */
/* eslint-disable */
const { CYAN_300, CYAN_400, CYAN_500, CYAN_600 } = window;
// =============================================================================
//  02 — SPECTRA · Stripe/Mercury precision · spacious · soft brand color (deep indigo)
//  Owl as quiet wordmark. Single beautiful chart. Generous whitespace.
// =============================================================================

function SpectraDashboard() {
  // Refined sparkline-like hero chart: smooth bezier curve
  const heroData = [62, 64, 61, 67, 71, 69, 74, 78, 81, 79, 84, 87, 86, 88, 91, 89, 92, 94];
  const w = 100, h = 100;
  const max = 100, min = 50;
  const pts = heroData.map((v, i) => {
    const x = (i / (heroData.length - 1)) * w;
    const y = h - ((v - min) / (max - min)) * h * 0.78 - 10;
    return [x, y];
  });
  // Smooth bezier path
  const smooth = (points) => {
    let d = `M ${points[0][0]} ${points[0][1]}`;
    for (let i = 0; i < points.length - 1; i++) {
      const [x0, y0] = points[i];
      const [x1, y1] = points[i + 1];
      const cx = (x0 + x1) / 2;
      d += ` Q ${cx} ${y0}, ${cx} ${(y0 + y1) / 2} T ${x1} ${y1}`;
    }
    return d;
  };
  const linePath = smooth(pts);
  const areaPath = linePath + ` L ${w} ${h} L 0 ${h} Z`;

  return (
    <div style={{
      width: '100%', height: '100%', position: 'relative',
      background: '#fbfbfd',
      fontFamily: "'Inter', -apple-system, sans-serif", color: '#1a1d2e',
    }}>
      {/* Side rail */}
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 200, padding: '24px 18px', borderRight: '0.5px solid rgba(0,0,0,0.06)', background: '#fff' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 32 }}>
          {/* Quiet owl wordmark */}
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3a3f5e" strokeWidth="1.5">
            <circle cx="8.5" cy="10" r="2.5" />
            <circle cx="15.5" cy="10" r="2.5" />
            <circle cx="8.5" cy="10" r="0.8" fill="#3a3f5e" />
            <circle cx="15.5" cy="10" r="0.8" fill="#3a3f5e" />
            <path d="M 12 12 L 11 14 L 13 14 Z" fill="#3a3f5e" />
            <path d="M 6 7 Q 12 4 18 7" />
          </svg>
          <span style={{ fontFamily: "'Instrument Serif', serif", fontStyle: 'italic', fontSize: 19, letterSpacing: '-0.01em', fontWeight: 400 }}>Spectra</span>
        </div>
        <div style={{ fontSize: 10, color: '#8a8fa3', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 8 }}>Workspace</div>
        {[
          { label: 'Today', active: true },
          { label: 'Calls', count: '1,284' },
          { label: 'Patterns' },
          { label: 'Coaching' },
          { label: 'Reports' },
        ].map((item, i) => (
          <div key={i} style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '7px 10px', marginBottom: 2,
            background: item.active ? 'rgba(8, 146, 168, 0.10)' : 'transparent',
            borderRadius: 6, fontSize: 13,
            color: item.active ? CYAN_600 : '#3a3f5e',
            fontWeight: item.active ? 500 : 400,
          }}>
            <span>{item.label}</span>
            {item.count && <span style={{ fontSize: 10, color: '#8a8fa3', fontFamily: "'JetBrains Mono', monospace" }}>{item.count}</span>}
          </div>
        ))}

        <div style={{ position: 'absolute', bottom: 24, left: 18, right: 18, padding: '12px 14px', background: 'linear-gradient(135deg, rgba(34,184,207,0.06), rgba(8,146,168,0.04))', borderRadius: 8, border: '0.5px solid rgba(0,0,0,0.05)' }}>
          <div style={{ fontSize: 11, color: '#3a3f5e', lineHeight: 1.45 }}>Renée Davenport</div>
          <div style={{ fontSize: 10, color: '#8a8fa3', marginTop: 1 }}>Lead clinician · Pacific</div>
        </div>
      </div>

      {/* Main */}
      <div style={{ marginLeft: 200, padding: '32px 40px' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 32 }}>
          <div>
            <div style={{ fontSize: 11, color: '#8a8fa3', letterSpacing: '0.06em', marginBottom: 6 }}>Sat · 26 April</div>
            <h1 style={{ fontFamily: "'Instrument Serif', serif", fontSize: 44, fontWeight: 400, letterSpacing: '-0.02em', lineHeight: 1, margin: 0 }}>
              Good afternoon, Renée
            </h1>
            <div style={{ fontSize: 14, color: '#5a5f78', marginTop: 8, maxWidth: 480, lineHeight: 1.5 }}>
              The clinic ran a clean morning. Booking velocity is up 14% week-over-week and you have <span style={{ color: '#1a1d2e', fontWeight: 500 }}>3 calls</span> waiting for review.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={{ padding: '8px 14px', background: '#fff', border: '0.5px solid rgba(0,0,0,0.1)', borderRadius: 7, fontSize: 12.5, color: '#3a3f5e', fontWeight: 500 }}>Export</button>
            <button style={{ padding: '8px 14px', background: '#1a1d2e', color: '#fff', border: 'none', borderRadius: 7, fontSize: 12.5, fontWeight: 500 }}>Review queue (3)</button>
          </div>
        </div>

        {/* KPI row — Stripe-style */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 0, marginBottom: 28, background: '#fff', border: '0.5px solid rgba(0,0,0,0.06)', borderRadius: 10, overflow: 'hidden' }}>
          {[
            { label: 'Calls today', v: '134', d: '+18 vs yesterday', positive: true, accent: CYAN_500 },
            { label: 'Avg quality score', v: '7.8', d: '+0.3 vs last week', positive: true, accent: CYAN_400 },
            { label: 'Plans booked', v: '$184k', d: '+22% MoM', positive: true, accent: CYAN_500 },
            { label: 'AI deflection', v: '68%', d: 'Goal: 65%', positive: true, accent: CYAN_300 },
          ].map((k, i) => (
            <div key={i} style={{ padding: '20px 24px', borderRight: i < 3 ? '0.5px solid rgba(0,0,0,0.05)' : 'none', position: 'relative' }}>
              {/* iridescent micro-accent */}
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: k.accent }} />
              <div style={{ fontSize: 11.5, color: '#8a8fa3', letterSpacing: '0.02em', marginBottom: 8 }}>{k.label}</div>
              <div style={{ fontFamily: "'Instrument Serif', serif", fontSize: 38, fontWeight: 400, letterSpacing: '-0.025em', lineHeight: 1, color: '#1a1d2e' }}>{k.v}</div>
              <div style={{ fontSize: 11, color: '#22a06b', marginTop: 6, fontFamily: "'JetBrains Mono', monospace" }}>↑ {k.d}</div>
            </div>
          ))}
        </div>

        {/* Hero chart — generous whitespace */}
        <div style={{ background: '#fff', border: '0.5px solid rgba(0,0,0,0.06)', borderRadius: 10, padding: '28px 32px', marginBottom: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 11.5, color: '#8a8fa3', letterSpacing: '0.04em' }}>Booking velocity</div>
              <div style={{ fontFamily: "'Instrument Serif', serif", fontSize: 32, fontWeight: 400, letterSpacing: '-0.02em', marginTop: 2 }}>
                $184,300 <span style={{ fontSize: 14, color: '#22a06b', fontFamily: 'Inter, sans-serif', marginLeft: 6 }}>+22.4%</span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 4, padding: 3, background: 'rgba(0,0,0,0.04)', borderRadius: 6 }}>
              {['1D', '7D', '30D', '90D', 'YTD'].map((p, i) => (
                <button key={i} style={{
                  padding: '4px 10px', fontSize: 11, fontWeight: 500,
                  background: i === 1 ? '#fff' : 'transparent',
                  border: 'none', borderRadius: 4,
                  color: i === 1 ? '#1a1d2e' : '#5a5f78',
                  boxShadow: i === 1 ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
                }}>{p}</button>
              ))}
            </div>
          </div>
          <div style={{ position: 'relative', height: 220, marginTop: 16 }}>
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
              <defs>
                <linearGradient id="spec-line" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor={CYAN_500} />
                  <stop offset="100%" stopColor={CYAN_300} />
                </linearGradient>
                <linearGradient id="spec-area" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={CYAN_400} stopOpacity="0.22" />
                  <stop offset="100%" stopColor={CYAN_400} stopOpacity="0" />
                </linearGradient>
              </defs>
              {[20, 40, 60, 80].map((y) => (
                <line key={y} x1="0" y1={y} x2="100" y2={y} stroke="rgba(0,0,0,0.04)" strokeWidth="0.15" />
              ))}
              <path d={areaPath} fill="url(#spec-area)" />
              <path d={linePath} fill="none" stroke="url(#spec-line)" strokeWidth="0.5" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="0.9" fill="#fff" stroke={CYAN_500} strokeWidth="0.4" />
            </svg>
            {/* Annotation: hover-style callout */}
            <div style={{ position: 'absolute', left: '64%', top: '20%', background: '#1a1d2e', color: '#fff', padding: '8px 12px', borderRadius: 6, fontSize: 11, lineHeight: 1.4, boxShadow: '0 8px 20px rgba(0,0,0,0.15)' }}>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: '#8e94b8', letterSpacing: '0.06em', marginBottom: 2 }}>WED · 15:42</div>
              <div style={{ fontWeight: 500 }}>$14,200</div>
              <div style={{ color: '#a8aec8' }}>11 plans · avg 9.0</div>
              <div style={{ position: 'absolute', bottom: -4, left: 16, width: 8, height: 8, background: '#1a1d2e', transform: 'rotate(45deg)' }} />
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, fontSize: 10.5, color: '#8a8fa3', letterSpacing: '0.04em' }}>
            <span>Mon Apr 21</span><span>Tue 22</span><span>Wed 23</span><span>Thu 24</span><span>Fri 25</span><span>Sat 26</span><span>Sun</span>
          </div>
        </div>

        {/* 2-up bottom */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 16 }}>
          <div style={{ background: '#fff', border: '0.5px solid rgba(0,0,0,0.06)', borderRadius: 10, padding: '20px 24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>Revenue by service line</div>
              <span style={{ fontSize: 11, color: '#5a5f78' }}>This week</span>
            </div>
            {[
              { name: 'Implants', v: '$72,400', pct: 78, c: CYAN_500 },
              { name: 'Ortho consult', v: '$48,100', pct: 56, c: CYAN_400 },
              { name: 'Whitening', v: '$31,800', pct: 42, c: CYAN_300 },
              { name: 'Hygiene plans', v: '$18,200', pct: 28, c: '#94d8e0' },
              { name: 'Emergency', v: '$13,800', pct: 18, c: '#1a1d2e' },
            ].map((row, i) => (
              <div key={i} style={{ marginBottom: i < 4 ? 12 : 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 5 }}>
                  <span>{row.name}</span>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", color: '#5a5f78' }}>{row.v}</span>
                </div>
                <div style={{ height: 4, background: 'rgba(0,0,0,0.05)', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ width: `${row.pct}%`, height: '100%', background: row.c, borderRadius: 2 }} />
                </div>
              </div>
            ))}
          </div>
          <div style={{ background: '#fff', border: '0.5px solid rgba(0,0,0,0.06)', borderRadius: 10, padding: '20px 24px' }}>
            <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 14 }}>This week's win</div>
            <div style={{ fontFamily: "'Instrument Serif', serif", fontStyle: 'italic', fontSize: 22, lineHeight: 1.25, color: '#1a1d2e', marginBottom: 12 }}>
              "I really felt heard. Renée walked me through every option."
            </div>
            <div style={{ fontSize: 11, color: '#8a8fa3', letterSpacing: '0.04em', textTransform: 'uppercase' }}>Maya P. · Treatment plan · 9.4 / 10</div>
            <div style={{ marginTop: 18, padding: 12, background: 'linear-gradient(135deg, rgba(34,184,207,0.08), rgba(8,146,168,0.06))', borderRadius: 8, fontSize: 12, color: '#3a3f5e', lineHeight: 1.5 }}>
              <strong style={{ color: '#1a1d2e' }}>Pattern detected.</strong> Calls that open with a payment-plan walkthrough close 18% more often.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

window.SpectraDashboard = SpectraDashboard;
