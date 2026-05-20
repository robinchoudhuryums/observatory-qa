/* global React */
/* eslint-disable */
// =============================================================================
//  01 · APERTURE  — refined modern SaaS, single deep-teal accent
//  Type: Fraunces (display) + Geist (text) + Geist Mono (numerals/labels)
//  Color: warm off-white #f7f6f2, ink #0e1413, teal #0d6e6e, line #e6e3dc
// =============================================================================

const apTheme = {
  bg: '#f7f6f2',
  panel: '#ffffff',
  panelMuted: '#f1efe9',
  ink: '#0e1413',
  ink2: '#3d4441',
  ink3: '#7a8079',
  line: '#e2dfd6',
  lineSoft: '#ecead8',
  teal: '#0d6e6e',
  tealDeep: '#094545',
  tealSoft: '#dfece9',
  amber: '#b8852b',
  rose: '#a23b3b',
  serif: "'Fraunces', 'Instrument Serif', serif",
  sans: "'Geist', system-ui, sans-serif",
  mono: "'Geist Mono', 'JetBrains Mono', monospace",
};

// ----- Owl mark — geometric, eyes only -----
function ApOwl({ size = 22, color = apTheme.ink }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      {/* head outline */}
      <path
        d="M16 4 C8 4 4 9 4 16 C4 23 9 28 16 28 C23 28 28 23 28 16 C28 9 24 4 16 4 Z"
        stroke={color}
        strokeWidth="1.4"
        fill="none"
      />
      {/* eye discs */}
      <circle cx="11" cy="14" r="3.4" stroke={color} strokeWidth="1.4" fill="none" />
      <circle cx="21" cy="14" r="3.4" stroke={color} strokeWidth="1.4" fill="none" />
      <circle cx="11" cy="14" r="1.2" fill={color} />
      <circle cx="21" cy="14" r="1.2" fill={color} />
      {/* beak */}
      <path d="M14.5 18 L16 20.5 L17.5 18 Z" fill={color} />
    </svg>
  );
}

function ApLogo({ color = apTheme.ink }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <ApOwl color={color} />
      <span
        style={{
          fontFamily: apTheme.serif,
          fontSize: 22,
          letterSpacing: '-0.02em',
          color,
          fontWeight: 500,
        }}
      >
        Observatory
      </span>
    </div>
  );
}

