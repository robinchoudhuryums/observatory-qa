/**
 * Agent Profile section of the Reports page.
 *
 * Renders the per-employee deep-dive: aggregate scores, score-trend line
 * chart, recurring strengths/suggestions, common topics, flagged calls,
 * and the AI-generated narrative summary.
 *
 * Extracted from `pages/reports.tsx` so the parent can stay under 1KB
 * LOC. The mutation is intentionally not passed in directly — callers
 * pass discrete callbacks/flags so this component stays decoupled from
 * TanStack Query types.
 */
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { Button } from "@/components/ui/button";
import { RiUserLine, RiSparklingLine, RiAlertLine } from "@remixicon/react";
import { formatMonth } from "./helpers";
import { FlaggedCallCard } from "./components";
import type { AgentProfileData } from "./types";

interface AgentProfileSectionProps {
  agentProfile: AgentProfileData;
  aiSummary: string | null;
  onGenerateSummary: () => void;
  isGeneratingSummary: boolean;
  summaryError: Error | null;
}

export function AgentProfileSection({
  agentProfile,
  aiSummary,
  onGenerateSummary,
  isGeneratingSummary,
  summaryError,
}: AgentProfileSectionProps) {
  return (
    <div className="bg-card rounded-lg border border-border p-6">
      <h3 className="text-lg font-semibold text-foreground mb-1 flex items-center">
        <RiUserLine className="w-5 h-5 mr-2" aria-hidden="true" />
        Agent Profile: {agentProfile.employee.name}
      </h3>
      <p className="text-sm text-muted-foreground mb-4">
        Aggregated feedback from {agentProfile.totalCalls} analyzed calls
        {agentProfile.employee.role && ` — ${agentProfile.employee.role}`}
      </p>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="text-center p-3 bg-muted/30 rounded-lg">
          <p className="text-xs text-muted-foreground">Avg Score</p>
          <p className="text-2xl font-bold text-green-500">{agentProfile.avgPerformanceScore?.toFixed(1) ?? "N/A"}</p>
        </div>
        <div className="text-center p-3 bg-muted/30 rounded-lg">
          <p className="text-xs text-muted-foreground">Best Score</p>
          <p className="text-2xl font-bold">{agentProfile.highScore?.toFixed(1) ?? "N/A"}</p>
        </div>
        <div className="text-center p-3 bg-muted/30 rounded-lg">
          <p className="text-xs text-muted-foreground">Lowest Score</p>
          <p className="text-2xl font-bold">{agentProfile.lowScore?.toFixed(1) ?? "N/A"}</p>
        </div>
        <div className="text-center p-3 bg-muted/30 rounded-lg">
          <p className="text-xs text-muted-foreground">Total Calls</p>
          <p className="text-2xl font-bold">{agentProfile.totalCalls}</p>
        </div>
      </div>

      {/* Agent score trend */}
      {agentProfile.scoreTrend.length > 1 && (
        <div className="mb-6">
          <h4 className="text-sm font-semibold text-foreground mb-2">Score Trend Over Time</h4>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={agentProfile.scoreTrend.map((t) => ({ ...t, monthLabel: formatMonth(t.month) }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="monthLabel" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
              <YAxis domain={[0, 10]} tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
              <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
              <Line
                type="monotone"
                dataKey="avgScore"
                name="Avg Score"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                dot={{ r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Strengths */}
        <div>
          <h4 className="text-sm font-semibold text-foreground mb-2 text-green-600">Recurring Strengths</h4>
          {agentProfile.topStrengths.length > 0 ? (
            <ul className="space-y-1.5">
              {agentProfile.topStrengths.map((s, i) => (
                <li key={i} className="text-sm flex items-start gap-2">
                  <span className="text-green-500 mt-0.5 shrink-0">+</span>
                  <span className="capitalize">{s.text}</span>
                  {s.count > 1 && <span className="text-xs text-muted-foreground shrink-0">x{s.count}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No data yet.</p>
          )}
        </div>

        {/* Suggestions */}
        <div>
          <h4 className="text-sm font-semibold text-foreground mb-2 text-amber-600">Recurring Suggestions</h4>
          {agentProfile.topSuggestions.length > 0 ? (
            <ul className="space-y-1.5">
              {agentProfile.topSuggestions.map((s, i) => (
                <li key={i} className="text-sm flex items-start gap-2">
                  <span className="text-amber-500 mt-0.5 shrink-0">!</span>
                  <span className="capitalize">{s.text}</span>
                  {s.count > 1 && <span className="text-xs text-muted-foreground shrink-0">x{s.count}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No data yet.</p>
          )}
        </div>
      </div>

      {/* Common topics */}
      {agentProfile.commonTopics.length > 0 && (
        <div className="mt-4 pt-4 border-t border-border">
          <h4 className="text-sm font-semibold text-foreground mb-2">Common Call Topics</h4>
          <div className="flex flex-wrap gap-2">
            {agentProfile.commonTopics.map((t, i) => (
              <span
                key={i}
                className="inline-flex items-center px-2.5 py-1 rounded-full text-xs bg-primary/10 text-primary font-medium capitalize"
              >
                {t.text}
                {t.count > 1 && <span className="ml-1 text-muted-foreground">({t.count})</span>}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Flagged Calls */}
      {agentProfile.flaggedCalls && agentProfile.flaggedCalls.length > 0 && (
        <div className="mt-4 pt-4 border-t border-border">
          <h4 className="text-sm font-semibold text-foreground mb-3">Flagged Calls</h4>
          <div className="space-y-2">
            {agentProfile.flaggedCalls.map((fc) => (
              <FlaggedCallCard key={fc.id} call={fc} />
            ))}
          </div>
        </div>
      )}

      {/* AI Summary */}
      <div className="mt-4 pt-4 border-t border-border">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
            <RiSparklingLine className="w-4 h-4" aria-hidden="true" /> AI Performance Summary
          </h4>
          <Button
            size="sm"
            variant={aiSummary ? "outline" : "default"}
            onClick={onGenerateSummary}
            disabled={isGeneratingSummary}
          >
            <RiSparklingLine className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />
            {isGeneratingSummary ? "Generating..." : aiSummary ? "Regenerate" : "Generate AI Summary"}
          </Button>
        </div>
        {summaryError && (
          <p className="text-sm text-red-500 mb-2">
            <RiAlertLine className="w-3.5 h-3.5 inline mr-1" aria-hidden="true" />
            {summaryError.message || "Failed to generate summary"}
          </p>
        )}
        {aiSummary && (
          <div className="bg-muted/50 rounded-lg p-4 text-sm text-foreground whitespace-pre-wrap leading-relaxed">
            {aiSummary}
          </div>
        )}
        {!aiSummary && !isGeneratingSummary && (
          <p className="text-sm text-muted-foreground">
            Click &quot;Generate AI Summary&quot; to create a narrative performance review based on aggregated call
            data.
          </p>
        )}
      </div>
    </div>
  );
}
