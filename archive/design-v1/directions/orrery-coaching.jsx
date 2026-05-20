/* global React */
/* eslint-disable */
const { useState: useStateCo, useMemo: useMemoCo } = React;
const {
  ORRERY_LIGHT, ORRERY_DARK, TILT, orreryProject,
  OrreryTopBar, OrreryOwl, OrreryThemeToggle, OrreryStarfield, OrreryCard, OrreryTag,
  brightToColor,
} = window;

// =============================================================================
//  Coaching — landing page
//  Tier: full orrery (hero) → quiet orrery (sessions list) → workbench (session detail)
//  Each agent is a small system. Sessions move agents from dim → bright.
// =============================================================================

const COACH_AGENTS = [
  { id: 'm.cruz',  name: 'Maya Cruz',     role: 'Front desk',         brightness: 0.86, delta: +0.08, sessions: 0, flagged: 1, ringHot: true,  note: 'Anchor of the team this week.' },
  { id: 'd.patel', name: 'Devi Patel',    role: 'Treatment coord.',   brightness: 0.74, delta: +0.04, sessions: 1, flagged: 2 },
  { id: 'a.kim',   name: 'Andrew Kim',    role: 'Front desk',         brightness: 0.62, delta: -0.02, sessions: 1, flagged: 3 },
  { id: 's.ortiz', name: 'Sara Ortiz',    role: 'Front desk',         brightness: 0.55, delta: +0.11, sessions: 2, flagged: 2, rising: true },
  { id: 'j.chen',  name: 'Jordan Chen',   role: 'Insurance',          brightness: 0.48, delta: -0.05, sessions: 1, flagged: 4 },
  { id: 'p.nguy',  name: 'Phong Nguyen',  role: 'Treatment coord.',   brightness: 0.34, delta: -0.09, sessions: 0, flagged: 5, dim: true },
];

const COACH_SESSIONS = [
  {
    id: 's-204',
    agent: 'a.kim',
    title: 'Soften refusals on insurance hand-off',
    category: 'Communication',
    status: 'in_progress',
    due: 'May 03',
    progress: { done: 2, total: 4 },
    refCalls: 3,
    pre: 0.51, post: null,
    owl: 'Andrew is closing 18% lower on calls that involve insurance verification. The drop happens after the patient asks "is this covered?" — three of his last six insurance calls ended within a minute of that question.',
    actionPlan: [
      { task: 'Review three flagged calls in Constellation: Insurance Snag.', done: true },
      { task: 'Practice scripted bridges for "is this covered?" using Ory\'s suggested phrasing.', done: true },
      { task: 'Record one mock call by Friday using the new bridge.', done: false },
      { task: 'Follow-up review with Sara on Monday.', done: false },
    ],
    refCallList: [
      { name: 'Patricia Wong',   date: 'Apr 27', drop: 'after benefits Q' },
      { name: 'Jeremy Ortega',   date: 'Apr 24', drop: 'soft refusal at quote' },
      { name: 'Anita Sundaram',  date: 'Apr 22', drop: 'patient went quiet' },
    ],
  },
  {
    id: 's-203',
    agent: 'd.patel',
    title: 'Tx plan walk-through pacing',
    category: 'Treatment plans',
    status: 'pending',
    due: 'May 06',
    progress: { done: 0, total: 3 },
    refCalls: 2,
    pre: 0.66, post: null,
    owl: 'Devi rushes the cost line. On three of her last four Tx plan calls, the cost was stated within 12 seconds of opening the plan — patients had no time to absorb the procedures before being asked for a decision.',
    actionPlan: [
      { task: 'Watch annotated walkthrough on pacing (8 min).', done: false },
      { task: 'Try the "two-step" pacing on next three Tx plan calls.', done: false },
      { task: 'Self-review one of those three with the rubric.', done: false },
    ],
  },
  {
    id: 's-201',
    agent: 's.ortiz',
    title: 'New-patient intake warmth',
    category: 'Communication',
    status: 'in_progress',
    due: 'May 02',
    progress: { done: 3, total: 3 },
    refCalls: 2,
    pre: 0.42, post: 0.71,
    owl: 'Sara asked us to slow down with new patients in particular. Her last three new-patient calls show real lift — she\'s naming the patient earlier and slowing the intake form pace.',
    rising: true,
    actionPlan: [
      { task: 'Use the new-patient warm-open script on 5 calls.', done: true },
      { task: 'Self-review one with rubric.', done: true },
      { task: 'Follow-up with Maya on Friday.', done: true },
    ],
  },
  {
    id: 's-198',
    agent: 'j.chen',
    title: 'Clarifying ambiguous benefits answers',
    category: 'Insurance',
    status: 'in_progress',
    due: 'May 08',
    progress: { done: 1, total: 5 },
    refCalls: 4,
    pre: 0.38, post: null,
  },
  {
    id: 's-188',
    agent: 'a.kim',
    title: 'Recall outreach scripts',
    category: 'Outreach',
    status: 'completed',
    due: 'Apr 22',
    progress: { done: 4, total: 4 },
    refCalls: 1,
    pre: 0.55, post: 0.74,
    completedOn: 'Apr 22',
  },
];

const COACH_SUGGESTED = [
  {
    title: 'Insurance Snag is the team\'s common dim spot',
    body: 'Three agents — Andrew, Jordan, Phong — all show below-baseline close rates on calls that touch benefits verification. A team-level coaching could reach all three faster than three individual sessions.',
    cta: 'Start team session',
    link: 'patterns',
  },
  {
    title: 'Phong has no active session and dropped 9 points',
    body: 'Five flagged calls in two weeks. Ory recommends a coaching draft now — pick a constellation to anchor it.',
    cta: 'Draft session for Phong',
  },
];

