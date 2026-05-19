/**
 * Dev showcase — Owl persona kit.
 *
 * Renders every owl variant (mark, wordmark, lockup, filled, head, layered)
 * across all five animation states. Super-admin only; routed under
 * /dev/orrery/owl. Used to QA owl rendering across browsers and themes.
 */
import {
  ObservatoryFilledOwl,
  ObservatoryFilledOwlHead,
  ObservatoryLayeredOwl,
  ObservatoryLockup,
  ObservatoryOwlMark,
  ObservatoryWordmark,
  OrreryCard,
  OrreryTag,
  OrreryThemeToggle,
  OrreryTopBar,
  useOrreryTheme,
  type OwlState,
} from "@/components/orrery";

const STATES: OwlState[] = ["idle", "thinking", "attention", "concerned", "talking"];

function toggleTheme() {
  document.documentElement.classList.toggle("dark");
}

export default function OrreryOwlShowcase() {
  const t = useOrreryTheme();

  return (
    <div style={{ minHeight: "100vh", background: t.bgFlat, color: t.ink }}>
      <OrreryTopBar
        t={t}
        view="DEV · OWL"
        activeNav="Atlas"
        extra={<OrreryThemeToggle theme={t.name} onToggle={toggleTheme} t={t} />}
      />

      <div style={{ padding: 28, display: "grid", gap: 32, maxWidth: 1100, margin: "0 auto" }}>
        <section>
          <OrreryTag t={t}>◇ Master brand · owl mark + wordmark</OrreryTag>
          <OrreryCard t={t} style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 24 }}>
            <div style={{ display: "flex", gap: 28, alignItems: "center" }}>
              <ObservatoryOwlMark size={28} color={t.logoTint} />
              <ObservatoryOwlMark size={48} color={t.logoTint} />
              <ObservatoryOwlMark size={72} color={t.logoTint} />
              <ObservatoryOwlMark size={28} color={t.logoTintGold} />
            </div>
            <div>
              <ObservatoryWordmark height={24} color={t.logoTint} />
            </div>
            <div>
              <ObservatoryLockup height={32} color={t.logoTint} />
            </div>
          </OrreryCard>
        </section>

        <section>
          <OrreryTag t={t}>◇ Persona · filled owl + head crop</OrreryTag>
          <OrreryCard t={t} style={{ marginTop: 12, display: "flex", gap: 24, alignItems: "center" }}>
            <ObservatoryFilledOwl size={96} color={t.bright} />
            <ObservatoryFilledOwlHead size={64} color={t.bright} />
            <ObservatoryFilledOwlHead size={64} color={t.bright} blink />
            <ObservatoryFilledOwlHead size={64} color={t.bright} eyesClosed />
          </OrreryCard>
        </section>

        <section>
          <OrreryTag t={t}>◇ Layered persona · state machine</OrreryTag>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 14, marginTop: 12 }}>
            {STATES.map((state) => (
              <OrreryCard t={t} key={state} style={{ textAlign: "center" }}>
                <ObservatoryLayeredOwl size={80} color={t.bright} state={state} />
                <div style={{ marginTop: 8, fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: t.inkSoft, letterSpacing: "0.12em", textTransform: "uppercase" }}>
                  {state}
                </div>
              </OrreryCard>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
