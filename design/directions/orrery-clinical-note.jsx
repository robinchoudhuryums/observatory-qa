/* global React */
/* eslint-disable */
const { useState: useStateCN, useMemo: useMemoCN } = React;
const {
  ORRERY_LIGHT, ORRERY_DARK,
  OrreryTopBar, OrreryOwl, OrreryThemeToggle, OrreryStarfield,
  brightToColor,
} = window;

// =============================================================================
//  Clinical Note — workbench tier
//  The note is the page. Orrery vocabulary appears at the edges:
//    - completeness orb (header)            — quality as brightness
//    - status timeline arc                  — note's trajectory
//    - Ory's Note                           — single editorial moment
//    - transcript-as-arc (optional toggle)  — same data, two lenses
//  Generic medical (internal medicine) demo. SOAP format.
// =============================================================================

const NOTE_DATA = {
  patient: {
    name: 'Maria Hernandez',
    mrn: 'MRN 04-22817',
    age: 47,
    sex: 'F',
    encounterId: 'ENC-2026-0438',
  },
  provider: { name: 'Dr. Lena Park, MD', specialty: 'Internal Medicine' },
  encounter: {
    type: 'Established patient · follow-up',
    date: 'Apr 28, 2026',
    duration: '14 min',
  },
  format: 'SOAP',
  status: {
    completeness: 8.2,
    accuracy: 9.1,
    confidence: 'high',
    sectionDepth: {
      subjective: 'thorough',
      objective: 'adequate',
      assessment: 'thorough',
      plan: 'adequate',
    },
  },
  baseTimeline: [
    { id: 'rec',  label: 'Recorded',     time: '10:42 AM', done: true },
    { id: 'tx',   label: 'Transcribed',  time: '10:43 AM', done: true },
    { id: 'ai',   label: 'Drafted',      time: '10:44 AM', done: true, owl: true },
    { id: 'edit', label: 'Edited',       time: '11:08 AM', done: true, by: 'Dr. Park' },
  ],
  owlNote:
    'A 14-minute follow-up for hypertension. Two months on lisinopril 10 mg; the patient reports a dry cough that began three weeks ago and has not resolved. Home BP log averages 138/86. Plan favors switch to losartan, with labs in two weeks.',
  chiefComplaint: 'Persistent dry cough; follow-up of hypertension.',
  subjective:
    'Mrs. Hernandez is a 47-year-old woman with hypertension, on lisinopril 10 mg daily for two months, who returns reporting a persistent non-productive cough that began approximately three weeks ago. The cough is worse at night and on lying flat. She denies fever, dyspnea, hemoptysis, chest pain, or weight loss. No recent URI symptoms. She denies new exposures. Home BP log over the last two weeks averages 138/86, ranging 132/82 to 144/91. Adherence reported at "every morning, no missed doses." No edema, no orthopnea. Reviews of cardiac, respiratory, and constitutional systems otherwise negative.',
  objective:
    'Vitals: BP 142/88 (right arm, seated), HR 78, RR 16, SpO2 98% RA, Temp 36.8°C, Wt 71.2 kg.\nGeneral: Well-appearing, no acute distress.\nHEENT: Oropharynx clear, no erythema. No cervical lymphadenopathy.\nCardiac: RRR, no murmurs, rubs, or gallops.\nLungs: Clear to auscultation bilaterally, no wheeze, no crackles.\nExtremities: No peripheral edema.',
  assessment: [
    { dx: 'ACE-inhibitor–induced cough, suspected', detail: 'Timing (3 weeks of cough, 2 months on lisinopril) and symptom pattern (dry, worse supine) consistent with ACEi-related cough.' },
    { dx: 'Essential hypertension, suboptimally controlled', detail: 'Home log average 138/86; in-office 142/88. Will transition to ARB and reassess in 2 weeks.' },
  ],
  plan: [
    'Discontinue lisinopril.',
    'Start losartan 50 mg PO once daily.',
    'BMP and lipid panel to be drawn today.',
    'Patient to continue home BP log; bring to next visit.',
    'Return in 2 weeks for BP and cough reassessment; sooner if dyspnea, swelling, or syncope.',
    'Reviewed medication change, expected resolution of cough within 1–4 weeks.',
  ],
  codes: {
    icd10: [
      { code: 'I10',      desc: 'Essential (primary) hypertension' },
      { code: 'R05.9',    desc: 'Cough, unspecified' },
      { code: 'T46.4X5A', desc: 'Adverse effect of ACE inhibitors, initial' },
    ],
    cpt: [
      { code: '99213', desc: 'Office visit, established, low MDM (15 min)' },
      { code: '36415', desc: 'Routine venipuncture' },
    ],
  },
  toCheck: [
    { kind: 'missing', text: 'Allergy review not documented this encounter.' },
    { kind: 'missing', text: 'Smoking-status update not captured (last documented 14 mo ago).' },
    { kind: 'flag',    text: 'ICD T46.4X5A is initial-encounter; verify this is the patient\'s first reported ACEi reaction.' },
  ],
  transcriptArc: [
    { t: 0,    label: 'Greeting',                kind: 'open' },
    { t: 0.10, label: 'Cough disclosed',         kind: 'signal',   bright: 0.85 },
    { t: 0.22, label: 'Timing: 3 weeks',         kind: 'data' },
    { t: 0.34, label: 'Adherence',               kind: 'data' },
    { t: 0.46, label: 'Home BP log',             kind: 'data' },
    { t: 0.58, label: 'Vitals + exam',           kind: 'exam' },
    { t: 0.74, label: 'ACEi cough explained',    kind: 'signal',   bright: 0.95 },
    { t: 0.86, label: 'Switch to losartan',      kind: 'decision' },
    { t: 0.94, label: 'Labs + 2-wk follow-up',   kind: 'decision' },
    { t: 1.00, label: 'Closing',                 kind: 'close' },
  ],
  amendmentSummary: 'Added: clarified that BMP and lipid panel were drawn today (was unspecified). Clarification only; no change to medical decision-making.',
  amendmentBy: 'Dr. Lena Park',
  amendmentTime: 'Apr 30, 11:14 AM',
};

// ---------------- helpers ----------------

const TRANSCRIPT_TEXT = `[10:42] PARK: Hi Maria. How are you doing today?
[10:42] PATIENT: Honestly, this cough is wearing me out. It's been about three weeks, dry, gets worse at night.
[10:43] PARK: Any fever, shortness of breath, blood?
[10:43] PATIENT: No, none of that. Just the cough. Worse when I lie down.
[10:43] PARK: When did you start the lisinopril again?
[10:43] PATIENT: Two months ago. Every morning, no missed days.
[10:44] PARK: And your home BP log — how are the numbers running?
[10:44] PATIENT: I averaged it last week. Around 138 over 86. Highest was maybe 144.
[10:45] PARK: I'm going to listen to your chest and check your blood pressure here, then we'll talk about what's going on.
[10:48] PARK: Lungs are clear, heart sounds normal, no swelling. Pressure today is 142 over 88.
[10:50] PARK: I think the cough is from the lisinopril. It's a known side effect — about one in ten people get it. Switching you to losartan, same family of effect on blood pressure, no cough.
...`;

