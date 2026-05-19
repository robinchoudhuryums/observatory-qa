/* global React */
/* eslint-disable */
const {
  ORRERY_LIGHT, ORRERY_DARK,
  OrreryTopBar, OrreryThemeToggle,
} = window;

// =============================================================================
//  Direction B — Refinement Lab
//  Three sub-variants of the chosen Swiss Clinical direction. Same Inter +
//  JetBrains Mono pairing in all three; what varies is the EMPHASIS GRAMMAR
//  (rule, eyebrow, accent word) and rhythm. One winner gets promoted globally.
// =============================================================================

const fontLink = (
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300..700&family=JetBrains+Mono:wght@400..600&display=swap" rel="stylesheet" />
);

const SUBVARIANTS = [
  {
    id: 'B1',
    name: 'Tightened baseline',
    sub: 'Side rule + italic colored accent. The original B, dialed back.',
    spec: [
      'Rule 2px · color from t.bright',
      'Eyebrow JetBrains Mono 10px · 0.14em',
      'Headline Inter 28/600 · -0.025em',
      'Accent word italic + colored',
    ],
    rule: 'side',           // 'side' | 'tab' | 'side'
    ruleWeight: 2,
    eyebrowFont: 'mono',     // 'mono' | 'smallcaps'
    eyebrowWeight: 500,
    accent: 'italic-color',  // 'italic-color' | 'weight' | 'color-bold'
  },
  {
    id: 'B2',
    name: 'Tab + weight contrast',
    sub: 'Tab mark above. No color on text — emphasis is pure weight.',
    spec: [
      'Tab 24×3px above eyebrow',
      'Eyebrow JetBrains Mono 10px · 0.14em',
      'Headline Inter 28/500 · -0.025em',
      'Accent word Inter 700 · same color as ink',
    ],
    rule: 'tab',
    ruleWeight: 3,
    eyebrowFont: 'mono',
    eyebrowWeight: 500,
    accent: 'weight',
  },
  {
    id: 'B3',
    name: 'Rule + small-caps',
    sub: 'Inter small-caps eyebrow. Bold colored accent (no italic).',
    spec: [
      'Rule 2px · color from t.bright',
      'Eyebrow Inter 11px small-caps · 0.10em',
      'Headline Inter 28/600 · -0.025em',
      'Accent word Inter 700 + colored',
    ],
    rule: 'side',
    ruleWeight: 2,
    eyebrowFont: 'smallcaps',
    eyebrowWeight: 600,
    accent: 'color-bold',
  },
];

// ----------------------------------------------------------------------------
// Building blocks
// ----------------------------------------------------------------------------

function Eyebrow({ children, v, t, color }) {
  if (v.eyebrowFont === 'mono') {
    return (
      <div style={{
        fontFamily: '"JetBrains Mono", monospace',
        fontSize: 10,
        fontWeight: v.eyebrowWeight,
        letterSpacing: '0.14em',
        color: color || t.inkMute,
        textTransform: 'uppercase',
      }}>{children}</div>
    );
  }
  // small-caps Inter
  return (
    <div style={{
      fontFamily: '"Inter", system-ui, sans-serif',
      fontSize: 11,
      fontWeight: v.eyebrowWeight,
      letterSpacing: '0.10em',
      fontVariant: 'all-small-caps',
      fontFeatureSettings: '"smcp", "c2sc"',
      color: color || t.inkMute,
    }}>{children}</div>
  );
}

function Accent({ children, v, t }) {
  const base = {
    fontFamily: '"Inter", system-ui, sans-serif',
  };
  if (v.accent === 'italic-color') {
    return <span style={{ ...base, fontStyle: 'italic', color: t.bright, fontWeight: 600 }}>{children}</span>;
  }
  if (v.accent === 'weight') {
    return <span style={{ ...base, fontWeight: 700, color: t.ink }}>{children}</span>;
  }
  // color-bold
  return <span style={{ ...base, fontWeight: 700, color: t.bright }}>{children}</span>;
}

