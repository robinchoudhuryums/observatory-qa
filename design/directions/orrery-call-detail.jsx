/* global React */
/* eslint-disable */
const {
  useState,
  ORRERY_LIGHT, ORRERY_DARK, TILT, orreryProject, brightToColor,
  OrreryTopBar, OrreryCenterStar, OrreryOrbitRing, OrreryPlanet,
  OrreryStarfield, OrreryKpi, OrreryCard, OrreryTag, OrreryThemeToggle,
} = window;
// =============================================================================
//  Orrery — Call detail (single call, orrery aesthetic)
//  The call as a small moon orbiting the planet "Tx plan review", with its
//  trajectory through the conversation drawn as an arc. Score = 9.2.
// =============================================================================

function OrreryCallDetail({ theme: themeProp = 'light', onNavigate = null, onThemeChange = null, callName = 'Maria Hernandez', realism = 'normal', presentation = 'observatory', onPresentationChange = null }) {
  const [themeState, setThemeState] = useState(themeProp);
  const theme = onThemeChange ? themeProp : themeState;
  const setTheme = (next) => { if (onThemeChange) onThemeChange(next); else setThemeState(next); };
  const t = theme === 'light' ? ORRERY_LIGHT : ORRERY_DARK;
  const clinical = presentation === 'clinical';
  const [moment, setMoment] = useState(2);
  const [coachOpen, setCoachOpen] = useState(false);
  const [coachMoment, setCoachMoment] = useState(null); // null = whole call
  const [sentToast, setSentToast] = useState(false);

  const openCoach = (m) => { setCoachMoment(m || null); setCoachOpen(true); };
  const onCoachSent = () => { setCoachOpen(false); setSentToast(true); };

  // Moments along the call as an orbital arc
  const moments = [
    { ang: -Math.PI * 0.85, label: 'Greeting',     time: '0:00', tone: 'warm',  br: 0.9 },
    { ang: -Math.PI * 0.55, label: 'Concern',      time: '1:14', tone: 'cool',  br: 0.6 },
    { ang: -Math.PI * 0.20, label: 'Walkthrough',  time: '2:48', tone: 'warm',  br: 0.85 },
    { ang:  Math.PI * 0.10, label: 'Cost',         time: '4:02', tone: 'amber', br: 0.45 },
    { ang:  Math.PI * 0.40, label: 'Insurance',    time: '4:51', tone: 'amber', br: 0.5 },
    { ang:  Math.PI * 0.70, label: 'Decision',     time: '5:33', tone: 'green', br: 0.95 },
    { ang:  Math.PI * 0.95, label: 'Schedule',     time: '6:14', tone: 'green', br: 0.92 },
  ];

  const arcR = 16;
  const projMoments = moments.map((m, i) => {
    const x = Math.cos(m.ang) * arcR;
    const y = Math.sin(m.ang) * arcR;
    const [px, py] = orreryProject(x, y);
    const color = m.tone === 'amber' ? t.amber : m.tone === 'green' ? t.green : brightToColor(m.br, t);
    return { ...m, px, py, color, idx: i };
  });

  return (
    <div style={{
      width: '100%', height: '100%', position: 'relative', overflow: 'hidden',
      background: t.bg, color: t.ink, fontFamily: "'Inter', sans-serif",
    }}>
      {!clinical && <div style={{ position: 'absolute', top: '40%', left: '30%', width: 480, height: 240, borderRadius: '50%', background: t.haloBg, filter: 'blur(120px)', pointerEvents: 'none' }} />}

      <OrreryTopBar t={t} view="CALL" activeNav="Calls" presentation={presentation} onNavigate={onNavigate}
        extra={<>
          {window.PresentationBadge && onPresentationChange && (
            <window.PresentationBadge t={t} mode={presentation}
              onClick={() => onPresentationChange(clinical ? 'observatory' : 'clinical')} />
          )}
          <OrreryThemeToggle theme={theme} t={t} onToggle={() => setTheme(theme === 'light' ? 'dark' : 'light')} />
        </>} />

      {/* Breadcrumb */}
      <div style={{ padding: '14px 28px 0', display: 'flex', alignItems: 'center', gap: 10 }}>
        <span onClick={() => onNavigate && onNavigate('dashboard')} style={{ cursor: onNavigate ? 'pointer' : 'default' }}>
          <OrreryTag t={t} color={t.inkMute}>← DASHBOARD</OrreryTag>
        </span>
        <span style={{ color: t.inkMute, fontSize: 11 }}>·</span>
        <span onClick={() => onNavigate && onNavigate('planet')} style={{ cursor: onNavigate ? 'pointer' : 'default' }}>
          <OrreryTag t={t} color={t.inkMute}>TX PLAN REVIEW</OrreryTag>
        </span>
        <span style={{ color: t.inkMute, fontSize: 11 }}>·</span>
        <OrreryTag t={t} color={t.bright}>MARIA HERNANDEZ · 09:14</OrreryTag>
      </div>

      {/* Title */}
      <div style={{ padding: '8px 28px 4px', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 32 }}>
        <h1 style={{ fontFamily: '"Inter", system-ui, sans-serif', fontSize: 32, fontWeight: 400, letterSpacing: '-0.02em', margin: 0, lineHeight: 1.1, color: t.ink }}>
          <span style={{ fontStyle: clinical ? 'normal' : 'italic', fontWeight: clinical ? 500 : 400 }}>Maria Hernandez</span> · 6:22 with Sarah · <span style={{ color: t.bright }}>$3.4k plan</span>, accepted.
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <button onClick={() => openCoach(null)} style={{
            padding: '9px 14px', borderRadius: 8, fontSize: 12.5, fontWeight: 600,
            background: t.bright, color: t.name === 'dark' ? '#0a1228' : '#fff',
            border: 'none', cursor: 'pointer', fontFamily: 'inherit',
            display: 'inline-flex', alignItems: 'center', gap: 6,
          }}>Coach this call <span style={{ fontSize: 11, opacity: 0.7 }}>→</span></button>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{ fontFamily: '"Inter", system-ui, sans-serif', fontSize: 56, fontStyle: clinical ? 'normal' : 'italic', fontWeight: clinical ? 500 : 400, color: t.bright, letterSpacing: '-0.03em', lineHeight: 1 }}>9.2</span>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: t.inkSoft, letterSpacing: '0.08em' }}>OF 10</span>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 14, padding: '14px 28px 24px', height: 'calc(100% - 200px)' }}>
        {/* Left: orbital arc + transcript */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {realism !== 'normal' && window.DegradedNotice && (
            <window.DegradedNotice t={t}
              severity={realism === 'transcribing' ? 'info' : 'warn'}
              message={realism === 'transcribing'
                ? 'Transcript still processing — last 90 seconds will appear shortly.'
                : 'Audio quality dipped at 3:14. Two phrases below were transcribed with low confidence.'} />
          )}
          {/* Visualization — orbital arc (observatory) or timeline (clinical) */}
          {clinical && window.ClinicalCallTimeline ? (
            <window.ClinicalCallTimeline
              t={t} projMoments={projMoments}
              moment={moment} setMoment={setMoment}
              openCoach={openCoach} callLength="6:22" />
          ) : (() => {
            // Sky window: the orbital-arc visualization always renders against
            // a dark backdrop, even on a light page. Starfield + planet glow +
            // bright accent only earn their keep on dark. We re-token the SVG
            // internals to ORRERY_DARK so colors stay luminous; the moment
            // overlay sits as a light card floating over the dark inset.
            const isLightPage = t.name === 'light';
            const skyT = ORRERY_DARK;
            // Recompute moment fills with the sky theme so the brightness ramp
            // reads correctly against the dark backdrop.
            const skyMoments = projMoments.map((m) => ({
              ...m,
              color: m.tone === 'amber' ? skyT.amber
                : m.tone === 'green' ? skyT.green
                : brightToColor(m.br, skyT),
            }));
            return (
          <div style={{
            position: 'relative', borderRadius: 14,
            background: isLightPage
              ? 'radial-gradient(ellipse at 50% 35%, #0c1538 0%, #04081a 75%)'
              : t.panel,
            backdropFilter: isLightPage ? 'none' : 'blur(8px)',
            border: `0.5px solid ${isLightPage ? 'rgba(255,255,255,0.06)' : t.panelBorder}`,
            boxShadow: isLightPage
              ? 'inset 0 0 0 1px rgba(255,255,255,0.04), 0 1px 2px rgba(20,30,60,0.08)'
              : 'none',
            height: 240, overflow: 'hidden',
          }}>
            <svg viewBox="-22 -16 44 22" preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: '100%' }}>
              <OrreryStarfield t={skyT} count={20} spread={[20, 12]} />

              <defs>
                <radialGradient id="cd-planet" cx="0.4" cy="0.35" r="0.7">
                  <stop offset="0%" stopColor={skyT.cool} />
                  <stop offset="60%" stopColor={skyT.bright} />
                  <stop offset="100%" stopColor={skyT.starOuter} />
                </radialGradient>
              </defs>

              {/* The planet (Tx plan review) anchored at left-center */}
              <circle cx="-18" cy="0" r="3.5" fill="url(#cd-planet)" />
              <ellipse cx="-19" cy="-1" rx="1.4" ry="1" fill={skyT.highlight} opacity="0.5" />
              <ellipse cx="-18" cy="0" rx="6" ry="2.4" fill="none" stroke={skyT.ringStroke} strokeWidth="0.18" />
              <text x="-18" y="6" textAnchor="middle" fontFamily="'JetBrains Mono', monospace" fontSize="1.2" fill={skyT.inkMute} letterSpacing="0.1">TX PLAN</text>

              {/* The call's orbital arc */}
              <path
                d={`M ${skyMoments[0].px} ${skyMoments[0].py}
                    Q 0 -10 ${skyMoments[skyMoments.length - 1].px} ${skyMoments[skyMoments.length - 1].py}`}
                fill="none" stroke={skyT.bright} strokeWidth="0.15" strokeDasharray="0.4 0.3" opacity="0.6"
              />
              {/* Call body — small bright moon traveling the arc */}
              <ellipse cx="0" cy="0" rx="20" ry={20 * TILT} fill="none" stroke={skyT.orbit} strokeWidth="0.1" />

              {/* Moments */}
              {skyMoments.map((m) => {
                const isSel = m.idx === moment;
                return (
                  <g key={m.idx} onClick={() => setMoment(m.idx)} style={{ cursor: 'pointer' }}>
                    {isSel && <circle cx={m.px} cy={m.py} r="2.4" fill={m.color} opacity="0.18" />}
                    <circle cx={m.px} cy={m.py} r={isSel ? 1.0 : 0.7} fill={m.color} />
                    {isSel && <circle cx={m.px} cy={m.py} r="1.6" fill="none" stroke={m.color} strokeWidth="0.16" />}
                  </g>
                );
              })}

              {/* Time axis along arc */}
              <text x="-18" y="-9" fontSize="1.0" fill={skyT.inkMute} fontFamily="'JetBrains Mono', monospace">START 0:00</text>
              <text x="14" y="-9" fontSize="1.0" fill={skyT.inkMute} fontFamily="'JetBrains Mono', monospace">END 6:22</text>
            </svg>

            {/* Selected moment card */}
            {projMoments[moment] && (
              <div style={{
                position: 'absolute', bottom: 12, left: 14, right: 14,
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '8px 12px', borderRadius: 8,
                background: t.name === 'dark' ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.9)',
                border: `0.5px solid ${t.panelBorder}`,
              }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: projMoments[moment].color }} />
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: t.inkSoft }}>{projMoments[moment].time}</span>
                <span style={{ fontFamily: '"Inter", system-ui, sans-serif', fontStyle: 'italic', fontSize: 17, color: t.ink }}>{projMoments[moment].label}</span>
                <span style={{ fontSize: 11, color: t.inkSoft, flex: 1, lineHeight: 1.4 }}>
                  {projMoments[moment].label === 'Greeting' && 'Sarah opened warm. Asked Maria about her last visit.'}
                  {projMoments[moment].label === 'Concern' && 'Maria shared sensitivity in her upper right molar.'}
                  {projMoments[moment].label === 'Walkthrough' && 'Sarah explained the crown options on the screen.'}
                  {projMoments[moment].label === 'Cost' && 'Cost came up. Brief drop in tone.'}
                  {projMoments[moment].label === 'Insurance' && 'Sarah verified coverage live. Recovered the moment.'}
                  {projMoments[moment].label === 'Decision' && 'Maria said yes to the full plan.'}
                  {projMoments[moment].label === 'Schedule' && 'Booked for Thursday. Closed warm.'}
                </span>
                <button onClick={() => openCoach(projMoments[moment])} style={{
                  padding: '4px 10px', borderRadius: 5, fontSize: 11, fontWeight: 600,
                  background: `${t.bright}20`, color: t.bright,
                  border: `0.5px solid ${t.bright}55`, cursor: 'pointer', fontFamily: 'inherit',
                  whiteSpace: 'nowrap',
                }}>Coach this moment →</button>
                <button onClick={() => setMoment((moment + projMoments.length - 1) % projMoments.length)}
                  style={{ background: 'transparent', border: `0.5px solid ${t.panelBorder}`, color: t.inkSoft, cursor: 'pointer', padding: '4px 8px', borderRadius: 5, fontSize: 11 }}>‹</button>
                <button onClick={() => setMoment((moment + 1) % projMoments.length)}
                  style={{ background: 'transparent', border: `0.5px solid ${t.panelBorder}`, color: t.inkSoft, cursor: 'pointer', padding: '4px 8px', borderRadius: 5, fontSize: 11 }}>›</button>
              </div>
            )}
          </div>
          );
          })()}

          {/* Transcript with annotations */}
          <OrreryCard t={t} style={{ flex: 1, padding: '16px 18px', overflow: 'auto' }}>
            <OrreryTag t={t}>{clinical ? '◆' : '◇'} TRANSCRIPT · ANNOTATED</OrreryTag>
            <div style={{ marginTop: 14, fontSize: 13.5, lineHeight: 1.65, color: t.inkSoft }}>
              <div style={{ marginBottom: 14 }}>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10.5, color: t.inkMute, marginRight: 10 }}>00:14</span>
                <strong style={{ color: t.ink, fontWeight: 500 }}>Sarah:</strong> Hi Maria, how have you been since your last visit?
              </div>
              <div style={{ marginBottom: 14 }}>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10.5, color: t.inkMute, marginRight: 10 }}>01:22</span>
                <strong style={{ color: t.ink, fontWeight: 500 }}>Maria:</strong> Honestly, that upper right tooth has been bothering me for weeks now. ✦ <span style={{ color: t.amber, fontFamily: "'JetBrains Mono', monospace", fontSize: 10.5 }}>concern detected</span>
              </div>
              <div style={{ marginBottom: 14 }}>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10.5, color: t.inkMute, marginRight: 10 }}>02:48</span>
                <strong style={{ color: t.ink, fontWeight: 500 }}>Sarah:</strong> Let me walk you through what we found on the imaging
                {realism === 'low-confidence'
                  ? <>
                      <span style={{
                        background: `linear-gradient(transparent 60%, ${t.amber}33 60%)`,
                        textDecoration: 'underline wavy',
                        textDecorationColor: t.amber,
                        textUnderlineOffset: 3,
                      }} title="Low confidence transcript">… looks like there's some [unclear] near the apex</span>
                      <span style={{ color: t.amber, fontFamily: "'JetBrains Mono', monospace", fontSize: 10.5, marginLeft: 8 }}>{clinical ? '◆' : '◇'} LOW CONFIDENCE</span>
                    </>
                  : '…'}
              </div>
              <div style={{ marginBottom: 14 }}>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10.5, color: t.inkMute, marginRight: 10 }}>04:02</span>
                <strong style={{ color: t.ink, fontWeight: 500 }}>Maria:</strong> And how much will the crown be? ✦ <span style={{ color: t.amber, fontFamily: "'JetBrains Mono', monospace", fontSize: 10.5 }}>cost question</span>
              </div>
              <div style={{ marginBottom: 14 }}>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10.5, color: t.inkMute, marginRight: 10 }}>05:33</span>
                <strong style={{ color: t.ink, fontWeight: 500 }}>Maria:</strong> Okay, let's go ahead and do it. ✦ <span style={{ color: t.green, fontFamily: "'JetBrains Mono', monospace", fontSize: 10.5 }}>decision</span>
              </div>
            </div>
          </OrreryCard>
        </div>

        {/* Right: scorecards + AI notes */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <OrreryKpi t={t} plain={clinical} label="Duration" value="6:22" sub="" accentRamp="bright" />
            <OrreryKpi t={t} plain={clinical} label="Plan" value="$3.4k" sub="accepted" accentRamp="warm" />
          </div>

          <OrreryCard t={t}>
            <OrreryTag t={t}>{clinical ? '◆ DIMENSIONS' : '◇ DIMENSIONS'}</OrreryTag>
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                { l: 'Empathy',     v: 9.4 },
                { l: 'Clarity',     v: 9.0 },
                { l: 'Pacing',      v: 8.8 },
                { l: 'Recovery',    v: 9.6 },
                { l: 'Close',       v: 9.2 },
              ].map((d, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '90px 1fr 32px', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 11.5, color: t.inkSoft }}>{d.l}</span>
                  <div style={{ height: 4, background: t.panelBorder, borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ width: `${(d.v / 10) * 100}%`, height: '100%', background: `linear-gradient(90deg, ${t.warm}, ${t.bright})` }} />
                  </div>
                  <span style={{ fontFamily: '"Inter", system-ui, sans-serif', fontStyle: clinical ? 'normal' : 'italic', fontWeight: clinical ? 500 : 400, fontSize: 14, color: t.ink, textAlign: 'right' }}>{d.v}</span>
                </div>
              ))}
            </div>
          </OrreryCard>

          <OrreryCard t={t} style={{ flex: 1, background: `linear-gradient(135deg, ${t.bright}1a, ${t.starOuter}10)`, borderLeft: `2px solid ${t.bright}` }}>
            {/* Owl mascot stays in BOTH modes; tone-of-voice in the body shifts. */}
            {window.OwlSignature
              ? <window.OwlSignature t={t} verb="NOTED" timestamp="14:02"
                  confidence={realism === 'low-confidence' ? 'low' : realism === 'transcribing' ? 'med' : 'high'} />
              : <OrreryTag t={t}>◇ ORY'S NOTE</OrreryTag>}
            <div style={{ fontFamily: '"Inter", system-ui, sans-serif', fontStyle: clinical ? 'normal' : 'italic', fontWeight: clinical ? 500 : 400, fontSize: 17, lineHeight: 1.4, marginTop: 10, color: t.ink }}>
              {clinical
                ? 'Sentiment dropped briefly at the cost moment. Sarah\'s live insurance check recovered the call — textbook recovery sequence.'
                : 'The cost moment dimmed the orbit briefly. Sarah\'s live insurance check pulled the call back into the light — a textbook recovery.'}
            </div>
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: `0.5px solid ${t.panelBorder}` }}>
              <OrreryTag t={t} color={t.inkMute}>SIMILAR CALLS</OrreryTag>
              <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {['Tx plan review', 'Crowns & bridges', 'Ortho consult'].map((p, i) => (
                  <span key={i} style={{ fontSize: 10.5, padding: '4px 8px', background: `${t.bright}18`, color: t.bright, borderRadius: 12, fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.04em' }}>{p}</span>
                ))}
              </div>
            </div>
          </OrreryCard>
        </div>
      </div>

      {window.SendToCoachPanel && (
        <window.SendToCoachPanel t={t} open={coachOpen}
          onClose={() => setCoachOpen(false)} onSent={onCoachSent}
          callName={callName} agent="Sarah" callTime="09:14" callScore="9.2"
          moment={coachMoment} />
      )}
      {window.CoachSentToast && (
        <window.CoachSentToast t={t} open={sentToast} agent="Sarah"
          onView={() => { setSentToast(false); onNavigate && onNavigate('coaching'); }}
          onClose={() => setSentToast(false)} />
      )}
    </div>
  );
}

window.OrreryCallDetail = OrreryCallDetail;