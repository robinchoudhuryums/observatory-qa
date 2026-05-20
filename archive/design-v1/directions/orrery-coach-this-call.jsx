/* global React */
/* eslint-disable */
const {
  useState: useStateCC, useEffect: useEffectCC,
} = window.React || React;

// =============================================================================
//  Send-to-Coach Panel — the first ACTION verb in the app.
//
//  Entry: from Call Detail, the manager clicks "Coach this call" or "Coach
//         this moment". The panel slides in from the right with an Owl-
//         drafted brief pre-filled from the call (and optionally the
//         selected moment).
//
//  Grammar:
//    • The Owl drafts.        Title, action items, category — all pre-filled.
//    • The manager edits.     Inline edits, add/delete tasks, note to agent.
//    • The manager signs.     "Send to {agent}" CTA. Becomes a coaching session.
//
//  Reusable for future actions: Send to team, Track this pattern, Draft reply.
// =============================================================================

// ── Owl-drafted brief templates, keyed off the selected moment label. ───────
// In production these would come from RAG over the transcript + Owl's pattern
// recognition. Here we pre-write a few so the prototype demonstrates the
// "Owl drafts, human signs" grammar at full fidelity.
const COACH_DRAFTS = {
  // Default — used when the manager clicks "Coach this call" without a moment.
  __default: {
    title: 'Tx plan handoff — soften the cost moment',
    category: 'Communication',
    framing: 'The cost moment dimmed the orbit briefly. Worth a 10-minute review with Sarah on how she frames cost when it surfaces unprompted — three of her last 8 calls showed the same brief tone drop.',
    confidence: 'med',
    actions: [
      'Listen to 04:02–04:30 together — note the pause length before reframing.',
      'Try the "schedule then quote" alternative: book the next step first, then anchor cost.',
      'Self-record 2 Tx plan reviews this week using the new framing; share for review.',
    ],
  },

  // Specific moments — keyed by label, prefilled with tighter context.
  Cost: {
    title: 'Soften the cost handoff',
    category: 'Communication',
    framing: 'The cost moment at 04:02 dropped tone briefly before Sarah recovered with the live insurance check. The recovery was great — but the dip is a pattern worth a 10-minute talk.',
    confidence: 'high',
    actions: [
      'Listen to 04:02–04:30 — note the pause and the recovery pivot.',
      'Try the "schedule, then anchor cost" framing on next 3 Tx plan calls.',
      'Self-score one of those calls with the rubric and share for review.',
    ],
  },
  Insurance: {
    title: 'Lean into the live-verify pivot',
    category: 'Insurance',
    framing: 'Sarah\'s instinct to verify coverage live at 04:51 brought the call back into the light. This is the move — worth bottling and coaching the rest of the team to do the same.',
    confidence: 'high',
    actions: [
      'Pull the 04:51–05:33 segment as a teaching clip.',
      'Add the live-verify pivot to the team\'s "moves that work" playbook.',
      'Share with Aja and Marisol; ask them to try it on their next 3 verify calls.',
    ],
  },
  Concern: {
    title: 'Hold space for the concern moment',
    category: 'Communication',
    framing: 'Maria opened with a real concern at 01:14 — Sarah moved to the imaging walkthrough quickly. Worth slowing the empathetic acknowledgement before pivoting to clinical.',
    confidence: 'med',
    actions: [
      'Listen to 01:14–02:48 — note the speed of the pivot to imaging.',
      'Try the "name what you heard" technique before any clinical pivot.',
      'Practice with Marisol over coffee this week.',
    ],
  },
};

