/* global React */
/* eslint-disable */
const {
  useState: useStateRealismShow,
  ORRERY_LIGHT, ORRERY_DARK,
  OrreryTopBar, OrreryCard, OrreryTag, OrreryThemeToggle,
  EmptyState, LoadingPlanet, ProcessingBadge, UncertaintyHaze, DegradedNotice, RealismStyles,
  OwlStyles, OwlNote,
} = window;

// =============================================================================
//  Orrery — Realism showcase
//  Honest states for a Tuesday: empty, loading, partial, low-confidence, degraded.
// =============================================================================

function OrreryRealismShowcase({ theme: themeProp = 'light', onThemeChange = null, onNavigate = null }) {
  const t = themeProp === 'light' ? ORRERY_LIGHT : ORRERY_DARK;

  return (
    <div style={{ background: t.bg, minHeight: '100vh', color: t.ink, fontFamily: "'Inter', sans-serif", WebkitFontSmoothing: 'antialiased' }}>
      <RealismStyles />
      <OwlStyles />
      <OrreryTopBar t={t} view="REALISM" activeNav="Atlas" onNavigate={onNavigate}
        extra={<OrreryThemeToggle theme={themeProp} t={t}
          onToggle={() => onThemeChange && onThemeChange(themeProp === 'light' ? 'dark' : 'light')} />} />

      <div style={{ maxWidth: 1240, margin: '0 auto', padding: '40px 32px 96px' }}>
        {/* Hero */}
        <div style={{ marginBottom: 36 }}>
          <OrreryTag t={t}>◇ DESIGN SYSTEM · REALISM STATES</OrreryTag>
          <h1 style={{ fontFamily: "'Instrument Serif', serif", fontSize: 44, fontWeight: 400, letterSpacing: '-0.02em', margin: '8px 0 0', lineHeight: 1.05, maxWidth: 820, color: t.ink }}>
            A <span style={{ fontStyle: 'italic', color: t.warm }}>Tuesday</span> is not a pitch deck.
          </h1>
          <p style={{ fontSize: 14.5, lineHeight: 1.55, color: t.inkSoft, maxWidth: 700, marginTop: 12 }}>
            Real practices have flat days, calls still processing, agents on PTO, and AI that doesn't always know. These primitives let every screen render those states without breaking the metaphor.
          </p>
        </div>

        {/* 01 — Empty states */}
        <SectionHeaderR t={t} num="01" title="Empty states" sub="When there is genuinely nothing to show, say so with grace." />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14, marginBottom: 48 }}>
          <OrreryCard t={t} pad={0}>
            <EmptyState t={t} glyph="flat-orbit"
              owlVerb="OBSERVED A QUIET DAY"
              title="No anchor today."
              body="Twelve calls came in; none stood out. Ory is still listening."
              action={<button style={btnR(t)}>Open yesterday's atlas</button>}
            />
          </OrreryCard>
          <OrreryCard t={t} pad={0}>
            <EmptyState t={t} glyph="no-constellation"
              owlVerb="WATCHING FOR PATTERNS"
              title="No constellations drawn yet."
              body="Ory needs about a week of calls before patterns become trustworthy."
              action={<button style={btnR(t)}>Try with last 30 days</button>}
            />
          </OrreryCard>
          <OrreryCard t={t} pad={0}>
            <EmptyState t={t} glyph="thin-data"
              title="One agent reporting in."
              body="Maya is the only person with calls today. The team view returns when others log calls."
            />
          </OrreryCard>
          <OrreryCard t={t} pad={0}>
            <EmptyState t={t} glyph="cloud"
              title="Nothing to coach yet."
              body="No calls flagged for review this week. Coaching surfaces when something rises or dims."
            />
          </OrreryCard>
        </div>

        {/* 02 — Loading / processing */}
        <SectionHeaderR t={t} num="02" title="Processing" sub="Calls in flight; data forming. Show the work, don't pretend it's done." />
        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 14, marginBottom: 48 }}>
          <OrreryCard t={t}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, color: t.inkMute, letterSpacing: '0.14em', marginBottom: 14 }}>◇ MINI ATLAS · 4 OF 12 CALLS PROCESSING</div>
            <svg viewBox="-30 -16 60 32" style={{ width: '100%', height: 200, display: 'block' }}>
              <ellipse cx="0" cy="0" rx="22" ry="9" fill="none" stroke={t.orbit} strokeWidth="0.3" />
              <ellipse cx="0" cy="0" rx="14" ry="6" fill="none" stroke={t.orbit} strokeWidth="0.3" />
              <circle cx="0" cy="0" r="2" fill={t.starGlow1} opacity="0.5" />
              <circle cx="0" cy="0" r="1" fill={t.starCore} />
              <circle cx="-14" cy="3" r="2.4" fill={t.warm} />
              <circle cx="9" cy="-4" r="1.8" fill={t.cool} />
              <circle cx="18" cy="2" r="1.4" fill={t.cold} />
              <LoadingPlanet cx={-6} cy={-5} r={1.3} t={t} />
              <LoadingPlanet cx={11} cy={5} r={1.6} t={t} />
              <LoadingPlanet cx={-19} cy={-2} r={1.1} t={t} />
              <LoadingPlanet cx={3} cy={6} r={1.2} t={t} />
            </svg>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
              <ProcessingBadge t={t} label="TRANSCRIBING" count={2} variant="info" />
              <ProcessingBadge t={t} label="SCORING" count={1} variant="pending" />
              <ProcessingBadge t={t} label="QUEUED" count={1} variant="info" />
            </div>
          </OrreryCard>
          <OrreryCard t={t}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, color: t.inkMute, letterSpacing: '0.14em', marginBottom: 12 }}>◇ INLINE BADGES</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <ProcessingBadge t={t} label="TRANSCRIBING" variant="info" />
                <span style={{ fontSize: 12.5, color: t.inkSoft }}>Audio uploaded; transcript forming.</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <ProcessingBadge t={t} label="SCORING" variant="pending" />
                <span style={{ fontSize: 12.5, color: t.inkSoft }}>Transcript ready; Owl is rating dimensions.</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <ProcessingBadge t={t} label="AWAITING ATTESTATION" variant="pending" />
                <span style={{ fontSize: 12.5, color: t.inkSoft }}>Clinical note drafted; clinician must sign.</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <ProcessingBadge t={t} label="EHR SYNCING" variant="info" />
                <span style={{ fontSize: 12.5, color: t.inkSoft }}>Pushing to your practice management system.</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <ProcessingBadge t={t} label="FAILED" variant="error" />
                <span style={{ fontSize: 12.5, color: t.inkSoft }}>Audio quality too low; please re-upload.</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <ProcessingBadge t={t} label="READY" variant="success" />
                <span style={{ fontSize: 12.5, color: t.inkSoft }}>Call has landed in the atlas.</span>
              </div>
            </div>
          </OrreryCard>
        </div>

        {/* 03 — Low confidence */}
        <SectionHeaderR t={t} num="03" title="Low confidence" sub="When Ory is unsure, it should say so before it speaks." />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14, marginBottom: 48 }}>
          <OrreryCard t={t}>
            <UncertaintyHaze t={t} reason="POOR AUDIO · 38% INAUDIBLE">
              <div style={{ fontFamily: "'Instrument Serif', serif", fontStyle: 'italic', fontSize: 19, lineHeight: 1.25, color: t.ink, marginBottom: 6 }}>
                Possibly an insurance objection around minute 4.
              </div>
              <div style={{ fontSize: 12.5, lineHeight: 1.5, color: t.inkSoft }}>
                Several stretches were inaudible. Ory flagged the call for human review rather than auto-scoring it.
              </div>
            </UncertaintyHaze>
          </OrreryCard>
          <OrreryCard t={t}>
            <UncertaintyHaze t={t} reason="THIN DATA · 4 CALLS THIS WEEK">
              <div style={{ fontFamily: "'Instrument Serif', serif", fontStyle: 'italic', fontSize: 19, lineHeight: 1.25, color: t.ink, marginBottom: 6 }}>
                Insurance Snag may be forming.
              </div>
              <div style={{ fontSize: 12.5, lineHeight: 1.5, color: t.inkSoft }}>
                The pattern shows up in 4 of 4 calls — too few to call a constellation. Watching.
              </div>
            </UncertaintyHaze>
          </OrreryCard>
        </div>

        {/* 04 — Degraded notices */}
        <SectionHeaderR t={t} num="04" title="Degraded notices" sub="Things are mostly fine; tell the user where the edges are." />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 48 }}>
          <DegradedNotice t={t} severity="info"
            message="EHR sync paused — last successful sync was 14 minutes ago."
            action={<button style={btnR(t, 'ghost')}>Resync now</button>} />
          <DegradedNotice t={t} severity="warn"
            message="Maya is on PTO this week. Her atlas reflects her last logged day."
            action={<button style={btnR(t, 'ghost')}>View team without Maya</button>} />
          <DegradedNotice t={t} severity="warn"
            message="Today is unusually noisy — 7 anomalies flagged. Ory recommends a quick triage."
            action={<button style={btnR(t, 'ghost')}>Open triage</button>} />
          <DegradedNotice t={t} severity="error"
            message="3 calls failed to upload from yesterday's recorder."
            action={<button style={btnR(t, 'ghost')}>Retry uploads</button>} />
        </div>

        {/* 05 — Combined: a real Tuesday */}
        <SectionHeaderR t={t} num="05" title="A real Tuesday" sub="What the dashboard looks like when most of these are stacked together." />
        <OrreryCard t={t}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: t.inkMute, letterSpacing: '0.14em', marginBottom: 14 }}>◇ ATLAS · TUE OCT 28</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
            <DegradedNotice t={t} severity="warn"
              message="3 of 12 calls still processing. The atlas will update as they land." />
            <DegradedNotice t={t} severity="info"
              message="No clear anchor today — calls are evenly distributed in tone and outcome." />
          </div>
          <svg viewBox="-30 -16 60 32" style={{ width: '100%', height: 240, display: 'block' }}>
            <ellipse cx="0" cy="0" rx="24" ry="10" fill="none" stroke={t.orbit} strokeWidth="0.25" />
            <ellipse cx="0" cy="0" rx="17" ry="7" fill="none" stroke={t.orbit} strokeWidth="0.25" />
            <ellipse cx="0" cy="0" rx="10" ry="4.2" fill="none" stroke={t.orbit} strokeWidth="0.25" />
            <circle cx="0" cy="0" r="2.2" fill={t.starGlow1} opacity="0.4" />
            <circle cx="0" cy="0" r="1" fill={t.starCore} />
            <circle cx="-9" cy="2" r="1.5" fill={t.cool} />
            <circle cx="6" cy="-3" r="1.6" fill={t.cool} />
            <circle cx="-15" cy="-3" r="1.7" fill={t.warm} />
            <circle cx="14" cy="3" r="1.4" fill={t.cold} />
            <circle cx="-21" cy="2" r="1.3" fill={t.cold} />
            <circle cx="20" cy="-3" r="1.5" fill={t.cool} />
            <LoadingPlanet cx={-3} cy={-3} r={1.3} t={t} />
            <LoadingPlanet cx={10} cy={5} r={1.2} t={t} />
            <LoadingPlanet cx={-17} cy={4} r={1.1} t={t} />
          </svg>
          <div style={{ borderTop: `0.5px solid ${t.panelBorder}`, paddingTop: 14, marginTop: 8 }}>
            <OwlNote t={t} attribution="ORY — TUE 14:32">
              A quiet day so far — twelve calls in, three still forming. No single planet is pulling the eye. I'll mark anything notable as it lands.
            </OwlNote>
          </div>
        </OrreryCard>

        {/* Footer nav */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 56, paddingTop: 24, borderTop: `0.5px solid ${t.panelBorder}` }}>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: t.inkMute, letterSpacing: '0.14em' }}>◇ OBSERVATORY · DESIGN SYSTEM · REALISM</span>
          <button onClick={() => onNavigate && onNavigate('Atlas')} style={btnR(t, 'primary')}>See realism in the atlas →</button>
        </div>
      </div>
    </div>
  );
}

function SectionHeaderR({ t, num, title, sub }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, marginBottom: 18, paddingBottom: 12, borderBottom: `0.5px solid ${t.panelBorder}` }}>
      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: t.inkMute, letterSpacing: '0.16em' }}>{num}</span>
      <span style={{ fontFamily: "'Instrument Serif', serif", fontSize: 24, fontStyle: 'italic', color: t.ink }}>{title}</span>
      <span style={{ fontSize: 12.5, color: t.inkSoft, flex: 1 }}>{sub}</span>
    </div>
  );
}

function btnR(t, variant = 'ghost') {
  if (variant === 'primary') {
    return {
      padding: '8px 14px', borderRadius: 8, border: 'none',
      background: t.bright, color: t.bg,
      fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: '0.12em', cursor: 'pointer',
    };
  }
  return {
    padding: '6px 12px', borderRadius: 8, border: `0.5px solid ${t.panelBorder}`,
    background: 'transparent', color: t.ink,
    fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: '0.12em', cursor: 'pointer',
  };
}

window.OrreryRealismShowcase = OrreryRealismShowcase;
