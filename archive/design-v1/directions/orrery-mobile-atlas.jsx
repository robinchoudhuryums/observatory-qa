/* global React */
/* eslint-disable */
const {
  useState: useStateMA, useMemo: useMemoMA, useRef: useRefMA, useEffect: useEffectMA,
  ORRERY_LIGHT, ORRERY_DARK, TILT, orreryProject, brightToColor,
  OrreryOwl, OrreryCenterStar, OrreryOrbitRing, OrreryPlanet,
  OrreryStarfield, OrreryTag,
} = window;

// =============================================================================
//  Orrery — Mobile Atlas
//  Phone reduction of the dashboard. Sets the rules for every other mobile screen.
//  - Hero: orrery as full-bleed canvas
//  - Bottom sheet snaps: peek (narrative title), half (+ KPIs/anchor), full (+ moments + list)
//  - Top: owl + condensed wordmark + lens chip + hamburger
//  - No hover; tap = select, tap empty = deselect
// =============================================================================

function OrreryMobileAtlas({
  theme: themeProp = 'light',
  onNavigate = null,
  onThemeChange = null,
  initialSnap = 'half', // 'peek' | 'half' | 'full'
}) {
  const t = themeProp === 'light' ? ORRERY_LIGHT : ORRERY_DARK;

  // ---- State ----
  const [snap, setSnap] = useStateMA(initialSnap);
  const [selected, setSelected] = useStateMA(null);
  const [scrubHour, setScrubHour] = useStateMA(14); // 6..20
  const [lens, setLens] = useStateMA('type'); // 'type' | 'lifecycle' | 'revenue' | 'recency'
  const [navOpen, setNavOpen] = useStateMA(false);
  const [lensOpen, setLensOpen] = useStateMA(false);

  // Drag state for sheet
  const sheetRef = useRefMA(null);
  const dragRef = useRefMA({ active: false, startY: 0, startSnap: 'half', dy: 0 });
  const [dragDy, setDragDy] = useStateMA(0);

  // ---- Lens-driven orbit definitions ----
  const orbitsByLens = {
    type: [
      { r: 14, label: 'INNER · ROUTINE' },
      { r: 24, label: 'MID · CLINICAL' },
      { r: 34, label: 'OUTER · PLANS' },
      { r: 44, label: 'FAR · REFERRALS' },
    ],
    lifecycle: [
      { r: 14, label: 'NEW PATIENT' },
      { r: 24, label: 'ACTIVE CARE' },
      { r: 34, label: 'RECALL · MAINT' },
      { r: 44, label: 'REFERRED OUT' },
    ],
    revenue: [
      { r: 14, label: 'HIGH IMPACT' },
      { r: 24, label: 'MID IMPACT' },
      { r: 34, label: 'LOW IMPACT' },
      { r: 44, label: 'INFO ONLY' },
    ],
    recency: [
      { r: 14, label: 'TODAY' },
      { r: 24, label: 'THIS WEEK' },
      { r: 34, label: 'THIS MONTH' },
      { r: 44, label: 'OLDER' },
    ],
  };
  const orbits = orbitsByLens[lens];

  // Each planet specifies an orbit per lens (so they re-fly when lens changes)
  const planets = useMemoMA(() => ([
    { id: 'cl',  label: 'Cleanings',         ct: 38, score: 8.2, sz: 2.6, br: 0.85, a: 0.4, o: { type: 0, lifecycle: 2, revenue: 1, recency: 0 } },
    { id: 'rs',  label: 'Reschedules',       ct: 22, score: 7.4, sz: 1.8, br: 0.72, a: 2.1, o: { type: 0, lifecycle: 1, revenue: 2, recency: 0 } },
    { id: 'np',  label: 'New patient',       ct: 14, score: 6.8, sz: 1.4, br: 0.55, a: 4.6, o: { type: 0, lifecycle: 0, revenue: 1, recency: 0 } },
    { id: 'tx',  label: 'Tx plan review',    ct: 19, score: 9.1, sz: 3.4, br: 0.92, a: 0.9, o: { type: 1, lifecycle: 1, revenue: 0, recency: 0 }, hot: true },
    { id: 'pn',  label: 'Pain · urgent',     ct: 11, score: 7.0, sz: 2.0, br: 0.68, a: 3.0, o: { type: 1, lifecycle: 1, revenue: 1, recency: 0 } },
    { id: 'po',  label: 'Post-op follow-up', ct: 9,  score: 5.4, sz: 1.6, br: 0.41, a: 5.2, o: { type: 1, lifecycle: 1, revenue: 2, recency: 1 }, coaching: true },
    { id: 'cb',  label: 'Crowns & bridges',  ct: 7,  score: 6.6, sz: 2.2, br: 0.58, a: 0.2, o: { type: 2, lifecycle: 1, revenue: 0, recency: 1 } },
    { id: 'or',  label: 'Ortho consult',     ct: 8,  score: 8.0, sz: 2.8, br: 0.78, a: 2.5, o: { type: 2, lifecycle: 0, revenue: 0, recency: 0 }, trajectoryUp: true },
    { id: 'im',  label: 'Implant inquiry',   ct: 4,  score: 4.9, sz: 1.2, br: 0.32, a: 4.1, o: { type: 2, lifecycle: 0, revenue: 0, recency: 1 }, coaching: true },
    { id: 'sp',  label: 'Specialist refer',  ct: 5,  score: 6.4, sz: 1.6, br: 0.61, a: 1.4, o: { type: 3, lifecycle: 3, revenue: 2, recency: 1 } },
    { id: 'iv',  label: 'Insurance verify',  ct: 6,  score: 5.8, sz: 1.3, br: 0.48, a: 3.8, o: { type: 3, lifecycle: 1, revenue: 3, recency: 1 }, anomaly: true },
    { id: 'rr',  label: 'Records request',   ct: 3,  score: 4.5, sz: 1.0, br: 0.22, a: 5.7, o: { type: 3, lifecycle: 3, revenue: 3, recency: 2 } },
  ]), []);

  // Project planets to iso coords
  const projected = useMemoMA(() => planets.map((p, idx) => {
    const orbitIdx = p.o[lens];
    const o = orbits[orbitIdx];
    const x = Math.cos(p.a) * o.r;
    const y = Math.sin(p.a) * o.r;
    const [px, py] = orreryProject(x, y);
    return { ...p, px, py, orbitR: o.r, orbitIdx, idx };
  }).sort((a, b) => a.py - b.py), [lens, planets, orbits]);

  const focused = selected !== null ? projected.find((p) => p.id === selected) : null;
  const hot = projected.find((p) => p.hot);
  const anchor = focused || hot;

  // Hour scrubber along inner orbit
  const scrubAngle = ((scrubHour - 6) / 14) * Math.PI * 2 - Math.PI / 2;
  const [scrubX, scrubY] = orreryProject(Math.cos(scrubAngle) * orbits[0].r, Math.sin(scrubAngle) * orbits[0].r);

  // ---- Sheet drag ----
  // Snap heights as percentage of viewport
  const snapHeights = { peek: 96, half: 320, full: 580 };
  const baseH = snapHeights[snap];

  const onSheetTouchStart = (e) => {
    const y = e.touches ? e.touches[0].clientY : e.clientY;
    dragRef.current = { active: true, startY: y, startSnap: snap, dy: 0 };
  };
  const onSheetTouchMove = (e) => {
    if (!dragRef.current.active) return;
    const y = e.touches ? e.touches[0].clientY : e.clientY;
    dragRef.current.dy = y - dragRef.current.startY;
    setDragDy(dragRef.current.dy);
  };
  const onSheetTouchEnd = () => {
    if (!dragRef.current.active) return;
    const dy = dragRef.current.dy;
    dragRef.current.active = false;
    setDragDy(0);
    // Determine new snap based on direction + magnitude
    const order = ['peek', 'half', 'full'];
    const cur = order.indexOf(snap);
    if (dy < -50 && cur < 2) setSnap(order[cur + 1]);
    else if (dy > 50 && cur > 0) setSnap(order[cur - 1]);
  };

  const lensLabel = { type: 'BY TYPE', lifecycle: 'BY LIFECYCLE', revenue: 'BY REVENUE', recency: 'BY RECENCY' }[lens];

  // ---- Render ----
  return (
    <div style={{
      width: '100%', height: '100%', position: 'relative', overflow: 'hidden',
      background: t.bg, color: t.ink,
      fontFamily: "'Inter', -apple-system, system-ui, sans-serif",
      WebkitFontSmoothing: 'antialiased',
      paddingTop: 56, // status bar room (parent device frame handles its own bar)
    }}>
      {/* ── Top bar (mobile, condensed) ── */}
      <div style={{
        position: 'absolute', top: 56, left: 0, right: 0, zIndex: 30,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 16px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <OrreryOwl size={22} t={t} />
          {window.ObservatoryWordmark
            ? <window.ObservatoryWordmark height={14} color={t.logoTint || t.ink} />
            : <span style={{ fontFamily: '"Inter", system-ui, sans-serif', fontStyle: 'italic', fontSize: 19, color: t.logoTint || t.ink, lineHeight: 1 }}>Observatory</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Lens chip */}
          <button
            onClick={() => setLensOpen((v) => !v)}
            style={{
              background: t.name === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.045)',
              border: `0.5px solid ${t.panelBorder}`,
              borderRadius: 100, padding: '6px 11px',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 9.5, color: t.inkSoft, letterSpacing: '0.12em',
              display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
            }}>
            ◇ {lensLabel}
            <span style={{ opacity: 0.5, fontSize: 8 }}>▾</span>
          </button>
          {/* Menu */}
          <button
            onClick={() => setNavOpen(true)}
            aria-label="Menu"
            style={{
              width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'transparent', border: 'none', cursor: 'pointer', color: t.ink, padding: 0,
            }}>
            <svg width="18" height="14" viewBox="0 0 18 14" fill="none">
              <line x1="0" y1="1" x2="18" y2="1" stroke="currentColor" strokeWidth="1.2" />
              <line x1="0" y1="7" x2="18" y2="7" stroke="currentColor" strokeWidth="1.2" />
              <line x1="0" y1="13" x2="18" y2="13" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          </button>
        </div>
      </div>

      {/* ── Lens dropdown ── */}
      {lensOpen && (
        <>
          <div onClick={() => setLensOpen(false)} style={{ position: 'absolute', inset: 0, zIndex: 40 }} />
          <div style={{
            position: 'absolute', top: 102, right: 56, zIndex: 41,
            background: t.panelBg, border: `0.5px solid ${t.panelBorder}`, borderRadius: 10,
            boxShadow: t.name === 'dark' ? '0 16px 40px rgba(0,0,0,0.5)' : '0 16px 40px rgba(20,32,80,0.18)',
            padding: 6, minWidth: 180,
          }}>
            {[
              ['type', 'By call type'],
              ['lifecycle', 'By lifecycle'],
              ['revenue', 'By revenue impact'],
              ['recency', 'By recency'],
            ].map(([k, label]) => (
              <button key={k}
                onClick={() => { setLens(k); setLensOpen(false); }}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '9px 12px', background: lens === k ? `${t.bright}14` : 'transparent',
                  border: 'none', borderRadius: 7, color: t.ink, fontSize: 13.5, cursor: 'pointer',
                  fontFamily: 'inherit',
                }}>
                {label}
                {lens === k && <span style={{ float: 'right', color: t.bright }}>·</span>}
              </button>
            ))}
            <div style={{ padding: '4px 12px 6px', fontSize: 10.5, color: t.inkMute, lineHeight: 1.4 }}>
              Choose how planets cluster. The orrery re-orbits to match.
            </div>
          </div>
        </>
      )}

      {/* ── Hero: orrery canvas ── */}
      <div
        onClick={() => setSelected(null)}
        style={{
          position: 'absolute', top: 56, left: 0, right: 0,
          bottom: baseH - dragDy,
          transition: dragRef.current.active ? 'none' : 'bottom 320ms cubic-bezier(0.32,0.72,0,1)',
          overflow: 'hidden',
        }}>
        <svg viewBox="-58 -34 116 68" width="100%" height="100%" style={{ display: 'block' }} preserveAspectRatio="xMidYMid meet">
          <OrreryStarfield t={t} count={42} spread={[56, 28]} />

          {orbits.map((o, i) => (
            <OrreryOrbitRing key={i} r={o.r} t={t} dashed={i === 3} />
          ))}

          <OrreryCenterStar t={t} idSeed="ma" />

          {/* Scrub marker on inner orbit */}
          <g>
            <circle cx={scrubX} cy={scrubY} r="0.65" fill={t.bright} />
            <circle cx={scrubX} cy={scrubY} r="1.35" fill="none" stroke={t.bright} strokeWidth="0.18" opacity="0.6" />
          </g>

          {/* Planets */}
          {projected.map((p) => (
            <g key={p.id} style={{ transition: 'transform 600ms cubic-bezier(0.32,0.72,0,1)' }}>
              <OrreryPlanet
                p={p}
                t={t}
                hovered={focused && focused.id === p.id}
                onHover={() => {}}
                onLeave={() => {}}
                onClick={(e) => { if (e && e.stopPropagation) e.stopPropagation(); setSelected(p.id === selected ? null : p.id); setSnap('half'); }}
                showRing={p.hot}
                dim={focused && focused.id !== p.id}
                trajectory={p.trajectoryUp ? { dir: -Math.PI / 4, up: true } : null}
              />
            </g>
          ))}

          {/* Anchor connector when focused */}
          {focused && (
            <g>
              <circle cx={focused.px} cy={focused.py} r={focused.sz + 1.4} fill="none"
                stroke={brightToColor(focused.br, t)} strokeWidth="0.18" opacity="0.5" />
            </g>
          )}
        </svg>

        {/* Hour pill — pinned bottom of canvas */}
        <div style={{
          position: 'absolute', left: '50%', bottom: 12, transform: 'translateX(-50%)',
          display: 'flex', alignItems: 'center', gap: 10,
          background: t.name === 'dark' ? 'rgba(8,16,40,0.78)' : 'rgba(255,255,255,0.85)',
          backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
          border: `0.5px solid ${t.panelBorder}`, borderRadius: 100,
          padding: '7px 14px',
          boxShadow: t.name === 'dark' ? '0 6px 18px rgba(0,0,0,0.4)' : '0 6px 18px rgba(20,32,80,0.10)',
        }} onClick={(e) => e.stopPropagation()}>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: t.inkSoft, letterSpacing: '0.12em' }}>
            {String(scrubHour).padStart(2, '0')}:00
          </span>
          <input
            type="range" min={6} max={20} value={scrubHour}
            onChange={(e) => setScrubHour(parseInt(e.target.value, 10))}
            style={{
              width: 140, accentColor: t.bright, height: 18,
            }}
          />
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: t.inkMute, letterSpacing: '0.1em' }}>HR</span>
        </div>
      </div>

      {/* ── Bottom sheet ── */}
      <div
        ref={sheetRef}
        style={{
          position: 'absolute', left: 0, right: 0, bottom: 0,
          height: baseH - dragDy,
          transition: dragRef.current.active ? 'none' : 'height 320ms cubic-bezier(0.32,0.72,0,1)',
          background: t.name === 'dark' ? 'rgba(10,18,46,0.92)' : 'rgba(255,255,255,0.96)',
          backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
          borderTop: `0.5px solid ${t.panelBorder}`,
          borderTopLeftRadius: 20, borderTopRightRadius: 20,
          boxShadow: t.name === 'dark' ? '0 -10px 40px rgba(0,0,0,0.4)' : '0 -10px 40px rgba(20,32,80,0.10)',
          display: 'flex', flexDirection: 'column',
          zIndex: 20,
          overflow: 'hidden',
        }}>
        {/* Handle / header */}
        <div
          onMouseDown={onSheetTouchStart}
          onMouseMove={onSheetTouchMove}
          onMouseUp={onSheetTouchEnd}
          onMouseLeave={onSheetTouchEnd}
          onTouchStart={onSheetTouchStart}
          onTouchMove={onSheetTouchMove}
          onTouchEnd={onSheetTouchEnd}
          onClick={() => {
            // Tap on handle cycles snaps
            const order = ['peek', 'half', 'full'];
            const cur = order.indexOf(snap);
            setSnap(order[(cur + 1) % 3]);
          }}
          style={{ padding: '8px 0 4px', cursor: 'grab', flexShrink: 0, touchAction: 'none' }}>
          <div style={{
            width: 36, height: 4, borderRadius: 2,
            background: t.name === 'dark' ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.18)',
            margin: '0 auto',
          }} />
        </div>

        {/* Sheet content */}
        <div style={{ flex: 1, overflow: snap === 'full' ? 'auto' : 'hidden', padding: '4px 18px 22px' }}>
          {/* PEEK row — always visible */}
          <SheetPeek t={t} anchor={anchor} focused={focused} />

          {/* HALF content */}
          {(snap === 'half' || snap === 'full') && (
            <SheetHalf t={t} focused={focused} hot={hot} onNavigate={onNavigate}
              total={projected.reduce((s, p) => s + p.ct, 0)} />
          )}

          {/* FULL content */}
          {snap === 'full' && (
            <SheetFull t={t} projected={projected} selected={selected}
              onSelect={(id) => setSelected(id === selected ? null : id)}
              onNavigate={onNavigate} />
          )}
        </div>
      </div>

      {/* ── Nav drawer ── */}
      {navOpen && (
        <NavDrawer t={t} onClose={() => setNavOpen(false)} onNavigate={onNavigate}
          theme={themeProp} onThemeChange={onThemeChange} />
      )}
    </div>
  );
}