// ── The panel ────────────────────────────────────────────────────────────────
function SendToCoachPanel({
  t, open, onClose, onSent,
  callName = 'Maria Hernandez',
  agent = 'Sarah',
  callTime = '09:14',
  callScore = '9.2',
  moment = null,  // { label, time, color, body } — null = whole-call coaching
}) {
  // Resolve which draft to use — moment-specific if available, else default.
  const draftKey = (moment && moment.label && COACH_DRAFTS[moment.label]) ? moment.label : '__default';
  const initialDraft = COACH_DRAFTS[draftKey];

  const [title, setTitle] = useStateCC(initialDraft.title);
  const [category, setCategory] = useStateCC(initialDraft.category);
  const [actions, setActions] = useStateCC(() => initialDraft.actions.map(text => ({ text, done: false })));
  const [note, setNote] = useStateCC('');
  const [due, setDue] = useStateCC('this Friday');
  const [sending, setSending] = useStateCC(false);

  // Reset when draft key changes (manager opens panel from a different moment).
  useEffectCC(() => {
    if (!open) return;
    setTitle(initialDraft.title);
    setCategory(initialDraft.category);
    setActions(initialDraft.actions.map(text => ({ text, done: false })));
    setNote('');
    setSending(false);
  }, [open, draftKey]);

  if (!open) return null;

  const submit = () => {
    setSending(true);
    setTimeout(() => {
      if (onSent) onSent({ title, category, actions, note, due, agent });
      setSending(false);
    }, 700);
  };

  const updateAction = (idx, text) => setActions(a => a.map((x, i) => i === idx ? { ...x, text } : x));
  const removeAction = (idx) => setActions(a => a.filter((_, i) => i !== idx));
  const addAction = () => setActions(a => [...a, { text: '', done: false }]);

  const Cat = ({ value, children }) => (
    <button onClick={() => setCategory(value)} style={{
      padding: '6px 11px', borderRadius: 100, fontSize: 11,
      background: category === value ? `${t.bright}1c` : 'transparent',
      border: `0.5px solid ${category === value ? t.bright : t.panelBorder}`,
      color: category === value ? t.bright : t.inkSoft,
      fontFamily: 'inherit', cursor: 'pointer',
      letterSpacing: '0.02em',
    }}>{children}</button>
  );

  return (
    <>
      {/* scrim */}
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, zIndex: 95,
        background: 'rgba(0,0,0,0.32)', backdropFilter: 'blur(2px)',
      }} />

      {/* drawer */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: 'min(460px, 94vw)', zIndex: 96,
        background: t.name === 'dark' ? 'rgba(8,16,40,0.98)' : '#fff',
        borderLeft: `0.5px solid ${t.panelBorder}`,
        boxShadow: '-20px 0 50px rgba(0,0,0,0.22)',
        display: 'flex', flexDirection: 'column',
        fontFamily: '"Inter", system-ui, sans-serif',
      }}>
        {/* HEADER */}
        <div style={{
          padding: '20px 22px 16px', borderBottom: `0.5px solid ${t.panelBorder}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        }}>
          <div>
            <div style={{
              fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5,
              letterSpacing: '0.14em', color: t.inkMute, textTransform: 'uppercase',
            }}>◇ Send to coach</div>
            <div style={{
              fontFamily: '"Inter", system-ui, sans-serif', fontSize: 18, fontWeight: 500,
              color: t.ink, marginTop: 4, letterSpacing: '-0.01em',
            }}>
              Brief for <span style={{ color: t.bright }}>{agent}</span>
            </div>
            <div style={{ fontSize: 11.5, color: t.inkSoft, marginTop: 2 }}>
              From {callName} · {callTime} · score {callScore}
              {moment && (<> · moment <strong style={{ color: t.ink, fontWeight: 500 }}>{moment.label}</strong></>)}
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{
            width: 30, height: 30, borderRadius: 15, border: 'none',
            background: t.name === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
            color: t.ink, cursor: 'pointer', fontSize: 13, flexShrink: 0,
          }}>✕</button>
        </div>

        {/* BODY */}
        <div style={{ flex: 1, overflow: 'auto', padding: '18px 22px 8px' }}>

          {/* Owl's framing */}
          <div style={{
            background: t.name === 'dark' ? 'rgba(34,184,207,0.07)' : 'rgba(34,184,207,0.05)',
            border: `0.5px solid ${t.panelBorder}`,
            borderLeft: `2px solid ${t.bright}`,
            borderRadius: 10, padding: '12px 14px', marginBottom: 20,
          }}>
            <div style={{ marginBottom: 6 }}>
              {window.OwlSignature
                ? <window.OwlSignature t={t} verb="DRAFTED" timestamp="just now" confidence={initialDraft.confidence} />
                : <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, color: t.bright, letterSpacing: '0.14em' }}>◇ THE OWL · DRAFTED</span>}
            </div>
            <p style={{
              fontFamily: '"Inter", system-ui, sans-serif',
              fontSize: 13.5, lineHeight: 1.55, color: t.ink, margin: 0,
              fontStyle: 'italic',
            }}>{initialDraft.framing}</p>
          </div>

          {/* Title */}
          <FieldLabel t={t}>Title</FieldLabel>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            style={{
              width: '100%', padding: '9px 12px', marginTop: 6,
              border: `0.5px solid ${t.panelBorder}`, borderRadius: 8,
              background: t.name === 'dark' ? 'rgba(255,255,255,0.03)' : '#fff',
              color: t.ink, fontFamily: 'inherit', fontSize: 14,
              outline: 'none',
            }}
          />

          {/* Category */}
          <FieldLabel t={t} style={{ marginTop: 18 }}>Category</FieldLabel>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
            <Cat value="Communication">Communication</Cat>
            <Cat value="Insurance">Insurance</Cat>
            <Cat value="Tx plans">Tx plans</Cat>
            <Cat value="Outreach">Outreach</Cat>
            <Cat value="Compliance">Compliance</Cat>
          </div>

          {/* Referenced moment / call */}
          <FieldLabel t={t} style={{ marginTop: 20 }}>
            {moment ? 'Referenced moment' : 'Referenced call'}
          </FieldLabel>
          <div style={{
            marginTop: 6, padding: '11px 13px', borderRadius: 8,
            background: t.name === 'dark' ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.025)',
            border: `0.5px solid ${t.panelBorder}`,
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              background: moment ? (moment.color || t.bright) : t.bright,
              flexShrink: 0,
            }} />
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: t.inkSoft }}>
              {moment ? moment.time : callTime}
            </span>
            <span style={{ fontSize: 13, color: t.ink, flex: 1 }}>
              {moment ? moment.label : callName}
            </span>
            <span style={{
              fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5,
              letterSpacing: '0.10em', color: t.inkMute, textTransform: 'uppercase',
            }}>
              {moment ? 'pinned' : 'whole call'}
            </span>
          </div>

          {/* Action plan */}
          <FieldLabel t={t} style={{ marginTop: 20 }}>Action plan</FieldLabel>
          <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {actions.map((a, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'flex-start', gap: 8,
                padding: '8px 10px', borderRadius: 7,
                background: t.name === 'dark' ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.018)',
                border: `0.5px solid ${t.panelBorder}`,
              }}>
                <span style={{
                  fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: t.inkMute,
                  letterSpacing: '0.06em', marginTop: 2, flexShrink: 0,
                }}>{String(i + 1).padStart(2, '0')}</span>
                <textarea
                  value={a.text}
                  onChange={(e) => updateAction(i, e.target.value)}
                  rows={2}
                  style={{
                    flex: 1, border: 'none', outline: 'none', resize: 'none',
                    background: 'transparent', color: t.ink, fontFamily: 'inherit',
                    fontSize: 13, lineHeight: 1.45, padding: 0, minHeight: 18,
                  }}
                />
                <button onClick={() => removeAction(i)} aria-label="Remove"
                  style={{
                    width: 18, height: 18, borderRadius: 9, border: 'none', cursor: 'pointer',
                    background: 'transparent', color: t.inkMute, fontSize: 13, lineHeight: 1, padding: 0,
                    flexShrink: 0, marginTop: 1,
                  }}>×</button>
              </div>
            ))}
            <button onClick={addAction} style={{
              padding: '7px 10px', borderRadius: 7, fontSize: 11.5,
              background: 'transparent', border: `0.5px dashed ${t.panelBorder}`,
              color: t.inkSoft, cursor: 'pointer', fontFamily: 'inherit',
              textAlign: 'left',
            }}>＋ Add action item</button>
          </div>

          {/* Note to agent */}
          <FieldLabel t={t} style={{ marginTop: 20 }}>Note to {agent} <span style={{ color: t.inkMute, fontWeight: 400 }}>(optional)</span></FieldLabel>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={`Hey ${agent} — saw this moment in your Maria call. Quick chat?`}
            rows={3}
            style={{
              width: '100%', padding: '10px 12px', marginTop: 6,
              border: `0.5px solid ${t.panelBorder}`, borderRadius: 8,
              background: t.name === 'dark' ? 'rgba(255,255,255,0.03)' : '#fff',
              color: t.ink, fontFamily: 'inherit', fontSize: 13, lineHeight: 1.5,
              resize: 'vertical', minHeight: 60, outline: 'none',
            }}
          />

          {/* Due */}
          <FieldLabel t={t} style={{ marginTop: 18 }}>Due</FieldLabel>
          <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
            {['this Friday', 'next Mon', 'next Fri', 'no rush'].map(d => (
              <button key={d} onClick={() => setDue(d)} style={{
                padding: '6px 11px', borderRadius: 100, fontSize: 11,
                background: due === d ? `${t.bright}1c` : 'transparent',
                border: `0.5px solid ${due === d ? t.bright : t.panelBorder}`,
                color: due === d ? t.bright : t.inkSoft,
                fontFamily: 'inherit', cursor: 'pointer',
              }}>{d}</button>
            ))}
          </div>
        </div>

        {/* FOOTER */}
        <div style={{
          padding: '14px 20px 18px', borderTop: `0.5px solid ${t.panelBorder}`,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10,
        }}>
          <span style={{
            fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5,
            letterSpacing: '0.10em', color: t.inkMute,
          }}>
            ◇ {actions.length} action{actions.length === 1 ? '' : 's'}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} style={{
              padding: '9px 14px', borderRadius: 8, fontSize: 12.5, fontWeight: 500,
              background: 'transparent', border: `0.5px solid ${t.panelBorder}`,
              color: t.inkSoft, cursor: 'pointer', fontFamily: 'inherit',
            }}>Cancel</button>
            <button onClick={submit} disabled={sending || !title.trim()} style={{
              padding: '9px 16px', borderRadius: 8, fontSize: 12.5, fontWeight: 600,
              background: sending ? t.inkMute : t.bright,
              color: t.name === 'dark' ? '#0a1228' : '#fff',
              border: 'none',
              cursor: sending ? 'wait' : 'pointer', fontFamily: 'inherit',
              opacity: title.trim() ? 1 : 0.5,
            }}>
              {sending ? 'Sending…' : `Send to ${agent} →`}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function FieldLabel({ children, t, style }) {
  return (
    <div style={{
      fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5,
      letterSpacing: '0.14em', color: t.inkMute, textTransform: 'uppercase',
      ...style,
    }}>{children}</div>
  );
}

// ── Toast for the post-send confirmation ─────────────────────────────────────
function CoachSentToast({ t, open, agent, onView, onClose }) {
  useEffectCC(() => {
    if (!open) return;
    const tid = setTimeout(onClose, 5200);
    return () => clearTimeout(tid);
  }, [open]);

  if (!open) return null;
  return (
    <div style={{
      position: 'fixed', bottom: 22, left: '50%', transform: 'translateX(-50%)',
      zIndex: 97, padding: '12px 16px 12px 14px', borderRadius: 100,
      background: t.name === 'dark' ? 'rgba(8,16,40,0.96)' : '#0e1228',
      color: '#fff', fontFamily: '"Inter", system-ui, sans-serif',
      fontSize: 13.5, display: 'flex', alignItems: 'center', gap: 14,
      boxShadow: '0 12px 36px rgba(0,0,0,0.32)',
      border: `0.5px solid ${t.bright}55`,
      animation: 'cct-rise 280ms cubic-bezier(0.22, 1, 0.36, 1)',
    }}>
      <style>{`
        @keyframes cct-rise {
          from { transform: translate(-50%, 16px); opacity: 0; }
          to   { transform: translate(-50%, 0);    opacity: 1; }
        }
      `}</style>
      <span style={{
        width: 22, height: 22, borderRadius: 11, background: t.bright,
        color: t.name === 'dark' ? '#0a1228' : '#fff',
        fontSize: 13, fontWeight: 600,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      }}>✓</span>
      <span>Sent to <strong style={{ fontWeight: 600 }}>{agent}</strong>'s coaching queue.</span>
      <button onClick={onView} style={{
        marginLeft: 4, padding: '4px 10px', borderRadius: 100,
        background: 'transparent', border: `0.5px solid rgba(255,255,255,0.25)`,
        color: '#fff', fontFamily: 'inherit', fontSize: 12, cursor: 'pointer',
      }}>View →</button>
      <button onClick={onClose} aria-label="Dismiss" style={{
        background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.55)',
        cursor: 'pointer', fontSize: 14, padding: 0, lineHeight: 1, marginLeft: 2,
      }}>✕</button>
    </div>
  );
}

window.SendToCoachPanel = SendToCoachPanel;
window.CoachSentToast = CoachSentToast;
