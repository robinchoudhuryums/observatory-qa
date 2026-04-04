/**
 * Data export endpoints — CSV downloads for calls, employees, and report data.
 *
 * HIPAA: Exports are audit-logged. Call transcripts are NOT included in bulk exports
 * (only metadata, scores, and summaries). Individual transcript export is available
 * via the transcript-viewer on the frontend.
 */
import type { Express } from "express";
import { storage } from "../storage";
import { requireAuth, requireRole, injectOrgContext } from "../auth";
import { logPhiAccess } from "../services/audit-log";
import { asyncHandler } from "../middleware/error-handler";

function escapeCsvField(value: unknown): string {
  if (value == null) return "";
  let str = String(value);
  // CSV formula injection prevention: cells starting with =, +, -, @, tab, or CR
  // can execute formulas in Excel/Google Sheets. Prefix with a single quote to force
  // text interpretation. See OWASP CSV Injection guidelines.
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("'")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toCsvRow(fields: unknown[]): string {
  return fields.map(escapeCsvField).join(",");
}

/** Maximum rows for CSV exports to prevent memory exhaustion. */
const MAX_EXPORT_ROWS = 50_000;

export function registerExportRoutes(app: Express): void {
  /**
   * Export performance data as CSV.
   * Includes: employee name, department, avg score, total calls.
   */
  app.get("/api/export/performance", requireAuth, requireRole("manager"), injectOrgContext, asyncHandler(async (req, res) => {
    const employees = await storage.getAllEmployees(req.orgId!);
    const rawCalls = await storage.getCallSummaries(req.orgId!, {});
    const calls = rawCalls.slice(-MAX_EXPORT_ROWS);

    // Build per-employee performance stats
    const empStats = new Map<
      string,
      {
        name: string;
        role: string;
        totalCalls: number;
        totalScore: number;
        scoredCalls: number;
        flaggedCalls: number;
        lastCallDate: string;
      }
    >();
    for (const emp of employees) {
      empStats.set(emp.id, {
        name: emp.name,
        role: emp.role || "",
        totalCalls: 0,
        totalScore: 0,
        scoredCalls: 0,
        flaggedCalls: 0,
        lastCallDate: "",
      });
    }

    for (const call of calls) {
      if (!call.employeeId) continue;
      const stats = empStats.get(call.employeeId);
      if (!stats) continue;
      stats.totalCalls++;
      const score = (call.analysis as any)?.performanceScore;
      if (score != null) {
        stats.totalScore += Number(score);
        stats.scoredCalls++;
      }
      const flags = (call.analysis as any)?.flags;
      if (Array.isArray(flags) && flags.length > 0) {
        stats.flaggedCalls++;
      }
      if (call.uploadedAt && (!stats.lastCallDate || call.uploadedAt > stats.lastCallDate)) {
        stats.lastCallDate = call.uploadedAt;
      }
    }

    const headers = ["Employee", "Department", "Total Calls", "Avg Score", "Flagged Calls", "Last Call Date"];
    const rows = Array.from(empStats.values())
      .filter((s) => s.totalCalls > 0)
      .sort(
        (a, b) =>
          (b.scoredCalls > 0 ? b.totalScore / b.scoredCalls : 0) -
          (a.scoredCalls > 0 ? a.totalScore / a.scoredCalls : 0),
      )
      .map((s) =>
        toCsvRow([
          s.name,
          s.role,
          s.totalCalls,
          s.scoredCalls > 0 ? (s.totalScore / s.scoredCalls).toFixed(1) : "",
          s.flaggedCalls,
          s.lastCallDate ? new Date(s.lastCallDate).toISOString().slice(0, 10) : "",
        ]),
      );

    const csv = [toCsvRow(headers), ...rows].join("\n");

    logPhiAccess({
      event: "export_performance_csv",
      userId: req.user!.id,
      orgId: req.orgId!,
      resourceType: "employee",
      detail: `Exported performance for ${rows.length} employees`,
    });

    const filename = `performance-export-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(csv);
  }));

  /**
   * Export flagged calls as CSV.
   * Includes: call date, employee, score, flags, summary.
   */
  app.get("/api/export/flagged", requireAuth, requireRole("manager"), injectOrgContext, asyncHandler(async (req, res) => {
    const rawCalls = await storage.getCallSummaries(req.orgId!, { status: "completed" });
    const flaggedCalls = rawCalls
      .filter((c) => {
        const flags = (c.analysis as any)?.flags;
        return Array.isArray(flags) && flags.length > 0;
      })
      .slice(-MAX_EXPORT_ROWS);

    const employees = await storage.getAllEmployees(req.orgId!);
    const empMap = new Map(employees.map((e) => [e.id, e.name]));

    const headers = ["Date", "Employee", "Score", "Flags", "Summary", "Call ID"];
    const rows = flaggedCalls.map((c) =>
      toCsvRow([
        c.uploadedAt ? new Date(c.uploadedAt).toISOString().slice(0, 10) : "",
        c.employeeId ? empMap.get(c.employeeId) || "Unknown" : "Unassigned",
        (c.analysis as any)?.performanceScore ?? "",
        ((c.analysis as any)?.flags || []).join("; "),
        (c.analysis as any)?.summary || "",
        c.id,
      ]),
    );

    const csv = [toCsvRow(headers), ...rows].join("\n");

    logPhiAccess({
      event: "export_flagged_csv",
      userId: req.user!.id,
      orgId: req.orgId!,
      resourceType: "call",
      detail: `Exported ${rows.length} flagged calls`,
    });

    const filename = `flagged-calls-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(csv);
  }));

  /**
   * Export sentiment data as CSV.
   * Includes: overall distribution, per-employee sentiment breakdown.
   */
  app.get("/api/export/sentiment", requireAuth, requireRole("manager"), injectOrgContext, asyncHandler(async (req, res) => {
    const calls = await storage.getCallSummaries(req.orgId!, {});
    const employees = await storage.getAllEmployees(req.orgId!);
    const empMap = new Map(employees.map((e) => [e.id, e]));

    const empSentiment = new Map<
      string,
      { name: string; positive: number; neutral: number; negative: number; total: number }
    >();

    for (const call of calls) {
      const sentiment = call.sentiment?.overallSentiment;
      if (!sentiment || !call.employeeId) continue;
      const emp = empMap.get(call.employeeId);
      if (!emp) continue;

      if (!empSentiment.has(call.employeeId)) {
        empSentiment.set(call.employeeId, { name: emp.name, positive: 0, neutral: 0, negative: 0, total: 0 });
      }
      const entry = empSentiment.get(call.employeeId)!;
      entry.total++;
      if (sentiment === "positive") entry.positive++;
      else if (sentiment === "neutral") entry.neutral++;
      else if (sentiment === "negative") entry.negative++;
    }

    const headers = ["Employee", "Positive", "Neutral", "Negative", "Total", "Positive %"];
    const rows = Array.from(empSentiment.values())
      .sort((a, b) => (b.total > 0 ? b.positive / b.total : 0) - (a.total > 0 ? a.positive / a.total : 0))
      .map((s) =>
        toCsvRow([
          s.name,
          s.positive,
          s.neutral,
          s.negative,
          s.total,
          s.total > 0 ? `${Math.round((s.positive / s.total) * 100)}%` : "",
        ]),
      );

    const csv = [toCsvRow(headers), ...rows].join("\n");

    logPhiAccess({
      event: "export_sentiment_csv",
      userId: req.user!.id,
      orgId: req.orgId!,
      resourceType: "call",
      detail: `Exported sentiment for ${rows.length} employees`,
    });

    const filename = `sentiment-export-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(csv);
  }));

  /**
   * Export insights data as CSV.
   * Includes: top topics, top complaints, escalation patterns summary.
   */
  app.get("/api/export/insights", requireAuth, requireRole("manager"), injectOrgContext, asyncHandler(async (req, res) => {
    const calls = await storage.getCallSummaries(req.orgId!, {});

    // Extract topics and complaints from analyses
    const topicCounts = new Map<string, number>();
    const complaintCounts = new Map<string, number>();
    let totalNegative = 0;
    let totalLowScore = 0;
    let totalScored = 0;
    let totalScoreSum = 0;

    for (const call of calls) {
      const analysis = call.analysis as any;
      if (!analysis) continue;

      const score = Number(analysis.performanceScore);
      if (!isNaN(score)) {
        totalScored++;
        totalScoreSum += score;
        if (score <= 4) totalLowScore++;
      }

      if (call.sentiment?.overallSentiment === "negative") totalNegative++;

      const topics = Array.isArray(analysis.topics) ? analysis.topics : [];
      for (const t of topics) {
        const topic = typeof t === "string" ? t : String(t);
        topicCounts.set(topic, (topicCounts.get(topic) || 0) + 1);
      }

      if (call.sentiment?.overallSentiment === "negative" && topics.length > 0) {
        for (const t of topics) {
          const topic = typeof t === "string" ? t : String(t);
          complaintCounts.set(topic, (complaintCounts.get(topic) || 0) + 1);
        }
      }
    }

    const sortedTopics = Array.from(topicCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20);
    const sortedComplaints = Array.from(complaintCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20);

    // Build CSV with sections
    const lines: string[] = [];
    lines.push(toCsvRow(["Summary"]));
    lines.push(toCsvRow(["Total Calls Analyzed", calls.length]));
    lines.push(toCsvRow(["Average Score", totalScored > 0 ? (totalScoreSum / totalScored).toFixed(1) : "N/A"]));
    lines.push(
      toCsvRow([
        "Negative Call Rate",
        calls.length > 0 ? `${Math.round((totalNegative / calls.length) * 100)}%` : "N/A",
      ]),
    );
    lines.push(
      toCsvRow([
        "Escalation Rate (score <= 4)",
        totalScored > 0 ? `${Math.round((totalLowScore / totalScored) * 100)}%` : "N/A",
      ]),
    );
    lines.push("");
    lines.push(toCsvRow(["Top Topics", "Count"]));
    for (const [topic, count] of sortedTopics) {
      lines.push(toCsvRow([topic, count]));
    }
    lines.push("");
    lines.push(toCsvRow(["Top Complaints (Negative Calls)", "Count"]));
    for (const [topic, count] of sortedComplaints) {
      lines.push(toCsvRow([topic, count]));
    }

    const csv = lines.join("\n");

    logPhiAccess({
      event: "export_insights_csv",
      userId: req.user!.id,
      orgId: req.orgId!,
      resourceType: "call",
      detail: `Exported insights summary`,
    });

    const filename = `insights-export-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(csv);
  }));

  /**
   * Export calls data as CSV.
   * Includes: call metadata, performance scores, sentiment, flags.
   * Excludes: full transcript text (HIPAA — too much PHI in bulk export).
   */
  app.get("/api/export/calls", requireAuth, requireRole("manager"), injectOrgContext, asyncHandler(async (req, res) => {
    const { from, to, employeeId, status } = req.query;

    const filters: { status?: string; employee?: string } = {};
    if (status && typeof status === "string") filters.status = status;
    if (employeeId && typeof employeeId === "string") filters.employee = employeeId;

    const calls = await storage.getCallSummaries(req.orgId!, filters);
    const employees = await storage.getAllEmployees(req.orgId!);
    const empMap = new Map(employees.map((e) => [e.id, e]));

    // Apply date filters
    let filtered = calls;
    if (from) {
      const fromDate = new Date(from as string);
      filtered = filtered.filter((c) => new Date(c.uploadedAt || 0) >= fromDate);
    }
    if (to) {
      const toDate = new Date(to as string);
      toDate.setHours(23, 59, 59, 999);
      filtered = filtered.filter((c) => new Date(c.uploadedAt || 0) <= toDate);
    }

    const headers = [
      "Call ID",
      "File Name",
      "Status",
      "Category",
      "Employee",
      "Employee Email",
      "Duration (s)",
      "Upload Date",
      "Performance Score",
      "Compliance",
      "Customer Experience",
      "Communication",
      "Resolution",
      "Sentiment",
      "Sentiment Score",
      "Summary",
      "Flags",
      "Tags",
    ];

    const rows = filtered.map((call) => {
      const emp = call.employeeId ? empMap.get(call.employeeId) : undefined;
      const analysis = call.analysis as any;
      const subScores = analysis?.subScores || {};
      const flags = Array.isArray(analysis?.flags) ? analysis.flags.join("; ") : "";
      const tags = Array.isArray(call.tags) ? (call.tags as string[]).join("; ") : "";

      return toCsvRow([
        call.id,
        call.fileName,
        call.status,
        call.callCategory || "",
        emp?.name || "",
        emp?.email || "",
        call.duration || "",
        call.uploadedAt || "",
        analysis?.performanceScore ?? "",
        subScores.compliance ?? "",
        subScores.customerExperience ?? "",
        subScores.communication ?? "",
        subScores.resolution ?? "",
        call.sentiment?.overallSentiment || "",
        call.sentiment?.overallScore ?? "",
        analysis?.summary || "",
        flags,
        tags,
      ]);
    });

    const csv = [toCsvRow(headers), ...rows].join("\n");

    logPhiAccess({
      event: "export_calls_csv",
      userId: req.user!.id,
      orgId: req.orgId!,
      resourceType: "call",
      detail: `Exported ${filtered.length} calls`,
    });

    const filename = `calls-export-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(csv);
  }));

  /**
   * Export employees data as CSV.
   */
  app.get("/api/export/employees", requireAuth, requireRole("manager"), injectOrgContext, asyncHandler(async (req, res) => {
    const employees = await storage.getAllEmployees(req.orgId!);

    const headers = ["ID", "Name", "Email", "Role", "Status", "Sub-Team", "Initials"];
    const rows = employees.map((emp) =>
      toCsvRow([
        emp.id,
        emp.name,
        emp.email,
        emp.role || "",
        emp.status || "",
        emp.subTeam || "",
        emp.initials || "",
      ]),
    );

    const csv = [toCsvRow(headers), ...rows].join("\n");

    logPhiAccess({
      event: "export_employees_csv",
      userId: req.user!.id,
      orgId: req.orgId!,
      resourceType: "employee",
      detail: `Exported ${employees.length} employees`,
    });

    const filename = `employees-export-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(csv);
  }));

  /**
   * Export coaching sessions as CSV.
   */
  app.get("/api/export/coaching", requireAuth, requireRole("manager"), injectOrgContext, asyncHandler(async (req, res) => {
    const sessions = await storage.getAllCoachingSessions(req.orgId!);
    const employees = await storage.getAllEmployees(req.orgId!);
    const empMap = new Map(employees.map((e) => [e.id, e]));

    const headers = [
      "Session ID",
      "Employee",
      "Category",
      "Title",
      "Status",
      "Assigned By",
      "Due Date",
      "Created",
      "Completed",
      "Notes",
    ];
    const rows = sessions.map((s) => {
      const emp = empMap.get(s.employeeId);
      return toCsvRow([
        s.id,
        emp?.name || s.employeeId,
        s.category,
        s.title,
        s.status,
        s.assignedBy,
        s.dueDate || "",
        s.createdAt || "",
        s.completedAt || "",
        s.notes || "",
      ]);
    });

    const csv = [toCsvRow(headers), ...rows].join("\n");

    const filename = `coaching-export-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(csv);
  }));
}
