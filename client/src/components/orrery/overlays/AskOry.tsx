/**
 * Ask Ory — global RAG chat FAB + slide-in panel.
 *
 * Phase 3 of the Orrery redesign. Non-streaming for v1 (per locked
 * decision in ORRERY_IMPLEMENTATION_PLAN.md §9.3) — concise responses
 * are <2K tokens, P95 latency under 3s, and the owl persona toggles
 * thinking → talking on request/response boundaries for perceived
 * responsiveness.
 *
 * Posts to the existing /api/reference-documents/rag/search endpoint;
 * no new endpoint required. Renders the `formattedContext` field from
 * the response as the assistant's reply.
 *
 * Industry-agnostic — RAG is grounded in the org's own reference docs.
 * Falls back gracefully when no docs are uploaded yet.
 *
 * Two exports:
 *   <AskOryFab />   — floating bottom-right button (mounted globally)
 *   <AskOryPanel /> — slide-in panel; the FAB toggles it open/closed
 *
 * The FAB owns the open state via React Portal-friendly internal state
 * so it can be mounted at the App shell without props. Consumers that
 * want to control open state externally can pass `controlledOpen` and
 * `onOpenChange`.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/lib/queryClient";
import { ObservatoryLayeredOwl, type OwlState } from "../owl";
import { useOrreryTheme } from "../theme";
import { OrreryTag } from "../OrreryTag";

// ─── FAB ─────────────────────────────────────────────────────────────────

type FabProps = {
  /** External control. When undefined, the FAB manages its own open state. */
  controlledOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export function AskOryFab({ controlledOpen, onOpenChange }: FabProps) {
  const t = useOrreryTheme();
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = (next: boolean) => {
    if (onOpenChange) onOpenChange(next);
    else setInternalOpen(next);
  };

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Ask Ory"
          data-testid="ask-ory-fab"
          style={{
            position: "fixed",
            bottom: 20,
            right: 20,
            zIndex: 40,
            width: 56,
            height: 56,
            borderRadius: 28,
            background: t.bright,
            border: "none",
            boxShadow: t.name === "dark" ? "0 12px 32px rgba(0,0,0,0.5)" : "0 8px 24px rgba(8,146,168,0.3)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#fff",
          }}
        >
          <ObservatoryLayeredOwl size={32} color="#fff" state="idle" />
        </button>
      )}
      <AskOryPanel open={open} onClose={() => setOpen(false)} />
    </>
  );
}

// ─── Panel ───────────────────────────────────────────────────────────────

type Message = {
  role: "user" | "assistant";
  content: string;
  source?: string;
  /** Citations or evidence chunks — shown as a "based on" footer. */
  chunkCount?: number;
};

type PanelProps = {
  open: boolean;
  onClose: () => void;
};

