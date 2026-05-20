/* global React */
/* eslint-disable */
const { GradientText, CYAN_300, CYAN_400, CYAN_500 } = window;
// =============================================================================
//  04 — TOPOLOGY · Network-graph product · light + blueprint cyan + magenta
//  Owl as quiet brand mark. Force-directed call graph.
// =============================================================================

function TopologyDashboard() {
  // Static positions for force-directed graph (manually laid out)
  const nodes = [
    { id: 'tx-plan', x: 50, y: 42, r: 18, label: 'Treatment plan', count: 42, type: 'cluster', c: CYAN_500 },
    { id: 'ins', x: 28, y: 56, r: 14, label: 'Insurance', count: 28, type: 'cluster', c: '#1a1f33' },
    { id: 'bill', x: 70, y: 60, r: 12, label: 'Billing', count: 21, type: 'cluster', c: CYAN_400 },
    { id: 'hyg', x: 80, y: 30, r: 10, label: 'Hygiene', count: 14, type: 'cluster', c: CYAN_300 },
    { id: 'emr', x: 22, y: 28, r: 8, label: 'Emergency', count: 8, type: 'cluster', c: '#5a6080' },
    // Individual calls
    { id: 'maya', x: 56, y: 32, r: 3, label: 'Maya P.', score: 9.1, c: CYAN_400 },
    { id: 'james', x: 22, y: 64, r: 3, label: 'James O.', score: 4.2, c: '#1a1f33' },
    { id: 'layla', x: 44, y: 50, r: 3, label: 'Layla B.', score: 6.4, c: CYAN_500 },
    { id: 'ethan', x: 18, y: 50, r: 3, label: 'Ethan P.', score: 2.7, c: '#1a1f33' },
    { id: 'noor', x: 60, y: 52, r: 3, label: 'Noor K.', score: 8.4, c: CYAN_400 },
    { id: 'ari', x: 75, y: 50, r: 3, label: 'Ari N.', score: 7.0, c: CYAN_500 },
    { id: 'yui', x: 84, y: 38, r: 3, label: 'Yui T.', score: 8.0, c: CYAN_300 },
    { id: 'devon', x: 78, y: 68, r: 3, label: 'Devon R.', score: 5.8, c: CYAN_400 },
  ];
  const edges = [
    ['tx-plan', 'ins'], ['tx-plan', 'bill'], ['tx-plan', 'hyg'], ['ins', 'bill'], ['ins', 'emr'],
    ['tx-plan', 'maya'], ['ins', 'james'], ['tx-plan', 'layla'], ['ins', 'ethan'], ['tx-plan', 'noor'],
    ['tx-plan', 'ari'], ['hyg', 'yui'], ['bill', 'devon'], ['ins', 'layla'], ['bill', 'ari'],
  ];
  const nodeMap = Object.fromEntries(nodes.map((n) => [n.id, n]));

  return (
    <div style={{
      width: '100%', height: '100%', position: 'relative',
      background: '#fafbff',
      fontFamily: "'Inter', sans-serif", color: '#1a1f33',
    }}>
      {/* Top bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 24px', borderBottom: '0.5px solid rgba(0,0,0,0.06)', background: '#fff' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Owl mark */}
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <defs>
              <linearGradient id="topo-owl" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor={CYAN_300} />
                <stop offset="100%" stopColor={CYAN_500} />
              </linearGradient>
            </defs>
            <circle cx="8.5" cy="10" r="3" stroke="url(#topo-owl)" strokeWidth="1.4" fill="none" />
            <circle cx="15.5" cy="10" r="3" stroke="url(#topo-owl)" strokeWidth="1.4" fill="none" />
            <circle cx="8.5" cy="10" r="1" fill="url(#topo-owl)" />
            <circle cx="15.5" cy="10" r="1" fill="url(#topo-owl)" />
            <path d="M 11 13 L 12 15 L 13 13 Z" fill="url(#topo-owl)" />
            <path d="M 5 7 Q 12 4 19 7" stroke="url(#topo-owl)" strokeWidth="1.2" fill="none" />
          </svg>
          <span style={{ fontFamily: "'Instrument Serif', serif", fontStyle: 'italic', fontSize: 19 }}>Topology</span>
          <span style={{ fontSize: 11, color: '#5a6080', marginLeft: 8, fontFamily: "'JetBrains Mono', monospace", padding: '2px 6px', background: 'rgba(34,184,207,0.10)', borderRadius: 4 }}>graph view</span>
        </div>
        <div style={{ display: 'flex', gap: 18, fontSize: 12.5, color: '#5a6080' }}>
          <span>Calls</span><span style={{ color: '#1a1f33', fontWeight: 500 }}>Patterns</span><span>Coaching</span><span>Reports</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 11.5 }}>
          <span style={{ color: '#22a06b' }}>● Live</span>
          <span style={{ color: '#5a6080' }}>R.D.</span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 0, height: 'calc(100% - 50px)' }}>
        {/* Graph canvas */}
        <div style={{ position: 'relative', overflow: 'hidden' }}>
          {/* Header */}
          <div style={{ position: 'absolute', top: 20, left: 24, zIndex: 2 }}>
            <div style={{ fontSize: 10.5, color: '#5a6080', letterSpacing: '0.12em', textTransform: 'uppercase', fontFamily: "'JetBrains Mono', monospace" }}>◇ CALL TOPOLOGY · LAST 24H</div>
            <h1 style={{ fontFamily: "'Instrument Serif', serif", fontSize: 30, fontWeight: 400, letterSpacing: '-0.02em', margin: '6px 0 0', maxWidth: 460, lineHeight: 1.1 }}>
              Treatment plan and Insurance share <GradientText>14 calls</GradientText> — that's the friction.
            </h1>
          </div>
          {/* Legend */}
          <div style={{ position: 'absolute', bottom: 20, left: 24, display: 'flex', gap: 12, fontSize: 10.5, color: '#5a6080', fontFamily: "'JetBrains Mono', monospace", zIndex: 2 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: '50%', background: '#6a8cff' }} /> cluster</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 5, height: 5, borderRadius: '50%', background: '#1a1f33' }} /> call</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 12, height: 1, background: '#b76eff' }} /> co-mention</span>
          </div>
          {/* SVG */}
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
            <defs>
              <radialGradient id="topo-glow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#fff" stopOpacity="0.5" />
                <stop offset="100%" stopColor="#fff" stopOpacity="0" />
              </radialGradient>
              <linearGradient id="topo-edge" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor={CYAN_500} stopOpacity="0.6" />
                <stop offset="100%" stopColor={CYAN_300} stopOpacity="0.6" />
              </linearGradient>
            </defs>
            {/* Blueprint grid */}
            <pattern id="topo-grid" width="5" height="5" patternUnits="userSpaceOnUse">
              <path d="M 5 0 L 0 0 0 5" fill="none" stroke="rgba(34,184,207,0.10)" strokeWidth="0.1" />
            </pattern>
            <rect width="100" height="100" fill="url(#topo-grid)" />

            {/* Edges */}
            {edges.map(([a, b], i) => {
              const A = nodeMap[a], B = nodeMap[b];
              const isClusterPair = A.type === 'cluster' && B.type === 'cluster';
              return (
                <line key={i} x1={A.x} y1={A.y} x2={B.x} y2={B.y}
                  stroke={isClusterPair ? 'url(#topo-edge)' : 'rgba(26,31,51,0.15)'}
                  strokeWidth={isClusterPair ? 0.4 : 0.15}
                />
              );
            })}

            {/* Cluster nodes (large, with glow) */}
            {nodes.filter((n) => n.type === 'cluster').map((n) => (
              <g key={n.id}>
                <circle cx={n.x} cy={n.y} r={n.r + 4} fill={n.c} opacity="0.12" />
                <circle cx={n.x} cy={n.y} r={n.r} fill="#fff" stroke={n.c} strokeWidth="0.6" />
                <text x={n.x} y={n.y - 0.5} textAnchor="middle" fontSize="2.4" fontFamily="'Instrument Serif', serif" fontStyle="italic" fill="#1a1f33">{n.count}</text>
                <text x={n.x} y={n.y + 2.6} textAnchor="middle" fontSize="1.6" fontFamily="'JetBrains Mono', monospace" fill="#5a6080" letterSpacing="0.1em">{n.label.toUpperCase()}</text>
              </g>
            ))}

            {/* Call nodes (small) */}
            {nodes.filter((n) => !n.type).map((n) => (
              <g key={n.id}>
                <circle cx={n.x} cy={n.y} r={n.r + 1.4} fill={n.c} opacity="0.2" />
                <circle cx={n.x} cy={n.y} r={n.r} fill={n.c} stroke="#fff" strokeWidth="0.3" />
              </g>
            ))}

            {/* Highlighted edge with annotation */}
            <line x1={nodeMap['tx-plan'].x} y1={nodeMap['tx-plan'].y} x2={nodeMap['ins'].x} y2={nodeMap['ins'].y}
              stroke={CYAN_500} strokeWidth="0.6" strokeDasharray="0.6 0.6" />
          </svg>

          {/* Annotation card on the highlighted edge */}
          <div style={{ position: 'absolute', left: '32%', top: '36%', background: '#fff', border: `0.5px solid ${CYAN_400}66`, borderRadius: 8, padding: '8px 12px', fontSize: 11, boxShadow: `0 8px 20px ${CYAN_400}22`, maxWidth: 180 }}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: CYAN_500, letterSpacing: '0.08em' }}>◇ EDGE · 14 CO-MENTIONS</div>
            <div style={{ fontSize: 11.5, marginTop: 3, color: '#1a1f33', lineHeight: 1.4 }}>Insurance friction kills treatment-plan momentum. Resolve it earlier.</div>
          </div>
        </div>

        {/* Side panel */}
        <div style={{ background: '#fff', borderLeft: '0.5px solid rgba(0,0,0,0.06)', padding: '20px 22px', overflow: 'auto' }}>
          <div style={{ fontSize: 10.5, color: '#5a6080', letterSpacing: '0.12em', textTransform: 'uppercase', fontFamily: "'JetBrains Mono', monospace", marginBottom: 8 }}>◇ Selected node</div>
          <div style={{ fontFamily: "'Instrument Serif', serif", fontSize: 24, fontStyle: 'italic', marginBottom: 4 }}>Treatment plan</div>
          <div style={{ fontSize: 11, color: '#5a6080', marginBottom: 16 }}>Cluster · 42 calls · 24h</div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 18 }}>
            {[
              { l: 'Avg score', v: '8.2', c: CYAN_400 },
              { l: 'Booked', v: '38', c: CYAN_500 },
              { l: 'Flagged', v: '2', c: '#1a1f33' },
              { l: 'GMV', v: '$72k', c: CYAN_300 },
            ].map((k, i) => (
              <div key={i} style={{ padding: '10px 12px', background: 'rgba(0,0,0,0.02)', borderRadius: 6, borderLeft: `2px solid ${k.c}` }}>
                <div style={{ fontSize: 9.5, color: '#5a6080', letterSpacing: '0.06em', textTransform: 'uppercase' }}>{k.l}</div>
                <div style={{ fontFamily: "'Instrument Serif', serif", fontSize: 22, fontStyle: 'italic' }}>{k.v}</div>
              </div>
            ))}
          </div>

          <div style={{ fontSize: 10.5, color: '#5a6080', letterSpacing: '0.1em', textTransform: 'uppercase', fontFamily: "'JetBrains Mono', monospace", marginBottom: 8 }}>Connected to</div>
          {[
            { l: 'Insurance', n: 14, c: '#1a1f33' },
            { l: 'Billing', n: 9, c: CYAN_400 },
            { l: 'Hygiene', n: 5, c: CYAN_300 },
          ].map((c, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: i < 2 ? '0.5px solid rgba(0,0,0,0.05)' : 'none' }}>
              <span style={{ fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: c.c }} /> {c.l}</span>
              <span style={{ fontSize: 11, color: '#5a6080', fontFamily: "'JetBrains Mono', monospace" }}>{c.n} edges</span>
            </div>
          ))}

          <div style={{ marginTop: 18, padding: 12, background: 'linear-gradient(135deg, rgba(34,184,207,0.08), rgba(8,146,168,0.06))', borderRadius: 8, fontSize: 11.5, lineHeight: 1.5 }}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: CYAN_500, letterSpacing: '0.1em' }}>◇ AI INSIGHT</div>
            <div style={{ marginTop: 4 }}>Rerouting Insurance objections to the senior team early in TX-PLAN calls saves <strong>~$14k/wk</strong>.</div>
          </div>
        </div>
      </div>
    </div>
  );
}

window.TopologyDashboard = TopologyDashboard;
