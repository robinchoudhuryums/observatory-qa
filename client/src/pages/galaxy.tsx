import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Galaxy, OrreryCard, OrreryKpi, OrreryTag, useOrreryTheme } from "@/components/orrery";
import { dayBucketsToGalaxy, type GalaxyDay, type GalaxyDayRow } from "@/lib/orrery-adapters";
import { usePresentation } from "@/hooks/use-presentation";
import { RiArrowLeftSLine, RiArrowRightSLine, RiHomeLine } from "@remixicon/react";

/**
 * Galaxy — month-at-a-glance view of call volume + quality ratio per day,
 * rendered as a logarithmic spiral. Phase 3 of the Orrery redesign.
 *
 * Data: GET /api/dashboard/galaxy?month=YYYY-MM (Phase 3 backend endpoint).
 * Industry-agnostic — uses universal Call.uploadedAt + performanceScore.
 *
 * The clinical lexicon swap maps "Galaxy" → "History" via usePresentation().
 */
export default function GalaxyPage() {
  const t = useOrreryTheme();
  const [, navigate] = useLocation();
  const { lex } = usePresentation();

  // Month selector — defaults to current month.
  const [monthOffset, setMonthOffset] = useState(0);
  const monthDate = useMemo(() => {
    const d = new Date();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + monthOffset);
    return d;
  }, [monthOffset]);
  const monthKey = `${monthDate.getUTCFullYear()}-${String(monthDate.getUTCMonth() + 1).padStart(2, "0")}`;
  const monthLabel = monthDate.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  const { data: rows, isLoading } = useQuery<GalaxyDayRow[]>({
    queryKey: ["/api/dashboard/galaxy", { month: monthKey }],
    staleTime: 60_000,
  });

  const days = useMemo(() => dayBucketsToGalaxy(rows || []), [rows]);
  const [hoveredDate, setHoveredDate] = useState<string | null>(null);

  // KPIs.
  const kpis = useMemo(() => {
    const monthCalls = days.reduce((s, d) => s + d.calls, 0);
    const scoredDays = days.filter((d) => d.qualityRatio !== null);
    const avgCloseRate =
      scoredDays.length > 0 ? scoredDays.reduce((s, d) => s + (d.qualityRatio || 0), 0) / scoredDays.length : null;
    const busiest = [...days].sort((a, b) => b.calls - a.calls)[0];
    return {
      monthCalls,
      avgCloseRate,
      busiestDay: busiest && busiest.calls > 0 ? busiest : null,
      activeDays: days.filter((d) => d.calls > 0).length,
    };
  }, [days]);

  const hoveredDay: GalaxyDay | null = useMemo(
    () => (hoveredDate ? (days.find((d) => d.date === hoveredDate) ?? null) : null),
    [hoveredDate, days],
  );

  const onSelectDay = (day: GalaxyDay) => {
    // Phase 3 drill-in: hand off to transcripts list filtered by date.
    // Future enhancement: dedicated /galaxy/day/:date drill page.
    const start = `${day.date}T00:00:00Z`;
    const end = `${day.date}T23:59:59Z`;
    navigate(`/transcripts?from=${encodeURIComponent(start)}&to=${encodeURIComponent(end)}`);
  };

  return (
    <div className="min-h-screen" data-testid="galaxy-page">
      <header className="dashboard-header px-6 py-4">
        <nav className="flex items-center text-sm text-muted-foreground mb-2">
          <Link href="/" className="hover:text-foreground transition-colors">
            <RiHomeLine className="w-4 h-4" />
          </Link>
          <RiArrowRightSLine className="w-3 h-3 mx-2" />
          <span className="text-foreground font-medium">{lex("Galaxy")}</span>
        </nav>
        <div className="flex items-center justify-between">
          <div>
            <OrreryTag t={t}>◇ {monthLabel.toUpperCase()}</OrreryTag>
            <h2
              className="text-2xl font-semibold mt-1"
              style={{
                fontFamily: "'Instrument Serif', Georgia, serif",
                fontStyle: "italic",
                color: t.ink,
                letterSpacing: "-0.02em",
              }}
            >
              Monthly call volume.
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setMonthOffset((m) => m - 1)}
              aria-label="Previous month"
            >
              <RiArrowLeftSLine className="w-4 h-4" />
            </Button>
            <span className="text-sm text-muted-foreground min-w-[120px] text-center">{monthLabel}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setMonthOffset((m) => m + 1)}
              disabled={monthOffset >= 0}
              aria-label="Next month"
            >
              <RiArrowRightSLine className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      <div className="p-6 space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4">
          <OrreryCard t={t} padded={false} style={{ overflow: "hidden" }}>
            {isLoading && !rows ? (
              <div style={{ padding: 48, color: t.inkSoft, textAlign: "center" }}>
                Loading {lex("Galaxy").toLowerCase()}…
              </div>
            ) : (
              <Galaxy t={t} days={days} hoveredDate={hoveredDate} onHover={setHoveredDate} onSelectDay={onSelectDay} />
            )}
          </OrreryCard>

          <div className="space-y-3">
            {hoveredDay ? (
              <OrreryCard t={t}>
                <OrreryTag t={t}>◇ {hoveredDay.date}</OrreryTag>
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
                  {new Date(`${hoveredDay.date}T00:00:00Z`).toLocaleDateString(undefined, {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                    timeZone: "UTC",
                  })}
                </div>
                <div style={{ display: "flex", gap: 16, marginTop: 12 }}>
                  <div>
                    <div
                      style={{
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: 10,
                        color: t.inkMute,
                        letterSpacing: "0.1em",
                        textTransform: "uppercase",
                      }}
                    >
                      Calls
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 500, color: t.ink }}>{hoveredDay.calls}</div>
                  </div>
                  <div>
                    <div
                      style={{
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: 10,
                        color: t.inkMute,
                        letterSpacing: "0.1em",
                        textTransform: "uppercase",
                      }}
                    >
                      Quality score
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 500, color: t.ink }}>
                      {hoveredDay.qualityRatio !== null ? `${Math.round(hoveredDay.qualityRatio * 100)}%` : "—"}
                    </div>
                  </div>
                </div>
                {hoveredDay.calls > 0 && (
                  <Button size="sm" variant="outline" className="w-full mt-3" onClick={() => onSelectDay(hoveredDay)}>
                    View calls
                  </Button>
                )}
              </OrreryCard>
            ) : (
              <>
                <OrreryKpi
                  t={t}
                  label={`${lex("Calls").replace(/^./, (c) => c.toUpperCase())} this month`}
                  value={kpis.monthCalls}
                  accentRamp="bright"
                />
                <OrreryKpi
                  t={t}
                  label="Avg quality ratio"
                  value={kpis.avgCloseRate !== null ? Math.round(kpis.avgCloseRate * 100) : "—"}
                  sub={kpis.avgCloseRate !== null ? "%" : undefined}
                  accentRamp="warm"
                />
                <OrreryKpi
                  t={t}
                  label="Active days"
                  value={kpis.activeDays}
                  sub={`/ ${days.length}`}
                  accentRamp="cool"
                />
                {kpis.busiestDay && (
                  <OrreryKpi
                    t={t}
                    label="Busiest day"
                    value={kpis.busiestDay.day}
                    sub={`${kpis.busiestDay.calls} calls`}
                    accentRamp="amber"
                  />
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
