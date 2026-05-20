/* global React */
/* eslint-disable */
const { GradientText, IRIDESCENT_DARK, CYAN_300, CYAN_400, CYAN_500 } = window;
// =============================================================================
//  03 — ATLAS OP · Bloomberg-dense ops · near-black · 24-cell heatmap + tickers
//  No owl. Holographic accents on numerics only.
// =============================================================================

function AtlasOpDashboard() {
  // 7 days × 24 hours heatmap (calls per hour)
  const heat = Array.from({ length: 7 }, (_, d) =>
    Array.from({ length: 24 }, (_, h) => {
      const dayBoost = [0.7, 1.1, 1.2, 1.1, 1.3, 1.4, 0.6][d];
      const hourCurve = Math.exp(-Math.pow(h - 13, 2) / 30) + Math.exp(-Math.pow(h - 17, 2) / 35) * 0.7;
      return Math.round((hourCurve * 18 + Math.random() * 4) * dayBoost);
    })
  );
  const heatMax = Math.max(...heat.flat());
  const heatColor = (v) => {
    const t = v / heatMax;
    if (t < 0.2) return `rgba(34, 184, 207, ${0.10 + t * 0.6})`;
    if (t < 0.5) return `rgba(34, 184, 207, ${0.25 + t * 0.8})`;
    if (t < 0.75) return `rgba(77, 214, 232, ${0.65 + t * 0.3})`;
    return `rgba(142, 229, 240, ${0.85 + t * 0.15})`;
  };
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // Tiny chart for ticker
  const tickerSpark = [3, 4, 3.5, 5, 4.8, 6, 5.5, 6.8, 7.2];

  return (
    <div style={{
      width: '100%', height: '100%', position: 'relative',
      background: '#0a0b12',
      fontFamily: "'JetBrains Mono', 'IBM Plex Mono', monospace", color: '#d8dae8',
      fontSize: 11.5,
    }}>
      {/* top status bar */}
      <div style={{ padding: '8px 16px', background: '#06070d', borderBottom: '0.5px solid rgba(255,255,255,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 10.5, letterSpacing: '0.04em' }}>
        <div style={{ display: 'flex', gap: 24 }}>
          <span style={{ color: CYAN_300 }}>● ATLAS OP</span>
          <span style={{ color: '#7a7e94' }}>WORKSPACE / NA-WEST</span>
          <span style={{ color: '#7a7e94' }}>USER · R.DAVENPORT</span>
        </div>
        <div style={{ display: 'flex', gap: 20 }}>
          <span><span style={{ color: '#7a7e94' }}>UTC </span>21:14:08</span>
          <span><span style={{ color: '#7a7e94' }}>SESSION </span>00:42:11</span>
          <span style={{ color: CYAN_300 }}>● LIVE</span>
        </div>
      </div>

      {/* Header band */}
      <div style={{ padding: '16px 20px 14px', borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div>
            <div style={{ fontSize: 9.5, color: '#7a7e94', letterSpacing: '0.16em' }}>OPS / TODAY</div>
            <div style={{ fontFamily: "'Instrument Serif', serif", fontStyle: 'italic', fontSize: 30, color: '#fff', marginTop: 4, letterSpacing: '-0.01em' }}>
              <GradientText gradient={IRIDESCENT_DARK}>134</GradientText>
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontStyle: 'normal', fontSize: 10, color: '#7a7e94', marginLeft: 12, letterSpacing: '0.1em' }}>CALLS / DAY</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 16, fontSize: 10.5 }}>
            {['DAY', 'WK', 'MO', 'QTR', 'YTD'].map((p, i) => (
              <span key={i} style={{ padding: '4px 8px', border: '0.5px solid', borderColor: i === 0 ? '#fff' : 'rgba(255,255,255,0.1)', color: i === 0 ? '#fff' : '#7a7e94' }}>{p}</span>
            ))}
          </div>
        </div>
      </div>

      {/* Ticker rail */}
      <div style={{ padding: '8px 20px', borderBottom: '0.5px solid rgba(255,255,255,0.06)', display: 'flex', gap: 28, alignItems: 'center', fontSize: 10.5, overflow: 'hidden' }}>
        {[
          { l: 'SCORE', v: '7.81', d: '+0.34', c: CYAN_300 },
          { l: 'BOOK%', v: '66.4', d: '+2.1', c: CYAN_300 },
          { l: 'FLAG%', v: '8.21', d: '+1.4', c: '#fff' },
          { l: 'AHT', v: '04:38', d: '-0:12', c: CYAN_300 },
          { l: 'DEFL%', v: '68.1', d: '+8.0', c: CYAN_300 },
          { l: 'NPS', v: '64', d: '+3', c: CYAN_300 },
          { l: 'GMV', v: '$184k', d: '+22.4', c: CYAN_300 },
          { l: 'QUEUE', v: '3', d: '0', c: '#7a7e94' },
        ].map((t, i) => (
          <span key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{ color: '#7a7e94' }}>{t.l}</span>
            <span style={{ color: '#fff' }}>{t.v}</span>
            <span style={{ color: t.c }}>{t.d}</span>
          </span>
        ))}
      </div>

      {/* Body */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 0 }}>
        {/* LEFT — heatmap */}
        <div style={{ padding: '16px 18px', borderRight: '0.5px solid rgba(255,255,255,0.06)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={{ color: '#fff', fontSize: 10.5, letterSpacing: '0.1em' }}>◇ DENSITY · CALL VOLUME / 7D × 24H</span>
            <span style={{ color: '#7a7e94', fontSize: 10 }}>cells = calls/hr · max {heatMax}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingTop: 14 }}>
              {days.map((d) => (
                <span key={d} style={{ fontSize: 9.5, color: '#7a7e94', height: 18, display: 'flex', alignItems: 'center', letterSpacing: '0.05em' }}>{d}</span>
              ))}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#7a7e94', marginBottom: 4, padding: '0 2px' }}>
                <span>00</span><span>06</span><span>12</span><span>18</span><span>24</span>
              </div>
              <div>
                {heat.map((row, di) => (
                  <div key={di} style={{ display: 'grid', gridTemplateColumns: 'repeat(24, 1fr)', gap: 2, marginBottom: 2 }}>
                    {row.map((v, hi) => (
                      <div key={hi} style={{
                        height: 18,
                        background: heatColor(v),
                        border: '0.5px solid rgba(255,255,255,0.04)',
                        position: 'relative',
                      }}>
                        {di === 5 && hi === 14 && (
                          <div style={{ position: 'absolute', inset: -1, border: '1px solid #fff', boxShadow: '0 0 6px rgba(255,255,255,0.5)' }} />
                        )}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: 9.5, color: '#7a7e94' }}>
                <span>0</span>
                <div style={{ flex: 1, height: 4, background: 'linear-gradient(90deg, rgba(34,184,207,0.1), #22b8cf, #4dd6e8, #8ee5f0)' }} />
                <span>{heatMax}+</span>
              </div>
            </div>
          </div>
          {/* Annotated cell */}
          <div style={{ marginTop: 14, padding: '10px 12px', background: 'rgba(255,255,255,0.03)', border: '0.5px solid rgba(255,255,255,0.08)' }}>
            <div style={{ fontSize: 9.5, color: '#7a7e94', letterSpacing: '0.1em', marginBottom: 4 }}>◇ ANOMALY · FRI 14:00</div>
            <div style={{ fontSize: 11.5, color: '#fff' }}>Call density 2.8σ above baseline. Insurance objections concentrated. <span style={{ color: CYAN_300 }}>Stage senior closers.</span></div>
          </div>
        </div>

        {/* RIGHT — split panels */}
        <div>
          {/* Watchlist */}
          <div style={{ padding: '14px 18px', borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>
            <div style={{ color: '#fff', fontSize: 10.5, letterSpacing: '0.1em', marginBottom: 8 }}>◇ WATCHLIST · LIVE</div>
            <table style={{ width: '100%', fontSize: 10.5, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ color: '#7a7e94', textAlign: 'left' }}>
                  <th style={{ fontWeight: 400, padding: '4px 0' }}>CALLER</th>
                  <th style={{ fontWeight: 400 }}>TOPIC</th>
                  <th style={{ fontWeight: 400, textAlign: 'right' }}>DUR</th>
                  <th style={{ fontWeight: 400, textAlign: 'right' }}>SCR</th>
                  <th style={{ fontWeight: 400, textAlign: 'right' }}>Δ</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { who: 'PATEL.M', topic: 'TX-PLAN', dur: '12:04', s: '9.1', d: '+1.3', c: CYAN_300 },
                  { who: 'OCONNOR.J', topic: 'INSURANCE', dur: '04:11', s: '4.2', d: '-2.1', c: '#fff' },
                  { who: 'BROOKS.L', topic: 'TX-PLAN', dur: '11:54', s: '6.4', d: '+0.2', c: CYAN_300 },
                  { who: 'PARK.E', topic: 'INSURANCE', dur: '08:10', s: '2.7', d: '-3.0', c: '#fff' },
                  { who: 'NGUYEN.T', topic: 'BILLING', dur: '06:32', s: '7.8', d: '+0.8', c: CYAN_300 },
                  { who: 'KAUR.A', topic: 'HYGIENE', dur: '03:18', s: '8.2', d: '+0.4', c: CYAN_300 },
                ].map((r, i) => (
                  <tr key={i} style={{ borderTop: '0.5px solid rgba(255,255,255,0.04)' }}>
                    <td style={{ padding: '5px 0', color: '#fff' }}>{r.who}</td>
                    <td style={{ color: '#a3a7be' }}>{r.topic}</td>
                    <td style={{ textAlign: 'right', color: '#a3a7be' }}>{r.dur}</td>
                    <td style={{ textAlign: 'right', color: r.c }}>{r.s}</td>
                    <td style={{ textAlign: 'right', color: r.c }}>{r.d}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Cluster bar */}
          <div style={{ padding: '14px 18px', borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>
            <div style={{ color: '#fff', fontSize: 10.5, letterSpacing: '0.1em', marginBottom: 10 }}>◇ TOPIC CLUSTERS · 24H</div>
            {[
              { l: 'TREATMENT-PLAN', v: 42, c: CYAN_300 },
              { l: 'INSURANCE', v: 28, c: '#fff' },
              { l: 'BILLING', v: 21, c: CYAN_400 },
              { l: 'HYGIENE', v: 14, c: CYAN_500 },
              { l: 'EMERGENCY', v: 8, c: '#7a7e94' },
            ].map((c, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '110px 1fr 30px', gap: 10, alignItems: 'center', marginBottom: 6, fontSize: 10.5 }}>
                <span style={{ color: '#a3a7be' }}>{c.l}</span>
                <div style={{ height: 8, background: 'rgba(255,255,255,0.04)' }}>
                  <div style={{ width: `${(c.v / 42) * 100}%`, height: '100%', background: c.c }} />
                </div>
                <span style={{ color: '#fff', textAlign: 'right' }}>{c.v}</span>
              </div>
            ))}
          </div>

          {/* Mini chart */}
          <div style={{ padding: '14px 18px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
              <span style={{ color: '#fff', fontSize: 10.5, letterSpacing: '0.1em' }}>◇ SCORE / TIME · 9D</span>
              <span style={{ fontSize: 10, color: '#7a7e94' }}>μ 7.81 · σ 1.42</span>
            </div>
            <svg viewBox="0 0 100 30" preserveAspectRatio="none" style={{ width: '100%', height: 60 }}>
              <defs>
                <linearGradient id="atlas-line" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor={CYAN_500} />
                  <stop offset="100%" stopColor={CYAN_300} />
                </linearGradient>
              </defs>
              {tickerSpark.map((v, i) => {
                const x = (i / (tickerSpark.length - 1)) * 100;
                const y = 30 - (v / 8) * 26;
                return <line key={i} x1={x} y1="30" x2={x} y2={y} stroke="rgba(255,255,255,0.15)" strokeWidth="0.3" />;
              })}
              <path d={tickerSpark.map((v, i) => {
                const x = (i / (tickerSpark.length - 1)) * 100;
                const y = 30 - (v / 8) * 26;
                return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
              }).join(' ')} fill="none" stroke="url(#atlas-line)" strokeWidth="0.6" />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}

window.AtlasOpDashboard = AtlasOpDashboard;
