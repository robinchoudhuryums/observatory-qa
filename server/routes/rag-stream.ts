/**
 * RAG streaming endpoint — Server-Sent Events variant of the existing
 * /api/reference-documents/rag/search endpoint.
 *
 * Sprint 2 (D5). The Ask Ory FAB consumes this via fetch + ReadableStream
 * so the owl persona can start "talking" as soon as the first chunk arrives.
 *
 * POST /api/reference-documents/rag/stream
 *   Body: { query: string, responseStyle?: "concise"|"detailed"|"comprehensive" }
 *   Response: text/event-stream
 *     data: { text: "..." }     — one per chunk
 *     event: done
 *     data: { chunkCount: N, source: "rag"|"structured"|"hybrid" }
 *
 * Auth + org-scoped (same middleware as existing search). Rate-limited at
 * the same threshold (20/min via the onboarding rag search limit).
 *
 * Falls back gracefully: if RAG is unavailable (no DB, no docs), sends a
 * single data event with the empty-context message then done.
 */
import type { Express } from "express";
import { storage } from "../storage";
import { requireAuth, injectOrgContext } from "../auth";
import { asyncHandler } from "../middleware/error-handler";
import { logPhiAccess, auditContext } from "../services/audit-log";

export function registerRagStreamRoutes(app: Express): void {
  app.post(
    "/api/reference-documents/rag/stream",
    requireAuth,
    injectOrgContext,
    asyncHandler(async (req, res) => {
      const orgId = req.orgId!;
      const { query, responseStyle: rawStyle } = req.body;

      if (!query || typeof query !== "string") {
        return res.status(400).json({ message: "Query text is required" });
      }

      // SSE headers
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();

      const sendEvent = (event: string | null, data: unknown) => {
        if (event) res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      try {
        if (!process.env.DATABASE_URL) {
          sendEvent(null, { text: "Knowledge base requires PostgreSQL. Upload reference docs in the admin panel." });
          sendEvent("done", { chunkCount: 0, source: "none" });
          res.end();
          return;
        }

        const { getDatabase } = await import("../db/index");
        const db = getDatabase();
        if (!db) {
          sendEvent(null, { text: "Database not available." });
          sendEvent("done", { chunkCount: 0, source: "none" });
          res.end();
          return;
        }

        // Check for structured short-circuit first
        const { classifyQueryRoute, getStructuredAnswer } = await import("../services/rag");
        const queryRoute = classifyQueryRoute(query);
        if (queryRoute === "structured") {
          const structured = await getStructuredAnswer(db as any, orgId, query);
          if (structured) {
            sendEvent(null, { text: structured.answer });
            sendEvent("done", { chunkCount: 0, source: "structured" });
            logPhiAccess({
              ...auditContext(req),
              event: "rag_stream_search",
              resourceType: "rag",
              detail: `structured short-circuit`,
            });
            res.end();
            return;
          }
        }

        // Full RAG search
        const docs = await storage.listReferenceDocuments(orgId);
        const activeDocIds = docs.filter((d) => d.isActive).map((d) => d.id);

        if (activeDocIds.length === 0) {
          sendEvent(null, {
            text: "No reference documents uploaded yet. Add docs in the Knowledge Base section to give Ory something to search.",
          });
          sendEvent("done", { chunkCount: 0, source: "none" });
          res.end();
          return;
        }

        const { RESPONSE_STYLE_CONFIG } = await import("../services/rag");
        type ResponseStyle = "concise" | "detailed" | "comprehensive";
        const responseStyle: ResponseStyle = (
          ["concise", "detailed", "comprehensive"].includes(rawStyle) ? rawStyle : "detailed"
        ) as ResponseStyle;
        const styleConfig = RESPONSE_STYLE_CONFIG[responseStyle];

        const { searchRelevantChunks, formatRetrievedContext } = await import("../services/rag");
        const chunks = await searchRelevantChunks(db as any, orgId, query, activeDocIds, {
          topK: styleConfig.topK,
        });

        const formatted = formatRetrievedContext(chunks);

        // Stream the formatted context in ~200-char segments to simulate
        // progressive rendering. Real LLM streaming would replace this
        // with token-by-token output.
        const SEGMENT_SIZE = 200;
        for (let i = 0; i < formatted.length; i += SEGMENT_SIZE) {
          const segment = formatted.slice(i, i + SEGMENT_SIZE);
          sendEvent(null, { text: segment });
          // Tiny yield so the client can process each event
          await new Promise((r) => setTimeout(r, 30));
        }

        if (formatted.length === 0) {
          sendEvent(null, {
            text: "I couldn't find anything in your knowledge base that answers that. Try rephrasing.",
          });
        }

        sendEvent("done", {
          chunkCount: chunks.length,
          source: queryRoute === "hybrid" ? "hybrid" : "rag",
          responseStyle,
        });

        logPhiAccess({
          ...auditContext(req),
          event: "rag_stream_search",
          resourceType: "rag",
          detail: `${chunks.length} chunks, style=${responseStyle}`,
        });
      } catch (error: any) {
        if (error?.code === "RAG_INJECTION_BLOCKED") {
          sendEvent(null, { text: "Query blocked for safety reasons. Please rephrase." });
        } else {
          sendEvent(null, { text: "An error occurred while searching. Try again." });
        }
        sendEvent("done", { chunkCount: 0, source: "error" });
      }

      res.end();
    }),
  );
}
