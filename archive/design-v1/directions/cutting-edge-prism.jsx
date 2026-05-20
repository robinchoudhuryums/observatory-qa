/* global React */
/* eslint-disable */
// =============================================================================
//  Cutting-edge clinical SaaS — 5 dashboards
//  Arc/Raycast bold + Stripe/Mercury precision · iridescent accents only
//  Sans + serif accent · subtle motion implied · mix density + chart styles
// =============================================================================

// ─── shared bits ─────────────────────────────────────────────────────────────
// Single cyan accent system — replaces iridescent
const CYAN_50  = '#e6fbff';
const CYAN_100 = '#c5f3fb';
const CYAN_200 = '#8ee5f0';
const CYAN_300 = '#4dd6e8';
const CYAN_400 = '#22b8cf';
const CYAN_500 = '#0892a8';
const CYAN_600 = '#066d80';
const CYAN_700 = '#04525e';
const IRIDESCENT      = 'linear-gradient(105deg, #4dd6e8 0%, #22b8cf 50%, #0892a8 100%)';
const IRIDESCENT_DARK = 'linear-gradient(105deg, #8ee5f0 0%, #4dd6e8 50%, #22b8cf 100%)';
const SOFT_HOLO = 'linear-gradient(135deg, rgba(77,214,232,0.10), rgba(34,184,207,0.06) 50%, rgba(8,146,168,0.10) 100%)';

function GradientText({ children, gradient = IRIDESCENT, style = {} }) {
  return (
    <span style={{
      backgroundImage: gradient,
      WebkitBackgroundClip: 'text',
      backgroundClip: 'text',
      color: 'transparent',
      WebkitTextFillColor: 'transparent',
      ...style,
    }}>{children}</span>
  );
}

