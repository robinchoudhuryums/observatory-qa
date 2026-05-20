/**
 * Light/dark theme toggle button. ◐/◑ glyphs evoke a moon phase. The button
 * itself is theme-aware (border + text track the current theme), so it reads
 * cleanly in both modes. Consumers pass `theme` + `onToggle`; this component
 * doesn't manage state directly.
 */
import type { Theme } from "./theme";

type Props = {
  theme: "light" | "dark";
  onToggle: () => void;
  t: Theme;
};

export function OrreryThemeToggle({ theme, onToggle, t }: Props) {
  return (
    <button
      type="button"
      onClick={onToggle}
      style={{
        padding: "5px 10px",
        borderRadius: 6,
        background: "transparent",
        border: `0.5px solid ${t.panelBorder}`,
        fontSize: 10.5,
        color: t.inkSoft,
        fontFamily: "'JetBrains Mono', monospace",
        letterSpacing: "0.1em",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        gap: 5,
      }}
      aria-label={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
    >
      {theme === "light" ? "◐" : "◑"} {theme === "light" ? "LIGHT" : "DARK"}
    </button>
  );
}
