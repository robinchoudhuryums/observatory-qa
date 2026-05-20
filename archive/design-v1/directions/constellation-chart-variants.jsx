/* global React */
/* eslint-disable */
// =============================================================================
//  CONSTELLATION CHART · 5 variants for Almanac direction
//  All in forest #1f6b3a accent, warm paper, ink black
//  Each exported in two sizes: hero (~800x420) and small (~340x200)
// =============================================================================

const cv = {
  ink: '#0d1018',
  ink2: '#3a3f4a',
  ink3: '#7d818c',
  ink4: '#aeb1b8',
  paper: '#fafafa',
  paperWarm: '#f4f2ea',
  line: '#dcd9d0',
  lineSoft: '#e9e7df',
  accent: '#1f6b3a',
  accentDeep: '#0f4423',
  accentSoft: '#e3ece3',
  amber: '#b8852b',
  red: '#a23b3b',
  display: "'Fraunces', 'Newsreader', serif",
  body: "'Inter Tight', system-ui, sans-serif",
  mono: "'IBM Plex Mono', monospace",
};

// ---------- shared frame ----------
function CvFrame({ name, num, subtitle, children, sub }) {
  return (
    <div style={{ background: cv.paper, padding: 24, fontFamily: cv.body, color: cv.ink }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 14 }}>
        <div>
          <div style={{ fontFamily: cv.mono, fontSize: 10, color: cv.accent, letterSpacing: '0.18em', textTransform: 'uppercase', marginBottom: 4 }}>
            ❋ Variant {num}
          </div>
          <div style={{ fontFamily: cv.display, fontSize: 28, fontStyle: 'italic', fontWeight: 300, letterSpacing: '-0.02em', lineHeight: 1 }}>{name}</div>
          {subtitle && <div style={{ fontFamily: cv.mono, fontSize: 10, color: cv.ink3, marginTop: 4, letterSpacing: '0.06em' }}>{subtitle}</div>}
        </div>
        {sub && <div style={{ fontFamily: cv.mono, fontSize: 10, color: cv.ink3, textTransform: 'uppercase', letterSpacing: '0.14em', textAlign: 'right' }}>{sub}</div>}
      </div>
      {children}
    </div>
  );
}

