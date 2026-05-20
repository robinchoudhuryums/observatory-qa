/**
 * Clinical note completeness header — orrery-styled top strip for the
 * Clinical Notes page. Two viz primitives in one row:
 *
 *   1. Completeness orb (left) — a planet whose brightness reflects the
 *      note's `documentationCompleteness` score (0-10). Tooltip shows the
 *      breakdown (completeness/accuracy/confidence).
 *   2. Timeline arc (right) — abbreviated lifecycle of the note:
 *      Recorded → Transcribed → Drafted → (Edited) → (Attested) → (Amended).
 *      Each step is a colored dot on a horizontal track. Filled = done.
 *
 * Industry-agnostic — no dental/medical specifics; works for any clinical
 * specialty. PHI-safe: reads only completeness/accuracy/timestamps; does
 * NOT touch decrypted note body content. Audit logging happens server-side
 * in /api/clinical/notes/:id — this component renders metadata only.
 */
import type { Theme } from "../theme";
import { brightToColor } from "../projection";

type TimelineStep = {
  id: string;
  label: string;
  /** Has this step happened? */
  done: boolean;
  /** Optional timestamp displayed below the label. */
  time?: string | null;
  /** Drafted-by-Ory marker (changes the dot color). */
  byOry?: boolean;
};

type Props = {
  t: Theme;
  /** Display label for the patient/encounter (truncated if long). */
  patientLabel: string;
  /** Provider display name (e.g. "Dr. Lena Park"). */
  providerLabel?: string | null;
  encounterDate?: string | null;
  /** Note format ("SOAP", "DAP", "BIRP", "Procedure", etc.). */
  format?: string | null;
  /** Completeness score 0-10. Null if not yet computed. */
  completeness: number | null;
  /** Clinical accuracy score 0-10. Null if not yet computed. */
  accuracy?: number | null;
  /** Confidence band ("high"/"medium"/"low"). */
  confidence?: "high" | "medium" | "low" | string | null;
  /** Lifecycle timeline — typically 4-6 steps. */
  timeline: TimelineStep[];
};

export function ClinicalCompletenessHeader({
  t,
  patientLabel,
  providerLabel,
  encounterDate,
  format,
  completeness,
  accuracy,
  confidence,
  timeline,
}: Props) {
  // Brightness from completeness — 0.5 when null so the orb still reads.
  const brightness = completeness !== null ? Math.max(0.05, Math.min(1, completeness / 10)) : 0.5;
  const orbColor = brightToColor(brightness, t);

  return (
    <div
      data-testid="clinical-completeness-header"
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(160px, 200px) 1fr",
        gap: 24,
        padding: "20px 24px",
        background: t.panel,
        border: `0.5px solid ${t.panelBorder}`,
        borderRadius: 14,
        alignItems: "center",
      }}
    >
      {/* Completeness orb */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
        <svg
          viewBox="-10 -10 20 20"
          style={{ width: "100%", maxWidth: 140, height: "auto" }}
          aria-label="Completeness orb"
        >
          {/* Outer halo — opacity scales with completeness so weak notes feel dim */}
          <circle cx="0" cy="0" r="8.5" fill={orbColor} opacity={0.18 * brightness + 0.05} />
          {/* Planet body */}
          <circle cx="0" cy="0" r="5.5" fill={orbColor} opacity={0.95} />
          {/* Specular highlight */}
          <ellipse cx="-2" cy="-2" rx="2.4" ry="1.8" fill={t.highlight} opacity={t.name === "dark" ? 0.35 : 0.55} />
          {/* Score label inside the orb */}
          <text
            x="0"
            y="0.8"
            textAnchor="middle"
            fontFamily="'Instrument Serif', Georgia, serif"
            fontStyle="italic"
            fontSize="4.5"
            fill={t.name === "dark" ? t.ink : "#0e1228"}
          >
            {completeness !== null ? completeness.toFixed(1) : "—"}
          </text>
        </svg>
        <div
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 9,
            letterSpacing: "0.14em",
            color: t.inkMute,
            textTransform: "uppercase",
            textAlign: "center",
          }}
        >
          ◇ COMPLETENESS
        </div>
        {(accuracy !== null && accuracy !== undefined) || confidence ? (
          <div
            style={{
              fontSize: 11,
              color: t.inkSoft,
              textAlign: "center",
              lineHeight: 1.4,
            }}
          >
            {accuracy !== null && accuracy !== undefined && <div>Accuracy {accuracy.toFixed(1)}</div>}
            {confidence && <div>Confidence: {confidence}</div>}
          </div>
        ) : null}
      </div>

      {/* Right side: patient/provider + timeline */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <div
            style={{
              fontFamily: "'Instrument Serif', Georgia, serif",
              fontStyle: "italic",
              fontSize: 22,
              color: t.ink,
              letterSpacing: "-0.02em",
              lineHeight: 1.2,
            }}
          >
            {patientLabel}
          </div>
          <div
            style={{
              fontFamily: "'Inter', sans-serif",
              fontSize: 12.5,
              color: t.inkSoft,
              marginTop: 4,
            }}
          >
            {[providerLabel, encounterDate, format]
              .filter((s): s is string => typeof s === "string" && s.length > 0)
              .join(" · ")}
          </div>
        </div>

        {/* Timeline */}
        {timeline.length > 0 && (
          <div>
            <Timeline t={t} steps={timeline} />
          </div>
        )}
      </div>
    </div>
  );
}

function Timeline({ t, steps }: { t: Theme; steps: TimelineStep[] }) {
  const orbColors = (step: TimelineStep): string => {
    if (!step.done) return t.inkMute;
    if (step.byOry) return t.bright;
    return t.warm;
  };

  return (
    <div data-testid="clinical-timeline" style={{ display: "flex", alignItems: "stretch", gap: 0 }}>
      {steps.map((step, i) => {
        const isLast = i === steps.length - 1;
        return (
          <div
            key={step.id}
            style={{ display: "flex", alignItems: "center", flex: isLast ? "0 0 auto" : "1 1 auto", minWidth: 0 }}
          >
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, flexShrink: 0 }}>
              <div
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 6,
                  background: orbColors(step),
                  opacity: step.done ? 1 : 0.4,
                  boxShadow: step.done && step.byOry ? `0 0 8px ${t.bright}` : "none",
                }}
                aria-label={`${step.label} ${step.done ? "complete" : "pending"}`}
              />
              <div
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 8.5,
                  letterSpacing: "0.1em",
                  color: step.done ? t.ink : t.inkMute,
                  textTransform: "uppercase",
                  whiteSpace: "nowrap",
                  textAlign: "center",
                }}
              >
                {step.label}
              </div>
              {step.time && (
                <div
                  style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 8,
                    color: t.inkMute,
                    whiteSpace: "nowrap",
                  }}
                >
                  {step.time}
                </div>
              )}
            </div>
            {!isLast && (
              <div
                style={{
                  flex: 1,
                  height: 1,
                  background: step.done && steps[i + 1].done ? t.warm : t.panelStroke,
                  margin: "0 6px",
                  minWidth: 12,
                  alignSelf: "center",
                  marginBottom: 24,
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
