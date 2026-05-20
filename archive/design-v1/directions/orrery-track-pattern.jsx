/* global React */
/* eslint-disable */
const { useState: useStateTP, useEffect: useEffectTP } = window.React || React;

// =============================================================================
//  Track-this-Pattern Popover + Toast — the second action verb.
//
//  Smaller-surface counterpart to Send-to-Coach. From Patterns view, manager
//  clicks "Track this pattern" on the active constellation's right-rail card,
//  popover anchors near the button. They choose notification trigger + expiry,
//  hit Save. Toast confirms.
// =============================================================================

const TRACK_TRIGGERS = [
  { value: 'new', label: 'New instance', sub: 'Surface in Atlas as soon as I see it again.' },
  { value: '2sigma', label: '2σ above baseline', sub: 'Only notify on statistically notable surges.' },
  { value: 'daily', label: 'Daily summary', sub: 'Roll into your 6pm digest, nothing in-flight.' },
  { value: 'weekly', label: 'Weekly summary', sub: 'Quietest option — Monday morning recap.' },
];
const TRACK_EXPIRY = [
  { value: '7d',   label: '7 days' },
  { value: '30d',  label: '30 days' },
  { value: 'none', label: 'No expiry' },
];

function TrackPatternPopover({ t, open, onClose, onSaved, anchorRect, pattern }) {
  const [trigger, setTrigger] = useStateTP('new');
  const [expiry, setExpiry] = useStateTP('30d');
  const [saving, setSaving] = useStateTP(false);

  useEffectTP(() => {
    if (!open) return;
    setTrigger('new'); setExpiry('30d'); setSaving(false);
  }, [open, pattern && pattern.name]);

  if (!open || !pattern) return null;

  // Position: above the anchor button if possible, else below.
  const rect = anchorRect || { top: 200, right: 60 };
  const popoverWidth = 360;
  const top = Math.max(20, (rect.top || 0) - 16 - 380); // try above
  const useBelow = top < 80;
  const finalTop = useBelow ? (rect.bottom || rect.top || 0) + 12 : top;
  const right = Math.max(20, window.innerWidth - (rect.right || (rect.left + (rect.width||0)) || window.innerWidth - 60));

  const save = () => {
    setSaving(true);
    setTimeout(() => { if (onSaved) onSaved({ trigger, expiry, pattern }); setSaving(false); }, 500);
  };

  const triggerObj = TRACK_TRIGGERS.find(x => x.value === trigger);

  return (
    <>
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, zIndex: 94, background: 'rgba(0,0,0,0.12)',
      }} />
      <div style={{
        position: 'fixed', top: finalTop, right,
        width: popoverWidth, maxWidth: '94vw', zIndex: 96,
        background: t.name === 'dark' ? 'rgba(8,16,40,0.98)' : '#fff',
        border: `0.5px solid ${t.panelBorder}`, borderRadius: 14,
        boxShadow: '0 20px 50px rgba(0,0,0,0.28)',
        fontFamily: '"Inter", system-ui, sans-serif', color: t.ink,
        animation: 'tp-rise 200ms cubic-bezier(0.22, 1, 0.36, 1)',
      }}>
        <style>{`@keyframes tp-rise { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }`}</style>

        {/* Header */}
        <div style={{ padding: '14px 16px 10px', borderBottom: `0.5px solid ${t.panelStroke}` }}>
          <div style={{
            fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5,
            letterSpacing: '0.14em', color: t.inkMute, textTransform: 'uppercase',
          }}>◇ Track pattern</div>
          <div style={{
            fontSize: 16, fontWeight: 500, color: t.ink, marginTop: 4, letterSpacing: '-0.01em',
            display: 'flex', alignItems: 'baseline', gap: 8,
          }}>
            <span style={{ color: pattern.color || t.bright }}>{pattern.name}</span>
            <span style={{
              fontFamily: "'JetBrains Mono', monospace", fontSize: 10.5,
              color: t.inkMute, letterSpacing: '0.06em', fontWeight: 400,
            }}>{pattern.count}</span>
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: '14px 16px' }}>
          <div style={{
            fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5,
            letterSpacing: '0.14em', color: t.inkMute, textTransform: 'uppercase',
            marginBottom: 8,
          }}>Notify me when</div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
            {TRACK_TRIGGERS.map((tg) => (
              <button key={tg.value} onClick={() => setTrigger(tg.value)} style={{
                display: 'flex', alignItems: 'flex-start', gap: 10,
                padding: '9px 11px', borderRadius: 8,
                background: trigger === tg.value ? `${t.bright}14` : 'transparent',
                border: `0.5px solid ${trigger === tg.value ? t.bright : t.panelBorder}`,
                color: t.ink, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
              }}>
                <span style={{
                  width: 14, height: 14, borderRadius: 7,
                  background: trigger === tg.value ? t.bright : 'transparent',
                  border: `1px solid ${trigger === tg.value ? t.bright : t.panelBorder}`,
                  flexShrink: 0, marginTop: 2,
                }} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{tg.label}</div>
                  <div style={{ fontSize: 11.5, color: t.inkSoft, marginTop: 1, lineHeight: 1.45 }}>{tg.sub}</div>
                </div>
              </button>
            ))}
          </div>

          <div style={{
            fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5,
            letterSpacing: '0.14em', color: t.inkMute, textTransform: 'uppercase',
            marginBottom: 6,
          }}>Expires</div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            {TRACK_EXPIRY.map((ex) => (
              <button key={ex.value} onClick={() => setExpiry(ex.value)} style={{
                flex: 1, padding: '7px 10px', borderRadius: 100, fontSize: 11.5,
                background: expiry === ex.value ? `${t.bright}14` : 'transparent',
                border: `0.5px solid ${expiry === ex.value ? t.bright : t.panelBorder}`,
                color: expiry === ex.value ? t.bright : t.inkSoft,
                fontFamily: 'inherit', cursor: 'pointer',
              }}>{ex.label}</button>
            ))}
          </div>

          {/* Owl framing */}
          <div style={{
            display: 'flex', gap: 8, alignItems: 'flex-start',
            padding: '10px 12px', borderRadius: 8,
            background: t.name === 'dark' ? 'rgba(34,184,207,0.06)' : 'rgba(34,184,207,0.04)',
            border: `0.5px solid ${t.panelBorder}`, borderLeft: `2px solid ${t.bright}`,
            marginTop: 4,
          }}>
            {window.OwlMark
              ? <window.OwlMark size={16} t={t} state="idle" />
              : <span style={{ width: 14, height: 14, borderRadius: 7, background: t.bright, flexShrink: 0, marginTop: 2 }} />}
            <p style={{
              fontSize: 12, lineHeight: 1.5, color: t.inkSoft, margin: 0, fontStyle: 'italic',
            }}>{triggerObj.value === 'new'
              ? `I'll watch for ${pattern.name.toLowerCase()} and surface anything notable as it happens.`
              : triggerObj.value === '2sigma'
                ? `I'll stay quiet unless ${pattern.name.toLowerCase()} runs 2σ above its baseline.`
                : triggerObj.value === 'daily'
                  ? `I'll roll ${pattern.name.toLowerCase()} into your 6pm digest.`
                  : `Monday morning recap only — quietest of the four.`}</p>
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 16px 14px', borderTop: `0.5px solid ${t.panelStroke}`,
          display: 'flex', justifyContent: 'flex-end', gap: 8,
        }}>
          <button onClick={onClose} style={{
            padding: '8px 12px', borderRadius: 7, fontSize: 12, fontWeight: 500,
            background: 'transparent', border: `0.5px solid ${t.panelBorder}`,
            color: t.inkSoft, cursor: 'pointer', fontFamily: 'inherit',
          }}>Cancel</button>
          <button onClick={save} disabled={saving} style={{
            padding: '8px 16px', borderRadius: 7, fontSize: 12, fontWeight: 600,
            background: saving ? t.inkMute : t.bright,
            color: t.name === 'dark' ? '#0a1228' : '#fff',
            border: 'none', cursor: saving ? 'wait' : 'pointer', fontFamily: 'inherit',
          }}>{saving ? 'Saving…' : 'Start tracking'}</button>
        </div>
      </div>
    </>
  );
}

