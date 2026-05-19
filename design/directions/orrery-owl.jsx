/* global React */
/* eslint-disable */
const {
  useState: useStateOwl, useEffect: useEffectOwl, useRef: useRefOwl,
  ORRERY_LIGHT, ORRERY_DARK,
} = window;

// =============================================================================
//  Orrery — Owl persona system
//  - <OwlMark>: refined glyph w/ state variants (idle, thinking, attention, talking, concerned)
//  - <OwlSignature>: "◇ ORY · <verb>" stamp for AI-authored content
//  - <OwlConfidenceChip>: high/med/low w/ tap-to-explain popover
//  - <AskOwlFab> + <AskOwlPanel>: floating button + side conversation surface
//  - <OwlNote>: card wrapper for AI-authored notes (can replace OrreryCard for these)
// =============================================================================

// ── Refined glyph ────────────────────────────────────────────
// State: 'idle' | 'thinking' | 'attention' | 'talking' | 'concerned'
//
// v2: built on top of <ObservatoryOwlMark> from observatory-brand.jsx so the
// persona glyph is literally the brand owl. State variants are layered on:
// head-tilt for posture, blink/eye-close for thinking, signal pulse for
// attention, breathing scale for talking, amber tint + downward tilt for
// concerned. Falls back to a small placeholder if the brand component hasn't
// loaded yet (load order: observatory-brand.jsx before this file).
function OwlMark({ size = 22, t, state = 'idle', signal = false }) {
  // Persona uses the LAYERED owl — body/eyes/beak as separate shapes, with
  // built-in state-driven animations (blink, attention-widen, head-tilt,
  // concerned-squash, talking-breath). See observatory-brand.jsx.
  // Falls back to filled-head or line owl if the layered component hasn't
  // loaded yet (load order: observatory-brand.jsx before this file).
  const Brand = window.ObservatoryLayeredOwl || window.ObservatoryFilledOwlHead || window.ObservatoryOwlMark;
  const isLayered = Brand === window.ObservatoryLayeredOwl;

  // Tint by state. Attention pops bright; concerned softens to amber.
  const tint = state === 'attention' ? t.bright : (state === 'concerned' ? t.amber : t.ink);

  // If signal is on but state is idle, escalate to 'attention' so the eyes
  // widen — that's the "noticed something" cue we want for notifications.
  const renderState = (signal && state === 'idle') ? 'attention' : state;

  // Legacy non-layered path (fallback only): keep the manual tilt + breath.
  const legacyTilt = state === 'thinking' ? -6 : (state === 'concerned' ? 4 : 0);
  const legacyAnimClass = state === 'talking' ? 'owl-mark-talking' : '';
  const legacyBlink = state === 'thinking' || state === 'attention' || signal;

  return (
    <span style={{
      display: 'inline-block', position: 'relative',
      width: size, height: size, lineHeight: 0,
    }}>
      <span
        className={isLayered ? '' : legacyAnimClass}
        style={{
          display: 'inline-block', width: size, height: size,
          // Layered owl animates internally — no outer tilt/breath needed.
          transform: isLayered ? 'none' : `rotate(${legacyTilt}deg)`,
          transformOrigin: '50% 70%',
          transition: 'transform 320ms cubic-bezier(0.4,0.0,0.2,1)',
          color: tint,
          position: 'relative',
        }}
      >
        {Brand
          ? (isLayered
              ? <Brand size={size} color={tint} state={renderState} />
              : <Brand size={size} color={tint} blink={legacyBlink} />)
          // Final fallback — tiny silhouette so missing brand never renders blank.
          : (
            <svg width={size} height={size} viewBox="0 0 24 24" fill={tint}>
              <ellipse cx="12" cy="12" rx="7" ry="9" opacity="0.85" />
            </svg>
          )}
      </span>

      {/* Thinking — three dots floating above Ory's head */}
      {state === 'thinking' && (
        <span style={{
          position: 'absolute',
          top: -size * 0.35,
          left: '50%', transform: 'translateX(-50%)',
          display: 'flex', gap: Math.max(2, size * 0.08),
          pointerEvents: 'none',
        }}>
          {[0, 1, 2].map((i) => (
            <span key={i} style={{
              width: Math.max(2, size * 0.11), height: Math.max(2, size * 0.11),
              borderRadius: '50%', background: t.bright,
              opacity: 0.8,
              animation: `owlThinkBob 1.2s ease-in-out ${i * 0.15}s infinite`,
            }} />
          ))}
        </span>
      )}

      {/* Signal pulse — "has something to say" */}
      {(signal || state === 'attention') && (
        <span style={{
          position: 'absolute', top: -1, right: -1,
          width: Math.max(7, size * 0.3), height: Math.max(7, size * 0.3),
          borderRadius: '50%',
          background: state === 'concerned' ? t.amber : t.bright,
          boxShadow: `0 0 0 1.5px ${t.name === 'dark' ? '#0a1228' : (t.panelBg || '#fff')}, 0 0 8px ${state === 'concerned' ? t.amber : t.bright}`,
        }}>
          <span style={{
            position: 'absolute', inset: 0, borderRadius: '50%',
            background: state === 'concerned' ? t.amber : t.bright,
            opacity: 0.55,
            animation: 'owlPulse 1.6s ease-out infinite',
          }} />
        </span>
      )}
    </span>
  );
}