function Headline({ parts, v, t, size = 28, weight = 600 }) {
  return (
    <h2 style={{
      fontFamily: '"Inter", system-ui, sans-serif',
      fontSize: size,
      fontWeight: v.accent === 'weight' ? 500 : weight,
      letterSpacing: '-0.025em',
      lineHeight: 1.22,
      margin: 0,
      color: t.ink,
      textWrap: 'pretty',
    }}>
      {parts.map((p, i) => p.emph
        ? <Accent key={i} v={v} t={t}>{p.emph}</Accent>
        : <span key={i}>{p.plain}</span>)}
    </h2>
  );
}

// Section wrapper: applies the chosen rule treatment.
function RuledSection({ v, t, eyebrow, children, dense = false, accentRule = false }) {
  const ruleColor = accentRule ? t.bright : t.panelBorder;
  if (v.rule === 'side') {
    return (
      <div style={{
        borderLeft: `${v.ruleWeight}px solid ${accentRule ? t.bright : (t.name === 'dark' ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.14)')}`,
        paddingLeft: dense ? 14 : 18,
      }}>
        <Eyebrow v={v} t={t}>{eyebrow}</Eyebrow>
        <div style={{ height: dense ? 6 : 10 }} />
        {children}
      </div>
    );
  }
  // tab
  return (
    <div>
      <div style={{
        width: 24, height: v.ruleWeight,
        background: accentRule ? t.bright : (t.name === 'dark' ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.55)'),
        marginBottom: 10,
      }} />
      <Eyebrow v={v} t={t}>{eyebrow}</Eyebrow>
      <div style={{ height: dense ? 6 : 10 }} />
      {children}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Sample tile — renders Atlas card + Day-in-Orbit + KPI row in the variant
// ----------------------------------------------------------------------------

function Sample({ v, t }) {
  return (
    <div style={{
      borderRadius: 14,
      background: t.panel,
      border: `0.5px solid ${t.panelBorder}`,
      padding: '26px 28px 24px',
      backdropFilter: 'blur(6px)',
      fontFamily: '"Inter", system-ui, sans-serif',
      color: t.ink,
      display: 'flex',
      flexDirection: 'column',
      gap: 22,
    }}>
      {/* Identity strip */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        borderBottom: `0.5px solid ${t.panelBorder}`,
        paddingBottom: 16,
      }}>
        <div>
          <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 10, letterSpacing: '0.16em', color: t.inkMute, textTransform: 'uppercase' }}>
            ◇ B · {v.id}
          </div>
          <div style={{ fontFamily: '"Inter", system-ui, sans-serif', fontSize: 19, fontWeight: 600, letterSpacing: '-0.02em', marginTop: 5, color: t.ink }}>
            {v.name}
          </div>
          <div style={{ fontSize: 12, color: t.inkSoft, marginTop: 3, lineHeight: 1.45, maxWidth: 340 }}>{v.sub}</div>
        </div>
        <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 9, color: t.inkMute, letterSpacing: '0.08em', textAlign: 'right', lineHeight: 1.65, textTransform: 'uppercase' }}>
          {v.spec.map((s, i) => <div key={i}>{s}</div>)}
        </div>
      </div>

      {/* Atlas headline replica */}
      <RuledSection v={v} t={t} eyebrow="◇ SAT 26 APR · DAY-IN-THE-LIFE">
        <Headline v={v} t={t} parts={[
          { plain: 'A model of ' },
          { emph: '134 calls' },
          { plain: ' in orbit — bigger planets carry more, brighter ones close.' },
        ]} />
      </RuledSection>

      {/* Day-in-Orbit summary replica — uses ACCENT rule color to show hierarchy */}
      <RuledSection v={v} t={t} eyebrow="◇ ORY · OBSERVED · DAY" accentRule>
        <Headline v={v} t={t} parts={[
          { emph: 'Tx plan review' },
          { plain: ' burned brightest. Two new patients said yes by lunch.' },
        ]} size={22} weight={500} />
        <div style={{ height: 6 }} />
        <Headline v={v} t={t} parts={[
          { emph: 'Post-op follow-ups' },
          { plain: ' closed at 41% — last week 62%.' },
        ]} size={22} weight={500} />
      </RuledSection>

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
            <Eyebrow v={v} t={t}>{k.label}</Eyebrow>
            <div style={{
              fontFamily: '"Inter", system-ui, sans-serif',
              fontSize: 32,
              fontWeight: 600,
              letterSpacing: '-0.03em',
              color: k.color,
              lineHeight: 1,
              marginTop: 6,
              fontVariantNumeric: 'tabular-nums',
            }}>{k.value}</div>
            <div style={{ fontSize: 11.5, color: t.inkSoft, marginTop: 5 }}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Tag/label samples */}
      <div style={{
        display: 'flex',
        gap: 8,
        flexWrap: 'wrap',
        borderTop: `0.5px dashed ${t.panelBorder}`,
        paddingTop: 14,
      }}>
        <span style={tagStyle(t, 'neutral')}>Tx Plan</span>
        <span style={tagStyle(t, 'accent')}>Live</span>
        <span style={tagStyle(t, 'warm')}>Coaching</span>
        <span style={tagStyle(t, 'mute')}>Recall</span>
      </div>
    </div>
  );
}

