/**
 * Simulated Call Generator — admin UI for the TTS-rendered training/QA
 * call feature. Manager+ on Professional+ plans only (gated server-side
 * by `requirePlanFeature("simulatedCallsEnabled")`).
 *
 * Layout:
 *   - Header with "New simulated call" button.
 *   - Library table of all org rows with status badges, audio playback,
 *     send-to-analysis, delete. Polls every 5s while any row is in a
 *     non-terminal state (pending / generating).
 *   - Builder dialog (visual turn editor): title + scenario, voice picker
 *     dropdowns, quality tier, circumstance multi-select, ordered turn
 *     list with add/move/remove, audio config toggles.
 *
 * Voice list is fetched from /api/simulated-calls/voices (server-cached).
 * Falls back to a single text input if ElevenLabs isn't configured.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, csrfFetch } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { CIRCUMSTANCE_META, type Circumstance, type SimulatedCall, type SimulatedTurn } from "@shared/schema";
import {
  RiAddLine,
  RiArrowDownSLine,
  RiArrowUpSLine,
  RiDeleteBinLine,
  RiPlayCircleLine,
  RiPauseCircleLine,
  RiSendPlane2Line,
  RiCheckboxCircleLine,
  RiTimeLine,
  RiErrorWarningLine,
  RiLoader4Line,
} from "@remixicon/react";

// ── Types ───────────────────────────────────────────────────────────

interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  category?: string;
}

interface DraftTurn {
  speaker: "agent" | "customer" | "hold";
  text?: string;
  duration?: number;
}

interface DraftScript {
  title: string;
  scenario: string;
  qualityTier: "excellent" | "acceptable" | "poor";
  agentVoice: string;
  customerVoice: string;
  turns: DraftTurn[];
  circumstances: Circumstance[];
  disfluencies: boolean;
  backchannels: boolean;
  gapMeanSeconds: number;
}

const DEFAULT_DRAFT: DraftScript = {
  title: "",
  scenario: "",
  qualityTier: "acceptable",
  agentVoice: "",
  customerVoice: "",
  turns: [
    { speaker: "agent", text: "Thanks for calling — how can I help you today?" },
    { speaker: "customer", text: "I have a question about my account." },
  ],
  circumstances: [],
  disfluencies: true,
  backchannels: true,
  gapMeanSeconds: 0.8,
};

// ── Status badge ────────────────────────────────────────────────────

function StatusBadge({ status }: { status: SimulatedCall["status"] }) {
  switch (status) {
    case "pending":
      return (
        <Badge variant="secondary" className="gap-1">
          <RiTimeLine className="w-3 h-3" /> Pending
        </Badge>
      );
    case "generating":
      return (
        <Badge variant="secondary" className="gap-1 bg-blue-500/10 text-blue-700 dark:text-blue-300">
          <RiLoader4Line className="w-3 h-3 animate-spin" /> Generating
        </Badge>
      );
    case "ready":
      return (
        <Badge className="gap-1 bg-green-500/10 text-green-700 dark:text-green-300 hover:bg-green-500/20">
          <RiCheckboxCircleLine className="w-3 h-3" /> Ready
        </Badge>
      );
    case "failed":
      return (
        <Badge variant="destructive" className="gap-1">
          <RiErrorWarningLine className="w-3 h-3" /> Failed
        </Badge>
      );
  }
}

// ── Audio player (uses GET /api/simulated-calls/:id/audio) ─────────

function AudioPlayer({ id }: { id: string }) {
  const [playing, setPlaying] = useState(false);
  const [audio] = useState(() => new Audio(`/api/simulated-calls/${id}/audio`));

  useEffect(() => {
    const onEnd = () => setPlaying(false);
    audio.addEventListener("ended", onEnd);
    return () => {
      audio.pause();
      audio.removeEventListener("ended", onEnd);
    };
  }, [audio]);

  const toggle = () => {
    if (playing) {
      audio.pause();
      setPlaying(false);
    } else {
      audio
        .play()
        .then(() => setPlaying(true))
        .catch(() => setPlaying(false));
    }
  };

  return (
    <Button size="sm" variant="ghost" onClick={toggle} aria-label={playing ? "Pause" : "Play"}>
      {playing ? <RiPauseCircleLine className="w-4 h-4" /> : <RiPlayCircleLine className="w-4 h-4" />}
    </Button>
  );
}

// ── Turn editor ────────────────────────────────────────────────────

function TurnEditor({ turns, onChange }: { turns: DraftTurn[]; onChange: (turns: DraftTurn[]) => void }) {
  const update = (idx: number, patch: Partial<DraftTurn>) => {
    onChange(turns.map((t, i) => (i === idx ? { ...t, ...patch } : t)));
  };
  const remove = (idx: number) => {
    onChange(turns.filter((_, i) => i !== idx));
  };
  const move = (idx: number, dir: -1 | 1) => {
    const next = [...turns];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    onChange(next);
  };

  return (
    <div className="space-y-2">
      {turns.map((turn, idx) => (
        <div
          key={idx}
          className="flex items-start gap-2 rounded-md border border-border bg-muted/30 p-2"
          data-testid={`turn-row-${idx}`}
        >
          <div className="flex flex-col gap-1 pt-1">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-6 w-6 p-0"
              onClick={() => move(idx, -1)}
              disabled={idx === 0}
              aria-label="Move up"
            >
              <RiArrowUpSLine className="w-3 h-3" />
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-6 w-6 p-0"
              onClick={() => move(idx, 1)}
              disabled={idx === turns.length - 1}
              aria-label="Move down"
            >
              <RiArrowDownSLine className="w-3 h-3" />
            </Button>
          </div>
          <div className="flex-1 space-y-2">
            <div className="flex items-center gap-2">
              <Badge
                variant={turn.speaker === "agent" ? "default" : turn.speaker === "customer" ? "secondary" : "outline"}
              >
                {turn.speaker}
              </Badge>
              {turn.speaker === "hold" ? (
                <div className="flex items-center gap-2">
                  <Label htmlFor={`turn-${idx}-duration`} className="text-xs text-muted-foreground">
                    Duration (s)
                  </Label>
                  <Input
                    id={`turn-${idx}-duration`}
                    type="number"
                    min={1}
                    max={300}
                    value={turn.duration ?? 30}
                    onChange={(e) =>
                      update(idx, { duration: Math.max(1, Math.min(300, Number(e.target.value) || 30)) })
                    }
                    className="w-20 h-8"
                  />
                </div>
              ) : null}
            </div>
            {turn.speaker !== "hold" && (
              <Textarea
                value={turn.text ?? ""}
                onChange={(e) => update(idx, { text: e.target.value })}
                placeholder={`What does the ${turn.speaker} say?`}
                className="min-h-[60px] text-sm"
                maxLength={2000}
              />
            )}
          </div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => remove(idx)}
            disabled={turns.length === 1}
            aria-label="Remove turn"
            className="text-muted-foreground hover:text-destructive"
          >
            <RiDeleteBinLine className="w-4 h-4" />
          </Button>
        </div>
      ))}

      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => onChange([...turns, { speaker: "agent", text: "" }])}
        >
          <RiAddLine className="w-3 h-3 mr-1" /> Agent turn
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => onChange([...turns, { speaker: "customer", text: "" }])}
        >
          <RiAddLine className="w-3 h-3 mr-1" /> Customer turn
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => onChange([...turns, { speaker: "hold", duration: 30 }])}
        >
          <RiAddLine className="w-3 h-3 mr-1" /> Hold
        </Button>
      </div>
    </div>
  );
}

// ── Builder dialog ─────────────────────────────────────────────────

function BuilderDialog({
  open,
  onOpenChange,
  voices,
  voicesError,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  voices: ElevenLabsVoice[];
  voicesError: boolean;
}) {
  const [draft, setDraft] = useState<DraftScript>(DEFAULT_DRAFT);
  const { toast } = useToast();

  // Reset draft when dialog re-opens, so each new build starts clean.
  useEffect(() => {
    if (open) setDraft(DEFAULT_DRAFT);
  }, [open]);

  const createMutation = useMutation({
    mutationFn: async (body: unknown) => {
      const res = await csrfFetch("/api/simulated-calls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `HTTP ${res.status}`);
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Simulated call queued", description: "Generation will run in the background." });
      queryClient.invalidateQueries({ queryKey: ["/api/simulated-calls"] });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({ title: "Failed to create simulated call", description: err.message, variant: "destructive" });
    },
  });

  const submit = () => {
    if (!draft.title.trim()) {
      toast({ title: "Title is required", variant: "destructive" });
      return;
    }
    if (!draft.agentVoice || !draft.customerVoice) {
      toast({ title: "Both voices must be selected", variant: "destructive" });
      return;
    }
    if (draft.turns.length === 0) {
      toast({ title: "Add at least one turn", variant: "destructive" });
      return;
    }
    const turns: SimulatedTurn[] = draft.turns.map((t) => {
      if (t.speaker === "hold") return { speaker: "hold", duration: t.duration ?? 30 };
      return { speaker: t.speaker, text: t.text ?? "" };
    });
    const body = {
      title: draft.title.trim(),
      scenario: draft.scenario.trim() || undefined,
      qualityTier: draft.qualityTier,
      script: {
        title: draft.title.trim(),
        scenario: draft.scenario.trim() || undefined,
        qualityTier: draft.qualityTier,
        voices: { agent: draft.agentVoice, customer: draft.customerVoice },
        turns,
      },
      config: {
        circumstances: draft.circumstances,
        disfluencies: draft.disfluencies,
        backchannels: draft.backchannels,
        gapMeanSeconds: draft.gapMeanSeconds,
      },
    };
    createMutation.mutate(body);
  };

  const toggleCircumstance = (c: Circumstance) => {
    setDraft((d) => ({
      ...d,
      circumstances: d.circumstances.includes(c) ? d.circumstances.filter((x) => x !== c) : [...d.circumstances, c],
    }));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New simulated call</DialogTitle>
          <DialogDescription>
            Build a script with agent + customer turns. The TTS pipeline will render the conversation as audio.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Title + scenario */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="sim-title">Title</Label>
              <Input
                id="sim-title"
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder="e.g. Insurance verification call"
                maxLength={500}
              />
            </div>
            <div>
              <Label htmlFor="sim-tier">Quality tier</Label>
              <Select
                value={draft.qualityTier}
                onValueChange={(v) => setDraft({ ...draft, qualityTier: v as DraftScript["qualityTier"] })}
              >
                <SelectTrigger id="sim-tier">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="excellent">Excellent (no fillers)</SelectItem>
                  <SelectItem value="acceptable">Acceptable (some fillers)</SelectItem>
                  <SelectItem value="poor">Poor (many fillers)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label htmlFor="sim-scenario">Scenario (optional)</Label>
            <Textarea
              id="sim-scenario"
              value={draft.scenario}
              onChange={(e) => setDraft({ ...draft, scenario: e.target.value })}
              placeholder="Optional context — e.g. 'Customer is calling to dispute a charge'"
              maxLength={2000}
              className="min-h-[60px]"
            />
          </div>

          {/* Voices */}
          {voicesError ? (
            <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-900/20 p-3 text-sm">
              <p className="font-medium">ElevenLabs is not configured.</p>
              <p className="text-muted-foreground">
                Enter voice IDs manually below, or set <code>ELEVENLABS_API_KEY</code> on the server.
              </p>
              <div className="grid grid-cols-2 gap-2 mt-2">
                <Input
                  value={draft.agentVoice}
                  onChange={(e) => setDraft({ ...draft, agentVoice: e.target.value })}
                  placeholder="Agent voice ID"
                />
                <Input
                  value={draft.customerVoice}
                  onChange={(e) => setDraft({ ...draft, customerVoice: e.target.value })}
                  placeholder="Customer voice ID"
                />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="sim-agent-voice">Agent voice</Label>
                <Select value={draft.agentVoice} onValueChange={(v) => setDraft({ ...draft, agentVoice: v })}>
                  <SelectTrigger id="sim-agent-voice">
                    <SelectValue placeholder="Select voice" />
                  </SelectTrigger>
                  <SelectContent>
                    {voices.map((v) => (
                      <SelectItem key={v.voice_id} value={v.voice_id}>
                        {v.name}
                        {v.category ? <span className="text-muted-foreground"> · {v.category}</span> : null}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="sim-customer-voice">Customer voice</Label>
                <Select value={draft.customerVoice} onValueChange={(v) => setDraft({ ...draft, customerVoice: v })}>
                  <SelectTrigger id="sim-customer-voice">
                    <SelectValue placeholder="Select voice" />
                  </SelectTrigger>
                  <SelectContent>
                    {voices.map((v) => (
                      <SelectItem key={v.voice_id} value={v.voice_id}>
                        {v.name}
                        {v.category ? <span className="text-muted-foreground"> · {v.category}</span> : null}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {/* Turns */}
          <div>
            <Label>Conversation turns</Label>
            <p className="text-xs text-muted-foreground mb-2">
              Order matters — the audio renders top-to-bottom. Hold turns insert silence.
            </p>
            <TurnEditor turns={draft.turns} onChange={(turns) => setDraft({ ...draft, turns })} />
          </div>

          {/* Circumstances */}
          <div>
            <Label>Circumstances</Label>
            <p className="text-xs text-muted-foreground mb-2">
              Rule-based circumstances (deterministic) and LLM-based (Bedrock rewrite) modify the script.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-1">
              {(Object.keys(CIRCUMSTANCE_META) as Circumstance[]).map((c) => {
                const meta = CIRCUMSTANCE_META[c];
                return (
                  <label key={c} className="flex items-start gap-2 cursor-pointer rounded p-1.5 hover:bg-muted/40">
                    <Checkbox
                      checked={draft.circumstances.includes(c)}
                      onCheckedChange={() => toggleCircumstance(c)}
                      id={`circ-${c}`}
                    />
                    <div className="text-sm">
                      <span className="font-medium">{meta.label}</span>
                      <span className="ml-1 text-xs text-muted-foreground">
                        {meta.ruleBased ? "(rule-based)" : "(LLM)"}
                      </span>
                      <p className="text-xs text-muted-foreground">{meta.description}</p>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Audio config */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2 border-t border-border">
            <div className="flex items-center justify-between">
              <Label htmlFor="sim-disfluencies" className="cursor-pointer">
                Disfluencies
              </Label>
              <Switch
                id="sim-disfluencies"
                checked={draft.disfluencies}
                onCheckedChange={(v) => setDraft({ ...draft, disfluencies: v })}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="sim-backchannels" className="cursor-pointer">
                Backchannels
              </Label>
              <Switch
                id="sim-backchannels"
                checked={draft.backchannels}
                onCheckedChange={(v) => setDraft({ ...draft, backchannels: v })}
              />
            </div>
            <div>
              <Label htmlFor="sim-gap" className="text-xs">
                Avg gap between turns (s)
              </Label>
              <Input
                id="sim-gap"
                type="number"
                min={0}
                max={10}
                step={0.1}
                value={draft.gapMeanSeconds}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    gapMeanSeconds: Math.max(0, Math.min(10, Number(e.target.value) || 0.8)),
                  })
                }
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={createMutation.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={createMutation.isPending}>
            {createMutation.isPending ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Page ────────────────────────────────────────────────────────────

export default function SimulatedCallsPage() {
  const [builderOpen, setBuilderOpen] = useState(false);
  const { toast } = useToast();

  const { data: rows = [] } = useQuery<SimulatedCall[]>({
    queryKey: ["/api/simulated-calls"],
    refetchInterval: (q) => {
      // Poll every 5s while any row is in a non-terminal state.
      const data = (q.state.data as SimulatedCall[] | undefined) ?? [];
      const hasInflight = data.some((r) => r.status === "pending" || r.status === "generating");
      return hasInflight ? 5000 : false;
    },
  });

  const { data: voices = [], isError: voicesError } = useQuery<ElevenLabsVoice[]>({
    queryKey: ["/api/simulated-calls/voices"],
    staleTime: 60 * 60 * 1000,
    enabled: builderOpen, // Only fetch when the builder opens
    retry: false,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await csrfFetch(`/api/simulated-calls/${id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) throw new Error(`HTTP ${res.status}`);
    },
    onSuccess: () => {
      toast({ title: "Simulated call deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/simulated-calls"] });
    },
    onError: (err: Error) => {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
    },
  });

  const sendToAnalysis = useMutation({
    mutationFn: async (id: string) => {
      const res = await csrfFetch(`/api/simulated-calls/${id}/send-to-analysis`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `HTTP ${res.status}`);
      }
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Sent to analysis",
        description: `Created call ${data.callId.slice(0, 8)}… — view in Transcripts.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/simulated-calls"] });
    },
    onError: (err: Error) => {
      toast({ title: "Send to analysis failed", description: err.message, variant: "destructive" });
    },
  });

  const sortedRows = useMemo(
    () => [...rows].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "")),
    [rows],
  );

  return (
    <div className="container py-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Simulated Calls</h1>
          <p className="text-muted-foreground text-sm">
            Generate synthetic training/QA calls and feed them back through the analysis pipeline.
          </p>
        </div>
        <Button onClick={() => setBuilderOpen(true)} data-testid="new-simulated-call">
          <RiAddLine className="w-4 h-4 mr-1" /> New simulated call
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Library</CardTitle>
          <CardDescription>{sortedRows.length} total</CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          {sortedRows.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-12">
              No simulated calls yet — click "New simulated call" to get started.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {sortedRows.map((row) => (
                <div key={row.id} className="flex items-center gap-3 px-6 py-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{row.title}</span>
                      <StatusBadge status={row.status} />
                      {row.qualityTier && (
                        <Badge variant="outline" className="text-xs">
                          {row.qualityTier}
                        </Badge>
                      )}
                    </div>
                    {row.scenario && <p className="text-xs text-muted-foreground truncate">{row.scenario}</p>}
                    {row.error && row.status === "failed" && (
                      <p className="text-xs text-destructive truncate" title={row.error}>
                        {row.error}
                      </p>
                    )}
                    {row.status === "ready" && (
                      <p className="text-xs text-muted-foreground">
                        {row.durationSeconds ? `${row.durationSeconds}s` : ""} ·{" "}
                        {row.ttsCharCount ? `${row.ttsCharCount} chars` : ""} ·{" "}
                        {row.estimatedCost ? `$${row.estimatedCost.toFixed(4)}` : ""}
                        {row.sentToAnalysisCallId ? " · sent to analysis" : ""}
                      </p>
                    )}
                  </div>
                  {row.status === "ready" && <AudioPlayer id={row.id} />}
                  {row.status === "ready" && !row.sentToAnalysisCallId && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => sendToAnalysis.mutate(row.id)}
                      disabled={sendToAnalysis.isPending}
                    >
                      <RiSendPlane2Line className="w-3 h-3 mr-1" />
                      Send to analysis
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      if (window.confirm(`Delete "${row.title}"?`)) deleteMutation.mutate(row.id);
                    }}
                    disabled={deleteMutation.isPending}
                    aria-label="Delete"
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <RiDeleteBinLine className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <BuilderDialog open={builderOpen} onOpenChange={setBuilderOpen} voices={voices} voicesError={voicesError} />
    </div>
  );
}
