import { Search, Plus, AlertTriangle, Award } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import MetricsOverview from "@/components/dashboard/metrics-overview";
import SentimentAnalysis from "@/components/dashboard/sentiment-analysis";
import PerformanceCard from "@/components/dashboard/performance-card";
import FileUpload from "@/components/upload/file-upload";
import CallsTable from "@/components/tables/calls-table";
import type { CallWithDetails } from "@shared/schema";

export default function Dashboard() {
  const [, navigate] = useLocation();

  // Fetch recent calls to extract flagged ones for the dashboard alert panel
  const { data: calls } = useQuery<CallWithDetails[]>({
    queryKey: ["/api/calls", { status: "", sentiment: "", employee: "" }],
  });

  const flaggedCalls = (calls || []).filter(c => {
    const flags = c.analysis?.flags as string[] | undefined;
    return flags && flags.length > 0 && flags.some(f =>
      f === "low_score" || f.startsWith("agent_misconduct") || f === "exceptional_call"
    );
  });

  const badCalls = flaggedCalls.filter(c =>
    (c.analysis?.flags as string[]).some(f => f === "low_score" || f.startsWith("agent_misconduct"))
  );
  const goodCalls = flaggedCalls.filter(c =>
    (c.analysis?.flags as string[]).includes("exceptional_call")
  );

  return (
    <div className="min-h-screen" data-testid="dashboard-page">
      {/* Header */}
      <header className="bg-card border-b border-border px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-foreground">Call Analysis Dashboard</h2>
            <p className="text-muted-foreground">Monitor performance and sentiment across all customer interactions</p>
          </div>
          <div className="flex items-center space-x-4">
            <Button
              variant="outline"
              className="w-64 justify-start text-muted-foreground"
              onClick={() => navigate("/search")}
              data-testid="search-input"
            >
              <Search className="w-4 h-4 mr-2" />
              Search calls...
            </Button>
            <Link href="/upload">
              <Button data-testid="upload-call-button">
                <Plus className="w-4 h-4 mr-2" />
                Upload Call
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <div className="p-6 space-y-6">
        {/* Flagged Calls Alert Banner */}
        {flaggedCalls.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {badCalls.length > 0 && (
              <div className="bg-red-50 dark:bg-red-950/30 rounded-lg border border-red-200 dark:border-red-900 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="w-5 h-5 text-red-500" />
                  <h3 className="font-semibold text-red-700 dark:text-red-400">
                    {badCalls.length} Call{badCalls.length > 1 ? "s" : ""} Need Attention
                  </h3>
                </div>
                <p className="text-sm text-red-600/80 dark:text-red-400/80 mb-2">
                  Calls flagged for low scores or agent misconduct.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {badCalls.slice(0, 5).map(c => (
                    <Link key={c.id} href={`/transcripts/${c.id}`}>
                      <Badge className="bg-red-200 text-red-900 text-xs cursor-pointer hover:bg-red-300">
                        {c.employee?.name || "Unassigned"} — {Number(c.analysis?.performanceScore || 0).toFixed(1)}
                      </Badge>
                    </Link>
                  ))}
                  {badCalls.length > 5 && (
                    <Link href="/reports">
                      <Badge variant="outline" className="text-xs cursor-pointer">+{badCalls.length - 5} more</Badge>
                    </Link>
                  )}
                </div>
              </div>
            )}
            {goodCalls.length > 0 && (
              <div className="bg-emerald-50 dark:bg-emerald-950/30 rounded-lg border border-emerald-200 dark:border-emerald-900 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Award className="w-5 h-5 text-emerald-500" />
                  <h3 className="font-semibold text-emerald-700 dark:text-emerald-400">
                    {goodCalls.length} Exceptional Call{goodCalls.length > 1 ? "s" : ""}
                  </h3>
                </div>
                <p className="text-sm text-emerald-600/80 dark:text-emerald-400/80 mb-2">
                  Calls where agents went above and beyond.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {goodCalls.slice(0, 5).map(c => (
                    <Link key={c.id} href={`/transcripts/${c.id}`}>
                      <Badge className="bg-emerald-200 text-emerald-900 text-xs cursor-pointer hover:bg-emerald-300">
                        <Award className="w-3 h-3 mr-1" />
                        {c.employee?.name || "Unassigned"} — {Number(c.analysis?.performanceScore || 0).toFixed(1)}
                      </Badge>
                    </Link>
                  ))}
                  {goodCalls.length > 5 && (
                    <Link href="/reports">
                      <Badge variant="outline" className="text-xs cursor-pointer">+{goodCalls.length - 5} more</Badge>
                    </Link>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Metrics Overview */}
        <MetricsOverview />

        {/* File Upload Section */}
        <FileUpload />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Sentiment Analysis */}
          <SentimentAnalysis />

          {/* Top Performers */}
          <PerformanceCard />
        </div>

        {/* Recent Calls Table */}
        <CallsTable />
      </div>
    </div>
  );
}
