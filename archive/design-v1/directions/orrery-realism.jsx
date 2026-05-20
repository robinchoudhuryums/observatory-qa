/* global React */
/* eslint-disable */
const {
  ORRERY_LIGHT, ORRERY_DARK,
  OwlMark,
} = window;

// =============================================================================
//  Orrery — Realism states
//  Honest renderings for: empty, loading, partial, low-confidence, degraded.
//  Used to retrofit existing screens so the prototype feels like a Tuesday,
//  not a pitch deck.
// =============================================================================

// ── Empty state ──────────────────────────────────────────────
// Use when a screen has nothing meaningful to render yet.
function EmptyState({ t, glyph = 'flat-orbit', title, body, action = null, owlVerb = null }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: 16, padding: '40px 24px', textAlign: 'center', color: t.ink,
      fontFamily: "'Inter', sans-serif",
    }}>
      <EmptyGlyph t={t} kind={glyph} />
      {owlVerb && (
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, color: t.inkMute, letterSpacing: '0.14em', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <OwlMark size={12} t={t} state="idle" /> ◇ ORY · {owlVerb}
        </span>
      )}
      <div style={{ fontFamily: '"Inter", system-ui, sans-serif', fontStyle: 'italic', fontSize: 22, lineHeight: 1.2, color: t.ink, maxWidth: 380 }}>
        {title}
      </div>
      <div style={{ fontSize: 13, lineHeight: 1.55, color: t.inkSoft, maxWidth: 380 }}>
        {body}
      </div>
      {action}
    </div>
  );
}

// Decorative glyph variants for empty/zero states
function EmptyGlyph({ t, kind = 'flat-orbit' }) {
  const stroke = t.orbit;
  if (kind === 'flat-orbit') {
    // Single orbit, no planets — "the day was quiet"
    return (
      <svg width="120" height="60" viewBox="-30 -15 60 30" style={{ opacity: 0.7 }}>
        <ellipse cx="0" cy="0" rx="22" ry="9" fill="none" stroke={stroke} strokeWidth="0.4" strokeDasharray="0.8 0.8" />
        <circle cx="0" cy="0" r="2" fill={t.starGlow1} opacity="0.5" />
        <circle cx="0" cy="0" r="0.8" fill={t.starCore} />
      </svg>
    );
  }
  if (kind === 'no-constellation') {
    // Three disconnected dots — patterns not yet formed
    return (
      <svg width="120" height="60" viewBox="-30 -15 60 30" style={{ opacity: 0.7 }}>
        <circle cx="-14" cy="-4" r="1.2" fill={t.cool} />
        <circle cx="6" cy="3" r="1.2" fill={t.cool} />
        <circle cx="16" cy="-6" r="1.2" fill={t.cool} />
      </svg>
    );
  }
  if (kind === 'thin-data') {
    // Tiny single planet
    return (
      <svg width="120" height="60" viewBox="-30 -15 60 30" style={{ opacity: 0.7 }}>
        <ellipse cx="0" cy="0" rx="22" ry="9" fill="none" stroke={stroke} strokeWidth="0.3" opacity="0.5" />
        <circle cx="-12" cy="3" r="1.4" fill={t.cool} />
      </svg>
    );
  }
  if (kind === 'cloud') {
    // Generic 'nothing here yet' — a soft ring
    return (
      <svg width="120" height="60" viewBox="-30 -15 60 30" style={{ opacity: 0.7 }}>
        <circle cx="0" cy="0" r="9" fill="none" stroke={stroke} strokeWidth="0.4" />
        <circle cx="0" cy="0" r="9" fill="none" stroke={stroke} strokeWidth="0.4" strokeDasharray="0.6 1.2" opacity="0.5" />
      </svg>
    );
  }
  return null;
}

// ── Loading planet (skeleton orbit) ──────────────────────────
// A placeholder used when a planet is still being processed.
function LoadingPlanet({ cx, cy, r = 1.6, t }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill={t.panelBorder} opacity="0.35">
        <animate attributeName="opacity" values="0.18;0.42;0.18" dur="1.6s" repeatCount="indefinite" />
      </circle>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={t.inkMute} strokeWidth="0.12"
        strokeDasharray="1 1.5" opacity="0.7">
        <animateTransform attributeName="transform" type="rotate" from="0" to="360"
          dur="3s" repeatCount="indefinite" />
      </circle>
    </g>
  );
}

// ── Processing badge ─────────────────────────────────────────
// Inline status pill — "X calls still processing"
function ProcessingBadge({ t, label = 'PROCESSING', count = null, variant = 'info' }) {
  const colors = {
    info: t.cool,
    pending: t.amber,
    error: t.red,
    success: t.bright,
  };
  const c = colors[variant] || t.cool;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '3px 9px', borderRadius: 100,
      background: `${c}1c`, color: c,
      border: `0.5px solid ${c}40`,
      fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, letterSpacing: '0.12em',
    }}>
      <span style={{
        width: 5, height: 5, borderRadius: 3, background: c,
        animation: variant === 'info' || variant === 'pending' ? 'realPulse 1.4s ease-in-out infinite' : 'none',
      }} />
      {label}{count !== null ? ` · ${count}` : ''}
    </span>
  );
}

// ── Uncertainty haze (low-confidence) ────────────────────────
// Wraps content in a soft, dashed-bordered container with a header note.
function UncertaintyHaze({ t, reason, children }) {
  return (
    <div style={{
      position: 'relative',
      border: `0.5px dashed ${t.amber}`,
      borderRadius: 10,
      padding: 14,
      background: `${t.amber}08`,
    }}>
      <div style={{
        fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: t.amber, letterSpacing: '0.14em',
        marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <span style={{ width: 5, height: 5, borderRadius: 3, background: t.amber }} />
        ◇ LOW CONFIDENCE · {reason}
      </div>
      {children}
    </div>
  );
}

// ── Degraded notice (banner) ─────────────────────────────────
// Slim banner when something's not quite right but the screen still works.
function DegradedNotice({ t, message, action = null, severity = 'info' }) {
  const c = severity === 'warn' ? t.amber : (severity === 'error' ? t.red : t.cool);
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '10px 14px', borderRadius: 8,
      background: `${c}12`, border: `0.5px solid ${c}40`,
      color: t.ink, fontSize: 12.5, lineHeight: 1.4,
      fontFamily: "'Inter', sans-serif",
    }}>
      <span style={{ width: 6, height: 6, borderRadius: 3, background: c, flexShrink: 0 }} />
      <span style={{ flex: 1, color: t.inkSoft }}>{message}</span>
      {action}
    </div>
  );
}

// ── CSS keyframes (injected once) ────────────────────────────
function RealismStyles() {
  return (
    <style>{`
      @keyframes realPulse { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } }
    `}</style>
  );
}

Object.assign(window, {
  EmptyState, EmptyGlyph, LoadingPlanet, ProcessingBadge, UncertaintyHaze, DegradedNotice, RealismStyles,
});