function MiniSpark({ data, color = '#6a8cff', height = 24, width = 80, area = true }) {
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * height * 0.85 - 2;
    return [x, y];
  });
  const path = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x} ${y}`).join(' ');
  const areaPath = path + ` L ${width} ${height} L 0 ${height} Z`;
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      {area && <path d={areaPath} fill={color} opacity="0.12" />}
      <path d={path} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="2.2" fill={color} />
    </svg>
  );
}

// ─── Helper: glass panel ─────────────────────────────────────────────────────
function Glass({ children, style = {}, dark = false }) {
  return (
    <div style={{
      background: dark ? 'rgba(20,22,30,0.55)' : 'rgba(255,255,255,0.55)',
      backdropFilter: 'blur(20px) saturate(160%)',
      WebkitBackdropFilter: 'blur(20px) saturate(160%)',
      border: dark ? '0.5px solid rgba(255,255,255,0.08)' : '0.5px solid rgba(0,0,0,0.06)',
      borderRadius: 14,
      boxShadow: dark ? '0 1px 0 rgba(255,255,255,0.04) inset, 0 12px 40px rgba(0,0,0,0.3)' : '0 1px 0 rgba(255,255,255,0.7) inset, 0 12px 32px rgba(20,30,60,0.06)',
      ...style,
    }}>
      {children}
    </div>
  );
}

// =============================================================================
//  01 — PRISM · Arc-style glass + iridescent · light · medium density · hero chart
// =============================================================================
function PrismDashboard() {
  const heroData = [4.2, 5.1, 4.8, 6.3, 7.1, 6.8, 7.9, 8.4, 8.1, 8.9, 7.6, 8.3, 9.1, 8.7, 7.9, 8.5, 7.2, 7.8];
  const max = Math.max(...heroData);
  const heroPath = heroData.map((v, i) => {
    const x = (i / (heroData.length - 1)) * 100;
    const y = 100 - (v / max) * 80 - 5;
    return [x, y];
  });
  const linePath = heroPath.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x} ${y}`).join(' ');
  const areaPath = linePath + ` L 100 100 L 0 100 Z`;

  return (
    <div style={{
      width: '100%', height: '100%', position: 'relative', overflow: 'hidden',
      background: '#fafafe',
      fontFamily: "'Inter', system-ui, sans-serif", color: '#0c0e16',
    }}>
      {/* Iridescent backdrop */}
      <div style={{ position: 'absolute', top: -80, right: -120, width: 520, height: 520, borderRadius: '50%', background: CYAN_300, filter: 'blur(90px)', opacity: 0.32 }} />
      <div style={{ position: 'absolute', bottom: -100, left: -80, width: 400, height: 400, borderRadius: '50%', background: CYAN_400, filter: 'blur(90px)', opacity: 0.18 }} />

      {/* Top bar */}
      <div style={{ position: 'relative', padding: '20px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '0.5px solid rgba(0,0,0,0.06)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 22, height: 22, borderRadius: 6, background: IRIDESCENT, boxShadow: `0 0 16px ${CYAN_300}80` }} />
            <span style={{ fontFamily: "'Instrument Serif', serif", fontStyle: 'italic', fontSize: 22, letterSpacing: '-0.01em' }}>Prism</span>
          </div>
          <nav style={{ display: 'flex', gap: 24, fontSize: 13, color: '#5a5e6e' }}>
            <span style={{ color: '#0c0e16', fontWeight: 500 }}>Today</span>
            <span>Calls</span>
            <span>Patterns</span>
            <span>Team</span>
            <span>Reports</span>
          </nav>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', fontSize: 12, color: '#5a5e6e' }}>
          <div style={{ padding: '5px 10px', background: 'rgba(255,255,255,0.6)', border: '0.5px solid rgba(0,0,0,0.08)', borderRadius: 6, fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}>⌘K</div>
          <div style={{ width: 28, height: 28, borderRadius: '50%', background: IRIDESCENT, padding: 1.5 }}>
            
            <div style={{ width: '100%', height: '100%', borderRadius: '50%', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600 }}>R</div>
          </div>
        </div>
      </div>

      {/* Hero header */}
      <div style={{ padding: '32px 32px 8px', position: 'relative' }}>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: '#5a5e6e', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 8 }}>
          ◇ Saturday · 26 Apr · live
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 12 }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 6px #22c55e' }} />
            <span style={{ color: '#22c55e' }}>3 calls in flight</span>
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <h1 style={{ fontFamily: "'Instrument Serif', serif", fontStyle: 'italic', fontSize: 64, fontWeight: 400, letterSpacing: '-0.025em', lineHeight: 1, margin: 0 }}>
            <GradientText>134</GradientText> calls today.
          </h1>
          <div style={{ display: 'flex', gap: 16, fontSize: 12, color: '#5a5e6e', fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.05em' }}>
            <button style={{ padding: '6px 12px', background: 'transparent', border: '0.5px solid rgba(0,0,0,0.12)', borderRadius: 6, fontSize: 11, color: '#0c0e16', fontFamily: 'inherit' }}>Today</button>
            <button style={{ padding: '6px 12px', background: 'transparent', border: '0.5px solid rgba(0,0,0,0.06)', borderRadius: 6, fontSize: 11, color: '#5a5e6e', fontFamily: 'inherit' }}>Week</button>
            <button style={{ padding: '6px 12px', background: 'transparent', border: '0.5px solid rgba(0,0,0,0.06)', borderRadius: 6, fontSize: 11, color: '#5a5e6e', fontFamily: 'inherit' }}>Month</button>
          </div>
        </div>
      </div>

      {/* KPI strip */}
      <div style={{ padding: '20px 32px 8px', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        {[
          { label: 'Avg score', value: '7.8', delta: '+0.3', spark: [6.8, 7.0, 7.2, 7.1, 7.4, 7.6, 7.5, 7.8], color: CYAN_400 },
          { label: 'Booked', value: '89', delta: '+14', spark: [62, 68, 74, 71, 78, 82, 84, 89], color: CYAN_500 },
          { label: 'Flagged', value: '11', delta: '+3', spark: [4, 5, 7, 8, 6, 9, 10, 11], color: '#0c0e16' },
          { label: 'AI handled', value: '68%', delta: '+8%', spark: [55, 58, 61, 60, 62, 65, 67, 68], color: CYAN_300 },
        ].map((k, i) => (
          <Glass key={i} style={{ padding: '14px 16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontSize: 11, color: '#5a5e6e', letterSpacing: '0.04em' }}>{k.label}</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
                  <span style={{ fontFamily: "'Instrument Serif', serif", fontStyle: 'italic', fontSize: 36, lineHeight: 1, fontWeight: 400, letterSpacing: '-0.02em' }}>{k.value}</span>
                  <span style={{ fontSize: 11, color: '#22c55e', fontFamily: "'JetBrains Mono', monospace" }}>↑ {k.delta}</span>
                </div>
              </div>
              <MiniSpark data={k.spark} color={k.color} />
            </div>
          </Glass>
        ))}
      </div>

      {/* Hero chart */}
      <div style={{ padding: '12px 32px' }}>
        <Glass style={{ padding: '24px 28px', position: 'relative', overflow: 'hidden' }}>
          {/* Iridescent fade behind chart */}
          <div style={{ position: 'absolute', inset: 0, background: SOFT_HOLO, pointerEvents: 'none' }} />
          <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
            <div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: '#5a5e6e', letterSpacing: '0.12em', textTransform: 'uppercase' }}>◇ Call quality · last 24 hours</div>
              <div style={{ fontFamily: "'Instrument Serif', serif", fontStyle: 'italic', fontSize: 24, marginTop: 2, fontWeight: 400 }}>Score trended up <GradientText>↗ 12%</GradientText> after Renée's coaching session.</div>
            </div>
            <div style={{ display: 'flex', gap: 14, fontSize: 11, fontFamily: "'JetBrains Mono', monospace", color: '#5a5e6e' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 8, height: 2, background: CYAN_400, borderRadius: 1 }} /> score</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 8, height: 2, background: '#0c0e16', borderRadius: 1 }} /> flag rate</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 8, height: 2, background: 'rgba(0,0,0,0.2)', borderRadius: 1, borderTop: '1px dashed rgba(0,0,0,0.3)', height: 0 }} /> baseline</span>
            </div>
          </div>
          <div style={{ position: 'relative', height: 220 }}>
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
              <defs>
                <linearGradient id="prism-area" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={CYAN_400} stopOpacity="0.32" />
                  <stop offset="100%" stopColor={CYAN_300} stopOpacity="0" />
                </linearGradient>
                <linearGradient id="prism-line" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor={CYAN_500} />
                  <stop offset="100%" stopColor={CYAN_300} />
                </linearGradient>
              </defs>
              {/* gridlines */}
              {[20, 40, 60, 80].map((y) => (
                <line key={y} x1="0" y1={y} x2="100" y2={y} stroke="rgba(0,0,0,0.04)" strokeWidth="0.15" />
              ))}
              {/* baseline */}
              <line x1="0" y1="48" x2="100" y2="48" stroke="rgba(0,0,0,0.18)" strokeWidth="0.2" strokeDasharray="0.8 0.8" />
              {/* area */}
              <path d={areaPath} fill="url(#prism-area)" />
              {/* line */}
              <path d={linePath} fill="none" stroke="url(#prism-line)" strokeWidth="0.6" strokeLinecap="round" strokeLinejoin="round" />
              {/* annotation marker */}
              <circle cx={heroPath[8][0]} cy={heroPath[8][1]} r="1.2" fill="#fff" stroke={CYAN_500} strokeWidth="0.5" />
              <circle cx={heroPath[12][0]} cy={heroPath[12][1]} r="1.2" fill="#fff" stroke={CYAN_400} strokeWidth="0.5" />
            </svg>
            {/* annotation callouts */}
            <div style={{ position: 'absolute', left: '46%', top: '20%', maxWidth: 140 }}>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: CYAN_500, letterSpacing: '0.08em', textTransform: 'uppercase' }}>10:42 · spike</div>
              <div style={{ fontSize: 11, color: '#0c0e16', marginTop: 2, lineHeight: 1.35 }}>Treatment plan calls cluster — Renée handles 8 in a row.</div>
            </div>
            <div style={{ position: 'absolute', left: '68%', bottom: '18%', maxWidth: 130 }}>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: CYAN_400, letterSpacing: '0.08em', textTransform: 'uppercase' }}>14:18 · peak</div>
              <div style={{ fontSize: 11, color: '#0c0e16', marginTop: 2, lineHeight: 1.35 }}>Highest 9.1 of the day. Maya P. — full plan booked.</div>
            </div>
          </div>
          {/* x-axis */}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, color: '#9a9eaf', letterSpacing: '0.06em' }}>
            <span>06:00</span><span>09:00</span><span>12:00</span><span>15:00</span><span>18:00</span><span>21:00</span>
          </div>
        </Glass>
      </div>

      {/* Bottom row: 2 panels */}
      <div style={{ padding: '8px 32px 24px', display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 12 }}>
        <Glass style={{ padding: '18px 22px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
            <div style={{ fontFamily: "'Instrument Serif', serif", fontStyle: 'italic', fontSize: 22 }}>Live calls</div>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: '#5a5e6e', letterSpacing: '0.08em' }}>↻ 0.8s</span>
          </div>
          {[
            { who: 'Maya Patel', topic: 'Treatment plan', dur: '12:04', score: 9.1, c: CYAN_500 },
            { who: 'James O\'Connor', topic: 'Insurance friction', dur: '04:11', score: 4.2, c: '#0c0e16' },
            { who: 'Layla Brooks', topic: 'Treatment plan', dur: '11:54', score: 6.4, c: CYAN_400 },
            { who: 'Ethan Park', topic: 'Insurance', dur: '08:10', score: 2.7, c: '#0c0e16' },
          ].map((c, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '8px 1fr 70px 50px', gap: 12, padding: '10px 0', borderBottom: i < 3 ? '0.5px solid rgba(0,0,0,0.05)' : 'none', alignItems: 'center' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: c.c, boxShadow: `0 0 8px ${c.c}` }} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{c.who}</div>
                <div style={{ fontSize: 11, color: '#5a5e6e' }}>{c.topic}</div>
              </div>
              <span style={{ fontSize: 11, color: '#5a5e6e', fontFamily: "'JetBrains Mono', monospace" }}>{c.dur}</span>
              <span style={{ fontFamily: "'Instrument Serif', serif", fontStyle: 'italic', fontSize: 22, color: c.c, textAlign: 'right' }}>{c.score}</span>
            </div>
          ))}
        </Glass>
        <Glass style={{ padding: '18px 22px' }}>
          <div style={{ fontFamily: "'Instrument Serif', serif", fontStyle: 'italic', fontSize: 22, marginBottom: 12 }}>AI insights</div>
          {[
            { tag: 'pattern', txt: 'Insurance objections cluster around 14:00 — staff this hour with senior closers.', c: CYAN_500 },
            { tag: 'opportunity', txt: 'Treatment-plan close rate +18% when Renée explains payment plans first.', c: CYAN_400 },
            { tag: 'flag', txt: '3 calls flagged for HIPAA review — auto-redacted, ready in queue.', c: '#0c0e16' },
          ].map((insight, i) => (
            <div key={i} style={{ marginBottom: i < 2 ? 14 : 0, padding: '10px 12px', borderRadius: 8, background: 'rgba(0,0,0,0.02)', borderLeft: `2px solid ${insight.c}` }}>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: insight.c, letterSpacing: '0.1em', textTransform: 'uppercase' }}>◇ {insight.tag}</div>
              <div style={{ fontSize: 12.5, marginTop: 3, lineHeight: 1.45 }}>{insight.txt}</div>
            </div>
          ))}
        </Glass>
      </div>
    </div>
  );
}

window.PrismDashboard = PrismDashboard;
window.IRIDESCENT = IRIDESCENT;
window.IRIDESCENT_DARK = IRIDESCENT_DARK;
window.SOFT_HOLO = SOFT_HOLO;
window.GradientText = GradientText;
window.MiniSpark = MiniSpark;
window.Glass = Glass;
window.CYAN_50 = CYAN_50; window.CYAN_100 = CYAN_100; window.CYAN_200 = CYAN_200;
window.CYAN_300 = CYAN_300; window.CYAN_400 = CYAN_400; window.CYAN_500 = CYAN_500;
window.CYAN_600 = CYAN_600; window.CYAN_700 = CYAN_700;
