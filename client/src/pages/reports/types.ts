/**
 * Type definitions for the Reports page.
 * Extracted from `pages/reports.tsx` so sub-components can share them
 * without re-declaring shapes.
 */

export type ReportType = "overall" | "employee" | "department";

export type DatePreset = "last30" | "last90" | "ytd" | "lastYear" | "custom";

export interface FilteredReportData {
  metrics: { totalCalls: number; avgSentiment: number; avgPerformanceScore: number };
  sentiment: { positive: number; neutral: number; negative: number };
  performers: Array<{ id: string; name: string; role: string; avgPerformanceScore: number | null; totalCalls: number }>;
  trends: Array<{
    month: string;
    calls: number;
    avgScore: number | null;
    positive: number;
    neutral: number;
    negative: number;
  }>;
  avgSubScores?: { compliance: number; customerExperience: number; communication: number; resolution: number } | null;
  autoAssignedCount?: number;
}

export interface AgentProfileData {
  employee: { id: string; name: string; role: string; status: string };
  totalCalls: number;
  avgPerformanceScore: number | null;
  highScore: number | null;
  lowScore: number | null;
  sentimentBreakdown: { positive: number; neutral: number; negative: number };
  topStrengths: Array<{ text: string; count: number }>;
  topSuggestions: Array<{ text: string; count: number }>;
  commonTopics: Array<{ text: string; count: number }>;
  scoreTrend: Array<{ month: string; avgScore: number; calls: number }>;
  flaggedCalls: Array<{
    id: string;
    fileName?: string;
    uploadedAt?: string;
    score: number | null;
    summary?: string;
    flags: string[];
    sentiment?: string;
    flagType: "good" | "bad";
  }>;
}

/** Shape of an individual flagged call passed to FlaggedCallCard. */
export type FlaggedCall = AgentProfileData["flaggedCalls"][number];
