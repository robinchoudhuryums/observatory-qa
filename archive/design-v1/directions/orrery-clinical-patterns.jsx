/* global React */
/* eslint-disable */
// =============================================================================
//  Clinical Patterns hero — flat node-link network
//  ---------------------------------------------------------------------------
//  Strips the constellation/sky metaphor. Same data (nodes + edges) presented
//  as a clean 2D network graph: hub node centered, related nodes positioned
//  radially around it. No starfield, no orbital rings, no isometric tilt.
//
//  Each pattern develops its own silhouette:
//    Insurance Snag    → hub-and-spoke (insurance verify at center)
//    Plan Acceptance   → tree (tx plan branching out)
//    Recall Drift      → chain (no clear center — fan layout)
// =============================================================================

const { useState: useStateCP, useMemo: useMemoCP } = React;

// Shared color ramp by close rate (matches brightToColor)
const fillByCloseCP = (br, t) => {
  if (br > 0.8) return t.bright;
  if (br > 0.65) return t.warm;
  if (br > 0.5) return t.cool;
  if (br > 0.35) return t.cold;
  return t.ice;
};

// Compute a flat layout for a pattern. Returns { positions, hub }:
//   positions: { [id]: { x, y } }  where x,y are in viewBox coords
//   hub:       id of the most-connected node (or null if tied)
// Layout strategy: most-connected node at center, others arrayed radially.
// Radius scales with node count so denser patterns spread wider.
function layoutNetwork(pattern, byId, viewW, viewH) {
  const { nodes, edges } = pattern;

  // Degree per node
  const degree = {};
  nodes.forEach((n) => { degree[n] = 0; });
  edges.forEach(([a, b]) => {
    if (degree[a] !== undefined) degree[a] += 1;
    if (degree[b] !== undefined) degree[b] += 1;
  });
  const sorted = [...nodes].sort((a, b) => degree[b] - degree[a]);
  const hub = degree[sorted[0]] > degree[sorted[1] || sorted[0]] ? sorted[0] : null;

  const cx = 0;
  const cy = 0;
  const positions = {};

  if (hub) {
    // Hub-and-spoke layout
    positions[hub] = { x: cx, y: cy };
    const others = nodes.filter((n) => n !== hub);
    const n = others.length;
    const radius = Math.min(viewW, viewH) * 0.34;
    // Use the stored angle from the source data for stable, pleasant placement
    // (avoids cluttered overlaps), but spread evenly if angles bunch.
    const angles = others.map((id) => {
      const p = byId[id];
      return p ? p.a : 0;
    });
    // Re-spread angles evenly if they bunch (>30° clusters)
    const sortedAngles = [...angles].sort((a, b) => a - b);
    let bunchy = false;
    for (let i = 0; i < sortedAngles.length; i++) {
      const next = sortedAngles[(i + 1) % sortedAngles.length];
      const gap = ((next - sortedAngles[i]) + Math.PI * 2) % (Math.PI * 2);
      if (gap < (Math.PI * 2) / sortedAngles.length * 0.4) { bunchy = true; break; }
    }
    others.forEach((id, i) => {
      const ang = bunchy
        ? -Math.PI / 2 + (i / n) * Math.PI * 2
        : angles[i];
      positions[id] = {
        x: cx + Math.cos(ang) * radius,
        y: cy + Math.sin(ang) * radius * 0.55, // gentle vertical compression
      };
    });
  } else {
    // No clear hub: arrange in an arc, ordered by degree desc
    const n = sorted.length;
    const radius = Math.min(viewW, viewH) * 0.36;
    sorted.forEach((id, i) => {
      const ang = -Math.PI / 2 + (i / Math.max(1, n - 1)) * Math.PI * 1.4 - Math.PI * 0.2;
      positions[id] = {
        x: cx + Math.cos(ang) * radius * (i === 0 ? 0 : 1),
        y: cy + Math.sin(ang) * radius * 0.55,
      };
    });
  }

  return { positions, hub };
}