function tagStyle(t, kind) {
  const map = {
    neutral: { bg: t.name === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)', fg: t.ink, bd: t.panelBorder },
    accent:  { bg: t.name === 'dark' ? 'rgba(120,170,255,0.12)' : 'rgba(58,99,160,0.08)', fg: t.bright, bd: t.bright + '55' },
    warm:    { bg: t.name === 'dark' ? 'rgba(220,170,120,0.10)' : 'rgba(190,130,70,0.08)', fg: t.warm, bd: t.warm + '55' },
    mute:    { bg: 'transparent', fg: t.inkMute, bd: t.panelBorder },
  };
  const c = map[kind] || map.neutral;
  return {
    fontFamily: '"Inter", system-ui, sans-serif',
    fontSize: 11.5,
    fontWeight: 500,
    letterSpacing: '0.01em',
    color: c.fg,
    background: c.bg,
    border: `0.5px solid ${c.bd}`,
    padding: '4px 10px',
    borderRadius: 999,
  };
}

// ----------------------------------------------------------------------------
// Side-by-side comparison row for one element type
// ----------------------------------------------------------------------------

function CompareRow({ t, label, render }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '110px 1fr 1fr 1fr',
      gap: 18,
      alignItems: 'flex-start',
      borderBottom: `0.5px dashed ${t.panelBorder}`,
      padding: '18px 0',
    }}>
      <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 10, letterSpacing: '0.14em', color: t.inkMute, textTransform: 'uppercase', paddingTop: 4 }}>{label}</div>
      {SUBVARIANTS.map((v) => (
        <div key={v.id}>
          <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 9, color: t.inkMute, letterSpacing: '0.14em', marginBottom: 8 }}>{v.id}</div>
          {render(v)}
        </div>
      ))}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Page
// ----------------------------------------------------------------------------

