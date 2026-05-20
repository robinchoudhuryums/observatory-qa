import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import FileUpload from "@/components/upload/file-upload";
import CallsTable from "@/components/tables/calls-table";
import OnboardingTour from "@/components/onboarding-tour";
import OnboardingChecklist from "@/components/onboarding-checklist";
import {
  RiAddLine,
  RiAlertLine,
  RiArrowDownSLine,
  RiAwardLine,
  RiFlashlightLine,
  RiPlayCircleLine,
  RiSearchLine,
  RiUploadLine,
} from "@remixicon/react";
import type { CallWithDetails } from "@shared/schema";
import {
  DayReplay,
  EmptyState,
  Orrery,
  OrreryCard,
  OrreryKpi,
  OrreryTag,
  useOrreryTheme,
} from "@/components/orrery";
import {
  callsToPlanets,
  deriveAtlasRealism,
  type AtlasPlanet,
  type AtlasRealism,
} from "@/lib/orrery-adapters";
import { LENSES, type LensId } from "@/lib/orrery-lenses";

/**
 * Atlas — the daily dashboard, redesigned as the orrery hero.
 *
 * Top-level structure:
 *   1. Header (search + upload buttons, unchanged from previous dashboard)
 *   2. Operational alerts: quota warning, flagged calls (preserved)
 *   3. Onboarding checklist (preserved)
 *   4. Atlas hero (NEW): orrery viz + lens switcher + KPI strip + planet detail
 *   5. Day Replay button (NEW): opens the 18s replay overlay
 *   6. Recent calls table (preserved — CallsTable deletion deferred to Phase 2)
 *
 * Data flow:
 *   - /api/calls fetched once (refetch every 60s) — feeds the Atlas adapter,
 *     KPI strip, flagged-calls panel, and recent-calls table. The Atlas
 *     computes today's metrics client-side from this list (no extra fetch).
 *   - /api/billing/subscription stays for quota warnings.
 *   - /api/employees stays for onboarding count.
 *
 * The old /api/dashboard/{metrics,sentiment,performers} endpoints are no
 * longer queried from this page; sentiment.tsx still uses /sentiment.
 * /metrics and /performers are now orphaned — flagged for follow-on cleanup
 * once the broader redesign settles.
 *
 * Industry-agnostic — no hardcoded category names. All planet labels come
 * from the org's own call data via the selected lens.
 */