// =============================================================================
//  Sidebar
// =============================================================================
function ApSidebar({ active = 'dashboard' }) {
  const sections = [
    {
      label: 'Workspace',
      items: [
        { id: 'dashboard', label: 'Dashboard', kbd: 'D' },
        { id: 'calls', label: 'Calls', kbd: '' },
        { id: 'transcripts', label: 'Transcripts', kbd: '' },
        { id: 'search', label: 'Search', kbd: 'K' },
      ],
    },
    {
      label: 'Quality',
      items: [
        { id: 'performance', label: 'Performance', kbd: '' },
        { id: 'sentiment', label: 'Sentiment', kbd: '' },
        { id: 'coaching', label: 'Coaching', kbd: '' },
        { id: 'reports', label: 'Reports', kbd: 'R' },
      ],
    },
    {
      label: 'Clinical',
      items: [
        { id: 'clinical', label: 'Clinical notes', kbd: '' },
        { id: 'live', label: 'Live encounter', kbd: '' },
        { id: 'templates', label: 'Templates', kbd: '' },
      ],
    },
    {
      label: 'Admin',
      items: [
        { id: 'employees', label: 'Team', kbd: '' },
        { id: 'settings', label: 'Settings', kbd: '' },
      ],
    },
  ];
  return (
    <aside
      style={{
        width: 240,
        background: apTheme.panelMuted,
        borderRight: `1px solid ${apTheme.line}`,
        padding: '20px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 18,
      }}
    >
      <div style={{ padding: '4px 6px 8px' }}>
        <ApLogo />
      </div>

      <div
        style={{
          fontFamily: apTheme.mono,
          fontSize: 11,
          padding: '8px 10px',
          background: apTheme.panel,
          border: `1px solid ${apTheme.line}`,
          borderRadius: 6,
          color: apTheme.ink3,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span>Westside Dental</span>
        <span style={{ color: apTheme.teal }}>▾</span>
      </div>

      {sections.map((s) => (
        <div key={s.label}>
          <div
            style={{
              fontFamily: apTheme.mono,
              fontSize: 10,
              textTransform: 'uppercase',
              letterSpacing: '0.12em',
              color: apTheme.ink3,
              padding: '0 8px 8px',
            }}
          >
            {s.label}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {s.items.map((it) => {
              const isActive = it.id === active;
              return (
                <div
                  key={it.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '7px 10px',
                    fontSize: 13.5,
                    fontFamily: apTheme.sans,
                    color: isActive ? apTheme.ink : apTheme.ink2,
                    background: isActive ? apTheme.panel : 'transparent',
                    border: isActive ? `1px solid ${apTheme.line}` : '1px solid transparent',
                    borderRadius: 6,
                    fontWeight: isActive ? 500 : 400,
                    boxShadow: isActive ? `inset 2px 0 0 ${apTheme.teal}` : 'none',
                  }}
                >
                  <span>{it.label}</span>
                  {it.kbd && (
                    <span
                      style={{
                        fontFamily: apTheme.mono,
                        fontSize: 10,
                        color: apTheme.ink3,
                        border: `1px solid ${apTheme.line}`,
                        borderRadius: 3,
                        padding: '1px 4px',
                        background: isActive ? apTheme.panelMuted : 'transparent',
                      }}
                    >
                      {it.kbd}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <div style={{ marginTop: 'auto', borderTop: `1px solid ${apTheme.line}`, paddingTop: 12 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '6px 8px',
            fontFamily: apTheme.sans,
            fontSize: 13,
            color: apTheme.ink2,
          }}
        >
          <div
            style={{
              width: 26,
              height: 26,
              borderRadius: '50%',
              background: apTheme.teal,
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: apTheme.serif,
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            R
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
            <span style={{ color: apTheme.ink, fontWeight: 500 }}>Robin C.</span>
            <span style={{ fontSize: 11, color: apTheme.ink3 }}>Admin</span>
          </div>
        </div>
      </div>
    </aside>
  );
}

// =============================================================================
//  Shared bits
// =============================================================================
function ApPill({ children, tone = 'neutral' }) {
  const tones = {
    neutral: { bg: apTheme.panelMuted, fg: apTheme.ink2, br: apTheme.line },
    teal: { bg: apTheme.tealSoft, fg: apTheme.tealDeep, br: '#bcd6d0' },
    amber: { bg: '#f6efd9', fg: '#6e4f12', br: '#e6d9b1' },
    rose: { bg: '#f4e2dc', fg: '#7a2a2a', br: '#e9c8bd' },
  };
  const t = tones[tone];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 8px',
        background: t.bg,
        color: t.fg,
        border: `1px solid ${t.br}`,
        borderRadius: 999,
        fontFamily: apTheme.mono,
        fontSize: 10.5,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
      }}
    >
      {children}
    </span>
  );
}

function ApMetric({ label, value, sub, delta, tone }) {
  const dColor = delta?.startsWith('+') ? apTheme.teal : delta?.startsWith('−') || delta?.startsWith('-') ? apTheme.rose : apTheme.ink3;
  return (
    <div
      style={{
        background: apTheme.panel,
        border: `1px solid ${apTheme.line}`,
        borderRadius: 8,
        padding: '18px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div
        style={{
          fontFamily: apTheme.mono,
          fontSize: 10.5,
          textTransform: 'uppercase',
          letterSpacing: '0.12em',
          color: apTheme.ink3,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span>{label}</span>
        {tone && <ApPill tone={tone}>{tone === 'teal' ? 'live' : tone === 'amber' ? 'Review' : tone === 'rose' ? 'Flagged' : ''}</ApPill>}
      </div>
      <div
        style={{
          fontFamily: apTheme.serif,
          fontSize: 42,
          letterSpacing: '-0.02em',
          color: apTheme.ink,
          lineHeight: 1,
          fontFeatureSettings: '"tnum" 1',
          fontWeight: 400,
        }}
      >
        {value}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 12, color: apTheme.ink3 }}>
        <span style={{ fontFamily: apTheme.sans }}>{sub}</span>
        {delta && (
          <span style={{ fontFamily: apTheme.mono, color: dColor, fontSize: 11 }}>
            {delta}
          </span>
        )}
      </div>
    </div>
  );
}

function ApPanel({ title, kicker, action, children, padded = true }) {
  return (
    <div
      style={{
        background: apTheme.panel,
        border: `1px solid ${apTheme.line}`,
        borderRadius: 8,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '14px 20px',
          borderBottom: `1px solid ${apTheme.line}`,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
        }}
      >
        <div>
          {kicker && (
            <div
              style={{
                fontFamily: apTheme.mono,
                fontSize: 10,
                textTransform: 'uppercase',
                letterSpacing: '0.12em',
                color: apTheme.ink3,
                marginBottom: 3,
              }}
            >
              {kicker}
            </div>
          )}
          <div style={{ fontFamily: apTheme.serif, fontSize: 20, letterSpacing: '-0.01em', color: apTheme.ink }}>
            {title}
          </div>
        </div>
        {action && <div style={{ fontFamily: apTheme.sans, fontSize: 12, color: apTheme.teal }}>{action}</div>}
      </div>
      <div style={{ padding: padded ? '18px 20px' : 0 }}>{children}</div>
    </div>
  );
}

// =============================================================================
//  ARTBOARD 1 · App shell
// =============================================================================
function ApertureShell() {
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', background: apTheme.bg, fontFamily: apTheme.sans, color: apTheme.ink }}>
      <ApSidebar active="dashboard" />
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {/* topbar */}
        <div
          style={{
            padding: '14px 28px',
            borderBottom: `1px solid ${apTheme.line}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: apTheme.bg,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontFamily: apTheme.mono, fontSize: 11.5, color: apTheme.ink3, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
            <span>Workspace</span>
            <span>›</span>
            <span style={{ color: apTheme.ink }}>Dashboard</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '7px 12px',
                background: apTheme.panel,
                border: `1px solid ${apTheme.line}`,
                borderRadius: 6,
                fontSize: 12.5,
                color: apTheme.ink3,
                width: 280,
              }}
            >
              <span>⌕</span>
              <span>Search calls, agents, notes…</span>
              <span style={{ marginLeft: 'auto', fontFamily: apTheme.mono, fontSize: 10, color: apTheme.ink3, border: `1px solid ${apTheme.line}`, borderRadius: 3, padding: '1px 5px' }}>⌘K</span>
            </div>
            <button
              style={{
                padding: '8px 14px',
                background: apTheme.ink,
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                fontFamily: apTheme.sans,
                fontSize: 12.5,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              + Upload call
            </button>
          </div>
        </div>

        <div style={{ flex: 1, padding: '32px 28px', overflow: 'hidden' }}>
          {/* page heading */}
          <div style={{ marginBottom: 24 }}>
            <div
              style={{
                fontFamily: apTheme.mono,
                fontSize: 11,
                textTransform: 'uppercase',
                letterSpacing: '0.14em',
                color: apTheme.teal,
                marginBottom: 8,
              }}
            >
              Tuesday · April 26
            </div>
            <h1
              style={{
                fontFamily: apTheme.serif,
                fontSize: 48,
                letterSpacing: '-0.03em',
                fontWeight: 400,
                margin: 0,
                lineHeight: 1.05,
              }}
            >
              Good afternoon, <span style={{ fontStyle: 'italic', color: apTheme.teal }}>Robin</span>.
            </h1>
            <div style={{ fontSize: 14, color: apTheme.ink3, marginTop: 10, fontFamily: apTheme.sans }}>
              Six calls processed since you were last here. Two need a closer look.
            </div>
          </div>

          {/* preview metric strip */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 20 }}>
            <ApMetric label="Calls today" value="42" sub="of 60 expected" delta="+12%" />
            <ApMetric label="Avg score" value="7.8" sub="rolling 7-day" delta="+0.3" />
            <ApMetric label="Sentiment" value="68%" sub="positive" delta="−2%" />
            <ApMetric label="Notes pending" value="04" sub="awaiting attestation" tone="amber" />
          </div>

          <div className="ph-band" style={{ flex: 1, height: 280, borderRadius: 8, border: `1px solid ${apTheme.line}`, background: apTheme.panel, display: 'flex', alignItems: 'center', justifyContent: 'center', color: apTheme.ink3, fontFamily: apTheme.mono, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
            Dashboard content continues ↓
          </div>
        </div>
      </main>
    </div>
  );
}

// =============================================================================
//  ARTBOARD 2 · Dashboard
// =============================================================================
function ApertureDashboard() {
  const calls = [
    { time: '14:02', agent: 'Maya P.', cat: 'Treatment plan', score: 9.1, sent: 'pos', dur: '12:04', tone: 'teal' },
    { time: '13:48', agent: 'Devon W.', cat: 'New patient', score: 8.4, sent: 'pos', dur: '08:21', tone: 'teal' },
    { time: '13:12', agent: 'Sara L.', cat: 'Insurance', score: 5.2, sent: 'neg', dur: '14:57', tone: 'rose' },
    { time: '12:55', agent: 'Maya P.', cat: 'Recall', score: 7.8, sent: 'pos', dur: '04:11' },
    { time: '12:30', agent: 'Jordan T.', cat: 'Billing', score: 6.0, sent: 'neu', dur: '09:42', tone: 'amber' },
    { time: '11:58', agent: 'Devon W.', cat: 'Treatment plan', score: 8.9, sent: 'pos', dur: '15:30' },
    { time: '11:14', agent: 'Sara L.', cat: 'New patient', score: 7.1, sent: 'neu', dur: '06:19' },
  ];

  // Sparkline path (sample 30 days)
  const trendPts = [3, 4, 5, 4, 6, 5, 7, 6, 7, 8, 6, 7, 8, 9, 7, 8, 7, 8, 9, 8, 9, 7, 8, 9, 10, 8, 9, 8, 9, 10];
  const max = 10;
  const w = 600;
  const h = 200;
  const sx = w / (trendPts.length - 1);
  const path = trendPts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${i * sx} ${h - (p / max) * h * 0.85 - 10}`).join(' ');
  const areaPath = `${path} L ${w} ${h} L 0 ${h} Z`;

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', background: apTheme.bg, fontFamily: apTheme.sans, color: apTheme.ink, overflow: 'hidden' }}>
      <ApSidebar active="dashboard" />
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
        <div
          style={{
            padding: '18px 32px',
            borderBottom: `1px solid ${apTheme.line}`,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: apTheme.bg,
          }}
        >
          <div>
            <div style={{ fontFamily: apTheme.mono, fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.14em', color: apTheme.ink3 }}>
              Workspace · Dashboard
            </div>
            <h1 style={{ fontFamily: apTheme.serif, fontSize: 30, letterSpacing: '-0.02em', fontWeight: 400, margin: '6px 0 0' }}>
              Today at the practice
            </h1>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={pillBtn(apTheme)}>Last 30 days ▾</button>
            <button style={pillBtn(apTheme)}>All teams ▾</button>
            <button style={primaryBtn(apTheme)}>+ Upload call</button>
          </div>
        </div>

        <div style={{ padding: '28px 32px', display: 'flex', flexDirection: 'column', gap: 24 }}>
          {/* Hero metrics */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
            <ApMetric label="Calls — month" value="1,284" sub="of 5,000 plan" delta="+18%" />
            <ApMetric label="Avg performance" value="7.84" sub="rolling 7-day" delta="+0.31" />
            <ApMetric label="Positive sentiment" value="68%" sub="of analyzed calls" delta="+4%" />
            <ApMetric label="Notes pending attest." value="12" sub="oldest 2h ago" tone="amber" />
          </div>

          {/* Trend chart + breakdown */}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
            <ApPanel title="Sentiment & volume" kicker="Last 30 days" action="View details →">
              <div style={{ display: 'flex', gap: 24, alignItems: 'flex-end', marginBottom: 18 }}>
                <div>
                  <div style={{ fontFamily: apTheme.mono, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.12em', color: apTheme.ink3 }}>
                    Avg score
                  </div>
                  <div style={{ fontFamily: apTheme.serif, fontSize: 36, letterSpacing: '-0.02em', lineHeight: 1 }}>7.84</div>
                </div>
                <div style={{ display: 'flex', gap: 16, marginLeft: 'auto', fontSize: 11.5, fontFamily: apTheme.mono, color: apTheme.ink3, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  <span><span style={{ display: 'inline-block', width: 8, height: 8, background: apTheme.teal, borderRadius: '50%', marginRight: 6 }} />Positive</span>
                  <span><span style={{ display: 'inline-block', width: 8, height: 8, background: apTheme.amber, borderRadius: '50%', marginRight: 6 }} />Neutral</span>
                  <span><span style={{ display: 'inline-block', width: 8, height: 8, background: apTheme.rose, borderRadius: '50%', marginRight: 6 }} />Negative</span>
                </div>
              </div>
              <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={200} preserveAspectRatio="none">
                <defs>
                  <linearGradient id="apFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor={apTheme.teal} stopOpacity="0.18" />
                    <stop offset="1" stopColor={apTheme.teal} stopOpacity="0" />
                  </linearGradient>
                </defs>
                {/* horizontal grid */}
                {[0, 0.25, 0.5, 0.75].map((p, i) => (
                  <line key={i} x1="0" x2={w} y1={h * p + 10} y2={h * p + 10} stroke={apTheme.line} strokeDasharray="2 4" />
                ))}
                <path d={areaPath} fill="url(#apFill)" />
                <path d={path} stroke={apTheme.teal} strokeWidth="1.6" fill="none" />
                {trendPts.map((p, i) => i % 5 === 0 && (
                  <circle key={i} cx={i * sx} cy={h - (p / max) * h * 0.85 - 10} r="2" fill={apTheme.teal} />
                ))}
              </svg>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: apTheme.mono, fontSize: 10, color: apTheme.ink3, marginTop: 6 }}>
                <span>Mar 28</span>
                <span>Apr 11</span>
                <span>Apr 26</span>
              </div>
            </ApPanel>

            <ApPanel title="By call category" kicker="Mix">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {[
                  { l: 'New patient', n: 412, p: 0.32, s: 8.2 },
                  { l: 'Treatment plan', n: 318, p: 0.25, s: 7.6 },
                  { l: 'Recall / hygiene', n: 246, p: 0.19, s: 8.9 },
                  { l: 'Insurance', n: 178, p: 0.14, s: 5.4 },
                  { l: 'Billing', n: 130, p: 0.10, s: 6.1 },
                ].map((r) => (
                  <div key={r.l}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 4 }}>
                      <span>{r.l}</span>
                      <span style={{ fontFamily: apTheme.mono, color: apTheme.ink3 }}>{r.n} · {r.s.toFixed(1)}</span>
                    </div>
                    <div style={{ height: 4, background: apTheme.lineSoft, borderRadius: 2 }}>
                      <div style={{ height: '100%', width: `${r.p * 100}%`, background: apTheme.teal, borderRadius: 2 }} />
                    </div>
                  </div>
                ))}
              </div>
            </ApPanel>
          </div>

          {/* Recent calls table */}
          <ApPanel title="Recent calls" kicker="Live" action="Open all calls →" padded={false}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: apTheme.panelMuted, fontFamily: apTheme.mono, fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.1em', color: apTheme.ink3 }}>
                  <th style={cellHead}>Time</th>
                  <th style={cellHead}>Agent</th>
                  <th style={cellHead}>Category</th>
                  <th style={{ ...cellHead, textAlign: 'right' }}>Score</th>
                  <th style={cellHead}>Sentiment</th>
                  <th style={{ ...cellHead, textAlign: 'right' }}>Duration</th>
                  <th style={{ ...cellHead, textAlign: 'right' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {calls.map((c, i) => (
                  <tr key={i} style={{ borderTop: `1px solid ${apTheme.line}` }}>
                    <td style={{ ...cellBody, fontFamily: apTheme.mono, color: apTheme.ink3 }}>{c.time}</td>
                    <td style={cellBody}>{c.agent}</td>
                    <td style={{ ...cellBody, color: apTheme.ink2 }}>{c.cat}</td>
                    <td style={{ ...cellBody, textAlign: 'right', fontFamily: apTheme.serif, fontSize: 16, color: c.score < 6 ? apTheme.rose : apTheme.ink }}>
                      {c.score.toFixed(1)}
                    </td>
                    <td style={cellBody}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: apTheme.ink2 }}>
                        <span
                          style={{
                            width: 7,
                            height: 7,
                            borderRadius: '50%',
                            background: c.sent === 'pos' ? apTheme.teal : c.sent === 'neg' ? apTheme.rose : apTheme.amber,
                          }}
                        />
                        {c.sent === 'pos' ? 'Positive' : c.sent === 'neg' ? 'Negative' : 'Neutral'}
                      </span>
                    </td>
                    <td style={{ ...cellBody, textAlign: 'right', fontFamily: apTheme.mono, color: apTheme.ink3 }}>{c.dur}</td>
                    <td style={{ ...cellBody, textAlign: 'right' }}>
                      {c.tone ? <ApPill tone={c.tone}>{c.tone === 'rose' ? 'Flagged' : c.tone === 'amber' ? 'Review' : 'Excellent'}</ApPill> : <span style={{ color: apTheme.ink3, fontSize: 12 }}>Analyzed</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ApPanel>

          {/* Bottom row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <ApPanel title="Top performers" kicker="This week">
              {[
                { n: 'Maya P.', score: 9.1, calls: 24 },
                { n: 'Devon W.', score: 8.7, calls: 18 },
                { n: 'Jordan T.', score: 8.2, calls: 21 },
              ].map((p, i) => (
                <div key={p.n} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: i === 0 ? 'none' : `1px solid ${apTheme.lineSoft}` }}>
                  <div style={{ fontFamily: apTheme.serif, fontSize: 22, color: apTheme.ink3, width: 24 }}>{i + 1}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 500 }}>{p.n}</div>
                    <div style={{ fontSize: 12, color: apTheme.ink3, fontFamily: apTheme.mono }}>{p.calls} calls</div>
                  </div>
                  <div style={{ fontFamily: apTheme.serif, fontSize: 26, color: apTheme.teal }}>{p.score.toFixed(1)}</div>
                </div>
              ))}
            </ApPanel>

            <ApPanel title="Coaching prompts" kicker="AI-suggested">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[
                  'Sara L. missed insurance verification on 3 of last 8 calls',
                  'Treatment-plan close-rate dropped 6% in the last 14 days',
                  'New-patient calls under 5 min have 22% lower scores',
                ].map((t, i) => (
                  <div key={i} style={{ padding: '10px 12px', border: `1px solid ${apTheme.line}`, borderRadius: 6, fontSize: 13, color: apTheme.ink2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                    <span>{t}</span>
                    <span style={{ color: apTheme.teal, fontSize: 12, whiteSpace: 'nowrap' }}>Open →</span>
                  </div>
                ))}
              </div>
            </ApPanel>
          </div>
        </div>
      </main>
    </div>
  );
}

const cellHead = { padding: '10px 16px', textAlign: 'left', fontWeight: 500 };
const cellBody = { padding: '12px 16px' };
const pillBtn = (t) => ({
  padding: '7px 12px',
  background: t.panel,
  border: `1px solid ${t.line}`,
  borderRadius: 6,
  fontSize: 12.5,
  color: t.ink2,
  fontFamily: t.sans,
  cursor: 'pointer',
});
const primaryBtn = (t) => ({
  padding: '7px 14px',
  background: t.ink,
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  fontSize: 12.5,
  fontFamily: t.sans,
  fontWeight: 500,
  cursor: 'pointer',
});

// =============================================================================
//  ARTBOARD 3 · Clinical scribe
// =============================================================================
function ApertureClinical() {
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', background: apTheme.bg, fontFamily: apTheme.sans, color: apTheme.ink, overflow: 'hidden' }}>
      <ApSidebar active="clinical" />
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
        {/* Header */}
        <div style={{ padding: '20px 32px', borderBottom: `1px solid ${apTheme.line}`, background: apTheme.bg }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontFamily: apTheme.mono, fontSize: 11, color: apTheme.ink3, textTransform: 'uppercase', letterSpacing: '0.12em' }}>
            <span>Clinical</span><span>›</span><span>SOAP note</span><span>›</span><span style={{ color: apTheme.ink }}>Encounter #4821</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 14 }}>
            <div>
              <h1 style={{ fontFamily: apTheme.serif, fontSize: 34, letterSpacing: '-0.02em', fontWeight: 400, margin: 0, lineHeight: 1.05 }}>
                Margaret Holloway, <span style={{ fontStyle: 'italic', color: apTheme.ink3 }}>62F</span>
              </h1>
              <div style={{ fontSize: 13, color: apTheme.ink3, marginTop: 6, display: 'flex', gap: 14, fontFamily: apTheme.mono }}>
                <span>APR 26 · 14:02</span>
                <span>Dr. Reyes · Operative</span>
                <span>Encounter 12m 04s</span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <ApPill tone="amber">Draft · awaiting attestation</ApPill>
              <button style={pillBtn(apTheme)}>Edit</button>
              <button style={pillBtn(apTheme)}>Print</button>
              <button style={{ ...primaryBtn(apTheme), background: apTheme.teal }}>✓ Attest note</button>
            </div>
          </div>
        </div>

        {/* Two-column workspace */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: 0, flex: 1 }}>
          {/* LEFT: Note */}
          <div style={{ padding: '28px 32px', borderRight: `1px solid ${apTheme.line}`, display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div>
              <div style={{ fontFamily: apTheme.mono, fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.12em', color: apTheme.teal, marginBottom: 6 }}>
                Chief Complaint
              </div>
              <div style={{ fontFamily: apTheme.serif, fontSize: 22, fontStyle: 'italic', color: apTheme.ink, lineHeight: 1.3 }}>
                "Persistent ache, lower right molar, worse with cold for the past two weeks."
              </div>
            </div>

            {[
              { k: 'Subjective', body: 'Patient reports gradual onset of cold sensitivity localized to the lower right second molar (#31), now spontaneous and waking her at night. No prior trauma. OTC ibuprofen partially effective. No swelling, no systemic symptoms. Last cleaning 14 months ago.' },
              { k: 'Objective', body: 'Tooth #31 — deep distal caries extending into pulp on radiograph. Percussion: tender. Cold test: prolonged response. Probing depths WNL. No swelling, no sinus tract. Adjacent teeth #30, #32 normal. BP 128/82, HR 74.' },
              { k: 'Assessment', body: 'Symptomatic irreversible pulpitis #31 secondary to deep distal carious lesion. Radiographic findings consistent with Class II caries with pulpal involvement. Prognosis good with timely endodontic intervention; tooth restorable.' },
            ].map((s) => (
              <div key={s.k}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                  <div style={{ fontFamily: apTheme.mono, fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.12em', color: apTheme.teal }}>{s.k}</div>
                  <div style={{ fontSize: 11, color: apTheme.ink3, fontFamily: apTheme.mono }}>edit</div>
                </div>
                <p style={{ fontSize: 14, lineHeight: 1.6, color: apTheme.ink2, margin: 0 }}>{s.body}</p>
              </div>
            ))}

            <div>
              <div style={{ fontFamily: apTheme.mono, fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.12em', color: apTheme.teal, marginBottom: 8 }}>Plan</div>
              <ol style={{ paddingLeft: 18, margin: 0, fontSize: 14, lineHeight: 1.7, color: apTheme.ink2 }}>
                <li>Initiate endodontic therapy on #31 — pulpotomy today, RCT scheduled within 1 week.</li>
                <li>Rx amoxicillin 500 mg TID × 7d as prophylaxis given pulpal involvement.</li>
                <li>Post-RCT crown buildup and full-coverage restoration.</li>
                <li>Hygiene recall in 6 months; reinforce flossing technique discussed.</li>
              </ol>
            </div>

            <div style={{ borderTop: `1px solid ${apTheme.line}`, paddingTop: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <div style={{ fontFamily: apTheme.mono, fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.12em', color: apTheme.ink3, marginBottom: 6 }}>ICD-10 (suggested)</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {[['K04.01', 'Pulpitis, irreversible'], ['K02.61', 'Caries on pit/fissure']].map(([c, d]) => (
                    <div key={c} style={{ fontSize: 12, padding: '5px 9px', background: apTheme.panel, border: `1px solid ${apTheme.line}`, borderRadius: 4 }}>
                      <span style={{ fontFamily: apTheme.mono, color: apTheme.teal }}>{c}</span>
                      <span style={{ color: apTheme.ink3, marginLeft: 6 }}>{d}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div style={{ fontFamily: apTheme.mono, fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.12em', color: apTheme.ink3, marginBottom: 6 }}>CDT (suggested)</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {[['D3220', 'Pulpotomy'], ['D2950', 'Core buildup']].map(([c, d]) => (
                    <div key={c} style={{ fontSize: 12, padding: '5px 9px', background: apTheme.panel, border: `1px solid ${apTheme.line}`, borderRadius: 4 }}>
                      <span style={{ fontFamily: apTheme.mono, color: apTheme.teal }}>{c}</span>
                      <span style={{ color: apTheme.ink3, marginLeft: 6 }}>{d}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* RIGHT: Transcript + analysis */}
          <div style={{ padding: '28px 32px', display: 'flex', flexDirection: 'column', gap: 20, background: apTheme.panelMuted }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
                <div style={{ fontFamily: apTheme.serif, fontSize: 20 }}>Transcript</div>
                <div style={{ fontFamily: apTheme.mono, fontSize: 11, color: apTheme.ink3 }}>2 speakers · 12:04</div>
              </div>

              {/* Scrubber */}
              <div style={{ background: apTheme.panel, border: `1px solid ${apTheme.line}`, borderRadius: 6, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                <span style={{ width: 26, height: 26, borderRadius: '50%', background: apTheme.ink, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11 }}>▶</span>
                <span style={{ fontFamily: apTheme.mono, fontSize: 11, color: apTheme.ink3 }}>03:24</span>
                <div style={{ flex: 1, height: 16, position: 'relative' }}>
                  <svg viewBox="0 0 200 16" preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
                    {Array.from({ length: 80 }).map((_, i) => {
                      const hgt = 2 + ((i * 13) % 11);
                      return <rect key={i} x={i * 2.5} y={(16 - hgt) / 2} width="1.4" height={hgt} fill={i < 28 ? apTheme.teal : apTheme.line} rx="0.6" />;
                    })}
                  </svg>
                </div>
                <span style={{ fontFamily: apTheme.mono, fontSize: 11, color: apTheme.ink3 }}>12:04</span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 14, fontSize: 13.5, lineHeight: 1.55 }}>
                {[
                  { sp: 'Dr. R', t: 'How long has the pain been waking you up at night?', accent: true },
                  { sp: 'Pt', t: 'About a week now. It started just being cold-sensitive but now it just throbs.', q: true },
                  { sp: 'Dr. R', t: 'Any swelling, anything that feels hot to the touch?', accent: true },
                  { sp: 'Pt', t: 'No swelling. No fever. Just the tooth itself.', q: true },
                  { sp: 'Dr. R', t: 'Okay — looking at the X-ray, the decay has reached the nerve. We\'re going to need to do a pulpotomy today and schedule the root canal.', accent: true, hl: true },
                ].map((m, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '40px 1fr', gap: 10 }}>
                    <div style={{ fontFamily: apTheme.mono, fontSize: 10.5, color: m.accent ? apTheme.teal : apTheme.ink3, textTransform: 'uppercase' }}>{m.sp}</div>
                    <div
                      style={{
                        color: apTheme.ink2,
                        background: m.hl ? apTheme.tealSoft : 'transparent',
                        padding: m.hl ? '4px 8px' : 0,
                        borderRadius: m.hl ? 4 : 0,
                        borderLeft: m.hl ? `2px solid ${apTheme.teal}` : 'none',
                      }}
                    >
                      {m.t}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ background: apTheme.panel, border: `1px solid ${apTheme.line}`, borderRadius: 8, padding: '16px 18px' }}>
              <div style={{ fontFamily: apTheme.mono, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.12em', color: apTheme.ink3, marginBottom: 10 }}>Note quality</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                {[
                  { k: 'Completeness', v: '8.6' },
                  { k: 'Accuracy', v: '9.1' },
                  { k: 'Specificity', v: '7.9' },
                ].map((m) => (
                  <div key={m.k}>
                    <div style={{ fontFamily: apTheme.serif, fontSize: 28, lineHeight: 1, color: apTheme.ink }}>{m.v}<span style={{ fontSize: 14, color: apTheme.ink3 }}>/10</span></div>
                    <div style={{ fontSize: 11, color: apTheme.ink3, fontFamily: apTheme.mono, textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 4 }}>{m.k}</div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ background: apTheme.panel, border: `1px solid ${apTheme.line}`, borderRadius: 8, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ width: 30, height: 30, borderRadius: '50%', background: apTheme.tealSoft, color: apTheme.tealDeep, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: apTheme.serif, fontSize: 18, fontStyle: 'italic' }}>i</span>
              <div style={{ fontSize: 13, color: apTheme.ink2, flex: 1 }}>
                Note matches your prior pulpitis documentation style. <span style={{ color: apTheme.teal }}>3 templates referenced.</span>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

// expose
window.ApertureShell = ApertureShell;
window.ApertureDashboard = ApertureDashboard;
window.ApertureClinical = ApertureClinical;
window.apTheme = apTheme;
window.ApOwl = ApOwl;
