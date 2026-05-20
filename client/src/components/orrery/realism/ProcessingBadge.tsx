/**
 * Inline status pill — "PROCESSING · 3" style badges used near orbit counts,
 * call rows, and other places where some items are still in flight. The dot
 * pulses for `info` and `pending` variants (1.4s CSS animation), holds steady
 * for `error` and `success`.
 *
 * The `realPulse` keyframe is defined in client/src/index.css (utilities
 * layer) so it's globally available without per-component CSS.
 */
import type { Theme } from "../theme";

type Variant = "info" | "pending" | "error" | "success";

type Props = {
  t: Theme;
  label?: string;
  count?: number | null;
  variant?: Variant;
};

export function ProcessingBadge({ t, label = "PROCESSING", count = null, variant = "info" }: Props) {
  const colors: Record<Variant, string> = {
    info: t.cool,
    pending: t.amber,
    error: t.red,
    success: t.bright,
  };
  const c = colors[variant];
  const animated = variant === "info" || variant === "pending";

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 9px",
        borderRadius: 100,
        background: `${c}1c`,
        color: c,
        border: `0.5px solid ${c}40`,
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 9.5,
        letterSpacing: "0.12em",
      }}
    >
      <span
        style={{
          width: 5,
          height: 5,
          borderRadius: 3,
          background: c,
          animation: animated ? "realPulse 1.4s ease-in-out infinite" : "none",
        }}
      />
      {label}
      {count !== null ? ` · ${count}` : ""}
    </span>
  );
}
