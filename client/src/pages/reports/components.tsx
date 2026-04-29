/**
 * Presentational sub-components for the Reports page.
 *
 * MetricCard: a single KPI tile with optional period-over-period delta.
 * FlaggedCallCard: a flagged call summary with inline audio player.
 * SubScoreCard: a sub-score tile (compliance / customer-exp / communication
 * / resolution) with progress bar and qualitative level.
 *
 * Extracted from `pages/reports.tsx` — no behavior change.
 */
import { useRef, useState, type ComponentType } from "react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import {
  RiArrowUpSLine,
  RiArrowDownSLine,
  RiAwardLine,
  RiAlertLine,
  RiPlayLine,
  RiPauseLine,
  RiEyeLine,
} from "@remixicon/react";
import type { FlaggedCall } from "./types";

export function MetricCard({
  label,
  value,
  format,
  color,
  compareValue,
  delta: d,
}: {
  label: string;
  value: number;
  format: "int" | "sentiment" | "score";
  color?: string;
  compareValue?: number;
  delta: { diff: number; pct: string; positive: boolean } | null | undefined;
}) {
  const formatted =
    format === "int" ? String(value) : format === "sentiment" ? value.toFixed(2) : `${value.toFixed(1)}/10`;

  return (
    <div>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={`text-3xl font-bold ${color || ""}`}>{formatted}</p>
      {d && (
        <div
          className={`flex items-center justify-center gap-1 mt-1 text-xs ${d.positive ? "text-green-500" : "text-red-500"}`}
        >
          {d.positive ? <RiArrowUpSLine className="w-3 h-3" /> : <RiArrowDownSLine className="w-3 h-3" />}
          <span>
            {d.positive ? "+" : ""}
            {d.pct}%
          </span>
          {compareValue !== undefined && (
            <span className="text-muted-foreground ml-1">
              (was{" "}
              {format === "int"
                ? compareValue
                : format === "sentiment"
                  ? compareValue.toFixed(2)
                  : `${compareValue.toFixed(1)}`}
              )
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export function FlaggedCallCard({ call }: { call: FlaggedCall }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);

  const isGood = call.flagType === "good";
  const borderClass = isGood ? "border-emerald-200 dark:border-emerald-900" : "border-red-200 dark:border-red-900";
  const bgClass = isGood ? "bg-emerald-50/50 dark:bg-emerald-950/20" : "bg-red-50/50 dark:bg-red-950/20";
  const accentClass = isGood ? "text-emerald-600" : "text-red-600";
  const playerBg = isGood ? "bg-emerald-100 dark:bg-emerald-900/40" : "bg-red-100 dark:bg-red-900/40";
  const Icon = isGood ? RiAwardLine : RiAlertLine;

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (playing) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setPlaying(!playing);
  };

  return (
    <div className={`rounded-lg border p-3 ${borderClass} ${bgClass}`}>
      <audio
        ref={audioRef}
        src={`/api/calls/${call.id}/audio`}
        preload="none"
        onEnded={() => setPlaying(false)}
        onPause={() => setPlaying(false)}
        onPlay={() => setPlaying(true)}
      />
      <div className="flex items-start gap-3">
        {/* Play button */}
        <button
          onClick={togglePlay}
          className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${playerBg} ${accentClass} hover:opacity-80 transition-opacity`}
          aria-label={playing ? "Pause flagged call audio" : "Play flagged call audio"}
        >
          {playing ? <RiPauseLine className="w-4 h-4" /> : <RiPlayLine className="w-4 h-4 ml-0.5" />}
        </button>

        {/* Details */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Icon className={`w-3.5 h-3.5 shrink-0 ${accentClass}`} aria-hidden="true" />
            <span className="text-xs font-medium text-muted-foreground">
              {call.uploadedAt ? new Date(call.uploadedAt).toLocaleDateString() : "Unknown date"}
            </span>
            {call.score != null && (
              <span className={`text-xs font-bold ${accentClass}`}>{call.score.toFixed(1)}/10</span>
            )}
            <div className="flex gap-1 ml-auto">
              {call.flags.map((flag, i) => {
                const isExceptional = flag === "exceptional_call";
                const isMisconduct = flag.startsWith("agent_misconduct");
                const isLow = flag === "low_score";
                const isMedicare = flag === "medicare_call";
                const label = isExceptional
                  ? "Exceptional"
                  : isMisconduct
                    ? "Misconduct"
                    : isLow
                      ? "Low Score"
                      : isMedicare
                        ? "Medicare"
                        : flag;
                const color = isExceptional
                  ? "bg-emerald-200 text-emerald-900"
                  : isMisconduct
                    ? "bg-red-200 text-red-900"
                    : isMedicare
                      ? "bg-blue-200 text-blue-900"
                      : "bg-amber-200 text-amber-900";
                return (
                  <Badge key={i} className={`${color} text-[10px] px-1.5 py-0`}>
                    {label}
                  </Badge>
                );
              })}
            </div>
          </div>
          {call.summary && <p className="text-xs text-muted-foreground line-clamp-2">{call.summary}</p>}
          <Link
            href={`/transcripts/${call.id}`}
            className="text-xs text-primary hover:underline mt-1 inline-flex items-center gap-1"
          >
            <RiEyeLine className="w-3 h-3" /> View Full Call
          </Link>
        </div>
      </div>
    </div>
  );
}

export function SubScoreCard({
  icon: Icon,
  label,
  score,
  color,
  barColor,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  score: number;
  color: string;
  barColor: string;
}) {
  const level = score >= 8 ? "Excellent" : score >= 6 ? "Good" : score >= 4 ? "Needs Work" : "Critical";
  const levelColor =
    score >= 8 ? "text-green-600" : score >= 6 ? "text-blue-600" : score >= 4 ? "text-yellow-600" : "text-red-600";
  return (
    <div className="p-4 bg-muted/30 rounded-lg">
      <div className="flex items-center gap-2 mb-2">
        <Icon className={`w-4 h-4 ${color}`} />
        <span className="text-sm font-medium text-foreground">{label}</span>
      </div>
      <div className="flex items-baseline gap-2 mb-1">
        <span className={`text-2xl font-bold ${color}`}>{score.toFixed(1)}</span>
        <span className="text-xs text-muted-foreground">/10</span>
      </div>
      <div className="w-full h-2 bg-muted-foreground/20 rounded-full overflow-hidden mb-1">
        <div className={`h-full rounded-full bg-gradient-to-r ${barColor}`} style={{ width: `${score * 10}%` }} />
      </div>
      <p className={`text-xs ${levelColor}`}>{level}</p>
    </div>
  );
}
