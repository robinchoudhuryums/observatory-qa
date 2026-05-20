/* global React, ReactDOM, DesignCanvas, DCSection, DCArtboard,
   PrismDashboard, SpectraDashboard, AtlasOpDashboard, TopologyDashboard, IsoDashboard,
   CuttingEdgeKpiCloseup, CuttingEdgeListView, CuttingEdgeIntroCard,
   OrreryDashboard, OrreryPlanetDetail, OrreryCallDetail, OrreryGalaxy, OrreryPatterns, OrreryIntroCard */
/* eslint-disable */

function PrototypeLaunchCard() {
  // Mini orrery for the right panel
  const orbits = [10, 18, 26];
  const planets = [
    { o: 0, a: 0.3, sz: 1.6, br: 0.85, c: '#f7d77a' },
    { o: 0, a: 2.6, sz: 1.2, br: 0.5,  c: '#df8a4a' },
    { o: 1, a: 1.1, sz: 2.2, br: 0.9,  c: '#f7d77a' },
    { o: 1, a: 4.1, sz: 1.4, br: 0.4,  c: '#7faed8' },
    { o: 2, a: 0.7, sz: 1.8, br: 0.7,  c: '#f7d77a' },
    { o: 2, a: 4.0, sz: 1.1, br: 0.4,  c: '#7faed8' },
  ];
  const TILT_LOCAL = 0.42;
  const proj = planets.map((p) => {
    const r = orbits[p.o];
    return { ...p, px: Math.cos(p.a) * r, py: Math.sin(p.a) * r * TILT_LOCAL };
  });

  return (
    <div style={{
      width: '100%', height: '100%', position: 'relative', overflow: 'hidden',
      background: 'radial-gradient(ellipse at 50% 35%, #0c1538 0%, #04081a 70%)',
      color: '#f4ecdb', fontFamily: "'Inter', sans-serif",
      display: 'grid', gridTemplateColumns: '1.1fr 1fr',
    }}>
      {/* halo */}
      <div style={{ position: 'absolute', top: '32%', left: '60%', width: 540, height: 280, borderRadius: '50%', background: 'radial-gradient(ellipse, rgba(247,215,122,0.12) 0%, transparent 70%)', filter: 'blur(120px)', pointerEvents: 'none' }} />

      {/* Left: pitch */}
      <div style={{ padding: '64px 56px 56px', display: 'flex', flexDirection: 'column', justifyContent: 'center', position: 'relative', zIndex: 2 }}>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: '#f7d77a', letterSpacing: '0.18em', textTransform: 'uppercase', marginBottom: 14 }}>
          ◇ Observatory · clickable prototype
        </div>
        <div style={{ fontFamily: "'Instrument Serif', serif", fontWeight: 400, fontSize: 64, lineHeight: 1.0, letterSpacing: '-0.025em', marginBottom: 18, color: '#f4ecdb' }}>
          A model of the<br/><span style={{ fontStyle: 'italic', background: 'linear-gradient(90deg, #df8a4a, #f7d77a)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>practice in orbit.</span>
        </div>
        <div style={{ fontSize: 15, lineHeight: 1.6, color: 'rgba(244,236,219,0.7)', marginBottom: 32, maxWidth: 460 }}>
          Five working screens — sign-in, atlas, planet detail, call detail, galaxy, patterns. Click planets to drill in. Click the central star to play the day.
        </div>

        <div style={{ display: 'flex', gap: 12 }}>
          <a href="Orrery Prototype.html" target="_blank" style={{
            background: '#f4ecdb', color: '#04081a', padding: '14px 22px', textDecoration: 'none',
            fontFamily: 'inherit', fontSize: 14, fontWeight: 500, letterSpacing: '0.02em',
            borderRadius: 6, display: 'inline-flex', alignItems: 'center', gap: 8,
          }}>
            Open prototype <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}>→</span>
          </a>
          <a href="Orrery Prototype.html" style={{
            border: '0.5px solid rgba(244,236,219,0.25)', color: 'rgba(244,236,219,0.7)', padding: '14px 22px', textDecoration: 'none',
            fontFamily: 'inherit', fontSize: 14, fontWeight: 500, letterSpacing: '0.02em',
            borderRadius: 6, display: 'inline-flex', alignItems: 'center', gap: 8,
          }}>
            Open in same tab
          </a>
        </div>

        <div style={{ marginTop: 36, paddingTop: 20, borderTop: '0.5px solid rgba(244,236,219,0.12)', display: 'flex', gap: 28, fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, color: 'rgba(244,236,219,0.5)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          <div>5 screens</div>
          <div>· day replay</div>
          <div>· light + dark</div>
          <div>· tweaks panel</div>
        </div>
      </div>

      {/* Right: orrery preview */}
      <div style={{ position: 'relative', borderLeft: '0.5px solid rgba(244,236,219,0.1)' }}>
        <svg viewBox="-40 -26 80 52" preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: '100%' }}>
          {/* starfield */}
          {Array.from({ length: 60 }).map((_, i) => {
            const x = ((i * 13.7) % 80) - 40;
            const y = ((i * 7.3) % 52) - 26;
            const r = 0.08 + ((i * 5) % 3) * 0.05;
            return <circle key={i} cx={x} cy={y} r={r} fill="#f4ecdb" opacity={0.3 + (i % 4) * 0.15} />;
          })}
          <defs>
            <radialGradient id="launch-star" cx="0.5" cy="0.5" r="0.5">
              <stop offset="0%" stopColor="#fff" stopOpacity="1" />
              <stop offset="35%" stopColor="#f7d77a" stopOpacity="0.85" />
              <stop offset="100%" stopColor="#df8a4a" stopOpacity="0" />
            </radialGradient>
          </defs>
          {orbits.map((r, i) => (
            <ellipse key={i} cx="0" cy="0" rx={r} ry={r * TILT_LOCAL}
              fill="none" stroke="rgba(244,236,219,0.18)" strokeWidth="0.12" strokeDasharray="0.4 0.4" />
          ))}
          {/* central star */}
          <circle cx="0" cy="0" r="7" fill="url(#launch-star)" />
          <circle cx="0" cy="0" r="1.5" fill="#fff" />
          {/* planets */}
          {proj.map((p, i) => (
            <g key={i}>
              <ellipse cx={p.px} cy={p.py + p.sz * 0.5} rx={p.sz * 0.8} ry={p.sz * 0.22}
                fill="#000" opacity="0.4" />
              <circle cx={p.px} cy={p.py} r={p.sz} fill={p.c} opacity="0.95" />
              <ellipse cx={p.px - p.sz * 0.3} cy={p.py - p.sz * 0.3}
                rx={p.sz * 0.4} ry={p.sz * 0.3} fill="#fff" opacity="0.4" />
            </g>
          ))}
        </svg>
        <div style={{ position: 'absolute', top: 24, left: 24, fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: '#f7d77a', letterSpacing: '0.14em', textTransform: 'uppercase' }}>
          ◇ Atlas · live · 47 calls today
        </div>
        <div style={{ position: 'absolute', top: 24, right: 24, fontFamily: "'Instrument Serif', serif", fontStyle: 'italic', fontSize: 16, color: '#f7d77a' }}>
          mid · clinical · ops
        </div>
        <div style={{ position: 'absolute', bottom: 16, right: 24, fontFamily: "'Instrument Serif', serif", fontStyle: 'italic', fontSize: 13, color: 'rgba(244,236,219,0.5)' }}>
          brightness 0.71 · close 24%
        </div>
      </div>
    </div>
  );
}