// =============================================================================
//  <ClinicalPatternHero> — dispatcher
// =============================================================================
function ClinicalPatternHero({ variant = 'network', ...rest }) {
  if (variant === 'sankey')  return <ClinicalPatternSankey  {...rest} />;
  if (variant === 'heatmap') return <ClinicalPatternHeatmap {...rest} />;
  return <ClinicalPatternNetwork {...rest} />;
}

// =============================================================================
//  A. <ClinicalPatternNetwork> — flat node-link diagram (default)
// =============================================================================
function ClinicalPatternNetwork({
  t, patterns, planets, byId,
  activePattern, setActivePattern,
}) {
  const active = patterns[activePattern];

  // viewBox sized to match clinical heroes
  const W = 116, H = 64;
  const { positions, hub } = useMemoCP(
    () => layoutNetwork(active, byId, W, H),
    [active, byId]
  );

  // Node size by volume (planet.sz from source data, normalized)
  const nodeR = (id) => {
    const p = byId[id];
    if (!p) return 1.8;
    return 1.5 + (p.sz / 4) * 1.6;
  };

  const [hovered, setHovered] = useStateCP(null);

  return (
    <div style={{
      position: 'relative',
      borderRadius: 14,
      background: t.panel, backdropFilter: 'blur(8px)',
      border: `0.5px solid ${t.panelBorder}`,
      overflow: 'hidden',
      width: '100%',
      aspectRatio: '116 / 64',
      maxHeight: 460,
      alignSelf: 'flex-start',
    }}>
      <svg viewBox={`${-W/2} ${-H/2} ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
        {/* No starfield, no orbit rings, no sun. */}

        {/* Edges */}
        {active.edges.map(([a, b], i) => {
          const A = positions[a], B = positions[b];
          if (!A || !B) return null;
          // Slight curve so multi-edge fans don't overlap straight lines
          const mx = (A.x + B.x) / 2;
          const my = (A.y + B.y) / 2;
          const dx = B.x - A.x, dy = B.y - A.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const nx = -dy / dist, ny = dx / dist;
          const curve = (i % 2 === 0 ? 1 : -1) * Math.min(3, dist * 0.08);
          const cpx = mx + nx * curve;
          const cpy = my + ny * curve;

          return (
            <g key={i}>
              <path d={`M ${A.x} ${A.y} Q ${cpx} ${cpy} ${B.x} ${B.y}`}
                fill="none" stroke={active.color} strokeWidth="0.32"
                strokeDasharray="0.8 0.5" opacity="0.78" />
              {/* Tiny marker at midpoint */}
              <circle cx={cpx} cy={cpy} r="0.35" fill={active.color} opacity="0.85" />
            </g>
          );
        })}

        {/* Nodes */}
        {active.nodes.map((id) => {
          const pos = positions[id];
          if (!pos) return null;
          const p = byId[id];
          const r = nodeR(id);
          const fill = fillByCloseCP(p.br, t);
          const isHub = id === hub;
          const isHov = hovered === id;
          return (
            <g key={id}
              onMouseEnter={() => setHovered(id)}
              onMouseLeave={() => setHovered(null)}
              style={{ cursor: 'pointer' }}
            >
              {/* hub gets a subtle outer ring */}
              {isHub && (
                <circle cx={pos.x} cy={pos.y} r={r + 1.4}
                  fill="none" stroke={active.color} strokeWidth="0.22" opacity="0.5" />
              )}
              <circle cx={pos.x} cy={pos.y} r={r} fill={fill}
                opacity={t.name === 'dark' ? 0.92 : 0.86} />
              {/* close-rate ring */}
              <circle cx={pos.x} cy={pos.y} r={r}
                fill="none" stroke={active.color} strokeWidth="0.18" opacity="0.55" />
              {isHov && (
                <circle cx={pos.x} cy={pos.y} r={r + 1.0}
                  fill="none" stroke={t.bright} strokeWidth="0.2" opacity="0.85" />
              )}
              {/* label */}
              <text x={pos.x} y={pos.y + r + 2.6}
                textAnchor="middle"
                fontSize="1.7"
                fill={t.ink}
                fontFamily='"Inter", system-ui, sans-serif'
                fontWeight="500">
                {p.label}
              </text>
              <text x={pos.x} y={pos.y + r + 4.6}
                textAnchor="middle"
                fontSize="1.4"
                fill={t.inkMute}
                fontFamily="'JetBrains Mono', monospace"
                letterSpacing="0.08">
                {Math.round(p.br * 100)}% CLOSE
              </text>
            </g>
          );
        })}

        {/* Pattern name (top) — plain, no sparkles */}
        <text x="0" y={-H/2 + 4} textAnchor="middle"
          fontSize="2.2" fill={active.color}
          fontFamily='"Inter", system-ui, sans-serif'
          fontWeight="600" letterSpacing="-0.005em">
          {active.name}
        </text>
        <text x="0" y={-H/2 + 7} textAnchor="middle"
          fontSize="1.5" fill={t.inkSoft}
          fontFamily="'JetBrains Mono', monospace"
          letterSpacing="0.1">
          {active.tag}
        </text>
      </svg>

      {/* Legend (bottom-left) — clinical phrasing */}
      <div style={{
        position: 'absolute', bottom: 12, left: 14,
        fontSize: 9.5, color: t.inkSoft,
        fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.08em',
        display: 'flex', alignItems: 'center', gap: 14,
      }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <svg width="14" height="6" viewBox="0 0 14 6">
            <line x1="0" y1="3" x2="14" y2="3" stroke={active.color} strokeWidth="1" strokeDasharray="3 1.5" />
          </svg>
          CO-OCCURRENCE
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: active.color, opacity: 0.5 }} />
          NODE · CLUSTER
        </span>
      </div>

      {/* Stat callout (top-right) */}
      <div style={{
        position: 'absolute', top: 14, right: 18,
        textAlign: 'right',
      }}>
        <div style={{
          fontFamily: "'JetBrains Mono', monospace", fontSize: 9,
          color: t.inkMute, letterSpacing: '0.12em',
        }}>{active.statLabel}</div>
        <div style={{
          fontFamily: '"Inter", system-ui, sans-serif',
          fontSize: 32, fontWeight: 500, lineHeight: 1,
          color: active.color, marginTop: 4,
        }}>
          {active.stat}
        </div>
      </div>
    </div>
  );
}

// =============================================================================
//  B. <ClinicalPatternSankey> — flow diagram
//  ---------------------------------------------------------------------------
//  Arranges nodes in columns by their edge role:
//    pure source  (out-only)  → left column
//    pure sink    (in-only)   → right column
//    hub          (both)      → middle column
//  Bands curve between adjacent columns. Band width = source node volume.
//  Best for showing "where calls route through the pattern".
// =============================================================================
function ClinicalPatternSankey({
  t, patterns, planets, byId,
  activePattern, setActivePattern,
}) {
  const active = patterns[activePattern];
  const [hovered, setHovered] = useStateCP(null);

  // Classify each node by edge role
  const { columns, nodeMeta } = useMemoCP(() => {
    const outDeg = {}, inDeg = {};
    active.nodes.forEach((n) => { outDeg[n] = 0; inDeg[n] = 0; });
    active.edges.forEach(([a, b]) => {
      outDeg[a] = (outDeg[a] || 0) + 1;
      inDeg[b]  = (inDeg[b]  || 0) + 1;
    });
    const cols = { left: [], mid: [], right: [] };
    active.nodes.forEach((n) => {
      const o = outDeg[n] || 0;
      const i = inDeg[n] || 0;
      if (o > 0 && i === 0) cols.left.push(n);
      else if (o === 0 && i > 0) cols.right.push(n);
      else cols.mid.push(n);
    });
    // Sort each column by volume desc for readable layout
    Object.keys(cols).forEach((k) => {
      cols[k].sort((a, b) => (byId[b]?.ct || 0) - (byId[a]?.ct || 0));
    });
    // Compute y positions per node
    const W = 116, H = 64;
    const PAD = { t: 9, b: 5, l: 4, r: 4 };
    const innerH = H - PAD.t - PAD.b;
    const meta = {};
    // Total height each column needs (proportional to volume)
    const totalVol = (list) => list.reduce((s, id) => s + (byId[id]?.ct || 1), 0);
    const colXs = { left: PAD.l + 12, mid: W / 2, right: W - PAD.r - 12 };
    const nodeW = 3; // bar width
    Object.keys(cols).forEach((k) => {
      const list = cols[k];
      if (list.length === 0) return;
      const vols = list.map((id) => byId[id]?.ct || 1);
      const tot = vols.reduce((s, v) => s + v, 0);
      // Use ~80% of innerH to leave room between nodes
      const usable = innerH * 0.86;
      const gap = (list.length - 1) * 1.6;
      const scale = (usable - gap) / Math.max(1, tot);
      let y = PAD.t + (innerH - (tot * scale + gap)) / 2;
      list.forEach((id, idx) => {
        const h = Math.max(2.0, (byId[id]?.ct || 1) * scale);
        meta[id] = {
          x: colXs[k], y, h, w: nodeW, col: k,
          top: y, bottom: y + h, mid: y + h / 2,
        };
        y += h + 1.6;
      });
    });
    return { columns: cols, nodeMeta: meta };
  }, [active, byId]);

  const W = 116, H = 64;

  // Edges: assign vertical "slots" on source and target nodes so multiple
  // bands stack neatly rather than overlap. Track used vertical space per node.
  const edges = useMemoCP(() => {
    const used = {}; // {id: {out: cumY, in: cumY}}
    active.nodes.forEach((n) => { used[n] = { out: 0, in: 0 }; });
    return active.edges.map(([a, b]) => {
      const A = nodeMeta[a], B = nodeMeta[b];
      if (!A || !B) return null;
      // Band weight: split source by # of outgoing
      const outDeg = active.edges.filter(([s]) => s === a).length;
      const inDeg = active.edges.filter(([_, t]) => t === b).length;
      const wOut = A.h / Math.max(1, outDeg);
      const wIn  = B.h / Math.max(1, inDeg);
      const w = Math.min(wOut, wIn);
      const ySrc = A.top + used[a].out + w / 2;
      const yTgt = B.top + used[b].in + w / 2;
      used[a].out += w;
      used[b].in += w;
      return { a, b, A, B, w, ySrc, yTgt };
    }).filter(Boolean);
  }, [active, nodeMeta]);

  return (
    <div style={{
      position: 'relative',
      borderRadius: 14,
      background: t.panel, backdropFilter: 'blur(8px)',
      border: `0.5px solid ${t.panelBorder}`,
      overflow: 'hidden',
      width: '100%',
      aspectRatio: '116 / 64',
      maxHeight: 460,
      alignSelf: 'flex-start',
    }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>

        {/* Pattern name (top) */}
        <text x={W / 2} y="4.6" textAnchor="middle"
          fontSize="2.2" fill={active.color}
          fontFamily='"Inter", system-ui, sans-serif'
          fontWeight="600" letterSpacing="-0.005em">
          {active.name}
        </text>
        <text x={W / 2} y="7.4" textAnchor="middle"
          fontSize="1.5" fill={t.inkSoft}
          fontFamily="'JetBrains Mono', monospace"
          letterSpacing="0.1">
          {active.tag}
        </text>

        {/* Edges (drawn first so nodes overlay) */}
        {edges.map((e, i) => {
          const { A, B, w, ySrc, yTgt } = e;
          const x1 = A.x + A.w / 2;
          const x2 = B.x - B.w / 2;
          const midX = (x1 + x2) / 2;
          // Cubic curve for smooth flow
          const d = `M ${x1} ${ySrc - w / 2}
                     C ${midX} ${ySrc - w / 2}, ${midX} ${yTgt - w / 2}, ${x2} ${yTgt - w / 2}
                     L ${x2} ${yTgt + w / 2}
                     C ${midX} ${yTgt + w / 2}, ${midX} ${ySrc + w / 2}, ${x1} ${ySrc + w / 2}
                     Z`;
          const isHov = hovered && (hovered === e.a || hovered === e.b);
          return (
            <path key={i} d={d}
              fill={active.color}
              opacity={isHov ? (t.name === 'dark' ? 0.45 : 0.42) : (t.name === 'dark' ? 0.22 : 0.20)}
              style={{ transition: 'opacity 200ms' }} />
          );
        })}

        {/* Nodes (bars) */}
        {active.nodes.map((id) => {
          const m = nodeMeta[id];
          if (!m) return null;
          const p = byId[id];
          const fill = fillByCloseCP(p.br, t);
          const isHov = hovered === id;
          // Label position: left col → left of bar, right col → right of bar,
          // mid col → above bar
          const labelSide = m.col === 'left' ? 'right' : m.col === 'right' ? 'left' : 'above';
          return (
            <g key={id}
              onMouseEnter={() => setHovered(id)}
              onMouseLeave={() => setHovered(null)}
              style={{ cursor: 'pointer' }}
            >
              <rect x={m.x - m.w / 2} y={m.y} width={m.w} height={m.h}
                fill={fill} opacity={t.name === 'dark' ? 0.9 : 0.85}
                rx="0.4" />
              <rect x={m.x - m.w / 2} y={m.y} width={m.w} height={m.h}
                fill="none" stroke={active.color} strokeWidth="0.2" opacity="0.7" rx="0.4" />
              {isHov && (
                <rect x={m.x - m.w / 2 - 0.5} y={m.y - 0.5}
                  width={m.w + 1} height={m.h + 1}
                  fill="none" stroke={t.bright} strokeWidth="0.2" rx="0.5" />
              )}
              {/* Label */}
              {labelSide === 'right' && (
                <>
                  <text x={m.x + m.w / 2 + 1.2} y={m.mid - 0.4}
                    textAnchor="start"
                    fontSize="1.7" fill={t.ink}
                    fontFamily='"Inter", system-ui, sans-serif' fontWeight="500">
                    {p.label}
                  </text>
                  <text x={m.x + m.w / 2 + 1.2} y={m.mid + 1.6}
                    textAnchor="start"
                    fontSize="1.3" fill={t.inkMute}
                    fontFamily="'JetBrains Mono', monospace" letterSpacing="0.08">
                    {p.ct} · {Math.round(p.br * 100)}%
                  </text>
                </>
              )}
              {labelSide === 'left' && (
                <>
                  <text x={m.x - m.w / 2 - 1.2} y={m.mid - 0.4}
                    textAnchor="end"
                    fontSize="1.7" fill={t.ink}
                    fontFamily='"Inter", system-ui, sans-serif' fontWeight="500">
                    {p.label}
                  </text>
                  <text x={m.x - m.w / 2 - 1.2} y={m.mid + 1.6}
                    textAnchor="end"
                    fontSize="1.3" fill={t.inkMute}
                    fontFamily="'JetBrains Mono', monospace" letterSpacing="0.08">
                    {p.ct} · {Math.round(p.br * 100)}%
                  </text>
                </>
              )}
              {labelSide === 'above' && (
                <>
                  <text x={m.x} y={m.y - 1.4}
                    textAnchor="middle"
                    fontSize="1.7" fill={t.ink}
                    fontFamily='"Inter", system-ui, sans-serif' fontWeight="500">
                    {p.label}
                  </text>
                </>
              )}
            </g>
          );
        })}

        {/* Column headers — dropped. SOURCE → HUB → OUTCOME flow is
            already implied by the band direction; the previous bottom-
            placed headers collided with the legend overlay. */}
      </svg>

        {/* Stat callout */}
        <div style={{
          position: 'absolute', top: 14, right: 18, textAlign: 'right',
        }}>
          <div style={{
            fontFamily: "'JetBrains Mono', monospace", fontSize: 9,
            color: t.inkMute, letterSpacing: '0.12em',
          }}>{active.statLabel}</div>
          <div style={{
            fontFamily: '"Inter", system-ui, sans-serif',
            fontSize: 32, fontWeight: 500, lineHeight: 1,
            color: active.color, marginTop: 4,
          }}>{active.stat}</div>
        </div>

        {/* Legend */}
        <div style={{
          position: 'absolute', bottom: 12, left: 14,
          fontSize: 9.5, color: t.inkSoft,
          fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.08em',
        }}>
          BAND WIDTH · CALL VOLUME   ·   BAR COLOR · CLOSE RATE
        </div>
      </div>
    );
  }

// =============================================================================
//  C. <ClinicalPatternHeatmap> — co-occurrence matrix
//  ---------------------------------------------------------------------------
//  12×12 cell grid (every cluster on both axes). Cell intensity = synthesized
//  co-occurrence rate. The active pattern's edges glow in the pattern color.
//  Most "data science" feel — shows all relationships at once.
// =============================================================================
function ClinicalPatternHeatmap({
  t, patterns, planets, byId,
  activePattern, setActivePattern,
}) {
  const active = patterns[activePattern];
  const [hovered, setHovered] = useStateCP(null); // [i, j]

  // Synthesize a co-occurrence matrix. Diagonal = self (skipped). Off-diagonal
  // values are deterministic (seeded from indices + a couple of inputs) so the
  // matrix stays stable across renders. Active pattern edges get boosted.
  const matrix = useMemoCP(() => {
    const n = planets.length;
    const m = Array.from({ length: n }, () => Array(n).fill(0));
    // Build deterministic baseline correlation from index parity + volume
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const a = planets[i], b = planets[j];
        // Volume-weighted base + deterministic jitter
        const base = Math.min(a.ct, b.ct) / Math.max(a.ct, b.ct);
        const noise = (Math.sin(i * 7.13 + j * 4.91) + 1) / 2;
        m[i][j] = base * 0.35 + noise * 0.25;
      }
    }
    // Boost the active pattern's edges
    const idIdx = Object.fromEntries(planets.map((p, idx) => [p.id, idx]));
    active.edges.forEach(([a, b]) => {
      const i = idIdx[a], j = idIdx[b];
      if (i === undefined || j === undefined) return;
      m[i][j] = Math.max(m[i][j], 0.82);
      m[j][i] = Math.max(m[j][i], 0.82); // symmetric for visual clarity
    });
    return { values: m, idIdx };
  }, [active, planets]);

  // Active pattern's edges (as i,j pairs) for highlight outlines
  const activeCells = useMemoCP(() => {
    const set = new Set();
    active.edges.forEach(([a, b]) => {
      const i = matrix.idIdx[a], j = matrix.idIdx[b];
      if (i === undefined || j === undefined) return;
      set.add(`${i},${j}`);
      set.add(`${j},${i}`);
    });
    return set;
  }, [active, matrix]);

  const W = 116, H = 64;
  const PAD = { t: 10, b: 6, l: 24, r: 18 };
  const n = planets.length;
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;
  const cellW = innerW / n;
  const cellH = innerH / n;

  // Color ramp for cell value (0..1) — uses the pattern color but graded
  // through opacity. Inactive matrix uses a neutral ink ramp so the pattern
  // edges stand out.
  const cellColor = (v, isActive) => {
    if (isActive) {
      return { fill: active.color, opacity: 0.18 + v * 0.7 };
    }
    return {
      fill: t.name === 'dark' ? '#dde6ff' : '#0e1228',
      opacity: 0.03 + v * 0.20,
    };
  };

  return (
    <div style={{
      position: 'relative',
      borderRadius: 14,
      background: t.panel, backdropFilter: 'blur(8px)',
      border: `0.5px solid ${t.panelBorder}`,
      overflow: 'hidden',
      width: '100%',
      aspectRatio: '116 / 64',
      maxHeight: 460,
      alignSelf: 'flex-start',
    }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>

        {/* Pattern name (top) */}
        <text x={W / 2} y="4.6" textAnchor="middle"
          fontSize="2.2" fill={active.color}
          fontFamily='"Inter", system-ui, sans-serif'
          fontWeight="600" letterSpacing="-0.005em">
          {active.name}
        </text>
        <text x={W / 2} y="7.4" textAnchor="middle"
          fontSize="1.5" fill={t.inkSoft}
          fontFamily="'JetBrains Mono', monospace"
          letterSpacing="0.1">
          {active.tag}
        </text>

        {/* Y-axis labels (left) */}
        {planets.map((p, i) => (
          <text key={'y' + i}
            x={PAD.l - 0.8}
            y={PAD.t + (i + 0.5) * cellH + 0.5}
            textAnchor="end"
            fontSize="1.3" fill={hovered && hovered[0] === i ? t.bright : t.inkMute}
            fontFamily="'JetBrains Mono', monospace" letterSpacing="0.04"
            fontWeight={hovered && hovered[0] === i ? 600 : 400}>
            {p.label.toUpperCase()}
          </text>
        ))}

        {/* X-axis labels (top, rotated -45°) */}
        {planets.map((p, j) => {
          const x = PAD.l + (j + 0.5) * cellW;
          const y = PAD.t - 0.6;
          return (
            <text key={'x' + j}
              x={x} y={y}
              textAnchor="start"
              fontSize="1.3" fill={hovered && hovered[1] === j ? t.bright : t.inkMute}
              fontFamily="'JetBrains Mono', monospace" letterSpacing="0.04"
              fontWeight={hovered && hovered[1] === j ? 600 : 400}
              transform={`rotate(-45 ${x} ${y})`}>
              {p.label.toUpperCase()}
            </text>
          );
        })}

        {/* Cells */}
        {matrix.values.map((row, i) => row.map((v, j) => {
          if (i === j) {
            // Diagonal: thin neutral
            return (
              <rect key={`${i},${j}`}
                x={PAD.l + j * cellW} y={PAD.t + i * cellH}
                width={cellW} height={cellH}
                fill={t.panelBorder} opacity="0.4" />
            );
          }
          const isActive = activeCells.has(`${i},${j}`);
          const c = cellColor(v, isActive);
          const isHov = hovered && hovered[0] === i && hovered[1] === j;
          return (
            <g key={`${i},${j}`}
              onMouseEnter={() => setHovered([i, j])}
              onMouseLeave={() => setHovered(null)}
              style={{ cursor: 'pointer' }}
            >
              <rect
                x={PAD.l + j * cellW + 0.08}
                y={PAD.t + i * cellH + 0.08}
                width={cellW - 0.16} height={cellH - 0.16}
                fill={c.fill} opacity={c.opacity} />
              {isActive && (
                <rect
                  x={PAD.l + j * cellW + 0.08}
                  y={PAD.t + i * cellH + 0.08}
                  width={cellW - 0.16} height={cellH - 0.16}
                  fill="none" stroke={active.color} strokeWidth="0.18" opacity="0.95" />
              )}
              {isHov && (
                <rect
                  x={PAD.l + j * cellW}
                  y={PAD.t + i * cellH}
                  width={cellW} height={cellH}
                  fill="none" stroke={t.bright} strokeWidth="0.22" />
              )}
            </g>
          );
        }))}
      </svg>

      {/* Hover tooltip */}
      {hovered && hovered[0] !== hovered[1] && (() => {
        const [i, j] = hovered;
        const v = matrix.values[i][j];
        const A = planets[i], B = planets[j];
        const isActive = activeCells.has(`${i},${j}`);
        return (
          <div style={{
            position: 'absolute',
            top: 14, right: 18,
            background: t.name === 'dark' ? 'rgba(12,21,56,0.94)' : '#fff',
            border: `0.5px solid ${t.panelBorder}`,
            borderRadius: 8, padding: '10px 12px',
            fontFamily: '"Inter", system-ui, sans-serif',
            color: t.ink, fontSize: 11, lineHeight: 1.4,
            boxShadow: t.name === 'dark'
              ? '0 12px 36px rgba(0,0,0,0.5)'
              : '0 8px 22px rgba(20,30,60,0.16)',
            pointerEvents: 'none', maxWidth: 220,
          }}>
            <div style={{
              fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5,
              letterSpacing: '0.12em', color: isActive ? active.color : t.inkMute,
            }}>
              {isActive ? '◆ IN ACTIVE PATTERN' : 'PAIR'}
            </div>
            <div style={{ marginTop: 4, fontWeight: 500 }}>{A.label} × {B.label}</div>
            <div style={{ marginTop: 4, color: t.inkSoft }}>
              Co-occurrence: <strong style={{ color: t.ink }}>{Math.round(v * 100)}</strong>
            </div>
          </div>
        );
      })()}

      {/* Stat callout (only when no hover) */}
      {!hovered && (
        <div style={{
          position: 'absolute', top: 14, right: 18, textAlign: 'right',
        }}>
          <div style={{
            fontFamily: "'JetBrains Mono', monospace", fontSize: 9,
            color: t.inkMute, letterSpacing: '0.12em',
          }}>{active.statLabel}</div>
          <div style={{
            fontFamily: '"Inter", system-ui, sans-serif',
            fontSize: 32, fontWeight: 500, lineHeight: 1,
            color: active.color, marginTop: 4,
          }}>{active.stat}</div>
        </div>
      )}

      {/* Legend */}
      <div style={{
        position: 'absolute', bottom: 10, left: 14,
        fontSize: 9.5, color: t.inkSoft,
        fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.08em',
        display: 'flex', alignItems: 'center', gap: 14,
      }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 12, height: 8, background: active.color, opacity: 0.85, borderRadius: 1 }} />
          ACTIVE PATTERN
        </span>
        <span>· DARKER · MORE CO-OCCURRENCE</span>
      </div>
    </div>
  );
}

// =============================================================================
//  <PatternHeroPicker> — chrome control (clinical mode only)
// =============================================================================
function PatternHeroPicker({ t, value = 'network', onChange = null }) {
  const opts = [
    { v: 'network', l: 'Network' },
    { v: 'sankey',  l: 'Sankey' },
    { v: 'heatmap', l: 'Heatmap' },
  ];
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 1,
      padding: 2, borderRadius: 6,
      background: t.name === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(20,30,60,0.05)',
      border: `0.5px solid ${t.panelBorder}`,
    }}>
      <span style={{
        fontFamily: "'JetBrains Mono', monospace", fontSize: 9,
        letterSpacing: '0.12em', color: t.inkMute,
        padding: '0 6px 0 4px',
      }}>HERO</span>
      {opts.map((o) => {
        const active = value === o.v;
        return (
          <button
            key={o.v}
            onClick={() => onChange && onChange(o.v)}
            style={{
              padding: '3px 8px', borderRadius: 4, border: 'none',
              background: active
                ? (t.name === 'dark' ? 'rgba(255,255,255,0.08)' : '#fff')
                : 'transparent',
              boxShadow: active && t.name !== 'dark' ? '0 1px 2px rgba(20,30,60,0.08)' : 'none',
              color: active ? t.ink : t.inkSoft,
              fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5,
              letterSpacing: '0.08em', cursor: 'pointer',
              fontWeight: active ? 600 : 500,
            }}
          >{o.l}</button>
        );
      })}
    </div>
  );
}

Object.assign(window, {
  ClinicalPatternHero,
  ClinicalPatternNetwork,
  ClinicalPatternSankey,
  ClinicalPatternHeatmap,
  PatternHeroPicker,
});
