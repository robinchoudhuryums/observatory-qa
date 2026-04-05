import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Link } from "wouter";
import { useBeforeUnload } from "@/hooks/use-before-unload";
import { useToast } from "@/hooks/use-toast";
import { toDisplayString } from "@/lib/display-utils";
import type { CallWithDetails, AuthUser } from "@shared/schema";
import { getQueryFn, csrfFetch } from "@/lib/queryClient";
import {
  RiPlayLine,
  RiPauseLine,
  RiDownloadLine,
  RiTimeLine,
  RiFileTextLine,
  RiAlertLine,
  RiShieldLine,
  RiPencilLine,
  RiCloseLine,
  RiSaveLine,
  RiHistoryLine,
  RiAwardLine,
  RiDashboard3Line,
  RiShieldKeyholeLine,
  RiClipboardLine,
  RiBrainLine,
  RiVoiceprintLine,
  RiCheckLine,
  RiKeyLine,
  RiInputMethodLine,
  RiRefreshLine,
  RiGlobalLine,
  RiTranslate2,
} from "@remixicon/react";

// Language code to display name lookup
const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  it: "Italian",
  pt: "Portuguese",
  nl: "Dutch",
  pl: "Polish",
  ru: "Russian",
  zh: "Chinese",
  ja: "Japanese",
  ko: "Korean",
  ar: "Arabic",
  hi: "Hindi",
  tr: "Turkish",
  sv: "Swedish",
  da: "Danish",
  no: "Norwegian",
  fi: "Finnish",
  he: "Hebrew",
  vi: "Vietnamese",
  th: "Thai",
  id: "Indonesian",
  ms: "Malay",
  uk: "Ukrainian",
};

interface TranscriptViewerProps {
  callId: string;
}

interface TranscriptWord {
  text: string;
  start: number;
  end: number;
  confidence: number;
  speaker?: string;
}