// CSS keyframes for owl persona states. Inject once.
function OwlStyles() {
  return (
    <style>{`
      @keyframes owlPulse { 0% { transform: scale(1); opacity: 0.55; } 100% { transform: scale(2.2); opacity: 0; } }
      @keyframes owlThinkBob { 0%, 100% { transform: translateY(0); opacity: 0.4; } 50% { transform: translateY(-2px); opacity: 0.95; } }
      @keyframes owlBreath { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.06); } }
      .owl-mark-talking { animation: owlBreath 1.4s ease-in-out infinite; }
    `}</style>
  );
}

// ── Signature stamp ──────────────────────────────────────────
function OwlSignature({ t, verb = 'NOTED', timestamp = null, confidence = null, onConfidenceClick = null }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, color: t.bright,
        letterSpacing: '0.14em',
      }}>
        <OwlMark size={12} t={t} state="idle" />
        ◇ ORY · {verb}
      </span>
      {timestamp && (
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, color: t.inkMute, letterSpacing: '0.1em' }}>
          {timestamp}
        </span>
      )}
      {confidence && <OwlConfidenceChip t={t} level={confidence} onClick={onConfidenceClick} />}
    </div>
  );
}

// ── Confidence chip (tap to explain) ─────────────────────────
function OwlConfidenceChip({ t, level = 'high', onClick = null, explanation = null }) {
  const [open, setOpen] = useStateOwl(false);
  const labels = { high: 'HIGH', med: 'MED', low: 'LOW' };
  const colors = { high: t.bright, med: t.amber, low: t.red };
  const def = {
    high: 'Strong signals: clear transcript, multiple corroborating cues, pattern matches recent history.',
    med: 'Mixed signals: some ambiguity in the transcript or sparse comparable history.',
    low: 'Weak signals: noisy audio, short call, or a pattern I haven\'t seen often. Treat as a hint, not a verdict.',
  };
  const c = colors[level];
  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        onClick={(e) => { e.stopPropagation(); if (onClick) onClick(); else setOpen((v) => !v); }}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          padding: '2px 7px', borderRadius: 100,
          background: `${c}1f`, color: c,
          border: `0.5px solid ${c}55`,
          fontFamily: "'JetBrains Mono', monospace", fontSize: 9, letterSpacing: '0.12em',
          cursor: 'pointer',
        }}>
        <span style={{ width: 5, height: 5, borderRadius: 3, background: c }} />
        {labels[level]} CONF
      </button>
      {open && (
        <span style={{
          position: 'absolute', top: '100%', left: 0, marginTop: 6, zIndex: 50,
          background: t.panelBg, border: `0.5px solid ${t.panelBorder}`,
          borderRadius: 10, padding: '10px 12px', minWidth: 240, maxWidth: 280,
          boxShadow: t.name === 'dark' ? '0 16px 40px rgba(0,0,0,0.5)' : '0 16px 40px rgba(20,32,80,0.18)',
          fontFamily: "'Inter', sans-serif", fontSize: 12, lineHeight: 1.45, color: t.ink,
        }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, color: c, letterSpacing: '0.14em', marginBottom: 4 }}>
            ◇ {labels[level]} CONFIDENCE
          </div>
          {explanation || def[level]}
        </span>
      )}
    </span>
  );
}

