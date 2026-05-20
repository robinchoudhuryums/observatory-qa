/* global React */
/* eslint-disable */
// =============================================================================
//  Observatory — Clinical presentation mode
//  ---------------------------------------------------------------------------
//  Same data, same theme tokens, same screen IA — but the thematic layer
//  (planets, orbits, starfield, metaphor copy) is replaced with a quieter,
//  chart-first clinical presentation. Ory persona STAYS (mascot intact);
//  only the assistant's tone shifts to more clinical in the panel.
//
//  Exposes:
//    clinicalLex(key)                  — observatory → clinical term map
//    <ClinicalHero …>                  — dispatcher (swimlane | scatter | bars)
//    <ClinicalSwimlaneHero …>          — bubble chart, 4 cluster lanes
//    <ClinicalScatterHero …>           — Volume × Close-rate quadrant
//    <ClinicalBarsHero …>              — twin-bar matrix (volume + close)
//    <ClinicalAssistFab …>             — (legacy, unused — kept for option C)
//    <ClinicalSignature …>             — replacement for <OwlSignature>
//    <PresentationBadge …>             — small chrome indicator
// =============================================================================

const { useState: useStateCM, useMemo: useMemoCM } = React;

// ---------- Lexicon ----------
const LEX = {
  'atlas':         { obs: 'Atlas',         clin: 'Dashboard'   },
  'galaxy':        { obs: 'Galaxy',        clin: 'Segments'    },
  'patterns':      { obs: 'Patterns',      clin: 'Trends'      },
  'calls':         { obs: 'Calls',         clin: 'Calls'       },
  'reports':       { obs: 'Reports',       clin: 'Reports'     },
  'planet':        { obs: 'planet',        clin: 'cluster'     },
  'planets':       { obs: 'planets',       clin: 'clusters'    },
  'orbit':         { obs: 'orbit',         clin: 'category'    },
  'constellation': { obs: 'constellation', clin: 'pattern'     },
  'sky':           { obs: 'sky',           clin: 'day'         },
  'anchor':        { obs: 'anchor',        clin: 'top driver'  },
  'brightest':     { obs: 'brightest',     clin: 'highest-closing' },
  'observatory':   { obs: 'Observatory',   clin: 'Observatory' },
  'observing':     { obs: 'OBSERVING',     clin: 'MONITORING'  },
  'waiting':       { obs: 'WAITING',       clin: 'STANDING BY' },
  'noted':         { obs: 'NOTED',         clin: 'FLAGGED'     },
  'Ory':       { obs: 'Ory',       clin: 'AI Assist'   },
  'ask Ory':   { obs: 'Ask Ory',   clin: 'Ask Observatory' },
};

function clinicalLex(key, mode = 'observatory') {
  const k = String(key).toLowerCase().trim();
  const e = LEX[k];
  if (!e) return key;
  return mode === 'clinical' ? e.clin : e.obs;
}

// ---------- Chrome indicator ----------
function PresentationBadge({ t, mode = 'observatory', onClick = null }) {
  const isClinical = mode === 'clinical';
  return (
    <button
      onClick={onClick}
      style={{
        padding: '5px 10px',
        borderRadius: 6,
        background: isClinical ? `${t.inkSoft}14` : `${t.bright}18`,
        border: `0.5px solid ${isClinical ? t.panelBorder : `${t.bright}40`}`,
        fontSize: 10,
        color: isClinical ? t.inkSoft : t.bright,
        fontFamily: "'JetBrains Mono', monospace",
        letterSpacing: '0.12em',
        cursor: onClick ? 'pointer' : 'default',
        display: 'inline-flex', alignItems: 'center', gap: 6,
      }}
    >
      <span style={{
        width: 6, height: 6, borderRadius: '50%',
        background: isClinical ? t.inkMute : t.bright,
      }} />
      {isClinical ? 'CLINICAL' : 'OBSERVATORY'}
    </button>
  );
}

// ---------- In-chrome hero picker (clinical mode only) ----------
//  Tiny 3-segment pill that lets the reviewer flip between hero variants
//  without opening Tweaks. Production: this UI would not ship — hero choice
//  would be a one-time onboarding selection or role-derived default.
function HeroPicker({ t, value = 'swimlane', onChange = null }) {
  const opts = [
    { v: 'swimlane', l: 'Swim' },
    { v: 'scatter',  l: 'Scatter' },
    { v: 'bars',     l: 'Bars' },
  ];
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 1,
      padding: 2, borderRadius: 6,
      background: t.name === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(20,30,60,0.05)',
      border: `0.5px solid ${t.panelBorder}`,
    }}>
      <span style={{
        fontFamily: "'JetBrains Mono', monospace", fontSize: 9,
        letterSpacing: '0.12em', color: t.inkMute,
        padding: '0 6px 0 4px',
      }}>HERO</span>
      {opts.map((o) => {
        const active = value === o.v;
        return (
          <button
            key={o.v}
            onClick={() => onChange && onChange(o.v)}
            style={{
              padding: '3px 8px', borderRadius: 4, border: 'none',
              background: active
                ? (t.name === 'dark' ? 'rgba(255,255,255,0.08)' : '#fff')
                : 'transparent',
              boxShadow: active && t.name !== 'dark' ? '0 1px 2px rgba(20,30,60,0.08)' : 'none',
              color: active ? t.ink : t.inkSoft,
              fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5,
              letterSpacing: '0.08em',
              cursor: 'pointer',
              fontWeight: active ? 600 : 500,
            }}
          >{o.l}</button>
        );
      })}
    </div>
  );
}