// Clinical-mode replacement for the orb: compact horizontal bar.
function ClinicalCompletenessGauge({ value, t, width = 120 }) {
  const pct = Math.max(0, Math.min(1, value / 10)) * 100;
  return (
    <div style={{ width, paddingTop: 6 }}>
      <div style={{
        height: 6, background: t.panelBorder, borderRadius: 3, overflow: 'hidden',
      }}>
        <div style={{
          width: `${pct}%`, height: '100%',
          background: `linear-gradient(90deg, ${t.warm}, ${t.bright})`,
        }} />
      </div>
      <div style={{
        marginTop: 8, fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5,
        letterSpacing: '0.10em', color: t.inkMute, textTransform: 'uppercase',
        textAlign: 'right',
      }}>{Math.round(pct)}%</div>
    </div>
  );
}

function CompletenessOrb({ value, t, size = 68 }) {
  const v = Math.max(0, Math.min(1, value / 10));
  const bright = 0.35 + v * 0.6;
  const fill = brightToColor(bright, t);
  const cx = size / 2, cy = size / 2;
  const r = size * 0.32;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: 'block' }}>
      <defs>
        <radialGradient id="cn-orb-gloss" cx="35%" cy="30%" r="60%">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx={cx} cy={cy} r={r * 1.55} fill="none" stroke={t.panelBorder} strokeWidth="0.75" />
      <circle cx={cx} cy={cy} r={r}
        fill={fill}
        style={{ filter: `drop-shadow(0 0 ${size * 0.18}px ${fill})` }} />
      <circle cx={cx} cy={cy} r={r} fill="url(#cn-orb-gloss)" opacity="0.18" />
    </svg>
  );
}