const intro = (
  <div style={{ maxWidth: 920 }}>
    <div
      style={{
        fontFamily: "'Instrument Serif', serif",
        fontSize: 64,
        lineHeight: 1.0,
        letterSpacing: '-0.02em',
        color: '#0b0c0e',
        marginBottom: 18,
      }}
    >
      Observatory <span style={{ fontStyle: 'italic', color: '#0d6e6e' }}>— three lenses</span>
    </div>
    <div
      style={{
        fontFamily: "'Geist', system-ui, sans-serif",
        fontSize: 16,
        lineHeight: 1.55,
        color: '#3b3f44',
        maxWidth: 720,
      }}
    >
      Today's UI leans on a violet+cyan aurora gradient that doesn't match the teal owl, with shadcn cards and tinted glows that read as generic AI-SaaS. Below are three directions — same product, three different souls. Each shows the app shell, the call-analytics dashboard, and the clinical scribe workspace. Pick one (or mix); we'll build it into a clickable prototype.
    </div>

    <a
      href="Orrery Prototype.html"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 18,
        padding: '20px 24px',
        marginTop: 28,
        background: 'radial-gradient(ellipse at 30% 50%, #0c1538, #04081a)',
        color: '#f4ecdb',
        textDecoration: 'none',
        border: '0.5px solid rgba(244,236,219,0.18)',
        borderRadius: 10,
        maxWidth: 720,
      }}
    >
      <div
        style={{
          width: 52,
          height: 52,
          borderRadius: '50%',
          background: 'radial-gradient(circle at 35% 35%, #fff, #f7d77a 35%, #df8a4a 70%, transparent)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: "'Instrument Serif', serif",
          fontStyle: 'italic',
          fontSize: 26,
          color: '#04081a',
          flexShrink: 0,
        }}
      >
        ◇
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: '#f7d77a', letterSpacing: '0.14em', textTransform: 'uppercase' }}>
          ◇ Now live · clickable prototype
        </div>
        <div style={{ fontFamily: "'Instrument Serif', serif", fontStyle: 'italic', fontSize: 28, color: '#f4ecdb', marginTop: 4, fontWeight: 400 }}>
          Observatory — sign-in, atlas, planet, call, galaxy, patterns
        </div>
        <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 13, color: 'rgba(244,236,219,0.65)', marginTop: 4 }}>
          5 screens connected · click planets to drill in · click the central star for day replay · light + dark themes
        </div>
      </div>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: '#f7d77a', letterSpacing: '0.1em', flexShrink: 0 }}>
        OPEN →
      </div>
    </a>
    <div
      style={{
        marginTop: 24,
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 16,
        fontFamily: "'Geist Mono', monospace",
        fontSize: 11,
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
      }}
    >
      <div style={{ padding: '12px 14px', border: '1px solid #d9dadc', borderRadius: 8, background: '#fafafa' }}>
        <div style={{ color: '#0d6e6e', fontWeight: 600 }}>01 · Safe</div>
        <div style={{ color: '#0b0c0e', fontFamily: "'Instrument Serif', serif", fontSize: 22, marginTop: 4, textTransform: 'none', letterSpacing: 0 }}>Aperture</div>
        <div style={{ color: '#6b6f76', marginTop: 6, textTransform: 'none', letterSpacing: 0, fontFamily: 'Geist', fontSize: 12 }}>
          Refined modern SaaS. Single deep teal, precise neutrals, serif numerals. Linear-grade restraint.
        </div>
      </div>
      <div style={{ padding: '12px 14px', border: '1px solid #d9dadc', borderRadius: 8, background: '#fafafa' }}>
        <div style={{ color: '#7a4cff', fontWeight: 600 }}>02 · Stretch</div>
        <div style={{ color: '#0b0c0e', fontFamily: "'Instrument Serif', serif", fontSize: 22, marginTop: 4, textTransform: 'none', letterSpacing: 0 }}>Constellation</div>
        <div style={{ color: '#6b6f76', marginTop: 6, textTransform: 'none', letterSpacing: 0, fontFamily: 'Geist', fontSize: 12 }}>
          Dark editorial workspace. Calls plotted as star-charts. Serif display + mono. Terminal energy.
        </div>
      </div>
      <div style={{ padding: '12px 14px', border: '1px solid #d9dadc', borderRadius: 8, background: '#fafafa' }}>
        <div style={{ color: '#c2410c', fontWeight: 600 }}>03 · Wild</div>
        <div style={{ color: '#0b0c0e', fontFamily: "'Instrument Serif', serif", fontSize: 22, marginTop: 4, textTransform: 'none', letterSpacing: 0 }}>Lighthouse</div>
        <div style={{ color: '#6b6f76', marginTop: 6, textTransform: 'none', letterSpacing: 0, fontFamily: 'Geist', fontSize: 12 }}>
          Challenger-brand magazine layout. Oversized display type, warm off-black + amber/teal duotone.
        </div>
      </div>
    </div>
  </div>
);

