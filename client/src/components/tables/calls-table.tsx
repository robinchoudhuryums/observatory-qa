import { useState, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { HelpTip } from "@/components/ui/help-tip";
import { Badge } from "@/components/ui/badge";
import {
  getSentimentBadge as getSentimentBadgeHelper,
  getStatusBadge as getStatusBadgeHelper,
} from "@/lib/badge-helpers";
import { Link } from "wouter";
import type { CallWithDetails, Employee, AuthUser } from "@shared/schema";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
import { ConfirmDialog } from "@/components/lib/confirm-dialog";
import {
  RiEyeLine,
  RiPlayLine,
  RiDownloadLine,
  RiDeleteBinLine,
  RiUserFollowLine,
  RiAlertLine,
  RiAwardLine,
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiExpandUpDownLine,
  RiArrowUpLine,
  RiArrowDownLine,
  RiCheckboxLine,
  RiCheckboxBlankLine,
  RiFileMusicLine,
  RiShieldKeyholeLine,
  RiFileDownloadLine,
  RiVoiceprintLine,
  RiUploadLine,
  RiPhoneLine,
  RiSearchLine,
  RiCloseLine,
  RiBrainLine,
} from "@remixicon/react";
import { EmptyState } from "@/components/ui/empty-state";

type SortField = "date" | "duration" | "score" | "sentiment";
type SortDir = "asc" | "desc";

const PAGE_SIZE_OPTIONS = [10, 25, 50];

export default function CallsTable() {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sentimentFilter, setSentimentFilter] = useState<string>("all");
  const [employeeFilter, setEmployeeFilter] = useState<string>("all");
  const [scoreFilter, setScoreFilter] = useState<string>("all");
  const [flagFilter, setFlagFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  // Pagination
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);

  // Sorting
  const [sortField, setSortField] = useState<SortField>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Confirm dialog state
  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean; callId?: string; bulk?: boolean }>({
    open: false,
  });

  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: user } = useQuery<AuthUser>({
    queryKey: ["/api/auth/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    staleTime: Infinity,
  });
  const canExport = user?.role === "manager" || user?.role === "admin";

  const { data: calls, isLoading: isLoadingCalls } = useQuery<CallWithDetails[]>({
    queryKey: [
      "/api/calls",
      {
        status: statusFilter === "all" ? "" : statusFilter,
        sentiment: sentimentFilter === "all" ? "" : sentimentFilter,
        employee: employeeFilter === "all" ? "" : employeeFilter,
      },
    ],
  });

  const { data: employees, isLoading: isLoadingEmployees } = useQuery<Employee[]>({
    queryKey: ["/api/employees"],
  });

  const deleteMutation = useMutation({
    mutationFn: (callId: string) => apiRequest("DELETE", `/api/calls/${callId}`),
    onSuccess: () => {
      toast({
        title: "Call Deleted",
        description: "The call recording has been successfully removed.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/calls"] });
    },
    onError: (error) => {
      toast({
        title: "Delete Failed",
        description: error.message || "Could not delete the call.",
        variant: "destructive",
      });
    },
  });

  const assignMutation = useMutation({
    mutationFn: async ({ callId, employeeId }: { callId: string; employeeId: string }) => {
      const res = await apiRequest("PATCH", `/api/calls/${callId}/assign`, { employeeId });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/calls"] });
      toast({ title: "Employee Assigned", description: "Call has been assigned to the selected employee." });
    },
    onError: (error) => {
      toast({ title: "Assignment Failed", description: error.message, variant: "destructive" });
    },
  });

  // Client-side filters (score range, flags, category) applied before sort
  const filteredCalls = useMemo(() => {
    if (!calls) return [];
    return calls.filter((call) => {
      // Score range filter
      if (scoreFilter !== "all" && call.analysis?.performanceScore) {
        const score = Number(call.analysis.performanceScore);
        if (scoreFilter === "high" && score < 8) return false;
        if (scoreFilter === "mid" && (score < 4 || score >= 8)) return false;
        if (scoreFilter === "low" && score >= 4) return false;
      }
      // Flag filter
      if (flagFilter !== "all") {
        const flags = Array.isArray(call.analysis?.flags) ? (call.analysis.flags as string[]) : [];
        if (flagFilter === "flagged" && flags.length === 0) return false;
        if (flagFilter === "unflagged" && flags.length > 0) return false;
        if (flagFilter === "exceptional" && !flags.includes("exceptional_call")) return false;
        if (flagFilter === "low_score" && !flags.includes("low_score")) return false;
        if (flagFilter === "low_confidence" && !flags.includes("low_confidence")) return false;
      }
      // Category filter
      if (categoryFilter !== "all") {
        const category = call.callCategory || (call as any).call_category;
        if (!category || category !== categoryFilter) return false;
      }
      return true;
    });
  }, [calls, scoreFilter, flagFilter, categoryFilter]);

  // Sorted and paginated data
  const sortedCalls = useMemo(() => {
    if (!filteredCalls) return [];
    const sorted = [...filteredCalls].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "date":
          cmp = new Date(a.uploadedAt || 0).getTime() - new Date(b.uploadedAt || 0).getTime();
          break;
        case "duration":
          cmp = (a.duration || 0) - (b.duration || 0);
          break;
        case "score":
          cmp = parseFloat(a.analysis?.performanceScore || "0") - parseFloat(b.analysis?.performanceScore || "0");
          break;
        case "sentiment": {
          const sentOrder: Record<string, number> = { positive: 3, neutral: 2, negative: 1 };
          cmp =
            (sentOrder[a.sentiment?.overallSentiment || ""] || 0) -
            (sentOrder[b.sentiment?.overallSentiment || ""] || 0);
          break;
        }
      }
      return sortDir === "desc" ? -cmp : cmp;
    });
    return sorted;
  }, [filteredCalls, sortField, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sortedCalls.length / pageSize));
  const pagedCalls = sortedCalls.slice(page * pageSize, (page + 1) * pageSize);

  // Reset page when filters change
  const handleFilterChange = (setter: (v: string) => void) => (v: string) => {
    setter(v);
    setPage(0);
    setSelectedIds(new Set());
  };

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("desc");
    }
    setPage(0);
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <RiExpandUpDownLine className="w-3 h-3 ml-1 opacity-40" />;
    return sortDir === "asc" ? (
      <RiArrowUpLine className="w-3 h-3 ml-1" />
    ) : (
      <RiArrowDownLine className="w-3 h-3 ml-1" />
    );
  };

  // Bulk selection helpers
  const allOnPageSelected = pagedCalls.length > 0 && pagedCalls.every((c) => selectedIds.has(c.id));
  const toggleAll = () => {
    if (allOnPageSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(pagedCalls.map((c) => c.id)));
    }
  };
  const toggleOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBulkDelete = () => {
    if (selectedIds.size === 0) return;
    setDeleteConfirm({ open: true, bulk: true });
  };

  const confirmBulkDelete = async () => {
    const ids = Array.from(selectedIds);
    setSelectedIds(new Set());
    setDeleteConfirm({ open: false });
    try {
      await Promise.all(ids.map((id) => apiRequest("DELETE", `/api/calls/${id}`)));
      toast({ title: "Calls Deleted", description: `${ids.length} call(s) deleted successfully.` });
    } catch {
      toast({ title: "Delete Failed", description: "Some calls could not be deleted.", variant: "destructive" });
    }
    queryClient.invalidateQueries({ queryKey: ["/api/calls"] });
  };

  const handleBulkAssign = async (employeeId: string) => {
    const ids = Array.from(selectedIds);
    setSelectedIds(new Set());
    try {
      await Promise.all(ids.map((callId) => apiRequest("PATCH", `/api/calls/${callId}/assign`, { employeeId })));
      toast({ title: "Calls Assigned", description: `${ids.length} call(s) assigned.` });
    } catch {
      toast({ title: "Assignment Failed", description: "Some calls could not be assigned.", variant: "destructive" });
    }
    queryClient.invalidateQueries({ queryKey: ["/api/calls"] });
  };

  const handleDelete = (callId: string) => {
    setDeleteConfirm({ open: true, callId });
  };

  const confirmDelete = () => {
    if (deleteConfirm.callId) {
      deleteMutation.mutate(deleteConfirm.callId);
    }
    setDeleteConfirm({ open: false });
  };

  if (isLoadingCalls || isLoadingEmployees) {
    return (
      <div className="bg-card rounded-lg border border-border p-6">
        <div className="flex items-center justify-between mb-4">
          <Skeleton className="h-6 w-32" />
          <div className="flex gap-2">
            <Skeleton className="h-9 w-36" />
            <Skeleton className="h-9 w-36" />
          </div>
        </div>
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 py-3 border-b border-border last:border-0">
              <Skeleton className="h-4 w-4" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-8 w-8 rounded-full" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-12" />
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="h-8 w-24" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const getSentimentBadge = getSentimentBadgeHelper;
  const getStatusBadge = getStatusBadgeHelper;

  return (
    <div className="bg-card rounded-lg border border-border p-6" data-testid="calls-table">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-semibold text-foreground flex items-center gap-1">
            Recent Calls
            <HelpTip text="All uploaded call recordings sorted by date. Use filters to narrow by employee, sentiment, or status. Click a row to view the full transcript and AI analysis." />
            {[statusFilter, sentimentFilter, employeeFilter, scoreFilter, flagFilter, categoryFilter].filter(
              (v) => v !== "all",
            ).length > 0 && (
              <Badge variant="secondary" className="text-xs ml-2">
                {
                  [statusFilter, sentimentFilter, employeeFilter, scoreFilter, flagFilter, categoryFilter].filter(
                    (v) => v !== "all",
                  ).length
                }{" "}
                active
              </Badge>
            )}
          </h3>
          <span className="text-xs text-muted-foreground">{sortedCalls.length} total</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canExport && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const link = document.createElement("a");
                link.href = "/api/export/calls";
                link.download = "";
                link.click();
              }}
            >
              <RiFileDownloadLine className="w-4 h-4 mr-1.5" />
              CSV
            </Button>
          )}
          <Select value={statusFilter} onValueChange={handleFilterChange(setStatusFilter)}>
            <SelectTrigger className="w-40" data-testid="status-filter" aria-label="Filter by status">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="processing">Processing</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>
          <Select value={employeeFilter} onValueChange={handleFilterChange(setEmployeeFilter)}>
            <SelectTrigger className="w-40" data-testid="employee-filter" aria-label="Filter by employee">
              <SelectValue placeholder="All Employees" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Employees</SelectItem>
              {employees?.map((employee) => (
                <SelectItem key={employee.id} value={employee.id}>
                  {employee.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={sentimentFilter} onValueChange={handleFilterChange(setSentimentFilter)}>
            <SelectTrigger className="w-40" data-testid="sentiment-filter" aria-label="Filter by sentiment">
              <SelectValue placeholder="All Sentiment" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Sentiment</SelectItem>
              <SelectItem value="positive">Positive</SelectItem>
              <SelectItem value="neutral">Neutral</SelectItem>
              <SelectItem value="negative">Negative</SelectItem>
            </SelectContent>
          </Select>
          <Select value={scoreFilter} onValueChange={handleFilterChange(setScoreFilter)}>
            <SelectTrigger className="w-40" data-testid="score-filter" aria-label="Filter by score">
              <SelectValue placeholder="All Scores" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Scores</SelectItem>
              <SelectItem value="high">High (8-10)</SelectItem>
              <SelectItem value="mid">Mid (4-7.9)</SelectItem>
              <SelectItem value="low">Low (0-3.9)</SelectItem>
            </SelectContent>
          </Select>
          <Select value={flagFilter} onValueChange={handleFilterChange(setFlagFilter)}>
            <SelectTrigger className="w-40" data-testid="flag-filter" aria-label="Filter by flag">
              <SelectValue placeholder="All Flags" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Flags</SelectItem>
              <SelectItem value="flagged">Flagged</SelectItem>
              <SelectItem value="unflagged">Unflagged</SelectItem>
              <SelectItem value="exceptional">Exceptional</SelectItem>
              <SelectItem value="low_score">Low Score</SelectItem>
              <SelectItem value="low_confidence">Low Confidence</SelectItem>
            </SelectContent>
          </Select>
          {(statusFilter !== "all" ||
            sentimentFilter !== "all" ||
            employeeFilter !== "all" ||
            scoreFilter !== "all" ||
            flagFilter !== "all" ||
            categoryFilter !== "all") && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setStatusFilter("all");
                setSentimentFilter("all");
                setEmployeeFilter("all");
                setScoreFilter("all");
                setFlagFilter("all");
                setCategoryFilter("all");
                setPage(0);
                setSelectedIds(new Set());
              }}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              <RiCloseLine className="w-3.5 h-3.5 mr-1" />
              Clear filters
            </Button>
          )}
        </div>
      </div>

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="bg-primary/5 border border-primary/20 rounded-lg px-4 py-2 mb-3 flex items-center gap-3">
          <span className="text-sm font-medium">{selectedIds.size} selected</span>
          <Select onValueChange={handleBulkAssign}>
            <SelectTrigger className="w-44 h-8 text-xs">
              <SelectValue placeholder="Assign to..." />
            </SelectTrigger>
            <SelectContent>
              {employees
                ?.filter((e) => e.status === "Active")
                .map((emp) => (
                  <SelectItem key={emp.id} value={emp.id}>
                    {emp.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <Button size="sm" variant="destructive" className="h-8 text-xs" onClick={handleBulkDelete}>
            <RiDeleteBinLine className="w-3 h-3 mr-1" /> Delete Selected
          </Button>
          <Button size="sm" variant="ghost" className="h-8 text-xs ml-auto" onClick={() => setSelectedIds(new Set())}>
            Clear Selection
          </Button>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[700px]">
          <thead>
            <tr className="border-b border-border">
              <th className="py-3 px-2 w-8">
                <button
                  onClick={toggleAll}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label={allOnPageSelected ? "Deselect all calls" : "Select all calls"}
                >
                  {allOnPageSelected ? (
                    <RiCheckboxLine className="w-4 h-4" />
                  ) : (
                    <RiCheckboxBlankLine className="w-4 h-4" />
                  )}
                </button>
              </th>
              <th className="text-left py-3 px-2 font-medium text-muted-foreground">
                <button
                  className="flex items-center hover:text-foreground"
                  onClick={() => toggleSort("date")}
                  aria-label="Sort by date"
                >
                  Date <SortIcon field="date" />
                </button>
              </th>
              <th className="text-left py-3 px-2 font-medium text-muted-foreground">Employee</th>
              <th className="text-left py-3 px-2 font-medium text-muted-foreground">
                <button
                  className="flex items-center hover:text-foreground"
                  onClick={() => toggleSort("duration")}
                  aria-label="Sort by duration"
                >
                  Duration <SortIcon field="duration" />
                </button>
              </th>
              <th className="text-left py-3 px-2 font-medium text-muted-foreground">
                <button
                  className="flex items-center hover:text-foreground"
                  onClick={() => toggleSort("sentiment")}
                  aria-label="Sort by sentiment"
                >
                  Sentiment <SortIcon field="sentiment" />
                </button>
              </th>
              <th className="text-left py-3 px-2 font-medium text-muted-foreground">
                <button
                  className="flex items-center hover:text-foreground"
                  onClick={() => toggleSort("score")}
                  aria-label="Sort by score"
                >
                  Score <SortIcon field="score" />
                </button>
              </th>
              <th className="text-left py-3 px-2 font-medium text-muted-foreground">Party</th>
              <th className="text-left py-3 px-2 font-medium text-muted-foreground">Status</th>
              <th className="text-left py-3 px-2 font-medium text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            {pagedCalls.map((call, rowIdx) => (
              <tr
                key={call.id}
                className={`border-b border-border hover:bg-muted transition-colors animate-row ${selectedIds.has(call.id) ? "bg-primary/5" : ""}`}
                style={{ animationDelay: `${rowIdx * 30}ms` }}
              >
                <td className="py-3 px-2">
                  <button
                    onClick={() => toggleOne(call.id)}
                    className="text-muted-foreground hover:text-foreground"
                    aria-label={selectedIds.has(call.id) ? "Deselect call" : "Select call"}
                  >
                    {selectedIds.has(call.id) ? (
                      <RiCheckboxLine className="w-4 h-4 text-primary" />
                    ) : (
                      <RiCheckboxBlankLine className="w-4 h-4" />
                    )}
                  </button>
                </td>
                <td className="py-3 px-2">
                  <div>
                    <p className="font-medium text-foreground">
                      {new Date(call.uploadedAt || "").toLocaleDateString()}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(call.uploadedAt || "").toLocaleTimeString()}
                    </p>
                  </div>
                </td>
                <td className="py-3 px-2">
                  {call.employee ? (
                    <div className="flex items-center space-x-2">
                      <div className="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center">
                        <span className="text-primary font-semibold text-xs">{call.employee.initials ?? "N/A"}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="font-medium">{call.employee.name ?? "Unknown"}</span>
                        <Select
                          onValueChange={(empId) => assignMutation.mutate({ callId: call.id, employeeId: empId })}
                          disabled={assignMutation.isPending}
                        >
                          <SelectTrigger className="w-7 h-7 p-0 border-0 bg-transparent">
                            <RiUserFollowLine className="w-3 h-3 text-muted-foreground" />
                          </SelectTrigger>
                          <SelectContent>
                            {employees
                              ?.filter((e) => e.status === "Active")
                              .map((emp) => (
                                <SelectItem key={emp.id} value={emp.id}>
                                  {emp.name}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  ) : (
                    <Select
                      onValueChange={(empId) => assignMutation.mutate({ callId: call.id, employeeId: empId })}
                      disabled={assignMutation.isPending}
                    >
                      <SelectTrigger className="w-40 border-dashed text-muted-foreground">
                        <SelectValue placeholder="Assign employee" />
                      </SelectTrigger>
                      <SelectContent>
                        {employees
                          ?.filter((e) => e.status === "Active")
                          .map((emp) => (
                            <SelectItem key={emp.id} value={emp.id}>
                              {emp.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  )}
                </td>
                <td className="py-3 px-2 text-muted-foreground">
                  {call.duration ? `${Math.floor(call.duration / 60)}m ${call.duration % 60}s` : "-"}
                </td>
                <td className="py-3 px-2">{getSentimentBadge(call.sentiment?.overallSentiment)}</td>
                <td className="px-4 py-3">
                  {call.analysis?.performanceScore &&
                    (() => {
                      const score = Number(call.analysis.performanceScore);
                      const aiCompleted = !(
                        call.analysis.confidenceFactors &&
                        typeof call.analysis.confidenceFactors === "object" &&
                        (call.analysis.confidenceFactors as Record<string, unknown>).aiAnalysisCompleted === false
                      );
                      const scoreColor =
                        score >= 9
                          ? "text-emerald-600"
                          : score >= 7
                            ? "text-green-600"
                            : score >= 4
                              ? "text-amber-600"
                              : "text-red-600";
                      const scoreBarColor =
                        score >= 9
                          ? "bg-emerald-500"
                          : score >= 7
                            ? "bg-green-500"
                            : score >= 4
                              ? "bg-amber-500"
                              : "bg-red-500";
                      return (
                        <>
                          <div className="flex items-center gap-1.5">
                            <span className={`text-sm font-bold tabular-nums ${scoreColor}`}>{score.toFixed(1)}</span>
                            {!aiCompleted && (
                              <span
                                className="w-1.5 h-1.5 rounded-full bg-amber-400"
                                title="AI analysis incomplete — scores may be approximate"
                              />
                            )}
                          </div>
                          <div className="w-full h-1 bg-muted rounded-full mt-1 overflow-hidden">
                            <div
                              className={`h-full rounded-full ${scoreBarColor}`}
                              style={{ width: `${score * 10}%` }}
                            />
                          </div>
                        </>
                      );
                    })()}
                </td>
                <td className="py-3 px-2">
                  {call.analysis?.callPartyType ? (
                    <Badge variant="outline" className="text-xs capitalize">
                      {(call.analysis.callPartyType as string).replace(/_/g, " ")}
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground text-xs">—</span>
                  )}
                </td>
                <td className="py-3 px-2">
                  <div className="flex items-center gap-1.5">
                    {getStatusBadge(call.status)}
                    {call.analysis?.flags &&
                      Array.isArray(call.analysis.flags) &&
                      (call.analysis.flags as string[]).length > 0 &&
                      (() => {
                        const flags = call.analysis.flags as string[];
                        const hasExceptional = flags.includes("exceptional_call");
                        const hasBad = flags.some((f) => f === "low_score" || f.startsWith("agent_misconduct"));
                        const hasLowConfidence = flags.includes("low_confidence");
                        return (
                          <>
                            {hasExceptional && (
                              <span title="Exceptional Call">
                                <RiAwardLine className="w-4 h-4 text-emerald-500" />
                              </span>
                            )}
                            {hasBad && (
                              <span
                                title={flags
                                  .filter(
                                    (f) => f !== "exceptional_call" && f !== "medicare_call" && f !== "low_confidence",
                                  )
                                  .join(", ")}
                              >
                                <RiAlertLine className="w-4 h-4 text-red-500" />
                              </span>
                            )}
                            {!hasExceptional && !hasBad && flags.includes("medicare_call") && (
                              <span title="Medicare Call">
                                <RiAlertLine className="w-4 h-4 text-blue-500" />
                              </span>
                            )}
                            {hasLowConfidence && (
                              <span title="Low AI Confidence — may need manual review">
                                <RiShieldKeyholeLine className="w-4 h-4 text-yellow-500" />
                              </span>
                            )}
                          </>
                        );
                      })()}
                  </div>
                </td>
                <td className="py-3 px-2">
                  <div className="flex items-center space-x-2">
                    <Link href={`/transcripts/${call.id}`}>
                      <Button size="sm" variant="ghost" disabled={call.status !== "completed"}>
                        <RiEyeLine className="w-4 h-4" />
                      </Button>
                    </Link>
                    <Link href={`/transcripts/${call.id}`}>
                      <Button size="sm" variant="ghost" disabled={call.status !== "completed"} title="Play audio">
                        <RiPlayLine className="w-4 h-4" />
                      </Button>
                    </Link>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={call.status !== "completed"}
                      title="Download audio"
                      onClick={() => window.open(`/api/calls/${call.id}/audio?download=true`, "_blank")}
                    >
                      <RiDownloadLine className="w-4 h-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-red-500 hover:text-red-600"
                      onClick={() => handleDelete(call.id)}
                      disabled={deleteMutation.isPending}
                    >
                      <RiDeleteBinLine className="w-4 h-4" />
                    </Button>
                  </div>
                </td>
              </tr>
            )) ?? []}
          </tbody>
        </table>
      </div>

      {/* Pagination Controls */}
      {sortedCalls.length > 0 && (
        <div className="flex items-center justify-between mt-4 pt-4 border-t border-border">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>Rows per page:</span>
            <Select
              value={String(pageSize)}
              onValueChange={(v) => {
                setPageSize(Number(v));
                setPage(0);
              }}
            >
              <SelectTrigger className="w-16 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_OPTIONS.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="ml-2">
              {page * pageSize + 1}–{Math.min((page + 1) * pageSize, sortedCalls.length)} of {sortedCalls.length}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              <RiArrowLeftSLine className="w-4 h-4" />
            </Button>
            {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
              const pageNum = totalPages <= 5 ? i : Math.max(0, Math.min(page - 2, totalPages - 5)) + i;
              return (
                <Button
                  key={pageNum}
                  size="sm"
                  variant={page === pageNum ? "default" : "ghost"}
                  className="w-8 h-8 p-0 text-xs"
                  onClick={() => setPage(pageNum)}
                >
                  {pageNum + 1}
                </Button>
              );
            })}
            <Button size="sm" variant="ghost" disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>
              <RiArrowRightSLine className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={deleteConfirm.open}
        onOpenChange={(open) => setDeleteConfirm({ open })}
        title={deleteConfirm.bulk ? `Delete ${selectedIds.size} call(s)?` : "Delete this call?"}
        description={
          deleteConfirm.bulk
            ? `This will permanently remove ${selectedIds.size} call recording(s) and all associated data. This action cannot be undone.`
            : "This will permanently remove this call recording and all its data. This action cannot be undone."
        }
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={deleteConfirm.bulk ? confirmBulkDelete : confirmDelete}
      />

      {sortedCalls.length === 0 &&
        (statusFilter !== "all" ||
          sentimentFilter !== "all" ||
          employeeFilter !== "all" ||
          scoreFilter !== "all" ||
          flagFilter !== "all" ||
          categoryFilter !== "all") && (
          <EmptyState
            compact
            icon={RiSearchLine}
            title="No matching calls"
            description="Try adjusting your filters or search criteria."
            action={{
              label: "Clear Filters",
              onClick: () => {
                setStatusFilter("all");
                setSentimentFilter("all");
                setEmployeeFilter("all");
                setScoreFilter("all");
                setFlagFilter("all");
                setCategoryFilter("all");
                setPage(0);
              },
            }}
          />
        )}

      {!calls?.length && statusFilter === "all" && sentimentFilter === "all" && employeeFilter === "all" && (
        <EmptyState
          icon={RiPhoneLine}
          title="No calls analyzed yet"
          description="Upload your first call recording to see performance metrics, sentiment analysis, and AI-powered coaching insights."
          action={{ label: "Upload Your First Call", href: "/upload", icon: RiUploadLine }}
        />
      )}
    </div>
  );
}
