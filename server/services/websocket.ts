/**
 * WebSocket service for broadcasting real-time call processing updates to connected clients.
 * HIPAA: Connections are authenticated via session cookie verification.
 * Multi-tenant: Updates are scoped to the user's organization.
 */
import { WebSocketServer, WebSocket } from "ws";
import type { Server, ServerResponse, IncomingMessage } from "http";
import { sessionMiddleware, resolveUserOrgId } from "../auth";
import { logger } from "../services/logger";

let wss: WebSocketServer | null = null;

// Per-org client sets for O(m) broadcast where m = org clients, not total clients
const orgClients = new Map<string, Set<WebSocket>>();
// Reverse map for cleanup on disconnect
const clientOrgMap = new WeakMap<WebSocket, string>();

/** Maximum WebSocket connections per org to prevent resource exhaustion. */
const MAX_CONNECTIONS_PER_ORG = 500;

/** Maximum buffered bytes before closing a slow client. */
const MAX_BUFFERED_AMOUNT = 128 * 1024; // 128 KB

/** Heartbeat interval — ping every 30 seconds. */
const HEARTBEAT_INTERVAL_MS = 30_000;

/** Close connection if no pong received within this time after a ping. */
const PONG_TIMEOUT_MS = 10_000;

// Track alive status for heartbeat
const clientAlive = new WeakMap<WebSocket, boolean>();
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

export function setupWebSocket(server: Server) {
  wss = new WebSocketServer({ noServer: true });

  wss.on("error", (error) => {
    logger.error({ err: error }, "WebSocket server error");
  });

  wss.on("connection", (ws, req) => {
    // orgId was attached during upgrade handler
    const orgId = (req as any).__orgId;
    if (orgId) {
      // Enforce per-org connection limit
      const orgSet = orgClients.get(orgId) || new Set();
      if (orgSet.size >= MAX_CONNECTIONS_PER_ORG) {
        ws.close(1013, "Too many connections for organization");
        return;
      }
      orgSet.add(ws);
      orgClients.set(orgId, orgSet);
      clientOrgMap.set(ws, orgId);
    }

    // Mark as alive for heartbeat
    clientAlive.set(ws, true);

    ws.on("pong", () => {
      clientAlive.set(ws, true);
    });

    ws.send(JSON.stringify({ type: "connected" }));

    ws.on("close", () => {
      cleanupClient(ws, orgId);
    });

    ws.on("error", () => {
      cleanupClient(ws, orgId);
    });
  });

  // Heartbeat: ping all clients every 30s, close unresponsive ones
  heartbeatTimer = setInterval(() => {
    if (!wss) return;
    wss.clients.forEach((ws) => {
      if (clientAlive.get(ws) === false) {
        // Missed last pong — terminate
        const orgId = clientOrgMap.get(ws);
        cleanupClient(ws, orgId);
        ws.terminate();
        return;
      }
      clientAlive.set(ws, false);
      ws.ping();
    });
  }, HEARTBEAT_INTERVAL_MS);
  heartbeatTimer.unref();

  // HIPAA: Authenticate WebSocket connections using the session cookie
  server.on("upgrade", (req: IncomingMessage, socket, head) => {
    // Only handle /ws path
    if (req.url !== "/ws") return;

    // Create a minimal response object for the session middleware
    const res = { writeHead() {}, end() {} } as unknown as ServerResponse;

    sessionMiddleware(req as any, res as any, async () => {
      const session = (req as any).session;
      const passport = session?.passport;

      if (!passport?.user) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      // Resolve orgId from the user's session ID
      const orgId = await resolveUserOrgId(passport.user);
      if (!orgId) {
        socket.write("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n");
        socket.destroy();
        return;
      }
      (req as any).__orgId = orgId;

      wss!.handleUpgrade(req, socket, head, (ws) => {
        wss!.emit("connection", ws, req);
      });
    });
  });

  logger.info("WebSocket server initialized on /ws (heartbeat: 30s, backpressure: 128KB)");
}

function cleanupClient(ws: WebSocket, orgId: string | undefined) {
  if (orgId) {
    const orgSet = orgClients.get(orgId);
    if (orgSet) {
      orgSet.delete(ws);
      if (orgSet.size === 0) orgClients.delete(orgId);
    }
  }
}

/**
 * Broadcast a call processing update to all connected clients in the same organization.
 * orgId is required — updates are always scoped to a single tenant.
 */
export function broadcastCallUpdate(callId: string, status: string, extra: Record<string, any> | undefined, orgId: string) {
  if (!wss) return;
  const message = JSON.stringify({ type: "call_update", callId, status, ...extra });
  // O(m) broadcast: only iterate clients in the target org
  const clients = orgClients.get(orgId);
  if (!clients) return;
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      // Backpressure: skip slow clients whose send buffer is overloaded
      if (client.bufferedAmount > MAX_BUFFERED_AMOUNT) {
        logger.warn({ orgId, bufferedAmount: client.bufferedAmount }, "Closing slow WebSocket client (backpressure)");
        cleanupClient(client, orgId);
        client.terminate();
        return;
      }
      try {
        client.send(message);
      } catch (err) {
        logger.error({ err }, "Failed to send WebSocket message to client");
      }
    }
  });
}

/**
 * Broadcast a live transcription event to all connected clients in the same organization.
 * Used for real-time clinical recording: streams partial/final transcripts and draft notes.
 */
export function broadcastLiveTranscript(
  sessionId: string,
  eventType: "partial" | "final" | "draft_note" | "session_end" | "error",
  data: Record<string, unknown>,
  orgId: string,
) {
  if (!wss) return;
  const message = JSON.stringify({ type: "live_transcript", sessionId, eventType, ...data });
  // O(m) broadcast: only iterate clients in the target org
  const clients = orgClients.get(orgId);
  if (!clients) return;
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      if (client.bufferedAmount > MAX_BUFFERED_AMOUNT) {
        cleanupClient(client, orgId);
        client.terminate();
        return;
      }
      try {
        client.send(message);
      } catch (err) {
        logger.error({ err }, "Failed to send live transcript WebSocket message");
      }
    }
  });
}

/**
 * Gracefully close the WebSocket server.
 */
export function closeWebSocket(): Promise<void> {
  return new Promise((resolve) => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    if (!wss) {
      resolve();
      return;
    }
    wss.close(() => {
      wss = null;
      resolve();
    });
  });
}
