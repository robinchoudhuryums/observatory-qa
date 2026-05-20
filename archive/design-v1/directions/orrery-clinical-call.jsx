/* global React */
/* eslint-disable */
// =============================================================================
//  Clinical Call timeline
//  ---------------------------------------------------------------------------
//  Replaces the orbital-arc visualization on the Call detail page. Same data
//  shape (sequence of timed moments with a quality value), presented as a
//  horizontal time axis × vertical quality chart with annotated points.
// =============================================================================

const { useState: useStateCC } = React;

function ClinicalCallTimeline({
  t, projMoments, moment, setMoment, openCoach, callLength = '6:22',
}) {
  const W = 116, H = 32;
  const PAD = { t: 4, b: 6, l: 5, r: 5 };
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;

  // Map each moment to an X by its `ang` field (which is already a normalized
  // position from the orbital layout: -π/2 = start, +π/2 = end). We rebuild
  // a 0..1 time fraction from the ang range used in source data.
  const angs = projMoments.map((m) => m.ang);
  const minA = Math.min(...angs), maxA = Math.max(...angs);
  const points = projMoments.map((m) => {
    const tx = (m.ang - minA) / Math.max(0.0001, maxA - minA);
    const ty = 1 - m.br; // high quality near top
    return {
      ...m,
      x: PAD.l + tx * innerW,
      y: PAD.t + ty * innerH,
    };
  });

  // Smooth curve through points (Catmull-Rom-ish via quadratic midpoints)
  const pathD = (() => {
    if (points.length === 0) return '';
    let d = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      const p0 = points[i - 1], p1 = points[i];
      const mx = (p0.x + p1.x) / 2;
      d += ` Q ${p0.x + (mx - p0.x) * 0.5} ${p0.y}, ${mx} ${(p0.y + p1.y) / 2}`;
      d += ` Q ${mx + (p1.x - mx) * 0.5} ${p1.y}, ${p1.x} ${p1.y}`;
    }
    return d;
  })();

  return (
    <div style={{
      position: 'relative', borderRadius: 14,
      background: t.panel, backdropFilter: 'blur(8px)',
      border: `0.5px solid ${t.panelBorder}`,
      height: 240, overflow: 'hidden',
    }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>

        {/* Y gridlines + labels */}
        {[0, 0.25, 0.5, 0.75, 1.0].map((q, i) => {
          const y = PAD.t + (1 - q) * innerH;
          return (
            <g key={i}>
              <line x1={PAD.l} y1={y} x2={W - PAD.r} y2={y}
                stroke={t.orbit} strokeWidth="0.05"
                strokeDasharray={q === 0.5 ? '0' : '0.3 0.4'}
                opacity={q === 0.5 ? 0.5 : 1} />
              <text x={PAD.l - 0.6} y={y + 0.4}
                textAnchor="end" fontSize="1.1" fill={t.inkMute}
                fontFamily="'JetBrains Mono', monospace" letterSpacing="0.05">
                {Math.round(q * 100)}
              </text>
            </g>
          );
        })}

        {/* X axis baseline + start/end labels */}
        <line x1={PAD.l} y1={PAD.t + innerH} x2={W - PAD.r} y2={PAD.t + innerH}
          stroke={t.panelBorder} strokeWidth="0.1" />
        <text x={PAD.l + 0.4} y={H - 1.8}
          textAnchor="start" fontSize="1.15" fill={t.inkMute}
          fontFamily="'JetBrains Mono', monospace" letterSpacing="0.06">0:00</text>
        <text x={W - PAD.r - 0.4} y={H - 1.8}
          textAnchor="end" fontSize="1.15" fill={t.inkMute}
          fontFamily="'JetBrains Mono', monospace" letterSpacing="0.06">{callLength}</text>
        <text x={PAD.l + 0.4} y={PAD.t - 0.8}
          textAnchor="start" fontSize="1.1" fill={t.inkSoft}
          fontFamily="'JetBrains Mono', monospace" letterSpacing="0.08">
          SENTIMENT / QUALITY
        </text>

        {/* Curve through moments */}
        <path d={pathD} fill="none" stroke={t.bright} strokeWidth="0.22" opacity="0.55" />

        {/* Each moment as a point */}
        {points.map((m) => {
          const isSel = m.idx === moment;
          return (
            <g key={m.idx} onClick={() => setMoment(m.idx)} style={{ cursor: 'pointer' }}>
              {isSel && <circle cx={m.x} cy={m.y} r="1.4" fill={m.color} opacity="0.20" />}
              <circle cx={m.x} cy={m.y} r={isSel ? 0.7 : 0.5} fill={m.color} />
              {isSel && <circle cx={m.x} cy={m.y} r="1.0" fill="none" stroke={m.color} strokeWidth="0.12" />}
              {/* Always-on tiny label above (rotated for compact stacking) */}
              <text x={m.x} y={m.y - 1.2}
                textAnchor="middle" fontSize="1.05"
                fill={isSel ? m.color : t.inkSoft}
                fontFamily='"Inter", system-ui, sans-serif'
                fontWeight={isSel ? 600 : 400}>
                {m.label}
              </text>
              <text x={m.x} y={m.y + 1.8}
                textAnchor="middle" fontSize="0.95"
                fill={t.inkMute}
                fontFamily="'JetBrains Mono', monospace" letterSpacing="0.04">
                {m.time}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Selected moment card */}
      {points[moment] && (
        <div style={{
          position: 'absolute', bottom: 12, left: 14, right: 14,
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '8px 12px', borderRadius: 8,
          background: t.name === 'dark' ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.9)',
          border: `0.5px solid ${t.panelBorder}`,
        }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: points[moment].color }} />
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: t.inkSoft }}>{points[moment].time}</span>
          <span style={{ fontFamily: '"Inter", system-ui, sans-serif', fontSize: 16, fontWeight: 500, color: t.ink }}>{points[moment].label}</span>
          <span style={{ fontSize: 11, color: t.inkSoft, flex: 1, lineHeight: 1.4 }}>
            {points[moment].label === 'Greeting' && 'Sarah opened warm. Asked Maria about her last visit.'}
            {points[moment].label === 'Concern' && 'Maria shared sensitivity in her upper right molar.'}
            {points[moment].label === 'Walkthrough' && 'Sarah explained the crown options on the screen.'}
            {points[moment].label === 'Cost' && 'Cost was raised by the patient. Brief sentiment drop.'}
            {points[moment].label === 'Insurance' && 'Sarah verified coverage live. Sentiment recovered.'}
            {points[moment].label === 'Decision' && 'Maria committed to the full plan.'}
            {points[moment].label === 'Schedule' && 'Booked for Thursday. Close was clean.'}
          </span>
          <button onClick={() => openCoach(points[moment])} style={{
            padding: '4px 10px', borderRadius: 5, fontSize: 11, fontWeight: 600,
            background: `${t.bright}20`, color: t.bright,
            border: `0.5px solid ${t.bright}55`, cursor: 'pointer', fontFamily: 'inherit',
            whiteSpace: 'nowrap',
          }}>Coach this moment →</button>
          <button onClick={() => setMoment((moment + points.length - 1) % points.length)}
            style={{ background: 'transparent', border: `0.5px solid ${t.panelBorder}`, color: t.inkSoft, cursor: 'pointer', padding: '4px 8px', borderRadius: 5, fontSize: 11 }}>‹</button>
          <button onClick={() => setMoment((moment + 1) % points.length)}
            style={{ background: 'transparent', border: `0.5px solid ${t.panelBorder}`, color: t.inkSoft, cursor: 'pointer', padding: '4px 8px', borderRadius: 5, fontSize: 11 }}>›</button>
        </div>
      )}
    </div>
  );
}

Object.assign(window, { ClinicalCallTimeline });