// =============================================================================
//  V1 · FIELD — refined sparse rectangular x/y, hairline grid, dot stars
// =============================================================================
function ChartField({ width = 800, height = 360 }) {
  // Stylized sparse data: ~84 points
  const stars = [];
  for (let i = 0; i < 84; i++) {
    const x = (i * 47.3) % 100;
    const y = 12 + ((i * 17.7) % 70);
    const s = (i % 7 === 0) ? 'pos' : (i % 11 === 0) ? 'neg' : (i % 5 === 0) ? 'neu' : 'pos';
    const r = 1.2 + ((i * 3) % 4) * 0.5;
    stars.push({ x, y, s, r });
  }
  const lines = [[0, 12], [12, 23], [23, 30], [30, 41], [41, 55], [5, 17], [17, 29]];
  const col = (s) => s === 'pos' ? cv.accent : s === 'neg' ? cv.red : cv.amber;

  return (
    <div style={{ width, height, position: 'relative', background: cv.paperWarm, borderRadius: 4, overflow: 'hidden', border: `1px solid ${cv.line}` }}>
      <svg viewBox="0 0 100 80" preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
        {/* hairline horizontal grid */}
        {[20, 40, 60].map((y) => <line key={y} x1="0" x2="100" y1={y} y2={y} stroke={cv.line} strokeWidth="0.1" />)}
        {/* score axis labels left side, in actual coords */}
        {/* constellation lines */}
        {lines.map(([a, b], i) => {
          const A = stars[a]; const B = stars[b];
          if (!A || !B) return null;
          return <line key={i} x1={A.x} y1={A.y} x2={B.x} y2={B.y} stroke={cv.accent} strokeWidth="0.18" opacity="0.5" />;
        })}
        {stars.map((s, i) => (
          <g key={i}>
            <circle cx={s.x} cy={s.y} r={s.r * 1.6} fill={col(s.s)} opacity="0.18" />
            <circle cx={s.x} cy={s.y} r={s.r * 0.55} fill={col(s.s)} />
          </g>
        ))}
      </svg>
      <div style={{ position: 'absolute', top: 12, left: 16, fontFamily: cv.mono, fontSize: 10, color: cv.accent, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
        ❋ Score × time · 30d · 84 calls
      </div>
      <div style={{ position: 'absolute', bottom: 8, left: 16, fontFamily: cv.mono, fontSize: 9, color: cv.ink3, letterSpacing: '0.08em' }}>
        Apr 1 ←─────────────────────→ Apr 30
      </div>
      <div style={{ position: 'absolute', top: '50%', right: 14, fontFamily: cv.mono, fontSize: 9, color: cv.ink3, transform: 'translateY(-50%) rotate(90deg)', transformOrigin: 'right center', letterSpacing: '0.08em' }}>
        score 0 ─── 10
      </div>
    </div>
  );
}

// =============================================================================
//  V2 · ATLAS — REAL density, RA/DEC ticks, numbered cluster tags
// =============================================================================
function ChartAtlas({ width = 800, height = 360 }) {
  // Realistic density: ~600 calls across 14 days
  const stars = [];
  let seed = 1;
  const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  for (let i = 0; i < 580; i++) {
    // cluster around a few normal-ish bands of score
    const dayBucket = Math.floor(rand() * 14);
    const x = (dayBucket / 14) * 96 + 2 + rand() * (96 / 14);
    // bimodal-ish score: mostly 7-9, some 4-6
    const isLow = rand() < 0.18;
    const score = isLow ? 35 + rand() * 25 : 60 + rand() * 30;
    const y = 78 - (score / 100) * 72;
    const sent = score < 50 ? 'neg' : score < 65 ? 'neu' : 'pos';
    stars.push({ x, y, s: sent, r: 0.6 + rand() * 0.5 });
  }
  // Three named clusters
  const clusters = [
    { x: 22, y: 58, label: 'I · insurance', count: 14 },
    { x: 50, y: 22, label: 'II · treatment plan', count: 31 },
    { x: 78, y: 38, label: 'III · billing', count: 9 },
  ];
  const col = (s) => s === 'pos' ? cv.accent : s === 'neg' ? cv.red : cv.amber;

  return (
    <div style={{ width, height, position: 'relative', background: cv.paperWarm, borderRadius: 4, overflow: 'hidden', border: `1px solid ${cv.line}` }}>
      <svg viewBox="0 0 100 80" preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
        {/* RA/DEC tick rim */}
        {Array.from({ length: 14 }).map((_, i) => {
          const x = (i / 14) * 100 + 100 / 28;
          return <g key={i}>
            <line x1={x} y1="0" x2={x} y2="2" stroke={cv.ink3} strokeWidth="0.15" />
            <line x1={x} y1="78" x2={x} y2="80" stroke={cv.ink3} strokeWidth="0.15" />
          </g>;
        })}
        {/* major coord lines at score 5 and 8 */}
        <line x1="0" x2="100" y1="42" y2="42" stroke={cv.ink3} strokeWidth="0.08" strokeDasharray="0.6 0.4" opacity="0.5" />
        <line x1="0" x2="100" y1="18" y2="18" stroke={cv.ink3} strokeWidth="0.08" strokeDasharray="0.6 0.4" opacity="0.5" />
        {/* cluster halos */}
        {clusters.map((c, i) => (
          <circle key={i} cx={c.x} cy={c.y} r="11" fill="none" stroke={cv.accent} strokeWidth="0.2" strokeDasharray="0.6 0.5" opacity="0.7" />
        ))}
        {/* stars */}
        {stars.map((s, i) => (
          <circle key={i} cx={s.x} cy={s.y} r={s.r * 0.5} fill={col(s.s)} opacity={s.s === 'neg' ? 0.85 : 0.65} />
        ))}
      </svg>
      {/* cluster labels */}
      {clusters.map((c, i) => (
        <div key={i} style={{ position: 'absolute', left: `${c.x}%`, top: `${c.y}%`, transform: 'translate(-50%, -120%)', fontFamily: cv.display, fontSize: width > 500 ? 13 : 10, fontStyle: 'italic', fontWeight: 400, color: cv.accentDeep, whiteSpace: 'nowrap', background: cv.paperWarm, padding: '0 4px' }}>
          {c.label} <span style={{ fontFamily: cv.mono, fontStyle: 'normal', fontSize: width > 500 ? 9 : 8, color: cv.ink3 }}>· {c.count}</span>
        </div>
      ))}
      <div style={{ position: 'absolute', top: 12, left: 16, fontFamily: cv.mono, fontSize: 10, color: cv.accent, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
        ❋ Atlas · 14d · {580} calls · 3 named clusters
      </div>
      <div style={{ position: 'absolute', top: 12, right: 16, fontFamily: cv.mono, fontSize: 9, color: cv.ink3 }}>
        seeing: ★★★★☆
      </div>
      <div style={{ position: 'absolute', bottom: 6, left: 16, right: 16, display: 'flex', justifyContent: 'space-between', fontFamily: cv.mono, fontSize: 8.5, color: cv.ink3, letterSpacing: '0.08em' }}>
        <span>13 Apr</span><span>16</span><span>19</span><span>22</span><span>25</span><span>26 Apr</span>
      </div>
    </div>
  );
}

// =============================================================================
//  V3 · POLAR DAY — 24-hour clock, angle = hour, radius = score, dawn/dusk
// =============================================================================
function ChartPolarDay({ width = 800, height = 360 }) {
  const cx = 50, cy = 50;
  // points on a 100x100 viewBox; will use min dimension scaling via container
  const stars = [];
  let seed = 7;
  const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  for (let i = 0; i < 160; i++) {
    // hour 0-24, with peak density 9-17
    let hour;
    if (rand() < 0.7) hour = 9 + rand() * 8;
    else hour = rand() * 24;
    const score = 4 + rand() * 5.5; // 4-9.5
    const angle = (hour / 24) * Math.PI * 2 - Math.PI / 2; // 12 at top
    const radius = 8 + ((score - 4) / 6) * 30;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    const s = score > 7.5 ? 'pos' : score > 6 ? 'neu' : 'neg';
    stars.push({ x, y, s, r: 0.5 + rand() * 0.5 });
  }
  const col = (s) => s === 'pos' ? cv.accent : s === 'neg' ? cv.red : cv.amber;
  // hour ticks
  const hourTicks = Array.from({ length: 24 }).map((_, i) => {
    const angle = (i / 24) * Math.PI * 2 - Math.PI / 2;
    const inner = 41, outer = i % 6 === 0 ? 45 : 43;
    return {
      x1: cx + Math.cos(angle) * inner, y1: cy + Math.sin(angle) * inner,
      x2: cx + Math.cos(angle) * outer, y2: cy + Math.sin(angle) * outer,
      labX: cx + Math.cos(angle) * 47.5, labY: cy + Math.sin(angle) * 47.5,
      label: i === 0 ? '24' : i % 6 === 0 ? String(i) : null,
    };
  });

  return (
    <div style={{ width, height, position: 'relative', background: cv.paperWarm, borderRadius: 4, overflow: 'hidden', border: `1px solid ${cv.line}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" style={{ width: height - 8, height: height - 8 }}>
        <defs>
          <radialGradient id="dawnDusk" cx="50%" cy="50%" r="50%">
            <stop offset="78%" stopColor={cv.paperWarm} stopOpacity="0" />
            <stop offset="88%" stopColor="#f7c98a" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#1a2235" stopOpacity="0.14" />
          </radialGradient>
        </defs>
        {/* dawn/dusk rim */}
        <circle cx={cx} cy={cy} r="44" fill="url(#dawnDusk)" />
        {/* score rings */}
        {[14, 24, 34].map((r, i) => (
          <circle key={r} cx={cx} cy={cy} r={r} fill="none" stroke={cv.line} strokeWidth="0.15" strokeDasharray={i === 1 ? "0.8 0.4" : "0.4 0.4"} />
        ))}
        {/* hour ticks */}
        {hourTicks.map((t, i) => (
          <line key={i} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} stroke={cv.ink3} strokeWidth={i % 6 === 0 ? "0.25" : "0.12"} />
        ))}
        {/* hour labels */}
        {hourTicks.filter(t => t.label).map((t, i) => (
          <text key={i} x={t.labX} y={t.labY + 0.8} fontSize="2.2" fontFamily="IBM Plex Mono" fill={cv.ink2} textAnchor="middle">{t.label}</text>
        ))}
        {/* stars */}
        {stars.map((s, i) => (
          <circle key={i} cx={s.x} cy={s.y} r={s.r * 0.8} fill={col(s.s)} opacity="0.75" />
        ))}
        {/* center mark */}
        <circle cx={cx} cy={cy} r="0.6" fill={cv.accent} />
        {/* center label */}
        <text x={cx} y={cy - 1.2} fontFamily="Fraunces" fontStyle="italic" fontSize="3" fill={cv.accentDeep} textAnchor="middle">today</text>
        <text x={cx} y={cy + 2} fontFamily="IBM Plex Mono" fontSize="1.6" fill={cv.ink3} textAnchor="middle">26 APR</text>
      </svg>
      <div style={{ position: 'absolute', top: 12, left: 16, fontFamily: cv.mono, fontSize: 10, color: cv.accent, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
        ❋ Polar day · 24h × score
      </div>
      <div style={{ position: 'absolute', bottom: 12, left: 16, fontFamily: cv.mono, fontSize: 9, color: cv.ink3, lineHeight: 1.6 }}>
        ↑ angle = hour of day<br />
        ↑ radius = call score (4 — 10)
      </div>
      <div style={{ position: 'absolute', bottom: 12, right: 16, fontFamily: cv.mono, fontSize: 9, color: cv.ink3, textAlign: 'right', lineHeight: 1.6 }}>
        peak density<br />
        09 – 17h
      </div>
    </div>
  );
}

// =============================================================================
//  V4 · SKY DOME — half-dome arc, calls rise and set, dawn-to-dusk gradient
// =============================================================================
function ChartSkyDome({ width = 800, height = 360 }) {
  // Half-dome: x = time of day 0-24 mapped to dome chord; y = altitude (score)
  // Use 100x60 viewBox (wide & short)
  const stars = [];
  let seed = 13;
  const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  for (let i = 0; i < 110; i++) {
    let hour;
    if (rand() < 0.7) hour = 8 + rand() * 10;
    else hour = rand() * 24;
    const score = 4 + rand() * 5.5;
    const x = (hour / 24) * 96 + 2;
    // dome: altitude is score-based but offset by sun-arc (highest near noon)
    const arc = Math.sin((hour / 24) * Math.PI) * 18; // sun arc 0-18 high
    const altScore = ((score - 4) / 6) * 24; // 0-24
    const y = 50 - (arc * 0.4 + altScore * 0.7);
    const s = score > 7.5 ? 'pos' : score > 6 ? 'neu' : 'neg';
    stars.push({ x, y, s, r: 0.5 + rand() * 0.5, hour });
  }
  const col = (s) => s === 'pos' ? cv.accent : s === 'neg' ? cv.red : cv.amber;

  return (
    <div style={{ width, height, position: 'relative', borderRadius: 4, overflow: 'hidden', border: `1px solid ${cv.line}` }}>
      <svg viewBox="0 0 100 60" preserveAspectRatio="none" style={{ width: '100%', height: '100%', position: 'absolute', inset: 0 }}>
        <defs>
          <linearGradient id="skygrad" x1="0%" x2="100%">
            <stop offset="0%" stopColor="#1a2235" />
            <stop offset="20%" stopColor="#f7c98a" />
            <stop offset="50%" stopColor="#fafafa" />
            <stop offset="80%" stopColor="#f0a838" />
            <stop offset="100%" stopColor="#1a2235" />
          </linearGradient>
          <linearGradient id="skygradSoft" x1="0%" x2="100%">
            <stop offset="0%" stopColor="#1a2235" stopOpacity="0.5" />
            <stop offset="20%" stopColor="#f7c98a" stopOpacity="0.4" />
            <stop offset="50%" stopColor="#fafafa" stopOpacity="0" />
            <stop offset="80%" stopColor="#f0a838" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#1a2235" stopOpacity="0.5" />
          </linearGradient>
        </defs>
        {/* sky gradient soft */}
        <rect x="0" y="0" width="100" height="60" fill="url(#skygradSoft)" opacity="0.9" />
        <rect x="0" y="0" width="100" height="60" fill={cv.paperWarm} opacity="0.7" />
        {/* horizon line + ground */}
        <line x1="0" y1="50" x2="100" y2="50" stroke={cv.ink} strokeWidth="0.18" />
        <rect x="0" y="50" width="100" height="10" fill={cv.paperWarm} />
        {/* sun arc as guide */}
        <path d="M 2 50 Q 50 22 98 50" fill="none" stroke={cv.accent} strokeWidth="0.2" strokeDasharray="0.8 0.6" opacity="0.55" />
        {/* horizon ground gradient strip (thin) */}
        <rect x="0" y="49.5" width="100" height="1" fill="url(#skygrad)" opacity="0.55" />
        {/* hour ticks under horizon */}
        {[0, 6, 12, 18, 24].map((h) => {
          const x = (h / 24) * 96 + 2;
          return <g key={h}>
            <line x1={x} y1="50" x2={x} y2="52" stroke={cv.ink2} strokeWidth="0.2" />
            <text x={x} y="55" fontSize="2" fontFamily="IBM Plex Mono" fill={cv.ink3} textAnchor="middle">{h === 0 || h === 24 ? '·' : h}</text>
          </g>;
        })}
        {/* labels */}
        <text x="2" y="56.5" fontSize="1.6" fontFamily="IBM Plex Mono" fill={cv.ink3}>dawn</text>
        <text x="98" y="56.5" fontSize="1.6" fontFamily="IBM Plex Mono" fill={cv.ink3} textAnchor="end">dusk</text>
        {/* stars */}
        {stars.map((s, i) => (
          <g key={i}>
            <circle cx={s.x} cy={s.y} r={s.r * 1.2} fill={col(s.s)} opacity="0.18" />
            {/* cross glyph for negs, dot otherwise */}
            {s.s === 'neg' ? (
              <g stroke={col(s.s)} strokeWidth="0.18">
                <line x1={s.x - 0.6} y1={s.y} x2={s.x + 0.6} y2={s.y} />
                <line x1={s.x} y1={s.y - 0.6} x2={s.x} y2={s.y + 0.6} />
              </g>
            ) : (
              <circle cx={s.x} cy={s.y} r={s.r * 0.5} fill={col(s.s)} />
            )}
          </g>
        ))}
      </svg>
      <div style={{ position: 'absolute', top: 12, left: 16, fontFamily: cv.mono, fontSize: 10, color: cv.accent, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
        ❋ Sky dome · today's calls
      </div>
      <div style={{ position: 'absolute', top: 12, right: 16, fontFamily: cv.mono, fontSize: 9, color: cv.ink3 }}>
        calls rise & set
      </div>
    </div>
  );
}

// =============================================================================
//  V5 · COSMIC WEB — no axes, force-graph clusters, ringed anomalies
// =============================================================================
function ChartCosmicWeb({ width = 800, height = 360 }) {
  // Define cluster centers manually for stability
  const clusters = [
    { cx: 22, cy: 30, label: 'insurance', count: 14, color: cv.red },
    { cx: 50, cy: 50, label: 'treatment', count: 31, color: cv.accent },
    { cx: 75, cy: 28, label: 'billing', count: 9, color: cv.amber },
    { cx: 80, cy: 65, label: 'recall', count: 18, color: cv.accent },
    { cx: 30, cy: 70, label: 'new patient', count: 22, color: cv.accent },
  ];
  let seed = 19;
  const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  // For each cluster, generate orbiting stars
  const stars = [];
  const links = [];
  clusters.forEach((c, ci) => {
    const n = c.count;
    const ringIds = [];
    for (let i = 0; i < n; i++) {
      const angle = (i / n) * Math.PI * 2 + rand() * 0.4;
      const radius = 3 + rand() * 7;
      const x = c.cx + Math.cos(angle) * radius;
      const y = c.cy + Math.sin(angle) * radius * 0.7;
      const isAnomaly = i === 0 && (ci === 0 || ci === 2);
      stars.push({ x, y, color: c.color, r: 0.6 + rand() * 0.5, anomaly: isAnomaly, cluster: ci });
      ringIds.push(stars.length - 1);
    }
    // intra-cluster constellation lines (a few)
    for (let i = 0; i < Math.min(5, ringIds.length - 1); i++) {
      const a = ringIds[i];
      const b = ringIds[(i + 2) % ringIds.length];
      links.push([a, b, c.color]);
    }
  });
  // inter-cluster faint lines (pattern bridges)
  const bridges = [[0, 1], [1, 2], [1, 3], [3, 4], [0, 4]];

  return (
    <div style={{ width, height, position: 'relative', background: cv.paperWarm, borderRadius: 4, overflow: 'hidden', border: `1px solid ${cv.line}` }}>
      {/* faint texture */}
      <div style={{ position: 'absolute', inset: 0, backgroundImage: `radial-gradient(circle at 30% 40%, rgba(31,107,58,0.06), transparent 50%), radial-gradient(circle at 75% 65%, rgba(184,133,43,0.05), transparent 50%)` }} />
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: '100%', height: '100%', position: 'relative' }}>
        {/* faint inter-cluster bridges */}
        {bridges.map(([a, b], i) => (
          <line key={'br' + i} x1={clusters[a].cx} y1={clusters[a].cy} x2={clusters[b].cx} y2={clusters[b].cy} stroke={cv.ink} strokeWidth="0.1" opacity="0.18" strokeDasharray="0.6 0.6" />
        ))}
        {/* intra-cluster constellation lines */}
        {links.map(([a, b, c], i) => {
          const A = stars[a]; const B = stars[b];
          return <line key={'lk' + i} x1={A.x} y1={A.y} x2={B.x} y2={B.y} stroke={c} strokeWidth="0.15" opacity="0.45" />;
        })}
        {/* cluster centers + halos */}
        {clusters.map((c, i) => (
          <g key={i}>
            <circle cx={c.cx} cy={c.cy} r="11" fill="none" stroke={c.color} strokeWidth="0.18" opacity="0.5" strokeDasharray="0.8 0.5" />
            <circle cx={c.cx} cy={c.cy} r="0.8" fill={c.color} />
          </g>
        ))}
        {/* stars */}
        {stars.map((s, i) => (
          <g key={i}>
            <circle cx={s.x} cy={s.y} r={s.r * 1.6} fill={s.color} opacity="0.16" />
            <circle cx={s.x} cy={s.y} r={s.r * 0.5} fill={s.color} />
            {s.anomaly && (
              <circle cx={s.x} cy={s.y} r={s.r * 1.4} fill="none" stroke={s.color} strokeWidth="0.18" />
            )}
          </g>
        ))}
      </svg>
      {/* cluster labels */}
      {clusters.map((c, i) => (
        <div key={i} style={{ position: 'absolute', left: `${c.cx}%`, top: `${c.cy + 14}%`, transform: 'translateX(-50%)', fontFamily: cv.display, fontSize: width > 500 ? 13 : 10, fontStyle: 'italic', fontWeight: 400, color: cv.accentDeep, whiteSpace: 'nowrap' }}>
          {c.label} <span style={{ fontFamily: cv.mono, fontStyle: 'normal', fontSize: width > 500 ? 9 : 8, color: cv.ink3 }}>· {c.count}</span>
        </div>
      ))}
      <div style={{ position: 'absolute', top: 12, left: 16, fontFamily: cv.mono, fontSize: 10, color: cv.accent, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
        ❋ Cosmic web · 5 patterns · 94 calls
      </div>
      <div style={{ position: 'absolute', top: 12, right: 16, fontFamily: cv.mono, fontSize: 9, color: cv.ink3 }}>
        ◯ = anomaly
      </div>
      <div style={{ position: 'absolute', bottom: 12, left: 16, fontFamily: cv.mono, fontSize: 9, color: cv.ink3, lineHeight: 1.6 }}>
        no axes — calls grouped by topic similarity
      </div>
    </div>
  );
}

// =============================================================================
//  Section component — renders all 5 in hero + small layout
// =============================================================================
function ChartVariantsSection() {
  const variants = [
    { num: '01', name: 'Field', sub: 'rectangular · sparse · hairline grid', desc: "The control. Clean rectangular x/y, soft constellation lines, dot stars. Quietest on the page — gets out of the way of the table.", Comp: ChartField },
    { num: '02', name: 'Atlas', sub: '14d · 580 calls · cluster halos', desc: "Real density. RA/DEC ticks, dashed cluster halos with named patterns inline. The Bloomberg-meets-star-atlas read.", Comp: ChartAtlas },
    { num: '03', name: 'Polar Day', sub: '24h × score · radial', desc: "Angle = hour of day, radius = score. Reveals when calls happen, not just how. Faint dawn/dusk rim. Hour ticks like a clock.", Comp: ChartPolarDay },
    { num: '04', name: 'Sky Dome', sub: 'horizon arc · gradient sky', desc: "Half-dome with sun-arc guide. Calls rise toward noon and set. Gradient horizon at the bottom. Crosses for negatives. Most poetic.", Comp: ChartSkyDome },
    { num: '05', name: 'Cosmic Web', sub: 'no axes · force-graph', desc: "No coordinate frame at all. Calls cluster by topic similarity, lines connect within-cluster pattern members. Ringed glyph = anomaly. Most metaphor-forward.", Comp: ChartCosmicWeb },
  ];

  return (
    <div style={{ width: '100%' }}>
      {variants.map((v) => (
        <div key={v.num} style={{ background: cv.paper, borderTop: `1px solid ${cv.line}`, padding: '40px 48px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 22, paddingBottom: 14, borderBottom: `1px solid ${cv.line}` }}>
            <div>
              <div style={{ fontFamily: cv.mono, fontSize: 11, color: cv.accent, letterSpacing: '0.18em', textTransform: 'uppercase', marginBottom: 6 }}>
                ❋ Chart variant {v.num}
              </div>
              <div style={{ fontFamily: cv.display, fontSize: 48, fontStyle: 'italic', fontWeight: 300, letterSpacing: '-0.025em', lineHeight: 1, color: cv.ink }}>
                {v.name}
              </div>
              <div style={{ fontFamily: cv.mono, fontSize: 10, color: cv.ink3, marginTop: 6, letterSpacing: '0.08em' }}>{v.sub}</div>
            </div>
            <div style={{ maxWidth: 380, fontSize: 13.5, lineHeight: 1.55, color: cv.ink2, fontFamily: cv.body }}>
              {v.desc}
            </div>
          </div>
          {/* Hero */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontFamily: cv.mono, fontSize: 9.5, color: cv.ink3, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 8 }}>at hero scale · ~800 × 360</div>
            <v.Comp width={820} height={360} />
          </div>
          {/* Smalls — row of two for comparison */}
          <div>
            <div style={{ fontFamily: cv.mono, fontSize: 9.5, color: cv.ink3, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 8 }}>at small / sidekick scale · ~340 × 200</div>
            <div style={{ display: 'flex', gap: 14 }}>
              <v.Comp width={340} height={200} />
              <v.Comp width={340} height={200} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

window.ChartVariantsSection = ChartVariantsSection;
