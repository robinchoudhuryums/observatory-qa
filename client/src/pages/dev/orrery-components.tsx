/**
 * Dev showcase — Orrery primitive components.
 *
 * Mounts every primitive in `client/src/components/orrery/` against the
 * current theme so visual diffs can be done against the source prototype
 * (archive/design-v1/Orrery Prototype.html). Super-admin only; routed under /dev/orrery/components.
 *
 * If a primitive renders broken here, it's broken everywhere.
 */
import {
  OrreryCard,
  OrreryCenterStar,
  OrreryKpi,
  OrreryOrbitRing,
  OrreryPlanet,
  OrreryStarfield,
  OrreryTag,
  OrreryThemeToggle,
  OrreryTopBar,
  TILT,
  useOrreryTheme,
  type PlanetData,
} from "@/components/orrery";

const DEMO_PLANETS: PlanetData[] = [
  { px: -18, py: -2 * TILT, sz: 2.6, br: 0.85, hot: true },
  { px: 8, py: 6 * TILT, sz: 2.0, br: 0.7 },
  { px: 22, py: -8 * TILT, sz: 1.8, br: 0.55 },
  { px: -8, py: 14 * TILT, sz: 1.4, br: 0.4, anomaly: true },
  { px: 18, py: 18 * TILT, sz: 1.6, br: 0.25 },
];

function toggleTheme() {
  document.documentElement.classList.toggle("dark");
}

export default function OrreryComponentsShowcase() {
  const t = useOrreryTheme();
  const themeName = t.name;

  return (
    <div style={{ minHeight: "100vh", background: t.bgFlat, color: t.ink }}>
      <OrreryTopBar
        t={t}
        view="DEV · COMPONENTS"
        activeNav="Atlas"
        extra={<OrreryThemeToggle theme={themeName} onToggle={toggleTheme} t={t} />}
      />

      <div style={{ padding: 28, display: "grid", gap: 32, maxWidth: 1200, margin: "0 auto" }}>
        <section>
          <OrreryTag t={t}>◇ KPI tiles</OrreryTag>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginTop: 12 }}>
            <OrreryKpi t={t} label="Calls today" value="142" delta="+18%" accentRamp="bright" />
            <OrreryKpi t={t} label="Quality score" value="64" sub="%" accentRamp="warm" />
            <OrreryKpi t={t} label="Avg score" value="8.2" accentRamp="cool" />
            <OrreryKpi t={t} label="Coaching" value="3" sub="open" accentRamp="amber" />
          </div>
        </section>

        <section>
          <OrreryTag t={t}>◇ Section card</OrreryTag>
          <OrreryCard t={t} style={{ marginTop: 12 }}>
            <div
              style={{
                fontFamily: "'Instrument Serif', Georgia, serif",
                fontStyle: "italic",
                fontSize: 24,
                color: t.ink,
              }}
            >
              The atlas is the daily home.
            </div>
            <div style={{ marginTop: 8, fontSize: 13, color: t.inkSoft, lineHeight: 1.5 }}>
              Cards are translucent on top of the celestial background. They hold KPIs, evidence lists, and right-rail
              overlays.
            </div>
          </OrreryCard>
        </section>

        <section>
          <OrreryTag t={t}>◇ Orrery — center star, orbit ring, planet</OrreryTag>
          <OrreryCard t={t} padded={false} style={{ marginTop: 12, padding: 24, background: t.bgFlat }}>
            <svg viewBox="-30 -20 60 40" style={{ width: "100%", height: 300 }}>
              <OrreryStarfield t={t} count={30} spread={[28, 18]} />
              <OrreryOrbitRing r={8} t={t} label="ORBIT A" />
              <OrreryOrbitRing r={16} t={t} dashed />
              <OrreryOrbitRing r={24} t={t} dashed />
              <OrreryCenterStar t={t} />
              {DEMO_PLANETS.map((p, i) => (
                <OrreryPlanet key={i} p={p} t={t} showRing={i === 0} />
              ))}
            </svg>
          </OrreryCard>
        </section>

        <section>
          <OrreryTag t={t}>◇ Mono tags + color variants</OrreryTag>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 12 }}>
            <OrreryTag t={t}>◇ default</OrreryTag>
            <OrreryTag t={t} color={t.bright}>
              ◇ bright
            </OrreryTag>
            <OrreryTag t={t} color={t.warm}>
              ◇ warm
            </OrreryTag>
            <OrreryTag t={t} color={t.amber}>
              ◇ amber
            </OrreryTag>
            <OrreryTag t={t} color={t.red}>
              ◇ red
            </OrreryTag>
            <OrreryTag t={t} color={t.green}>
              ◇ green
            </OrreryTag>
          </div>
        </section>
      </div>
    </div>
  );
}