// ── Sheet peek (always visible) ──────────────────────────────
function SheetPeek({ t, anchor, focused }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, paddingTop: 6, paddingBottom: 10 }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, color: t.bright, letterSpacing: '0.14em' }}>
            ◇ {focused ? 'FOCUSED' : (anchor && anchor.hot ? 'TODAY · ANCHOR' : 'TODAY')}
          </span>
        </div>
        <div style={{
          fontFamily: '"Inter", system-ui, sans-serif', fontSize: 22, lineHeight: 1.1,
          color: t.ink, marginTop: 2, fontStyle: 'italic',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {focused
            ? focused.label
            : anchor
              ? <>Anchor: <span style={{ color: t.bright, fontWeight: 600 }}>{anchor.label}</span></>
              : 'Sat 26 Apr · 134 calls'}
        </div>
      </div>
      {anchor && (
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontFamily: '"Inter", system-ui, sans-serif', fontStyle: 'italic', fontSize: 22, color: brightToColor(anchor.br, t), lineHeight: 1 }}>
            {anchor.score.toFixed(1)}
          </div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: t.inkMute, letterSpacing: '0.1em', marginTop: 2 }}>
            BRIGHT.
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sheet half (KPIs + narrative) ────────────────────────────
function SheetHalf({ t, focused, hot, onNavigate, total }) {
  if (focused) {
    // Focused-planet detail
    const tone = focused.hot ? 'BRIGHTEST · ANCHOR' : focused.coaching ? 'COACHING · DIM' : focused.anomaly ? 'OUT OF ORBIT' : 'CLUSTER';
    const note = focused.hot
      ? 'Brightest planet of the day — your anchor. Patients are saying yes.'
      : focused.coaching
        ? 'Bright in volume, dim in close. The coaching opportunity sits here.'
        : focused.anomaly
          ? 'Out of usual orbit. Volume up 2.4σ vs last 30 days. Worth a look.'
          : 'Steady cluster. Tracking close to last week.';
    return (
      <div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, padding: '4px 0 12px', borderTop: `0.5px solid ${t.panelBorder}` }}>
          <MicroStat t={t} label="VOL" value={focused.ct} sub="calls" />
          <MicroStat t={t} label="CLOSE" value={`${Math.round(focused.br * 100)}%`} sub="rate" accent={brightToColor(focused.br, t)} />
          <MicroStat t={t} label="SCORE" value={focused.score.toFixed(1)} sub="/10" />
        </div>
        <div style={{
          fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, color: t.bright, letterSpacing: '0.14em',
          paddingTop: 10, borderTop: `0.5px solid ${t.panelBorder}`,
        }}>◇ {tone}</div>
        <div style={{ fontSize: 13, lineHeight: 1.45, color: t.inkSoft, marginTop: 6 }}>{note}</div>

        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <SheetButton t={t} primary onClick={() => onNavigate && onNavigate('planet', { planetLabel: focused.label })}>Open planet</SheetButton>
          {focused.coaching && <SheetButton t={t} onClick={() => onNavigate && onNavigate('coaching')}>Coach</SheetButton>}
        </div>
      </div>
    );
  }

  // Default day-view
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, padding: '4px 0 12px', borderTop: `0.5px solid ${t.panelBorder}` }}>
        <MicroStat t={t} label="CALLS" value={total} sub="today" />
        <MicroStat t={t} label="CLOSE" value="61%" sub="↑ 4 vs wk" accent={t.bright} />
        <MicroStat t={t} label="ANCHOR" value="9.1" sub={hot ? hot.label.split(' ')[0] : '—'} />
      </div>
      <div style={{
        fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, color: t.bright, letterSpacing: '0.14em',
        paddingTop: 10, borderTop: `0.5px solid ${t.panelBorder}`,
      }}>◇ DAY IN ORBIT</div>
      <div style={{ fontSize: 13.5, lineHeight: 1.45, color: t.ink, marginTop: 6 }}>
        Tx plan review burned brightest. Two new patients said yes by lunch. Insurance verify drifted out of usual orbit.
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <SheetButton t={t} primary onClick={() => onNavigate && onNavigate('replay')}>▶ Day replay</SheetButton>
        <SheetButton t={t} onClick={() => onNavigate && onNavigate('patterns')}>Patterns</SheetButton>
      </div>
    </div>
  );
}

