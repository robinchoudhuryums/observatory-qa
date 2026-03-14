import type { Express } from "express";
import { storage } from "../storage";
import { aiProvider } from "../services/ai-factory";

export function registerHealthRoutes(app: Express): void {
  // ==================== HEALTH CHECK (unauthenticated) ====================
  app.get("/api/health", async (_req, res) => {
    const checks: Record<string, { status: string; detail?: string }> = {};
    let overall = true;

    // Check storage connectivity
    try {
      const orgs = await storage.listOrganizations();
      checks.storage = { status: "ok", detail: `${orgs.length} org(s)` };
    } catch (error) {
      checks.storage = { status: "error", detail: (error as Error).message };
      overall = false;
    }

    // Check AI provider availability
    checks.ai = {
      status: aiProvider.isAvailable ? "ok" : "unavailable",
      detail: aiProvider.name,
    };

    // Check AssemblyAI configuration
    checks.transcription = {
      status: process.env.ASSEMBLYAI_API_KEY ? "ok" : "unconfigured",
    };

    res.status(overall ? 200 : 503).json({
      status: overall ? "healthy" : "degraded",
      timestamp: new Date().toISOString(),
      checks,
      uptime: Math.floor(process.uptime()),
    });
  });
}