// ---------- Clinical assist FAB (legacy — kept for option C) ----------
function ClinicalAssistFab({ t, signal = false, onClick }) {
  return (
    <button
      onClick={onClick}
      aria-label="Ask Observatory"
      style={{
        position: 'fixed', right: 22, bottom: 22, zIndex: 90,
        height: 42, padding: '0 16px 0 14px',
        borderRadius: 21,
        background: t.name === 'dark' ? 'rgba(20,30,60,0.92)' : '#fff',
        border: `0.5px solid ${t.panelBorder}`,
        boxShadow: t.name === 'dark'
          ? '0 10px 28px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.02)'
          : '0 8px 22px rgba(20,30,60,0.18)',
        display: 'flex', alignItems: 'center', gap: 10,
        cursor: 'pointer',
        fontFamily: '"Inter", system-ui, sans-serif',
        color: t.ink,
      }}
    >
      <span style={{
        width: 8, height: 8, borderRadius: '50%',
        background: signal ? t.bright : t.inkMute,
        boxShadow: signal ? `0 0 0 3px ${t.bright}33` : 'none',
      }} />
      <span style={{ fontSize: 13, fontWeight: 500 }}>Ask</span>
      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, color: t.inkMute, letterSpacing: '0.14em' }}>AI</span>
    </button>
  );
}

// ---------- Clinical signature (replaces OwlSignature) ----------
function ClinicalSignature({ t, verb = 'FLAGGED', timestamp = null, confidence = null }) {
  const cColor = confidence === 'high' ? t.bright : confidence === 'med' ? t.amber : t.red;
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5,
        color: t.inkSoft, letterSpacing: '0.14em',
      }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: t.bright }} />
        AI ASSIST · {verb}
      </span>
      {timestamp && (
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, color: t.inkMute, letterSpacing: '0.14em' }}>
          · {timestamp}
        </span>
      )}
      {confidence && (
        <span style={{
          fontFamily: "'JetBrains Mono', monospace", fontSize: 9, letterSpacing: '0.12em',
          color: cColor, padding: '2px 6px', borderRadius: 3,
          border: `0.5px solid ${cColor}55`, background: `${cColor}10`,
        }}>
          {confidence.toUpperCase()} CONF
        </span>
      )}
    </div>
  );
}

// =============================================================================
//  Shared hero scaffold — flex column with legend / chart / scrubber
//  ---------------------------------------------------------------------------
//  Replaces the absolute-position scrubber/legend pattern. Each hero plugs its
//  own SVG into the middle slot.
// =============================================================================

function HeroShell({ t, legend, children, footer }) {
  return (
    <div style={{
      position: 'relative',
      borderRadius: 14,
      background: t.panel, backdropFilter: 'blur(8px)',
      border: `0.5px solid ${t.panelBorder}`,
      overflow: 'hidden',
      width: '100%',
      // Bound the hero intrinsically so the SVG can't stretch to fill an
      // unbounded grid cell when the right rail is tall. Aspect matches
      // viewBox (116:64 ≈ 1.8125) so SVG content lands without letterbox.
      aspectRatio: '116 / 64',
      maxHeight: 460,
      alignSelf: 'flex-start',
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{
        padding: '12px 16px 6px',
        display: 'flex', justifyContent: 'flex-end', gap: 12,
        fontSize: 9.5, color: t.inkSoft,
        fontFamily: "'JetBrains Mono', monospace",
        alignItems: 'center', letterSpacing: '0.08em',
      }}>
        {legend}
      </div>
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        {children}
      </div>
      <div style={{ padding: '8px 16px 14px' }}>
        {footer}
      </div>
    </div>
  );
}

function HourScrubber({ t, scrubHour, setScrubHour }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <span style={{
        fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5,
        letterSpacing: '0.12em', textTransform: 'uppercase', color: t.inkSoft,
      }}>HOUR</span>
      <div style={{ flex: 1, position: 'relative', height: 18, display: 'flex', alignItems: 'center' }}>
        <div style={{ position: 'absolute', left: 0, right: 0, height: 1, background: t.panelBorder }} />
        {Array.from({ length: 15 }).map((_, i) => {
          const hour = 6 + i;
          return (
            <div key={i} style={{
              position: 'absolute', left: `${(i / 14) * 100}%`,
              top: scrubHour === hour ? 0 : 6, bottom: scrubHour === hour ? 0 : 6,
              width: 1, background: scrubHour === hour ? t.bright : t.inkMute,
              opacity: scrubHour === hour ? 1 : 0.4, transition: 'all 200ms',
            }} />
          );
        })}
        <input
          type="range" min={6} max={20} step={1} value={scrubHour}
          onChange={(e) => setScrubHour(parseInt(e.target.value))}
          style={{ position: 'absolute', inset: 0, width: '100%', opacity: 0, cursor: 'pointer', margin: 0 }}
        />
      </div>
      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: t.bright, minWidth: 50, textAlign: 'right' }}>
        {String(scrubHour).padStart(2, '0')}:00
      </span>
    </div>
  );
}