// ---------------- agent-as-card (clinical) ----------------
//  Chart-first card. No starfield, no moons, no orbit. Score chip, trend
//  arrow, name/role, two compact stats. Reads as a roster row.
function ClinicalAgentCard({ agent, t, focused, onClick }) {
  const color = brightToColor(agent.brightness, t);
  const trendColor = agent.delta > 0 ? t.green : agent.delta < 0 ? t.red : t.inkMute;
  return (
    <div onClick={onClick} style={{
      cursor: 'pointer',
      borderRadius: 10,
      border: `0.5px solid ${focused ? t.bright : t.panelBorder}`,
      background: focused
        ? (t.name === 'light' ? 'rgba(34,184,207,0.06)' : 'rgba(34,184,207,0.08)')
        : t.panel,
      backdropFilter: 'blur(8px)',
      padding: '14px 16px',
      borderLeft: agent.dim ? `2px solid ${t.amber}` : agent.ringHot ? `2px solid ${t.bright}` : `0.5px solid ${t.panelBorder}`,
      transition: 'border-color 200ms, transform 200ms',
      transform: focused ? 'translateY(-1px)' : 'none',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{
          flex: '0 0 38px', width: 38, height: 38, borderRadius: 8,
          background: `${color}1c`, border: `0.5px solid ${color}55`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexDirection: 'column', lineHeight: 1,
        }}>
          <span style={{ fontFamily: '"Inter", system-ui, sans-serif', fontSize: 16, fontWeight: 600, color: t.ink }}>
            {(agent.brightness * 10).toFixed(1)}
          </span>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 7.5, color: t.inkMute, letterSpacing: '0.06em', marginTop: 1 }}>/10</span>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: t.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {agent.name}
            </span>
            {agent.delta !== 0 && (
              <span style={{
                fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
                color: trendColor, letterSpacing: '0.06em',
              }}>{agent.delta > 0 ? '↑' : '↓'} {Math.abs(agent.delta).toFixed(2)}</span>
            )}
          </div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, color: t.inkMute, letterSpacing: '0.10em', textTransform: 'uppercase', marginTop: 2 }}>
            {agent.role}
          </div>
          <div style={{ display: 'flex', gap: 14, marginTop: 8, fontSize: 11, color: t.inkSoft, flexWrap: 'wrap' }}>
            <span><span style={{ color: t.ink, fontFamily: "'JetBrains Mono', monospace" }}>{agent.flagged}</span> flagged</span>
            <span><span style={{ color: t.ink, fontFamily: "'JetBrains Mono', monospace" }}>{agent.sessions}</span> session{agent.sessions === 1 ? '' : 's'}</span>
            {agent.dim && <span style={{ color: t.amber, fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, letterSpacing: '0.10em', textTransform: 'uppercase' }}>◆ NEEDS COACH</span>}
            {agent.ringHot && <span style={{ color: t.bright, fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, letterSpacing: '0.10em', textTransform: 'uppercase' }}>◆ TOP</span>}
          </div>
          {agent.note && (
            <div style={{ fontSize: 11.5, color: t.inkSoft, lineHeight: 1.45, marginTop: 8, paddingTop: 8, borderTop: `0.5px solid ${t.panelStroke}` }}>
              {agent.note}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------- agent-as-system mini orrery ----------------

function AgentSystem({ agent, t, focused, onClick }) {
  const W = 240, H = 180;
  const cx = W / 2, cy = H / 2;
  const r = 40;
  // Moons (flagged calls) — placed on the orbit with deterministic phases
  const moons = Array.from({ length: agent.flagged }).map((_, i) => {
    const phase = (i / Math.max(agent.flagged, 1)) * Math.PI * 2 + (agent.id.charCodeAt(0) % 7) * 0.4;
    return {
      x: cx + Math.cos(phase) * r,
      y: cy + Math.sin(phase) * r * TILT,
      r: 2.6 + (i % 3) * 0.4,
    };
  });
  const starColor = brightToColor(agent.brightness, t);
  // Agent cards are visualization-forward tiles — each is a small celestial
  // system. On a light page the starfield + glow + halo only earn their
  // keep against dark, so we render the whole card with ORRERY_DARK tokens,
  // creating a row of small "sky tiles." Dark page passes through unchanged.
  const isLightPage = t.name === 'light';
  const cardT = isLightPage ? (window.ORRERY_DARK || t) : t;
  return (
    <div onClick={onClick} style={{
      cursor: 'pointer',
      borderRadius: 14,
      border: `0.5px solid ${focused ? cardT.bright : (isLightPage ? 'rgba(255,255,255,0.08)' : cardT.panelBorder)}`,
      background: focused
        ? (isLightPage
          ? 'radial-gradient(ellipse at 50% 30%, #0e1840 0%, #04081a 75%)'
          : 'rgba(34,184,207,0.10)')
        : (isLightPage
          ? 'radial-gradient(ellipse at 50% 30%, #0c1538 0%, #04081a 80%)'
          : cardT.panel),
      backdropFilter: isLightPage ? 'none' : 'blur(8px)',
      boxShadow: isLightPage
        ? 'inset 0 0 0 1px rgba(255,255,255,0.04), 0 1px 2px rgba(20,30,60,0.10)'
        : 'none',
      transition: 'transform 200ms, border-color 200ms',
      transform: focused ? 'translateY(-2px)' : 'none',
      overflow: 'hidden',
      position: 'relative',
    }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: 'block' }}>
        {/* faint starfield backdrop (so the system reads as a sky tile) */}
        {isLightPage && Array.from({ length: 18 }).map((_, i) => {
          const sx = (Math.sin(i * 6.7 + agent.id.charCodeAt(0)) + 1) * 0.5 * W;
          const sy = (Math.cos(i * 4.3 + agent.id.charCodeAt(0)) + 1) * 0.5 * H;
          const sop = 0.25 + ((Math.sin(i * 2.1) + 1) * 0.25);
          const sr = 0.35 + ((Math.cos(i * 1.9) + 1) * 0.30);
          return <circle key={'sf' + i} cx={sx} cy={sy} r={sr} fill={cardT.starfield} opacity={sop * 0.6} />;
        })}
        {/* orbit */}
        <ellipse cx={cx} cy={cy} rx={r} ry={r * TILT}
          fill="none" stroke={cardT.orbit} strokeWidth="0.6"
          strokeDasharray={agent.dim ? '2 3' : '0'} />
        {/* hot ring */}
        {agent.ringHot && (
          <ellipse cx={cx} cy={cy} rx={r * 1.55} ry={r * 0.55}
            fill="none" stroke={cardT.ringStroke} strokeWidth="0.6" />
        )}
        {/* anomaly halo for dim */}
        {agent.dim && (
          <circle cx={cx} cy={cy} r={11} fill="none"
            stroke={cardT.amber} strokeWidth="0.6" strokeDasharray="2 1.5" />
        )}
        {/* star */}
        <circle cx={cx} cy={cy} r={agent.flagged * 0.4 + 6.5}
          fill={starColor} opacity="0.22"
          style={{ filter: `blur(2px)` }} />
        <circle cx={cx} cy={cy} r="6" fill={starColor}
          style={{ filter: `drop-shadow(0 0 8px ${starColor})` }} />
        <circle cx={cx} cy={cy} r="2" fill="#fff" opacity="0.9" />
        {/* trajectory chip — floats over the system, conceptually attached to the star */}
        {agent.delta !== 0 && (
          <foreignObject x={W - 64} y={8} width={56} height={20}>
            <div xmlns="http://www.w3.org/1999/xhtml" style={{
              fontFamily: 'JetBrains Mono, monospace', fontSize: 9.5,
              letterSpacing: '0.06em',
              color: agent.delta > 0 ? cardT.green : cardT.red,
              textAlign: 'right',
            }}>
              {agent.delta > 0 ? '↑' : '↓'} {Math.abs(agent.delta).toFixed(2)}
            </div>
          </foreignObject>
        )}
        {/* trajectory arrow */}
        {agent.delta !== 0 && (() => {
          const up = agent.delta > 0;
          const dy = up ? -3 : 3;
          return (
            <g>
              <line x1={cx + 9} y1={cy} x2={cx + 14} y2={cy + dy}
                stroke={up ? cardT.green : cardT.red} strokeWidth="1" strokeLinecap="round" />
              <circle cx={cx + 14} cy={cy + dy} r="1.4"
                fill={up ? cardT.green : cardT.red} />
            </g>
          );
        })()}
        {/* moons */}
        {moons.map((m, i) => (
          <g key={i}>
            <circle cx={m.x} cy={m.y} r={m.r} fill={cardT.warm} opacity="0.85" />
            <circle cx={m.x - m.r * 0.3} cy={m.y - m.r * 0.3}
              rx={m.r * 0.45} ry={m.r * 0.35} fill={cardT.highlight} opacity="0.5" />
          </g>
        ))}
      </svg>

      <div style={{ padding: '0 16px 14px', marginTop: -6 }}>
        <div style={{
          fontFamily: '"Inter", system-ui, sans-serif', fontStyle: 'italic',
          fontSize: 19, color: cardT.ink, letterSpacing: '-0.01em',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{agent.name}</div>
        <div style={{
          fontFamily: 'JetBrains Mono, monospace', fontSize: 9.5,
          letterSpacing: '0.10em', color: cardT.inkMute, textTransform: 'uppercase', marginTop: 2,
        }}>{agent.role}</div>
        <div style={{
          display: 'flex', justifyContent: 'space-between',
          marginTop: 10, fontSize: 11, color: cardT.inkSoft,
        }}>
          <span>
            <span style={{ color: cardT.ink, fontFamily: 'JetBrains Mono, monospace' }}>{agent.flagged}</span> flagged
          </span>
          <span>
            <span style={{ color: cardT.ink, fontFamily: 'JetBrains Mono, monospace' }}>{agent.sessions}</span> active session{agent.sessions === 1 ? '' : 's'}
          </span>
        </div>
        {agent.note && (
          <div style={{
            fontSize: 11.5, color: cardT.inkSoft, lineHeight: 1.5, marginTop: 10,
            fontStyle: 'italic', fontFamily: '"Inter", system-ui, sans-serif',
            paddingTop: 10, borderTop: `0.5px solid ${cardT.panelStroke}`,
          }}>{agent.note}</div>
        )}
      </div>
    </div>
  );
}

// Clinical replacement for the pre/post arc: compact horizontal bars.
function ClinicalEffectivenessBars({ pre, post, t, w = 200 }) {
  const prePct = Math.max(0, Math.min(1, pre)) * 100;
  const postPct = post != null ? Math.max(0, Math.min(1, post)) * 100 : null;
  return (
    <div style={{ width: w }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, letterSpacing: '0.10em', color: t.inkMute, textTransform: 'uppercase' }}>BEFORE</span>
        <span style={{ fontFamily: '"Inter", system-ui, sans-serif', fontSize: 13, fontWeight: 600, color: t.ink }}>{(pre * 100).toFixed(0)}</span>
      </div>
      <div style={{ height: 4, background: t.panelBorder, borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${prePct}%`, height: '100%', background: t.inkSoft, opacity: 0.6 }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 8, marginBottom: 4 }}>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, letterSpacing: '0.10em', color: t.inkMute, textTransform: 'uppercase' }}>AFTER</span>
        <span style={{ fontFamily: '"Inter", system-ui, sans-serif', fontSize: 13, fontWeight: 600, color: postPct == null ? t.inkMute : t.ink }}>
          {postPct == null ? '—' : (post * 100).toFixed(0)}
        </span>
      </div>
      <div style={{ height: 4, background: t.panelBorder, borderRadius: 2, overflow: 'hidden' }}>
        {postPct != null && (
          <div style={{ width: `${postPct}%`, height: '100%', background: `linear-gradient(90deg, ${t.warm}, ${t.bright})` }} />
        )}
      </div>
    </div>
  );
}

// ---------------- pre→post arc ----------------

function EffectivenessArc({ pre, post, t, w = 200, h = 88 }) {
  const r = 200;
  const cx = w / 2;
  const cy = 32 + r;
  const halfSpan = 0.32;
  const startA = -Math.PI / 2 - halfSpan;
  const endA = -Math.PI / 2 + halfSpan;
  const pointAt = (frac) => {
    const a = startA + (endA - startA) * frac;
    return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
  };
  const a0 = pointAt(0), a1 = pointAt(1);
  const arcPath = `M ${a0.x.toFixed(2)} ${a0.y.toFixed(2)} A ${r} ${r} 0 0 1 ${a1.x.toFixed(2)} ${a1.y.toFixed(2)}`;
  const preColor = brightToColor(pre, t);
  const postColor = post != null ? brightToColor(post, t) : null;
  const preDot = pointAt(0);
  const postDot = post != null ? pointAt(1) : null;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} style={{ display: 'block', overflow: 'visible' }}>
      <path d={arcPath} fill="none" stroke={t.panelBorder} strokeWidth="0.75"
        strokeDasharray={post == null ? '2 3' : '0'} />
      {/* pre */}
      <circle cx={preDot.x} cy={preDot.y} r="6" fill={preColor} opacity="0.22" />
      <circle cx={preDot.x} cy={preDot.y} r="3.5" fill={preColor}
        style={{ filter: `drop-shadow(0 0 4px ${preColor})` }} />
      <text x={preDot.x} y={preDot.y - 12} fontFamily="JetBrains Mono, monospace"
        fontSize="9" letterSpacing="0.10em" textAnchor="middle"
        fill={t.inkMute} style={{ textTransform: 'uppercase' }}>BEFORE</text>
      <text x={preDot.x} y={preDot.y + 18} fontFamily='"Inter", system-ui, sans-serif'
        fontStyle="italic" fontSize="13" textAnchor="middle" fill={t.ink}>
        {(pre * 100).toFixed(0)}
      </text>
      {/* post */}
      {postDot ? (
        <g>
          <circle cx={postDot.x} cy={postDot.y} r="6" fill={postColor} opacity="0.22" />
          <circle cx={postDot.x} cy={postDot.y} r="3.5" fill={postColor}
            style={{ filter: `drop-shadow(0 0 6px ${postColor})` }} />
          <text x={postDot.x} y={postDot.y - 12} fontFamily="JetBrains Mono, monospace"
            fontSize="9" letterSpacing="0.10em" textAnchor="middle"
            fill={t.inkMute} style={{ textTransform: 'uppercase' }}>AFTER</text>
          <text x={postDot.x} y={postDot.y + 18} fontFamily='"Inter", system-ui, sans-serif'
            fontStyle="italic" fontSize="13" textAnchor="middle" fill={t.ink}>
            {(post * 100).toFixed(0)}
          </text>
        </g>
      ) : (
        <g>
          <circle cx={a1.x} cy={a1.y} r="3.5" fill="none"
            stroke={t.inkMute} strokeWidth="0.8" strokeDasharray="1.5 1.5" />
          <text x={a1.x} y={a1.y - 12} fontFamily="JetBrains Mono, monospace"
            fontSize="9" letterSpacing="0.10em" textAnchor="middle"
            fill={t.inkMute} style={{ textTransform: 'uppercase' }}>AFTER</text>
          <text x={a1.x} y={a1.y + 18} fontFamily='"Inter", system-ui, sans-serif'
            fontStyle="italic" fontSize="13" textAnchor="middle" fill={t.inkMute}>
            —
          </text>
        </g>
      )}
    </svg>
  );
}

// ---------------- session row ----------------

function SessionRow({ session, agent, t, expanded, onToggle, theme, clinical = false }) {
  const statusMap = {
    pending:     { fg: t.amber, label: 'PENDING' },
    in_progress: { fg: t.warm,  label: 'IN PROGRESS' },
    completed:   { fg: t.green, label: 'COMPLETED' },
    dismissed:   { fg: t.inkMute, label: 'DISMISSED' },
  };
  const st = statusMap[session.status];
  const pct = session.progress.total > 0
    ? session.progress.done / session.progress.total : 0;
  const agentBright = agent ? brightToColor(agent.brightness, t) : t.cool;

  return (
    <div style={{
      borderTop: `0.5px solid ${t.panelStroke}`,
      transition: 'background 200ms',
      background: expanded ? (theme === 'light' ? 'rgba(34,184,207,0.04)' : 'rgba(34,184,207,0.06)') : 'transparent',
    }}>
      <div onClick={onToggle} style={{
        display: 'grid',
        gridTemplateColumns: '14px 1.6fr 1fr auto auto auto',
        gap: 16, alignItems: 'center',
        padding: '14px 4px', cursor: 'pointer',
      }}>
        {/* agent brightness pip */}
        <span style={{
          width: 10, height: 10, borderRadius: '50%', background: agentBright,
          boxShadow: `0 0 8px ${agentBright}`,
        }} />
        {/* title + tags */}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, color: t.ink, fontWeight: 500, lineHeight: 1.35 }}>
            {session.title}
          </div>
          <div style={{
            display: 'flex', gap: 10, marginTop: 4, alignItems: 'center', flexWrap: 'wrap',
            fontSize: 10.5, fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.10em',
            color: t.inkMute, textTransform: 'uppercase',
          }}>
            <span>{clinical ? '◆' : '◇'} {session.category}</span>
            <span>·</span>
            <span>{agent ? agent.name : 'Unknown'}</span>
            <span>·</span>
            <span>Due {session.due}</span>
            {session.refCalls > 0 && <><span>·</span><span>{session.refCalls} ref calls</span></>}
          </div>
        </div>
        {/* progress bar */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: t.inkSoft, marginBottom: 4, fontFamily: 'JetBrains Mono, monospace' }}>
            <span>{session.progress.done}/{session.progress.total} tasks</span>
            <span>{Math.round(pct * 100)}%</span>
          </div>
          <div style={{
            height: 4, borderRadius: 2,
            background: t.name === 'light' ? 'rgba(20,30,60,0.06)' : 'rgba(244,236,219,0.08)',
            overflow: 'hidden',
          }}>
            <div style={{
              width: `${pct * 100}%`, height: '100%',
              background: `linear-gradient(90deg, ${t.cool}, ${t.bright})`,
              transition: 'width 300ms',
            }} />
          </div>
        </div>
        {/* status */}
        <span style={{
          fontFamily: 'JetBrains Mono, monospace', fontSize: 10,
          letterSpacing: '0.12em', color: st.fg,
          textTransform: 'uppercase',
        }}>{clinical ? '◆' : '◇'} {st.label}</span>
        {/* mini arc */}
        {session.pre != null && (
          <div style={{ width: 100, height: 36 }}>
            <MiniArc pre={session.pre} post={session.post} t={t} />
          </div>
        )}
        <span style={{ color: t.inkMute, fontSize: 12, fontFamily: 'JetBrains Mono, monospace' }}>
          {expanded ? '▴' : '▾'}
        </span>
      </div>

      {expanded && (
        <div style={{
          padding: '6px 4px 22px',
          display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 28,
        }}>
          {/* left — owl note + action plan */}
          <div>
            {session.owl && (
              <div style={{
                background: theme === 'light' ? 'rgba(34,184,207,0.08)' : 'rgba(34,184,207,0.12)',
                border: `0.5px solid ${t.panelBorder}`, borderRadius: 10,
                padding: '12px 14px', marginBottom: 16,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <OrreryOwl t={t} size={16} />
                  <span style={{
                    fontFamily: 'JetBrains Mono, monospace', fontSize: 9.5,
                    letterSpacing: '0.14em', color: t.bright, textTransform: 'uppercase',
                  }}>{clinical ? '◆' : '◇'} Ory's brief</span>
                </div>
                <p style={{
                  fontFamily: '"Inter", system-ui, sans-serif',
                  fontStyle: clinical ? 'normal' : 'italic',
                  fontWeight: clinical ? 500 : 400,
                  fontSize: 14.5, lineHeight: 1.5, color: t.ink, margin: 0, textWrap: 'pretty',
                }}>{session.owl}</p>
              </div>
            )}

            <div style={{
              fontFamily: 'JetBrains Mono, monospace', fontSize: 10,
              letterSpacing: '0.14em', color: t.inkMute,
              textTransform: 'uppercase', marginBottom: 8,
            }}>Action plan</div>
            <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
              {(session.actionPlan || []).map((a, i) => (
                <li key={i} style={{
                  display: 'grid', gridTemplateColumns: '20px 1fr', gap: 10,
                  padding: '8px 0', borderTop: i === 0 ? 'none' : `0.5px solid ${t.panelStroke}`,
                  alignItems: 'baseline',
                }}>
                  <span style={{
                    width: 14, height: 14, borderRadius: 3,
                    border: `1px solid ${a.done ? t.bright : t.panelBorder}`,
                    background: a.done ? t.bright : 'transparent',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    color: '#fff', fontSize: 10, fontWeight: 600, marginTop: 2,
                  }}>
                    {a.done ? '✓' : ''}
                  </span>
                  <span style={{
                    fontSize: 13.5, color: a.done ? t.inkSoft : t.ink, lineHeight: 1.5,
                    textDecoration: a.done ? 'line-through' : 'none',
                    textDecorationColor: t.inkMute,
                  }}>{a.task}</span>
                </li>
              ))}
            </ul>

            {(session.refCallList || []).length > 0 && (
              <div style={{ marginTop: 18 }}>
                <div style={{
                  fontFamily: 'JetBrains Mono, monospace', fontSize: 10,
                  letterSpacing: '0.14em', color: t.inkMute,
                  textTransform: 'uppercase', marginBottom: 8,
                }}>Referenced calls</div>
                {session.refCallList.map((c, i) => (
                  <div key={i} style={{
                    display: 'grid', gridTemplateColumns: '8px 1fr auto', gap: 10,
                    padding: '6px 0', borderTop: i === 0 ? 'none' : `0.5px solid ${t.panelStroke}`,
                    alignItems: 'center',
                  }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: t.warm }} />
                    <span style={{ fontSize: 13, color: t.ink }}>{c.name}</span>
                    <span style={{
                      fontSize: 10.5, color: t.inkMute, fontFamily: 'JetBrains Mono, monospace',
                      letterSpacing: '0.06em',
                    }}>{c.date} · {c.drop}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* right — effectiveness + actions */}
          <div>
            {session.pre != null && (
              <div style={{
                border: `0.5px solid ${t.panelBorder}`, borderRadius: 10,
                background: theme === 'light' ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.02)',
                padding: '14px 16px', marginBottom: 14,
              }}>
                <div style={{
                  fontFamily: 'JetBrains Mono, monospace', fontSize: 10,
                  letterSpacing: '0.14em', color: t.inkMute,
                  textTransform: 'uppercase', marginBottom: 6,
                }}>Effectiveness</div>
                {clinical
                  ? <ClinicalEffectivenessBars pre={session.pre} post={session.post} t={t} w={220} />
                  : <EffectivenessArc pre={session.pre} post={session.post} t={t} w={220} h={84} />}
                <div style={{
                  fontSize: 11.5, color: t.inkSoft, lineHeight: 1.5, marginTop: 6,
                  fontStyle: clinical ? 'normal' : 'italic',
                }}>
                  {session.post != null
                    ? (clinical
                        ? `+${(session.post * 100 - session.pre * 100).toFixed(0)} points after session.`
                        : `From dim to bright. ${(session.post * 100 - session.pre * 100).toFixed(0)} points.`)
                    : (clinical
                        ? 'Post-session score pending action plan completion.'
                        : 'Awaiting post-session score after action plan completes.')}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {session.status !== 'completed' && (
                <button style={{
                  fontFamily: 'Inter', fontSize: 12.5, fontWeight: 500, padding: '8px 14px',
                  borderRadius: 6, border: 'none', cursor: 'pointer',
                  background: t.bright, color: '#fff',
                }}>{session.status === 'pending' ? 'Start session' : 'Mark complete'}</button>
              )}
              <button style={{
                fontFamily: 'Inter', fontSize: 12.5, fontWeight: 500, padding: '8px 14px',
                borderRadius: 6, border: `0.5px solid ${t.panelBorder}`, cursor: 'pointer',
                background: 'transparent', color: t.ink,
              }}>Open referenced calls</button>
              <button style={{
                fontFamily: 'Inter', fontSize: 12.5, fontWeight: 500, padding: '8px 14px',
                borderRadius: 6, border: `0.5px solid ${t.panelBorder}`, cursor: 'pointer',
                background: 'transparent', color: t.inkSoft,
              }}>Edit plan</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MiniArc({ pre, post, t }) {
  const w = 100, h = 36;
  const r = 80;
  const cx = w / 2;
  const cy = 14 + r;
  const halfSpan = 0.30;
  const startA = -Math.PI / 2 - halfSpan;
  const endA = -Math.PI / 2 + halfSpan;
  const pointAt = (frac) => {
    const a = startA + (endA - startA) * frac;
    return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
  };
  const a0 = pointAt(0), a1 = pointAt(1);
  const arcPath = `M ${a0.x.toFixed(2)} ${a0.y.toFixed(2)} A ${r} ${r} 0 0 1 ${a1.x.toFixed(2)} ${a1.y.toFixed(2)}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} style={{ display: 'block' }}>
      <path d={arcPath} fill="none" stroke={t.panelBorder} strokeWidth="0.7"
        strokeDasharray={post == null ? '2 2' : '0'} />
      <circle cx={a0.x} cy={a0.y} r="2.4" fill={brightToColor(pre, t)} />
      {post != null
        ? <circle cx={a1.x} cy={a1.y} r="2.8" fill={brightToColor(post, t)}
            style={{ filter: `drop-shadow(0 0 3px ${brightToColor(post, t)})` }} />
        : <circle cx={a1.x} cy={a1.y} r="2" fill="none"
            stroke={t.inkMute} strokeWidth="0.6" strokeDasharray="1 1" />}
    </svg>
  );
}

// ---------------- main ----------------

function OrreryCoaching({ theme = 'light', onThemeChange, onNavigate, presentation = 'observatory', onPresentationChange = null }) {
  const setTheme = (next) => { if (onThemeChange) onThemeChange(next); };
  const t = theme === 'light' ? ORRERY_LIGHT : ORRERY_DARK;
  const clinical = presentation === 'clinical';
  const [statusFilter, setStatusFilter] = useStateCo('active');
  const [agentFilter, setAgentFilter] = useStateCo('all');
  const [expandedId, setExpandedId] = useStateCo('s-204');

  const agentMap = useMemoCo(() => {
    const m = {};
    COACH_AGENTS.forEach(a => m[a.id] = a);
    return m;
  }, []);

  const filtered = useMemoCo(() => COACH_SESSIONS.filter(s => {
    if (statusFilter === 'active' && (s.status === 'completed' || s.status === 'dismissed')) return false;
    if (statusFilter === 'completed' && s.status !== 'completed') return false;
    if (agentFilter !== 'all' && s.agent !== agentFilter) return false;
    return true;
  }), [statusFilter, agentFilter]);

  const teamStats = useMemoCo(() => {
    const total = COACH_SESSIONS.filter(s => s.status !== 'dismissed').length;
    const active = COACH_SESSIONS.filter(s => s.status === 'pending' || s.status === 'in_progress').length;
    const completed = COACH_SESSIONS.filter(s => s.status === 'completed').length;
    const teamBright = COACH_AGENTS.reduce((acc, a) => acc + a.brightness, 0) / COACH_AGENTS.length;
    return { total, active, completed, teamBright };
  }, []);

  return (
    <div style={{
      minHeight: '100vh', background: t.bg, color: t.ink, position: 'relative', overflow: 'hidden',
    }}>
      {/* halo (observatory only) */}
      {!clinical && (
        <>
          <div style={{
            position: 'absolute', top: '5%', right: '20%',
            width: 620, height: 320, borderRadius: '50%',
            background: t.haloBg, filter: 'blur(160px)', pointerEvents: 'none', zIndex: 0,
          }} />
          <div style={{
            position: 'absolute', top: '40%', left: '5%',
            width: 320, height: 320, borderRadius: '50%',
            background: t.haloBg, filter: 'blur(140px)', pointerEvents: 'none', zIndex: 0, opacity: 0.5,
          }} />
        </>
      )}

      <OrreryTopBar t={t} view="COACHING" activeNav="Coaching" presentation={presentation} onNavigate={onNavigate}
        extra={<>
          {window.PresentationBadge && onPresentationChange && (
            <window.PresentationBadge t={t} mode={presentation}
              onClick={() => onPresentationChange(clinical ? 'observatory' : 'clinical')} />
          )}
          <OrreryThemeToggle theme={theme} t={t} onToggle={() => setTheme(theme === 'light' ? 'dark' : 'light')} />
        </>}
      />

      <div style={{ position: 'relative', zIndex: 1, maxWidth: 1320, margin: '0 auto', padding: '32px 32px 64px' }}>

        {/* page header */}
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr auto', gap: 32,
          alignItems: 'flex-end', paddingBottom: 22,
          borderBottom: `0.5px solid ${t.panelBorder}`,
        }}>
          <div>
            <div style={{
              fontFamily: 'JetBrains Mono, monospace', fontSize: 10.5,
              letterSpacing: '0.18em', color: t.bright, textTransform: 'uppercase',
            }}>{clinical ? '◆' : '◇'} Coaching</div>
            <h1 style={{
              fontFamily: '"Inter", system-ui, sans-serif',
              fontWeight: clinical ? 500 : 400,
              fontStyle: clinical ? 'normal' : 'italic',
              fontSize: 52, letterSpacing: '-0.02em', margin: '6px 0 4px', color: t.ink, lineHeight: 1.0,
            }}>{clinical ? 'Team this week' : 'The team this week'}</h1>
            <p style={{
              fontSize: 14, color: t.inkSoft, lineHeight: 1.55, margin: '8px 0 0',
              maxWidth: 620, fontFamily: '"Inter", system-ui, sans-serif',
              fontStyle: clinical ? 'normal' : 'italic',
            }}>
              {clinical
                ? 'Six agents, four active sessions, one trending up. Three agents share a common gap that could be coached as a team.'
                : 'Six agents, four active sessions, one rising star. Two dim spots Ory thinks are coachable as a pair.'}
            </p>
          </div>

          <div style={{ display: 'flex', gap: 18, alignItems: 'center' }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{
                fontFamily: 'JetBrains Mono, monospace', fontSize: 9.5, letterSpacing: '0.14em',
                color: t.inkMute, textTransform: 'uppercase',
              }}>{clinical ? 'Team score' : 'Team brightness'}</div>
              <div style={{
                fontFamily: '"Inter", system-ui, sans-serif',
                fontStyle: clinical ? 'normal' : 'italic',
                fontWeight: clinical ? 500 : 400,
                fontSize: 36, lineHeight: 1, color: t.ink, marginTop: 2,
              }}>{(teamStats.teamBright * 10).toFixed(1)}<span style={{ color: t.inkMute, fontSize: 18 }}>/10</span></div>
              <div style={{ fontSize: 11, color: t.green, marginTop: 4, fontFamily: 'JetBrains Mono, monospace' }}>
                ↑ 0.04 from last week
              </div>
            </div>
            <button style={{
              fontFamily: 'Inter', fontSize: 13, fontWeight: 500, padding: '10px 16px',
              borderRadius: 7, border: 'none', cursor: 'pointer',
              background: t.bright, color: '#fff',
              boxShadow: `0 4px 16px ${t.bright}40`,
            }}>＋ New session</button>
          </div>
        </div>

        {/* agent grid */}
        <div style={{ marginTop: 28 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
            <div style={{
              fontFamily: 'JetBrains Mono, monospace', fontSize: 10.5,
              letterSpacing: '0.16em', color: t.inkMute, textTransform: 'uppercase',
            }}>{clinical ? '◆ Agents' : '◇ Agents · each a small system'}</div>
            <div style={{ fontSize: 11, color: t.inkSoft, fontStyle: clinical ? 'normal' : 'italic', fontFamily: '"Inter", system-ui, sans-serif' }}>
              {clinical
                ? 'Score · Flagged calls · Weekly trend'
                : 'Brighter star = stronger week · Moons = flagged calls · Arrow = trajectory'}
            </div>
          </div>
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14,
          }}>
            {COACH_AGENTS.map(a => (
              clinical
                ? <ClinicalAgentCard key={a.id} agent={a} t={t}
                    focused={agentFilter === a.id}
                    onClick={() => setAgentFilter(agentFilter === a.id ? 'all' : a.id)} />
                : <AgentSystem key={a.id} agent={a} t={t}
                    focused={agentFilter === a.id}
                    onClick={() => setAgentFilter(agentFilter === a.id ? 'all' : a.id)} />
            ))}
          </div>
        </div>

        {/* Ory suggests */}
        <div style={{ marginTop: 36 }}>
          <div style={{
            fontFamily: 'JetBrains Mono, monospace', fontSize: 10.5,
            letterSpacing: '0.16em', color: t.inkMute, textTransform: 'uppercase', marginBottom: 14,
          }}>{clinical ? '◆ Ory · Recommendations' : '◇ Ory suggests'}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            {COACH_SUGGESTED.map((s, i) => (
              <div key={i} style={{
                background: theme === 'light' ? 'rgba(34,184,207,0.06)' : 'rgba(34,184,207,0.10)',
                border: `0.5px solid ${t.panelBorder}`, borderRadius: 12,
                padding: '16px 18px', display: 'grid', gridTemplateColumns: '20px 1fr', gap: 12,
              }}>
                <OrreryOwl t={t} size={18} />
                <div>
                  <div style={{
                    fontFamily: '"Inter", system-ui, sans-serif',
                    fontStyle: clinical ? 'normal' : 'italic',
                    fontWeight: clinical ? 500 : 400,
                    fontSize: 17, color: t.ink, lineHeight: 1.3,
                  }}>{s.title}</div>
                  <p style={{
                    fontSize: 12.5, color: t.inkSoft, lineHeight: 1.55, margin: '6px 0 12px', textWrap: 'pretty',
                  }}>{clinical ? s.body.replace('constellation', 'pattern') : s.body}</p>
                  <button onClick={() => s.link && onNavigate && onNavigate(s.link)} style={{
                    fontFamily: 'JetBrains Mono, monospace', fontSize: 10.5, letterSpacing: '0.10em',
                    fontWeight: 500, padding: '6px 12px', borderRadius: 5,
                    border: `0.5px solid ${t.bright}`, background: 'transparent',
                    color: t.bright, cursor: 'pointer', textTransform: 'uppercase',
                  }}>{s.cta} →</button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* sessions list */}
        <div style={{ marginTop: 40 }}>
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            marginBottom: 14, paddingBottom: 10, borderBottom: `0.5px solid ${t.panelBorder}`,
          }}>
            <div style={{
              fontFamily: 'JetBrains Mono, monospace', fontSize: 10.5,
              letterSpacing: '0.16em', color: t.inkMute, textTransform: 'uppercase',
            }}>{clinical ? '◆' : '◇'} Sessions {agentFilter !== 'all' && agentMap[agentFilter] ? `· ${agentMap[agentFilter].name}` : ''}</div>
            <div style={{
              display: 'flex', gap: 4, padding: 3,
              background: theme === 'light' ? 'rgba(20,30,60,0.04)' : 'rgba(244,236,219,0.04)',
              borderRadius: 6,
            }}>
              {[
                ['active', 'Active'],
                ['completed', 'Completed'],
                ['all', 'All'],
              ].map(([v, label]) => (
                <button key={v} onClick={() => setStatusFilter(v)} style={{
                  fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.10em',
                  padding: '5px 10px', borderRadius: 4, border: 'none', cursor: 'pointer',
                  background: statusFilter === v
                    ? (theme === 'light' ? '#fff' : 'rgba(244,236,219,0.10)')
                    : 'transparent',
                  color: statusFilter === v ? t.ink : t.inkMute,
                  textTransform: 'uppercase',
                }}>{label}</button>
              ))}
              {agentFilter !== 'all' && (
                <button onClick={() => setAgentFilter('all')} style={{
                  fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.10em',
                  padding: '5px 10px', borderRadius: 4, border: 'none', cursor: 'pointer',
                  background: 'transparent', color: t.inkMute, textTransform: 'uppercase',
                }}>× clear agent</button>
              )}
            </div>
          </div>

          {filtered.length === 0 ? (
            <div style={{
              padding: '40px 20px', textAlign: 'center',
              border: `0.5px dashed ${t.panelBorder}`, borderRadius: 12,
            }}>
              <div style={{
                fontFamily: '"Inter", system-ui, sans-serif',
                fontStyle: clinical ? 'normal' : 'italic',
                fontWeight: clinical ? 500 : 400,
                fontSize: 18, color: t.ink,
              }}>{clinical ? 'No sessions match this filter.' : 'The night sky is quiet here.'}</div>
              <div style={{ fontSize: 12.5, color: t.inkSoft, marginTop: 6 }}>
                {clinical ? 'Adjust the filter to see more.' : 'No sessions match this filter.'}
              </div>
            </div>
          ) : (
            <div>
              {filtered.map(s => (
                <SessionRow key={s.id}
                  session={s}
                  agent={agentMap[s.agent]}
                  t={t} theme={theme}
                  clinical={clinical}
                  expanded={expandedId === s.id}
                  onToggle={() => setExpandedId(expandedId === s.id ? null : s.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

window.OrreryCoaching = OrreryCoaching;