function TrackPatternToast({ t, open, pattern, trigger, onView, onClose }) {
  useEffectTP(() => {
    if (!open) return;
    const tid = setTimeout(onClose, 5500);
    return () => clearTimeout(tid);
  }, [open]);
  if (!open || !pattern) return null;
  const triggerLabel = (TRACK_TRIGGERS.find(x => x.value === trigger) || {}).label || 'New instance';
  return (
    <div style={{
      position: 'fixed', top: 22, left: '50%', transform: 'translateX(-50%)',
      zIndex: 97, padding: '11px 16px 11px 14px', borderRadius: 100,
      background: t.name === 'dark' ? 'rgba(8,16,40,0.96)' : '#0e1228',
      color: '#fff', fontFamily: '"Inter", system-ui, sans-serif',
      fontSize: 13.5, display: 'flex', alignItems: 'center', gap: 12,
      boxShadow: '0 12px 36px rgba(0,0,0,0.32)',
      border: `0.5px solid ${t.bright}55`,
      animation: 'tpt-fall 280ms cubic-bezier(0.22, 1, 0.36, 1)',
    }}>
      <style>{`@keyframes tpt-fall { from { transform: translate(-50%, -12px); opacity: 0; } to { transform: translate(-50%, 0); opacity: 1; } }`}</style>
      <span style={{
        width: 20, height: 20, borderRadius: 10, background: t.bright,
        color: t.name === 'dark' ? '#0a1228' : '#fff', fontSize: 12, fontWeight: 600,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      }}>✓</span>
      <span>Tracking <strong style={{ fontWeight: 600 }}>{pattern.name}</strong> · {triggerLabel.toLowerCase()}</span>
      {onView && (
        <button onClick={onView} style={{
          marginLeft: 4, padding: '4px 10px', borderRadius: 100,
          background: 'transparent', border: `0.5px solid rgba(255,255,255,0.25)`,
          color: '#fff', fontFamily: 'inherit', fontSize: 12, cursor: 'pointer',
        }}>Watchlist →</button>
      )}
      <button onClick={onClose} aria-label="Dismiss" style={{
        background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.55)',
        cursor: 'pointer', fontSize: 14, padding: 0, lineHeight: 1,
      }}>✕</button>
    </div>
  );
}

window.TrackPatternPopover = TrackPatternPopover;
window.TrackPatternToast = TrackPatternToast;
