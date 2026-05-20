import { useMemo, useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import {
  Constellation,
  PatternsNetwork,
  OrreryCard,
  OrreryKpi,
  OrreryTag,
  TrackPatternPopover,
  useOrreryTheme,
} from "@/components/orrery";
import {
  patternsToConstellations,
  type Constellation as ConstellationData,
} from "@/lib/orrery-adapters";
import { usePresentation } from "@/hooks/use-presentation";
import { RiArrowRightSLine, RiHomeLine, RiBellLine } from "@remixicon/react";

/**
 * Patterns view — recurring topic clusters across the org's recent calls.
 * Rewritten from the prior insights page as part of Phase 3.
 *
 * Each cluster (from /api/insights/clusters) becomes a constellation. The
 * sidebar lists patterns; clicking a pattern highlights its constellation
 * and shows evidence calls. Managers can subscribe to a pattern via the
 * TrackPatternPopover.
 *
 * Clinical-mode swap (observatory → clinical): Constellation → PatternsNetwork.
 * Lexicon: "patterns" → "trends", "constellation" → "pattern".
 *
 * Industry-agnostic — topic terms come from the org's own
 * /api/insights/clusters output. Nothing dental-specific.
 */
export default function InsightsPage() {
  const t = useOrreryTheme();
  const [, navigate] = useLocation();
  const { isClinical, lex } = usePresentation();

  // Days window — 30 by default; users can switch to 7 or 90.
  const [days, setDays] = useState<7 | 30 | 90>(30);

  const { data: response, isLoading } = useQuery<{
    clusters: Array<{
      id: string;
      label: string;
      topics: string[];
      callCount: number;
      callIds: string[];
      avgScore: number | null;
      trend: "rising" | "stable" | "declining";
    }>;
    totalClusters: number;
  }>({
    queryKey: ["/api/insights/clusters", { days }],
    staleTime: 60_000,
  });

  const patterns: ConstellationData[] = useMemo(
    () => patternsToConstellations(response?.clusters ?? []),
    [response],
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedPattern = useMemo(
    () => patterns.find((p) => p.id === selectedId) ?? patterns[0] ?? null,
    [patterns, selectedId],
  );

  const [trackAnchor, setTrackAnchor] = useState<DOMRect | null>(null);
  const trackTriggerRef = useRef<HTMLButtonElement>(null);
  const [trackOpen, setTrackOpen] = useState(false);

  const kpis = useMemo(() => {
    const rising = patterns.filter((p) => p.trend === "rising").length;
    const declining = patterns.filter((p) => p.trend === "declining").length;
    const totalOccurrences = patterns.reduce((s, p) => s + p.occurrences, 0);
    return {
      total: patterns.length,
      rising,
      declining,
      totalOccurrences,
    };
  }, [patterns]);

  return (
    <div className="min-h-screen" data-testid="insights-page">
      <header className="dashboard-header px-6 py-4">
        <nav className="flex items-center text-sm text-muted-foreground mb-2">
          <Link href="/" className="hover:text-foreground transition-colors">
            <RiHomeLine className="w-4 h-4" />
          </Link>
          <RiArrowRightSLine className="w-3 h-3 mx-2" />
          <span className="text-foreground font-medium">{lex("Patterns")}</span>
        </nav>
        <div className="flex items-center justify-between">
          <div>
            <OrreryTag t={t}>
              ◇ LAST {days} DAYS · {kpis.total} {lex("Patterns").toUpperCase()}
            </OrreryTag>
            <h2
              className="text-2xl font-semibold mt-1"
              style={{
                fontFamily: "'Instrument Serif', Georgia, serif",
                fontStyle: "italic",
                color: t.ink,
                letterSpacing: "-0.02em",
              }}
            >
              {isClinical ? "Recurring trends in your calls." : "Constellations forming in the sky."}
            </h2>
          </div>
          <div className="flex items-center gap-1">
            {([7, 30, 90] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDays(d)}
                data-testid={`patterns-days-${d}`}
                className="px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
                style={{
                  background: days === d ? t.bright : "transparent",
                  color: days === d ? "#fff" : t.inkSoft,
                  border: `0.5px solid ${days === d ? t.bright : t.panelBorder}`,
                }}
                aria-pressed={days === d}
              >
                {d} days
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="p-6 space-y-6">
        {/* KPI strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <OrreryKpi t={t} label={`${lex("Patterns")} found`} value={kpis.total} accentRamp="bright" />
          <OrreryKpi t={t} label="Rising" value={kpis.rising} accentRamp="warm" />
          <OrreryKpi t={t} label="Declining" value={kpis.declining} accentRamp="amber" />
          <OrreryKpi t={t} label="Total occurrences" value={kpis.totalOccurrences} accentRamp="cool" />
        </div>

        {/* Constellation hero + sidebar */}
        {isLoading && !response ? (
          <OrreryCard t={t}>
            <div style={{ padding: 48, color: t.inkSoft, textAlign: "center" }}>
              Looking for {lex("patterns").toLowerCase()}…
            </div>
          </OrreryCard>
        ) : patterns.length === 0 ? (
          <OrreryCard t={t}>
            <div style={{ padding: 32, textAlign: "center" }}>
              <OrreryTag t={t}>◇ NO {lex("PATTERNS").toUpperCase()} YET</OrreryTag>
              <div
                style={{
                  fontFamily: "'Instrument Serif', Georgia, serif",
                  fontStyle: "italic",
                  fontSize: 22,
                  color: t.ink,
                  marginTop: 8,
                }}
              >
                The sky is forming.
              </div>
              <p style={{ color: t.inkSoft, marginTop: 8, fontSize: 13, maxWidth: 480, margin: "8px auto 0" }}>
                {lex("Patterns")} emerge once your team has ~14 days of call data with consistent topics. Check back as
                more calls complete.
              </p>
            </div>
          </OrreryCard>
        ) : selectedPattern ? (
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
            <OrreryCard t={t} padded={false} style={{ overflow: "hidden" }}>
              {isClinical ? (
                <PatternsNetwork t={t} pattern={selectedPattern} />
              ) : (
                <Constellation t={t} pattern={selectedPattern} />
              )}
            </OrreryCard>

            <div className="space-y-3">
              <OrreryCard t={t}>
                <OrreryTag
                  t={t}
                  color={
                    selectedPattern.trend === "rising"
                      ? t.bright
                      : selectedPattern.trend === "declining"
                        ? t.amber
                        : t.warm
                  }
                >
                  ◇ {selectedPattern.stat.toUpperCase()}
                </OrreryTag>
                <div
                  style={{
                    fontFamily: "'Instrument Serif', Georgia, serif",
                    fontStyle: "italic",
                    fontSize: 22,
                    color: t.ink,
                    marginTop: 4,
                    lineHeight: 1.2,
                  }}
                >
                  {selectedPattern.label}
                </div>
                {selectedPattern.nodes.length > 0 && (
                  <div className="mt-3 text-xs text-muted-foreground">
                    <span className="font-mono uppercase tracking-wider">Topics:</span>{" "}
                    {selectedPattern.nodes.map((n) => n.label).join(" · ")}
                  </div>
                )}
                <div className="mt-4 flex gap-2">
                  <Button
                    ref={trackTriggerRef}
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => {
                      setTrackAnchor(trackTriggerRef.current?.getBoundingClientRect() ?? null);
                      setTrackOpen(true);
                    }}
                    data-testid="track-pattern-trigger"
                  >
                    <RiBellLine className="w-4 h-4 mr-1.5" />
                    Track this {lex("pattern")}
                  </Button>
                  {selectedPattern.callIds.length > 0 && (
                    <Button
                      size="sm"
                      className="flex-1"
                      onClick={() => navigate(`/transcripts?cluster=${encodeURIComponent(selectedPattern.id)}`)}
                    >
                      View {selectedPattern.callIds.length} calls
                    </Button>
                  )}
                </div>
              </OrreryCard>

              {/* Other patterns list. */}
              {patterns.length > 1 && (
                <OrreryCard t={t}>
                  <OrreryTag t={t}>◇ OTHER {lex("PATTERNS").toUpperCase()}</OrreryTag>
                  <div className="mt-3 space-y-1.5">
                    {patterns
                      .filter((p) => p.id !== selectedPattern.id)
                      .slice(0, 8)
                      .map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => setSelectedId(p.id)}
                          className="w-full text-left p-2 rounded-md hover:bg-accent/30 transition-colors"
                          data-testid={`patterns-item-${p.id}`}
                          style={{ background: "transparent" }}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium truncate" style={{ color: t.ink }}>
                              {p.label}
                            </span>
                            <span
                              className="text-xs ml-2 flex-shrink-0"
                              style={{
                                color:
                                  p.trend === "rising" ? t.green : p.trend === "declining" ? t.red : t.inkSoft,
                              }}
                            >
                              {p.trend === "rising" ? "↑" : p.trend === "declining" ? "↓" : "→"} {p.occurrences}
                            </span>
                          </div>
                        </button>
                      ))}
                  </div>
                </OrreryCard>
              )}
            </div>
          </div>
        ) : null}
      </div>

      {selectedPattern && (
        <TrackPatternPopover
          t={t}
          open={trackOpen}
          onClose={() => setTrackOpen(false)}
          anchorRect={trackAnchor}
          patternKey={selectedPattern.id}
          patternLabel={selectedPattern.label}
        />
      )}
    </div>
  );
}
