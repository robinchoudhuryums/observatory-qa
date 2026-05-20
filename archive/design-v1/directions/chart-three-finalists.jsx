/* global React */
/* eslint-disable */
// =============================================================================
//  CONSTELLATION CHART · 3 chosen variants × 2 treatments (plain + thematic)
//  Field, Sky Dome, Cosmic Web
// =============================================================================

const cv2 = {
  ink: '#0d1018',
  ink2: '#3a3f4a',
  ink3: '#7d818c',
  ink4: '#aeb1b8',
  paper: '#fafafa',
  paperWarm: '#f4f2ea',
  paperWarmer: '#ede9dc',
  line: '#dcd9d0',
  accent: '#1f6b3a',
  accentDeep: '#0f4423',
  amber: '#b8852b',
  red: '#a23b3b',
  display: "'Fraunces', 'Newsreader', serif",
  body: "'Inter Tight', system-ui, sans-serif",
  mono: "'IBM Plex Mono', monospace",
};

// =============================================================================
//  V1 · FIELD — plain
// =============================================================================
function FieldPlain({ width = 820, height = 380 }) {
  const stars = [];
  for (let i = 0; i < 84; i++) {
    const x = (i * 47.3) % 100;
    const y = 12 + ((i * 17.7) % 70);
    const s = (i % 7 === 0) ? 'pos' : (i % 11 === 0) ? 'neg' : (i % 5 === 0) ? 'neu' : 'pos';
    const r = 1.2 + ((i * 3) % 4) * 0.5;
    stars.push({ x, y, s, r });
  }
  const lines = [[0, 12], [12, 23], [23, 30], [30, 41], [41, 55], [5, 17], [17, 29]];
  const col = (s) => s === 'pos' ? cv2.accent : s === 'neg' ? cv2.red : cv2.amber;
  return (
    <div style={{ width, height, position: 'relative', background: cv2.paperWarm, borderRadius: 4, overflow: 'hidden', border: `1px solid ${cv2.line}` }}>
      <svg viewBox="0 0 100 80" preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
        {[20, 40, 60].map((y) => <line key={y} x1="0" x2="100" y1={y} y2={y} stroke={cv2.line} strokeWidth="0.1" />)}
        {lines.map(([a, b], i) => {
          const A = stars[a]; const B = stars[b];
          if (!A || !B) return null;
          return <line key={i} x1={A.x} y1={A.y} x2={B.x} y2={B.y} stroke={cv2.accent} strokeWidth="0.18" opacity="0.5" />;
        })}
        {stars.map((s, i) => (
          <g key={i}>
            <circle cx={s.x} cy={s.y} r={s.r * 1.6} fill={col(s.s)} opacity="0.18" />
            <circle cx={s.x} cy={s.y} r={s.r * 0.55} fill={col(s.s)} />
          </g>
        ))}
      </svg>
      <div style={{ position: 'absolute', top: 14, left: 18, fontFamily: cv2.mono, fontSize: 10, color: cv2.accent, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
        ❋ Score × time · 30d · 84 calls
      </div>
      <div style={{ position: 'absolute', bottom: 10, left: 18, fontFamily: cv2.mono, fontSize: 9, color: cv2.ink3, letterSpacing: '0.08em' }}>
        Apr 1 ←─────────────────────→ Apr 30
      </div>
    </div>
  );
}

// =============================================================================
//  V1 · FIELD — thematic (graph paper / star atlas page texture, marginalia)
// =============================================================================
function FieldThematic({ width = 820, height = 380 }) {
  const stars = [];
  for (let i = 0; i < 84; i++) {
    const x = (i * 47.3) % 100;
    const y = 12 + ((i * 17.7) % 70);
    const s = (i % 7 === 0) ? 'pos' : (i % 11 === 0) ? 'neg' : (i % 5 === 0) ? 'neu' : 'pos';
    const r = 1.2 + ((i * 3) % 4) * 0.5;
    stars.push({ x, y, s, r });
  }
  const lines = [[0, 12], [12, 23], [23, 30], [30, 41], [41, 55], [5, 17], [17, 29]];
  const col = (s) => s === 'pos' ? cv2.accent : s === 'neg' ? cv2.red : cv2.amber;
  return (
    <div style={{ width, height, position: 'relative', borderRadius: 4, overflow: 'hidden', border: `1px solid ${cv2.line}`, background: '#f0ead8' }}>
      {/* paper grain */}
      <div style={{ position: 'absolute', inset: 0, backgroundImage: `repeating-linear-gradient(0deg, transparent 0, transparent 19px, rgba(31,107,58,0.06) 19px, rgba(31,107,58,0.06) 20px), repeating-linear-gradient(90deg, transparent 0, transparent 19px, rgba(31,107,58,0.06) 19px, rgba(31,107,58,0.06) 20px)` }} />
      {/* page edge stains */}
      <div style={{ position: 'absolute', inset: 0, backgroundImage: `radial-gradient(circle at 8% 12%, rgba(120,90,40,0.10), transparent 20%), radial-gradient(circle at 92% 88%, rgba(120,90,40,0.10), transparent 20%), radial-gradient(circle at 4% 95%, rgba(160,120,60,0.08), transparent 18%)` }} />
      {/* hairline frame inset */}
      <div style={{ position: 'absolute', top: 14, left: 14, right: 14, bottom: 14, border: `0.5px solid rgba(13,16,24,0.35)`, pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', top: 18, left: 18, right: 18, bottom: 18, border: `0.5px solid rgba(13,16,24,0.20)`, pointerEvents: 'none' }} />
      <svg viewBox="0 0 100 80" preserveAspectRatio="none" style={{ position: 'absolute', inset: '8% 6%', width: '88%', height: '84%' }}>
        {/* RA-style ticks */}
        {[10, 20, 30, 40, 50, 60, 70, 80, 90].map((x) => <line key={x} x1={x} y1="0" x2={x} y2="1.5" stroke={cv2.ink2} strokeWidth="0.18" />)}
        {[10, 20, 30, 40, 50, 60, 70, 80, 90].map((x) => <line key={x} x1={x} y1="78.5" x2={x} y2="80" stroke={cv2.ink2} strokeWidth="0.18" />)}
        {[20, 40, 60].map((y) => <line key={y} x1="0" x2="1.5" y1={y} y2={y} stroke={cv2.ink2} strokeWidth="0.18" />)}
        {[20, 40, 60].map((y) => <line key={y} x1="98.5" x2="100" y1={y} y2={y} stroke={cv2.ink2} strokeWidth="0.18" />)}
        {/* dotted graticule */}
        {[20, 40, 60].map((y) => <line key={y} x1="0" x2="100" y1={y} y2={y} stroke={cv2.ink} strokeWidth="0.08" strokeDasharray="0.3 0.5" opacity="0.35" />)}
        {/* constellation lines */}
        {lines.map(([a, b], i) => {
          const A = stars[a]; const B = stars[b];
          if (!A || !B) return null;
          return <line key={i} x1={A.x} y1={A.y} x2={B.x} y2={B.y} stroke={cv2.accentDeep} strokeWidth="0.22" opacity="0.7" />;
        })}
        {stars.map((s, i) => (
          <g key={i}>
            <circle cx={s.x} cy={s.y} r={s.r * 1.8} fill={col(s.s)} opacity="0.22" />
            {/* 4-point star glyph */}
            <path
              d={`M ${s.x} ${s.y - s.r * 1.4} L ${s.x + s.r * 0.3} ${s.y - s.r * 0.3} L ${s.x + s.r * 1.4} ${s.y} L ${s.x + s.r * 0.3} ${s.y + s.r * 0.3} L ${s.x} ${s.y + s.r * 1.4} L ${s.x - s.r * 0.3} ${s.y + s.r * 0.3} L ${s.x - s.r * 1.4} ${s.y} L ${s.x - s.r * 0.3} ${s.y - s.r * 0.3} Z`}
              fill={col(s.s)}
            />
          </g>
        ))}
      </svg>
      {/* corner marks (registration) */}
      {[
        { top: 8, left: 8 }, { top: 8, right: 8 }, { bottom: 8, left: 8 }, { bottom: 8, right: 8 },
      ].map((p, i) => (
        <div key={i} style={{ position: 'absolute', ...p, width: 8, height: 8, borderTop: i < 2 ? `1px solid ${cv2.ink}` : 'none', borderBottom: i >= 2 ? `1px solid ${cv2.ink}` : 'none', borderLeft: (i === 0 || i === 2) ? `1px solid ${cv2.ink}` : 'none', borderRight: (i === 1 || i === 3) ? `1px solid ${cv2.ink}` : 'none' }} />
      ))}
      {/* eyebrow */}
      <div style={{ position: 'absolute', top: 22, left: 28, fontFamily: cv2.mono, fontSize: 9.5, color: cv2.accentDeep, letterSpacing: '0.18em', textTransform: 'uppercase', background: '#f0ead8', padding: '2px 6px' }}>
        ❋ Plate IV · Score × Time · April mmxxv
      </div>
      <div style={{ position: 'absolute', top: 22, right: 28, fontFamily: cv2.display, fontStyle: 'italic', fontSize: 13, color: cv2.accentDeep, background: '#f0ead8', padding: '0 6px' }}>
        n = 84
      </div>
      {/* italic marginalia */}
      <div style={{ position: 'absolute', top: '38%', right: 28, fontFamily: cv2.display, fontStyle: 'italic', fontSize: 11, color: cv2.ink2, lineHeight: 1.4, maxWidth: 140, textAlign: 'right', background: '#f0ead8', padding: '4px 6px' }}>
        — bright cluster, late <br />treatment-plan calls
        <div style={{ fontFamily: cv2.mono, fontStyle: 'normal', fontSize: 8.5, color: cv2.ink3, marginTop: 2, letterSpacing: '0.08em' }}>22 — 25 APR</div>
      </div>
      <div style={{ position: 'absolute', bottom: 26, left: 28, fontFamily: cv2.mono, fontSize: 9, color: cv2.ink2, letterSpacing: '0.10em', background: '#f0ead8', padding: '2px 6px' }}>
        Apr 1 ←─────────────────────→ Apr 30
      </div>
      <div style={{ position: 'absolute', bottom: 26, right: 28, fontFamily: cv2.display, fontStyle: 'italic', fontSize: 10, color: cv2.ink3, background: '#f0ead8', padding: '0 6px' }}>
        — recorded by Owl
      </div>
    </div>
  );
}

// =============================================================================
//  V4 · SKY DOME — plain (existing, refined)
// =============================================================================
function SkyDomePlain({ width = 820, height = 380 }) {
  const stars = [];
  let seed = 13;
  const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  for (let i = 0; i < 110; i++) {
    let hour;
    if (rand() < 0.7) hour = 8 + rand() * 10;
    else hour = rand() * 24;
    const score = 4 + rand() * 5.5;
    const x = (hour / 24) * 96 + 2;
    const arc = Math.sin((hour / 24) * Math.PI) * 18;
    const altScore = ((score - 4) / 6) * 24;
    const y = 50 - (arc * 0.4 + altScore * 0.7);
    const s = score > 7.5 ? 'pos' : score > 6 ? 'neu' : 'neg';
    stars.push({ x, y, s, r: 0.5 + rand() * 0.5, hour });
  }
  const col = (s) => s === 'pos' ? cv2.accent : s === 'neg' ? cv2.red : cv2.amber;
  return (
    <div style={{ width, height, position: 'relative', borderRadius: 4, overflow: 'hidden', border: `1px solid ${cv2.line}`, background: cv2.paperWarm }}>
      <svg viewBox="0 0 100 60" preserveAspectRatio="none" style={{ width: '100%', height: '100%', position: 'absolute', inset: 0 }}>
        <line x1="0" y1="50" x2="100" y2="50" stroke={cv2.ink} strokeWidth="0.18" />
        <path d="M 2 50 Q 50 22 98 50" fill="none" stroke={cv2.accent} strokeWidth="0.2" strokeDasharray="0.8 0.6" opacity="0.55" />
        {[0, 6, 12, 18, 24].map((h) => {
          const x = (h / 24) * 96 + 2;
          return <g key={h}>
            <line x1={x} y1="50" x2={x} y2="52" stroke={cv2.ink2} strokeWidth="0.2" />
            <text x={x} y="55" fontSize="2" fontFamily="IBM Plex Mono" fill={cv2.ink3} textAnchor="middle">{h === 0 || h === 24 ? '·' : h}</text>
          </g>;
        })}
        <text x="2" y="56.5" fontSize="1.6" fontFamily="IBM Plex Mono" fill={cv2.ink3}>dawn</text>
        <text x="98" y="56.5" fontSize="1.6" fontFamily="IBM Plex Mono" fill={cv2.ink3} textAnchor="end">dusk</text>
        {stars.map((s, i) => (
          <g key={i}>
            <circle cx={s.x} cy={s.y} r={s.r * 1.2} fill={col(s.s)} opacity="0.18" />
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
      <div style={{ position: 'absolute', top: 14, left: 18, fontFamily: cv2.mono, fontSize: 10, color: cv2.accent, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
        ❋ Sky dome · today's calls
      </div>
      <div style={{ position: 'absolute', top: 14, right: 18, fontFamily: cv2.mono, fontSize: 9, color: cv2.ink3 }}>
        calls rise & set
      </div>
    </div>
  );
}

// =============================================================================
//  V4 · SKY DOME — thematic (real night sky gradient, twinkle, ground silhouette)
// =============================================================================
function SkyDomeThematic({ width = 820, height = 380 }) {
  const stars = [];
  let seed = 13;
  const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  for (let i = 0; i < 140; i++) {
    let hour;
    if (rand() < 0.7) hour = 8 + rand() * 10;
    else hour = rand() * 24;
    const score = 4 + rand() * 5.5;
    const x = (hour / 24) * 96 + 2;
    const arc = Math.sin((hour / 24) * Math.PI) * 18;
    const altScore = ((score - 4) / 6) * 24;
    const y = 50 - (arc * 0.4 + altScore * 0.7);
    const s = score > 7.5 ? 'pos' : score > 6 ? 'neu' : 'neg';
    stars.push({ x, y, s, r: 0.5 + rand() * 0.6, hour, twinkle: rand() > 0.6 });
  }
  const col = (s) => s === 'pos' ? '#7ed99c' : s === 'neg' ? '#ff8a8a' : '#ffc66b';
  return (
    <div style={{ width, height, position: 'relative', borderRadius: 4, overflow: 'hidden', border: `1px solid ${cv2.line}` }}>
      {/* night sky gradient */}
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, #0a0e1f 0%, #131a36 30%, #2a2952 55%, #6b3d4a 75%, #c08555 88%, #e8b06a 95%, #1a0f0a 100%)' }} />
      {/* horizontal time stripes - dawn/noon/dusk */}
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, rgba(20,30,55,0.5) 0%, rgba(255,170,80,0.18) 12%, rgba(255,210,140,0.0) 30%, rgba(255,255,255,0.0) 50%, rgba(255,210,140,0.0) 70%, rgba(255,160,80,0.18) 88%, rgba(20,20,40,0.5) 100%)' }} />
      <svg viewBox="0 0 100 60" preserveAspectRatio="none" style={{ width: '100%', height: '100%', position: 'absolute', inset: 0 }}>
        <defs>
          <radialGradient id="starglow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </radialGradient>
        </defs>
        {/* faint ambient stars (background) */}
        {Array.from({ length: 80 }).map((_, i) => {
          seed = (seed * 9301 + 49297) % 233280;
          const x = (seed / 233280) * 100;
          seed = (seed * 9301 + 49297) % 233280;
          const y = (seed / 233280) * 48;
          seed = (seed * 9301 + 49297) % 233280;
          const r = 0.1 + (seed / 233280) * 0.18;
          return <circle key={i} cx={x} cy={y} r={r} fill="#ffffff" opacity="0.55" />;
        })}
        {/* ground silhouette - rolling hills */}
        <path d="M 0 50 L 0 60 L 100 60 L 100 50 Q 92 48.5 86 49.2 Q 80 50 74 48.5 Q 68 47 60 49 Q 50 50.5 42 48 Q 36 46 28 48.5 Q 22 50 14 48 Q 8 47 0 49 Z" fill="#0a0c14" />
        {/* second silhouette (closer hill) */}
        <path d="M 0 60 L 100 60 L 100 53 Q 90 51 80 52.5 Q 70 53.5 60 51.5 Q 50 50 40 52 Q 30 54 20 52 Q 10 51 0 53 Z" fill="#050810" />
        {/* sun arc - subtle */}
        <path d="M 2 50 Q 50 18 98 50" fill="none" stroke="#ffd9a0" strokeWidth="0.2" strokeDasharray="0.7 0.7" opacity="0.30" />
        {/* hour ticks */}
        {[0, 6, 12, 18, 24].map((h) => {
          const x = (h / 24) * 96 + 2;
          return <g key={h}>
            <line x1={x} y1="50" x2={x} y2="50.8" stroke="#ffd9a0" strokeWidth="0.18" opacity="0.55" />
          </g>;
        })}
        {/* call stars - bright with halos */}
        {stars.map((s, i) => (
          <g key={i}>
            <circle cx={s.x} cy={s.y} r={s.r * 2.6} fill="url(#starglow)" opacity={s.twinkle ? 0.55 : 0.30} />
            <circle cx={s.x} cy={s.y} r={s.r * 1.4} fill={col(s.s)} opacity="0.65" />
            {s.s === 'neg' ? (
              <g stroke={col(s.s)} strokeWidth="0.22" opacity="0.95">
                <line x1={s.x - 0.7} y1={s.y} x2={s.x + 0.7} y2={s.y} />
                <line x1={s.x} y1={s.y - 0.7} x2={s.x} y2={s.y + 0.7} />
              </g>
            ) : (
              <circle cx={s.x} cy={s.y} r={s.r * 0.55} fill="#ffffff" />
            )}
          </g>
        ))}
        {/* horizon labels */}
        <text x="3" y="58" fontSize="1.7" fontFamily="IBM Plex Mono" fill="#ffd9a0" opacity="0.85">dawn</text>
        <text x="97" y="58" fontSize="1.7" fontFamily="IBM Plex Mono" fill="#ffd9a0" opacity="0.85" textAnchor="end">dusk</text>
        {/* hour labels under hills */}
        {[6, 12, 18].map((h) => {
          const x = (h / 24) * 96 + 2;
          return <text key={h} x={x} y="58" fontSize="1.7" fontFamily="IBM Plex Mono" fill="#aab8d0" textAnchor="middle">{h}</text>;
        })}
      </svg>
      {/* eyebrow + meta */}
      <div style={{ position: 'absolute', top: 16, left: 20, fontFamily: cv2.mono, fontSize: 10, color: '#ffd9a0', letterSpacing: '0.14em', textTransform: 'uppercase' }}>
        ❋ Sky dome · 26 April · 134 calls
      </div>
      <div style={{ position: 'absolute', top: 16, right: 20, fontFamily: cv2.display, fontStyle: 'italic', fontSize: 14, color: '#ffd9a0' }}>
        rise & set
      </div>
      <div style={{ position: 'absolute', bottom: 12, left: 20, fontFamily: cv2.mono, fontSize: 9, color: '#aab8d0', letterSpacing: '0.10em' }}>
        ◐ moonset 06:14 · ☼ sunrise 06:42 · ☼ sunset 19:38
      </div>
    </div>
  );
}

// =============================================================================
//  V5 · COSMIC WEB — plain (existing)
// =============================================================================
function CosmicWebPlain({ width = 820, height = 380 }) {
  const clusters = [
    { cx: 22, cy: 30, label: 'insurance', count: 14, color: cv2.red },
    { cx: 50, cy: 50, label: 'treatment', count: 31, color: cv2.accent },
    { cx: 75, cy: 28, label: 'billing', count: 9, color: cv2.amber },
    { cx: 80, cy: 65, label: 'recall', count: 18, color: cv2.accent },
    { cx: 30, cy: 70, label: 'new patient', count: 22, color: cv2.accent },
  ];
  let seed = 19;
  const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
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
    for (let i = 0; i < Math.min(5, ringIds.length - 1); i++) {
      const a = ringIds[i];
      const b = ringIds[(i + 2) % ringIds.length];
      links.push([a, b, c.color]);
    }
  });
  const bridges = [[0, 1], [1, 2], [1, 3], [3, 4], [0, 4]];
  return (
    <div style={{ width, height, position: 'relative', background: cv2.paperWarm, borderRadius: 4, overflow: 'hidden', border: `1px solid ${cv2.line}` }}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
        {bridges.map(([a, b], i) => (
          <line key={'br' + i} x1={clusters[a].cx} y1={clusters[a].cy} x2={clusters[b].cx} y2={clusters[b].cy} stroke={cv2.ink} strokeWidth="0.1" opacity="0.18" strokeDasharray="0.6 0.6" />
        ))}
        {links.map(([a, b, c], i) => {
          const A = stars[a]; const B = stars[b];
          return <line key={'lk' + i} x1={A.x} y1={A.y} x2={B.x} y2={B.y} stroke={c} strokeWidth="0.15" opacity="0.45" />;
        })}
        {clusters.map((c, i) => (
          <g key={i}>
            <circle cx={c.cx} cy={c.cy} r="11" fill="none" stroke={c.color} strokeWidth="0.18" opacity="0.5" strokeDasharray="0.8 0.5" />
            <circle cx={c.cx} cy={c.cy} r="0.8" fill={c.color} />
          </g>
        ))}
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
      {clusters.map((c, i) => (
        <div key={i} style={{ position: 'absolute', left: `${c.cx}%`, top: `${c.cy + 14}%`, transform: 'translateX(-50%)', fontFamily: cv2.display, fontSize: 13, fontStyle: 'italic', fontWeight: 400, color: cv2.accentDeep, whiteSpace: 'nowrap' }}>
          {c.label} <span style={{ fontFamily: cv2.mono, fontStyle: 'normal', fontSize: 9, color: cv2.ink3 }}>· {c.count}</span>
        </div>
      ))}
      <div style={{ position: 'absolute', top: 14, left: 18, fontFamily: cv2.mono, fontSize: 10, color: cv2.accent, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
        ❋ Cosmic web · 5 patterns · 94 calls
      </div>
    </div>
  );
}

// =============================================================================
//  V5 · COSMIC WEB — thematic (deep paper, nebula glows, vivid colors, vignette)
// =============================================================================
function CosmicWebThematic({ width = 820, height = 380 }) {
  const clusters = [
    { cx: 22, cy: 30, label: 'insurance', count: 14, color: '#ff6b6b', glow: 'rgba(255,107,107,0.35)' },
    { cx: 50, cy: 50, label: 'treatment', count: 31, color: '#7ed99c', glow: 'rgba(126,217,156,0.35)' },
    { cx: 75, cy: 28, label: 'billing', count: 9, color: '#ffc66b', glow: 'rgba(255,198,107,0.35)' },
    { cx: 80, cy: 65, label: 'recall', count: 18, color: '#9bb8ff', glow: 'rgba(155,184,255,0.32)' },
    { cx: 30, cy: 70, label: 'new patient', count: 22, color: '#c89bff', glow: 'rgba(200,155,255,0.32)' },
  ];
  let seed = 19;
  const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
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
    for (let i = 0; i < Math.min(5, ringIds.length - 1); i++) {
      const a = ringIds[i];
      const b = ringIds[(i + 2) % ringIds.length];
      links.push([a, b, c.color]);
    }
  });
  const bridges = [[0, 1], [1, 2], [1, 3], [3, 4], [0, 4], [2, 3]];
  return (
    <div style={{ width, height, position: 'relative', borderRadius: 4, overflow: 'hidden', border: `1px solid ${cv2.line}`, background: '#0a0e1c' }}>
      {/* deep cosmos gradient */}
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse at 20% 30%, rgba(40,30,80,0.7), transparent 50%), radial-gradient(ellipse at 80% 65%, rgba(20,50,80,0.6), transparent 55%), radial-gradient(circle at 50% 50%, #0e1428 0%, #060912 100%)' }} />
      {/* nebula glows behind clusters */}
      {clusters.map((c, i) => (
        <div key={i} style={{ position: 'absolute', left: `${c.cx}%`, top: `${c.cy}%`, width: 220, height: 220, transform: 'translate(-50%, -50%)', background: `radial-gradient(circle, ${c.glow}, transparent 65%)`, filter: 'blur(8px)', pointerEvents: 'none' }} />
      ))}
      {/* faint background stars */}
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
        {Array.from({ length: 120 }).map((_, i) => {
          seed = (seed * 9301 + 49297) % 233280;
          const x = (seed / 233280) * 100;
          seed = (seed * 9301 + 49297) % 233280;
          const y = (seed / 233280) * 100;
          seed = (seed * 9301 + 49297) % 233280;
          const r = 0.1 + (seed / 233280) * 0.2;
          seed = (seed * 9301 + 49297) % 233280;
          const opacity = 0.2 + (seed / 233280) * 0.5;
          return <circle key={i} cx={x} cy={y} r={r} fill="#ffffff" opacity={opacity} />;
        })}
      </svg>
      {/* main graph */}
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: '100%', height: '100%', position: 'absolute', inset: 0 }}>
        <defs>
          <radialGradient id="cosmicGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </radialGradient>
        </defs>
        {/* bridges - faint cosmic web filaments */}
        {bridges.map(([a, b], i) => (
          <line key={'br' + i} x1={clusters[a].cx} y1={clusters[a].cy} x2={clusters[b].cx} y2={clusters[b].cy} stroke="#aab8d0" strokeWidth="0.12" opacity="0.30" strokeDasharray="0.8 0.6" />
        ))}
        {/* intra-cluster links - more vivid */}
        {links.map(([a, b, c], i) => {
          const A = stars[a]; const B = stars[b];
          return <line key={'lk' + i} x1={A.x} y1={A.y} x2={B.x} y2={B.y} stroke={c} strokeWidth="0.18" opacity="0.55" />;
        })}
        {/* cluster halos */}
        {clusters.map((c, i) => (
          <g key={i}>
            <circle cx={c.cx} cy={c.cy} r="12" fill="none" stroke={c.color} strokeWidth="0.18" opacity="0.55" strokeDasharray="0.8 0.5" />
          </g>
        ))}
        {/* stars - with glow */}
        {stars.map((s, i) => (
          <g key={i}>
            <circle cx={s.x} cy={s.y} r={s.r * 3.2} fill="url(#cosmicGlow)" opacity="0.4" />
            <circle cx={s.x} cy={s.y} r={s.r * 1.4} fill={s.color} opacity="0.55" />
            <circle cx={s.x} cy={s.y} r={s.r * 0.55} fill="#ffffff" />
            {s.anomaly && (
              <circle cx={s.x} cy={s.y} r={s.r * 2} fill="none" stroke={s.color} strokeWidth="0.22" opacity="0.9" />
            )}
          </g>
        ))}
      </svg>
      {/* vignette */}
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle, transparent 50%, rgba(0,0,0,0.4) 100%)', pointerEvents: 'none' }} />
      {/* cluster labels */}
      {clusters.map((c, i) => (
        <div key={i} style={{ position: 'absolute', left: `${c.cx}%`, top: `${c.cy + 13}%`, transform: 'translateX(-50%)', fontFamily: cv2.display, fontSize: 13, fontStyle: 'italic', fontWeight: 400, color: c.color, whiteSpace: 'nowrap', textShadow: '0 0 6px rgba(0,0,0,0.7)' }}>
          {c.label} <span style={{ fontFamily: cv2.mono, fontStyle: 'normal', fontSize: 9, color: '#aab8d0' }}>· {c.count}</span>
        </div>
      ))}
      <div style={{ position: 'absolute', top: 16, left: 20, fontFamily: cv2.mono, fontSize: 10, color: '#7ed99c', letterSpacing: '0.14em', textTransform: 'uppercase' }}>
        ❋ Cosmic web · 5 patterns · 94 calls
      </div>
      <div style={{ position: 'absolute', top: 16, right: 20, fontFamily: cv2.display, fontStyle: 'italic', fontSize: 13, color: '#ffd9a0' }}>
        ◯ anomaly
      </div>
      <div style={{ position: 'absolute', bottom: 14, left: 20, fontFamily: cv2.mono, fontSize: 9, color: '#aab8d0', letterSpacing: '0.10em' }}>
        no axes · grouped by topic similarity · brighter = more recent
      </div>
    </div>
  );
}

// =============================================================================
//  Page wrappers — one per board, each shows plain + thematic stacked
// =============================================================================
function FieldBoard() {
  return <ChartCompareBoard num="01" name="Field" sub="rectangular · sparse · hairline grid" desc="The control. Clean rectangular x/y, soft constellation lines, dot stars. Quietest on the page — gets out of the way of the table." Plain={FieldPlain} Themed={FieldThematic} themeNote="Star-atlas page: graph paper texture, tipped-in plate frame with corner registration marks, italic marginalia, 4-point star glyphs. Reads like a field guide plate." />;
}
function SkyDomeBoard() {
  return <ChartCompareBoard num="04" name="Sky Dome" sub="horizon arc · sun-arc guide" desc="Half-dome with sun-arc guide. Calls rise toward noon and set. Most poetic of the bunch — and it answers 'when is my busiest hour' at a glance." Plain={SkyDomePlain} Themed={SkyDomeThematic} themeNote="Real night sky: deep navy → amber horizon → black ground silhouette with rolling hills. Stars glow with halos and twinkle. Sunrise/sunset/moonset times in the footer. Ambient." />;
}
function CosmicWebBoard() {
  return <ChartCompareBoard num="05" name="Cosmic Web" sub="no axes · force-graph clusters" desc="No coordinate frame. Calls cluster by topic similarity, lines connect within-cluster pattern members. Ringed glyph = anomaly. Most metaphor-forward — best when the story is the patterns themselves." Plain={CosmicWebPlain} Themed={CosmicWebThematic} themeNote="Deep cosmos: navy void, soft nebula glows behind each cluster, ambient background stars, vignette. Each cluster has its own star color (red / green / amber / blue / violet). Anomalies wear a halo ring." />;
}

function ChartCompareBoard({ num, name, sub, desc, Plain, Themed, themeNote }) {
  return (
    <div style={{ background: cv2.paper, padding: '40px 48px', fontFamily: cv2.body, color: cv2.ink, minHeight: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 28, paddingBottom: 18, borderBottom: `1px solid ${cv2.line}` }}>
        <div>
          <div style={{ fontFamily: cv2.mono, fontSize: 11, color: cv2.accent, letterSpacing: '0.18em', textTransform: 'uppercase', marginBottom: 6 }}>
            ❋ Chart variant {num}
          </div>
          <div style={{ fontFamily: cv2.display, fontSize: 56, fontStyle: 'italic', fontWeight: 300, letterSpacing: '-0.025em', lineHeight: 1, color: cv2.ink }}>
            {name}
          </div>
          <div style={{ fontFamily: cv2.mono, fontSize: 10, color: cv2.ink3, marginTop: 6, letterSpacing: '0.08em' }}>{sub}</div>
        </div>
        <div style={{ maxWidth: 420, fontSize: 14, lineHeight: 1.55, color: cv2.ink2, fontFamily: cv2.body }}>
          {desc}
        </div>
      </div>

      {/* Plain */}
      <div style={{ marginBottom: 36 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
          <div>
            <span style={{ fontFamily: cv2.mono, fontSize: 9.5, color: cv2.ink3, letterSpacing: '0.16em', textTransform: 'uppercase' }}>A · Plain · </span>
            <span style={{ fontFamily: cv2.display, fontStyle: 'italic', fontSize: 18, color: cv2.ink }}>quiet, table-friendly</span>
          </div>
          <span style={{ fontFamily: cv2.mono, fontSize: 9, color: cv2.ink3, letterSpacing: '0.10em' }}>hero ~820 / small ~340</span>
        </div>
        <div style={{ marginBottom: 14 }}>
          <Plain width={1100} height={420} />
        </div>
        <div style={{ display: 'flex', gap: 14 }}>
          <Plain width={340} height={200} />
          <Plain width={340} height={200} />
          <Plain width={340} height={200} />
        </div>
      </div>

      {/* Thematic */}
      <div>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
          <div>
            <span style={{ fontFamily: cv2.mono, fontSize: 9.5, color: cv2.accent, letterSpacing: '0.16em', textTransform: 'uppercase' }}>B · Thematic · </span>
            <span style={{ fontFamily: cv2.display, fontStyle: 'italic', fontSize: 18, color: cv2.accentDeep }}>full motif treatment</span>
          </div>
          <span style={{ fontFamily: cv2.mono, fontSize: 9, color: cv2.ink3, letterSpacing: '0.10em', maxWidth: 460, textAlign: 'right' }}>{themeNote}</span>
        </div>
        <div style={{ marginBottom: 14 }}>
          <Themed width={1100} height={420} />
        </div>
        <div style={{ display: 'flex', gap: 14 }}>
          <Themed width={340} height={200} />
          <Themed width={340} height={200} />
          <Themed width={340} height={200} />
        </div>
      </div>
    </div>
  );
}

window.FieldBoard = FieldBoard;
window.SkyDomeBoard = SkyDomeBoard;
window.CosmicWebBoard = CosmicWebBoard;
