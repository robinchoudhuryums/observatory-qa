/* global React */
/* eslint-disable */
const {
  ORRERY_LIGHT, ORRERY_DARK,
  OrreryTopBar, OrreryThemeToggle,
} = window;

// =============================================================================
//  Type & Polish Lab
//  Compare four distinct type+emphasis directions side-by-side.
//  Same content (Atlas headline + Day-in-Orbit summary + KPIs + a tag) is
//  rendered in each, so the differences are entirely typographic + treatment.
// =============================================================================

const VARIANTS = [
  {
    id: 'A',
    name: 'Editorial Authority',
    sub: 'NEJM-grade. Restrained, instrument-feeling.',
    fonts: {
      display: '"Newsreader", Georgia, serif',
      body:    '"IBM Plex Sans", system-ui, sans-serif',
      mono:    '"IBM Plex Mono", monospace',
    },
    headlineWeight: 500,
    headlineSize: 30,
    headlineItalic: false,
    headlineLetter: '-0.01em',
    tagSize: 10,
    tagLetter: '0.16em',
    tagWeight: 500,
    bracketEmph: true,           // [134 calls] in mono
    coloredEmph: false,
    underlineEmph: false,
    smallcapsKpiLabel: false,
    accentWord: 'normal',
  },
  {
    id: 'B',
    name: 'Swiss Clinical',
    sub: 'Single-family sans. Linear × Memorial Sloan Kettering.',
    fonts: {
      display: '"Inter", system-ui, sans-serif',
      body:    '"Inter", system-ui, sans-serif',
      mono:    '"JetBrains Mono", monospace',
    },
    headlineWeight: 600,
    headlineSize: 28,
    headlineItalic: false,
    headlineLetter: '-0.025em',
    tagSize: 10,
    tagLetter: '0.14em',
    tagWeight: 500,
    bracketEmph: false,
    coloredEmph: true,            // word in accent color
    underlineEmph: false,
    smallcapsKpiLabel: false,
    accentWord: 'italic',         // italic Inter is a thing
  },
  {
    id: 'C',
    name: 'Scientific Manuscript',
    sub: 'Single-serif rigor. Source Serif throughout.',
    fonts: {
      display: '"Source Serif 4", "Source Serif Pro", Georgia, serif',
      body:    '"Source Serif 4", "Source Serif Pro", Georgia, serif',
      mono:    '"JetBrains Mono", monospace',
    },
    headlineWeight: 400,
    headlineSize: 30,
    headlineItalic: true,
    headlineLetter: '-0.01em',
    tagSize: 10.5,
    tagLetter: '0.14em',
    tagWeight: 600,
    bracketEmph: false,
    coloredEmph: true,
    underlineEmph: true,          // thin underline under colored italic accent
    smallcapsKpiLabel: false,
    accentWord: 'italic',
  },
  {
    id: 'D',
    name: 'Quiet Boutique',
    sub: 'Considered, calm. Fraunces × Manrope.',
    fonts: {
      display: '"Fraunces", "Cormorant", Georgia, serif',
      body:    '"Manrope", system-ui, sans-serif',
      mono:    '"JetBrains Mono", monospace',
    },
    headlineWeight: 400,
    headlineSize: 30,
    headlineItalic: false,
    headlineLetter: '-0.025em',
    tagSize: 9.5,
    tagLetter: '0.18em',
    tagWeight: 600,
    bracketEmph: false,
    coloredEmph: false,
    underlineEmph: false,
    smallcapsKpiLabel: true,      // tiny mono label above each value
    accentWord: 'normal',
  },
];

// ---------- helpers ----------
const fontLink = (
  <link href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400..700;1,6..72,400..700&family=Source+Serif+4:ital,opsz,wght@0,8..60,300..700;1,8..60,300..700&family=Fraunces:ital,opsz,wght@0,9..144,300..700;1,9..144,300..700&family=Manrope:wght@300..700&family=IBM+Plex+Sans:wght@300..600&family=IBM+Plex+Mono:wght@400..600&display=swap" rel="stylesheet" />
);

// Render the headline with the chosen emphasis treatment
function Headline({ text, emphParts, v, t }) {
  // emphParts is array of {plain?, emph?} fragments in order
  return (
    <h2 style={{
      fontFamily: v.fonts.display,
      fontSize: v.headlineSize,
      fontWeight: v.headlineWeight,
      fontStyle: v.headlineItalic ? 'italic' : 'normal',
      letterSpacing: v.headlineLetter,
      lineHeight: 1.2,
      margin: 0,
      color: t.ink,
      textWrap: 'pretty',
    }}>
      {emphParts.map((p, i) => {
        if (p.plain) return <span key={i}>{p.plain}</span>;
        const word = p.emph;
        if (v.bracketEmph) {
          // [word] in mono, same size as surrounding (slightly smaller for balance)
          return (
            <span key={i} style={{
              fontFamily: v.fonts.mono,
              fontStyle: 'normal',
              fontWeight: 500,
              fontSize: v.headlineSize * 0.78,
              color: t.ink,
              padding: '0 1px',
              letterSpacing: '0',
            }}>[ {word} ]</span>
          );
        }
        const style = {};
        if (v.coloredEmph) style.color = t.bright;
        if (v.accentWord === 'italic') style.fontStyle = 'italic';
        if (v.underlineEmph) {
          style.textDecoration = 'underline';
          style.textDecorationColor = t.bright;
          style.textDecorationThickness = '1px';
          style.textUnderlineOffset = '4px';
        }
        return <span key={i} style={style}>{word}</span>;
      })}
    </h2>
  );
}

