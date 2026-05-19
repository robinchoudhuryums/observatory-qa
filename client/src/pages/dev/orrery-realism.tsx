/**
 * Dev showcase — Realism state pack.
 *
 * Renders empty/loading/processing/uncertainty/degraded variants so we can
 * verify the visual vocabulary before retrofitting it onto real screens.
 * Super-admin only; routed under /dev/orrery/realism.
 */
import {
  DegradedNotice,
  EmptyGlyph,
  EmptyState,
  LoadingPlanet,
  OrreryCard,
  OrreryTag,
  OrreryThemeToggle,
  OrreryTopBar,
  ProcessingBadge,
  TILT,
  UncertaintyHaze,
  useOrreryTheme,
} from "@/components/orrery";

function toggleTheme() {
  document.documentElement.classList.toggle("dark");
}

export default function OrreryRealismShowcase() {
  const t = useOrreryTheme();

  return (
    <div style={{ minHeight: "100vh", background: t.bgFlat, color: t.ink }}>
      <OrreryTopBar
        t={t}
        view="DEV · REALISM"
        activeNav="Atlas"
        extra={<OrreryThemeToggle theme={t.name} onToggle={toggleTheme} t={t} />}
      />

      <div style={{ padding: 28, display: "grid", gap: 32, maxWidth: 1100, margin: "0 auto" }}>
        <section>
          <OrreryTag t={t}>◇ Empty glyphs</OrreryTag>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginTop: 12 }}>
            {(["flat-orbit", "no-constellation", "thin-data", "cloud"] as const).map((kind) => (
              <OrreryCard t={t} key={kind} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                <EmptyGlyph t={t} kind={kind} />
                <OrreryTag t={t}>{kind}</OrreryTag>
              </OrreryCard>
            ))}
          </div>
        </section>

        <section>
          <OrreryTag t={t}>◇ Empty state</OrreryTag>
          <OrreryCard t={t} style={{ marginTop: 12 }}>
            <EmptyState
              t={t}
              glyph="flat-orbit"
              owlVerb="noticing nothing yet"
              title="The day hasn't started."
              body="Once calls start coming in, planets will appear on the atlas. Check back after your team's first call."
            />
          </OrreryCard>
        </section>

        <section>
          <OrreryTag t={t}>◇ Processing badges</OrreryTag>
          <OrreryCard t={t} style={{ marginTop: 12, display: "flex", gap: 14, flexWrap: "wrap" }}>
            <ProcessingBadge t={t} variant="info" />
            <ProcessingBadge t={t} variant="pending" label="PENDING" count={3} />
            <ProcessingBadge t={t} variant="success" label="DONE" count={142} />
            <ProcessingBadge t={t} variant="error" label="FAILED" count={2} />
          </OrreryCard>
        </section>

        <section>
          <OrreryTag t={t}>◇ Loading planet (in-orbit skeleton)</OrreryTag>
          <OrreryCard t={t} padded={false} style={{ marginTop: 12, padding: 24, background: t.bgFlat }}>
            <svg viewBox="-15 -10 30 20" style={{ width: 240, height: 160 }}>
              <ellipse cx="0" cy="0" rx="10" ry={10 * TILT} fill="none" stroke={t.orbit} strokeWidth="0.15" strokeDasharray="0.6 0.5" />
              <LoadingPlanet cx={-6} cy={3 * TILT} t={t} />
              <LoadingPlanet cx={8} cy={-2 * TILT} t={t} r={1.4} />
            </svg>
          </OrreryCard>
        </section>

        <section>
          <OrreryTag t={t}>◇ Uncertainty haze</OrreryTag>
          <UncertaintyHaze t={t} reason="TRANSCRIPT CONFIDENCE 0.42">
            <div style={{ fontSize: 13, lineHeight: 1.5, color: t.inkSoft }}>
              Background noise affected three minutes of the call. Manager review recommended before acting on this analysis.
            </div>
          </UncertaintyHaze>
        </section>

        <section>
          <OrreryTag t={t}>◇ Degraded notice</OrreryTag>
          <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
            <DegradedNotice t={t} severity="info" message="AI scoring is operating on a 3-minute delay." />
            <DegradedNotice t={t} severity="warn" message="Two calls failed transcription in the last hour." />
            <DegradedNotice t={t} severity="error" message="EHR sync is offline. Calls will be matched manually." />
          </div>
        </section>
      </div>
    </div>
  );
}