export default function Dashboard() {
  const [, navigate] = useLocation();
  const t = useOrreryTheme();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [replayOpen, setReplayOpen] = useState(false);
  const [flagsExpanded, setFlagsExpanded] = useState(false);
  const [lensId, setLensId] = useState<LensId>("type");
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const {
    data: calls,
    error: callsError,
    isLoading: callsLoading,
  } = useQuery<CallWithDetails[]>({
    queryKey: ["/api/calls", { status: "", sentiment: "", employee: "" }],
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const { data: employees } = useQuery<{ id: string }[]>({
    queryKey: ["/api/employees"],
    staleTime: 60_000,
  });

  const { data: billing } = useQuery<{
    subscription: { planTier: string; status: string };
    plan: { name: string; limits: { callsPerMonth: number; aiAnalysesPerMonth: number; storageMb: number } };
    usage: { callsThisMonth: number; aiAnalysesThisMonth: number; storageMbUsed: number };
  }>({
    queryKey: ["/api/billing/subscription"],
    staleTime: 60_000,
  });

  // Quota warnings — preserved from previous dashboard implementation.
  const quotaWarnings = useMemo(() => {
    if (!billing?.plan || !billing?.usage) return [];
    const warnings: Array<{ label: string; used: number; limit: number; pct: number }> = [];
    const { limits } = billing.plan;
    const { callsThisMonth, aiAnalysesThisMonth, storageMbUsed } = billing.usage;
    const check = (label: string, used: number, limit: number) => {
      if (limit <= 0 || limit === -1) return;
      const pct = Math.round((used / limit) * 100);
      if (pct >= 80) warnings.push({ label, used, limit, pct });
    };
    check("Calls", callsThisMonth, limits.callsPerMonth);
    check("AI Analyses", aiAnalysesThisMonth, limits.aiAnalysesPerMonth);
    check("Storage (MB)", storageMbUsed, limits.storageMb);
    return warnings;
  }, [billing]);

  // Flagged calls — preserved.
  const flaggedCalls = useMemo(
    () =>
      (calls || []).filter((c) => {
        const flags = c.analysis?.flags;
        return (
          Array.isArray(flags) &&
          flags.length > 0 &&
          flags.some(
            (f) => f === "low_score" || f.startsWith("agent_misconduct") || f === "exceptional_call",
          )
        );
      }),
    [calls],
  );

  const badCalls = useMemo(
    () =>
      flaggedCalls.filter((c) => {
        const flags = c.analysis?.flags;
        return (
          Array.isArray(flags) &&
          flags.some((f) => f === "low_score" || f.startsWith("agent_misconduct"))
        );
      }),
    [flaggedCalls],
  );
  const goodCalls = useMemo(
    () =>
      flaggedCalls.filter((c) => {
        const flags = c.analysis?.flags;
        return Array.isArray(flags) && flags.some((f) => f === "exceptional_call");
      }),
    [flaggedCalls],
  );

  useEffect(() => {
    if (calls) setLastUpdated(new Date());
  }, [calls]);

  useEffect(() => {
    if (badCalls.length > 0) setFlagsExpanded(true);
  }, [badCalls.length]);

  // Atlas data — derive today's planets from real calls under the chosen lens.
  const { todaysCalls, historicalCalls } = useMemo(() => {
    if (!calls) return { todaysCalls: [] as CallWithDetails[], historicalCalls: [] as CallWithDetails[] };
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const sevenDaysAgo = new Date(todayStart);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const todays: CallWithDetails[] = [];
    const historical: CallWithDetails[] = [];
    for (const c of calls) {
      if (!c.uploadedAt) continue;
      const d = new Date(c.uploadedAt);
      if (d >= todayStart) todays.push(c);
      else if (d >= sevenDaysAgo) historical.push(c);
    }
    return { todaysCalls: todays, historicalCalls: historical };
  }, [calls]);

  const planets = useMemo<AtlasPlanet[]>(
    () => callsToPlanets(calls || [], lensId, { historicalCalls }),
    [calls, lensId, historicalCalls],
  );

  const realism: AtlasRealism = useMemo(
    () => deriveAtlasRealism(todaysCalls, historicalCalls),
    [todaysCalls, historicalCalls],
  );

  // KPI strip — derived from real call data, not the prototype's fake numbers.
  const kpis = useMemo(() => {
    const todayCount = todaysCalls.length;
    const completed = todaysCalls.filter((c) => c.status === "completed");
    const processing = todaysCalls.filter(
      (c) => c.status === "pending" || c.status === "processing",
    );
    let scoreTotal = 0;
    let scoreCount = 0;
    let positiveCount = 0;
    let sentimentRated = 0;
    for (const c of completed) {
      const raw = c.analysis?.performanceScore;
      const score = typeof raw === "string" ? parseFloat(raw) : (raw ?? null);
      if (score !== null && !Number.isNaN(score)) {
        scoreTotal += score;
        scoreCount++;
      }
      if (c.sentiment?.overallSentiment) {
        sentimentRated++;
        if (c.sentiment.overallSentiment === "positive") positiveCount++;
      }
    }
    const coachingCount = todaysCalls.filter((c) =>
      c.analysis?.flags?.some((f) => f === "low_score" || f.startsWith("agent_misconduct")),
    ).length;
    return {
      callsToday: todayCount,
      processingToday: processing.length,
      avgScore: scoreCount > 0 ? scoreTotal / scoreCount : null,
      positivePct: sentimentRated > 0 ? Math.round((positiveCount / sentimentRated) * 100) : null,
      coachingCount,
    };
  }, [todaysCalls]);

  const selectedPlanet = selectedKey ? planets.find((p) => p.groupKey === selectedKey) : null;
  const hoveredPlanet = hoveredKey ? planets.find((p) => p.groupKey === hoveredKey) : null;
  const focusedPlanet = selectedPlanet || hoveredPlanet;

  return (
    <div className="min-h-screen" data-testid="dashboard-page">
      <OnboardingTour />
      {callsError && (
        <div className="mx-6 mt-4 p-4 bg-muted/50 border border-border rounded-md text-muted-foreground text-sm flex items-center gap-2">
          <RiFlashlightLine className="w-4 h-4 flex-shrink-0" />
          No call data available yet. Upload your first call recording to get started!
        </div>
      )}

      {/* Header — search + upload preserved from prior dashboard. */}
      <header className="dashboard-header px-6 py-5">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold text-foreground tracking-tight">Atlas</h2>
            <div className="flex items-center gap-3 mt-0.5">
              <p className="text-sm text-muted-foreground">A model of your team's calls in orbit.</p>
              {lastUpdated && (
                <span className="text-xs text-muted-foreground/60 whitespace-nowrap hidden sm:inline">
                  Updated {lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <Button
              variant="outline"
              className="flex-1 sm:flex-none sm:w-56 justify-start text-muted-foreground rounded-lg"
              onClick={() => navigate("/search")}
              data-testid="search-input"
            >
              <RiSearchLine className="w-4 h-4 mr-2" />
              <span className="hidden sm:inline">Search calls...</span>
              <span className="sm:hidden">Search</span>
            </Button>
            <Button
              className="text-white border-0 shadow-md rounded-lg brand-gradient-btn whitespace-nowrap shrink-0"
              data-testid="upload-call-button"
              onClick={() => setUploadOpen(true)}
            >
              <RiAddLine className="w-4 h-4 sm:mr-2" />
              <span className="hidden sm:inline">Upload Call</span>
            </Button>
          </div>
        </div>
      </header>

      <div className="p-6 space-y-6">
        {/* Quota warning — preserved verbatim. */}
        {quotaWarnings.length > 0 &&
          (() => {
            const anyExhausted = quotaWarnings.some((w) => w.pct >= 100);
            const bgClass = anyExhausted
              ? "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900"
              : "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900";
            const iconColor = anyExhausted ? "text-red-500" : "text-amber-500";
            const titleColor = anyExhausted ? "text-red-700 dark:text-red-400" : "text-amber-700 dark:text-amber-400";
            const labelColor = anyExhausted ? "text-red-700 dark:text-red-300" : "text-amber-700 dark:text-amber-300";
            const footerColor = anyExhausted
              ? "text-red-600/80 dark:text-red-400/60"
              : "text-amber-600/80 dark:text-amber-400/60";
            return (
              <div className={`rounded-lg border p-4 ${bgClass}`}>
                <div className="flex items-center gap-2 mb-2">
                  {anyExhausted ? (
                    <RiAlertLine className={`w-5 h-5 ${iconColor}`} />
                  ) : (
                    <RiFlashlightLine className={`w-5 h-5 ${iconColor}`} />
                  )}
                  <h3 className={`font-semibold ${titleColor}`}>
                    {anyExhausted ? "Plan Limit Reached" : "Approaching Plan Limits"}
                  </h3>
                  <Badge variant="outline" className="text-xs ml-auto">
                    {billing?.plan?.name || "Free"} Plan
                  </Badge>
                </div>
                <div className="space-y-2">
                  {quotaWarnings.map((w) => (
                    <div key={w.label} className="flex items-center gap-3">
                      <span className={`text-sm ${labelColor} min-w-[120px]`}>
                        {w.label}: {w.used}/{w.limit}
                      </span>
                      <div className="flex-1 h-2 bg-amber-200 dark:bg-amber-900 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${w.pct >= 100 ? "bg-red-500" : "bg-amber-500"}`}
                          style={{ width: `${Math.min(w.pct, 100)}%` }}
                        />
                      </div>
                      <span
                        className={`text-xs font-semibold ${w.pct >= 100 ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400"}`}
                      >
                        {w.pct}%
                      </span>
                    </div>
                  ))}
                </div>
                <div
                  className={`flex items-center justify-between mt-3 ${anyExhausted ? "pt-3 border-t border-red-200 dark:border-red-900" : ""}`}
                >
                  <p className={`text-xs ${footerColor}`}>
                    {anyExhausted
                      ? "You've hit your plan limit. Uploads and analyses are blocked until you upgrade or the next billing cycle."
                      : "You're approaching your plan limits for this billing period."}
                  </p>
                  <Link href="/admin/settings?tab=billing">
                    <Button
                      size="sm"
                      variant={anyExhausted ? "default" : "outline"}
                      className={anyExhausted ? "bg-red-600 hover:bg-red-700 text-white" : ""}
                    >
                      <RiFlashlightLine className="w-3.5 h-3.5 mr-1.5" />
                      Upgrade Plan
                    </Button>
                  </Link>
                </div>
              </div>
            );
          })()}

        {/* Flagged calls — preserved verbatim. */}
        {flaggedCalls.length > 0 && (
          <div className="rounded-lg border border-border bg-card">
            <button
              className="w-full flex items-center gap-3 px-4 py-2.5 text-left"
              onClick={() => setFlagsExpanded(!flagsExpanded)}
              aria-expanded={flagsExpanded}
              aria-controls="flagged-calls-panel"
              aria-label={`Flagged calls: ${badCalls.length} need attention, ${goodCalls.length} exceptional`}
            >
              <div className="flex items-center gap-2 flex-1 min-w-0">
                {badCalls.length > 0 && (
                  <span
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-red-600 dark:text-red-400"
                    aria-label={`${badCalls.length} calls need attention`}
                  >
                    <RiAlertLine className="w-4 h-4 flex-shrink-0" />
                    {badCalls.length} need attention
                  </span>
                )}
                {badCalls.length > 0 && goodCalls.length > 0 && <span className="text-muted-foreground">|</span>}
                {goodCalls.length > 0 && (
                  <span className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-600 dark:text-emerald-400">
                    <RiAwardLine className="w-4 h-4 flex-shrink-0" />
                    {goodCalls.length} exceptional
                  </span>
                )}
              </div>
              <RiArrowDownSLine
                className={`w-4 h-4 text-muted-foreground transition-transform ${flagsExpanded ? "rotate-180" : ""}`}
              />
            </button>
            {flagsExpanded && (
              <div id="flagged-calls-panel" className="px-4 pb-3 pt-0 grid grid-cols-1 md:grid-cols-2 gap-3">
                {badCalls.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {badCalls.slice(0, 5).map((c) => (
                      <Link key={c.id} href={`/transcripts/${c.id}`}>
                        <Badge className="bg-red-200 text-red-900 text-xs cursor-pointer hover:bg-red-300">
                          {c.employee?.name || "Unassigned"} — {Number(c.analysis?.performanceScore || 0).toFixed(1)}
                        </Badge>
                      </Link>
                    ))}
                    {badCalls.length > 5 && (
                      <Link href="/reports">
                        <Badge variant="outline" className="text-xs cursor-pointer">
                          +{badCalls.length - 5} more
                        </Badge>
                      </Link>
                    )}
                  </div>
                )}
                {goodCalls.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {goodCalls.slice(0, 5).map((c) => (
                      <Link key={c.id} href={`/transcripts/${c.id}`}>
                        <Badge className="bg-emerald-200 text-emerald-900 text-xs cursor-pointer hover:bg-emerald-300">
                          <RiAwardLine className="w-3 h-3 mr-1" />
                          {c.employee?.name || "Unassigned"} — {Number(c.analysis?.performanceScore || 0).toFixed(1)}
                        </Badge>
                      </Link>
                    ))}
                    {goodCalls.length > 5 && (
                      <Link href="/reports">
                        <Badge variant="outline" className="text-xs cursor-pointer">
                          +{goodCalls.length - 5} more
                        </Badge>
                      </Link>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <OnboardingChecklist hasCallsData={(calls?.length ?? 0) > 0} hasEmployeesData={(employees?.length ?? 0) > 0} />

        {/* === Atlas hero === */}
        <section data-testid="atlas-hero" className="space-y-4">
          {/* Lens switcher + Day Replay button. */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(LENSES) as LensId[]).map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setLensId(id)}
                  data-testid={`atlas-lens-${id}`}
                  className="px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
                  style={{
                    background: lensId === id ? t.bright : "transparent",
                    color: lensId === id ? "#fff" : t.inkSoft,
                    border: `0.5px solid ${lensId === id ? t.bright : t.panelBorder}`,
                  }}
                  aria-pressed={lensId === id}
                  title={LENSES[id].description}
                >
                  {LENSES[id].label}
                </button>
              ))}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setReplayOpen(true)}
              disabled={todaysCalls.length === 0}
              data-testid="atlas-day-replay"
            >
              <RiPlayCircleLine className="w-4 h-4 mr-1.5" />
              Day replay
            </Button>
          </div>

          {/* Hero copy — adapts to realism state. */}
          <AtlasHeroCopy
            realism={realism}
            todayCount={todaysCalls.length}
            processingCount={kpis.processingToday}
          />

          {/* Orrery + side card. */}
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
            <OrreryCard t={t} padded={false} style={{ overflow: "hidden" }}>
              {planets.length === 0 ? (
                <div style={{ padding: 24 }}>
                  <EmptyState
                    t={t}
                    glyph={realism === "day-1" ? "flat-orbit" : "thin-data"}
                    owlVerb="watching"
                    title={
                      realism === "day-1"
                        ? "The sky is empty."
                        : "No calls landed today."
                    }
                    body={
                      realism === "day-1"
                        ? "Upload your first call recording and it will appear here as a planet — bigger if it's part of a busy category, brighter if it scored well."
                        : "Once a call completes processing, it'll appear here."
                    }
                    action={
                      <Button onClick={() => setUploadOpen(true)} className="mt-2">
                        <RiUploadLine className="w-4 h-4 mr-2" /> Upload a Call
                      </Button>
                    }
                  />
                </div>
              ) : (
                <Orrery
                  t={t}
                  planets={planets}
                  hoveredKey={hoveredKey}
                  selectedKey={selectedKey}
                  onHover={setHoveredKey}
                  onSelect={setSelectedKey}
                />
              )}
            </OrreryCard>

            {/* Side panel — focused planet OR KPI strip. */}
            <div className="space-y-3">
              {focusedPlanet ? (
                <FocusedPlanetCard t={t} planet={focusedPlanet} lensId={lensId} onClear={() => setSelectedKey(null)} />
              ) : (
                <>
                  <OrreryKpi
                    t={t}
                    label="Calls today"
                    value={kpis.callsToday}
                    sub={kpis.processingToday > 0 ? `${kpis.processingToday} processing` : undefined}
                    accentRamp="bright"
                  />
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
                    label="Coaching flagged"
                    value={kpis.coachingCount}
                    accentRamp={kpis.coachingCount > 0 ? "amber" : "cool"}
                  />
                </>
              )}
            </div>
          </div>
        </section>

        {/* Recent calls table — preserved. CallsTable deletion deferred to Phase 2. */}
        <CallsTable />
      </div>

      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RiUploadLine className="w-5 h-5" />
              Upload Call Recording
            </DialogTitle>
          </DialogHeader>
          <FileUpload />
        </DialogContent>
      </Dialog>

      <DayReplay t={t} calls={calls || []} open={replayOpen} onClose={() => setReplayOpen(false)} />

      {/* Suppress unused-var warning while callsLoading isn't surfaced in
          the redesign (the orrery shows an empty state instead of a spinner). */}
      <span className="sr-only" aria-hidden>
        {callsLoading ? "loading" : "loaded"}
      </span>
    </div>
  );
}

/**
 * Hero copy variants tied to atlas realism state. Industry-agnostic — no
 * dental/medical specifics — but warm: italic Instrument Serif with a
 * celestial accent on the volume number.
 */
function AtlasHeroCopy({
  realism,
  todayCount,
  processingCount,
}: {
  realism: AtlasRealism;
  todayCount: number;
  processingCount: number;
}) {
  const t = useOrreryTheme();
  const accent = (text: string) => (
    <span style={{ color: t.bright, fontWeight: 600 }}>{text}</span>
  );

  let tag = "";
  let body: React.ReactNode = null;

  const today = new Date();
  const dayTag = today
    .toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
    .toUpperCase();

  if (realism === "day-1") {
    tag = `${dayTag} · DAY 1`;
    body = <>The {accent("sky is empty")}. Your first call lights the first planet.</>;
  } else if (realism === "day-1-afternoon") {
    tag = `${dayTag} · EARLY DATA`;
    body = (
      <>
        {accent(`${todayCount} ${todayCount === 1 ? "call" : "calls"}`)} so far. The sky is forming —
        patterns need ~14 days of data to stabilize.
      </>
    );
  } else if (realism === "partial") {
    tag = `${dayTag} · MID-DAY`;
    body = (
      <>
        So far today, {accent(`${todayCount} calls`)} in orbit — {processingCount} still processing.
        The sky will fill as the day continues.
      </>
    );
  } else if (realism === "flat-day") {
    tag = `${dayTag} · QUIET`;
    body = (
      <>
        A {accent("quiet day")} — calls evenly distributed; no single category dominates.
      </>
    );
  } else {
    tag = dayTag;
    body = (
      <>
        A model of {accent(`${todayCount} calls`)} in orbit — bigger planets carry more, brighter
        ones score higher.
      </>
    );
  }

  return (
    <div className="space-y-1">
      <OrreryTag t={t}>◇ {tag}</OrreryTag>
      <h1
        className="text-2xl sm:text-3xl lg:text-4xl leading-tight max-w-3xl"
        style={{
          fontFamily: "'Inter', system-ui, sans-serif",
          fontWeight: 400,
          letterSpacing: "-0.02em",
          color: t.ink,
        }}
      >
        {body}
      </h1>
    </div>
  );
}

/**
 * Right-rail card shown when a planet is hovered or selected. Compact
 * summary of the group's data — count, avg score, signals (hot/coaching/
 * anomaly), and a "view calls" CTA that takes the user to the relevant
 * filtered list.
 */
function FocusedPlanetCard({
  t,
  planet,
  lensId,
  onClear,
}: {
  t: ReturnType<typeof useOrreryTheme>;
  planet: AtlasPlanet;
  lensId: LensId;
  onClear: () => void;
}) {
  // Build a filter URL that takes the user to the relevant filtered call list.
  // Only the type lens has a clean URL filter (status filter mapped to category).
  // Other lenses fall back to a generic search.
  let viewHref = "/transcripts";
  if (lensId === "type" && planet.groupKey !== "__other__" && planet.groupKey !== "uncategorized") {
    viewHref = `/transcripts?category=${encodeURIComponent(planet.groupKey)}`;
  } else if (lensId === "agent" && planet.groupKey !== "unassigned" && planet.groupKey !== "__other__") {
    viewHref = `/transcripts?employee=${encodeURIComponent(planet.groupKey)}`;
  }

  return (
    <OrreryCard t={t} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={onClear}
        aria-label="Clear selection"
        style={{
          position: "absolute",
          top: 8,
          right: 10,
          background: "transparent",
          border: "none",
          color: t.inkMute,
          cursor: "pointer",
          fontSize: 18,
          lineHeight: 1,
        }}
      >
        ×
      </button>
      <OrreryTag t={t}>◇ {LENSES[lensId].label}</OrreryTag>
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
        {planet.label}
      </div>
      <div style={{ display: "flex", gap: 18, marginTop: 12, fontSize: 12.5, color: t.inkSoft }}>
        <div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: t.inkMute, letterSpacing: "0.1em", textTransform: "uppercase" }}>
            Calls
          </div>
          <div style={{ fontSize: 18, fontWeight: 500, color: t.ink }}>{planet.count}</div>
        </div>
        <div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: t.inkMute, letterSpacing: "0.1em", textTransform: "uppercase" }}>
            Avg score
          </div>
          <div style={{ fontSize: 18, fontWeight: 500, color: t.ink }}>
            {planet.avgScore !== null ? planet.avgScore.toFixed(1) : "—"}
          </div>
        </div>
      </div>
      {(planet.hot || planet.coaching || planet.anomaly || planet.exceptional) && (
        <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 6 }}>
          {planet.hot && (
            <span style={{ ...badgeStyle(t), background: `${t.bright}22`, color: t.bright }}>
              ◇ TODAY'S ANCHOR
            </span>
          )}
          {planet.coaching && (
            <span style={{ ...badgeStyle(t), background: `${t.amber}22`, color: t.amber }}>
              ◇ COACHING FLAGGED
            </span>
          )}
          {planet.exceptional && (
            <span style={{ ...badgeStyle(t), background: `${t.green}22`, color: t.green }}>
              ◇ EXCEPTIONAL
            </span>
          )}
          {planet.anomaly && (
            <span style={{ ...badgeStyle(t), background: `${t.amber}22`, color: t.amber }}>
              ◇ ANOMALY VS 7-DAY AVG
            </span>
          )}
        </div>
      )}
      <div style={{ marginTop: 14 }}>
        <Link href={viewHref}>
          <Button variant="outline" size="sm" className="w-full">
            View calls
          </Button>
        </Link>
      </div>
    </OrreryCard>
  );
}

function badgeStyle(_t: ReturnType<typeof useOrreryTheme>) {
  return {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 9,
    letterSpacing: "0.12em",
    padding: "3px 8px",
    borderRadius: 4,
  } as const;
}
