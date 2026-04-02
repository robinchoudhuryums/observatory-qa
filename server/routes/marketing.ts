/**
 * Marketing attribution routes — track where calls/interactions originate.
 *
 * Enables practices to measure ROI of marketing channels:
 * Google Ads, Yelp, referrals, walk-ins, etc.
 */
import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { requireAuth, requireRole } from "../auth";
import { validateUUIDParam } from "./helpers";
import { MARKETING_SOURCES } from "@shared/schema";
import { asyncHandler, AppError } from "../middleware/error-handler";

const VALID_SOURCES = new Set(MARKETING_SOURCES.map((s) => s.value));

/** Map common UTM source values to our marketing source enum */
function mapUtmSourceToMarketingSource(utmSource: string): string {
  const source = (utmSource || "").toLowerCase().trim();
  const map: Record<string, string> = {
    google: "google_ads", "google-ads": "google_ads", adwords: "google_ads",
    facebook: "facebook_ads", fb: "facebook_ads", meta: "facebook_ads",
    instagram: "instagram", ig: "instagram",
    yelp: "yelp",
    email: "email_campaign", newsletter: "email_campaign", mailchimp: "email_campaign",
    sms: "sms_campaign", text: "sms_campaign",
    direct_mail: "direct_mail", postcard: "direct_mail",
  };
  return map[source] || "website"; // Default to "website" for unknown UTM sources
}