function App() {
  return (
    <DesignCanvas
      title="Observatory · Design Directions"
      subtitle="Three takes on the brand · explore each, focus to inspect"
      intro={intro}
      backgroundColor="#f3f3f1"
    >
      <DCSection
        id="orrery-world"
        title="✦✦✦ Observatory World · the practice as a solar system"
        description="A full system built around the Orrery metaphor. Five screens — dashboard, planet detail, call detail, galaxy view (zoomed-out month), patterns view (constellations between planets). Each screen has a light/dark toggle in the top-right. Dashboard is interactive: hover planets for preview, click to focus, scrub time along the inner orbit. Two data-axis mappings shown side-by-side."
      >
        <DCArtboard id="orr-intro" label="Direction overview" width={1280} height={520}>
          <OrreryIntroCard />
        </DCArtboard>
        <DCArtboard id="orr-dash-light" label="I · Dashboard — by call type · light · interactive" width={1280} height={820}>
          <OrreryDashboard theme="light" mapping="type" />
        </DCArtboard>
        <DCArtboard id="orr-dash-dark" label="I · Dashboard — by call type · dark · interactive" width={1280} height={820}>
          <OrreryDashboard theme="dark" mapping="type" />
        </DCArtboard>
        <DCArtboard id="orr-dash-lifecycle" label="I·alt · Dashboard — by lifecycle stage · dark" width={1280} height={820}>
          <OrreryDashboard theme="dark" mapping="lifecycle" />
        </DCArtboard>
        <DCArtboard id="orr-planet-light" label="II · Planet detail — Tx plan review · light" width={1280} height={820}>
          <OrreryPlanetDetail theme="light" />
        </DCArtboard>
        <DCArtboard id="orr-planet-dark" label="II · Planet detail — Tx plan review · dark" width={1280} height={820}>
          <OrreryPlanetDetail theme="dark" />
        </DCArtboard>
        <DCArtboard id="orr-call-light" label="III · Call detail — Maria Hernandez · light" width={1280} height={820}>
          <OrreryCallDetail theme="light" />
        </DCArtboard>
        <DCArtboard id="orr-call-dark" label="III · Call detail — Maria Hernandez · dark" width={1280} height={820}>
          <OrreryCallDetail theme="dark" />
        </DCArtboard>
        <DCArtboard id="orr-galaxy-dark" label="IV · Galaxy view — April · dark" width={1280} height={820}>
          <OrreryGalaxy theme="dark" />
        </DCArtboard>
        <DCArtboard id="orr-galaxy-light" label="IV · Galaxy view — April · light" width={1280} height={820}>
          <OrreryGalaxy theme="light" />
        </DCArtboard>
        <DCArtboard id="orr-patterns-dark" label="V · Patterns — three constellations · dark" width={1280} height={820}>
          <OrreryPatterns theme="dark" />
        </DCArtboard>
        <DCArtboard id="orr-patterns-light" label="V · Patterns — three constellations · light" width={1280} height={820}>
          <OrreryPatterns theme="light" />
        </DCArtboard>
      </DCSection>

      <DCSection
        id="cutting-edge"
        title="✦✦ Cutting-edge clinical SaaS · 5 dashboards"
        description="Arc/Raycast confidence with iridescent accents, paired with Stripe/Mercury data precision. Sans + serif accent type. Mixed densities. Hero charts, heatmaps, isometric scenes, network graphs. Some keep Ory, some don't. Plus two supporting screens (KPI close-up + list view) so you can see how the system holds up beyond the front page."
      >
        <DCArtboard id="ce-intro" label="Direction overview" width={1280} height={620}>
          <CuttingEdgeIntroCard />
        </DCArtboard>
        <DCArtboard id="ce-prism" label="01 · Prism — glass + iridescent · hero chart" width={1280} height={920}>
          <PrismDashboard />
        </DCArtboard>
        <DCArtboard id="ce-spectra" label="02 · Spectra — Stripe-precise · spacious" width={1280} height={920}>
          <SpectraDashboard />
        </DCArtboard>
        <DCArtboard id="ce-atlas" label="03 · Atlas Op — Bloomberg-dense · heatmap" width={1280} height={820}>
          <AtlasOpDashboard />
        </DCArtboard>
        <DCArtboard id="ce-topology" label="04 · Topology — network graph · light" width={1280} height={820}>
          <TopologyDashboard />
        </DCArtboard>
        <DCArtboard id="ce-iso" label="05 · Observatory — isometric model of the practice" width={1280} height={820}>
          <IsoDashboard />
        </DCArtboard>
        <DCArtboard id="ce-kpi" label="Supporting · KPI close-up (Spectra family)" width={1280} height={780}>
          <CuttingEdgeKpiCloseup />
        </DCArtboard>
        <DCArtboard id="ce-list" label="Supporting · list view (Spectra family)" width={1280} height={780}>
          <CuttingEdgeListView />
        </DCArtboard>
      </DCSection>

      <DCSection
        id="prototype"
        title="◇ Clickable prototype · Observatory"
        description="Five connected screens (sign-in → atlas → planet → call → galaxy → patterns) plus a day-replay overlay. Click planets and moons to drill in; click the central star to play the day. Light + dark themes via the Tweaks panel."
      >
        <DCArtboard id="proto-launch" label="Launch · Observatory Prototype.html" width={1180} height={580}>
          <PrototypeLaunchCard />
        </DCArtboard>
      </DCSection>

      <DCSection
        id="aperture"
        title="01 — Aperture · Safe"
        description="Refined modern SaaS. Ory as a quiet wordmark; single deep-teal accent on warm neutrals; tabular numerals; quiet UI."
      >
        <DCArtboard id="ap-shell" label="App shell · sidebar + content" width={1280} height={820}>
          <ApertureShell />
        </DCArtboard>
        <DCArtboard id="ap-dash" label="Dashboard" width={1280} height={1100}>
          <ApertureDashboard />
        </DCArtboard>
        <DCArtboard id="ap-clinical" label="Clinical scribe" width={1280} height={1280}>
          <ApertureClinical />
        </DCArtboard>
      </DCSection>

      <DCSection
        id="constellation"
        title="02 — Constellation · Stretch"
        description="Dark workspace, editorial typography, star-chart data viz. Calls become constellations; Ory watches the sky."
      >
        <DCArtboard id="co-shell" label="App shell · command bar + top nav" width={1280} height={820}>
          <ConstellationShell />
        </DCArtboard>
        <DCArtboard id="co-dash" label="Dashboard" width={1280} height={1180}>
          <ConstellationDashboard />
        </DCArtboard>
        <DCArtboard id="co-clinical" label="Clinical scribe · live transcript" width={1280} height={1280}>
          <ConstellationClinical />
        </DCArtboard>
      </DCSection>

      <DCSection
        id="lighthouse"
        title="03 — Lighthouse · Wild"
        description="Challenger brand energy. Magazine layout, oversized display, warm off-black + amber/teal duotone. Confident, opinionated."
      >
        <DCArtboard id="li-shell" label="App shell · dense workspace" width={1280} height={820}>
          <LighthouseShell />
        </DCArtboard>
        <DCArtboard id="li-dash" label="Dashboard" width={1280} height={1180}>
          <LighthouseDashboard />
        </DCArtboard>
        <DCArtboard id="li-clinical" label="Clinical scribe" width={1280} height={1280}>
          <LighthouseClinical />
        </DCArtboard>
      </DCSection>

      <DCSection
        id="cl-operations"
        title="02·A — Constellation · Light · Operations"
        description="Rust accent (#a8501f). Inter Tight + Inter + Plex Mono. Dense ops-forward table, small inline star-chart. The 'power-user every day' read."
      >
        <DCArtboard id="op-shell" label="App shell · KPI strip + chart" width={1280} height={820}>
          <OpShell />
        </DCArtboard>
        <DCArtboard id="op-dash" label="Dashboard · dense table" width={1280} height={1100}>
          <OpDashboard />
        </DCArtboard>
        <DCArtboard id="op-clinical" label="Clinical scribe" width={1280} height={1180}>
          <OpClinical />
        </DCArtboard>
      </DCSection>

      <DCSection
        id="cl-cartography"
        title="02·B — Constellation · Light · Cartography"
        description="Teal accent (#0d6e6e). Newsreader serif + Inter Tight + JetBrains Mono. Motif pushed: star-eye owl, coordinate-frame marginalia, RA/DEC ticks. Table foregrounded; chart as sidekick."
      >
        <DCArtboard id="cg-shell" label="App shell · star-chart hero" width={1280} height={820}>
          <CgShell />
        </DCArtboard>
        <DCArtboard id="cg-dash" label="Dashboard · table forward" width={1280} height={1180}>
          <CgDashboard />
        </DCArtboard>
        <DCArtboard id="cg-clinical" label="Clinical scribe" width={1280} height={1280}>
          <CgClinical />
        </DCArtboard>
      </DCSection>

      <DCSection
        id="cl-almanac"
        title="02·C — Constellation · Light · Almanac (wildcard)"
        description="Forest accent (#1f6b3a). Fraunces 300 italic + Inter Tight + Plex Mono. Almanac/field-guide energy: starfield bands, drop caps, italic display. The dashboard reads like a daily field report."
      >
        <DCArtboard id="al-shell" label="App shell · cover" width={1280} height={820}>
          <AlShell />
        </DCArtboard>
        <DCArtboard id="al-dash" label="Dashboard · daily report" width={1280} height={1180}>
          <AlDashboard />
        </DCArtboard>
        <DCArtboard id="al-clinical" label="Clinical scribe" width={1280} height={1280}>
          <AlClinical />
        </DCArtboard>
      </DCSection>

      <DCSection
        id="chart-variants"
        title="02·C·★ — Constellation chart · 5 variants"
        description="Five interpretations of the constellation chart for the Almanac direction. Each shown at hero (~800×360) and small (~340×200) so you can see how it holds up as both centerpiece and sidekick. In the real app: stars are interactive — hover for preview card, click for full call, drag-select for bulk action. Constellation lines = AI-detected clusters. Static here; wired up in the prototype."
      >
        <DCArtboard id="chart-variants-board" label="All 5 · scroll to compare" width={1280} height={3680}>
          <ChartVariantsSection />
        </DCArtboard>
      </DCSection>

      <DCSection
        id="chart-finalists"
        title="02·C·★★ — Chart finalists · Field / Sky Dome / Cosmic Web"
        description="Three finalists, each in two treatments: A · plain (quiet, gets out of the way of the data) and B · thematic (full motif — texture, color, atmosphere). Hero + 3 smalls so you can see how it scales. Pick a row + a treatment."
      >
        <DCArtboard id="finalist-field" label="Field · plain + thematic" width={1180} height={1320}>
          <FieldBoard />
        </DCArtboard>
        <DCArtboard id="finalist-skydome" label="Sky Dome · plain + thematic" width={1180} height={1320}>
          <SkyDomeBoard />
        </DCArtboard>
        <DCArtboard id="finalist-cosmicweb" label="Cosmic Web · plain + thematic" width={1180} height={1320}>
          <CosmicWebBoard />
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
