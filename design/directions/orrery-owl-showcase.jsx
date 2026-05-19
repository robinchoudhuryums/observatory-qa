/* global React */
/* eslint-disable */
const {
  useState: useStateOwlShow,
  ORRERY_LIGHT, ORRERY_DARK,
  OrreryTopBar, OrreryCard, OrreryTag, OrreryThemeToggle,
  OwlMark, OwlSignature, OwlConfidenceChip, OwlNote, AskOwlFab, AskOwlPanel, OwlStyles,
} = window;

// =============================================================================
//  Orrery — Owl persona showcase
//  Gallery of all states + signature treatments + confidence chip + Ask Ory.
// =============================================================================

function OrreryOwlShowcase({ theme: themeProp = 'light', onThemeChange = null, onNavigate = null }) {
  const t = themeProp === 'light' ? ORRERY_LIGHT : ORRERY_DARK;
  const [askOpen, setAskOpen] = useStateOwlShow(false);
  const [demoState, setDemoState] = useStateOwlShow('idle');

  const states = [
    { key: 'idle', label: 'Idle', sub: 'Default — present, calm, in the nav.' },
    { key: 'thinking', label: 'Thinking', sub: 'AI is working. Subtle eye motion, soft glow.' },
    { key: 'attention', label: 'Has something', sub: 'Signal dot pulses. Light proactivity.' },
    { key: 'talking', label: 'Talking', sub: 'Active in the Ask surface. Eyes pulse with rhythm.' },
    { key: 'concerned', label: 'Concerned', sub: 'Compliance flag or anomaly needs eyes.' },
  ];

  return (
    <div style={{ background: t.bg, minHeight: '100vh', color: t.ink, fontFamily: "'Inter', sans-serif", WebkitFontSmoothing: 'antialiased' }}>
      <OwlStyles />
      <OrreryTopBar t={t} view="OWL" activeNav="Atlas" onNavigate={onNavigate}
        extra={<OrreryThemeToggle theme={themeProp} t={t}
          onToggle={() => onThemeChange && onThemeChange(themeProp === 'light' ? 'dark' : 'light')} />} />

      <div style={{ maxWidth: 1240, margin: '0 auto', padding: '40px 32px 96px' }}>
        {/* Hero */}
        <div style={{ marginBottom: 36 }}>
          <OrreryTag t={t}>◇ DESIGN SYSTEM · OWL PERSONA</OrreryTag>
          <h1 style={{ fontFamily: '"Inter", system-ui, sans-serif', fontSize: 44, fontWeight: 400, letterSpacing: '-0.02em', margin: '8px 0 0', lineHeight: 1.05, maxWidth: 780, color: t.ink }}>
            The <span style={{ color: t.bright, fontWeight: 600, fontStyle: 'italic' }}>Owl</span> is the AI's face across the practice.
          </h1>
          <p style={{ fontSize: 14.5, lineHeight: 1.55, color: t.inkSoft, maxWidth: 680, marginTop: 12 }}>
            One voice, one mark — wherever the system observes, drafts, suggests, or flags. Field-naturalist for summaries; senior colleague for suggestions. Lightly proactive, never interruptive.
          </p>
        </div>

        {/* Section: States */}
        <SectionHeader t={t} num="01" title="States" sub="Same glyph; subtle variation in posture, motion, and signal." />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 14, marginBottom: 48 }}>
          {states.map((s) => (
            <button
              key={s.key}
              onClick={() => setDemoState(s.key)}
              style={{
                padding: '20px 18px 18px',
                background: t.panel,
                border: `0.5px solid ${demoState === s.key ? t.bright : t.panelBorder}`,
                borderRadius: 14, cursor: 'pointer', textAlign: 'left',
                color: t.ink, fontFamily: 'inherit',
                display: 'flex', flexDirection: 'column', gap: 12,
                transition: 'border-color 200ms',
              }}>
              <div style={{ width: 44, height: 44, borderRadius: 22, background: t.name === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.025)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <OwlMark size={28} t={t} state={s.key} signal={s.key === 'attention'} />
              </div>
              <div>
                <div style={{ fontFamily: '"Inter", system-ui, sans-serif', fontStyle: 'italic', fontSize: 18, color: t.ink, lineHeight: 1.1 }}>{s.label}</div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: t.inkMute, letterSpacing: '0.12em', marginTop: 4 }}>◇ {s.key.toUpperCase()}</div>
                <div style={{ fontSize: 12, color: t.inkSoft, marginTop: 8, lineHeight: 1.4 }}>{s.sub}</div>
              </div>
            </button>
          ))}
        </div>

        {/* Section: Signature */}
        <SectionHeader t={t} num="02" title="Signature" sub="The mark Ory leaves on AI-authored content. Verb tells you what kind of work." />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 48 }}>
          <OwlNote t={t} verb="NOTED" timestamp="14:02" confidence="high">
            <div style={{ fontFamily: '"Inter", system-ui, sans-serif', fontStyle: 'italic', fontSize: 18, color: t.ink, lineHeight: 1.2, marginBottom: 6 }}>
              Maria moved into yes-language at 09:14.
            </div>
            She started cool, then warmed once you reframed Tx plan as a sequence rather than a quote. Worth noticing — that move worked twice today.
          </OwlNote>
          <OwlNote t={t} verb="DRAFTED" timestamp="awaiting attestation" confidence="med">
            <div style={{ fontFamily: '"Inter", system-ui, sans-serif', fontStyle: 'italic', fontSize: 18, color: t.ink, lineHeight: 1.2, marginBottom: 6 }}>
              SOAP · post-op follow-up · Hernandez, M.
            </div>
            S: Patient reports mild discomfort, day 3 post-extraction, controlled with OTC analgesics. O: Site healing as expected per phone description; no fever, no swelling reported…
          </OwlNote>
          <OwlNote t={t} verb="OBSERVED" timestamp="this week" confidence="med">
            <div style={{ fontFamily: '"Inter", system-ui, sans-serif', fontStyle: 'italic', fontSize: 18, color: t.ink, lineHeight: 1.2, marginBottom: 6 }}>
              Insurance Snag · 4 calls
            </div>
            A constellation forming at the boundary between verify and Tx plan review. Same agent on three of four. Coachable, probably.
          </OwlNote>
          <OwlNote t={t} verb="FLAGGED" timestamp="11:24" confidence="low" accent={false}>
            <div style={{ fontFamily: '"Inter", system-ui, sans-serif', fontStyle: 'italic', fontSize: 18, color: t.amber, lineHeight: 1.2, marginBottom: 6 }}>
              Possible HIPAA mention — review needed
            </div>
            I caught a phrase that could be PHI shared without context. Confidence is low — audio was muffled at 2:14. Worth a 15-second listen.
          </OwlNote>
        </div>

        {/* Section: Confidence */}
        <SectionHeader t={t} num="03" title="Confidence" sub="Ory says how sure it is. Tap any chip to see why." />
        <OrreryCard t={t} style={{ marginBottom: 48 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'center', justifyContent: 'space-around', padding: '8px 0' }}>
            {[
              { l: 'high', label: 'High', sub: 'Strong, multi-signal' },
              { l: 'med', label: 'Medium', sub: 'Mixed or sparse' },
              { l: 'low', label: 'Low', sub: 'Treat as a hint' },
            ].map((c) => (
              <div key={c.l} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                <OwlConfidenceChip t={t} level={c.l} />
                <div style={{ fontSize: 12, color: t.inkSoft }}>{c.sub}</div>
              </div>
            ))}
          </div>
        </OrreryCard>

        {/* Section: Voice */}
        <SectionHeader t={t} num="04" title="Voice" sub="Naturalist for summaries; senior colleague for suggestions." />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 48 }}>
          <OrreryCard t={t}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, color: t.bright, letterSpacing: '0.14em', marginBottom: 10 }}>◇ NATURALIST · SUMMARIES</div>
            <div style={{ fontSize: 14, lineHeight: 1.55, color: t.ink, marginBottom: 8, fontStyle: 'italic', fontFamily: '"Inter", system-ui, sans-serif', fontSizeAdjust: 0.5 }}>
              "Tx plan review burned brightest. Two new patients said yes by lunch. Insurance verify drifted out of usual orbit."
            </div>
            <div style={{ fontSize: 12, color: t.inkMute, lineHeight: 1.5 }}>
              Observational, calm, slightly poetic. Used on day-summary cards, constellation names, replay overlays.
            </div>
          </OrreryCard>
          <OrreryCard t={t}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, color: t.bright, letterSpacing: '0.14em', marginBottom: 10 }}>◇ COLLEAGUE · SUGGESTIONS</div>
            <div style={{ fontSize: 14, lineHeight: 1.55, color: t.ink, marginBottom: 8 }}>
              "Heads up — Insurance Verify drifted today. Volume is up 2.4σ. Want me to pull the four calls so you can listen?"
            </div>
            <div style={{ fontSize: 12, color: t.inkMute, lineHeight: 1.5 }}>
              Direct, low-jargon, action-oriented. Used in Ask-the-Owl, coaching briefs, anomaly suggestions.
            </div>
          </OrreryCard>
        </div>

        {/* Section: Ask Ory */}
        <SectionHeader t={t} num="05" title="Ask Ory" sub="A floating button on every screen. Conversational, RAG-grounded, lightly proactive." />
        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 18, marginBottom: 32 }}>
          <OrreryCard t={t}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, color: t.bright, letterSpacing: '0.14em', marginBottom: 12 }}>◇ TRY IT</div>
            <div style={{ fontSize: 14, lineHeight: 1.55, color: t.ink, marginBottom: 16 }}>
              Ory appears as a floating button bottom-right. When it has something to share, it pulses. Tap to open the conversation surface — answers are grounded in the practice's calls, notes, and records.
            </div>
            <button
              onClick={() => setAskOpen(true)}
              style={{
                padding: '11px 20px', borderRadius: 22, fontSize: 13.5, fontWeight: 500,
                background: t.bright, color: t.name === 'dark' ? '#0a1228' : '#fff',
                border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                display: 'inline-flex', alignItems: 'center', gap: 10,
              }}>
              <OwlMark size={18} t={t} state="idle" />
              Ask Ory
            </button>
          </OrreryCard>
          <OrreryCard t={t}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, color: t.bright, letterSpacing: '0.14em', marginBottom: 12 }}>◇ PROACTIVITY</div>
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[
                ['Quiet by default', 'Sits in the corner; doesn\'t interrupt.'],
                ['Pulses when notable', 'A signal dot when an anomaly or pattern surfaces.'],
                ['Greets in context', 'Opens with the day\'s most relevant observation, not a blank prompt.'],
                ['Hedges when uncertain', 'Always shows confidence; explains low confidence in plain terms.'],
              ].map(([h, s], i) => (
                <li key={i} style={{ display: 'flex', gap: 10 }}>
                  <span style={{ width: 6, height: 6, borderRadius: 3, background: t.bright, marginTop: 7, flexShrink: 0 }} />
                  <div>
                    <div style={{ fontSize: 13, color: t.ink, fontWeight: 500 }}>{h}</div>
                    <div style={{ fontSize: 12, color: t.inkSoft, lineHeight: 1.45 }}>{s}</div>
                  </div>
                </li>
              ))}
            </ul>
          </OrreryCard>
        </div>

        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: t.inkMute, letterSpacing: '0.14em', marginTop: 60, paddingTop: 20, borderTop: `0.5px solid ${t.panelBorder}` }}>
          ◇ END OF SHOWCASE · APPLY TO ATLAS, CALL DETAIL, PATTERNS, COACHING, CLINICAL NOTES
        </div>
      </div>

      <AskOwlFab t={t} signal={true} onClick={() => setAskOpen(true)} />
      <AskOwlPanel t={t} open={askOpen} onClose={() => setAskOpen(false)} />
    </div>
  );
}

function SectionHeader({ t, num, title, sub }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginBottom: 16, paddingBottom: 10, borderBottom: `0.5px solid ${t.panelBorder}` }}>
      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: t.inkMute, letterSpacing: '0.14em' }}>◇ {num}</span>
      <span style={{ fontFamily: '"Inter", system-ui, sans-serif', fontStyle: 'italic', fontSize: 26, color: t.ink, lineHeight: 1 }}>{title}</span>
      <span style={{ fontSize: 13, color: t.inkSoft, marginLeft: 6 }}>{sub}</span>
    </div>
  );
}

Object.assign(window, { OrreryOwlShowcase });