// Shared color ramp by close rate (matches orrery brightToColor).
const fillByClose = (br, t) => {
  if (br > 0.8) return t.bright;
  if (br > 0.65) return t.warm;
  if (br > 0.5) return t.cool;
  if (br > 0.35) return t.cold;
  return t.ice;
};

// Hover tooltip (shared, themed)
function HoverCard({ t, x, y, p, label, position = 'right' }) {
  return (
    <div style={{
      position: 'absolute',
      left: position === 'right' ? `calc(${x}% + 14px)` : `calc(${x}% - 250px)`,
      top: `calc(${y}% - 30px)`,
      maxWidth: 230,
      background: t.name === 'dark' ? 'rgba(12,21,56,0.94)' : '#fff',
      backdropFilter: 'blur(12px)',
      borderRadius: 8, padding: '11px 13px',
      fontSize: 11, lineHeight: 1.45,
      boxShadow: t.name === 'dark'
        ? '0 12px 36px rgba(0,0,0,0.5)'
        : '0 8px 22px rgba(20,30,60,0.16)',
      border: `0.5px solid ${t.panelBorder}`,
      pointerEvents: 'none', color: t.ink, zIndex: 5,
    }}>
      <span style={{
        fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5,
        letterSpacing: '0.12em', textTransform: 'uppercase', color: t.bright,
      }}>{label}</span>
      <div style={{ fontFamily: '"Inter", system-ui, sans-serif', fontSize: 17, marginTop: 3, lineHeight: 1.15, fontWeight: 500 }}>{p.label}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 8, fontSize: 10.5 }}>
        <div><div style={{ color: t.inkMute, fontFamily: "'JetBrains Mono', monospace", fontSize: 9 }}>CALLS</div><div style={{ fontSize: 16, fontWeight: 500 }}>{p.ct}</div></div>
        <div><div style={{ color: t.inkMute, fontFamily: "'JetBrains Mono', monospace", fontSize: 9 }}>SCORE</div><div style={{ fontSize: 16, fontWeight: 500 }}>{p.score}</div></div>
        <div><div style={{ color: t.inkMute, fontFamily: "'JetBrains Mono', monospace", fontSize: 9 }}>CLOSE</div><div style={{ fontSize: 16, fontWeight: 500 }}>{Math.round(p.br * 100)}%</div></div>
      </div>
    </div>
  );
}

function FocusedCard({ t, orbits, focused, onClose, onOpen, valueLabel = 'Open cluster →' }) {
  return (
    <div style={{
      position: 'absolute', left: 18, top: 18, maxWidth: 280,
      background: t.name === 'dark' ? 'rgba(12,21,56,0.94)' : '#fff',
      backdropFilter: 'blur(12px)',
      borderRadius: 10, padding: '14px 16px',
      boxShadow: t.name === 'dark' ? '0 16px 40px rgba(0,0,0,0.55)' : '0 10px 28px rgba(20,30,60,0.18)',
      border: `0.5px solid ${t.panelBorder}`, color: t.ink, zIndex: 6,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <span style={{
          fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5,
          letterSpacing: '0.12em', textTransform: 'uppercase', color: t.bright,
        }}>FOCUSED · {orbits[focused.o].label.split(' · ')[0]}</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: t.inkMute, cursor: 'pointer', fontSize: 14, padding: 0, lineHeight: 1 }}>×</button>
      </div>
      <div style={{ fontFamily: '"Inter", system-ui, sans-serif', fontSize: 22, marginTop: 4, fontWeight: 500 }}>{focused.label}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginTop: 10, fontSize: 11 }}>
        {[
          ['CALLS', focused.ct],
          ['SCORE', focused.score],
          ['CLOSE', `${Math.round(focused.br * 100)}%`],
        ].map(([l, v], i) => (
          <div key={i}>
            <div style={{ color: t.inkMute, fontFamily: "'JetBrains Mono', monospace", fontSize: 9 }}>{l}</div>
            <div style={{ fontSize: 18, fontWeight: 500 }}>{v}</div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 10, paddingTop: 10, borderTop: `0.5px solid ${t.panelBorder}`, fontSize: 11, lineHeight: 1.4, color: t.inkSoft }}>
        {focused.hot && 'Top driver of the day — highest close rate × volume in this category.'}
        {focused.coaching && 'High volume, low close rate. Likely coaching opportunity.'}
        {focused.anomaly && 'Unusual volume vs. trailing 30-day baseline (+2.4σ).'}
        {!focused.hot && !focused.coaching && !focused.anomaly && 'Steady cluster. Tracking close to last week.'}
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
        <button onClick={onOpen} style={{ flex: 1, padding: '7px 0', borderRadius: 6, border: 'none', background: t.ink, color: t.bgFlat, fontSize: 11, fontWeight: 500, cursor: 'pointer' }}>{valueLabel}</button>
        <button style={{ flex: 1, padding: '7px 0', borderRadius: 6, background: 'transparent', color: t.ink, border: `0.5px solid ${t.panelBorder}`, fontSize: 11, fontWeight: 500, cursor: 'pointer' }}>Coach</button>
      </div>
    </div>
  );
}

