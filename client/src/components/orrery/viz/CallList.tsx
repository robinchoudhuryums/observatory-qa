/**
 * Card-based call list — replaces the previous tabular CallsTable.
 *
 * Each call renders as an orrery-styled card with a small "planet" glyph
 * (size by duration, brightness by performance score) on the left, name +
 * category + status in the middle, and metadata + sentiment chip on the
 * right. Cards link through to the call detail page.
 *
 * Modes:
 *   full    — filters + sort + pagination (used by transcripts list page)
 *   compact — fixed limit, no controls (used by dashboard "Recent calls")
 *
 * Industry-agnostic — labels come from real call data; nothing hardcoded.
 *
 * Phase 2 scope decisions (flagged as follow-on items):
 *   - Bulk select + bulk delete dropped — bulk operations move to a dedicated
 *     admin panel (CallsTable's bulk UI was complex; not all of it earned
 *     its real estate on the main list view)
 *   - Inline per-row delete dropped — deletion still available from the
 *     call detail page; bulk deletion handled by the future admin panel
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { getSentimentBadge as getSentimentBadgeHelper } from "@/lib/badge-helpers";
import type { CallWithDetails, Employee, AuthUser } from "@shared/schema";
import { CALL_CATEGORIES } from "@shared/schema";
import { getQueryFn } from "@/lib/queryClient";
import { brightToColor } from "../projection";
import { useOrreryTheme } from "../theme";
import { OrreryCard } from "../OrreryCard";
import { OrreryTag } from "../OrreryTag";
import { EmptyState } from "../realism/EmptyState";
import {
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiPhoneLine,
  RiTimeLine,
  RiCheckLine,
  RiCloseLine,
  RiLoader4Line,
  RiAlertLine,
  RiAwardLine,
} from "@remixicon/react";

type SortField = "date" | "duration" | "score";
type SortDir = "asc" | "desc";

const PAGE_SIZE_OPTIONS = [10, 25, 50];

type Props = {
  /** "full" enables filters/sort/pagination; "compact" shows top N only. */
  mode?: "full" | "compact";
  /** Compact mode: how many calls to show. Ignored in full mode. */
  limit?: number;
  /** Pre-filter calls (used by atlas-cluster.tsx to scope to a category). */
  filterFn?: (call: CallWithDetails) => boolean;
  /** Title shown above the list. Hidden when null. */
  title?: string | null;
  /** Empty-state copy customization. */
  emptyTitle?: string;
  emptyBody?: string;
};

