/* global React */
/* eslint-disable */
// =============================================================================
//  Orrery World — shared primitives, theme tokens, projection helpers
//  Used by all 5 Orrery screens.
// =============================================================================

const { useState, useEffect, useRef, useMemo } = React;

// ---------- Theme tokens ----------
const ORRERY_LIGHT = {
  name: 'light',
  bg: 'linear-gradient(180deg, #f8faff 0%, #eef2f8 100%)',
  bgFlat: '#f4f6fb',
  panel: 'rgba(255,255,255,0.72)',
  panelBorder: 'rgba(20,30,60,0.06)',
  panelStroke: 'rgba(20,30,60,0.04)',
  ink: '#0e1228',
  inkSoft: '#3c4566',
  inkMute: '#7a8198',
  haloBg: 'rgba(34,184,207,0.22)',
  starCore: '#ffffff',
  starGlow1: '#a7e6f0',
  starGlow2: '#22b8cf',
  starOuter: '#0892a8',
  orbit: 'rgba(20,30,60,0.10)',
  orbitTick: 'rgba(20,30,60,0.20)',
  bright: '#0892a8',
  warm: '#22b8cf',
  cool: '#9ee5ed',
  cold: '#cdedf2',
  ice: '#e6f8fb',
  shadow: 'rgba(20,30,60,0.18)',
  highlight: 'rgba(255,255,255,0.65)',
  starfield: '#0e1228',
  starfieldOpacity: 0.10,
  amber: '#c08a2d',
  red: '#a8403c',
  green: '#22a06b',
  ringStroke: 'rgba(8,146,168,0.55)',
  // Brand logo tint — defaults to ink (monochrome). Swap to gold by reading
  // `t.logoTintGold` instead of `t.logoTint` at the call site (or override
  // via the goldLogo tweak).
  logoTint: '#1a1f3a',           // = ink-ish (close to t.ink for light)
  logoTintGold: '#a8762c',       // deeper gold reads better against bright bg
};

const ORRERY_DARK = {
  name: 'dark',
  bg: 'radial-gradient(ellipse at 50% 35%, #0c1538 0%, #04081a 70%)',
  bgFlat: '#04081a',
  panel: 'rgba(255,255,255,0.045)',
  panelBorder: 'rgba(255,255,255,0.10)',
  panelStroke: 'rgba(255,255,255,0.06)',
  ink: '#f3f5fa',
  inkSoft: '#a0a8c0',
  inkMute: '#646b85',
  haloBg: 'rgba(34,184,207,0.30)',
  starCore: '#ffffff',
  starGlow1: '#7ddef0',
  starGlow2: '#22b8cf',
  starOuter: '#0892a8',
  orbit: 'rgba(180,200,255,0.16)',
  orbitTick: 'rgba(180,200,255,0.40)',
  bright: '#4dd6e8',
  warm: '#22b8cf',
  cool: '#5fb1c2',
  cold: '#3a6878',
  ice: '#22384a',
  shadow: 'rgba(0,0,0,0.45)',
  highlight: 'rgba(255,255,255,0.45)',
  starfield: '#dde6ff',
  starfieldOpacity: 0.55,
  amber: '#e6b262',
  red: '#e07a73',
  green: '#7ed5a3',
  ringStroke: 'rgba(77,214,232,0.65)',
  // Brand logo tint — defaults to ink. Gold variant uses a luminous warm
  // amber that lifts against the deep navy bg; matches the notification/banner
  // amber in dark mode so the brand color and accent feel like one family.
  logoTint: '#f3f5fa',           // = ink (monochrome white)
  logoTintGold: '#e6b262',       // matches t.amber — same family as accents
};

// ---------- Projection ----------
const TILT = 0.42; // y-squash for isometric tilt
const orreryProject = (x, y, z = 0) => [x, y * TILT - z];

// ---------- Brightness ramp ----------
const brightToColor = (br, t) => {
  if (br > 0.8) return t.bright;
  if (br > 0.65) return t.warm;
  if (br > 0.5) return t.cool;
  if (br > 0.35) return t.cold;
  return t.ice;
};