// Clinical-mode replacement for the trajectory arc: horizontal stepper.
function ClinicalStatusStepper({ steps, t }) {
  return (
    <div style={{ display: 'flex', alignItems: 'stretch', padding: '4px 0' }}>
      {steps.map((s, i) => (
        <React.Fragment key={s.id}>
          <div style={{ flex: '0 0 auto', minWidth: 110, textAlign: 'center', position: 'relative' }}>
            <div style={{
              fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5,
              letterSpacing: '0.12em', color: s.done ? t.ink : t.inkMute,
              textTransform: 'uppercase', fontWeight: s.done ? 600 : 400,
            }}>{s.label}</div>
            <div style={{
              marginTop: 10, marginBottom: 10,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              height: 14, position: 'relative',
            }}>
              <div style={{
                width: 10, height: 10, borderRadius: '50%',
                background: s.done ? (s.owl ? t.warm : t.bright) : 'transparent',
                border: s.done ? 'none' : `1px dashed ${t.inkMute}`,
                boxShadow: s.done ? `0 0 0 3px ${(s.owl ? t.warm : t.bright)}22` : 'none',
                zIndex: 1,
              }} />
            </div>
            <div style={{
              fontFamily: "'JetBrains Mono', monospace", fontSize: 9,
              letterSpacing: '0.08em', color: t.inkMute,
            }}>{s.time}</div>
            {(s.owl || s.by) && (
              <div style={{
                fontSize: 10, color: s.owl ? t.warm : t.inkMute, marginTop: 3,
                fontWeight: 500,
              }}>
                {s.owl ? 'by Ory' : s.by}
              </div>
            )}
          </div>
          {i < steps.length - 1 && (
            <div style={{
              flex: 1, height: 1, background: t.panelBorder, alignSelf: 'flex-start',
              marginTop: 33,
            }} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

// 4-point sparkle/star "+" shape with optional diagonal mini-rays.
// Drawn as a filled SVG path so it scales cleanly and reads as a star.
function SparkleStar({ cx, cy, r, color, withDiagonals = false, opacity = 1 }) {
  // Length of each main spike from center
  const spike = r * 2.4;
  // Width of the spike at the base (gives the 4-point pinch)
  const w = r * 0.55;
  const d = [
    `M ${cx} ${cy - spike}`,
    `L ${cx + w} ${cy - w}`,
    `L ${cx + spike} ${cy}`,
    `L ${cx + w} ${cy + w}`,
    `L ${cx} ${cy + spike}`,
    `L ${cx - w} ${cy + w}`,
    `L ${cx - spike} ${cy}`,
    `L ${cx - w} ${cy - w}`,
    'Z',
  ].join(' ');
  return (
    <g opacity={opacity}>
      {withDiagonals && (
        <g opacity="0.55">
          <line x1={cx - r * 1.4} y1={cy - r * 1.4} x2={cx + r * 1.4} y2={cy + r * 1.4}
            stroke={color} strokeWidth="0.5" strokeLinecap="round" />
          <line x1={cx - r * 1.4} y1={cy + r * 1.4} x2={cx + r * 1.4} y2={cy - r * 1.4}
            stroke={color} strokeWidth="0.5" strokeLinecap="round" />
        </g>
      )}
      <path d={d} fill={color} />
    </g>
  );
}

function StatusTimelineArc({ steps, t, variant = 'subtle' }) {
  if (variant === 'constellation') return <ConstellationTimeline steps={steps} t={t} />;
  // 'subtle' (default Option A) and 'bold' (amped Option A) share the arc
  // layout; 'bold' dials starfield density up, makes the comet trail thick
  // and luminous, and uses 4-point sparkle stars at each done step instead
  // of plain dots-with-rays.
  const bold = variant === 'bold';
  const W = 520, H = 110;
  const r = 350;
  const cx = W / 2;
  const cy = 60 + r; // arc apex at y = 60
  const halfSpan = 0.62;
  const startA = -Math.PI / 2 - halfSpan;
  const endA = -Math.PI / 2 + halfSpan;
  const pointAt = (frac) => {
    const a = startA + (endA - startA) * frac;
    return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
  };
  const a0 = pointAt(0), a1 = pointAt(1);
  const arcPath = `M ${a0.x.toFixed(2)} ${a0.y.toFixed(2)} A ${r} ${r} 0 0 1 ${a1.x.toFixed(2)} ${a1.y.toFixed(2)}`;

  // Comet trail: from start to the last-completed step.
  let lastDoneIdx = -1;
  for (let i = steps.length - 1; i >= 0; i--) { if (steps[i].done) { lastDoneIdx = i; break; } }
  const lastDoneFrac = lastDoneIdx <= 0
    ? 0
    : (steps.length === 1 ? 1 : lastDoneIdx / (steps.length - 1));
  const trailEnd = pointAt(lastDoneFrac);
  const trailPath = lastDoneFrac > 0
    ? `M ${a0.x.toFixed(2)} ${a0.y.toFixed(2)} A ${r} ${r} 0 0 1 ${trailEnd.x.toFixed(2)} ${trailEnd.y.toFixed(2)}`
    : '';

  // Starfield: deterministic scatter behind the arc. Bold uses more, brighter.
  const starCount = bold ? 56 : 32;
  const starfield = Array.from({ length: starCount }).map((_, i) => {
    const x = (Math.sin(i * 7.91 + 0.3) + 1) * 0.5 * W;
    const y = (Math.cos(i * 5.13 + 1.1) + 1) * 0.5 * (H - 18);
    const op = (bold ? 0.30 : 0.18) + ((Math.sin(i * 3.41) + 1) * (bold ? 0.30 : 0.18));
    const sr = (bold ? 0.55 : 0.45) + ((Math.cos(i * 2.7) + 1) * (bold ? 0.45 : 0.30));
    return { x, y, op, r: sr, key: i };
  });

  const starfieldFill = t.starfield || t.ink;
  // Light-mode default starfieldOpacity is ~0.10, which reads as barely-there.
  // In 'bold' we boost it (especially in light mode) so the constellation feel
  // actually carries. Dark mode already has 0.55 baseline.
  const baseSfOp = t.starfieldOpacity != null ? t.starfieldOpacity : 0.55;
  const starfieldOp = bold
    ? Math.max(baseSfOp, t.name === 'dark' ? 0.80 : 0.55)
    : baseSfOp;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet"
      style={{ display: 'block', overflow: 'visible' }}>
      {/* starfield backdrop */}
      {starfield.map((s) => (
        <circle key={'sf' + s.key} cx={s.x} cy={s.y} r={s.r}
          fill={starfieldFill} opacity={s.op * starfieldOp} />
      ))}

      {/* dashed full path (the orbit the note follows) */}
      <path d={arcPath} fill="none" stroke={t.panelBorder}
        strokeWidth={bold ? '0.9' : '0.75'}
        strokeDasharray={bold ? '3 4' : '2 3'} />

      {/* comet trail — wide soft glow + narrower bright stroke.
          Bold variant: thicker, more layers, stronger glow. */}
      {trailPath && (bold ? (
        <g>
          <path d={trailPath} fill="none" stroke={t.bright} strokeWidth="12"  opacity="0.10" strokeLinecap="round" />
          <path d={trailPath} fill="none" stroke={t.bright} strokeWidth="7"   opacity="0.22" strokeLinecap="round" />
          <path d={trailPath} fill="none" stroke={t.bright} strokeWidth="3.5" opacity="0.55" strokeLinecap="round" />
          <path d={trailPath} fill="none" stroke={t.starCore || '#fff'} strokeWidth="1.4" opacity="0.95" strokeLinecap="round" />
          <circle cx={trailEnd.x} cy={trailEnd.y} r="16" fill={t.bright} opacity="0.10" />
          <circle cx={trailEnd.x} cy={trailEnd.y} r="10" fill={t.bright} opacity="0.22" />
          <circle cx={trailEnd.x} cy={trailEnd.y} r="6"  fill={t.bright} opacity="0.55" />
          <circle cx={trailEnd.x} cy={trailEnd.y} r="2.6" fill={t.starCore || '#fff'} opacity="1" />
        </g>
      ) : (
        <g>
          <path d={trailPath} fill="none" stroke={t.bright} strokeWidth="6"   opacity="0.10" strokeLinecap="round" />
          <path d={trailPath} fill="none" stroke={t.bright} strokeWidth="2.5" opacity="0.32" strokeLinecap="round" />
          <path d={trailPath} fill="none" stroke={t.bright} strokeWidth="0.9" opacity="0.85" strokeLinecap="round" />
          <circle cx={trailEnd.x} cy={trailEnd.y} r="10" fill={t.bright} opacity="0.18" />
          <circle cx={trailEnd.x} cy={trailEnd.y} r="4.5" fill={t.bright} opacity="0.45" />
        </g>
      ))}

      {steps.map((s, i) => {
        const p = pointAt(steps.length === 1 ? 0.5 : i / (steps.length - 1));
        const dotR = s.done ? (bold ? 6.5 : 5.5) : 4;
        const fill = s.done ? (s.owl ? t.warm : t.bright) : 'transparent';
        const stroke = s.done ? 'transparent' : t.inkMute;
        const rayLen = dotR * 2.2;
        return (
          <g key={s.id}>
            {s.done && bold && (
              <circle cx={p.x} cy={p.y} r={dotR + 10} fill={fill} opacity="0.10" />
            )}
            {s.done && <circle cx={p.x} cy={p.y} r={dotR + (bold ? 6 : 4)} fill={fill} opacity={bold ? 0.28 : 0.18} />}

            {s.done ? (
              bold
                ? <SparkleStar cx={p.x} cy={p.y} r={dotR * 0.95} color={fill} withDiagonals />
                : (
                  <g>
                    <g opacity="0.78">
                      <line x1={p.x - rayLen} y1={p.y} x2={p.x + rayLen} y2={p.y}
                        stroke={fill} strokeWidth="0.6" strokeLinecap="round" />
                      <line x1={p.x} y1={p.y - rayLen} x2={p.x} y2={p.y + rayLen}
                        stroke={fill} strokeWidth="0.6" strokeLinecap="round" />
                    </g>
                    <circle cx={p.x} cy={p.y} r={dotR} fill={fill} />
                  </g>
                )
            ) : (
              <circle cx={p.x} cy={p.y} r={dotR} fill="transparent" stroke={stroke}
                strokeWidth="1" strokeDasharray="2 2" />
            )}

            <text x={p.x} y={p.y - 14} fontFamily="JetBrains Mono, monospace" fontSize="9.5"
              letterSpacing="0.10em" textAnchor="middle"
              fill={s.done ? t.ink : t.inkMute}
              fontWeight={bold && s.done ? '600' : '400'}
              style={{ textTransform: 'uppercase' }}>
              {s.label}
            </text>
            <text x={p.x} y={p.y + 18} fontFamily="JetBrains Mono, monospace" fontSize="8.5"
              letterSpacing="0.06em" textAnchor="middle"
              fill={t.inkMute} opacity="0.85">
              {s.time}
            </text>
            {(s.owl || s.by) && (
              <text x={p.x} y={p.y + 30} fontFamily='"Inter", system-ui, sans-serif' fontStyle="italic"
                fontSize="10" textAnchor="middle" fill={s.owl ? t.warm : t.inkMute}>
                {s.owl ? 'by Ory' : s.by}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ──────────────────────────────────────────────────────────────────────────
//  ConstellationTimeline (Option B)
//  Five milestones become five stars arranged as a Cassiopeia-like W. Lines
//  connect them in sequence as steps complete; a faint dashed "predicted"
//  path shows the constellation that will form. When all five are done, the
//  full W lights up.
// ──────────────────────────────────────────────────────────────────────────
function ConstellationTimeline({ steps, t: pageT }) {
  // The constellation always renders against a dark "sky window" — even when
  // the page is in light theme. Tiny starfield + bright-accent strokes only
  // earn their keep against deep navy; pasting them onto a pale page muddies
  // the effect. We swap to ORRERY_DARK locally for SVG fills/strokes, and
  // wrap the SVG in a dark inset card so the embedded sky feels intentional
  // rather than tonally jarring against a light page shell.
  const t = window.ORRERY_DARK || pageT;
  const isLightPage = pageT.name === 'light';
  const W = 520, H = 110;
  const padX = 60, padY = 30;
  const innerW = W - padX * 2;
  const innerH = H - padY * 2;
  // Cassiopeia-style W zig-zag (normalized 0..1)
  const norm = [
    [0.00, 0.70],
    [0.25, 0.18],
    [0.50, 0.85],
    [0.75, 0.22],
    [1.00, 0.60],
  ];
  const tilt = -0.06;
  const cosT = Math.cos(tilt), sinT = Math.sin(tilt);
  const cx0 = W / 2, cy0 = H / 2;
  const positions = norm.map(([nx, ny]) => {
    const x0 = padX + nx * innerW;
    const y0 = padY + ny * innerH;
    const dx = x0 - cx0, dy = y0 - cy0;
    return {
      x: cx0 + dx * cosT - dy * sinT,
      y: cy0 + dx * sinT + dy * cosT,
    };
  });
  const used = positions.slice(0, steps.length);

  // Starfield backdrop — boosted so it reads in both modes.
  const starfieldFill = t.starfield || t.ink;
  const baseSfOp = t.starfieldOpacity != null ? t.starfieldOpacity : 0.55;
  const starfieldOp = Math.max(baseSfOp, t.name === 'dark' ? 0.70 : 0.40);
  const starfield = Array.from({ length: 44 }).map((_, i) => {
    const x = (Math.sin(i * 7.91 + 0.3) + 1) * 0.5 * W;
    const y = (Math.cos(i * 5.13 + 1.1) + 1) * 0.5 * (H - 18);
    const op = 0.20 + ((Math.sin(i * 3.41) + 1) * 0.25);
    const sr = 0.40 + ((Math.cos(i * 2.7) + 1) * 0.35);
    return { x, y, op, r: sr, key: i };
  });

  const lineDrawn = (i) => steps[i + 1] && steps[i + 1].done;
  const allDone = steps.every((s) => s.done);

  const svg = (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet"
      style={{ display: 'block', overflow: 'visible' }}>
      {starfield.map((s) => (
        <circle key={'sf' + s.key} cx={s.x} cy={s.y} r={s.r}
          fill={starfieldFill} opacity={s.op * starfieldOp} />
      ))}

      {/* predicted (dashed) skeleton */}
      {used.map((p, i) => {
        if (i === used.length - 1) return null;
        const a = p, b = used[i + 1];
        return (
          <line key={'pred' + i}
            x1={a.x} y1={a.y} x2={b.x} y2={b.y}
            stroke={t.panelBorder} strokeWidth="0.8" strokeDasharray="2 3" />
        );
      })}

      {/* drawn (bright) lines */}
      {used.map((p, i) => {
        if (i === used.length - 1) return null;
        if (!lineDrawn(i)) return null;
        const a = p, b = used[i + 1];
        return (
          <g key={'drawn' + i}>
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y}
              stroke={t.bright} strokeWidth="3.5" opacity="0.22" strokeLinecap="round" />
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y}
              stroke={t.bright} strokeWidth="1.4" opacity="0.85" strokeLinecap="round" />
          </g>
        );
      })}

      {/* Stars — circular nodes (filled disc + halo, no 4-point spike) */}
      {used.map((p, i) => {
        const s = steps[i];
        const fill = s.done ? (s.owl ? t.warm : t.bright) : 'transparent';
        const stroke = s.done ? 'transparent' : t.inkMute;
        const above = norm[i][1] > 0.5;
        const labelY  = above ? p.y - 14 : p.y + 16;
        const timeY   = above ? p.y - 26 : p.y + 28;
        const attribY = above ? p.y - 38 : p.y + 40;
        return (
          <g key={s.id}>
            {s.done ? (
              <>
                {/* outer soft halo + inner halo + filled disc + bright center pip */}
                <circle cx={p.x} cy={p.y} r={14} fill={fill} opacity="0.10" />
                <circle cx={p.x} cy={p.y} r={9}  fill={fill} opacity="0.22" />
                <circle cx={p.x} cy={p.y} r={5.5} fill={fill} />
                <circle cx={p.x} cy={p.y} r={1.4} fill={t.starCore || '#fff'} opacity="0.9" />
              </>
            ) : (
              <circle cx={p.x} cy={p.y} r={4} fill="transparent" stroke={stroke}
                strokeWidth="1" strokeDasharray="2 2" />
            )}

            <text x={p.x} y={labelY} fontFamily="JetBrains Mono, monospace" fontSize="9.5"
              letterSpacing="0.10em" textAnchor="middle"
              fill={s.done ? t.ink : t.inkMute}
              fontWeight={s.done ? '600' : '400'}
              style={{ textTransform: 'uppercase' }}>
              {s.label}
            </text>
            <text x={p.x} y={timeY} fontFamily="JetBrains Mono, monospace" fontSize="8.5"
              letterSpacing="0.06em" textAnchor="middle"
              fill={t.inkMute} opacity="0.85">
              {s.time}
            </text>
            {(s.owl || s.by) && (
              <text x={p.x} y={attribY} fontFamily='"Inter", system-ui, sans-serif' fontStyle="italic"
                fontSize="10" textAnchor="middle" fill={s.owl ? t.warm : t.inkMute}>
                {s.owl ? 'by Ory' : s.by}
              </text>
            )}
          </g>
        );
      })}

      {allDone && (
        <text x={W / 2} y={H - 4}
          textAnchor="middle"
          fontFamily="JetBrains Mono, monospace" fontSize="9"
          letterSpacing="0.18em" fill={t.bright} opacity="0.85">
          ✦ CONSTELLATION COMPLETE
        </text>
      )}
    </svg>
  );

  // Dark inset card. Slightly inset margins so the sky window doesn't run
  // edge-to-edge of its host column.
  return (
    <div style={{
      borderRadius: 12,
      background: isLightPage
        // Deep navy radial that fades to flatter navy at the rim — gives the
        // inset a subtle "looking up at the sky" depth, not a flat tile.
        ? 'radial-gradient(ellipse at 50% 35%, #0c1538 0%, #04081a 75%)'
        // In dark-page mode, no need for the heavy gradient; let it blend.
        : 'rgba(8, 14, 40, 0.55)',
      // Faint inner highlight so the edge reads as a window frame.
      boxShadow: isLightPage
        ? 'inset 0 0 0 1px rgba(255,255,255,0.04), 0 1px 2px rgba(20,30,60,0.08)'
        : 'inset 0 0 0 1px rgba(255,255,255,0.04)',
      padding: '14px 12px 8px',
      margin: isLightPage ? '4px 0 0' : 0,
    }}>
      {svg}
    </div>
  );
}

function TranscriptArc({ moments, t }) {
  // Shallow arc within the viewBox; circle center sits below the bottom edge.
  const W = 880, H = 220;
  const r = 900;
  const cx = W / 2;
  const cy = 80 + r; // arc apex at y = 80, leaving room for above-arc labels at y ~ 40-60
  const halfSpan = 0.46; // open enough that 10 moments span the arc legibly
  const startA = -Math.PI / 2 - halfSpan;
  const endA = -Math.PI / 2 + halfSpan;
  const pointAt = (frac) => {
    const a = startA + (endA - startA) * frac;
    return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
  };
  const a0 = pointAt(0), a1 = pointAt(1);
  const arcPath = `M ${a0.x.toFixed(2)} ${a0.y.toFixed(2)} A ${r} ${r} 0 0 1 ${a1.x.toFixed(2)} ${a1.y.toFixed(2)}`;
  const colorFor = (kind) => {
    if (kind === 'signal') return t.warm;
    if (kind === 'decision') return t.bright;
    if (kind === 'exam') return t.cool;
    if (kind === 'open' || kind === 'close') return t.inkMute;
    return t.cold;
  };
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet"
      style={{ display: 'block', overflow: 'visible' }}>
      <path d={arcPath} fill="none" stroke={t.panelBorder} strokeWidth="0.75" />
      {[0, 0.25, 0.5, 0.75, 1].map((f, i) => {
        const p = pointAt(f);
        return <circle key={'tk'+i} cx={p.x} cy={p.y} r="1.5" fill={t.inkMute} opacity="0.5" />;
      })}
      {moments.map((m, i) => {
        const p = pointAt(m.t);
        const c = colorFor(m.kind);
        const r0 = m.kind === 'signal' ? 5.5 : m.kind === 'decision' ? 5 : 3.2;
        const halo = m.kind === 'signal' || m.kind === 'decision';
        const above = i % 2 === 0;
        return (
          <g key={i}>
            {halo && <circle cx={p.x} cy={p.y} r={r0 + 5} fill={c} opacity="0.22" />}
            <circle cx={p.x} cy={p.y} r={r0} fill={c}
              style={{ filter: halo ? `drop-shadow(0 0 8px ${c})` : 'none' }} />
            <line x1={p.x} y1={p.y} x2={p.x} y2={p.y + (above ? -14 : 14)}
              stroke={t.panelBorder} strokeWidth="0.5" />
            <text x={p.x} y={p.y + (above ? -20 : 26)}
              fontFamily='"Inter", system-ui, sans-serif' fontStyle="italic" fontSize="13"
              textAnchor="middle" fill={t.ink}>
              {m.label}
            </text>
            <text x={p.x} y={p.y + (above ? -34 : 40)}
              fontFamily="JetBrains Mono, monospace" fontSize="8.5" letterSpacing="0.10em"
              textAnchor="middle" fill={t.inkMute} style={{ textTransform: 'uppercase' }}>
              {m.kind}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function DepthPip({ depth, t }) {
  const map = { empty: 0.15, minimal: 0.35, adequate: 0.6, thorough: 0.9 };
  const v = map[depth] ?? 0.5;
  const c = brightToColor(v, t);
  return (
    <span style={{
      display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
      background: c, boxShadow: `0 0 6px ${c}`, marginRight: 6, verticalAlign: 'middle',
    }} />
  );
}

function StatusBadge({ state, t, clinical = false }) {
  const m = {
    draft:    { fg: t.amber, bg: 'rgba(192,138,45,0.14)', label: 'DRAFT · NEEDS ATTESTATION' },
    attested: { fg: t.green, bg: 'rgba(34,160,107,0.14)', label: 'ATTESTED' },
    amended:  { fg: t.warm,  bg: 'rgba(34,184,207,0.16)', label: 'ATTESTED · AMENDED' },
  }[state];
  return (
    <span style={{
      fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.12em',
      color: m.fg, background: m.bg, padding: '5px 9px', borderRadius: 5,
      textTransform: 'uppercase',
    }}>
      {clinical ? '◆' : '◇'} {m.label}
    </span>
  );
}

// ---------------- main ----------------

function OrreryClinicalNote({ theme = 'light', onThemeChange, onNavigate, state = 'draft', presentation = 'observatory', onPresentationChange = null, noteTrajectoryStyle = 'subtle' }) {
  const setTheme = (next) => { if (onThemeChange) onThemeChange(next); };
  const t = theme === 'light' ? ORRERY_LIGHT : ORRERY_DARK;
  const clinical = presentation === 'clinical';
  const [transcriptOpen, setTranscriptOpen] = useStateCN(false);
  const [arcMode, setArcMode] = useStateCN(false);

  const data = useMemoCN(() => {
    const d = JSON.parse(JSON.stringify(NOTE_DATA));
    // The MAIN SPINE always ends at Attested. Amendments are post-completion
    // events surfaced separately as Revisions chips — not extra milestones —
    // because they're optional and a note can have 0..N of them.
    d.timeline = d.baseTimeline.slice();
    d.revisions = [];
    if (state === 'draft') {
      d.timeline.push({ id: 'att', label: 'Attested', time: '— pending', done: false });
    } else if (state === 'attested') {
      d.timeline.push({ id: 'att', label: 'Attested', time: '11:11 AM', done: true, by: 'Dr. Park' });
    } else if (state === 'amended') {
      d.timeline.push({ id: 'att', label: 'Attested', time: '11:11 AM', done: true, by: 'Dr. Park' });
      d.revisions.push({
        version: 2,
        time: 'Apr 30, 11:14 AM',
        by: d.amendmentBy,
        summary: d.amendmentSummary,
      });
    }
    return d;
  }, [state]);

  const sectionTitle = (n, label) => (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 8 }}>
      <span style={{
        fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.16em',
        color: t.inkMute, textTransform: 'uppercase',
      }}>{n}</span>
      <h2 style={{
        fontFamily: '"Inter", system-ui, sans-serif',
        fontStyle: clinical ? 'normal' : 'italic',
        fontWeight: clinical ? 500 : 400,
        fontSize: 26, letterSpacing: '-0.01em', color: t.ink, margin: 0,
      }}>{label}</h2>
      <span style={{ flex: 1, borderTop: `0.5px solid ${t.panelStroke}`, marginTop: 16 }} />
      <span style={{
        fontFamily: 'JetBrains Mono, monospace', fontSize: 9.5, letterSpacing: '0.10em',
        color: t.inkMute, textTransform: 'uppercase',
      }}>
        <DepthPip depth={data.status.sectionDepth[label.toLowerCase()]} t={t} />
        {data.status.sectionDepth[label.toLowerCase()]}
      </span>
    </div>
  );

  return (
    <div style={{
      minHeight: '100vh', background: t.bg, color: t.ink, position: 'relative', overflow: 'hidden',
    }}>
      {/* halo (observatory only) */}
      {!clinical && (
        <div style={{
          position: 'absolute', top: '8%', right: '15%',
          width: 520, height: 280, borderRadius: '50%',
          background: t.haloBg, filter: 'blur(140px)', pointerEvents: 'none', zIndex: 0,
        }} />
      )}

      <OrreryTopBar t={t} view="NOTE" activeNav="Calls" presentation={presentation} onNavigate={onNavigate}
        extra={<>
          {window.PresentationBadge && onPresentationChange && (
            <window.PresentationBadge t={t} mode={presentation}
              onClick={() => onPresentationChange(clinical ? 'observatory' : 'clinical')} />
          )}
          <OrreryThemeToggle theme={theme} t={t} onToggle={() => setTheme(theme === 'light' ? 'dark' : 'light')} />
        </>}
      />

      <div style={{ position: 'relative', zIndex: 1, maxWidth: 1280, margin: '0 auto', padding: '24px 32px 64px' }}>

        {/* breadcrumb */}
        <div style={{
          fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.14em',
          color: t.inkMute, textTransform: 'uppercase', marginBottom: 18,
        }}>
          <span style={{ cursor: 'pointer' }} onClick={() => onNavigate && onNavigate('dashboard')}>{clinical ? 'Dashboard' : 'Atlas'}</span>
          <span style={{ margin: '0 8px', opacity: 0.5 }}>›</span>
          <span style={{ cursor: 'pointer' }} onClick={() => onNavigate && onNavigate('call', { callName: data.patient.name })}>Calls</span>
          <span style={{ margin: '0 8px', opacity: 0.5 }}>›</span>
          <span style={{ color: t.ink }}>{data.patient.name} · clinical note</span>
        </div>

        {/* header strip */}
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr auto', gap: 24, alignItems: 'flex-start',
          paddingBottom: 22, borderBottom: `0.5px solid ${t.panelBorder}`,
        }}>
          <div>
            <div style={{
              fontFamily: 'JetBrains Mono, monospace', fontSize: 10.5, letterSpacing: '0.16em',
              color: t.bright, textTransform: 'uppercase',
            }}>
              {clinical ? '◆' : '◇'} {data.encounter.type}
            </div>
            <h1 style={{
              fontFamily: '"Inter", system-ui, sans-serif', fontWeight: clinical ? 500 : 400,
              fontSize: 42, letterSpacing: '-0.02em', margin: '6px 0 4px', color: t.ink, lineHeight: 1.1,
            }}>
              {data.patient.name} <span style={{ color: t.inkMute, fontStyle: clinical ? 'normal' : 'italic' }}>· {data.format} note</span>
            </h1>
            <div style={{ fontSize: 13, color: t.inkSoft, lineHeight: 1.55, marginTop: 4 }}>
              {data.patient.age}{data.patient.sex} · {data.patient.mrn} · {data.encounter.date} · {data.encounter.duration}
              <span style={{ margin: '0 10px', color: t.inkMute }}>·</span>
              {data.provider.name} · {data.provider.specialty}
            </div>
            <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <StatusBadge state={state} t={t} clinical={clinical} />
              <span style={{
                fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.12em',
                color: t.inkMute, padding: '5px 9px', border: `0.5px solid ${t.panelBorder}`, borderRadius: 5,
              }}>{data.patient.encounterId}</span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{
                fontFamily: 'JetBrains Mono, monospace', fontSize: 9.5, letterSpacing: '0.14em',
                color: t.inkMute, textTransform: 'uppercase',
              }}>Completeness</div>
              <div style={{
                fontFamily: '"Inter", system-ui, sans-serif',
                fontStyle: clinical ? 'normal' : 'italic',
                fontWeight: clinical ? 500 : 400,
                fontSize: 36, lineHeight: 1, color: t.ink, marginTop: 2,
              }}>
                {data.status.completeness.toFixed(1)}<span style={{ color: t.inkMute, fontSize: 18 }}>/10</span>
              </div>
              <div style={{ fontSize: 11, color: t.inkSoft, marginTop: 4 }}>
                Confidence: <strong style={{ color: t.ink, fontWeight: 500 }}>{data.status.confidence}</strong>
              </div>
            </div>
            {clinical
              ? <ClinicalCompletenessGauge value={data.status.completeness} t={t} />
              : <CompletenessOrb value={data.status.completeness} t={t} size={68} />}
          </div>
        </div>

        {/* trajectory — always 5 milestones ending at Attested */}
        <div style={{ margin: '24px 0 16px' }}>
          <div style={{
            fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.14em',
            color: t.inkMute, textTransform: 'uppercase', marginBottom: 6,
          }}>{clinical ? 'Note status' : 'Note trajectory'}</div>
          {clinical
            ? <ClinicalStatusStepper steps={data.timeline} t={t} />
            : <StatusTimelineArc steps={data.timeline} t={t} variant={noteTrajectoryStyle} />}
        </div>

        {/* Revisions — 0..N events that happen AFTER attestation. Shown only
            when there's at least one revision. Each revision is an event,
            not a milestone. */}
        {data.revisions && data.revisions.length > 0 && (
          <div style={{ margin: '24px 0 16px' }}>
            <div style={{
              fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.14em',
              color: t.inkMute, textTransform: 'uppercase', marginBottom: 10,
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              {clinical ? '◆' : '◇'} Revisions
              <span style={{ color: t.inkMute, opacity: 0.6 }}>· {data.revisions.length}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {data.revisions.map((r, i) => (
                <div key={i} style={{
                  display: 'grid',
                  gridTemplateColumns: 'auto auto 1fr auto',
                  gap: 14, alignItems: 'baseline',
                  padding: '10px 14px',
                  borderRadius: 8,
                  border: `0.5px solid ${t.panelBorder}`,
                  background: theme === 'light' ? 'rgba(34,184,207,0.04)' : 'rgba(34,184,207,0.06)',
                  borderLeft: `2px solid ${t.warm}`,
                }}>
                  <span style={{
                    fontFamily: 'JetBrains Mono, monospace', fontSize: 11, fontWeight: 600,
                    color: t.warm, letterSpacing: '0.06em',
                    padding: '3px 8px', borderRadius: 4,
                    background: `${t.warm}1a`, border: `0.5px solid ${t.warm}55`,
                  }}>v{r.version}</span>
                  <span style={{
                    fontFamily: 'JetBrains Mono, monospace', fontSize: 11,
                    color: t.inkSoft, letterSpacing: '0.06em',
                    whiteSpace: 'nowrap',
                  }}>{r.time} · {r.by}</span>
                  <span style={{ fontSize: 13, color: t.ink, lineHeight: 1.4 }}>
                    {r.summary}
                  </span>
                  <button style={{
                    fontFamily: 'JetBrains Mono, monospace', fontSize: 10,
                    letterSpacing: '0.10em', color: t.inkSoft,
                    background: 'transparent', border: `0.5px solid ${t.panelBorder}`,
                    padding: '4px 8px', borderRadius: 4, cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}>View diff</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* status banner */}
        {state === 'draft' && (
          <div style={{
            display: 'grid', gridTemplateColumns: '24px 1fr auto', gap: 14, alignItems: 'flex-start',
            padding: '14px 18px', borderRadius: 10,
            border: `0.5px dashed ${t.amber}`,
            background: 'rgba(192,138,45,0.06)', marginBottom: 24,
          }}>
            <span style={{
              width: 12, height: 12, borderRadius: '50%', background: t.amber,
              boxShadow: clinical ? 'none' : `0 0 10px ${t.amber}`, marginTop: 5,
            }} />
            <div>
              <div style={{ fontFamily: '"Inter", system-ui, sans-serif', fontStyle: clinical ? 'normal' : 'italic', fontWeight: clinical ? 500 : 400, fontSize: 17, color: t.ink }}>
                Ory drafted this note. It is unattested.
              </div>
              <div style={{ fontSize: 12.5, color: t.inkSoft, marginTop: 4, lineHeight: 1.55 }}>
                Review for accuracy. Edit anywhere. Attest before this note is exported to the EHR or referenced in billing.
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button style={{
                fontFamily: 'Inter', fontSize: 12.5, fontWeight: 500, padding: '8px 14px',
                borderRadius: 6, border: 'none', cursor: 'pointer',
                background: t.bright, color: '#fff',
              }}>Attest note</button>
              <button style={{
                fontFamily: 'Inter', fontSize: 12.5, fontWeight: 500, padding: '8px 14px',
                borderRadius: 6, border: `0.5px solid ${t.panelBorder}`, cursor: 'pointer',
                background: 'transparent', color: t.ink,
              }}>Edit</button>
            </div>
          </div>
        )}
        {state === 'attested' && (
          <div style={{
            display: 'grid', gridTemplateColumns: '24px 1fr auto', gap: 14, alignItems: 'flex-start',
            padding: '14px 18px', borderRadius: 10,
            border: `0.5px solid ${t.panelBorder}`,
            background: 'rgba(34,160,107,0.06)', marginBottom: 24,
          }}>
            <span style={{ width: 12, height: 12, borderRadius: '50%', background: t.green, marginTop: 5 }} />
            <div>
              <div style={{ fontFamily: '"Inter", system-ui, sans-serif', fontStyle: clinical ? 'normal' : 'italic', fontWeight: clinical ? 500 : 400, fontSize: 17, color: t.ink }}>
                Attested by Dr. Park · 11:11 AM.
              </div>
              <div style={{ fontSize: 12.5, color: t.inkSoft, marginTop: 4, lineHeight: 1.55 }}>
                Locked to this version. Future changes will be recorded as amendments with reason and diff.
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button style={{
                fontFamily: 'Inter', fontSize: 12.5, fontWeight: 500, padding: '8px 14px',
                borderRadius: 6, border: `0.5px solid ${t.panelBorder}`, cursor: 'pointer',
                background: 'transparent', color: t.ink,
              }}>Print / export</button>
              <button style={{
                fontFamily: 'Inter', fontSize: 12.5, fontWeight: 500, padding: '8px 14px',
                borderRadius: 6, border: `0.5px solid ${t.panelBorder}`, cursor: 'pointer',
                background: 'transparent', color: t.inkSoft,
              }}>Amend</button>
            </div>
          </div>
        )}
        {state === 'amended' && (
          <div style={{
            display: 'grid', gridTemplateColumns: '24px 1fr auto', gap: 14, alignItems: 'flex-start',
            padding: '14px 18px', borderRadius: 10,
            border: `0.5px solid ${t.panelBorder}`,
            background: 'rgba(34,184,207,0.06)', marginBottom: 24,
          }}>
            <span style={{ width: 12, height: 12, borderRadius: '50%', background: t.warm, marginTop: 5 }} />
            <div>
              <div style={{ fontFamily: '"Inter", system-ui, sans-serif', fontStyle: clinical ? 'normal' : 'italic', fontWeight: clinical ? 500 : 400, fontSize: 17, color: t.ink }}>
                Attested with one revision. Latest: v2 · {data.amendmentTime}.
              </div>
              <div style={{ fontSize: 12.5, color: t.inkSoft, marginTop: 4, lineHeight: 1.55 }}>
                Revisions are logged below with timestamps, authors, and diffs. The note remains attested at v1; v2 is the current effective version.
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button style={{
                  fontFamily: 'Inter', fontSize: 11.5, fontWeight: 500, padding: '5px 10px',
                  borderRadius: 5, border: `0.5px solid ${t.panelBorder}`, cursor: 'pointer',
                  background: 'transparent', color: t.inkSoft,
                }}>Add another amendment</button>
              </div>
            </div>
          </div>
        )}

        {/* two-column body */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 36, alignItems: 'start' }}>

          {/* LEFT — the note */}
          <div>
            <div style={{
              background: theme === 'light' ? 'rgba(34,184,207,0.07)' : 'rgba(34,184,207,0.10)',
              border: `0.5px solid ${t.panelBorder}`, borderRadius: 12,
              padding: '16px 20px', marginBottom: 28,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <OrreryOwl t={t} size={20} />
                <span style={{
                  fontFamily: 'JetBrains Mono, monospace', fontSize: 10,
                  letterSpacing: '0.16em', color: t.bright, textTransform: 'uppercase',
                }}>{clinical ? '◆' : '◇'} Ory's note</span>
              </div>
              <p style={{
                fontFamily: '"Inter", system-ui, sans-serif',
                fontStyle: clinical ? 'normal' : 'italic',
                fontWeight: clinical ? 500 : 400,
                fontSize: 17, lineHeight: 1.5, color: t.ink, margin: 0, textWrap: 'pretty',
              }}>{data.owlNote}</p>
            </div>

            <div style={{ marginBottom: 32 }}>
              <div style={{
                fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.16em',
                color: t.inkMute, textTransform: 'uppercase', marginBottom: 6,
              }}>Chief complaint</div>
              <p style={{ fontSize: 16, color: t.ink, lineHeight: 1.5, margin: 0, fontWeight: 500 }}>
                {data.chiefComplaint}
              </p>
            </div>

            {sectionTitle('S', 'Subjective')}
            <p style={{
              fontSize: 15, color: t.ink, lineHeight: 1.65, margin: '0 0 28px', textWrap: 'pretty',
            }}>{data.subjective}</p>

            {sectionTitle('O', 'Objective')}
            <p style={{
              fontSize: 15, color: t.ink, lineHeight: 1.65, margin: '0 0 28px',
              whiteSpace: 'pre-wrap', textWrap: 'pretty',
            }}>{data.objective}</p>

            {sectionTitle('A', 'Assessment')}
            <ol style={{ margin: '0 0 28px', padding: 0, listStyle: 'none' }}>
              {data.assessment.map((a, i) => (
                <li key={i} style={{ marginBottom: 14, paddingLeft: 28, position: 'relative' }}>
                  <span style={{
                    position: 'absolute', left: 0, top: 0,
                    fontFamily: '"Inter", system-ui, sans-serif',
                    fontStyle: clinical ? 'normal' : 'italic',
                    fontWeight: clinical ? 600 : 400,
                    fontSize: 18, color: t.bright, lineHeight: 1.4,
                  }}>{i + 1}.</span>
                  <div style={{ fontSize: 15.5, color: t.ink, fontWeight: 500, lineHeight: 1.5 }}>{a.dx}</div>
                  <div style={{ fontSize: 14, color: t.inkSoft, lineHeight: 1.6, marginTop: 3 }}>{a.detail}</div>
                </li>
              ))}
            </ol>

            {sectionTitle('P', 'Plan')}
            <ul style={{ margin: '0 0 28px', padding: 0, listStyle: 'none' }}>
              {data.plan.map((p, i) => (
                <li key={i} style={{
                  display: 'grid', gridTemplateColumns: '24px 1fr', gap: 10,
                  padding: '8px 0', borderTop: i === 0 ? 'none' : `0.5px solid ${t.panelStroke}`,
                }}>
                  <span style={{ color: t.bright, fontFamily: 'JetBrains Mono, monospace', fontSize: 11, lineHeight: 1.6 }}>
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span style={{ fontSize: 15, color: t.ink, lineHeight: 1.55 }}>{p}</span>
                </li>
              ))}
            </ul>

            {/* transcript */}
            <div style={{
              marginTop: 24, border: `0.5px solid ${t.panelBorder}`, borderRadius: 12,
              background: theme === 'light' ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.02)',
            }}>
              <div onClick={() => setTranscriptOpen(o => !o)}
                style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '14px 18px', cursor: 'pointer',
                }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{
                    fontFamily: 'JetBrains Mono, monospace', fontSize: 10.5, letterSpacing: '0.14em',
                    color: t.inkMute, textTransform: 'uppercase',
                  }}>Encounter transcript</span>
                  <span style={{
                    fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: t.inkMute,
                    padding: '2px 7px', border: `0.5px solid ${t.panelBorder}`, borderRadius: 4,
                  }}>14:08 · 3,214 words</span>
                </div>
                <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: t.inkSoft }}>
                  {transcriptOpen ? '▴' : '▾'}
                </span>
              </div>
              {transcriptOpen && (
                <div style={{ borderTop: `0.5px solid ${t.panelStroke}`, padding: '16px 18px' }}>
                  {!clinical && (
                    <div style={{
                      display: 'flex', gap: 4, marginBottom: 16, padding: 3,
                      background: theme === 'light' ? 'rgba(20,30,60,0.04)' : 'rgba(244,236,219,0.04)',
                      borderRadius: 6, width: 'fit-content',
                    }}>
                      {[['Transcript', false], ['Orbital arc', true]].map(([label, mode]) => (
                        <button key={label} onClick={() => setArcMode(mode)} style={{
                          fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.10em',
                          padding: '5px 10px', borderRadius: 4, border: 'none', cursor: 'pointer',
                          background: arcMode === mode
                            ? (theme === 'light' ? '#fff' : 'rgba(244,236,219,0.10)')
                            : 'transparent',
                          color: arcMode === mode ? t.ink : t.inkMute,
                          textTransform: 'uppercase',
                        }}>{label}</button>
                      ))}
                    </div>
                  )}
                  {arcMode && !clinical ? (
                    <div>
                      <TranscriptArc moments={data.transcriptArc} t={t} />
                      <div style={{
                        fontSize: 12, color: t.inkSoft, lineHeight: 1.55, marginTop: 8,
                        fontStyle: 'italic', textAlign: 'center', maxWidth: 640, margin: '8px auto 0',
                      }}>
                        The same call as moments along the encounter's arc. Bright stars are signals; teal is decisions; cool is exam; mute is open and close.
                      </div>
                    </div>
                  ) : (
                    <div style={{
                      fontFamily: 'JetBrains Mono, monospace', fontSize: 12, lineHeight: 1.7,
                      color: t.inkSoft, maxHeight: 320, overflowY: 'auto', whiteSpace: 'pre-wrap',
                    }}>
                      {TRANSCRIPT_TEXT}
                      <div style={{ marginTop: 8, color: t.inkMute, fontStyle: 'italic', textAlign: 'center' }}>
                        — transcript truncated for prototype —
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* RIGHT — sidecar */}
          <aside style={{ position: 'sticky', top: 84 }}>
            {/* what to check */}
            <div style={{
              border: `0.5px solid ${t.panelBorder}`, borderRadius: 12, padding: 16,
              background: theme === 'light' ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.02)',
              marginBottom: 16,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: t.amber }} />
                <span style={{
                  fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.14em',
                  color: t.inkMute, textTransform: 'uppercase',
                }}>{clinical ? '◆' : '◇'} What to check</span>
              </div>
              <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                {data.toCheck.map((c, i) => (
                  <li key={i} style={{
                    fontSize: 12.5, color: t.ink, lineHeight: 1.55, padding: '8px 0',
                    borderTop: i === 0 ? 'none' : `0.5px solid ${t.panelStroke}`,
                    display: 'grid', gridTemplateColumns: '14px 1fr', gap: 8,
                  }}>
                    <span style={{
                      width: 8, height: 8, borderRadius: '50%', marginTop: 5,
                      background: c.kind === 'flag' ? t.red : t.amber,
                    }} />
                    <span>{c.text}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* codes */}
            <div style={{
              border: `0.5px solid ${t.panelBorder}`, borderRadius: 12, padding: 16,
              background: theme === 'light' ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.02)',
              marginBottom: 16,
            }}>
              <div style={{
                fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.14em',
                color: t.inkMute, textTransform: 'uppercase', marginBottom: 10,
              }}>Suggested codes</div>
              <div style={{ marginBottom: 12 }}>
                <div style={{
                  fontFamily: 'JetBrains Mono, monospace', fontSize: 9.5, letterSpacing: '0.10em',
                  color: t.bright, marginBottom: 6,
                }}>ICD-10</div>
                {data.codes.icd10.map((c, i) => (
                  <div key={i} style={{
                    display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 8, padding: '4px 0',
                    alignItems: 'baseline',
                  }}>
                    <span style={{
                      fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: t.ink, fontWeight: 500,
                      padding: '2px 6px',
                      background: theme === 'light' ? 'rgba(20,30,60,0.05)' : 'rgba(244,236,219,0.06)',
                      borderRadius: 4,
                    }}>{c.code}</span>
                    <span style={{ fontSize: 11.5, color: t.inkSoft, lineHeight: 1.4 }}>{c.desc}</span>
                  </div>
                ))}
              </div>
              <div>
                <div style={{
                  fontFamily: 'JetBrains Mono, monospace', fontSize: 9.5, letterSpacing: '0.10em',
                  color: t.bright, marginBottom: 6,
                }}>CPT</div>
                {data.codes.cpt.map((c, i) => (
                  <div key={i} style={{
                    display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 8, padding: '4px 0',
                    alignItems: 'baseline',
                  }}>
                    <span style={{
                      fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: t.ink, fontWeight: 500,
                      padding: '2px 6px',
                      background: theme === 'light' ? 'rgba(20,30,60,0.05)' : 'rgba(244,236,219,0.06)',
                      borderRadius: 4,
                    }}>{c.code}</span>
                    <span style={{ fontSize: 11.5, color: t.inkSoft, lineHeight: 1.4 }}>{c.desc}</span>
                  </div>
                ))}
              </div>
              <div style={{
                fontSize: 10.5, color: t.inkMute, marginTop: 10,
                fontStyle: clinical ? 'normal' : 'italic', lineHeight: 1.5,
              }}>
                Suggested by Ory. Provider must verify before billing.
              </div>
            </div>

            {/* depth + scores */}
            <div style={{
              border: `0.5px solid ${t.panelBorder}`, borderRadius: 12, padding: 16,
              background: theme === 'light' ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.02)',
            }}>
              <div style={{
                fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.14em',
                color: t.inkMute, textTransform: 'uppercase', marginBottom: 10,
              }}>Section depth</div>
              {Object.entries(data.status.sectionDepth).map(([k, v]) => (
                <div key={k} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '6px 0', borderBottom: `0.5px solid ${t.panelStroke}`,
                }}>
                  <span style={{ fontSize: 12, color: t.ink, textTransform: 'capitalize' }}>{k}</span>
                  <span style={{
                    fontSize: 11, color: t.inkSoft,
                    fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.06em',
                  }}>
                    <DepthPip depth={v} t={t} />{v}
                  </span>
                </div>
              ))}
              <div style={{
                marginTop: 12, display: 'flex', justifyContent: 'space-between',
                fontSize: 11, color: t.inkSoft,
              }}>
                <span>Accuracy</span>
                <span style={{ fontFamily: 'JetBrains Mono, monospace', color: t.ink }}>
                  {data.status.accuracy.toFixed(1)} / 10
                </span>
              </div>
              <div style={{
                display: 'flex', justifyContent: 'space-between', fontSize: 11, color: t.inkSoft, marginTop: 4,
              }}>
                <span>Weighted completeness</span>
                <span style={{ fontFamily: 'JetBrains Mono, monospace', color: t.ink }}>
                  {data.status.completeness.toFixed(1)} / 10
                </span>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

window.OrreryClinicalNote = OrreryClinicalNote;