export function CallList({ mode = "full", limit = 5, filterFn, title = null, emptyTitle, emptyBody }: Props) {
  const t = useOrreryTheme();

  // Filters — server-side filters via queryKey trigger refetch; client-side
  // for category + flag + score range (matches the prior CallsTable behavior).
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sentimentFilter, setSentimentFilter] = useState<string>("all");
  const [employeeFilter, setEmployeeFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [flagFilter, setFlagFilter] = useState<string>("all");

  const [sortField, setSortField] = useState<SortField>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);

  const { data: user } = useQuery<AuthUser>({
    queryKey: ["/api/auth/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    staleTime: Infinity,
  });

  const { data: calls, isLoading: callsLoading } = useQuery<CallWithDetails[]>({
    queryKey: [
      "/api/calls",
      {
        status: statusFilter === "all" ? "" : statusFilter,
        sentiment: sentimentFilter === "all" ? "" : sentimentFilter,
        employee: employeeFilter === "all" ? "" : employeeFilter,
      },
    ],
  });

  const { data: employees } = useQuery<Employee[]>({
    queryKey: ["/api/employees"],
  });

  // Apply client-side filters + sort.
  const processed = useMemo(() => {
    if (!calls) return [];
    let result = calls.filter((c) => {
      if (categoryFilter !== "all" && c.callCategory !== categoryFilter) return false;
      if (flagFilter !== "all") {
        const flags = Array.isArray(c.analysis?.flags) ? (c.analysis.flags as string[]) : [];
        if (flagFilter === "flagged" && flags.length === 0) return false;
        if (flagFilter === "unflagged" && flags.length > 0) return false;
        if (flagFilter === "exceptional" && !flags.includes("exceptional_call")) return false;
        if (flagFilter === "low_score" && !flags.includes("low_score")) return false;
      }
      if (filterFn && !filterFn(c)) return false;
      return true;
    });

    // Sort.
    result = [...result].sort((a, b) => {
      let cmp = 0;
      if (sortField === "date") {
        const at = a.uploadedAt ? new Date(a.uploadedAt).getTime() : 0;
        const bt = b.uploadedAt ? new Date(b.uploadedAt).getTime() : 0;
        cmp = at - bt;
      } else if (sortField === "duration") {
        cmp = (a.duration || 0) - (b.duration || 0);
      } else if (sortField === "score") {
        const sa = parseFloat(a.analysis?.performanceScore || "0");
        const sb = parseFloat(b.analysis?.performanceScore || "0");
        cmp = sa - sb;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });

    return result;
  }, [calls, categoryFilter, flagFilter, filterFn, sortField, sortDir]);

  const totalCount = processed.length;
  const displayedCalls = useMemo(() => {
    if (mode === "compact") return processed.slice(0, limit);
    const start = page * pageSize;
    return processed.slice(start, start + pageSize);
  }, [processed, mode, limit, page, pageSize]);

  const totalPages = mode === "full" ? Math.ceil(totalCount / pageSize) : 1;

  // Available category options — only show categories that actually appear
  // in this org's calls. Avoids exposing the full multi-industry CALL_CATEGORIES
  // dropdown to orgs that don't use most of them.
  const availableCategories = useMemo(() => {
    if (!calls) return [];
    const seen = new Set<string>();
    for (const c of calls) {
      if (c.callCategory) seen.add(c.callCategory);
    }
    return Array.from(seen).sort();
  }, [calls]);

  if (callsLoading && !calls) {
    return (
      <div className="space-y-2" data-testid="call-list-loading">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (totalCount === 0) {
    return (
      <OrreryCard t={t}>
        <EmptyState
          t={t}
          glyph="thin-data"
          title={emptyTitle || "No calls yet."}
          body={emptyBody || "Once a call completes processing, it'll appear here."}
        />
      </OrreryCard>
    );
  }

  return (
    <div className="space-y-3" data-testid={mode === "compact" ? "recent-calls" : "call-list"}>
      {title && (
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-foreground">{title}</h3>
          <OrreryTag t={t}>
            ◇ {totalCount} {totalCount === 1 ? "CALL" : "CALLS"}
          </OrreryTag>
        </div>
      )}

      {/* Filters — full mode only. */}
      {mode === "full" && (
        <div className="flex flex-wrap gap-2 items-center">
          <FilterSelect
            value={statusFilter}
            onChange={(v) => {
              setStatusFilter(v);
              setPage(0);
            }}
            ariaLabel="Status filter"
            options={[
              { value: "all", label: "All statuses" },
              { value: "completed", label: "Completed" },
              { value: "processing", label: "Processing" },
              { value: "pending", label: "Pending" },
              { value: "failed", label: "Failed" },
            ]}
          />
          <FilterSelect
            value={sentimentFilter}
            onChange={(v) => {
              setSentimentFilter(v);
              setPage(0);
            }}
            ariaLabel="Sentiment filter"
            options={[
              { value: "all", label: "All sentiment" },
              { value: "positive", label: "Positive" },
              { value: "neutral", label: "Neutral" },
              { value: "negative", label: "Negative" },
            ]}
          />
          {(employees?.length ?? 0) > 0 && (
            <FilterSelect
              value={employeeFilter}
              onChange={(v) => {
                setEmployeeFilter(v);
                setPage(0);
              }}
              ariaLabel="Employee filter"
              options={[
                { value: "all", label: "All employees" },
                ...(employees || []).map((e) => ({ value: e.id, label: e.name })),
              ]}
            />
          )}
          {availableCategories.length > 0 && (
            <FilterSelect
              value={categoryFilter}
              onChange={(v) => {
                setCategoryFilter(v);
                setPage(0);
              }}
              ariaLabel="Category filter"
              options={[
                { value: "all", label: "All categories" },
                ...availableCategories.map((c) => ({
                  value: c,
                  label: categoryLabel(c),
                })),
              ]}
            />
          )}
          <FilterSelect
            value={flagFilter}
            onChange={(v) => {
              setFlagFilter(v);
              setPage(0);
            }}
            ariaLabel="Flag filter"
            options={[
              { value: "all", label: "All flags" },
              { value: "flagged", label: "Any flag" },
              { value: "exceptional", label: "Exceptional" },
              { value: "low_score", label: "Low score" },
              { value: "unflagged", label: "Unflagged" },
            ]}
          />

          <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            <span>Sort</span>
            <FilterSelect
              value={sortField}
              onChange={(v) => setSortField(v as SortField)}
              ariaLabel="Sort field"
              options={[
                { value: "date", label: "Date" },
                { value: "duration", label: "Duration" },
                { value: "score", label: "Score" },
              ]}
            />
            <button
              type="button"
              className="px-2 py-1 rounded-md text-xs"
              style={{ border: `0.5px solid ${t.panelBorder}`, color: t.inkSoft }}
              onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
              aria-label={`Sort direction ${sortDir}`}
            >
              {sortDir === "asc" ? "↑" : "↓"}
            </button>
          </div>
        </div>
      )}

      {/* Cards. */}
      <div className="space-y-2">
        {displayedCalls.map((call) => (
          <CallCard key={call.id} call={call} />
        ))}
      </div>

      {/* Pagination — full mode only. */}
      {mode === "full" && totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Rows per page</span>
            <FilterSelect
              value={String(pageSize)}
              onChange={(v) => {
                setPageSize(parseInt(v, 10));
                setPage(0);
              }}
              ariaLabel="Page size"
              options={PAGE_SIZE_OPTIONS.map((n) => ({ value: String(n), label: String(n) }))}
            />
            <span className="ml-3">
              {page * pageSize + 1}–{Math.min((page + 1) * pageSize, totalCount)} of {totalCount}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              aria-label="Previous page"
            >
              <RiArrowLeftSLine className="w-4 h-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              aria-label="Next page"
            >
              <RiArrowRightSLine className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Compact mode "view all" CTA — only shown when there are more calls than displayed. */}
      {mode === "compact" && totalCount > limit && (
        <div className="pt-2">
          <Link href="/transcripts">
            <Button variant="outline" size="sm" className="w-full">
              View all {totalCount} calls
            </Button>
          </Link>
        </div>
      )}

      {/* Suppress unused-var warning while role-aware actions are gated to
          future versions. Manager/admin gates apply when bulk + delete return. */}
      <span className="sr-only" aria-hidden>
        {user?.role || "viewer"}
      </span>
    </div>
  );
}

/**
 * Individual call card. Small planet glyph + name/category + status chips.
 * Clicking anywhere on the card navigates to the call detail page.
 */
function CallCard({ call }: { call: CallWithDetails }) {
  const t = useOrreryTheme();
  const score = parseFloat(call.analysis?.performanceScore || "0");
  const brightness = Math.max(0, Math.min(1, isNaN(score) ? 0.5 : score / 10));
  const glyphColor = brightToColor(brightness, t);
  const duration = call.duration || 0;
  const flags = Array.isArray(call.analysis?.flags) ? (call.analysis.flags as string[]) : [];
  const hasCoachingFlag = flags.some((f) => f === "low_score" || f.startsWith("agent_misconduct"));
  const hasExceptional = flags.includes("exceptional_call");

  return (
    <Link href={`/transcripts/${call.id}`}>
      <div
        className="card-clickable rounded-lg p-3 flex items-center gap-4"
        style={{
          background: t.panel,
          border: `0.5px solid ${t.panelBorder}`,
        }}
        data-testid={`call-card-${call.id}`}
      >
        {/* Planet glyph */}
        <div className="relative" style={{ width: 32, height: 32, flexShrink: 0 }}>
          <svg viewBox="-10 -10 20 20" style={{ width: "100%", height: "100%" }}>
            <circle cx="0" cy="0" r={4 + Math.min(4, Math.log10(duration + 10))} fill={glyphColor} opacity={0.95} />
            {hasCoachingFlag && (
              <circle cx="0" cy="0" r="8" fill="none" stroke={t.amber} strokeWidth="0.4" strokeDasharray="1 1" />
            )}
            {hasExceptional && <circle cx="0" cy="0" r="8" fill="none" stroke={t.green} strokeWidth="0.5" />}
          </svg>
        </div>

        {/* Identity */}
        <div className="flex-1 min-w-0">
          <div className="font-medium text-foreground truncate">{call.fileName || call.employee?.name || "Call"}</div>
          <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
            {call.employee?.name && (
              <span className="truncate" title={call.employee.name}>
                {call.employee.name}
              </span>
            )}
            {call.callCategory && (
              <>
                <span>·</span>
                <span className="truncate">{categoryLabel(call.callCategory)}</span>
              </>
            )}
            {call.uploadedAt && (
              <>
                <span>·</span>
                <span>{new Date(call.uploadedAt).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}</span>
              </>
            )}
          </div>
        </div>

        {/* Right metadata */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {duration > 0 && (
            <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
              <RiTimeLine className="w-3 h-3" />
              {formatDuration(duration)}
            </span>
          )}
          {call.sentiment?.overallSentiment && getSentimentBadgeHelper(call.sentiment.overallSentiment)}
          {call.status && <StatusChip status={call.status} />}
          {call.analysis?.performanceScore && (
            <span
              className="text-xs font-medium"
              style={{ color: brightness >= 0.7 ? t.green : brightness <= 0.4 ? t.red : t.inkSoft }}
              title="Performance score"
            >
              {Number(call.analysis.performanceScore).toFixed(1)}
            </span>
          )}
          {hasCoachingFlag && (
            <span title="Coaching flagged" aria-label="Coaching flagged">
              <RiAlertLine className="w-4 h-4 text-amber-500" />
            </span>
          )}
          {hasExceptional && (
            <span title="Exceptional" aria-label="Exceptional">
              <RiAwardLine className="w-4 h-4 text-emerald-500" />
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

const STATUS_LABELS: Record<string, string> = {
  completed: "Completed",
  processing: "Processing",
  pending: "Pending",
  failed: "Failed",
};

const STATUS_CHIP_CLASS: Record<string, string> = {
  completed: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200",
  processing: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200",
  pending: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200",
  failed: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
};

function StatusChip({ status }: { status: string }) {
  // Status chip with inline spinner for in-flight states. We rebuild the
  // badge inline here rather than spreading badge-helpers output because
  // those helpers return rendered <Badge> JSX, not a prop object.
  const Icon =
    status === "completed"
      ? RiCheckLine
      : status === "processing" || status === "pending"
        ? RiLoader4Line
        : status === "failed"
          ? RiCloseLine
          : RiPhoneLine;
  const label = STATUS_LABELS[status] || status.charAt(0).toUpperCase() + status.slice(1);
  const chipClass = STATUS_CHIP_CLASS[status] || "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200";
  return (
    <Badge className={`${chipClass} inline-flex items-center gap-1`}>
      <Icon
        className={`w-3 h-3 ${status === "processing" || status === "pending" ? "animate-spin" : ""}`}
        aria-hidden
      />
      {label}
    </Badge>
  );
}

function FilterSelect({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  ariaLabel: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-9 w-auto min-w-[120px] text-xs" aria-label={ariaLabel}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function categoryLabel(key: string): string {
  const found = CALL_CATEGORIES.find((c) => c.value === key);
  if (found) return found.label;
  return key.replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