// ---------- Owl mark (legacy alias → Observatory brand) ----------
//  Kept as a thin wrapper so existing call sites keep working. Delegates to the
//  real <ObservatoryOwlMark> from observatory-brand.jsx.
function OrreryOwl({ size = 22, t, tint }) {
  const Mark = window.ObservatoryOwlMark;
  if (!Mark) return <span style={{ display: 'inline-block', width: size, height: size }} />;
  return <Mark size={size} color={tint || t.logoTint || t.ink} />;
}

// ---------- Top bar (shared shell) ----------
function OrreryTopBar({ t, view = 'OBSERVATORY', activeNav = 'Atlas', extra = null, onNavigate = null, presentation = 'observatory' }) {
  const navMap = { Atlas: 'dashboard', Calls: 'planet', Patterns: 'patterns', Galaxy: 'galaxy', Reports: null };
  const navs = ['Atlas', 'Calls', 'Patterns', 'Galaxy', 'Reports'];
  // Lexicon: in clinical mode, swap the metaphor labels for plain ones. Hide
  // the "Galaxy" tab entirely — there is no clinical equivalent yet (segment
  // view will replace it in a later pass).
  const labelOf = (n) => (presentation === 'clinical' && window.clinicalLex
    ? window.clinicalLex(n, 'clinical') : n);
  const visibleNavs = presentation === 'clinical'
    ? navs.filter((n) => n !== 'Galaxy')
    : navs;
  const viewLabel = presentation === 'clinical' && view === 'ATLAS' ? 'DASHBOARD' : view;
  return (
    <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 28px', borderBottom: `0.5px solid ${t.panelBorder}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: onNavigate ? 'pointer' : 'default' }}
        onClick={() => onNavigate && onNavigate('dashboard')}>
        <OrreryOwl size={26} t={t} />
        {window.ObservatoryWordmark
          ? <window.ObservatoryWordmark height={17} color={t.logoTint || t.ink} style={{ marginTop: 1 }} />
          : <span style={{ fontFamily: '"Inter", system-ui, sans-serif', fontStyle: 'italic', fontSize: 19, color: t.logoTint || t.ink }}>Observatory</span>}
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, color: t.inkMute, letterSpacing: '0.16em', marginLeft: 8 }}>v2 · MODEL OF THE PRACTICE</span>
      </div>
      <div style={{ display: 'flex', gap: 22, fontSize: 12.5, color: t.inkSoft }}>
        {visibleNavs.map((n) => (
          <span
            key={n}
            onClick={() => { const dest = navMap[n]; if (dest && onNavigate) onNavigate(dest); }}
            style={{
              color: n === activeNav ? t.ink : t.inkSoft,
              fontWeight: n === activeNav ? 500 : 400,
              cursor: onNavigate && navMap[n] ? 'pointer' : 'default',
              transition: 'color 150ms',
            }}
          >{labelOf(n)}</span>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        {extra}
        <div style={{ padding: '5px 10px', background: `${t.bright}18`, borderRadius: 6, fontSize: 10.5, color: t.bright, fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.1em' }}>VIEW · {viewLabel}</div>
      </div>
    </div>
  );
}

// ---------- Star (center sun) ----------
function OrreryCenterStar({ t, idSeed = 'a' }) {
  return (
    <g>
      <defs>
        <radialGradient id={`orr-star-${idSeed}`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor={t.starCore} stopOpacity="1" />
          <stop offset="35%" stopColor={t.starGlow1} stopOpacity="0.85" />
          <stop offset="100%" stopColor={t.starOuter} stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="0" cy="0" r="6" fill={`url(#orr-star-${idSeed})`} />
      <circle cx="0" cy="0" r="1.6" fill={t.starCore} stroke={t.bright} strokeWidth="0.2" />
      {[0, Math.PI / 2].map((ang, i) => (
        <line key={i}
          x1={Math.cos(ang) * 3} y1={Math.sin(ang) * 3 * TILT}
          x2={Math.cos(ang) * -3} y2={Math.sin(ang) * -3 * TILT}
          stroke={t.bright} strokeWidth="0.15" opacity="0.5" />
      ))}
    </g>
  );
}

// ---------- Orbit ring ----------
function OrreryOrbitRing({ r, t, dashed = true, label = null, anchor = 'right' }) {
  return (
    <g>
      <ellipse cx="0" cy="0" rx={r} ry={r * TILT} fill="none"
        stroke={t.orbit} strokeWidth="0.15"
        strokeDasharray={dashed ? '0.6 0.5' : '0'} />
      {[0, Math.PI / 2, Math.PI, Math.PI * 1.5].map((ang, k) => {
        const x = Math.cos(ang) * r;
        const y = Math.sin(ang) * r * TILT;
        return <circle key={k} cx={x} cy={y} r="0.18" fill={t.orbitTick} />;
      })}
      {label && (
        <text x={anchor === 'right' ? r + 1.5 : -r - 1.5} y={0.4}
          textAnchor={anchor === 'right' ? 'start' : 'end'}
          fontFamily="'JetBrains Mono', monospace" fontSize="1.4"
          fill={t.inkMute} letterSpacing="0.1">{label}</text>
      )}
    </g>
  );
}

// ---------- Planet ----------
function OrreryPlanet({ p, t, hovered = false, onHover, onLeave, onClick, showRing = false, dim = false, trajectory = null }) {
  const c = brightToColor(p.br, t);
  return (
    <g
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      onClick={onClick}
      style={{ cursor: onClick ? 'pointer' : 'default', opacity: dim ? 0.32 : 1, transition: 'opacity 200ms' }}
    >
      {/* shadow puddle */}
      <ellipse cx={p.px} cy={p.py + p.sz * 0.6} rx={p.sz * 0.9} ry={p.sz * 0.3}
        fill={t.shadow} opacity={t.name === 'dark' ? 0.55 : 0.13} />
      {/* hot/hovered glow */}
      {(p.hot || hovered) && (
        <circle cx={p.px} cy={p.py} r={p.sz * 2.6}
          fill={t.bright} opacity={hovered ? 0.20 : 0.14} filter="blur(0.2px)" />
      )}
      {/* trajectory arrow */}
      {trajectory && (() => {
        const dx = Math.cos(trajectory.dir) * (p.sz + 0.8);
        const dy = Math.sin(trajectory.dir) * (p.sz + 0.8) * TILT;
        return (
          <g>
            <line x1={p.px} y1={p.py} x2={p.px + dx} y2={p.py + dy}
              stroke={trajectory.up ? t.green : t.red} strokeWidth="0.2" strokeLinecap="round" />
            <circle cx={p.px + dx} cy={p.py + dy} r="0.35"
              fill={trajectory.up ? t.green : t.red} />
          </g>
        );
      })()}
      {/* planet body */}
      <circle cx={p.px} cy={p.py} r={p.sz} fill={c} opacity={dim ? 0.5 : 0.94} />
      {/* highlight */}
      <ellipse cx={p.px - p.sz * 0.3} cy={p.py - p.sz * 0.3}
        rx={p.sz * 0.45} ry={p.sz * 0.35} fill={t.highlight} opacity={t.name === 'dark' ? 0.35 : 0.55} />
      {/* shadow side (terminator) */}
      <path
        d={`M ${p.px} ${p.py - p.sz} A ${p.sz} ${p.sz} 0 0 1 ${p.px} ${p.py + p.sz} A ${p.sz * 0.55} ${p.sz} 0 0 1 ${p.px} ${p.py - p.sz} Z`}
        fill={t.name === 'dark' ? '#000' : '#0e1228'} opacity={t.name === 'dark' ? 0.55 : 0.18}
      />
      {/* hot ring (Saturn-style) */}
      {showRing && (
        <ellipse cx={p.px} cy={p.py} rx={p.sz * 1.7} ry={p.sz * 0.65}
          fill="none" stroke={t.ringStroke} strokeWidth="0.2" />
      )}
      {/* anomaly halo (off-orbit) */}
      {p.anomaly && (
        <circle cx={p.px} cy={p.py} r={p.sz * 1.5} fill="none"
          stroke={t.amber} strokeWidth="0.16" strokeDasharray="0.4 0.3" />
      )}
      {/* hover ring */}
      {hovered && (
        <circle cx={p.px} cy={p.py} r={p.sz + 0.8}
          fill="none" stroke={t.bright} strokeWidth="0.18" />
      )}
    </g>
  );
}

// ---------- Starfield (background) ----------
function OrreryStarfield({ t, count = 60, spread = [56, 28] }) {
  return (
    <g>
      {Array.from({ length: count }).map((_, i) => {
        const x = Math.sin(i * 7.13 + 0.5) * spread[0];
        const y = Math.cos(i * 4.91 + 1.1) * spread[1];
        const r = 0.12 + (Math.sin(i * 3.7) + 1) * 0.10;
        const op = (t.starfieldOpacity * (0.5 + ((Math.cos(i * 2.3) + 1) * 0.5)));
        return <circle key={i} cx={x} cy={y} r={r} fill={t.starfield} opacity={op} />;
      })}
    </g>
  );
}

// ---------- KPI tile (themed) ----------
function OrreryKpi({ t, label, value, sub, delta, accentRamp = 'bright', icon = null, plain = false }) {
  const accent = t[accentRamp] || t.bright;
  return (
    <div style={{
      padding: '14px 18px', borderRadius: 12,
      background: t.panel, backdropFilter: 'blur(8px)',
      border: `0.5px solid ${t.panelBorder}`,
      position: 'relative', overflow: 'hidden',
    }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, ${accent}, transparent)` }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontSize: 10.5, color: t.inkSoft, letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: "'JetBrains Mono', monospace" }}>{label}</span>
        {delta && <span style={{ fontSize: 10, color: t.green, fontFamily: "'JetBrains Mono', monospace" }}>↑ {delta}</span>}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
        <span style={{ fontFamily: '"Inter", system-ui, sans-serif', fontSize: 30, fontStyle: plain ? 'normal' : 'italic', fontWeight: plain ? 500 : 400, letterSpacing: '-0.02em', color: t.ink }}>{value}</span>
        {sub && <span style={{ fontSize: 11, color: t.inkSoft }}>{sub}</span>}
      </div>
    </div>
  );
}

// ---------- Section card ----------
function OrreryCard({ t, children, style = {}, padded = true }) {
  return (
    <div style={{
      borderRadius: 14,
      background: t.panel, backdropFilter: 'blur(8px)',
      border: `0.5px solid ${t.panelBorder}`,
      padding: padded ? '16px 18px' : 0,
      ...style,
    }}>
      {children}
    </div>
  );
}

// ---------- Mono tag ----------
function OrreryTag({ children, t, color = null, style = {} }) {
  return (
    <span style={{
      fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5,
      letterSpacing: '0.12em', textTransform: 'uppercase',
      color: color || t.inkSoft, ...style,
    }}>{children}</span>
  );
}

// ---------- Theme toggle button ----------
function OrreryThemeToggle({ theme, onToggle, t }) {
  return (
    <button
      onClick={onToggle}
      style={{
        padding: '5px 10px', borderRadius: 6,
        background: 'transparent', border: `0.5px solid ${t.panelBorder}`,
        fontSize: 10.5, color: t.inkSoft, fontFamily: "'JetBrains Mono', monospace",
        letterSpacing: '0.1em', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5,
      }}
    >
      {theme === 'light' ? '◐' : '◑'} {theme === 'light' ? 'LIGHT' : 'DARK'}
    </button>
  );
}

Object.assign(window, {
  ORRERY_LIGHT, ORRERY_DARK,
  TILT, orreryProject, brightToColor,
  OrreryOwl, OrreryTopBar, OrreryCenterStar, OrreryOrbitRing,
  OrreryPlanet, OrreryStarfield, OrreryKpi, OrreryCard,
  OrreryTag, OrreryThemeToggle,
});
