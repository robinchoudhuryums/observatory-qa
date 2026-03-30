/**
 * Marketing attribution routes — track where calls/interactions originate.
 *
 * Enables practices to measure ROI of marketing channels:
 * Google Ads, Yelp, referrals, walk-ins, etc.
 */
import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { requireAuth, requireRole } from "../auth";
import { logger } from "../services/logger";
import { validateUUIDParam } from "./helpers";
import { errorResponse, ERROR_CODES } from "../services/error-codes";
import type { MarketingSourceMetrics } from "@shared/schema";
import { MARKETING_SOURCES } from "@shared/schema";

const VALID_SOURCES = new Set(MARKETING_SOURCES.map((s) => s.value));

export function registerMarketingRoutes(app: Express): void {
  // --- Marketing Campaigns ---

  app.get("/api/marketing/campaigns", requireAuth, async (req: Request, res: Response) => {
    const orgId = req.orgId;
    if (!orgId) return res.status(403).json({ message: "Organization context required" });
    const { source, active } = req.query;
    const campaigns = await storage.listMarketingCampaigns(orgId, {
      source: source as string | undefined,
      isActive: active === "true" ? true : active === "false" ? false : undefined,
    });
    res.json(campaigns);
  });

  app.get("/api/marketing/campaigns/:id", requireAuth, validateUUIDParam(), async (req: Request, res: Response) => {
    const orgId = req.orgId;
    if (!orgId) return res.status(403).json({ message: "Organization context required" });
    const campaign = await storage.getMarketingCampaign(orgId, req.params.id);
    if (!campaign) return res.status(404).json({ message: "Campaign not found" });
    res.json(campaign);
  });

  app.post("/api/marketing/campaigns", requireAuth, requireRole("manager"), async (req: Request, res: Response) => {
    const orgId = req.orgId;
    if (!orgId) return res.status(403).json({ message: "Organization context required" });
    const { name, source, medium, startDate, endDate, budget, trackingCode, notes } = req.body;
    if (!name || !source) return res.status(400).json({ message: "name and source are required" });
    if (!VALID_SOURCES.has(source))
      return res
        .status(400)
        .json({ message: `Invalid source. Valid sources: ${Array.from(VALID_SOURCES).join(", ")}` });
    const campaign = await storage.createMarketingCampaign(orgId, {
      orgId,
      name,
      source,
      medium,
      startDate,
      endDate,
      budget,
      trackingCode,
      notes,
      isActive: true,
      createdBy: (req.user as any)?.name || "unknown",
    });
    res.status(201).json(campaign);
  });

  app.patch(
    "/api/marketing/campaigns/:id",
    requireAuth,
    requireRole("manager"),
    validateUUIDParam(),
    async (req: Request, res: Response) => {
      const orgId = req.orgId;
      if (!orgId) return res.status(403).json({ message: "Organization context required" });
      const updated = await storage.updateMarketingCampaign(orgId, req.params.id, req.body);
      if (!updated) return res.status(404).json({ message: "Campaign not found" });
      res.json(updated);
    },
  );

  app.delete(
    "/api/marketing/campaigns/:id",
    requireAuth,
    requireRole("manager"),
    validateUUIDParam(),
    async (req: Request, res: Response) => {
      const orgId = req.orgId;
      if (!orgId) return res.status(403).json({ message: "Organization context required" });
      const existing = await storage.getMarketingCampaign(orgId, req.params.id);
      if (!existing) return res.status(404).json({ message: "Campaign not found" });
      await storage.deleteMarketingCampaign(orgId, req.params.id);
      res.json({ message: "Campaign deleted" });
    },
  );

  // --- Call Attribution ---

  app.get(
    "/api/marketing/attribution/:callId",
    requireAuth,
    validateUUIDParam("callId"),
    async (req: Request, res: Response) => {
      const orgId = req.orgId;
      if (!orgId) return res.status(403).json({ message: "Organization context required" });
      const attr = await storage.getCallAttribution(orgId, req.params.callId);
      if (!attr) return res.status(404).json({ message: "No attribution found for this call" });
      res.json(attr);
    },
  );

  app.put(
    "/api/marketing/attribution/:callId",
    requireAuth,
    validateUUIDParam("callId"),
    async (req: Request, res: Response) => {
      const orgId = req.orgId;
      if (!orgId) return res.status(403).json({ message: "Organization context required" });
      const callId = req.params.callId;
      const { source, campaignId, isNewPatient, referrerName, detectionMethod, confidence, notes } = req.body;
      if (!source) return res.status(400).json({ message: "source is required" });
      if (!VALID_SOURCES.has(source))
        return res
          .status(400)
          .json({ message: `Invalid source. Valid sources: ${Array.from(VALID_SOURCES).join(", ")}` });

      // Upsert: check if attribution exists
      const existing = await storage.getCallAttribution(orgId, callId);
      if (existing) {
        const updated = await storage.updateCallAttribution(orgId, callId, {
          source,
          campaignId,
          isNewPatient,
          referrerName,
          notes,
          detectionMethod: detectionMethod || existing.detectionMethod,
          confidence: confidence ?? existing.confidence,
        });
        return res.json(updated);
      }

      const attr = await storage.createCallAttribution(orgId, {
        orgId,
        callId,
        source,
        campaignId,
        isNewPatient,
        referrerName,
        detectionMethod: detectionMethod || "manual",
        confidence: confidence || 1.0,
        notes,
        attributedBy: (req.user as any)?.name || "unknown",
      });
      res.status(201).json(attr);
    },
  );

  app.delete(
    "/api/marketing/attribution/:callId",
    requireAuth,
    requireRole("manager"),
    validateUUIDParam("callId"),
    async (req: Request, res: Response) => {
      const orgId = req.orgId;
      if (!orgId) return res.status(403).json({ message: "Organization context required" });
      await storage.deleteCallAttribution(orgId, req.params.callId);
      res.json({ message: "Attribution deleted" });
    },
  );

  // --- Marketing Analytics ---

  /** GET /api/marketing/metrics — Aggregated metrics by source */
  app.get("/api/marketing/metrics", requireAuth, async (req: Request, res: Response) => {
    const orgId = req.orgId;
    if (!orgId) return res.status(403).json({ message: "Organization context required" });

    try {
      // Load all data in parallel to avoid sequential queries
      const [attributions, campaigns, revenues] = await Promise.all([
        storage.listCallAttributions(orgId),
        storage.listMarketingCampaigns(orgId),
        storage.listCallRevenues(orgId),
      ]);

      // Build revenue lookup (amount + attribution stage for funnel visibility)
      const revenueByCall = new Map<string, number>();
      const stageByCall = new Map<string, string>();
      for (const rev of revenues) {
        revenueByCall.set(rev.callId, rev.actualRevenue || rev.estimatedRevenue || 0);
        if (rev.attributionStage) stageByCall.set(rev.callId, rev.attributionStage);
      }

      // Build campaign budget lookup (sum budgets per source for active campaigns)
      const budgetBySource = new Map<string, number>();
      for (const camp of campaigns) {
        if (camp.budget && camp.isActive) {
          const current = budgetBySource.get(camp.source) || 0;
          budgetBySource.set(camp.source, current + camp.budget);
        }
      }

      // Batch-load call scores in parallel (replaces N+1 sequential loop)
      const callIds = attributions.map((a) => a.callId);
      const analysisResults = await Promise.all(
        callIds.map((cid) => storage.getCallAnalysis(orgId, cid).catch(() => undefined)),
      );
      const callScores = new Map<string, number>();
      for (let i = 0; i < callIds.length; i++) {
        const analysis = analysisResults[i];
        if (analysis?.performanceScore) {
          callScores.set(callIds[i], parseFloat(String(analysis.performanceScore)));
        }
      }

      // Aggregate by source — includes funnel stage visibility
      const STAGE_ORDER = [
        "call_identified",
        "appointment_scheduled",
        "appointment_completed",
        "treatment_accepted",
        "payment_collected",
      ];

      const sourceMap = new Map<
        string,
        {
          calls: number;
          newPatients: number;
          converted: number;
          revenue: number;
          scores: number[];
          funnel: Record<string, number>;
        }
      >();

      for (const attr of attributions) {
        if (!sourceMap.has(attr.source)) {
          const funnel: Record<string, number> = {};
          for (const s of STAGE_ORDER) funnel[s] = 0;
          sourceMap.set(attr.source, { calls: 0, newPatients: 0, converted: 0, revenue: 0, scores: [], funnel });
        }
        const entry = sourceMap.get(attr.source)!;
        entry.calls++;
        entry.funnel.call_identified++;
        if (attr.isNewPatient) entry.newPatients++;
        const rev = revenueByCall.get(attr.callId) || 0;
        if (rev > 0) {
          entry.converted++;
          entry.revenue += rev;
        }
        const score = callScores.get(attr.callId);
        if (score) entry.scores.push(score);

        // Track attribution stage for source→funnel pipeline visibility
        const stage = stageByCall.get(attr.callId);
        if (stage) {
          const stageIdx = STAGE_ORDER.indexOf(stage);
          // A record at stage N counts for all stages 0..N (funnel monotonicity)
          for (let i = 1; i <= stageIdx; i++) {
            entry.funnel[STAGE_ORDER[i]]++;
          }
        }
      }

      const metrics = Array.from(sourceMap.entries()).map(([source, data]) => {
        const budget = budgetBySource.get(source);
        return {
          source,
          totalCalls: data.calls,
          newPatients: data.newPatients,
          convertedCalls: data.converted,
          totalRevenue: Math.round(data.revenue * 100) / 100,
          avgPerformanceScore:
            data.scores.length > 0
              ? Math.round((data.scores.reduce((a, b) => a + b, 0) / data.scores.length) * 10) / 10
              : 0,
          costPerLead: budget ? Math.round((budget / data.calls) * 100) / 100 : null,
          roi: budget && data.revenue > 0 ? Math.round(((data.revenue - budget) / budget) * 100) / 100 : null,
          // Source→funnel pipeline: how far leads from this source progress
          funnel: data.funnel,
        };
      });

      // Sort by total calls descending
      metrics.sort((a, b) => b.totalCalls - a.totalCalls);

      res.json({
        sources: metrics,
        totalAttributed: attributions.length,
        totalNewPatients: attributions.filter((a) => a.isNewPatient).length,
        totalRevenue: Math.round(Array.from(sourceMap.values()).reduce((sum, d) => sum + d.revenue, 0) * 100) / 100,
        totalBudget: Math.round(Array.from(budgetBySource.values()).reduce((sum, b) => sum + b, 0) * 100) / 100,
        activeCampaigns: campaigns.filter((c) => c.isActive).length,
      });
    } catch (error) {
      logger.error({ err: error }, "Failed to compute marketing metrics");
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to compute marketing metrics"));
    }
  });

  /** GET /api/marketing/campaigns/:id/metrics — Metrics for a single campaign */
  app.get(
    "/api/marketing/campaigns/:id/metrics",
    requireAuth,
    validateUUIDParam(),
    async (req: Request, res: Response) => {
      const orgId = req.orgId;
      if (!orgId) return res.status(403).json({ message: "Organization context required" });

      try {
        const campaign = await storage.getMarketingCampaign(orgId, req.params.id);
        if (!campaign) return res.status(404).json({ message: "Campaign not found" });

        const attributions = await storage.listCallAttributions(orgId, { campaignId: campaign.id });
        const revenues = await storage.listCallRevenues(orgId);

        const revenueByCall = new Map<string, number>();
        for (const rev of revenues) {
          revenueByCall.set(rev.callId, rev.actualRevenue || rev.estimatedRevenue || 0);
        }

        let totalRevenue = 0;
        let newPatients = 0;
        let conversions = 0;

        for (const attr of attributions) {
          if (attr.isNewPatient) newPatients++;
          const rev = revenueByCall.get(attr.callId) || 0;
          if (rev > 0) {
            conversions++;
            totalRevenue += rev;
          }
        }

        res.json({
          campaign,
          totalCalls: attributions.length,
          newPatients,
          conversions,
          totalRevenue: Math.round(totalRevenue * 100) / 100,
          conversionRate: attributions.length > 0 ? Math.round((conversions / attributions.length) * 100) : 0,
          costPerLead:
            campaign.budget && attributions.length > 0
              ? Math.round((campaign.budget / attributions.length) * 100) / 100
              : null,
          roi:
            campaign.budget && totalRevenue > 0
              ? Math.round(((totalRevenue - campaign.budget) / campaign.budget) * 100) / 100
              : null,
        });
      } catch (error) {
        logger.error({ err: error }, "Failed to compute campaign metrics");
        res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to compute campaign metrics"));
      }
    },
  );

  /**
   * GET /api/marketing/detect-source/:callId — AI-assisted source detection.
   * Analyzes transcript text for source mentions (e.g., "I found you on Google",
   * "my dentist referred me", "I saw your ad on Facebook").
   * Returns suggested source with confidence score. Does NOT auto-create attribution.
   */
  app.get(
    "/api/marketing/detect-source/:callId",
    requireAuth,
    validateUUIDParam("callId"),
    async (req: Request, res: Response) => {
      const orgId = req.orgId;
      if (!orgId) return res.status(403).json({ message: "Organization context required" });

      try {
        const transcript = await storage.getTranscript(orgId, req.params.callId);
        if (!transcript?.text) {
          return res.json({ detected: false, message: "No transcript available for this call" });
        }

        // Pattern-based source detection from transcript text
        const text = transcript.text.toLowerCase();
        const detections: Array<{ source: string; confidence: number; matchedPhrase: string }> = [];

        const SOURCE_PATTERNS: Array<{ source: string; patterns: RegExp[] }> = [
          {
            source: "google_ads",
            patterns: [/\bgoogle\b.*\bad\b/i, /\bsaw.*\bad\b.*\bgoogle\b/i, /\bgoogle search\b/i],
          },
          {
            source: "google_organic",
            patterns: [/\bfound.*\bgoogle\b/i, /\bgoogled\b/i, /\bsearched online\b/i, /\bfound.*\bonline\b/i],
          },
          {
            source: "facebook_ads",
            patterns: [/\bfacebook\b.*\bad\b/i, /\bmeta\b.*\bad\b/i, /\bsaw.*\bon facebook\b/i],
          },
          { source: "instagram", patterns: [/\binstagram\b/i, /\bsaw.*\bon instagram\b/i] },
          { source: "yelp", patterns: [/\byelp\b/i, /\bfound.*\bon yelp\b/i, /\byelp reviews?\b/i] },
          {
            source: "referral_patient",
            patterns: [
              /\bfriend\b.*\brecommend/i,
              /\bfamily\b.*\brefer/i,
              /\bco-?worker\b.*\btold\b/i,
              /\bneighbo[u]?r\b.*\brefer/i,
            ],
          },
          {
            source: "referral_doctor",
            patterns: [
              /\bdoctor\b.*\brefer/i,
              /\bdentist\b.*\brefer/i,
              /\bdr\.?\b.*\bsent me\b/i,
              /\bphysician\b.*\brefer/i,
            ],
          },
          { source: "website", patterns: [/\byour website\b/i, /\bfound.*\bwebsite\b/i, /\bsaw.*\bsite\b/i] },
          {
            source: "insurance_portal",
            patterns: [/\binsurance\b.*\blist/i, /\binsurance\b.*\bwebsite\b/i, /\bin[- ]?network\b.*\bfound\b/i],
          },
          { source: "walk_in", patterns: [/\bwalking by\b/i, /\bwalk-?in\b/i, /\bsaw.*\bsign\b/i, /\bdrove by\b/i] },
          { source: "direct_mail", patterns: [/\bmailer\b/i, /\bpostcard\b/i, /\bgot.*\bmail\b/i, /\bflyer\b/i] },
          {
            source: "returning_patient",
            patterns: [/\bcoming back\b/i, /\bprevious patient\b/i, /\bbeen here before\b/i, /\breturn(?:ing)?\b/i],
          },
        ];

        for (const { source, patterns } of SOURCE_PATTERNS) {
          for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match) {
              detections.push({
                source,
                confidence: 0.75, // Pattern-based detection = moderate confidence
                matchedPhrase: match[0].trim().slice(0, 100),
              });
              break; // One match per source is enough
            }
          }
        }

        if (detections.length === 0) {
          return res.json({ detected: false, message: "No source mentions detected in transcript" });
        }

        // Sort by confidence and return top suggestion
        detections.sort((a, b) => b.confidence - a.confidence);
        res.json({
          detected: true,
          suggestions: detections,
          topSuggestion: detections[0],
        });
      } catch (error) {
        logger.error({ err: error }, "Failed to detect call source");
        res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to detect source"));
      }
    },
  );

  /** GET /api/marketing/sources — List available marketing source types */
  app.get("/api/marketing/sources", requireAuth, (_req: Request, res: Response) => {
    res.json(MARKETING_SOURCES);
  });
}
