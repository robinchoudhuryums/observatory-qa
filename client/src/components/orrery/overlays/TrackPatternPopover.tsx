/**
 * Track-pattern popover. Wired to /api/patterns/subscribe in Phase 3.
 *
 * UX: manager selects a notification trigger (every new instance, statistical
 * spike, daily digest, weekly digest) and an expiry window (7d/30d/never).
 * Submit posts to the backend; toast confirms creation; popover closes.
 *
 * Industry-agnostic — accepts a free-form pattern label rather than a
 * hardcoded set of patterns. Backend stores the patternKey + label so
 * digest emails read sensibly even if cluster labels shift later.
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { Theme } from "../theme";
import { OrreryTag } from "../OrreryTag";

type Trigger = "new_instance" | "sigma_2" | "daily_digest" | "weekly_digest";
type Expiry = "7d" | "30d" | "never";

const TRIGGERS: Array<{ value: Trigger; label: string; description: string }> = [
  { value: "new_instance", label: "Every new occurrence", description: "Notify on every matching call." },
  { value: "sigma_2", label: "Statistically unusual (2σ)", description: "Notify only when frequency spikes." },
  { value: "daily_digest", label: "Daily digest", description: "Summary email at end of day." },
  { value: "weekly_digest", label: "Weekly digest", description: "Summary email each Monday." },
];

const EXPIRIES: Array<{ value: Expiry; label: string }> = [
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "never", label: "No expiry" },
];

type Props = {
  t: Theme;
  open: boolean;
  onClose: () => void;
  /** Anchor element rect from which the popover positions itself. */
  anchorRect?: DOMRect | null;
  patternKey: string;
  patternLabel: string;
};

export function TrackPatternPopover({ t, open, onClose, anchorRect, patternKey, patternLabel }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [trigger, setTrigger] = useState<Trigger>("new_instance");
  const [expiry, setExpiry] = useState<Expiry>("30d");

  const subscribeMutation = useMutation({
    mutationFn: async (payload: {
      patternKey: string;
      patternLabel: string;
      triggerKind: Trigger;
      expiresAt: string | null;
    }) => {
      const res = await apiRequest("POST", "/api/patterns/subscribe", payload);
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Tracking this pattern",
        description: `You'll be notified via "${TRIGGERS.find((t) => t.value === trigger)?.label || trigger}".`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/patterns/subscriptions"] });
      onClose();
    },
    onError: (err: Error) => {
      toast({
        title: "Could not track pattern",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  if (!open) return null;

  /** Convert the popover's relative-time expiry choice into an absolute ISO. */
  const expiryToIso = (choice: Expiry): string | null => {
    if (choice === "never") return null;
    const days = choice === "7d" ? 7 : 30;
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString();
  };

  const submit = () => {
    subscribeMutation.mutate({
      patternKey,
      patternLabel,
      triggerKind: trigger,
      expiresAt: expiryToIso(expiry),
    });
  };

  // Position near the anchor if provided; otherwise center.
  const style: React.CSSProperties = anchorRect
    ? {
        position: "fixed",
        top: Math.min(anchorRect.bottom + 8, window.innerHeight - 280),
        left: Math.min(anchorRect.left, window.innerWidth - 320),
        width: 300,
      }
    : {
        position: "fixed",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        width: 300,
      };

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 50 }} aria-hidden />
      <div
        role="dialog"
        aria-label={`Track pattern: ${patternLabel}`}
        data-testid="track-pattern-popover"
        data-pattern-key={patternKey}
        style={{
          ...style,
          zIndex: 51,
          background: t.name === "dark" ? "#0c1538" : "#ffffff",
          border: `0.5px solid ${t.panelBorder}`,
          borderRadius: 12,
          boxShadow: t.name === "dark" ? "0 20px 50px rgba(0,0,0,0.5)" : "0 12px 32px rgba(20,30,60,0.12)",
          padding: 16,
          animation: "tp-rise 200ms cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      >
        <style>{`
          @keyframes tp-rise { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        `}</style>
        <OrreryTag t={t} color={t.bright}>
          ◇ TRACK PATTERN
        </OrreryTag>
        <div
          style={{
            fontFamily: "'Instrument Serif', Georgia, serif",
            fontStyle: "italic",
            fontSize: 18,
            color: t.ink,
            marginTop: 4,
            marginBottom: 12,
          }}
        >
          {patternLabel}
        </div>

        <div className="space-y-3">
          <div>
            <Label htmlFor="tp-trigger" className="text-xs">
              Notify
            </Label>
            <Select value={trigger} onValueChange={(v) => setTrigger(v as Trigger)}>
              <SelectTrigger id="tp-trigger" data-testid="tp-trigger">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TRIGGERS.map((trg) => (
                  <SelectItem key={trg.value} value={trg.value}>
                    {trg.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">
              {TRIGGERS.find((trg) => trg.value === trigger)?.description}
            </p>
          </div>
          <div>
            <Label htmlFor="tp-expiry" className="text-xs">
              Expires after
            </Label>
            <Select value={expiry} onValueChange={(v) => setExpiry(v as Expiry)}>
              <SelectTrigger id="tp-expiry" data-testid="tp-expiry">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXPIRIES.map((e) => (
                  <SelectItem key={e.value} value={e.value}>
                    {e.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex gap-2 mt-4">
          <Button variant="outline" size="sm" onClick={onClose} className="flex-1">
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={submit}
            className="flex-1"
            disabled={subscribeMutation.isPending}
            data-testid="tp-submit"
          >
            {subscribeMutation.isPending ? "Tracking…" : "Track"}
          </Button>
        </div>
      </div>
    </>
  );
}