// ── Card wrapper for AI-authored content ─────────────────────
function OwlNote({ t, verb = 'NOTED', timestamp = null, confidence = null, children, accent = true }) {
  return (
    <div style={{
      background: accent
        ? (t.name === 'dark' ? `linear-gradient(180deg, ${t.bright}10 0%, ${t.panelBg} 60%)` : `linear-gradient(180deg, ${t.bright}0a 0%, ${t.panelBg} 60%)`)
        : t.panelBg,
      borderRadius: 10,
      border: `0.5px solid ${t.panelBorder}`,
      borderLeft: `2px solid ${t.bright}`,
      padding: '14px 16px',
      color: t.ink,
    }}>
      <div style={{ marginBottom: 8 }}>
        <OwlSignature t={t} verb={verb} timestamp={timestamp} confidence={confidence} />
      </div>
      <div style={{ fontSize: 13.5, lineHeight: 1.5, color: t.inkSoft }}>{children}</div>
    </div>
  );
}

// ── Floating "Ask Ory" button ────────────────────────────
function AskOwlFab({ t, signal = false, onClick }) {
  return (
    <button
      onClick={onClick}
      aria-label="Ask Ory"
      style={{
        position: 'fixed', right: 22, bottom: 22, zIndex: 90,
        width: 52, height: 52, borderRadius: 26,
        background: t.name === 'dark' ? 'rgba(12,21,56,0.92)' : '#fff',
        border: `0.5px solid ${t.panelBorder}`,
        boxShadow: t.name === 'dark' ? '0 12px 30px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.04)' : '0 12px 30px rgba(20,32,80,0.18)',
        cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 0,
      }}>
      <OwlMark size={26} t={t} state={signal ? 'attention' : 'idle'} signal={signal} />
    </button>
  );
}