export function registerMarketingRoutes(app: Express): void {
  // --- Marketing Campaigns ---

  app.get("/api/marketing/campaigns", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgId = req.orgId;
    if (!orgId) throw new AppError(403, "Organization context required");
    const { source, active } = req.query;
    const campaigns = await storage.listMarketingCampaigns(orgId, {
      source: source as string | undefined,
      isActive: active === "true" ? true : active === "false" ? false : undefined,
    });
    res.json(campaigns);
  }));

  app.get("/api/marketing/campaigns/:id", requireAuth, validateUUIDParam(), asyncHandler(async (req: Request, res: Response) => {
    const orgId = req.orgId;
    if (!orgId) throw new AppError(403, "Organization context required");
    const campaign = await storage.getMarketingCampaign(orgId, req.params.id);
    if (!campaign) throw new AppError(404, "Campaign not found");
    res.json(campaign);
  }));

  app.post("/api/marketing/campaigns", requireAuth, requireRole("manager"), asyncHandler(async (req: Request, res: Response) => {
    const orgId = req.orgId;
    if (!orgId) throw new AppError(403, "Organization context required");
    const { name, source, medium, startDate, endDate, budget, trackingCode, notes } = req.body;
    if (!name || !source) throw new AppError(400, "name and source are required");
    if (!VALID_SOURCES.has(source))
      throw new AppError(400, `Invalid source. Valid sources: ${Array.from(VALID_SOURCES).join(", ")}`);
    // Validate budget is non-negative
    if (budget !== undefined && (typeof budget !== "number" || budget < 0)) {
      throw new AppError(400, "budget must be a non-negative number");
    }
    // Validate date ordering
    if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
      throw new AppError(400, "startDate must be before endDate");
    }
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
  }));

  app.patch(
    "/api/marketing/campaigns/:id",
    requireAuth,
    requireRole("manager"),
    validateUUIDParam(),
    asyncHandler(async (req: Request, res: Response) => {
      const orgId = req.orgId;
      if (!orgId) throw new AppError(403, "Organization context required");
      const updated = await storage.updateMarketingCampaign(orgId, req.params.id, req.body);
      if (!updated) throw new AppError(404, "Campaign not found");
      res.json(updated);
    }),
  );

  app.delete(
    "/api/marketing/campaigns/:id",
    requireAuth,
    requireRole("manager"),
    validateUUIDParam(),
    asyncHandler(async (req: Request, res: Response) => {
      const orgId = req.orgId;
      if (!orgId) throw new AppError(403, "Organization context required");
      const existing = await storage.getMarketingCampaign(orgId, req.params.id);
      if (!existing) throw new AppError(404, "Campaign not found");
      await storage.deleteMarketingCampaign(orgId, req.params.id);
      res.json({ message: "Campaign deleted" });
    }),
  );

  // --- Call Attribution ---

  app.get(
    "/api/marketing/attribution/:callId",
    requireAuth,
    validateUUIDParam("callId"),
    asyncHandler(async (req: Request, res: Response) => {
      const orgId = req.orgId;
      if (!orgId) throw new AppError(403, "Organization context required");
      const attr = await storage.getCallAttribution(orgId, req.params.callId);
      if (!attr) throw new AppError(404, "No attribution found for this call");
      res.json(attr);
    }),
  );

  app.put(
    "/api/marketing/attribution/:callId",
    requireAuth,
    validateUUIDParam("callId"),
    asyncHandler(async (req: Request, res: Response) => {
      const orgId = req.orgId;
      if (!orgId) throw new AppError(403, "Organization context required");
      const callId = req.params.callId;
      const { source, campaignId, isNewPatient, referrerName, detectionMethod, confidence, notes,
        utmSource, utmMedium, utmCampaign, utmContent, utmTerm } = req.body;
      if (!source) throw new AppError(400, "source is required");
      if (!VALID_SOURCES.has(source))
        throw new AppError(400, `Invalid source. Valid sources: ${Array.from(VALID_SOURCES).join(", ")}`);
      // Validate confidence bounds (0-1 range)
      if (confidence !== undefined && (typeof confidence !== "number" || confidence < 0 || confidence > 1)) {
        throw new AppError(400, "confidence must be a number between 0 and 1");
      }

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
          utmSource, utmMedium, utmCampaign, utmContent, utmTerm,
        });
        return res.json(updated);
      }

      // Auto-detect UTM-based source if UTM params provided and no explicit source match
      const effectiveDetection = utmSource ? "utm" : (detectionMethod || "manual");
      const effectiveSource = utmSource && !VALID_SOURCES.has(source)
        ? mapUtmSourceToMarketingSource(utmSource)
        : source;

      const attr = await storage.createCallAttribution(orgId, {
        orgId,
        callId,
        source: effectiveSource,
        campaignId,
        isNewPatient,
        referrerName,
        detectionMethod: effectiveDetection,
        confidence: confidence || (utmSource ? 0.95 : 1.0), // UTM = high confidence
        notes,
        attributedBy: (req.user as any)?.name || "unknown",
        utmSource, utmMedium, utmCampaign, utmContent, utmTerm,
      });
      res.status(201).json(attr);
    }),
  );

  app.delete(
    "/api/marketing/attribution/:callId",
    requireAuth,
    requireRole("manager"),
    validateUUIDParam("callId"),
    asyncHandler(async (req: Request, res: Response) => {
      const orgId = req.orgId;
      if (!orgId) throw new AppError(403, "Organization context required");
      await storage.deleteCallAttribution(orgId, req.params.callId);
      res.json({ message: "Attribution deleted" });
    }),
  );

  // --- Marketing Analytics ---

  /** GET /api/marketing/metrics — Aggregated metrics by source */
  app.get("/api/marketing/metrics", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgId = req.orgId;
    if (!orgId) throw new AppError(403, "Organization context required");

    // Optional date-range filtering (e.g., ?startDate=2026-01-01&endDate=2026-03-31)
    const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
    const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;
    if (startDate && isNaN(startDate.getTime())) {
      throw new AppError(400, "Invalid startDate format (use ISO 8601)");
    }
    if (endDate && isNaN(endDate.getTime())) {
      throw new AppError(400, "Invalid endDate format (use ISO 8601)");
    }

    // Load all data in parallel to avoid sequential queries
    let [attributions, campaigns, revenues] = await Promise.all([
      storage.listCallAttributions(orgId),
      storage.listMarketingCampaigns(orgId),
      storage.listCallRevenues(orgId),
    ]);

    // Apply date-range filter if provided
    if (startDate || endDate) {
      attributions = attributions.filter((a) => {
        const created = a.createdAt ? new Date(a.createdAt) : null;
        if (!created) return true;
        if (startDate && created < startDate) return false;
        if (endDate && created > endDate) return false;
        return true;
      });
    }

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
        costPerLead: budget && data.calls > 0 ? Math.round((budget / data.calls) * 100) / 100 : null,
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
  }));

  /** GET /api/marketing/campaigns/:id/metrics — Metrics for a single campaign */
  app.get(
    "/api/marketing/campaigns/:id/metrics",
    requireAuth,
    validateUUIDParam(),
    asyncHandler(async (req: Request, res: Response) => {
      const orgId = req.orgId;
      if (!orgId) throw new AppError(403, "Organization context required");

      const campaign = await storage.getMarketingCampaign(orgId, req.params.id);
      if (!campaign) throw new AppError(404, "Campaign not found");

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
    }),
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
    asyncHandler(async (req: Request, res: Response) => {
      const orgId = req.orgId;
      if (!orgId) throw new AppError(403, "Organization context required");

      const transcript = await storage.getTranscript(orgId, req.params.callId);
      if (!transcript?.text) {
        res.json({ detected: false, message: "No transcript available for this call" });
        return;
      }

      // Pattern-based source detection from transcript text
      const text = transcript.text.toLowerCase();
      const detections: Array<{ source: string; confidence: number; matchedPhrase: string }> = [];

      // Per-pattern confidence: specific phrases get higher confidence than vague ones
      const SOURCE_PATTERNS: Array<{ source: string; patterns: Array<{ re: RegExp; conf: number }> }> = [
        {
          source: "google_ads",
          patterns: [
            { re: /\bgoogle\b.*\bad\b/i, conf: 0.9 },
            { re: /\bsaw.*\bad\b.*\bgoogle\b/i, conf: 0.9 },
            { re: /\bgoogle search\b/i, conf: 0.7 },
          ],
        },
        {
          source: "google_organic",
          patterns: [
            { re: /\bgoogled\b/i, conf: 0.9 },
            { re: /\bfound.*\bgoogle\b/i, conf: 0.85 },
            { re: /\bsearched online\b/i, conf: 0.6 },
            { re: /\bfound.*\bonline\b/i, conf: 0.5 },
          ],
        },
        {
          source: "facebook_ads",
          patterns: [
            { re: /\bfacebook\b.*\bad\b/i, conf: 0.9 },
            { re: /\bmeta\b.*\bad\b/i, conf: 0.85 },
            { re: /\bsaw.*\bon facebook\b/i, conf: 0.8 },
          ],
        },
        {
          source: "instagram",
          patterns: [
            { re: /\bsaw.*\bon instagram\b/i, conf: 0.85 },
            { re: /\binstagram\b/i, conf: 0.7 },
          ],
        },
        {
          source: "yelp",
          patterns: [
            { re: /\byelp reviews?\b/i, conf: 0.9 },
            { re: /\bfound.*\bon yelp\b/i, conf: 0.9 },
            { re: /\byelp\b/i, conf: 0.8 },
          ],
        },
        {
          source: "referral_patient",
          patterns: [
            { re: /\bfriend\b.*\brecommend/i, conf: 0.9 },
            { re: /\bfamily\b.*\brefer/i, conf: 0.9 },
            { re: /\bco-?worker\b.*\btold\b/i, conf: 0.85 },
            { re: /\bneighbo[u]?r\b.*\brefer/i, conf: 0.85 },
          ],
        },
        {
          source: "referral_doctor",
          patterns: [
            { re: /\bdoctor\b.*\brefer/i, conf: 0.9 },
            { re: /\bdentist\b.*\brefer/i, conf: 0.9 },
            { re: /\bdr\.?\b.*\bsent me\b/i, conf: 0.85 },
            { re: /\bphysician\b.*\brefer/i, conf: 0.85 },
          ],
        },
        {
          source: "website",
          patterns: [
            { re: /\byour website\b/i, conf: 0.85 },
            { re: /\bfound.*\bwebsite\b/i, conf: 0.8 },
            { re: /\bsaw.*\bsite\b/i, conf: 0.6 },
          ],
        },
        {
          source: "insurance_portal",
          patterns: [
            { re: /\binsurance\b.*\blist/i, conf: 0.8 },
            { re: /\binsurance\b.*\bwebsite\b/i, conf: 0.75 },
            { re: /\bin[- ]?network\b.*\bfound\b/i, conf: 0.85 },
          ],
        },
        {
          source: "walk_in",
          patterns: [
            { re: /\bwalking by\b/i, conf: 0.9 },
            { re: /\bwalk-?in\b/i, conf: 0.85 },
            { re: /\bsaw.*\bsign\b/i, conf: 0.75 },
            { re: /\bdrove by\b/i, conf: 0.8 },
          ],
        },
        {
          source: "direct_mail",
          patterns: [
            { re: /\bpostcard\b/i, conf: 0.9 },
            { re: /\bmailer\b/i, conf: 0.85 },
            { re: /\bflyer\b/i, conf: 0.8 },
            { re: /\bgot.*\bmail\b/i, conf: 0.6 },
          ],
        },
        {
          source: "returning_patient",
          patterns: [
            { re: /\bbeen here before\b/i, conf: 0.9 },
            { re: /\bprevious patient\b/i, conf: 0.9 },
            { re: /\bcoming back\b/i, conf: 0.8 },
            { re: /\breturn(?:ing)?\b/i, conf: 0.6 },
          ],
        },
        // New source patterns
        {
          source: "phone_directory",
          patterns: [
            { re: /\bphone ?book\b/i, conf: 0.9 },
            { re: /\bdirectory\b.*\blist/i, conf: 0.8 },
            { re: /\byellow ?pages\b/i, conf: 0.9 },
          ],
        },
        {
          source: "email_campaign",
          patterns: [
            { re: /\bemail\b.*\breceived\b/i, conf: 0.8 },
            { re: /\bnewsletter\b/i, conf: 0.85 },
            { re: /\bgot.*\bemail\b.*\bfrom\b/i, conf: 0.8 },
          ],
        },
        {
          source: "community_event",
          patterns: [
            { re: /\bhealth fair\b/i, conf: 0.9 },
            { re: /\bseminar\b/i, conf: 0.85 },
            { re: /\bworkshop\b/i, conf: 0.7 },
            { re: /\bcommunity event\b/i, conf: 0.9 },
          ],
        },
        {
          source: "social_organic",
          patterns: [
            { re: /\bsaw.*\bon tiktok\b/i, conf: 0.85 },
            { re: /\btiktok\b/i, conf: 0.7 },
            { re: /\bnextdoor\b/i, conf: 0.8 },
            { re: /\bsocial media\b/i, conf: 0.6 },
          ],
        },
      ];

      for (const { source, patterns } of SOURCE_PATTERNS) {
        for (const { re, conf } of patterns) {
          const match = text.match(re);
          if (match) {
            detections.push({
              source,
              confidence: conf,
              matchedPhrase: match[0].trim().slice(0, 100),
            });
            break; // One match per source is enough (highest confidence listed first)
          }
        }
      }

      if (detections.length === 0) {
        res.json({ detected: false, message: "No source mentions detected in transcript" });
        return;
      }

      // Sort by confidence and return top suggestion
      detections.sort((a, b) => b.confidence - a.confidence);
      res.json({
        detected: true,
        suggestions: detections,
        topSuggestion: detections[0],
      });
    }),
  );

  /** GET /api/marketing/sources — List available marketing source types */
  app.get("/api/marketing/sources", requireAuth, (_req: Request, res: Response) => {
    res.json(MARKETING_SOURCES);
  });

  /**
   * GET /api/marketing/cohort — Time-based cohort conversion analysis.
   * Groups calls by month and tracks conversion rate over a configurable follow-up window.
   * Example: "Of calls from January, what % converted within 90 days?"
   */
  app.get("/api/marketing/cohort", requireAuth, async (req: Request, res: Response) => {
    const orgId = req.orgId;
    if (!orgId) return res.status(403).json({ message: "Organization context required" });

    try {
      const followUpDays = Math.min(Math.max(parseInt(req.query.days as string) || 90, 7), 365);
      const months = Math.min(Math.max(parseInt(req.query.months as string) || 6, 1), 24);
      const sourceFilter = req.query.source as string | undefined;

      const [attributions, revenues] = await Promise.all([
        storage.listCallAttributions(orgId),
        storage.listCallRevenues(orgId),
      ]);

      const revenueByCall = new Map(revenues.map((r) => [r.callId, r]));

      // Group attributions by month cohort
      const cohorts = new Map<string, { total: number; converted: number; revenue: number; source: string }[]>();
      const now = Date.now();

      for (const attr of attributions) {
        if (sourceFilter && attr.source !== sourceFilter) continue;
        const created = attr.createdAt ? new Date(attr.createdAt) : null;
        if (!created) continue;

        const monthKey = `${created.getFullYear()}-${String(created.getMonth() + 1).padStart(2, "0")}`;
        if (!cohorts.has(monthKey)) cohorts.set(monthKey, []);

        // Only count conversion if it happened within the follow-up window
        const rev = revenueByCall.get(attr.callId);
        const convertedWithinWindow =
          rev?.convertedAt &&
          new Date(rev.convertedAt).getTime() - created.getTime() <= followUpDays * 24 * 60 * 60 * 1000;

        // Also count if conversion status is "converted" even without convertedAt
        const isConverted = convertedWithinWindow || (rev?.conversionStatus === "converted" && !rev.convertedAt);

        cohorts.get(monthKey)!.push({
          total: 1,
          converted: isConverted ? 1 : 0,
          revenue: isConverted ? (rev?.actualRevenue || rev?.estimatedRevenue || 0) : 0,
          source: attr.source,
        });
      }

      // Aggregate per month, sorted chronologically, limited to requested months
      const sortedMonths = Array.from(cohorts.keys()).sort().slice(-months);
      const result = sortedMonths.map((month) => {
        const entries = cohorts.get(month) || [];
        const total = entries.length;
        const converted = entries.reduce((s, e) => s + e.converted, 0);
        const revenue = entries.reduce((s, e) => s + e.revenue, 0);

        // Per-source breakdown within the cohort
        const bySource = new Map<string, { total: number; converted: number }>();
        for (const e of entries) {
          const existing = bySource.get(e.source) || { total: 0, converted: 0 };
          existing.total++;
          existing.converted += e.converted;
          bySource.set(e.source, existing);
        }

        return {
          month,
          totalCalls: total,
          convertedCalls: converted,
          conversionRate: total > 0 ? Math.round((converted / total) * 100) : 0,
          totalRevenue: Math.round(revenue * 100) / 100,
          avgRevenuePerConversion: converted > 0 ? Math.round((revenue / converted) * 100) / 100 : 0,
          bySource: Object.fromEntries(
            Array.from(bySource.entries()).map(([source, data]) => [
              source,
              {
                total: data.total,
                converted: data.converted,
                conversionRate: data.total > 0 ? Math.round((data.converted / data.total) * 100) : 0,
              },
            ]),
          ),
        };
      });

      res.json({ followUpDays, months: result });
    } catch (error) {
      logger.error({ err: error }, "Failed to compute cohort analysis");
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to compute cohort analysis"));
    }
  });
}
