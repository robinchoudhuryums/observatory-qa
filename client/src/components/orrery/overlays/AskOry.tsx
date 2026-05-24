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
            // Offset upward so we don't overlap the FeedbackWidget (which sits
            // at bottom-4 right-4 with z-50). Without this offset, the
            // FeedbackWidget intercepts pointer events targeting the FAB.
            bottom: 80,
            right: 20,
            // z-index above the FeedbackWidget's z-50 so the FAB stays the
            // topmost interactive control in the bottom-right corner.
            zIndex: 60,
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
  const [isStreaming, setIsStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  /**
   * Streaming fetch — POST to the SSE endpoint, read the response body
   * chunk-by-chunk, and append each `data:` payload to the current
   * assistant message in real time. Falls back to the non-streaming
   * endpoint on any error (network, 503, malformed SSE).
   *
   * Sprint 2 (D5/A5).
   */
  const streamQuery = async (query: string) => {
    setIsStreaming(true);
    const controller = new AbortController();
    abortRef.current = controller;

    // Optimistic: add an empty assistant message that we'll fill progressively.
    const assistantIdx = messages.length + 1; // +1 because user message is appended first
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    try {
      const csrfCookie = document.cookie.match(/csrf-token=([^;]+)/)?.[1] || "";
      const res = await fetch("/api/reference-documents/rag/stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfCookie,
        },
        credentials: "include",
        body: JSON.stringify({ query, responseStyle: "concise" }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        throw new Error(`Stream failed: ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let chunkCount = 0;
      let source: string | undefined;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Parse SSE lines from buffer
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const payload = JSON.parse(line.slice(6));
              if (typeof payload.text === "string") {
                setMessages((prev) => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if (last?.role === "assistant") {
                    updated[updated.length - 1] = {
                      ...last,
                      content: last.content + payload.text,
                    };
                  }
                  return updated;
                });
              }
              if (typeof payload.chunkCount === "number") chunkCount = payload.chunkCount;
              if (typeof payload.source === "string") source = payload.source;
            } catch {
              // malformed JSON line — skip
            }
          }
        }
      }

      // Finalize — set chunkCount + source on the assistant message.
      setMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last?.role === "assistant") {
          updated[updated.length - 1] = { ...last, chunkCount, source };
        }
        return updated;
      });
    } catch (error: any) {
      if (error.name === "AbortError") return;
      // Fallback to non-streaming endpoint
      try {
        const res = await apiRequest("POST", "/api/reference-documents/rag/search", {
          query,
          responseStyle: "concise",
        });
        const data = await res.json();
        const content =
          typeof data.formattedContext === "string" && data.formattedContext.trim().length > 0
            ? data.formattedContext
            : "I couldn't find anything in your knowledge base that answers that.";
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last?.role === "assistant") {
            updated[updated.length - 1] = {
              ...last,
              content,
              chunkCount: Array.isArray(data.chunks) ? data.chunks.length : 0,
              source: data.source,
            };
          }
          return updated;
        });
      } catch (fallbackErr: any) {
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last?.role === "assistant") {
            updated[updated.length - 1] = {
              ...last,
              content: `Couldn't reach the knowledge base: ${fallbackErr.message}. Try again in a moment.`,
            };
          }
          return updated;
        });
      }
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  };

  // Owl state machine — drives perceived responsiveness. Streaming mode:
  // thinking while waiting for first chunk, talking while streaming in,
  // idle when done.
  const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null;
  const owlState: OwlState = isStreaming
    ? lastMsg?.role === "assistant" && lastMsg.content.length > 0
      ? "talking"
      : "thinking"
    : lastMsg?.role === "assistant" && lastMsg.content.length > 0
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
  }, [messages, isStreaming]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const query = input.trim();
    if (!query || isStreaming) return;
    setMessages((prev) => [...prev, { role: "user", content: query }]);
    setInput("");
    streamQuery(query);
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
          {messages.length === 0 && !isStreaming && (
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

          {isStreaming && (
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
            disabled={isStreaming}
            data-testid="ask-ory-input"
            autoFocus
          />
          <Button type="submit" disabled={!input.trim() || isStreaming} data-testid="ask-ory-submit">
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