function Tag({ children, v, t, color }) {
  return (
    <div style={{
      fontFamily: v.fonts.mono,
      fontSize: v.tagSize,
      fontWeight: v.tagWeight,
      letterSpacing: v.tagLetter,
      color: color || t.inkMute,
      textTransform: 'uppercase',
    }}>{children}</div>
  );
}

// One full sample — replicates the Day-in-Orbit + headline + KPI row
function Sample({ v, t }) {
  return (
    <div style={{
      borderRadius: 14,
      background: t.panel,
      border: `0.5px solid ${t.panelBorder}`,
      padding: '24px 26px 22px',
      backdropFilter: 'blur(6px)',
      fontFamily: v.fonts.body,
      color: t.ink,
      display: 'flex',
      flexDirection: 'column',
      gap: 18,
    }}>
      {/* Variant identity strip */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderBottom: `0.5px solid ${t.panelBorder}`, paddingBottom: 14, marginBottom: 2 }}>
        <div>
          <Tag v={v} t={t}>◇ DIRECTION {v.id}</Tag>
          <div style={{ fontFamily: v.fonts.display, fontSize: 19, marginTop: 4, color: t.ink, fontStyle: v.headlineItalic ? 'italic' : 'normal', fontWeight: v.headlineWeight }}>
            {v.name}
          </div>
          <div style={{ fontSize: 11.5, color: t.inkSoft, marginTop: 3, fontFamily: v.fonts.body }}>{v.sub}</div>
        </div>
        <div style={{ display: 'flex', gap: 14, fontFamily: v.fonts.mono, fontSize: 9, color: t.inkMute, letterSpacing: '0.1em', textAlign: 'right', lineHeight: 1.5 }}>
          <div>
            <div>DISPLAY</div>
            <div style={{ color: t.ink }}>{v.fonts.display.split(',')[0].replace(/"/g, '')}</div>
          </div>
          <div>
            <div>BODY</div>
            <div style={{ color: t.ink }}>{v.fonts.body.split(',')[0].replace(/"/g, '')}</div>
          </div>
        </div>
      </div>

      {/* Atlas headline replica */}
      <div>
        <Tag v={v} t={t}>◇ SAT 26 APR · BY CALL TYPE · DAY-IN-THE-LIFE</Tag>
        <div style={{ height: 8 }} />
        <Headline v={v} t={t}
          emphParts={[
            { plain: 'A model of ' },
            { emph: '134 calls' },
            { plain: ' in orbit — bigger planets carry more, brighter ones close.' },
          ]} />
      </div>

      {/* Day-in-Orbit summary replica */}
      <div style={{
        borderLeft: `2px solid ${t.bright}`,
        background: `linear-gradient(135deg, ${t.bright}1a, ${t.starOuter}10)`,
        borderRadius: 10,
        padding: '14px 16px',
      }}>
        <Tag v={v} t={t}>◇ ORY · OBSERVED · DAY</Tag>
        <div style={{ height: 8 }} />
        <Headline v={v} t={t}
          emphParts={[
            { plain: '' },
            { emph: 'Tx plan review' },
            { plain: ' burned brightest. Two new patients said yes by lunch.' },
          ]} />
        <div style={{ height: 4 }} />
        <Headline v={v} t={t}
          emphParts={[
            { plain: '' },
            { emph: 'Post-op follow-ups' },
            { plain: ' closed at 41% — last week 62%.' },
          ]} />
      </div>

      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
        {[
          { label: 'CALLS',  value: '134',    sub: '+18 vs last',  color: t.bright },
          { label: 'SCORE',  value: '7.8',    sub: 'of 10',        color: t.warm },
          { label: 'BOOKED', value: '$184k',  sub: '+22% plans',   color: t.cool },
        ].map((k, i) => (
          <div key={i} style={{
            border: `0.5px solid ${t.panelBorder}`,
            borderRadius: 10,
            padding: '14px 14px 12px',
            background: t.name === 'dark' ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.015)',
          }}>
            {v.smallcapsKpiLabel ? (
              <div style={{ fontFamily: v.fonts.mono, fontSize: 9, letterSpacing: '0.16em', color: t.inkMute, marginBottom: 6 }}>
                {k.label}
              </div>
            ) : (
              <Tag v={v} t={t}>{k.label}</Tag>
            )}
            <div style={{
              fontFamily: v.fonts.display,
              fontSize: 32,
              fontWeight: v.id === 'B' ? 600 : 400,
              fontStyle: v.headlineItalic && v.id === 'C' ? 'italic' : 'normal',
              letterSpacing: '-0.025em',
              color: k.color,
              lineHeight: 1,
              marginTop: v.smallcapsKpiLabel ? 0 : 4,
            }}>{k.value}</div>
            <div style={{ fontSize: 11, color: t.inkSoft, marginTop: 5 }}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Footer note showing emphasis treatment in plain English */}
      <div style={{
        fontFamily: v.fonts.mono,
        fontSize: 9.5,
        color: t.inkMute,
        letterSpacing: '0.08em',
        borderTop: `0.5px dashed ${t.panelBorder}`,
        paddingTop: 12,
        textTransform: 'uppercase',
      }}>
        EMPHASIS · {
          v.bracketEmph ? '[ bracketed mono ]'
          : v.underlineEmph ? 'colored italic + underline'
          : v.coloredEmph ? 'colored italic word'
          : v.smallcapsKpiLabel ? 'small-caps mono label · no inline color'
          : 'plain'
        }
      </div>
    </div>
  );
}

function OrreryTypeLab({ theme: themeProp = 'light', onNavigate = null, onThemeChange = null }) {
  const [themeState, setThemeState] = React.useState(themeProp);
  const theme = onThemeChange ? themeProp : themeState;
  const setTheme = (next) => { if (onThemeChange) onThemeChange(next); else setThemeState(next); };
  const t = theme === 'light' ? ORRERY_LIGHT : ORRERY_DARK;

  return (
    <div style={{
      width: '100%', minHeight: '100vh', background: t.bg, color: t.ink,
      fontFamily: '"Inter", system-ui, sans-serif', WebkitFontSmoothing: 'antialiased',
      position: 'relative', overflow: 'auto',
    }}>
      {fontLink}
      <OrreryTopBar t={t} view="TYPE LAB" activeNav="Atlas" onNavigate={onNavigate}
        extra={<OrreryThemeToggle theme={theme} t={t} onToggle={() => setTheme(theme === 'light' ? 'dark' : 'light')} />} />

      <div style={{ padding: '28px 32px 8px', maxWidth: 1400, margin: '0 auto' }}>
        <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 10.5, letterSpacing: '0.16em', color: t.inkMute, textTransform: 'uppercase' }}>◇ Type & polish lab</div>
        <h1 style={{
          fontFamily: '"Instrument Serif", Georgia, serif',
          fontSize: 38, fontWeight: 400, fontStyle: 'italic', letterSpacing: '-0.02em',
          margin: '6px 0 4px', color: t.ink, lineHeight: 1.1,
        }}>
          Four directions, same content.
        </h1>
        <div style={{ fontSize: 14, color: t.inkSoft, lineHeight: 1.5, maxWidth: 720, marginTop: 4 }}>
          Each tile renders the same Atlas headline, Day-in-Orbit summary, and KPI row — only the type system and emphasis treatment change. Gradient text emphasis is removed in all four. Switch theme to compare in dark mode.
        </div>
      </div>

      <div style={{
        padding: '24px 32px 64px',
        maxWidth: 1400, margin: '0 auto',
        display: 'grid',
        gridTemplateColumns: 'repeat(2, 1fr)',
        gap: 20,
      }}>
        {VARIANTS.map((v) => <Sample key={v.id} v={v} t={t} />)}
      </div>

      {/* Print plate at the very bottom: small specimen rows */}
      <div style={{ borderTop: `0.5px solid ${t.panelBorder}`, padding: '36px 32px 64px', maxWidth: 1400, margin: '0 auto' }}>
        <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 10.5, letterSpacing: '0.16em', color: t.inkMute, textTransform: 'uppercase', marginBottom: 14 }}>◇ Specimens · same line, four families</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {VARIANTS.map((v) => (
            <div key={v.id} style={{
              display: 'grid', gridTemplateColumns: '64px 1fr', gap: 18,
              alignItems: 'baseline',
              borderBottom: `0.5px dashed ${t.panelBorder}`, paddingBottom: 16,
            }}>
              <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 10, color: t.inkMute, letterSpacing: '0.12em' }}>{v.id} · {v.name.split(' ')[0].toUpperCase()}</div>
              <div style={{
                fontFamily: v.fonts.display,
                fontSize: 26,
                fontWeight: v.headlineWeight,
                fontStyle: v.headlineItalic ? 'italic' : 'normal',
                letterSpacing: v.headlineLetter,
                color: t.ink, lineHeight: 1.25,
              }}>
                Ory observed 134 calls today; the brightest planet was Tx plan review.
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

window.OrreryTypeLab = OrreryTypeLab;