// ── Ask Ory side panel ───────────────────────────────────
function AskOwlPanel({ t, open, onClose, seed = null, presentation = 'observatory' }) {
  const clinical = presentation === 'clinical';
  const defaultSeed = clinical
    ? [{
        who: 'owl',
        text: 'Anomaly detected. Want to review?',
        sub: 'Insurance verify · unusual volume +2.4σ vs 30-day baseline',
        confidence: 'med',
      }]
    : [{
        who: 'owl',
        text: 'I noticed something today. Want to look?',
        sub: 'Insurance verify drifted out of usual orbit · 2.4σ',
        confidence: 'med',
      }];
  const [thread, setThread] = useStateOwl(() => seed || defaultSeed);
  const [draft, setDraft] = useStateOwl('');
  const [thinking, setThinking] = useStateOwl(false);
  const scrollRef = useRefOwl(null);

  useEffectOwl(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [thread, thinking, open]);

  const ask = (text) => {
    if (!text.trim()) return;
    const newThread = [...thread, { who: 'me', text }];
    setThread(newThread);
    setDraft('');
    setThinking(true);
    // Canned reply (this is a prototype)
    setTimeout(() => {
      const reply = pickReply(text, presentation);
      setThread([...newThread, reply]);
      setThinking(false);
    }, 1100);
  };

  if (!open) return null;
  return (
    <>
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, zIndex: 95,
        background: 'rgba(0,0,0,0.32)', backdropFilter: 'blur(2px)',
      }} />
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(420px, 92vw)', zIndex: 96,
        background: t.name === 'dark' ? 'rgba(8,16,40,0.98)' : '#fff',
        borderLeft: `0.5px solid ${t.panelBorder}`,
        boxShadow: '-20px 0 50px rgba(0,0,0,0.22)',
        display: 'flex', flexDirection: 'column',
        fontFamily: "'Inter', sans-serif",
      }}>
        {/* Header */}
        <div style={{ padding: '18px 20px 14px', borderBottom: `0.5px solid ${t.panelBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <OwlMark size={22} t={t} state={thinking ? 'thinking' : 'idle'} />
            <div>
              <div style={{ fontFamily: '"Inter", system-ui, sans-serif', fontStyle: clinical ? 'normal' : 'italic', fontWeight: clinical ? 500 : 400, fontSize: 18, color: t.ink, lineHeight: 1 }}>
                {clinical ? 'AI Assist' : 'Ory'}
              </div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: t.inkMute, letterSpacing: '0.12em', marginTop: 3 }}>
                {clinical
                  ? (thinking ? '◆ ANALYZING…' : '◆ READY')
                  : (thinking ? '◇ THINKING…' : '◇ READY')}
              </div>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{
            width: 30, height: 30, borderRadius: 15, border: 'none',
            background: t.name === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
            color: t.ink, cursor: 'pointer', fontSize: 13,
          }}>✕</button>
        </div>

        {/* Thread */}
        <div ref={scrollRef} style={{ flex: 1, overflow: 'auto', padding: '18px 20px' }}>
          {thread.map((m, i) => (
            <ThreadBubble key={i} m={m} t={t} />
          ))}
          {thinking && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', marginTop: 4 }}>
              <OwlMark size={16} t={t} state="thinking" />
              <span style={{ display: 'inline-flex', gap: 3 }}>
                {[0, 1, 2].map((i) => (
                  <span key={i} style={{
                    width: 5, height: 5, borderRadius: 3, background: t.inkMute,
                    animation: `owlBlink 1.2s ease-in-out ${i * 0.18}s infinite`,
                  }} />
                ))}
              </span>
            </div>
          )}
        </div>

        {/* Suggested prompts */}
        {thread.length <= 1 && !thinking && (
          <div style={{ padding: '0 20px 10px', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {['Why did close rate dip?', 'Who needs coaching this week?', 'Show me Tx plan trends'].map((p) => (
              <button key={p} onClick={() => ask(p)} style={{
                padding: '6px 11px', borderRadius: 100, fontSize: 11,
                background: 'transparent', border: `0.5px solid ${t.panelBorder}`,
                color: t.inkSoft, cursor: 'pointer', fontFamily: 'inherit',
              }}>{p}</button>
            ))}
          </div>
        )}

        {/* Composer */}
        <div style={{ padding: '12px 16px 16px', borderTop: `0.5px solid ${t.panelBorder}` }}>
          <div style={{
            display: 'flex', alignItems: 'flex-end', gap: 8, padding: '8px 8px 8px 14px',
            border: `0.5px solid ${t.panelBorder}`, borderRadius: 22,
            background: t.name === 'dark' ? 'rgba(255,255,255,0.04)' : '#fff',
          }}>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(draft); } }}
              placeholder="Ask Ory…"
              rows={1}
              style={{
                flex: 1, border: 'none', outline: 'none', resize: 'none',
                background: 'transparent', color: t.ink, fontFamily: 'inherit',
                fontSize: 13.5, lineHeight: 1.4, padding: '6px 0', maxHeight: 100,
              }}
            />
            <button
              onClick={() => ask(draft)}
              disabled={!draft.trim()}
              style={{
                width: 30, height: 30, borderRadius: 15, border: 'none',
                background: draft.trim() ? t.bright : (t.name === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'),
                color: draft.trim() ? (t.name === 'dark' ? '#0a1228' : '#fff') : t.inkMute,
                cursor: draft.trim() ? 'pointer' : 'default', flexShrink: 0,
              }}>↑</button>
          </div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: t.inkMute, letterSpacing: '0.12em', marginTop: 8, textAlign: 'center' }}>
            ◇ ANSWERS GROUNDED IN YOUR PRACTICE'S CALLS, NOTES & RECORDS
          </div>
        </div>
      </div>
    </>
  );
}

function ThreadBubble({ m, t }) {
  const isOwl = m.who === 'owl';
  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      alignItems: isOwl ? 'flex-start' : 'flex-end',
      marginBottom: 14,
    }}>
      <div style={{
        maxWidth: '88%',
        background: isOwl
          ? (t.name === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.025)')
          : t.bright,
        color: isOwl ? t.ink : (t.name === 'dark' ? '#0a1228' : '#fff'),
        padding: '10px 14px', borderRadius: 14,
        borderTopLeftRadius: isOwl ? 4 : 14,
        borderTopRightRadius: isOwl ? 14 : 4,
        fontSize: 13.5, lineHeight: 1.45,
      }}>
        {m.text}
        {m.sub && (
          <div style={{ fontSize: 11.5, color: isOwl ? t.inkMute : 'rgba(255,255,255,0.78)', marginTop: 6, fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.06em' }}>
            {m.sub}
          </div>
        )}
      </div>
      {isOwl && m.confidence && (
        <div style={{ marginTop: 6, marginLeft: 4 }}>
          <OwlConfidenceChip t={t} level={m.confidence} />
        </div>
      )}
    </div>
  );
}

// Tiny canned-reply picker so the prototype is responsive
//   presentation: 'observatory' (default) | 'clinical' — tone shifts to plain,
//   metric-forward, less first-person; same content underneath.
function pickReply(input, presentation = 'observatory') {
  const lower = input.toLowerCase();
  const clinical = presentation === 'clinical';
  if (lower.includes('coach')) {
    return {
      who: 'owl',
      text: clinical
        ? 'Two agents stand out this week. Devi Patel: Implant-inquiry close rate ran 18% below her own baseline. Andrew Kim: Tx-plan close improved by 12 points after the last session; recommend reinforcement.'
        : 'Two agents stand out this week. Devi Patel is dim on Implant inquiry — close rate ran 18% below her own baseline. Andrew Kim improved Tx plan close by 12 points after the last session; consider reinforcing.',
      sub: 'Based on 47 calls · 6 days',
      confidence: 'high',
    };
  }
  if (lower.includes('tx') || lower.includes('treatment') || lower.includes('plan')) {
    return {
      who: 'owl',
      text: clinical
        ? 'Tx plan review is the top driver today — 9.1 score, 19 calls, +12pp vs last Saturday. Acceptance language clustered around "let\'s get this scheduled" rather than price. Recommend reinforcing in next coaching session.'
        : 'Tx plan review burned brightest today — 9.1 score, 19 calls, ↑12pp vs last Saturday. Acceptance language clustered around "let\'s get this scheduled" rather than price. Worth coaching toward.',
      sub: 'Saturday 26 Apr · 9.1 / 10',
      confidence: 'high',
    };
  }
  if (lower.includes('dip') || lower.includes('drop') || lower.includes('why')) {
    return {
      who: 'owl',
      text: clinical
        ? 'Close rate slipped about 4 points around 1pm. Two contributing factors: a cluster of insurance-verify calls without a callback set, and three new-patient calls where close occurred after the first call (not yet counted). The dip is partly real, partly bookkeeping.'
        : 'Close rate slipped about 4 points around 1pm. Two factors I can see: a cluster of insurance-verify calls without a callback set, and three new-patient calls where the close happened after the first call (so they\'re not yet counted). The dip is partly real, partly bookkeeping.',
      sub: 'Mid-day window · 12:00–14:00',
      confidence: 'med',
    };
  }
  return {
    who: 'owl',
    text: clinical
      ? 'Available. Specify a time window or agent and the relevant metrics will be pulled across the last 30 days.'
      : 'I can pull that up. Looking across the last 30 days — what window or agent should I focus on?',
    confidence: 'med',
  };
}

Object.assign(window, {
  OwlMark, OwlSignature, OwlConfidenceChip, OwlNote,
  AskOwlFab, AskOwlPanel, OwlStyles,
});