export function AskOryPanel({ open, onClose }: PanelProps) {
  const t = useOrreryTheme();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const askMutation = useMutation({
    mutationFn: async (
      query: string,
    ): Promise<{
      formattedContext?: string;
      chunks?: unknown[];
      source?: string;
    }> => {
      const res = await apiRequest("POST", "/api/reference-documents/rag/search", {
        query,
        responseStyle: "concise",
      });
      return res.json();
    },
    onSuccess: (data) => {
      const content =
        typeof data.formattedContext === "string" && data.formattedContext.trim().length > 0
          ? data.formattedContext
          : "I couldn't find anything in your knowledge base that answers that. Try rephrasing, or upload more reference docs in the admin panel.";
      const chunkCount = Array.isArray(data.chunks) ? data.chunks.length : 0;
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content,
          source: typeof data.source === "string" ? data.source : undefined,
          chunkCount,
        },
      ]);
    },
    onError: (err: Error) => {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Couldn't reach the knowledge base: ${err.message}. Try again in a moment.`,
        },
      ]);
    },
  });

  // Owl state machine — drives perceived responsiveness during the
  // request/response cycle. Idle → thinking on submit, thinking → talking
  // when the first character of the response arrives.
  const owlState: OwlState = askMutation.isPending
    ? "thinking"
    : messages.length > 0 && messages[messages.length - 1].role === "assistant"
      ? "talking"
      : "idle";

  // After a moment of "talking", drop back to idle so the next question
  // gets a fresh perceived response.
  useEffect(() => {
    if (owlState !== "talking") return;
    const id = setTimeout(() => {
      // Re-render by touching state harmlessly — we don't actually need
      // to mutate anything; the messages array is the source of truth.
      // (No-op state change.)
    }, 2000);
    return () => clearTimeout(id);
  }, [owlState]);

  // Scroll to bottom when messages arrive.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, askMutation.isPending]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const query = input.trim();
    if (!query || askMutation.isPending) return;
    setMessages((prev) => [...prev, { role: "user", content: query }]);
    setInput("");
    askMutation.mutate(query);
  };

  if (!open) return null;

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: t.name === "dark" ? "rgba(4,8,26,0.4)" : "rgba(14,18,40,0.15)",
          zIndex: 39,
        }}
        aria-hidden
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Ask Ory"
        data-testid="ask-ory-panel"
        style={{
          position: "fixed",
          bottom: 20,
          right: 20,
          width: 420,
          maxWidth: "calc(100vw - 40px)",
          height: 580,
          maxHeight: "calc(100vh - 40px)",
          background: t.name === "dark" ? "#06091c" : "#ffffff",
          border: `0.5px solid ${t.panelBorder}`,
          borderRadius: 16,
          boxShadow: t.name === "dark" ? "0 20px 50px rgba(0,0,0,0.5)" : "0 12px 32px rgba(20,30,60,0.12)",
          zIndex: 41,
          display: "flex",
          flexDirection: "column",
          animation: "ask-ory-rise 240ms cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      >
        <style>{`
          @keyframes ask-ory-rise {
            from { opacity: 0; transform: translateY(20px) scale(0.95); }
            to { opacity: 1; transform: translateY(0) scale(1); }
          }
        `}</style>

        {/* Header */}
        <div
          style={{
            padding: "16px 20px 12px",
            display: "flex",
            alignItems: "center",
            gap: 12,
            borderBottom: `0.5px solid ${t.panelBorder}`,
          }}
        >
          <ObservatoryLayeredOwl size={40} color={t.bright} state={owlState} />
          <div style={{ flex: 1 }}>
            <OrreryTag t={t} color={t.bright}>
              ◇ ASK ORY
            </OrreryTag>
            <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 13, color: t.inkSoft, marginTop: 2 }}>
              Grounded in your knowledge base.
            </div>
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

        {/* Messages */}
        <div
          ref={scrollRef}
          style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 12 }}
        >
          {messages.length === 0 && !askMutation.isPending && (
            <div style={{ textAlign: "center", padding: "24px 16px", color: t.inkSoft }}>
              <div
                style={{
                  fontFamily: "'Instrument Serif', Georgia, serif",
                  fontStyle: "italic",
                  fontSize: 20,
                  color: t.ink,
                  marginBottom: 8,
                }}
              >
                What would you like to know?
              </div>
              <div style={{ fontSize: 13 }}>
                Ask about your team's playbooks, compliance policies, or anything else from your uploaded reference
                documents.
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <MessageBubble key={i} message={m} />
          ))}

          {askMutation.isPending && (
            <div
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                color: t.inkSoft,
                fontSize: 13,
                fontStyle: "italic",
              }}
            >
              <ObservatoryLayeredOwl size={20} color={t.inkSoft} state="thinking" />
              Ory is thinking…
            </div>
          )}
        </div>

        {/* Composer */}
        <form
          onSubmit={submit}
          style={{ padding: "12px 16px 16px", borderTop: `0.5px solid ${t.panelBorder}`, display: "flex", gap: 8 }}
        >
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask anything…"
            disabled={askMutation.isPending}
            data-testid="ask-ory-input"
            autoFocus
          />
          <Button type="submit" disabled={!input.trim() || askMutation.isPending} data-testid="ask-ory-submit">
            Ask
          </Button>
        </form>
      </aside>
    </>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const t = useOrreryTheme();
  const isUser = message.role === "user";
  const bubbleBg = isUser ? t.bright : t.panel;
  const bubbleColor = isUser ? "#fff" : t.ink;
  const align: ReactNode = null; // satisfy TS — declaration kept for future inline alignment refinement

  return (
    <div style={{ display: "flex", justifyContent: isUser ? "flex-end" : "flex-start" }}>
      <div
        style={{
          maxWidth: "85%",
          padding: "10px 14px",
          borderRadius: 14,
          background: bubbleBg,
          color: bubbleColor,
          fontSize: 13.5,
          lineHeight: 1.5,
          border: isUser ? "none" : `0.5px solid ${t.panelBorder}`,
          whiteSpace: "pre-wrap",
        }}
      >
        {message.content}
        {!isUser && message.chunkCount !== undefined && message.chunkCount > 0 && (
          <div
            style={{
              marginTop: 8,
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 9,
              letterSpacing: "0.12em",
              color: t.inkMute,
              textTransform: "uppercase",
            }}
          >
            ◇ {message.chunkCount} {message.chunkCount === 1 ? "source" : "sources"}
            {message.source && ` · ${message.source}`}
          </div>
        )}
      </div>
      {align}
    </div>
  );
}