const closeLegend = (t) => (
  <>
    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 9, height: 9, background: t.bright, borderRadius: '50%' }} />HIGH CLOSE</span>
    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 9, height: 9, background: t.cool, borderRadius: '50%' }} />MED</span>
    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 9, height: 9, background: t.cold, borderRadius: '50%' }} />LOW</span>
    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 9, height: 9, border: `1px dashed ${t.amber}`, borderRadius: '50%' }} />ANOMALY</span>
  </>
);

// =============================================================================
//  A. SWIMLANE BUBBLE HERO (fixed)
//  ---------------------------------------------------------------------------
//  4 horizontal lanes (one per category). Bubbles laid out left→right by
//  volume rank within the lane. Volume → bubble size, close rate → fill,
//  anchor → ring + label, anomaly → dashed amber, coaching → hollow.
// =============================================================================

function ClinicalSwimlaneHero({ t, planets, orbits, onNavigate, scrubHour, setScrubHour }) {
  const [hovered, setHovered] = useStateCM(null);
  const [selected, setSelected] = useStateCM(null);

  // viewBox matches orrery aspect (1.8125) so the hero feels the same size.
  const W = 116, H = 64;
  const PAD = { t: 4, r: 8, b: 4, l: 24 };
  const innerW = W - PAD.l - PAD.r;     // 84
  const innerH = H - PAD.t - PAD.b;     // 56
  const laneH = innerH / orbits.length; // ~14 per lane

  const lanes = orbits.map((o, laneIdx) => ({
    ...o, laneIdx,
    items: planets
      .map((p, idx) => ({ ...p, idx }))
      .filter((p) => p.o === laneIdx)
      .sort((a, b) => a.ct - b.ct),
  }));

  const maxVol = Math.max(1, ...planets.map((p) => p.ct));
  const projected = [];
  lanes.forEach((lane) => {
    const n = lane.items.length;
    lane.items.forEach((p, k) => {
      const tx = n <= 1 ? 0.55 : 0.10 + (k / (n - 1)) * 0.85;
      const px = PAD.l + tx * innerW;
      const yOff = (Math.sin(p.a) * 0.12) * laneH;
      const py = PAD.t + lane.laneIdx * laneH + laneH * 0.5 + yOff;
      const r = 1.6 + (p.ct / maxVol) * 4.2;
      projected.push({ ...p, px, py, sz: r, laneIdx: lane.laneIdx });
    });
  });

  const hot = projected.find((p) => p.hot);
  const focused = selected !== null ? projected.find((p) => p.idx === selected) : null;
  const tipPlanet = hovered !== null ? projected.find((p) => p.idx === hovered) : null;

  return (
    <HeroShell t={t}
      legend={closeLegend(t)}
      footer={<HourScrubber t={t} scrubHour={scrubHour} setScrubHour={setScrubHour} />}
    >
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
        {/* X gridlines */}
        {[0.25, 0.5, 0.75, 1.0].map((q, i) => (
          <line key={i}
            x1={PAD.l + q * innerW} y1={PAD.t}
            x2={PAD.l + q * innerW} y2={PAD.t + innerH}
            stroke={t.orbit} strokeWidth="0.08" strokeDasharray="0.4 0.4" />
        ))}
        <line x1={PAD.l} y1={PAD.t} x2={PAD.l} y2={PAD.t + innerH}
          stroke={t.panelBorder} strokeWidth="0.12" />

        {/* Lane labels + separators */}
        {lanes.map((lane, i) => {
          const yTop = PAD.t + i * laneH;
          const yMid = yTop + laneH * 0.5;
          const total = lane.items.reduce((s, p) => s + p.ct, 0);
          // Strip the orbital-position prefix (INNER/MID/OUTER/FAR) — keep only
          // the category name. Lifecycle labels have no ' · ' separator.
          const parts = lane.label.split(' · ');
          const primary = (parts.length > 1 ? parts[1] : parts[0]).toUpperCase();
          return (
            <g key={lane.label}>
              {i > 0 && (
                <line x1={PAD.l} y1={yTop} x2={W - PAD.r} y2={yTop}
                  stroke={t.panelBorder} strokeWidth="0.08" strokeDasharray="0.3 0.3" />
              )}
              <text x={PAD.l - 1.6} y={yMid + 0.55}
                textAnchor="end" fontFamily="'JetBrains Mono', monospace" fontSize="1.8"
                fill={t.inkSoft} letterSpacing="0.1" fontWeight="500">{primary}</text>
              <text x={W - PAD.r + 0.5} y={yMid + 0.5}
                fontFamily="'JetBrains Mono', monospace" fontSize="1.5"
                fill={t.inkMute} letterSpacing="0.1">{total}</text>
            </g>
          );
        })}

        <text x={W - PAD.r} y={H - 0.8}
          textAnchor="end" fontFamily="'JetBrains Mono', monospace" fontSize="1.4"
          fill={t.inkMute} letterSpacing="0.1">VOLUME →</text>

        {/* Bubbles */}
        {projected.map((p) => {
          const isHovered = hovered === p.idx;
          const isFocused = focused && focused.idx === p.idx;
          const dim = focused && !isFocused;
          const fill = fillByClose(p.br, t);
          return (
            <g key={p.idx}
              onMouseEnter={() => setHovered(p.idx)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => setSelected(selected === p.idx ? null : p.idx)}
              style={{ cursor: 'pointer', opacity: dim ? 0.3 : 1, transition: 'opacity 200ms' }}
            >
              {p.coaching && !p.hot && (
                <circle cx={p.px} cy={p.py} r={p.sz} fill="none" stroke={fill} strokeWidth="0.3" opacity="0.85" />
              )}
              {!p.coaching && (
                <circle cx={p.px} cy={p.py} r={p.sz} fill={fill}
                  opacity={t.name === 'dark' ? 0.92 : 0.86} />
              )}
              {p.hot && (
                <>
                  <circle cx={p.px} cy={p.py} r={p.sz + 0.7} fill="none" stroke={t.bright} strokeWidth="0.28" />
                  <circle cx={p.px} cy={p.py} r={p.sz * 0.32} fill={t.starCore} opacity="0.55" />
                </>
              )}
              {p.anomaly && (
                <circle cx={p.px} cy={p.py} r={p.sz + 0.4} fill="none"
                  stroke={t.amber} strokeWidth="0.22" strokeDasharray="0.6 0.4" />
              )}
              {isHovered && !isFocused && (
                <circle cx={p.px} cy={p.py} r={p.sz + 0.9} fill="none" stroke={t.bright} strokeWidth="0.18" opacity="0.8" />
              )}
              {p.hot && !isHovered && !focused && (
                <text x={p.px} y={p.py + p.sz + 2.4}
                  textAnchor="middle" fontFamily="'Inter', system-ui, sans-serif" fontSize="1.7"
                  fontStyle="italic" fill={t.ink}>{p.label}</text>
              )}
            </g>
          );
        })}
      </svg>

      {tipPlanet && !focused && (
        <HoverCard t={t}
          x={(tipPlanet.px / W) * 100} y={(tipPlanet.py / H) * 100}
          p={tipPlanet}
          label={tipPlanet.hot ? '◆ TOP DRIVER' : tipPlanet.coaching ? 'COACHING OPPORTUNITY' : tipPlanet.anomaly ? 'ANOMALY · UNUSUAL VOLUME' : 'CLUSTER'} />
      )}
      {focused && (
        <FocusedCard t={t} orbits={orbits} focused={focused}
          onClose={() => setSelected(null)}
          onOpen={() => onNavigate && onNavigate('planet', { planetId: focused.idx, planetLabel: focused.label })} />
      )}
      {hot && !focused && !tipPlanet && (
        <div style={{ position: 'absolute', right: 18, top: 14, maxWidth: 220 }}>
          <div style={{
            background: t.name === 'dark' ? 'rgba(12,21,56,0.92)' : '#fff',
            borderRadius: 8, padding: '9px 12px', fontSize: 11,
            boxShadow: t.name === 'dark' ? '0 8px 22px rgba(0,0,0,0.5)' : '0 8px 20px rgba(20,30,60,0.14)',
            border: `0.5px solid ${t.panelBorder}`, color: t.ink,
          }}>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: t.bright }}>◆ TOP DRIVER</span>
            <div style={{ marginTop: 3, lineHeight: 1.4 }}>
              <strong style={{ fontWeight: 600 }}>{hot.label}</strong> — {hot.ct} calls · {Math.round(hot.br * 100)}% close.
            </div>
          </div>
        </div>
      )}
    </HeroShell>
  );
}

