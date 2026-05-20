import { useMemo } from "react";
import { Link, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import type { CallWithDetails } from "@shared/schema";
import { CALL_CATEGORIES } from "@shared/schema";
import {
  CallList,
  EmptyState,
  OrreryCard,
  OrreryCenterStar,
  OrreryKpi,
  OrreryPlanet,
  OrreryStarfield,
  OrreryTag,
  TILT,
  useOrreryTheme,
  type PlanetData,
} from "@/components/orrery";
import { usePresentation } from "@/hooks/use-presentation";
import {
  RiArrowLeftLine,
  RiArrowRightSLine,
  RiHomeLine,
} from "@remixicon/react";

/**
 * Atlas cluster drill-in. Reached by clicking a planet on the Atlas hero.
 *
 * Shows the cluster (call category) as a hero planet with its constituent
 * calls orbiting as smaller "moons" — each moon's size derived from
 * duration, brightness from performance score. Below: a CallList scoped
 * to this category.
 *
 * Route: /atlas/cluster/:category  (URL-encoded category key)
 *
 * Industry-agnostic — the hero label comes from the URL param (which came
 * from the org's own data via the Atlas adapter). No hardcoded copy.
 */
export default function AtlasCluster() {
  const params = useParams();
  const t = useOrreryTheme();
  const { lex } = usePresentation();
  const categoryParam = params?.category;
  const category = categoryParam ? decodeURIComponent(categoryParam) : null;

  const { data: calls } = useQuery<CallWithDetails[]>({
    queryKey: ["/api/calls", { status: "", sentiment: "", employee: "" }],
    staleTime: 30_000,
  });

  // Scope to today + this category. (atlas-cluster is the day's drill-in,
  // not a lifetime view — that's what the search page is for.)
  const { todaysClusterCalls, allClusterCalls } = useMemo(() => {
    if (!calls) return { todaysClusterCalls: [] as CallWithDetails[], allClusterCalls: [] as CallWithDetails[] };
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const matches = (c: CallWithDetails) => {
      if (!category) return false;
      if (category === "uncategorized") return !c.callCategory;
      return c.callCategory === category;
    };

    const todays = calls.filter((c) => {
      if (!matches(c)) return false;
      if (!c.uploadedAt) return false;
      return new Date(c.uploadedAt) >= todayStart;
    });
    const all = calls.filter(matches);
    return { todaysClusterCalls: todays, allClusterCalls: all };
  }, [calls, category]);

  // Build moon planets — one per call, distributed across 3 rings.
  const moons = useMemo<Array<PlanetData & { id: string }>>(() => {
    if (todaysClusterCalls.length === 0) return [];
    // Sort by uploadedAt so moons land in chronological order around the planet.
    const sorted = [...todaysClusterCalls].sort(
      (a, b) =>
        new Date(a.uploadedAt || 0).getTime() - new Date(b.uploadedAt || 0).getTime(),
    );
    const ringRadii = [12, 16, 22];
    return sorted.map((c, i) => {
      const ring = i % 3;
      const radius = ringRadii[ring];
      const angle = (i / Math.max(sorted.length, 1)) * Math.PI * 2;
      const px = Math.cos(angle) * radius;
      const py = Math.sin(angle) * radius * TILT;
      const scoreRaw = c.analysis?.performanceScore;
      const score = typeof scoreRaw === "string" ? parseFloat(scoreRaw) : (scoreRaw ?? 5);
      const br = Math.max(0, Math.min(1, (Number.isNaN(score) ? 5 : score) / 10));
      const duration = c.duration || 60;
      const sz = 0.6 + Math.min(1.4, Math.log10(duration / 30 + 1) * 1.2);
      return {
        id: c.id,
        px,
        py,
        sz,
        br,
        hot: false,
      };
    });
  }, [todaysClusterCalls]);

  // KPIs for this cluster.
  const kpis = useMemo(() => {
    const completed = todaysClusterCalls.filter((c) => c.status === "completed");
    let scoreTotal = 0;
    let scored = 0;
    let positiveCount = 0;
    let sentimentRated = 0;
    let durationTotal = 0;
    for (const c of completed) {
      const raw = c.analysis?.performanceScore;
      const score = typeof raw === "string" ? parseFloat(raw) : (raw ?? null);
      if (score !== null && !Number.isNaN(score)) {
        scoreTotal += score;
        scored++;
      }
      if (c.sentiment?.overallSentiment) {
        sentimentRated++;
        if (c.sentiment.overallSentiment === "positive") positiveCount++;
      }
      durationTotal += c.duration || 0;
    }
    return {
      count: todaysClusterCalls.length,
      avgScore: scored > 0 ? scoreTotal / scored : null,
      positivePct: sentimentRated > 0 ? Math.round((positiveCount / sentimentRated) * 100) : null,
      avgDurationSec: completed.length > 0 ? durationTotal / completed.length : 0,
    };
  }, [todaysClusterCalls]);

  if (!category) {
    return (
      <div className="min-h-screen flex items-center justify-center" data-testid="atlas-cluster-missing">
        <EmptyState
          t={t}
          glyph="cloud"
          title="No cluster selected."
          body="Open the Atlas and click a planet to drill into a cluster."
          action={
            <Link href="/">
              <Button>
                <RiArrowLeftLine className="w-4 h-4 mr-2" />
                Back to Atlas
              </Button>
            </Link>
          }
        />
      </div>
    );
  }

  const displayLabel = categoryDisplayLabel(category);

  return (
    <div className="min-h-screen" data-testid="atlas-cluster-page">
      {/* Breadcrumbs */}
      <header className="dashboard-header px-6 py-4">
        <nav className="flex items-center text-sm text-muted-foreground mb-2">
          <Link href="/" className="hover:text-foreground transition-colors">
            <RiHomeLine className="w-4 h-4" />
          </Link>
          <RiArrowRightSLine className="w-3 h-3 mx-2" />
          <Link href="/" className="hover:text-foreground transition-colors">
            Atlas
          </Link>
          <RiArrowRightSLine className="w-3 h-3 mx-2" />
          <span className="text-foreground font-medium">{lex("planet")} detail</span>
        </nav>
        <div className="flex items-center justify-between">
          <div>
            <OrreryTag t={t}>◇ TODAY · {kpis.count} {kpis.count === 1 ? "CALL" : "CALLS"}</OrreryTag>
            <h2
              className="text-2xl font-semibold mt-1"
              style={{
                fontFamily: "'Instrument Serif', Georgia, serif",
                fontStyle: "italic",
                color: t.ink,
                letterSpacing: "-0.02em",
              }}
            >
              {displayLabel}
            </h2>
          </div>
          <Link href="/">
            <Button variant="outline" size="sm">
              <RiArrowLeftLine className="w-4 h-4 mr-1" />
              Back to Atlas
            </Button>
          </Link>
        </div>
      </header>

      <div className="p-6 space-y-6">
        {/* Hero — planet at center, moons orbiting. */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4">
          <OrreryCard t={t} padded={false} style={{ overflow: "hidden" }}>
            {moons.length === 0 ? (
              <div style={{ padding: 32 }}>
                <EmptyState
                  t={t}
                  glyph="thin-data"
                  title="No calls in this cluster today."
                  body={`This cluster has ${allClusterCalls.length} ${allClusterCalls.length === 1 ? "call" : "calls"} total — none from today yet.`}
                />
              </div>
            ) : (
              <svg
                viewBox="-30 -20 60 32"
                preserveAspectRatio="xMidYMid meet"
                style={{
                  width: "100%",
                  height: "auto",
                  display: "block",
                  background: t.bg,
                }}
                role="img"
                aria-label={`${moons.length} calls orbiting the ${displayLabel} cluster`}
              >
                <OrreryStarfield t={t} count={50} spread={[28, 14]} />
                {/* Three orbit rings — visual cues for moon distribution */}
                {[12, 16, 22].map((r) => (
                  <ellipse
                    key={r}
                    cx="0"
                    cy="0"
                    rx={r}
                    ry={r * TILT}
                    fill="none"
                    stroke={t.orbit}
                    strokeWidth="0.12"
                    strokeDasharray="0.4 0.4"
                  />
                ))}
                <OrreryCenterStar t={t} idSeed="cluster" />

                {/* Hero planet at center — represents the cluster itself, sized by total volume. */}
                <g>
                  <circle cx="0" cy="0" r={3.4} fill={t.warm} opacity={0.4} />
                  <circle cx="0" cy="0" r={2.4} fill={t.bright} opacity={0.95} />
                </g>

                {/* Moons */}
                {moons.map((m) => (
                  <Link key={m.id} href={`/transcripts/${m.id}`}>
                    <g style={{ cursor: "pointer" }}>
                      <OrreryPlanet p={m} t={t} />
                    </g>
                  </Link>
                ))}
              </svg>
            )}
          </OrreryCard>

          <div className="space-y-3">
            <OrreryKpi t={t} label={lex("Calls today")} value={kpis.count} accentRamp="bright" />
            <OrreryKpi
              t={t}
              label="Avg score"
              value={kpis.avgScore !== null ? kpis.avgScore.toFixed(1) : "—"}
              sub={kpis.avgScore !== null ? "/ 10" : undefined}
              accentRamp="warm"
            />
            <OrreryKpi
              t={t}
              label="Positive sentiment"
              value={kpis.positivePct !== null ? kpis.positivePct : "—"}
              sub={kpis.positivePct !== null ? "%" : undefined}
              accentRamp="cool"
            />
            <OrreryKpi
              t={t}
              label="Avg duration"
              value={
                kpis.avgDurationSec > 0
                  ? `${Math.floor(kpis.avgDurationSec / 60)}:${Math.floor(kpis.avgDurationSec % 60)
                      .toString()
                      .padStart(2, "0")}`
                  : "—"
              }
              accentRamp="cold"
            />
          </div>
        </div>

        {/* Call list scoped to this cluster. */}
        <section>
          <h3 className="text-base font-semibold text-foreground mb-3">All calls in this cluster</h3>
          <CallList
            mode="full"
            filterFn={(c) =>
              category === "uncategorized" ? !c.callCategory : c.callCategory === category
            }
            emptyTitle="No calls in this cluster."
            emptyBody="When a call matches this category, it will appear here."
          />
        </section>
      </div>
    </div>
  );
}

function categoryDisplayLabel(key: string): string {
  if (key === "uncategorized") return "Uncategorized";
  const found = CALL_CATEGORIES.find((c) => c.value === key);
  if (found) return found.label;
  return key.replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
