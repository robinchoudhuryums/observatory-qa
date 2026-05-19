/**
 * Dev showcase — Typography lab.
 *
 * Side-by-side comparison of the three orrery type families across the
 * weights used in the prototype. Super-admin only; routed under
 * /dev/orrery/type-lab.
 */
import { OrreryCard, OrreryTag, OrreryThemeToggle, OrreryTopBar, useOrreryTheme } from "@/components/orrery";

function toggleTheme() {
  document.documentElement.classList.toggle("dark");
}

export default function OrreryTypeLab() {
  const t = useOrreryTheme();
  return (
    <div style={{ minHeight: "100vh", background: t.bgFlat, color: t.ink }}>
      <OrreryTopBar
        t={t}
        view="DEV · TYPE"
        activeNav="Atlas"
        extra={<OrreryThemeToggle theme={t.name} onToggle={toggleTheme} t={t} />}
      />
      <div style={{ padding: 28, display: "grid", gap: 24, maxWidth: 900, margin: "0 auto" }}>
        <section>
          <OrreryTag t={t}>◇ Instrument Serif italic — display</OrreryTag>
          <OrreryCard t={t} style={{ marginTop: 12 }}>
            <div style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontStyle: "italic", fontSize: 44, lineHeight: 1.1, color: t.ink, letterSpacing: "-0.02em" }}>
              A model of the practice in orbit.
            </div>
            <div style={{ marginTop: 12, fontFamily: "'Instrument Serif', Georgia, serif", fontStyle: "italic", fontSize: 24, color: t.inkSoft }}>
              Used for hero values, KPI numbers, page titles.
            </div>
          </OrreryCard>
        </section>

        <section>
          <OrreryTag t={t}>◇ Inter — body + UI</OrreryTag>
          <OrreryCard t={t} style={{ marginTop: 12 }}>
            <div style={{ fontFamily: "'Inter', sans-serif", fontWeight: 600, fontSize: 18 }}>Inter 600 — UI labels and emphasis.</div>
            <div style={{ marginTop: 6, fontFamily: "'Inter', sans-serif", fontWeight: 500, fontSize: 14, color: t.inkSoft }}>Inter 500 — secondary copy.</div>
            <div style={{ marginTop: 6, fontFamily: "'Inter', sans-serif", fontWeight: 400, fontSize: 13, color: t.inkSoft, lineHeight: 1.5 }}>
              Inter 400 — body paragraphs and helper text. Loaded from Google Fonts via the @import at the top of index.css. Falls back to system-ui if the network is down.
            </div>
          </OrreryCard>
        </section>

        <section>
          <OrreryTag t={t}>◇ JetBrains Mono — tags + metadata</OrreryTag>
          <OrreryCard t={t} style={{ marginTop: 12 }}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10.5, letterSpacing: "0.12em", textTransform: "uppercase", color: t.bright }}>
              ◇ PATTERN · 38 OCCURRENCES
            </div>
            <div style={{ marginTop: 8, fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: t.inkSoft }}>
              09:14 · 06:22 · CLOSED · $3.4k
            </div>
            <div style={{ marginTop: 8, fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: "0.16em", color: t.inkMute }}>
              v2 · MODEL OF THE PRACTICE
            </div>
          </OrreryCard>
        </section>
      </div>
    </div>
  );
}