function OrreryTypeLabB({ theme: themeProp = 'light', onNavigate = null, onThemeChange = null }) {
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
      <OrreryTopBar t={t} view="B · REFINEMENT" activeNav="Atlas" onNavigate={onNavigate}
        extra={<OrreryThemeToggle theme={theme} t={t} onToggle={() => setTheme(theme === 'light' ? 'dark' : 'light')} />} />

      {/* Header */}
      <div style={{ padding: '28px 32px 8px', maxWidth: 1480, margin: '0 auto' }}>
        <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 10.5, letterSpacing: '0.16em', color: t.inkMute, textTransform: 'uppercase' }}>◇ Direction B · Swiss Clinical · Refinement</div>
        <h1 style={{
          fontFamily: '"Inter", system-ui, sans-serif',
          fontSize: 36, fontWeight: 600, letterSpacing: '-0.025em',
          margin: '6px 0 4px', color: t.ink, lineHeight: 1.1,
        }}>
          Same family. Three emphasis grammars.
        </h1>
        <div style={{ fontSize: 14, color: t.inkSoft, lineHeight: 1.5, maxWidth: 760, marginTop: 4 }}>
          Inter + JetBrains Mono in all three. What varies: the rule treatment (side vs tab), the eyebrow voice (mono vs Inter small-caps), and how the emphasized word announces itself (italic+color, weight, or weight+color). Pick a winner; it gets rolled across Atlas, Patterns, Coaching, and Call Detail.
        </div>
      </div>

      {/* Three full sample tiles */}
      <div style={{
        padding: '24px 32px 40px',
        maxWidth: 1480, margin: '0 auto',
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 18,
      }}>
        {SUBVARIANTS.map((v) => <Sample key={v.id} v={v} t={t} />)}
      </div>

      {/* Element-by-element comparison */}
      <div style={{ borderTop: `0.5px solid ${t.panelBorder}`, padding: '32px 32px 64px', maxWidth: 1480, margin: '0 auto' }}>
        <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 10.5, letterSpacing: '0.16em', color: t.inkMute, textTransform: 'uppercase', marginBottom: 6 }}>◇ Element comparison</div>
        <div style={{ fontSize: 13, color: t.inkSoft, marginBottom: 8 }}>
          Same atomic element rendered three ways. Easier to spot which emphasis grammar reads cleanest at glance.
        </div>

        <CompareRow t={t} label="Eyebrow" render={(v) => (
          <Eyebrow v={v} t={t}>◇ SAT 26 APR · DAY</Eyebrow>
        )} />

        <CompareRow t={t} label="Long line" render={(v) => (
          <Headline v={v} t={t} size={22} weight={500} parts={[
            { plain: 'A model of ' },
            { emph: '134 calls' },
            { plain: ' in orbit.' },
          ]} />
        )} />

        <CompareRow t={t} label="Owl summary" render={(v) => (
          <RuledSection v={v} t={t} eyebrow="◇ OBSERVED" accentRule dense>
            <Headline v={v} t={t} size={18} weight={500} parts={[
              { emph: 'Tx plan review' },
              { plain: ' burned brightest today.' },
            ]} />
          </RuledSection>
        )} />

        <CompareRow t={t} label="KPI" render={(v) => (
          <div>
            <Eyebrow v={v} t={t}>BOOKED</Eyebrow>
            <div style={{
              fontFamily: '"Inter", system-ui, sans-serif',
              fontSize: 32, fontWeight: 600, letterSpacing: '-0.03em',
              color: t.bright, lineHeight: 1, marginTop: 6,
              fontVariantNumeric: 'tabular-nums',
            }}>$184k</div>
            <div style={{ fontSize: 11.5, color: t.inkSoft, marginTop: 4 }}>+22% plans</div>
          </div>
        )} />

        <CompareRow t={t} label="Tags" render={(v) => (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <span style={tagStyle(t, 'neutral')}>Tx Plan</span>
            <span style={tagStyle(t, 'accent')}>Live</span>
            <span style={tagStyle(t, 'warm')}>Coaching</span>
          </div>
        )} />

        <CompareRow t={t} label="Inline accent" render={(v) => (
          <div style={{ fontFamily: '"Inter", system-ui, sans-serif', fontSize: 15, color: t.ink, lineHeight: 1.5 }}>
            Ory observed <Accent v={v} t={t}>134 calls</Accent> today; the brightest planet was <Accent v={v} t={t}>Tx plan review</Accent>.
          </div>
        )} />
      </div>

      {/* Decision strip at bottom */}
      <div style={{ borderTop: `0.5px solid ${t.panelBorder}`, padding: '28px 32px 80px', maxWidth: 1480, margin: '0 auto' }}>
        <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 10.5, letterSpacing: '0.16em', color: t.inkMute, textTransform: 'uppercase', marginBottom: 14 }}>◇ Pick one to promote</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 18 }}>
          {SUBVARIANTS.map((v) => (
            <div key={v.id} style={{
              border: `0.5px solid ${t.panelBorder}`,
              borderRadius: 12,
              padding: '16px 18px',
              background: t.name === 'dark' ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.01)',
            }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 11, color: t.inkMute, letterSpacing: '0.14em' }}>{v.id}</div>
                <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-0.02em', color: t.ink }}>{v.name}</div>
              </div>
              <div style={{ fontSize: 12.5, color: t.inkSoft, lineHeight: 1.5, marginTop: 6 }}>
                {v.id === 'B1' && 'Most expressive. Italic+color is unmistakable; risk is feeling slightly editorial.'}
                {v.id === 'B2' && 'Most restrained. Reads as instrument output; might lose hierarchy on dense screens.'}
                {v.id === 'B3' && 'Middle path. Bold colored word is loud without italic flair; small-caps eyebrow is the dressier touch.'}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

window.OrreryTypeLabB = OrreryTypeLabB;