export default function TranscriptViewer({ callId }: TranscriptViewerProps) {
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const audioRef = useRef<HTMLAudioElement>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Current user context — needed for HIPAA-compliant audit trail on corrections
  const { data: currentUser } = useQuery<AuthUser>({
    queryKey: ["/api/auth/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    staleTime: Infinity,
  });

  const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2];

  const cycleSpeed = useCallback(() => {
    setPlaybackRate((prev) => {
      const idx = SPEED_OPTIONS.indexOf(prev);
      const next = SPEED_OPTIONS[(idx + 1) % SPEED_OPTIONS.length];
      if (audioRef.current) audioRef.current.playbackRate = next;
      return next;
    });
  }, []);

  // Manual edit state
  const [isEditing, setIsEditing] = useState(false);
  const [editScore, setEditScore] = useState("");
  const [editSummary, setEditSummary] = useState("");
  const [editReason, setEditReason] = useState("");
  const [editSubScores, setEditSubScores] = useState<Record<string, string>>({});
  const [editActionItems, setEditActionItems] = useState<string[]>([]);

  // Confidence display state
  const [showConfidence, setShowConfidence] = useState(false);

  // Transcript correction state
  const [showCorrectionMode, setShowCorrectionMode] = useState(false);
  const [pendingCorrections, setPendingCorrections] = useState<Map<number, string>>(new Map());
  const [editingWordIndex, setEditingWordIndex] = useState<number | null>(null);
  const [wordEditValue, setWordEditValue] = useState("");

  // Warn before navigating away with unsaved edits or corrections
  useBeforeUnload(
    (isEditing && (editScore !== "" || editSummary !== "" || editReason !== "")) ||
      (showCorrectionMode && pendingCorrections.size > 0),
  );

  const { data: call, isLoading } = useQuery<CallWithDetails>({
    queryKey: ["/api/calls", callId],
  });

  const editMutation = useMutation({
    mutationFn: async (payload: { updates: Record<string, any>; reason: string }) => {
      const res = await csrfFetch(`/api/calls/${callId}/analysis`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to save edit");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/calls", callId] });
      setIsEditing(false);
      setEditReason("");
    },
  });

  const reanalyzeMutation = useMutation({
    mutationFn: async () => {
      const res = await csrfFetch(`/api/calls/${callId}/reanalyze`, {
        method: "POST",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to start reanalysis");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/calls", callId] });
    },
  });

  const correctionMutation = useMutation({
    mutationFn: async (payload: { corrections: any[]; correctedText: string }) => {
      const res = await csrfFetch(`/api/calls/${callId}/transcript`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `Failed to save corrections (HTTP ${res.status})`);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/calls", callId] });
      setShowCorrectionMode(false);
      setPendingCorrections(new Map());
      setEditingWordIndex(null);
      toast({ title: "Corrections saved", description: "Transcript corrections have been applied." });
    },
    onError: (error) => {
      toast({ title: "Save Failed", description: error.message, variant: "destructive" });
    },
  });

  const startEditing = () => {
    setEditScore(call?.analysis?.performanceScore?.toString() || "");
    setEditSummary(call?.analysis?.summary?.toString() || "");
    setEditReason("");
    const subs = call?.analysis?.subScores as Record<string, number> | undefined;
    setEditSubScores({
      compliance: subs?.compliance?.toString() || "",
      customerExperience: subs?.customerExperience?.toString() || "",
      communication: subs?.communication?.toString() || "",
      resolution: subs?.resolution?.toString() || "",
    });
    const items = call?.analysis?.actionItems;
    setEditActionItems(
      Array.isArray(items)
        ? items.map((item: unknown) =>
            typeof item === "string"
              ? item
              : typeof item === "object" && item !== null
                ? (item as any).text || JSON.stringify(item)
                : String(item || ""),
          )
        : [],
    );
    setIsEditing(true);
  };

  const handleSaveEdit = () => {
    if (!editReason.trim()) return;
    const updates: Record<string, any> = {};
    if (editScore !== (call?.analysis?.performanceScore?.toString() || "")) {
      updates.performanceScore = editScore;
    }
    if (editSummary !== (call?.analysis?.summary?.toString() || "")) {
      updates.summary = editSummary;
    }
    // Check if action items changed
    const origItems = Array.isArray(call?.analysis?.actionItems)
      ? (call!.analysis!.actionItems as unknown[]).map((i: unknown) => (typeof i === "string" ? i : String(i)))
      : [];
    const cleanedItems = editActionItems.filter((i) => i.trim());
    if (JSON.stringify(cleanedItems) !== JSON.stringify(origItems)) {
      updates.actionItems = cleanedItems;
    }
    if (Object.keys(updates).length === 0) {
      setIsEditing(false);
      return;
    }
    editMutation.mutate({ updates, reason: editReason.trim() });
  };

  // Build keyword set from detected topics for highlighting
  // MUST be called before any early returns to respect Rules of Hooks
  const topicKeywords = useMemo(() => {
    try {
      if (!call?.analysis?.topics || !Array.isArray(call.analysis.topics)) return [];
      return (call.analysis.topics as unknown[])
        .map((t) => {
          if (typeof t === "string") return t;
          if (t && typeof t === "object") {
            const obj = t as Record<string, unknown>;
            return typeof obj.text === "string"
              ? obj.text
              : typeof obj.name === "string"
                ? obj.name
                : JSON.stringify(t);
          }
          return String(t ?? "");
        })
        .filter((t) => t.length >= 3)
        .map((t) => t.toLowerCase());
    } catch {
      return [];
    }
  }, [call?.analysis?.topics]);

  // Sync audio time with transcript highlight
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTimeUpdate = () => setCurrentTime(audio.currentTime * 1000);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => setIsPlaying(false);
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
    };
  }, [call]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RiVoiceprintLine className="w-8 h-8 animate-spin text-primary" />
        <p className="ml-2 text-muted-foreground">Analyzing performance...</p>
      </div>
    );
  }

  if (!call) {
    return (
      <div className="bg-card rounded-lg border border-border p-6">
        <div className="text-center py-12">
          <p className="text-muted-foreground">Call not found</p>
        </div>
      </div>
    );
  }

  // AssemblyAI word timestamps are in milliseconds
  const formatTimestamp = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const getSentimentColor = (sentiment?: string) => {
    switch (sentiment) {
      case "positive":
        return "sentiment-positive";
      case "negative":
        return "sentiment-negative";
      default:
        return "sentiment-neutral";
    }
  };

  const transcriptSegments = useMemo(() => {
    if (call.transcript?.words && Array.isArray(call.transcript.words) && call.transcript.words.length > 0) {
      return generateSegmentsFromWords(call.transcript.words as TranscriptWord[]);
    }
    return [];
  }, [call.transcript?.words]);

  function generateSegmentsFromWords(words: TranscriptWord[]) {
    const segments: any[] = [];
    if (!words || !Array.isArray(words) || words.length === 0) return segments;

    const first = words[0];
    if (!first || typeof first !== "object") return segments;

    let currentSegment = {
      start: first.start || 0,
      end: first.end || 0,
      text: first.text || "",
      speaker: first.speaker || "Agent",
      sentiment: "neutral" as const,
    };

    words.slice(1).forEach((word) => {
      const timeGap = word.start - currentSegment.end;
      const speakerChange = word.speaker && word.speaker !== currentSegment.speaker;

      if (timeGap > 2000 || speakerChange) {
        segments.push({ ...currentSegment });
        currentSegment = {
          start: word.start,
          end: word.end,
          text: word.text,
          speaker: word.speaker || currentSegment.speaker,
          sentiment: "neutral" as const,
        };
      } else {
        currentSegment.text += " " + word.text;
        currentSegment.end = word.end;
      }
    });

    segments.push(currentSegment);
    return segments;
  }

  const jumpToTime = (timeMs: number) => {
    const audio = audioRef.current;
    if (audio) {
      audio.currentTime = timeMs / 1000;
      if (!isPlaying) {
        audio.play().catch(() => {});
      }
    }
    setCurrentTime(timeMs);
  };

  const handleWordClick = (wordIndex: number, wordText: string) => {
    if (!showCorrectionMode) return;
    setEditingWordIndex(wordIndex);
    setWordEditValue(pendingCorrections.get(wordIndex) ?? wordText);
  };

  const handleWordEditConfirm = (wordIndex: number, original: string) => {
    if (wordEditValue.trim() && wordEditValue.trim() !== original) {
      setPendingCorrections((prev) => new Map(prev).set(wordIndex, wordEditValue.trim()));
    } else if (!wordEditValue.trim() || wordEditValue.trim() === original) {
      // Remove correction if reverted to original
      setPendingCorrections((prev) => {
        const next = new Map(prev);
        next.delete(wordIndex);
        return next;
      });
    }
    setEditingWordIndex(null);
    setWordEditValue("");
  };

  const handleSaveCorrections = () => {
    const words = call?.transcript?.words as TranscriptWord[] | undefined;
    if (!words || pendingCorrections.size === 0) return;
    const user = currentUser?.name || currentUser?.username || "Unknown";
    const now = new Date().toISOString();
    const corrections = Array.from(pendingCorrections.entries()).map(([wordIndex, corrected]) => ({
      wordIndex,
      original: words[wordIndex]?.text || "",
      corrected,
      correctedBy: user,
      correctedAt: now,
    }));
    // Build corrected full text
    const correctedWords = words.map((w, i) => pendingCorrections.get(i) ?? w.text);
    const correctedText = correctedWords.join(" ");
    correctionMutation.mutate({ corrections, correctedText });
  };

  const togglePlayPause = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
    } else {
      audio.play().catch(() => {});
    }
  };

  const handleDownloadAudio = () => {
    window.open(`/api/calls/${callId}/audio?download=true`, "_blank");
  };

  const handleExportTranscript = () => {
    if (!call.transcript?.text && transcriptSegments.length === 0) return;

    // Build a text export with metadata
    const lines: string[] = [];
    lines.push(`Call Transcript Export`);
    lines.push(`=====================`);
    lines.push(`Employee: ${call.employee?.name || "Unknown"}`);
    lines.push(`Date: ${call.uploadedAt ? new Date(call.uploadedAt).toLocaleString() : "Unknown"}`);
    lines.push(`Duration: ${call.duration ? `${Math.floor(call.duration / 60)}m ${call.duration % 60}s` : "Unknown"}`);
    lines.push(`Status: ${call.status}`);
    if (call.sentiment?.overallSentiment) {
      lines.push(`Sentiment: ${call.sentiment.overallSentiment}`);
    }
    if (call.analysis?.performanceScore) {
      lines.push(`Performance Score: ${Number(call.analysis.performanceScore).toFixed(1)}/10`);
    }
    lines.push("");
    lines.push(`Transcript`);
    lines.push(`----------`);

    if (transcriptSegments.length > 0) {
      for (const seg of transcriptSegments) {
        const speaker = seg.speaker === "Agent" ? `Agent (${call.employee?.name})` : "Customer";
        lines.push(`[${formatTimestamp(seg.start)}] ${speaker}:`);
        lines.push(`  ${seg.text}`);
        lines.push("");
      }
    } else if (call.transcript?.text) {
      lines.push(call.transcript.text);
    }

    if (call.analysis?.summary) {
      lines.push("");
      lines.push(`Summary`);
      lines.push(`-------`);
      lines.push(call.analysis.summary);
    }

    if (
      call.analysis?.actionItems &&
      Array.isArray(call.analysis.actionItems) &&
      call.analysis.actionItems.length > 0
    ) {
      lines.push("");
      lines.push(`Action Items`);
      lines.push(`------------`);
      call.analysis.actionItems.forEach((item: unknown, i: number) => {
        const text =
          typeof item === "string"
            ? item
            : typeof item === "object" && item !== null
              ? (item as any).text || (item as any).task || JSON.stringify(item)
              : String(item);
        lines.push(`${i + 1}. ${text}`);
      });
    }

    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `transcript-${callId}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const highlightKeywords = (text: string | any) => {
    if (typeof text !== "string") return String(text ?? "");
    if (topicKeywords.length === 0) return text;
    const pattern = topicKeywords.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    const regex = new RegExp(`(${pattern})`, "gi");
    const parts = text.split(regex);
    return parts.map((part, i) =>
      topicKeywords.includes(part.toLowerCase()) ? (
        <mark key={i} className="bg-primary/15 text-primary rounded px-0.5">
          {part}
        </mark>
      ) : (
        part
      ),
    );
  };

  // Determine which segment is currently active based on audio time
  const activeSegmentIndex = transcriptSegments.findIndex((seg, i) => {
    const nextStart = transcriptSegments[i + 1]?.start ?? Infinity;
    return currentTime >= seg.start && currentTime < nextStart;
  });

  // Detected language info
  const detectedLang = (call.analysis as any)?.detectedLanguage as string | undefined;
  const isNonEnglish = detectedLang && detectedLang !== "en";
  const langName = detectedLang ? LANGUAGE_NAMES[detectedLang] || detectedLang.toUpperCase() : undefined;

  return (
    <div className="bg-card rounded-lg border border-border p-6" data-testid="transcript-viewer">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Call Transcript</h3>
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm text-muted-foreground">
              {call.employee?.name} • {new Date(call.uploadedAt || "").toLocaleDateString()}
            </p>
            {langName &&
              (isNonEnglish ? (
                <Badge className="bg-amber-200 text-amber-900 dark:bg-amber-900 dark:text-amber-200 text-xs flex items-center gap-1">
                  <RiTranslate2 className="w-3 h-3" />
                  Non-English: {langName}
                </Badge>
              ) : (
                <Badge variant="outline" className="text-xs flex items-center gap-1">
                  <RiGlobalLine className="w-3 h-3" />
                  {langName}
                </Badge>
              ))}
          </div>
        </div>
        <div className="flex items-center space-x-2 flex-wrap gap-y-1">
          {call.transcript?.words && Array.isArray(call.transcript.words) && call.transcript.words.length > 0 && (
            <>
              <Button
                variant={showConfidence ? "default" : "outline"}
                size="sm"
                onClick={() => {
                  setShowConfidence((v) => !v);
                  if (showCorrectionMode) setShowCorrectionMode(false);
                }}
                title="Toggle word-level confidence highlighting"
              >
                <RiShieldKeyholeLine className="w-4 h-4 mr-1" />
                {showConfidence ? "Hide Confidence" : "Show Confidence"}
              </Button>
              <Button
                variant={showCorrectionMode ? "default" : "outline"}
                size="sm"
                onClick={() => {
                  setShowCorrectionMode((v) => !v);
                  if (showConfidence) setShowConfidence(false);
                  if (!showCorrectionMode) {
                    setPendingCorrections(new Map());
                    setEditingWordIndex(null);
                  }
                }}
                title="Correct transcript words"
              >
                <RiPencilLine className="w-4 h-4 mr-1" />
                {showCorrectionMode ? "Exit Corrections" : "Correct Transcript"}
              </Button>
            </>
          )}
          <Button variant="outline" size="sm" onClick={handleExportTranscript} data-testid="export-transcript">
            <RiFileTextLine className="w-4 h-4 mr-1" />
            Export
          </Button>
          <Button variant="outline" size="sm" onClick={handleDownloadAudio} data-testid="download-audio">
            <RiDownloadLine className="w-4 h-4 mr-1" />
            Download
          </Button>
          <Button size="sm" onClick={togglePlayPause} data-testid="play-audio">
            {isPlaying ? <RiPauseLine className="w-4 h-4 mr-1" /> : <RiPlayLine className="w-4 h-4 mr-1" />}
            {isPlaying ? "Pause" : "Play Audio"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={cycleSpeed}
            title="Playback speed"
            className="w-16 text-xs font-mono"
          >
            <RiDashboard3Line className="w-3 h-3 mr-1" />
            {playbackRate}x
          </Button>
        </div>
      </div>

      {/* Hidden audio element that streams from S3 via the API */}
      <audio ref={audioRef} src={`/api/calls/${callId}/audio`} preload="metadata" />

      {/* AI analysis failure banner */}
      {call.analysis?.confidenceFactors &&
        typeof call.analysis.confidenceFactors === "object" &&
        (call.analysis.confidenceFactors as Record<string, unknown>).aiAnalysisCompleted === false && (
          <div className="mb-4 rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 p-3 flex items-start gap-3">
            <RiBrainLine className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">AI analysis unavailable</p>
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                The AI provider could not analyze this call. Scores shown are defaults (5.0) and do not reflect actual
                performance. Check that your AWS Bedrock credentials are valid, or re-upload the call to retry analysis.
              </p>
            </div>
          </div>
        )}

      {/* Audio progress bar */}
      {audioRef.current && (
        <div className="mb-4">
          <div className="flex items-center space-x-3">
            <span className="text-xs text-muted-foreground w-10 text-right">{formatTimestamp(currentTime)}</span>
            <input
              type="range"
              className="flex-1 h-1.5 accent-primary cursor-pointer"
              min={0}
              max={(audioRef.current?.duration || 0) * 1000}
              value={currentTime}
              onChange={(e) => {
                const ms = Number(e.target.value);
                if (audioRef.current) audioRef.current.currentTime = ms / 1000;
                setCurrentTime(ms);
              }}
            />
            <span className="text-xs text-muted-foreground w-10">
              {formatTimestamp((audioRef.current?.duration || 0) * 1000)}
            </span>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <div className="bg-muted rounded-lg p-4 max-h-96 overflow-y-auto">
            {call.status !== "completed" ? (
              <div className="text-center py-8">
                <p className="text-muted-foreground">
                  {call.status === "processing" ? "Transcript is being processed..." : "Transcript not available"}
                </p>
              </div>
            ) : call.transcript?.text ? (
              <>
                {/* Word-by-word view for confidence or correction mode */}
                {(showConfidence || showCorrectionMode) &&
                call.transcript?.words &&
                Array.isArray(call.transcript.words) &&
                (call.transcript.words as TranscriptWord[]).length > 0 ? (
                  <div className="space-y-3">
                    {showCorrectionMode && (
                      <div className="text-xs text-muted-foreground bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded p-2 mb-2">
                        Click any word to correct it. Low-confidence words are underlined in amber.
                        {pendingCorrections.size > 0 && (
                          <span className="ml-2 font-semibold text-amber-700 dark:text-amber-300">
                            {pendingCorrections.size} pending correction{pendingCorrections.size > 1 ? "s" : ""}
                          </span>
                        )}
                      </div>
                    )}
                    {showConfidence && (
                      <div className="text-xs text-muted-foreground mb-2 flex items-center gap-3">
                        <span className="font-medium">Confidence:</span>
                        <span className="text-amber-600">Amber text = 70–85%</span>
                        <span className="bg-amber-200 text-amber-900 px-1 rounded">Amber bg = &lt;70%</span>
                        <span className="text-foreground">Normal = ≥85%</span>
                      </div>
                    )}
                    <div className="leading-relaxed flex flex-wrap gap-1">
                      {(call.transcript.words as TranscriptWord[]).map((word, wordIndex) => {
                        const isPending = pendingCorrections.has(wordIndex);
                        const correctedText = pendingCorrections.get(wordIndex);
                        const isLowConf = word.confidence < 0.7;
                        const isMedConf = !isLowConf && word.confidence < 0.85;

                        // Confidence styling
                        let confClass = "";
                        if (showConfidence) {
                          if (isLowConf)
                            confClass =
                              "bg-amber-200 text-amber-900 dark:bg-amber-900 dark:text-amber-200 rounded px-0.5";
                          else if (isMedConf) confClass = "text-amber-600 dark:text-amber-400";
                        }

                        // Correction styling
                        let corrClass = "";
                        if (showCorrectionMode) {
                          if (isPending)
                            corrClass =
                              "text-green-700 dark:text-green-400 font-semibold cursor-pointer hover:opacity-80";
                          else if (isLowConf)
                            corrClass = "underline decoration-amber-400 cursor-pointer hover:opacity-80";
                          else corrClass = "cursor-pointer hover:opacity-80";
                        }

                        if (showCorrectionMode && editingWordIndex === wordIndex) {
                          return (
                            <span key={wordIndex} className="inline-flex items-center gap-0.5">
                              <input
                                autoFocus
                                className="border border-primary rounded px-1 py-0.5 text-xs w-24"
                                value={wordEditValue}
                                onChange={(e) => setWordEditValue(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") handleWordEditConfirm(wordIndex, word.text);
                                  if (e.key === "Escape") {
                                    setEditingWordIndex(null);
                                    setWordEditValue("");
                                  }
                                }}
                                onBlur={() => handleWordEditConfirm(wordIndex, word.text)}
                              />
                            </span>
                          );
                        }

                        return (
                          <span
                            key={wordIndex}
                            className={`inline-block ${confClass} ${corrClass}`}
                            title={showConfidence ? `Confidence: ${(word.confidence * 100).toFixed(0)}%` : undefined}
                            onClick={() => handleWordClick(wordIndex, isPending ? correctedText! : word.text)}
                            {...(showCorrectionMode ? {
                              role: "button" as const,
                              tabIndex: 0,
                              "aria-label": `${isPending ? "Edit correction for" : "Correct"} "${word.text}"`,
                              onKeyDown: (e: React.KeyboardEvent) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  handleWordClick(wordIndex, isPending ? correctedText! : word.text);
                                }
                              },
                            } : {})}
                          >
                            {isPending ? (
                              <>
                                <span className="line-through text-muted-foreground text-xs">{word.text}</span>
                                <span className="ml-0.5 text-green-700 dark:text-green-400">{correctedText}</span>
                              </>
                            ) : (
                              word.text
                            )}
                          </span>
                        );
                      })}
                    </div>
                    {showCorrectionMode && (
                      <div className="flex items-center gap-2 mt-3 pt-2 border-t border-border">
                        <Button
                          size="sm"
                          onClick={handleSaveCorrections}
                          disabled={pendingCorrections.size === 0 || correctionMutation.isPending}
                          className="h-7 text-xs"
                        >
                          <RiSaveLine className="w-3 h-3 mr-1" />
                          {correctionMutation.isPending
                            ? "Saving..."
                            : `Save ${pendingCorrections.size} Correction${pendingCorrections.size !== 1 ? "s" : ""}`}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setPendingCorrections(new Map());
                            setEditingWordIndex(null);
                          }}
                          disabled={correctionMutation.isPending}
                          className="h-7 text-xs"
                        >
                          <RiCloseLine className="w-3 h-3 mr-1" /> Clear
                        </Button>
                        {correctionMutation.isError && (
                          <p className="text-xs text-red-500">{correctionMutation.error?.message}</p>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {transcriptSegments.map((segment, index) => (
                      <div
                        key={index}
                        className={`transcript-line p-2 rounded cursor-pointer transition-colors ${
                          index === activeSegmentIndex ? "bg-primary/10 ring-1 ring-primary/30" : ""
                        }`}
                        onClick={() => jumpToTime(segment.start)}
                        data-testid={`transcript-segment-${index}`}
                      >
                        <div className="flex items-start space-x-3">
                          <button
                            className="text-xs text-muted-foreground bg-background px-2 py-1 rounded hover:bg-primary hover:text-primary-foreground"
                            onClick={() => jumpToTime(segment.start)}
                          >
                            <RiTimeLine className="w-3 h-3 mr-1 inline" />
                            {formatTimestamp(segment.start)}
                          </button>
                          <div className="flex-1">
                            <p
                              className={`text-sm font-medium ${segment.speaker === "Agent" ? "text-primary" : "text-gray-600"}`}
                            >
                              {segment.speaker === "Agent" ? `Agent (${call.employee?.name}):` : "Customer:"}
                            </p>
                            <p className="text-foreground">{highlightKeywords(segment.text)}</p>
                          </div>
                          <Badge className={getSentimentColor(segment.sentiment)}>
                            {segment.sentiment.charAt(0).toUpperCase() + segment.sentiment.slice(1)}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-8">
                <p className="text-muted-foreground">No transcript text available</p>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4">
          {/* Manual Edit Indicator */}
          {call.analysis?.manualEdits &&
            Array.isArray(call.analysis.manualEdits) &&
            (call.analysis.manualEdits as any[]).length > 0 && (
              <div className="bg-amber-50 dark:bg-amber-950/30 rounded-lg p-3 border border-amber-200 dark:border-amber-900">
                <div className="flex items-center gap-1.5 text-amber-700 dark:text-amber-400 text-xs font-medium mb-1">
                  <RiHistoryLine className="w-3.5 h-3.5" />
                  Manually Edited ({(call.analysis.manualEdits as any[]).length} edit
                  {(call.analysis.manualEdits as any[]).length > 1 ? "s" : ""})
                </div>
                {(call.analysis.manualEdits as any[]).map((edit: any, i: number) => (
                  <div key={i} className="text-xs text-muted-foreground mt-1 pl-5">
                    <span className="font-medium">{edit.editedBy}</span> — {edit.reason}
                    <span className="text-muted-foreground/60 ml-1">
                      ({new Date(edit.editedAt).toLocaleDateString()} {new Date(edit.editedAt).toLocaleTimeString()})
                    </span>
                  </div>
                ))}
              </div>
            )}

          <div className="bg-muted rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-semibold text-foreground">Call Summary</h4>
              {!isEditing && call.analysis && (
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={startEditing} className="h-7 text-xs">
                    <RiPencilLine className="w-3 h-3 mr-1" /> Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={() => reanalyzeMutation.mutate()}
                    disabled={reanalyzeMutation.isPending || call.status !== "completed"}
                    title="Re-run AI analysis with current prompt templates"
                  >
                    <RiRefreshLine className="w-3 h-3 mr-1" />{" "}
                    {reanalyzeMutation.isPending ? "Reanalyzing..." : "Reanalyze"}
                  </Button>
                </div>
              )}
            </div>

            {isEditing ? (
              <div className="space-y-3">
                <div>
                  <Label className="text-xs">Performance Score (0-10)</Label>
                  <Input
                    type="number"
                    min="0"
                    max="10"
                    step="0.1"
                    value={editScore}
                    onChange={(e) => setEditScore(e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>
                <div>
                  <Label className="text-xs">Summary</Label>
                  <textarea
                    value={editSummary}
                    onChange={(e) => setEditSummary(e.target.value)}
                    className="w-full min-h-[80px] rounded-md border border-input bg-background px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <Label className="text-xs">Action Items</Label>
                  <div className="space-y-1">
                    {editActionItems.map((item, i) => (
                      <div key={i} className="flex gap-1">
                        <Input
                          value={item}
                          onChange={(e) => {
                            const next = [...editActionItems];
                            next[i] = e.target.value;
                            setEditActionItems(next);
                          }}
                          className="h-7 text-xs"
                          placeholder={`Action item ${i + 1}`}
                        />
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0 shrink-0"
                          onClick={() => setEditActionItems(editActionItems.filter((_, j) => j !== i))}
                        >
                          <RiCloseLine className="w-3 h-3" />
                        </Button>
                      </div>
                    ))}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 text-xs"
                      onClick={() => setEditActionItems([...editActionItems, ""])}
                    >
                      + Add Item
                    </Button>
                  </div>
                </div>
                <div>
                  <Label className="text-xs text-red-600">Reason for Edit *</Label>
                  <Input
                    value={editReason}
                    onChange={(e) => setEditReason(e.target.value)}
                    placeholder="Why is this edit needed?"
                    className="h-8 text-sm"
                  />
                </div>
                {editMutation.isError && <p className="text-xs text-red-500">{editMutation.error?.message}</p>}
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={handleSaveEdit}
                    disabled={!editReason.trim() || editMutation.isPending}
                    className="h-7 text-xs"
                  >
                    <RiSaveLine className="w-3 h-3 mr-1" /> {editMutation.isPending ? "Saving..." : "Save"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setIsEditing(false)} className="h-7 text-xs">
                    <RiCloseLine className="w-3 h-3 mr-1" /> Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-2 text-sm">
                <p>
                  <strong>Duration:</strong>{" "}
                  {call.duration ? `${Math.floor(call.duration / 60)}m ${call.duration % 60}s` : "Unknown"}
                </p>
                <p>
                  <strong>Status:</strong> <Badge>{call.status}</Badge>
                </p>
                <p>
                  <strong>Sentiment:</strong>{" "}
                  {call.sentiment?.overallSentiment && typeof call.sentiment.overallSentiment === "string" ? (
                    <Badge className={getSentimentColor(call.sentiment.overallSentiment)}>
                      {call.sentiment.overallSentiment.charAt(0).toUpperCase() +
                        call.sentiment.overallSentiment.slice(1)}
                    </Badge>
                  ) : (
                    "Unknown"
                  )}
                </p>
                <p>
                  <strong>Performance Score:</strong>{" "}
                  {call.analysis?.performanceScore ? Number(call.analysis.performanceScore).toFixed(1) : "N/A"}/10
                </p>
                {call.analysis?.subScores && (
                  <div className="mt-2 pt-2 border-t border-border space-y-1.5">
                    {[
                      {
                        label: "Compliance",
                        key: "compliance",
                        color: "text-blue-600",
                        bar: "from-blue-500 to-blue-400",
                      },
                      {
                        label: "Customer Exp.",
                        key: "customerExperience",
                        color: "text-green-600",
                        bar: "from-green-500 to-emerald-400",
                      },
                      {
                        label: "Communication",
                        key: "communication",
                        color: "text-purple-600",
                        bar: "from-purple-500 to-violet-400",
                      },
                      {
                        label: "Resolution",
                        key: "resolution",
                        color: "text-amber-600",
                        bar: "from-amber-500 to-yellow-400",
                      },
                    ].map((dim) => {
                      const val = (call.analysis!.subScores as any)?.[dim.key];
                      if (val == null) return null;
                      return (
                        <div key={dim.key}>
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground">{dim.label}</span>
                            <span className={`font-semibold ${dim.color}`}>{Number(val).toFixed(1)}</span>
                          </div>
                          <div className="w-full h-1.5 bg-muted-foreground/20 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full bg-gradient-to-r ${dim.bar}`}
                              style={{ width: `${Number(val) * 10}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                {call.analysis?.detectedAgentName && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    <strong>Detected Agent:</strong> {toDisplayString(call.analysis.detectedAgentName)}
                  </p>
                )}
              </div>
            )}
          </div>

          {!isEditing && call.analysis?.summary && typeof call.analysis.summary === "string" && (
            <div className="bg-muted rounded-lg p-4">
              <h4 className="font-semibold text-foreground mb-3">Key Points</h4>
              <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
                {call.analysis.summary
                  .split("\n")
                  .map((point, index) => point.trim() && <li key={index}>{point.trim().replace(/^- /, "")}</li>)}
              </ul>
            </div>
          )}

          {call.analysis?.topics && Array.isArray(call.analysis.topics) && call.analysis.topics.length > 0 && (
            <div className="bg-muted rounded-lg p-4">
              <h4 className="font-semibold text-foreground mb-3">Key Topics</h4>
              <div className="flex flex-wrap gap-2">
                {call.analysis.topics.map((topic: unknown, index: number) => (
                  <Badge key={index} variant="outline" className="bg-primary/10 text-primary">
                    {toDisplayString(topic)}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {call.analysis?.actionItems &&
            Array.isArray(call.analysis.actionItems) &&
            call.analysis.actionItems.length > 0 && (
              <div className="bg-muted rounded-lg p-4">
                <h4 className="font-semibold text-foreground mb-3">Action Items</h4>
                <ul className="space-y-1 text-sm">
                  {call.analysis.actionItems.map((item: unknown, index: number) => (
                    <li key={index} className="flex items-center space-x-2">
                      <div className="w-2 h-2 bg-green-600 rounded-full"></div>
                      <span>{toDisplayString(item)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

          {call.analysis?.feedback &&
            typeof call.analysis.feedback === "object" &&
            !Array.isArray(call.analysis.feedback) && (
              <div className="bg-muted rounded-lg p-4">
                <h4 className="font-semibold text-foreground mb-3">AI Feedback</h4>
                <div className="space-y-2 text-sm">
                  {Array.isArray((call.analysis.feedback as any).strengths) &&
                    (call.analysis.feedback as any).strengths.length > 0 && (
                      <div>
                        <p className="font-medium text-green-600">Strengths:</p>
                        <ul className="space-y-1.5 text-muted-foreground">
                          {(call.analysis.feedback as any).strengths.map((item: unknown, index: number) => {
                            const text = toDisplayString(item);
                            const ts = typeof item === "object" && item !== null ? (item as any).timestamp : null;
                            return (
                              <li key={index} className="flex items-start gap-2">
                                <span className="text-green-500 mt-0.5 shrink-0">+</span>
                                <span className="flex-1">{text}</span>
                                {ts && (
                                  <button
                                    className="text-xs bg-background text-primary px-1.5 py-0.5 rounded hover:bg-primary hover:text-primary-foreground shrink-0"
                                    onClick={() => {
                                      const parts = ts.split(":");
                                      const ms = (parseInt(parts[0]) * 60 + parseInt(parts[1])) * 1000;
                                      jumpToTime(ms);
                                    }}
                                  >
                                    <RiTimeLine className="w-3 h-3 mr-0.5 inline" />
                                    {ts}
                                  </button>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    )}
                  {Array.isArray((call.analysis.feedback as any).suggestions) &&
                    (call.analysis.feedback as any).suggestions.length > 0 && (
                      <div>
                        <p className="font-medium text-primary">Suggestions:</p>
                        <ul className="space-y-1.5 text-muted-foreground">
                          {(call.analysis.feedback as any).suggestions.map((item: unknown, index: number) => {
                            const text = toDisplayString(item);
                            const ts = typeof item === "object" && item !== null ? (item as any).timestamp : null;
                            return (
                              <li key={index} className="flex items-start gap-2">
                                <span className="text-amber-500 mt-0.5 shrink-0">!</span>
                                <span className="flex-1">{text}</span>
                                {ts && (
                                  <button
                                    className="text-xs bg-background text-primary px-1.5 py-0.5 rounded hover:bg-primary hover:text-primary-foreground shrink-0"
                                    onClick={() => {
                                      const parts = ts.split(":");
                                      const ms = (parseInt(parts[0]) * 60 + parseInt(parts[1])) * 1000;
                                      jumpToTime(ms);
                                    }}
                                  >
                                    <RiTimeLine className="w-3 h-3 mr-0.5 inline" />
                                    {ts}
                                  </button>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    )}
                </div>
              </div>
            )}

          {/* Call Flags */}
          {call.analysis?.flags &&
            Array.isArray(call.analysis.flags) &&
            (call.analysis.flags as unknown[]).length > 0 &&
            (() => {
              const flags = (call.analysis.flags as unknown[]).map((f) => toDisplayString(f));
              const hasExceptional = flags.includes("exceptional_call");
              const hasBad = flags.some((f) => f === "low_score" || f.startsWith("agent_misconduct"));
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
                    <HeaderIcon className="w-4 h-4" /> Flags
                  </h4>
                  <div className="flex flex-wrap gap-1.5">
                    {flags.map((flag: string, i: number) => {
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
                          {isExceptional && <RiAwardLine className="w-3 h-3 mr-1 inline" />}
                          {label}
                        </Badge>
                      );
                    })}
                  </div>
                  {hasBad && call.employee && (
                    <Link
                      href={`/coaching?newSession=true&employeeId=${call.employee.id}&callId=${callId}&category=${flags.some((f) => f.startsWith("agent_misconduct")) ? "compliance" : "general"}`}
                      className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                    >
                      <RiClipboardLine className="w-3.5 h-3.5" /> Create Coaching Session
                    </Link>
                  )}
                </div>
              );
            })()}

          {/* Call Party Type */}
          {call.analysis?.callPartyType && (
            <div className="bg-muted rounded-lg p-4">
              <h4 className="font-semibold text-foreground mb-2 flex items-center gap-1.5">
                <RiShieldLine className="w-4 h-4" /> Call Party
              </h4>
              <Badge variant="outline" className="capitalize">
                {toDisplayString(call.analysis.callPartyType).replace(/_/g, " ")}
              </Badge>
            </div>
          )}

          {/* AI Confidence Score */}
          {call.analysis?.confidenceScore &&
            (() => {
              const raw = call.analysis.confidenceScore;
              const confidence = parseFloat(typeof raw === "string" ? raw : String(raw));
              if (isNaN(confidence)) return null;
              const isLow = confidence < 0.7;
              const pct = (confidence * 100).toFixed(0);
              const factors =
                call.analysis.confidenceFactors && typeof call.analysis.confidenceFactors === "object"
                  ? (call.analysis.confidenceFactors as {
                      transcriptConfidence?: number;
                      wordCount?: number;
                      callDurationSeconds?: number;
                      callDuration?: number;
                    })
                  : undefined;
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
                    <RiShieldKeyholeLine className="w-4 h-4" /> AI Confidence
                  </h4>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-lg font-bold ${isLow ? "text-yellow-600 dark:text-yellow-400" : "text-foreground"}`}
                      >
                        {pct}%
                      </span>
                      {isLow && (
                        <Badge className="bg-yellow-200 text-yellow-900 dark:bg-yellow-900 dark:text-yellow-300 text-xs">
                          Needs Review
                        </Badge>
                      )}
                    </div>
                    <div className="w-full h-2 bg-muted-foreground/20 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full bg-gradient-to-r ${barColor}`}
                        style={{ width: `${pct}%` }}
                      />
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
            })()}
        </div>
      </div>
    </div>
  );
}