// ── Sheet full (moments + planet list) ───────────────────────
function SheetFull({ t, projected, selected, onSelect, onNavigate }) {
  const moments = [
    { time: '09:14', label: 'New patient said yes', tone: 'bright' },
    { time: '11:02', label: 'Tx plan accepted (×3)', tone: 'bright' },
    { time: '13:48', label: 'Insurance verify · drift', tone: 'amber' },
    { time: '15:30', label: 'Implant inquiry · cold', tone: 'cold' },
  ];
  const sortedPlanets = [...projected].sort((a, b) => b.ct - a.ct);

  return (
    <div style={{ marginTop: 18 }}>
      {/* Moments */}
      <div style={{ marginBottom: 22 }}>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, color: t.inkMute, letterSpacing: '0.14em', marginBottom: 8 }}>
          ◇ MOMENTS
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, border: `0.5px solid ${t.panelBorder}`, borderRadius: 10, overflow: 'hidden' }}>
          {moments.map((m, i) => {
            const dot = m.tone === 'bright' ? t.bright : m.tone === 'amber' ? t.amber : m.tone === 'cold' ? t.cold : t.cool;
            return (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '11px 12px',
                background: t.name === 'dark' ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.018)',
                borderBottom: i < moments.length - 1 ? `0.5px solid ${t.panelBorder}` : 'none',
              }}>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: t.inkMute, letterSpacing: '0.08em', minWidth: 38 }}>{m.time}</span>
                <span style={{ width: 6, height: 6, borderRadius: 3, background: dot, flexShrink: 0 }} />
                <span style={{ fontSize: 13, color: t.ink, flex: 1 }}>{m.label}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Planet list */}
      <div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, color: t.inkMute, letterSpacing: '0.14em', marginBottom: 8 }}>
          ◇ ALL PLANETS · {projected.length}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {sortedPlanets.map((p) => {
            const c = brightToColor(p.br, t);
            const isSel = p.id === selected;
            return (
              <button key={p.id}
                onClick={() => onSelect(p.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '11px 4px',
                  borderTop: `0.5px solid ${t.panelBorder}`,
                  background: isSel ? `${t.bright}10` : 'transparent',
                  border: 'none', borderTopWidth: '0.5px',
                  cursor: 'pointer', textAlign: 'left',
                  color: t.ink, fontFamily: 'inherit',
                  borderLeft: isSel ? `2px solid ${t.bright}` : '2px solid transparent',
                  paddingLeft: isSel ? 8 : 6, transition: 'all 150ms',
                }}>
                <span style={{ width: 10, height: 10, borderRadius: 5, background: c, flexShrink: 0,
                  boxShadow: `0 0 6px ${c}88` }} />
                <span style={{ fontSize: 13.5, flex: 1, color: t.ink }}>{p.label}</span>
                {p.hot && <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 8.5, color: t.bright, letterSpacing: '0.1em' }}>HOT</span>}
                {p.coaching && <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 8.5, color: t.red, letterSpacing: '0.1em' }}>COACH</span>}
                {p.anomaly && <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 8.5, color: t.amber, letterSpacing: '0.1em' }}>DRIFT</span>}
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: t.inkSoft, minWidth: 30, textAlign: 'right' }}>{p.ct}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ height: 16 }} />
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────
function MicroStat({ t, label, value, sub, accent }) {
  return (
    <div style={{
      padding: '10px 10px 9px',
      background: t.name === 'dark' ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.025)',
      borderRadius: 8,
      border: `0.5px solid ${t.panelBorder}`,
    }}>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 8.5, color: t.inkMute, letterSpacing: '0.12em' }}>{label}</div>
      <div style={{
        fontFamily: '"Inter", system-ui, sans-serif', fontSize: 22, fontStyle: 'italic',
        color: accent || t.ink, lineHeight: 1.05, marginTop: 2,
      }}>{value}</div>
      <div style={{ fontSize: 10, color: t.inkSoft, marginTop: 1 }}>{sub}</div>
    </div>
  );
}