// =============================================================================
//  B. SCATTER HERO  —  Volume × Close-rate quadrant
//  ---------------------------------------------------------------------------
//  Classic BI quadrant. X = call volume, Y = close rate %. Bubble size = score,
//  bubble color = lane (category). Top-right = top drivers; bottom-right =
//  coaching opportunities (high volume × low close); bottom-left = low impact.
// =============================================================================

const LANE_COLORS = (t) => [t.bright, t.warm, t.cool, t.cold];

function ClinicalScatterHero({ t, planets, orbits, onNavigate, scrubHour, setScrubHour }) {
  const [hovered, setHovered] = useStateCM(null);
  const [selected, setSelected] = useStateCM(null);

  const W = 116, H = 64;
  const PAD = { t: 6, r: 6, b: 8, l: 14 };
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;

  const laneColors = LANE_COLORS(t);
  const maxVol = Math.max(1, ...planets.map((p) => p.ct));
  const projected = planets.map((p, idx) => {
    const xn = p.ct / maxVol;
    const yn = p.br;
    const px = PAD.l + xn * innerW;
    // y axis inverted (high close at top)
    const py = PAD.t + (1 - yn) * innerH;
    const sz = 1.4 + (p.score / 10) * 3.2;
    return { ...p, idx, px, py, sz };
  });

  const hot = projected.find((p) => p.hot);
  const focused = selected !== null ? projected.find((p) => p.idx === selected) : null;
  const tipPlanet = hovered !== null ? projected.find((p) => p.idx === hovered) : null;

  // Y axis ticks at 25/50/75/100%
  const yTicks = [0, 0.25, 0.5, 0.75, 1.0];

  return (
    <HeroShell t={t}
      legend={
        <>
          {orbits.map((o, i) => (
            <span key={o.label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 9, height: 9, background: laneColors[i], borderRadius: '50%' }} />
              {o.label.split(' · ')[1] || o.label}
            </span>
          ))}
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 9, height: 9, border: `1px dashed ${t.amber}`, borderRadius: '50%' }} />ANOMALY
          </span>
        </>
      }
      footer={<HourScrubber t={t} scrubHour={scrubHour} setScrubHour={setScrubHour} />}
    >
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
        {/* Quadrant background tint: top-right is "top driver" zone */}
        <rect x={PAD.l + innerW * 0.55} y={PAD.t}
          width={innerW * 0.45} height={innerH * 0.45}
          fill={t.bright} opacity={t.name === 'dark' ? 0.04 : 0.05} />
        {/* Bottom-right is "coaching" zone */}
        <rect x={PAD.l + innerW * 0.55} y={PAD.t + innerH * 0.55}
          width={innerW * 0.45} height={innerH * 0.45}
          fill={t.amber} opacity={t.name === 'dark' ? 0.04 : 0.04} />

        {/* Y gridlines + labels */}
        {yTicks.map((q, i) => (
          <g key={i}>
            <line x1={PAD.l} y1={PAD.t + (1 - q) * innerH}
              x2={W - PAD.r} y2={PAD.t + (1 - q) * innerH}
              stroke={t.orbit} strokeWidth="0.08" strokeDasharray={q === 0.5 ? '0' : '0.4 0.4'}
              opacity={q === 0.5 ? 0.6 : 1} />
            <text x={PAD.l - 1.2} y={PAD.t + (1 - q) * innerH + 0.6}
              textAnchor="end" fontFamily="'JetBrains Mono', monospace" fontSize="1.4"
              fill={t.inkMute} letterSpacing="0.06">{Math.round(q * 100)}</text>
          </g>
        ))}
        {/* X gridlines */}
        {[0.25, 0.5, 0.75, 1.0].map((q, i) => (
          <line key={i} x1={PAD.l + q * innerW} y1={PAD.t}
            x2={PAD.l + q * innerW} y2={PAD.t + innerH}
            stroke={t.orbit} strokeWidth="0.06" strokeDasharray="0.3 0.5" opacity="0.7" />
        ))}
        {/* Axes */}
        <line x1={PAD.l} y1={PAD.t} x2={PAD.l} y2={PAD.t + innerH}
          stroke={t.panelBorder} strokeWidth="0.14" />
        <line x1={PAD.l} y1={PAD.t + innerH} x2={W - PAD.r} y2={PAD.t + innerH}
          stroke={t.panelBorder} strokeWidth="0.14" />
        {/* Axis labels */}
        <text x={W - PAD.r} y={PAD.t + innerH + 4}
          textAnchor="end" fontFamily="'JetBrains Mono', monospace" fontSize="1.5"
          fill={t.inkSoft} letterSpacing="0.1">VOLUME · CALLS →</text>
        <text x={PAD.l + 0.4} y={PAD.t - 1.2}
          textAnchor="start" fontFamily="'JetBrains Mono', monospace" fontSize="1.5"
          fill={t.inkSoft} letterSpacing="0.1">CLOSE RATE %</text>

        {/* Quadrant labels (subtle) */}
        <text x={W - PAD.r - 0.8} y={PAD.t + 2.5}
          textAnchor="end" fontFamily="'JetBrains Mono', monospace" fontSize="1.3"
          fill={t.bright} opacity="0.7" letterSpacing="0.12">TOP DRIVERS</text>
        <text x={W - PAD.r - 0.8} y={PAD.t + innerH - 1.4}
          textAnchor="end" fontFamily="'JetBrains Mono', monospace" fontSize="1.3"
          fill={t.amber} opacity="0.75" letterSpacing="0.12">COACHING OPPS</text>

        {/* Bubbles */}
        {projected.map((p) => {
          const isHovered = hovered === p.idx;
          const isFocused = focused && focused.idx === p.idx;
          const dim = focused && !isFocused;
          const color = laneColors[p.o] || t.bright;
          return (
            <g key={p.idx}
              onMouseEnter={() => setHovered(p.idx)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => setSelected(selected === p.idx ? null : p.idx)}
              style={{ cursor: 'pointer', opacity: dim ? 0.3 : 1, transition: 'opacity 200ms' }}
            >
              {p.coaching && !p.hot && (
                <circle cx={p.px} cy={p.py} r={p.sz} fill="none" stroke={color} strokeWidth="0.32" />
              )}
              {!p.coaching && (
                <circle cx={p.px} cy={p.py} r={p.sz} fill={color}
                  opacity={t.name === 'dark' ? 0.88 : 0.82} />
              )}
              {p.hot && (
                <>
                  <circle cx={p.px} cy={p.py} r={p.sz + 0.7} fill="none" stroke={t.bright} strokeWidth="0.3" />
                  <circle cx={p.px} cy={p.py} r={p.sz * 0.3} fill={t.starCore} opacity="0.55" />
                </>
              )}
              {p.anomaly && (
                <circle cx={p.px} cy={p.py} r={p.sz + 0.4} fill="none"
                  stroke={t.amber} strokeWidth="0.24" strokeDasharray="0.6 0.4" />
              )}
              {isHovered && !isFocused && (
                <circle cx={p.px} cy={p.py} r={p.sz + 0.9} fill="none" stroke={t.bright} strokeWidth="0.2" opacity="0.85" />
              )}
              {/* Always-on small label for hot + anomaly + coaching */}
              {(p.hot || p.anomaly || p.coaching) && !isHovered && !focused && (
                <text x={p.px} y={p.py - p.sz - 0.8}
                  textAnchor="middle" fontFamily="'Inter', system-ui, sans-serif" fontSize="1.6"
                  fill={t.ink} fontWeight="500">{p.label}</text>
              )}
            </g>
          );
        })}
      </svg>

      {tipPlanet && !focused && (
        <HoverCard t={t}
          x={(tipPlanet.px / W) * 100} y={(tipPlanet.py / H) * 100}
          p={tipPlanet}
          position={tipPlanet.px > W * 0.65 ? 'left' : 'right'}
          label={tipPlanet.hot ? '◆ TOP DRIVER' : tipPlanet.coaching ? 'COACHING OPPORTUNITY' : tipPlanet.anomaly ? 'ANOMALY · UNUSUAL VOLUME' : `${orbits[tipPlanet.o].label.split(' · ')[1] || 'CLUSTER'}`} />
      )}
      {focused && (
        <FocusedCard t={t} orbits={orbits} focused={focused}
          onClose={() => setSelected(null)}
          onOpen={() => onNavigate && onNavigate('planet', { planetId: focused.idx, planetLabel: focused.label })} />
      )}
    </HeroShell>
  );
}

