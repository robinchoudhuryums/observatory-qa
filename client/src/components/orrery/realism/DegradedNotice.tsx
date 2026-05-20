/**
 * Slim banner used when something's not quite right but the screen still works.
 * Three severity levels:
 *   info  — celestial cool color, "FYI we're degraded"
 *   warn  — amber, "you might want to know"
 *   error — red, "this is broken but bounded"
 *
 * Always renders inline at the top of the affected region; pass an action
 * button to give the user a way to retry or dismiss.
 */
import type { ReactNode } from "react";
import type { Theme } from "../theme";

type Severity = "info" | "warn" | "error";

type Props = {
  t: Theme;
  message: ReactNode;
  action?: ReactNode;
  severity?: Severity;
};

export function DegradedNotice({ t, message, action = null, severity = "info" }: Props) {
  const c = severity === "warn" ? t.amber : severity === "error" ? t.red : t.cool;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 14px",
        borderRadius: 8,
        background: `${c}12`,
        border: `0.5px solid ${c}40`,
        color: t.ink,
        fontSize: 12.5,
        lineHeight: 1.4,
        fontFamily: "'Inter', sans-serif",
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: 3, background: c, flexShrink: 0 }} />
      <span style={{ flex: 1, color: t.inkSoft }}>{message}</span>
      {action}
    </div>
  );
}
