/**
 * Right-rail cards rendered after the transcript and summary in the
 * TranscriptViewer. Each is conditional and self-contained — no shared
 * state with the parent beyond the call-analysis fields passed in as props.
 *
 * Extracted to keep the parent under the 1KB-LOC bar without disturbing
 * the hook ordering at the top of the component (INV-19).
 */
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import {
  RiAlertLine,
  RiAwardLine,
  RiClipboardLine,
  RiHistoryLine,
  RiShieldKeyholeLine,
  RiShieldLine,
} from "@remixicon/react";
import { toDisplayString } from "@/lib/display-utils";

interface ManualEdit {
  editedBy?: string;
  reason?: string;
  editedAt?: string | number | Date;
}

export function ManualEditIndicator({ manualEdits }: { manualEdits: unknown }) {
  if (!Array.isArray(manualEdits) || manualEdits.length === 0) return null;
  const edits = manualEdits as ManualEdit[];
  return (
    <div className="bg-amber-50 dark:bg-amber-950/30 rounded-lg p-3 border border-amber-200 dark:border-amber-900">
      <div className="flex items-center gap-1.5 text-amber-700 dark:text-amber-400 text-xs font-medium mb-1">
        <RiHistoryLine className="w-3.5 h-3.5" aria-hidden="true" />
        Manually Edited ({edits.length} edit{edits.length > 1 ? "s" : ""})
      </div>
      {edits.map((edit, i) => (
        <div key={i} className="text-xs text-muted-foreground mt-1 pl-5">
          <span className="font-medium">{edit.editedBy}</span> — {edit.reason}
          {edit.editedAt && (
            <span className="text-muted-foreground/60 ml-1">
              ({new Date(edit.editedAt).toLocaleDateString()} {new Date(edit.editedAt).toLocaleTimeString()})
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

interface CallFlagsCardProps {
  flags: unknown;
  employeeId?: string;
  callId: string;
}

export function CallFlagsCard({ flags, employeeId, callId }: CallFlagsCardProps) {
  if (!Array.isArray(flags) || flags.length === 0) return null;

  const flagStrings = (flags as unknown[]).map((f) => toDisplayString(f));
  const hasExceptional = flagStrings.includes("exceptional_call");
  const hasBad = flagStrings.some((f) => f === "low_score" || f.startsWith("agent_misconduct"));

  const bgClass =
    hasExceptional && !hasBad
      ? "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900"
      : "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900";
  const headerClass =
    hasExceptional && !hasBad ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400";
  const HeaderIcon = hasExceptional && !hasBad ? RiAwardLine : RiAlertLine;

  return (
    <div className={`rounded-lg p-4 border ${bgClass}`}>
      <h4 className={`font-semibold mb-2 flex items-center gap-1.5 ${headerClass}`}>
        <HeaderIcon className="w-4 h-4" aria-hidden="true" /> Flags
      </h4>
      <div className="flex flex-wrap gap-1.5">
        {flagStrings.map((flag, i) => {
          const isExceptional = flag === "exceptional_call";
          const isMedicare = flag === "medicare_call";
          const isMisconduct = flag.startsWith("agent_misconduct");
          const isLow = flag === "low_score";
          const label = isExceptional
            ? "Exceptional Call"
            : isMedicare
              ? "Medicare Call"
              : isMisconduct
                ? flag.replace("agent_misconduct:", "Misconduct: ")
                : isLow
                  ? "Low Score"
                  : flag;
          const color = isExceptional
            ? "bg-emerald-200 text-emerald-900"
            : isMisconduct
              ? "bg-red-200 text-red-900"
              : isMedicare
                ? "bg-blue-200 text-blue-900"
                : "bg-amber-200 text-amber-900";
          return (
            <Badge key={i} className={`${color} text-xs`}>
              {isExceptional && <RiAwardLine className="w-3 h-3 mr-1 inline" aria-hidden="true" />}
              {label}
            </Badge>
          );
        })}
      </div>
      {hasBad && employeeId && (
        <Link
          href={`/coaching?newSession=true&employeeId=${employeeId}&callId=${callId}&category=${flagStrings.some((f) => f.startsWith("agent_misconduct")) ? "compliance" : "general"}`}
          className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
        >
          <RiClipboardLine className="w-3.5 h-3.5" aria-hidden="true" /> Create Coaching Session
        </Link>
      )}
    </div>
  );
}

export function CallPartyCard({ callPartyType }: { callPartyType: unknown }) {
  if (!callPartyType) return null;
  return (
    <div className="bg-muted rounded-lg p-4">
      <h4 className="font-semibold text-foreground mb-2 flex items-center gap-1.5">
        <RiShieldLine className="w-4 h-4" aria-hidden="true" /> Call Party
      </h4>
      <Badge variant="outline" className="capitalize">
        {toDisplayString(callPartyType).replace(/_/g, " ")}
      </Badge>
    </div>
  );
}

interface ConfidenceFactors {
  transcriptConfidence?: number;
  wordCount?: number;
  callDurationSeconds?: number;
  callDuration?: number;
}

interface AIConfidenceCardProps {
  confidenceScore: unknown;
  confidenceFactors: unknown;
}

export function AIConfidenceCard({ confidenceScore, confidenceFactors }: AIConfidenceCardProps) {
  if (!confidenceScore) return null;
  const confidence = parseFloat(typeof confidenceScore === "string" ? confidenceScore : String(confidenceScore));
  if (isNaN(confidence)) return null;

  const isLow = confidence < 0.7;
  const pct = (confidence * 100).toFixed(0);
  const factors =
    confidenceFactors && typeof confidenceFactors === "object" ? (confidenceFactors as ConfidenceFactors) : undefined;

  const barColor = isLow
    ? "from-yellow-500 to-amber-400"
    : confidence >= 0.85
      ? "from-green-500 to-emerald-400"
      : "from-blue-500 to-cyan-400";
  const bgClass = isLow
    ? "bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-900"
    : "bg-muted";

  return (
    <div className={`rounded-lg p-4 ${bgClass}`}>
      <h4
        className={`font-semibold mb-2 flex items-center gap-1.5 ${isLow ? "text-yellow-700 dark:text-yellow-400" : "text-foreground"}`}
      >
        <RiShieldKeyholeLine className="w-4 h-4" aria-hidden="true" /> AI Confidence
      </h4>
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className={`text-lg font-bold ${isLow ? "text-yellow-600 dark:text-yellow-400" : "text-foreground"}`}>
            {pct}%
          </span>
          {isLow && (
            <Badge className="bg-yellow-200 text-yellow-900 dark:bg-yellow-900 dark:text-yellow-300 text-xs">
              Needs Review
            </Badge>
          )}
        </div>
        <div className="w-full h-2 bg-muted-foreground/20 rounded-full overflow-hidden">
          <div className={`h-full rounded-full bg-gradient-to-r ${barColor}`} style={{ width: `${pct}%` }} />
        </div>
        {factors && (
          <div className="text-xs text-muted-foreground space-y-0.5 mt-2">
            {factors.transcriptConfidence != null && (
              <p>Transcript clarity: {(Number(factors.transcriptConfidence) * 100).toFixed(0)}%</p>
            )}
            {factors.wordCount !== undefined && <p>Word count: {factors.wordCount} words</p>}
            {(factors.callDurationSeconds ?? factors.callDuration) !== undefined && (
              <p>Call duration: {factors.callDurationSeconds ?? factors.callDuration}s</p>
            )}
          </div>
        )}
        {isLow && (
          <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-1">
            This analysis may be less reliable. Consider manual review.
          </p>
        )}
      </div>
    </div>
  );
}
