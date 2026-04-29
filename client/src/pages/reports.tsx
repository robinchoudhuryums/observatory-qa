import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { csrfFetch } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import type { Employee } from "@shared/schema";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { useAppName } from "@/hooks/use-organization";
import { HelpTip } from "@/components/ui/help-tip";
import OwlLoading from "@/components/owl-loading";
import {
  RiDownloadLine,
  RiBarChartLine,
  RiBarChartBoxLine,
  RiEmotionLine,
  RiStarLine,
  RiUserLine,
  RiTeamLine,
  RiArrowRightUpLine,
  RiCalendarLine,
  RiArrowRightLine,
  RiVoiceprintLine,
  RiPhoneLine,
  RiEqualizerLine,
  RiShieldLine,
  RiChat1Line,
  RiHeadphoneLine,
  RiCheckboxCircleLine,
  RiUploadLine,
} from "@remixicon/react";
import { MetricCard, SubScoreCard } from "./reports/components";
import { AgentProfileSection } from "./reports/AgentProfileSection";
import { getDateRange, formatMonth, PRESET_LABELS } from "./reports/helpers";
import type { ReportType, DatePreset, FilteredReportData, AgentProfileData } from "./reports/types";

// ---- Component ----

export default function ReportsPage() {
  // RiCheckLine for employee param in URL (from sidebar quick-switch)
  const urlParams = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  const initialEmployee = urlParams?.get("employee") || "";

  // Report config state
  const [reportType, setReportType] = useState<ReportType>(initialEmployee ? "employee" : "overall");
  const [datePreset, setDatePreset] = useState<DatePreset>("last90");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [selectedEmployee, setSelectedEmployee] = useState(initialEmployee);
  const [selectedDepartment, setSelectedDepartment] = useState("");
  const [callPartyFilter, setCallPartyFilter] = useState("all");
  const appName = useAppName();

  // Comparison state
  const [compareEnabled, setCompareEnabled] = useState(false);
  const [compareDatePreset, setCompareDatePreset] = useState<DatePreset>("lastYear");
  const [compareCustomFrom, setCompareCustomFrom] = useState("");
  const [compareCustomTo, setCompareCustomTo] = useState("");

  // AI summary state
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  // Granular detail toggle
  const [showDetailedScores, setShowDetailedScores] = useState(false);

  const dateRange = getDateRange(datePreset, customFrom, customTo);
  const compareDateRange = getDateRange(compareDatePreset, compareCustomFrom, compareCustomTo);

  // Fetch employees for selectors
  const { data: employees } = useQuery<Employee[]>({ queryKey: ["/api/employees"] });

  const departments = useMemo(() => {
    if (!employees) return [];
    const set = new Set<string>();
    for (const emp of employees) {
      if (emp.role) set.add(emp.role);
    }
    return Array.from(set).sort();
  }, [employees]);

  // Build query params for filtered report
  const buildParams = (range: { from: string; to: string }) => {
    const params = new URLSearchParams({ from: range.from, to: range.to });
    if (reportType === "employee" && selectedEmployee) params.set("employeeId", selectedEmployee);
    if (reportType === "department" && selectedDepartment) params.set("department", selectedDepartment);
    if (callPartyFilter !== "all") params.set("callPartyType", callPartyFilter);
    return params.toString();
  };

  // AI summary mutation
  const summaryMutation = useMutation({
    mutationFn: async () => {
      const res = await csrfFetch(`/api/reports/agent-summary/${selectedEmployee}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: dateRange.from, to: dateRange.to }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to generate summary");
      }
      return res.json();
    },
    onSuccess: (data: { summary: string }) => {
      setAiSummary(data.summary);
    },
  });

  // Primary data
  const primaryQueryKey = ["/api/reports/filtered", buildParams(dateRange)];
  const {
    data: report,
    isLoading,
    error: reportError,
  } = useQuery<FilteredReportData>({
    queryKey: primaryQueryKey,
    queryFn: async () => {
      const res = await fetch(`/api/reports/filtered?${buildParams(dateRange)}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch report");
      return res.json();
    },
  });

  // Comparison data
  const compareQueryKey = ["/api/reports/filtered", buildParams(compareDateRange), "compare"];
  const { data: compareReport, isLoading: isCompareLoading } = useQuery<FilteredReportData>({
    queryKey: compareQueryKey,
    queryFn: async () => {
      const res = await fetch(`/api/reports/filtered?${buildParams(compareDateRange)}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch comparison report");
      return res.json();
    },
    enabled: compareEnabled,
  });

  // Agent profile (only for employee report type)
  const { data: agentProfile } = useQuery<AgentProfileData>({
    queryKey: ["/api/reports/agent-profile", selectedEmployee, dateRange.from, dateRange.to],
    queryFn: async () => {
      const params = new URLSearchParams({ from: dateRange.from, to: dateRange.to });
      const res = await fetch(`/api/reports/agent-profile/${selectedEmployee}?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch agent profile");
      return res.json();
    },
    enabled: reportType === "employee" && !!selectedEmployee,
  });

  // RiDownloadLine handler
  const handleDownloadReport = () => {
    if (!report) return;
    const lines: string[] = [];
    const typeLabel =
      reportType === "employee"
        ? `Employee Report: ${employees?.find((e) => e.id === selectedEmployee)?.name || selectedEmployee}`
        : reportType === "department"
          ? `Department Report: ${selectedDepartment}`
          : "Overall Report";

    lines.push(`${appName} Performance Report`);
    lines.push("===============================");
    lines.push(`Type: ${typeLabel}`);
    lines.push(`Period: ${dateRange.from} to ${dateRange.to} (${PRESET_LABELS[datePreset]})`);
    lines.push(`Generated: ${new Date().toLocaleString()}`);
    lines.push("");
    lines.push("Overall Metrics");
    lines.push("---------------");
    lines.push(`Total Calls Analyzed: ${report.metrics.totalCalls}`);
    lines.push(`Average Sentiment Score: ${report.metrics.avgSentiment.toFixed(2)}`);
    lines.push(`Average Performance Score: ${report.metrics.avgPerformanceScore.toFixed(1)}/10`);
    lines.push("");
    lines.push("Sentiment Breakdown");
    lines.push("-------------------");
    lines.push(`Positive: ${report.sentiment.positive}`);
    lines.push(`Neutral: ${report.sentiment.neutral}`);
    lines.push(`Negative: ${report.sentiment.negative}`);
    lines.push("");
    lines.push("Performers");
    lines.push("----------");
    report.performers.forEach((p, i) => {
      lines.push(
        `${i + 1}. ${p.name} — ${p.avgPerformanceScore != null ? Number(p.avgPerformanceScore).toFixed(1) : "N/A"}/10 (${p.totalCalls} calls)`,
      );
    });

    if (agentProfile && reportType === "employee") {
      lines.push("");
      lines.push("Agent Profile Summary");
      lines.push("---------------------");
      lines.push(
        `Score Range: ${agentProfile.lowScore?.toFixed(1) ?? "N/A"} - ${agentProfile.highScore?.toFixed(1) ?? "N/A"}`,
      );
      lines.push("");
      lines.push("Top Strengths:");
      agentProfile.topStrengths.forEach((s) => lines.push(`  - ${s.text} (x${s.count})`));
      lines.push("");
      lines.push("Top Suggestions:");
      agentProfile.topSuggestions.forEach((s) => lines.push(`  - ${s.text} (x${s.count})`));
    }

    if (aiSummary) {
      lines.push("");
      lines.push("AI-Generated Summary");
      lines.push("--------------------");
      lines.push(aiSummary);
    }

    if (compareEnabled && compareReport) {
      lines.push("");
      lines.push(`Comparison Period: ${compareDateRange.from} to ${compareDateRange.to}`);
      lines.push("---------------------------------------------------");
      lines.push(`Total Calls: ${compareReport.metrics.totalCalls}`);
      lines.push(`Avg Performance: ${compareReport.metrics.avgPerformanceScore.toFixed(1)}/10`);
      lines.push(`Avg Sentiment: ${compareReport.metrics.avgSentiment.toFixed(2)}`);
    }

    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `report-${reportType}-${dateRange.from}-to-${dateRange.to}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Delta helper for comparison
  const delta = (current: number, previous: number | undefined) => {
    if (previous === undefined || previous === 0) return null;
    const diff = current - previous;
    const pct = ((diff / previous) * 100).toFixed(1);
    return { diff, pct, positive: diff > 0 };
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <OwlLoading text="Analyzing performance..." size={48} />
      </div>
    );
  }

  if (reportError) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
        <RiBarChartBoxLine className="w-12 h-12 mb-3 text-muted-foreground/50" />
        <p className="font-semibold text-foreground">No report data yet</p>
        <p className="text-sm mt-1">Upload and analyze some calls first, then come back to view reports.</p>
        <Button variant="outline" className="mt-4" onClick={() => (window.location.href = "/upload")}>
          <RiUploadLine className="w-4 h-4 mr-2" /> Upload Calls
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen" data-testid="reports-page">
      <header className="bg-card border-b border-border px-6 py-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-foreground flex items-center gap-2">
            Performance Reports
            <HelpTip text="Generate performance reports by time period, employee, or department. Use date presets for quick filtering. Export to CSV for offline analysis. Click an agent name to see their full profile with call history." />
          </h2>
          <p className="text-muted-foreground">Filter by time period, employee, or department.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const params = new URLSearchParams();
              if (dateRange.from) params.set("from", dateRange.from);
              if (dateRange.to) params.set("to", dateRange.to);
              if (selectedEmployee) params.set("employeeId", selectedEmployee);
              const link = document.createElement("a");
              link.href = `/api/export/calls?${params}`;
              link.download = "";
              link.click();
            }}
          >
            <RiDownloadLine className="w-4 h-4 mr-2" />
            Export CSV
          </Button>
          <Button onClick={handleDownloadReport} disabled={!report}>
            <RiDownloadLine className="w-4 h-4 mr-2" />
            Download Report
          </Button>
        </div>
      </header>

      {/* Filters Bar */}
      <div className="bg-card border-b border-border px-6 py-4">
        <div className="flex flex-wrap gap-4 items-end">
          {/* Report Type */}
          <div className="min-w-[160px]">
            <Label className="text-xs text-muted-foreground">Report Type</Label>
            <Select value={reportType} onValueChange={(v) => setReportType(v as ReportType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="overall">
                  <span className="flex items-center gap-1.5">
                    <RiBarChartLine className="w-3.5 h-3.5" /> Overall
                  </span>
                </SelectItem>
                <SelectItem value="employee">
                  <span className="flex items-center gap-1.5">
                    <RiUserLine className="w-3.5 h-3.5" /> Individual Employee
                  </span>
                </SelectItem>
                <SelectItem value="department">
                  <span className="flex items-center gap-1.5">
                    <RiTeamLine className="w-3.5 h-3.5" /> Department
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Employee selector */}
          {reportType === "employee" && (
            <div className="min-w-[200px]">
              <Label className="text-xs text-muted-foreground">Employee</Label>
              <Select value={selectedEmployee} onValueChange={setSelectedEmployee}>
                <SelectTrigger>
                  <SelectValue placeholder="Select employee" />
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
          )}

          {/* Department selector */}
          {reportType === "department" && (
            <div className="min-w-[200px]">
              <Label className="text-xs text-muted-foreground">Department</Label>
              <Select value={selectedDepartment} onValueChange={setSelectedDepartment}>
                <SelectTrigger>
                  <SelectValue placeholder="Select department" />
                </SelectTrigger>
                <SelectContent>
                  {departments.map((dept) => (
                    <SelectItem key={dept} value={dept}>
                      {dept}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Call Party Type */}
          <div className="min-w-[160px]">
            <Label className="text-xs text-muted-foreground">Call Party</Label>
            <Select value={callPartyFilter} onValueChange={setCallPartyFilter}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  <span className="flex items-center gap-1.5">
                    <RiPhoneLine className="w-3.5 h-3.5" /> All Parties
                  </span>
                </SelectItem>
                <SelectItem value="customer">Customer</SelectItem>
                <SelectItem value="insurance">Insurance</SelectItem>
                <SelectItem value="medical_facility">Medical Facility</SelectItem>
                <SelectItem value="medicare">Medicare</SelectItem>
                <SelectItem value="vendor">Vendor</SelectItem>
                <SelectItem value="internal">Internal</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Date Preset */}
          <div className="min-w-[160px]">
            <Label className="text-xs text-muted-foreground">Time Period</Label>
            <Select value={datePreset} onValueChange={(v) => setDatePreset(v as DatePreset)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="last30">Last 30 Days</SelectItem>
                <SelectItem value="last90">Last 90 Days</SelectItem>
                <SelectItem value="ytd">Year to Date</SelectItem>
                <SelectItem value="lastYear">Last Year</SelectItem>
                <SelectItem value="custom">Custom Range</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Custom dates */}
          {datePreset === "custom" && (
            <>
              <div>
                <Label className="text-xs text-muted-foreground">From</Label>
                <Input
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="w-[150px]"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">To</Label>
                <Input
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="w-[150px]"
                />
              </div>
            </>
          )}

          {/* Compare toggle */}
          <div className="ml-auto">
            <Button
              variant={compareEnabled ? "default" : "outline"}
              size="sm"
              onClick={() => setCompareEnabled(!compareEnabled)}
            >
              <RiCalendarLine className="w-3.5 h-3.5 mr-1.5" />
              {compareEnabled ? "Comparing" : "Compare Periods"}
            </Button>
          </div>
        </div>

        {/* Comparison row */}
        {compareEnabled && (
          <div className="flex flex-wrap gap-4 items-end mt-3 pt-3 border-t border-border">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <RiArrowRightLine className="w-4 h-4" />
              Compare to:
            </div>
            <div className="min-w-[160px]">
              <Select value={compareDatePreset} onValueChange={(v) => setCompareDatePreset(v as DatePreset)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="last30">Last 30 Days</SelectItem>
                  <SelectItem value="last90">Last 90 Days</SelectItem>
                  <SelectItem value="ytd">Year to Date</SelectItem>
                  <SelectItem value="lastYear">Last Year</SelectItem>
                  <SelectItem value="custom">Custom Range</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {compareDatePreset === "custom" && (
              <>
                <div>
                  <Input
                    type="date"
                    value={compareCustomFrom}
                    onChange={(e) => setCompareCustomFrom(e.target.value)}
                    className="w-[150px]"
                  />
                </div>
                <div>
                  <Input
                    type="date"
                    value={compareCustomTo}
                    onChange={(e) => setCompareCustomTo(e.target.value)}
                    className="w-[150px]"
                  />
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <main className="p-6 space-y-6">
        {/* Empty state when no calls match filters */}
        {report && report.metrics.totalCalls === 0 && (
          <div className="bg-card rounded-lg border border-border p-12 text-center">
            <RiBarChartLine className="w-12 h-12 text-muted-foreground/40 mx-auto mb-3" />
            <h3 className="text-lg font-semibold text-foreground mb-1">No data for this period</h3>
            <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
              No calls match the selected filters. Try adjusting the time period
              {reportType === "employee" ? ", employee selection," : ""} or report type.
            </p>
          </div>
        )}

        {/* Metrics Cards */}
        {report && report.metrics.totalCalls > 0 && (
          <>
            <div className="bg-card rounded-lg border border-border p-6">
              <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center">
                <RiBarChartLine className="w-5 h-5 mr-2" />
                Metrics — {PRESET_LABELS[datePreset]}
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
                <MetricCard
                  label="Total Calls Analyzed"
                  value={report?.metrics.totalCalls ?? 0}
                  format="int"
                  compareValue={compareEnabled && !isCompareLoading ? compareReport?.metrics.totalCalls : undefined}
                  delta={
                    compareEnabled && !isCompareLoading
                      ? delta(report?.metrics.totalCalls ?? 0, compareReport?.metrics.totalCalls)
                      : null
                  }
                />
                <MetricCard
                  label="Average Sentiment Score"
                  value={report?.metrics.avgSentiment ?? 0}
                  format="sentiment"
                  color="text-blue-500"
                  compareValue={compareEnabled && !isCompareLoading ? compareReport?.metrics.avgSentiment : undefined}
                  delta={
                    compareEnabled && !isCompareLoading
                      ? delta(report?.metrics.avgSentiment ?? 0, compareReport?.metrics.avgSentiment)
                      : null
                  }
                />
                <MetricCard
                  label="Average Performance Score"
                  value={report?.metrics.avgPerformanceScore ?? 0}
                  format="score"
                  color="text-green-500"
                  compareValue={
                    compareEnabled && !isCompareLoading ? compareReport?.metrics.avgPerformanceScore : undefined
                  }
                  delta={
                    compareEnabled && !isCompareLoading
                      ? delta(report?.metrics.avgPerformanceScore ?? 0, compareReport?.metrics.avgPerformanceScore)
                      : null
                  }
                />
                {compareEnabled && isCompareLoading && (
                  <div className="col-span-3 text-center text-sm text-muted-foreground">
                    <RiVoiceprintLine className="w-4 h-4 animate-spin inline mr-2" />
                    Loading comparison data...
                  </div>
                )}
              </div>
            </div>

            {/* Detailed Sub-Scores (toggleable) */}
            {report?.avgSubScores && (
              <div className="bg-card rounded-lg border border-border p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-foreground flex items-center">
                    <RiEqualizerLine className="w-5 h-5 mr-2" />
                    Score Breakdown
                  </h3>
                  <Button
                    variant={showDetailedScores ? "default" : "outline"}
                    size="sm"
                    onClick={() => setShowDetailedScores(!showDetailedScores)}
                  >
                    {showDetailedScores ? "Hide Details" : "Show Details"}
                  </Button>
                </div>
                {showDetailedScores && (
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <SubScoreCard
                      icon={RiShieldLine}
                      label="Compliance"
                      score={report.avgSubScores.compliance}
                      color="text-blue-600"
                      barColor="from-blue-500 to-blue-400"
                    />
                    <SubScoreCard
                      icon={RiHeadphoneLine}
                      label="Customer Experience"
                      score={report.avgSubScores.customerExperience}
                      color="text-green-600"
                      barColor="from-green-500 to-emerald-400"
                    />
                    <SubScoreCard
                      icon={RiChat1Line}
                      label="Communication"
                      score={report.avgSubScores.communication}
                      color="text-purple-600"
                      barColor="from-purple-500 to-violet-400"
                    />
                    <SubScoreCard
                      icon={RiCheckboxCircleLine}
                      label="Resolution"
                      score={report.avgSubScores.resolution}
                      color="text-amber-600"
                      barColor="from-amber-500 to-yellow-400"
                    />
                  </div>
                )}
                {!showDetailedScores && (
                  <div className="flex gap-6">
                    {[
                      { label: "Compliance", value: report.avgSubScores.compliance, color: "text-blue-600" },
                      {
                        label: "Customer Exp.",
                        value: report.avgSubScores.customerExperience,
                        color: "text-green-600",
                      },
                      { label: "Communication", value: report.avgSubScores.communication, color: "text-purple-600" },
                      { label: "Resolution", value: report.avgSubScores.resolution, color: "text-amber-600" },
                    ].map((s) => (
                      <div key={s.label} className="text-center">
                        <p className="text-xs text-muted-foreground">{s.label}</p>
                        <p className={`text-lg font-bold ${s.color}`}>{s.value.toFixed(1)}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Trend Chart */}
            {report?.trends && report.trends.length > 0 && (
              <div className="bg-card rounded-lg border border-border p-6">
                <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center">
                  <RiArrowRightUpLine className="w-5 h-5 mr-2" />
                  Performance Trend
                </h3>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={report.trends.map((t) => ({ ...t, monthLabel: formatMonth(t.month) }))}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="monthLabel" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
                    <YAxis domain={[0, 10]} tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
                    <Tooltip
                      contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
                    />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="avgScore"
                      name="Avg Score"
                      stroke="hsl(var(--primary))"
                      strokeWidth={2}
                      dot={{ r: 4 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="calls"
                      name="Call Volume"
                      stroke="hsl(var(--muted-foreground))"
                      strokeWidth={1}
                      strokeDasharray="5 5"
                      yAxisId="right"
                    />
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      tick={{ fontSize: 12 }}
                      stroke="hsl(var(--muted-foreground))"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Sentiment Trend (stacked bar) */}
            {report?.trends && report.trends.length > 0 && (
              <div className="bg-card rounded-lg border border-border p-6">
                <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center">
                  <RiEmotionLine className="w-5 h-5 mr-2" />
                  Sentiment Trend
                </h3>
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={report.trends.map((t) => ({ ...t, monthLabel: formatMonth(t.month) }))}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="monthLabel" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
                    <YAxis tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
                    <Tooltip
                      contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
                    />
                    <Legend />
                    <Bar dataKey="positive" name="Positive" stackId="sentiment" fill="#22c55e" />
                    <Bar dataKey="neutral" name="Neutral" stackId="sentiment" fill="#94a3b8" />
                    <Bar dataKey="negative" name="Negative" stackId="sentiment" fill="#ef4444" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Top Performers & Sentiment Breakdown */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-card rounded-lg border border-border p-6">
                <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center">
                  <RiStarLine className="w-5 h-5 mr-2" />
                  Top Performers
                </h3>
                {report?.performers && report.performers.length > 0 ? (
                  <ul className="space-y-3">
                    {report.performers.slice(0, 10).map((p, i) => (
                      <li key={p.id || i} className="flex justify-between items-center">
                        <span className="font-medium">
                          <span className="text-muted-foreground mr-2">{i + 1}.</span>
                          {p.name}
                          <span className="text-xs text-muted-foreground ml-2">({p.totalCalls} calls)</span>
                        </span>
                        <span className="font-bold text-green-500">
                          {p.avgPerformanceScore != null ? Number(p.avgPerformanceScore).toFixed(1) : "N/A"}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted-foreground text-sm">No data for this period.</p>
                )}
              </div>

              <div className="bg-card rounded-lg border border-border p-6">
                <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center">
                  <RiEmotionLine className="w-5 h-5 mr-2" />
                  Sentiment Breakdown
                </h3>
                <ul className="space-y-3">
                  {(["positive", "neutral", "negative"] as const).map((key) => {
                    const colors = { positive: "text-green-600", neutral: "text-gray-600", negative: "text-red-600" };
                    const current = report?.sentiment[key] ?? 0;
                    const prev = compareEnabled ? compareReport?.sentiment[key] : undefined;
                    const d = compareEnabled && prev !== undefined ? delta(current, prev) : null;
                    return (
                      <li key={key} className="flex justify-between items-center">
                        <span className={`font-medium capitalize ${colors[key]}`}>{key}</span>
                        <span className="flex items-center gap-2">
                          <span className="font-bold">{current}</span>
                          {d && (
                            <span className={`text-xs ${d.positive ? "text-green-500" : "text-red-500"}`}>
                              ({d.positive ? "+" : ""}
                              {d.pct}%)
                            </span>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>

            {/* Agent Profile Section (employee reports only) */}
            {reportType === "employee" && selectedEmployee && agentProfile && (
              <AgentProfileSection
                agentProfile={agentProfile}
                aiSummary={aiSummary}
                onGenerateSummary={() => summaryMutation.mutate()}
                isGeneratingSummary={summaryMutation.isPending}
                summaryError={summaryMutation.error}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}
