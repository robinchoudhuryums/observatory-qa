/**
 * Coach-this-call panel — right-rail overlay that drafts a coaching session
 * from a specific moment on the call arc. Manager clicks a moment, clicks
 * "Coach this", panel slides in with an Ory-drafted brief (title, category,
 * framing) that the manager edits and submits.
 *
 * Posts to POST /api/coaching with the same shape the existing coaching.tsx
 * form uses, so backend changes aren't needed.
 *
 * Industry-agnostic — the suggested framing is built from the moment's own
 * label + tone (which already came from real data), no hardcoded dental
 * playbook templates.
 */
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { Moment } from "@/lib/orrery-adapters";
import type { Theme } from "../theme";
import { OrreryTag } from "../OrreryTag";

type Props = {
  t: Theme;
  open: boolean;
  onClose: () => void;
  callId: string;
  callName: string;
  /** Optional employee to pre-select as the coaching subject. */
  employeeId?: string | null;
  employeeName?: string | null;
  /** The moment that triggered the panel. Drives the prefilled framing. */
  moment?: Moment | null;
  /** Override the suggested category. Useful for "Coach this whole call" entry. */
  defaultCategory?: string;
};

const SUGGESTED_CATEGORIES = [
  { value: "Communication", label: "Communication" },
  { value: "Compliance", label: "Compliance" },
  { value: "Empathy", label: "Empathy" },
  { value: "Discovery", label: "Discovery" },
  { value: "Closing", label: "Closing" },
  { value: "Follow-up", label: "Follow-up" },
  { value: "Other", label: "Other" },
];

export function CoachThisCallPanel({
  t,
  open,
  onClose,
  callId,
  callName,
  employeeId,
  employeeName,
  moment,
  defaultCategory,
}: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Derive an initial title + framing from the moment's data.
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<string>(defaultCategory || "Communication");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!open) return;
    // Re-seed the form whenever the panel opens with a new moment/call.
    const momentLabel = moment?.label || "this call";
    const seedTitle = moment
      ? `Coach: ${momentLabel} (${callName})`
      : `Coach: ${callName}`;
    let seedFraming: string;
    if (!moment) {
      seedFraming = `Reviewing call "${callName}". Use this session to discuss patterns observed across the conversation.`;
    } else if (moment.tone === "amber" || moment.flagged) {
      seedFraming = `At "${momentLabel}" the call hit a difficult turn. Reviewing what happened and discussing alternate approaches.`;
    } else if (moment.tone === "green") {
      seedFraming = `At "${momentLabel}" the call landed exceptionally well. Reinforcing what worked so it can be repeated.`;
    } else if (moment.tone === "cool") {
      seedFraming = `At "${momentLabel}" sentiment dipped. Exploring what triggered it and how to recover earlier next time.`;
    } else if (moment.tone === "warm") {
      seedFraming = `At "${momentLabel}" the conversation turned positive. Naming what worked so it shows up more often.`;
    } else {
      seedFraming = `Reviewing "${momentLabel}" from the call. Discussing context and approach.`;
    }
    setTitle(seedTitle);
    setNotes(seedFraming);
    setCategory(defaultCategory || (moment?.tone === "amber" ? "Communication" : "Communication"));
  }, [open, moment, callName, defaultCategory]);

  const createMutation = useMutation({
    mutationFn: async (payload: {
      title: string;
      category: string;
      notes: string;
      employeeId?: string;
      callId?: string;
    }) => {
      const res = await apiRequest("POST", "/api/coaching", payload);
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Coaching session created",
        description: "Manager + employee will be notified.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/coaching"] });
      onClose();
    },
    onError: (err: Error) => {
      toast({
        title: "Could not create session",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  if (!open) return null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    createMutation.mutate({
      title: title.trim(),
      category,
      notes: notes.trim(),
      employeeId: employeeId || undefined,
      callId,
    });
  };

  return (
    <>
      {/* Backdrop. */}
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: t.name === "dark" ? "rgba(4,8,26,0.4)" : "rgba(14,18,40,0.15)",
          zIndex: 40,
        }}
        aria-hidden
      />
      {/* Panel. */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Coach this call"
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: 420,
          maxWidth: "100vw",
          background: t.name === "dark" ? "#06091c" : "#ffffff",
          borderLeft: `0.5px solid ${t.panelBorder}`,
          boxShadow: t.name === "dark" ? "-20px 0 50px rgba(0,0,0,0.5)" : "-12px 0 32px rgba(20,30,60,0.08)",
          zIndex: 41,
          display: "flex",
          flexDirection: "column",
          animation: "cct-rise 280ms cubic-bezier(0.22, 1, 0.36, 1)",
        }}
        data-testid="coach-this-call-panel"
      >
        <style>{`
          @keyframes cct-rise {
            from { transform: translateX(40px); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
          }
        `}</style>

        <div style={{ padding: "20px 24px 12px", display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div>
            <OrreryTag t={t} color={t.bright}>
              ◇ COACH THIS {moment ? "MOMENT" : "CALL"}
            </OrreryTag>
            <h3
              style={{
                fontFamily: "'Instrument Serif', Georgia, serif",
                fontStyle: "italic",
                fontSize: 22,
                color: t.ink,
                marginTop: 4,
              }}
            >
              {employeeName ? `Brief for ${employeeName}` : "New coaching session"}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "transparent",
              border: "none",
              fontSize: 20,
              color: t.inkMute,
              cursor: "pointer",
            }}
          >
            ×
          </button>
        </div>

        <form onSubmit={submit} style={{ flex: 1, overflowY: "auto", padding: "8px 24px 16px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <Label htmlFor="cct-title" className="text-xs">
              Session title
            </Label>
            <Input
              id="cct-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              data-testid="cct-title"
            />
          </div>
          <div>
            <Label htmlFor="cct-category" className="text-xs">
              Category
            </Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger id="cct-category" data-testid="cct-category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SUGGESTED_CATEGORIES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1">
            <Label htmlFor="cct-notes" className="text-xs">
              Framing (drafted by Ory — edit freely)
            </Label>
            <Textarea
              id="cct-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={8}
              data-testid="cct-notes"
            />
          </div>

          <div className="flex items-center gap-2 pt-2" style={{ borderTop: `0.5px solid ${t.panelBorder}` }}>
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">
              Cancel
            </Button>
            <Button type="submit" disabled={createMutation.isPending || !title.trim()} className="flex-1" data-testid="cct-submit">
              {createMutation.isPending ? "Sending…" : "Send to coach"}
            </Button>
          </div>
        </form>
      </aside>
    </>
  );
}