// =============================================================================
//  C. BARS HERO  —  Twin-bar matrix (volume + close-rate)
//  ---------------------------------------------------------------------------
//  One row per cluster, sorted by volume desc. Twin horizontal bars: gray
//  volume bar (top) + colored close-rate bar (bottom). Anchor row has a
//  small "◆ TOP" tag and brighter close bar. Anomaly row gets an amber dot.
// =============================================================================

function ClinicalBarsHero({ t, planets, orbits, onNavigate, scrubHour, setScrubHour }) {
  const [hovered, setHovered] = useStateCM(null);
  const [selected, setSelected] = useStateCM(null);

  const sorted = useMemoCM(() => planets
    .map((p, idx) => ({ ...p, idx }))
    .sort((a, b) => b.ct - a.ct), [planets]);

  const maxVol = Math.max(1, ...sorted.map((p) => p.ct));
  const focused = selected !== null ? sorted.find((p) => p.idx === selected) : null;

  return (
    <HeroShell t={t}
      legend={closeLegend(t)}
      footer={<HourScrubber t={t} scrubHour={scrubHour} setScrubHour={setScrubHour} />}
    >
      <div style={{
        position: 'absolute', inset: 0,
        padding: '8px 18px 4px',
        display: 'flex', flexDirection: 'column', gap: 4,
        overflow: 'hidden',
      }}>
        {/* Header row */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '160px 70px 1fr 70px',
          gap: 12,
          padding: '4px 0 6px',
          borderBottom: `0.5px solid ${t.panelBorder}`,
          fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5,
          color: t.inkMute, letterSpacing: '0.12em',
        }}>
          <span>CLUSTER</span>
          <span style={{ textAlign: 'right' }}>CALLS</span>
          <span>VOLUME · CLOSE RATE</span>
          <span style={{ textAlign: 'right' }}>CLOSE</span>
        </div>

        {sorted.map((p) => {
          const isHovered = hovered === p.idx;
          const isFocused = focused && focused.idx === p.idx;
          const dim = focused && !isFocused;
          const volPct = (p.ct / maxVol) * 100;
          const closePct = p.br * 100;
          const closeColor = fillByClose(p.br, t);
          const laneLabel = (orbits[p.o].label.split(' · ')[1] || orbits[p.o].label).toUpperCase();
          return (
            <div key={p.idx}
              onMouseEnter={() => setHovered(p.idx)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => setSelected(selected === p.idx ? null : p.idx)}
              style={{
                display: 'grid',
                gridTemplateColumns: '160px 70px 1fr 70px',
                gap: 12, alignItems: 'center',
                padding: '5px 8px', borderRadius: 6,
                background: isHovered || isFocused
                  ? (t.name === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(20,30,60,0.04)')
                  : 'transparent',
                opacity: dim ? 0.4 : 1,
                transition: 'all 180ms',
                cursor: 'pointer',
              }}>
              {/* Cluster cell */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                {p.hot && (
                  <span style={{
                    fontFamily: "'JetBrains Mono', monospace", fontSize: 8.5,
                    color: t.bright, letterSpacing: '0.1em',
                    padding: '2px 5px', borderRadius: 3,
                    border: `0.5px solid ${t.bright}55`, background: `${t.bright}12`,
                    flexShrink: 0,
                  }}>◆ TOP</span>
                )}
                {p.anomaly && (
                  <span style={{
                    width: 7, height: 7, borderRadius: '50%',
                    border: `1px dashed ${t.amber}`, flexShrink: 0,
                  }} />
                )}
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: t.ink, fontWeight: 500, lineHeight: 1.15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {p.label}
                  </div>
                  <div style={{ fontSize: 9.5, color: t.inkMute, fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.08em', marginTop: 1 }}>
                    {laneLabel}
                  </div>
                </div>
              </div>

              {/* Volume number */}
              <div style={{ fontFamily: '"Inter", system-ui, sans-serif', fontSize: 16, fontWeight: 500, color: t.ink, textAlign: 'right' }}>
                {p.ct}
              </div>

              {/* Twin bars */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {/* Volume (gray) */}
                <div style={{ position: 'relative', height: 6, background: t.name === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(20,30,60,0.05)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{
                    position: 'absolute', left: 0, top: 0, bottom: 0,
                    width: `${volPct}%`, background: t.inkSoft, opacity: 0.5,
                  }} />
                </div>
                {/* Close (colored) */}
                <div style={{ position: 'relative', height: 6, background: t.name === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(20,30,60,0.05)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{
                    position: 'absolute', left: 0, top: 0, bottom: 0,
                    width: `${closePct}%`, background: closeColor,
                  }} />
                  {p.coaching && (
                    <div style={{
                      position: 'absolute', left: `${closePct}%`, top: -1, bottom: -1,
                      width: 2, background: t.amber, opacity: 0.7,
                    }} />
                  )}
                </div>
              </div>

              {/* Close % */}
              <div style={{ fontFamily: '"Inter", system-ui, sans-serif', fontSize: 14, fontWeight: 500, color: t.ink, textAlign: 'right' }}>
                {Math.round(closePct)}%
                {p.coaching && (
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 8, color: t.amber, letterSpacing: '0.1em', marginTop: 1 }}>COACHING</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {focused && (
        <FocusedCard t={t} orbits={orbits} focused={focused}
          onClose={() => setSelected(null)}
          onOpen={() => onNavigate && onNavigate('planet', { planetId: focused.idx, planetLabel: focused.label })} />
      )}
    </HeroShell>
  );
}

// =============================================================================
//  Dispatcher
// =============================================================================
function ClinicalHero({ variant = 'swimlane', ...rest }) {
  if (variant === 'scatter') return <ClinicalScatterHero {...rest} />;
  if (variant === 'bars')    return <ClinicalBarsHero {...rest} />;
  return <ClinicalSwimlaneHero {...rest} />;
}

Object.assign(window, {
  clinicalLex,
  PresentationBadge,
  HeroPicker,
  ClinicalAssistFab,
  ClinicalSignature,
  ClinicalSwimlaneHero,
  ClinicalScatterHero,
  ClinicalBarsHero,
  ClinicalHero,
});