function SheetButton({ t, children, onClick, primary = false }) {
  return (
    <button onClick={onClick} style={{
      flex: 1, padding: '11px 14px', borderRadius: 10, fontSize: 13, fontWeight: 500,
      cursor: 'pointer', fontFamily: 'inherit',
      border: primary ? 'none' : `0.5px solid ${t.panelBorder}`,
      background: primary ? t.bright : 'transparent',
      color: primary ? (t.name === 'dark' ? '#0a1228' : '#fff') : t.ink,
      transition: 'transform 120ms',
    }}>{children}</button>
  );
}

// ── Nav drawer ───────────────────────────────────────────────
function NavDrawer({ t, onClose, onNavigate, theme, onThemeChange }) {
  const items = [
    { label: 'Atlas', dest: 'dashboard', icon: '◉' },
    { label: 'Calls', dest: 'planet', icon: '◐' },
    { label: 'Patterns', dest: 'patterns', icon: '✦' },
    { label: 'Galaxy', dest: 'galaxy', icon: '◌' },
    { label: 'Coaching', dest: 'coaching', icon: '↗' },
    { label: 'Clinical notes', dest: 'clinical', icon: '✎' },
    { label: 'Reports', dest: null, icon: '☷' },
    { label: 'Settings', dest: null, icon: '⚙' },
  ];

  return (
    <>
      <div onClick={onClose} style={{
        position: 'absolute', inset: 0, zIndex: 50,
        background: 'rgba(0,0,0,0.4)',
        animation: 'orrFade 200ms',
      }} />
      <div style={{
        position: 'absolute', top: 0, right: 0, bottom: 0, width: '78%', maxWidth: 320, zIndex: 51,
        background: t.name === 'dark' ? 'rgba(8,16,40,0.98)' : 'rgba(255,255,255,0.99)',
        borderLeft: `0.5px solid ${t.panelBorder}`,
        boxShadow: '-20px 0 40px rgba(0,0,0,0.18)',
        display: 'flex', flexDirection: 'column',
        paddingTop: 56, // status bar
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '18px 18px 12px', borderBottom: `0.5px solid ${t.panelBorder}`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <OrreryOwl size={22} t={t} />
            {window.ObservatoryWordmark
              ? <window.ObservatoryWordmark height={14} color={t.logoTint || t.ink} />
              : <span style={{ fontFamily: '"Inter", system-ui, sans-serif', fontStyle: 'italic', fontSize: 19 }}>Observatory</span>}
          </div>
          <button onClick={onClose} aria-label="Close" style={{
            width: 32, height: 32, borderRadius: 16, border: 'none',
            background: t.name === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
            color: t.ink, cursor: 'pointer', fontSize: 14,
          }}>✕</button>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: '8px 0' }}>
          {items.map((it, i) => (
            <button key={i}
              onClick={() => { if (it.dest && onNavigate) { onNavigate(it.dest); onClose(); } }}
              disabled={!it.dest}
              style={{
                display: 'flex', alignItems: 'center', gap: 14,
                width: '100%', padding: '13px 18px',
                background: 'transparent', border: 'none', cursor: it.dest ? 'pointer' : 'default',
                color: it.dest ? t.ink : t.inkMute, fontSize: 15, fontFamily: 'inherit',
                textAlign: 'left',
              }}>
              <span style={{ width: 22, color: t.inkSoft, fontSize: 14 }}>{it.icon}</span>
              <span>{it.label}</span>
              {!it.dest && <span style={{ marginLeft: 'auto', fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: t.inkMute, letterSpacing: '0.1em' }}>SOON</span>}
            </button>
          ))}
        </div>

        <div style={{ padding: '14px 18px 24px', borderTop: `0.5px solid ${t.panelBorder}` }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: t.inkMute, letterSpacing: '0.14em', marginBottom: 8 }}>◇ THEME</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {['light', 'dark'].map((m) => (
              <button key={m}
                onClick={() => onThemeChange && onThemeChange(m)}
                style={{
                  flex: 1, padding: '10px 12px', borderRadius: 8, fontSize: 12.5,
                  fontFamily: 'inherit', cursor: 'pointer',
                  border: `0.5px solid ${theme === m ? t.bright : t.panelBorder}`,
                  background: theme === m ? `${t.bright}14` : 'transparent',
                  color: theme === m ? t.bright : t.inkSoft,
                  textTransform: 'capitalize',
                }}>{m}</button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

Object.assign(window, { OrreryMobileAtlas });
