import type { Express } from "express";
import { storage } from "../storage";
import { requireAuth, requireRole, injectOrgContext } from "../auth";
import { logger } from "../services/logger";
import { validateUUIDParam } from "./helpers";
import { errorResponse, ERROR_CODES } from "../services/error-codes";
import { BADGE_DEFINITIONS, type BadgeId } from "@shared/schema";

// Points awarded for various activities
const POINT_VALUES = {
  call_processed: 10,
  high_score: 25,       // score >= 9.0
  perfect_score: 50,    // score == 10.0
  self_review: 15,
  coaching_completed: 20,
  streak_day: 5,
} as const;

/**
 * Check and award badges based on employee activity.
 * Called after calls are processed, coaching completed, etc.
 */
export async function checkAndAwardBadges(orgId: string, employeeId: string): Promise<void> {
  try {
    // Use getCallSummaries which includes analysis data, avoiding N+1 queries
    const allCalls = await storage.getCallSummaries(orgId, { status: "completed" });
    const employeeCalls = allCalls.filter(c => c.employeeId === employeeId);
    const existingBadges = await storage.getEmployeeBadges(orgId, employeeId);
    const hasBadge = (id: string) => existingBadges.some(b => b.badgeId === id);

    const now = new Date().toISOString();

    // Milestone badges
    if (employeeCalls.length >= 1 && !hasBadge("first_call")) {
      await storage.awardBadge(orgId, { orgId, employeeId, badgeId: "first_call", awardedAt: now });
    }
    if (employeeCalls.length >= 10 && !hasBadge("ten_calls")) {
      await storage.awardBadge(orgId, { orgId, employeeId, badgeId: "ten_calls", awardedAt: now });
    }
    if (employeeCalls.length >= 100 && !hasBadge("hundred_calls")) {
      await storage.awardBadge(orgId, { orgId, employeeId, badgeId: "hundred_calls", awardedAt: now });
    }

    // Performance badges — analysis data is already in call summaries
    const recentCalls = employeeCalls.slice(-20);
    const analyses = recentCalls
      .filter(c => c.analysis)
      .map(c => ({ callId: c.id, score: parseFloat(String(c.analysis?.performanceScore || "0")) }))
      .filter(a => !isNaN(a.score));

    const highScoreCalls = analyses.filter(a => a.score >= 9.0);
    if (highScoreCalls.length >= 5 && !hasBadge("high_performer")) {
      await storage.awardBadge(orgId, { orgId, employeeId, badgeId: "high_performer", awardedAt: now });
    }

    const perfectCall = analyses.find(a => a.score === 10.0);
    if (perfectCall && !hasBadge("perfect_score")) {
      await storage.awardBadge(orgId, { orgId, employeeId, badgeId: "perfect_score", awardedAt: now, awardedFor: perfectCall.callId });
    }

    // Consistency King: 10 consecutive calls with score >= 8.0
    if (!hasBadge("consistency_king") && analyses.length >= 10) {
      const last10 = analyses.slice(-10);
      if (last10.every(a => a.score >= 8.0)) {
        await storage.awardBadge(orgId, { orgId, employeeId, badgeId: "consistency_king", awardedAt: now });
      }
    }

    // Most Improved: average improved by 2+ points comparing first half to second half of recent calls
    if (!hasBadge("most_improved") && analyses.length >= 6) {
      const half = Math.floor(analyses.length / 2);
      const firstHalf = analyses.slice(0, half);
      const secondHalf = analyses.slice(half);
      const avgFirst = firstHalf.reduce((s, a) => s + a.score, 0) / firstHalf.length;
      const avgSecond = secondHalf.reduce((s, a) => s + a.score, 0) / secondHalf.length;
      if (avgSecond - avgFirst >= 2.0) {
        await storage.awardBadge(orgId, { orgId, employeeId, badgeId: "most_improved", awardedAt: now });
      }
    }

    // Comeback Kid: had calls with score < 5.0, then recent calls all >= 8.0
    if (!hasBadge("comeback_kid") && analyses.length >= 5) {
      const hadLowScores = analyses.some(a => a.score < 5.0);
      const recent5 = analyses.slice(-5);
      const recentAllHigh = recent5.every(a => a.score >= 8.0);
      if (hadLowScores && recentAllHigh) {
        await storage.awardBadge(orgId, { orgId, employeeId, badgeId: "comeback_kid", awardedAt: now });
      }
    }

    // Streak badges
    const profile = await storage.getGamificationProfile(orgId, employeeId);
    if (profile.currentStreak >= 7 && !hasBadge("streak_7")) {
      await storage.awardBadge(orgId, { orgId, employeeId, badgeId: "streak_7", awardedAt: now });
    }
    if (profile.currentStreak >= 30 && !hasBadge("streak_30")) {
      await storage.awardBadge(orgId, { orgId, employeeId, badgeId: "streak_30", awardedAt: now });
    }
  } catch (error) {
    logger.error({ err: error, orgId, employeeId }, "Failed to check/award badges");
  }
}

/**
 * Update streak and points for an employee.
 * Call this when an employee has a call processed.
 */
export async function recordActivity(orgId: string, employeeId: string, pointType: keyof typeof POINT_VALUES): Promise<void> {
  try {
    const profile = await storage.getGamificationProfile(orgId, employeeId);
    const today = new Date().toISOString().slice(0, 10);

    // Update streak
    let newStreak = profile.currentStreak;
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

    // We track last activity date to determine streak continuity
    // This is a simplified approach — in production you'd use a more robust date comparison
    const lastActivity = (profile as { lastActivityDate?: string }).lastActivityDate;
    if (lastActivity === today) {
      // Already active today, no streak change
    } else if (lastActivity === yesterday) {
      newStreak = profile.currentStreak + 1;
    } else {
      newStreak = 1; // streak broken
    }

    const newPoints = profile.totalPoints + POINT_VALUES[pointType];
    const newLongest = Math.max(profile.longestStreak, newStreak);

    await storage.updateGamificationProfile(orgId, employeeId, {
      totalPoints: newPoints,
      currentStreak: newStreak,
      longestStreak: newLongest,
      lastActivityDate: today,
    });

    // Check for new badges
    await checkAndAwardBadges(orgId, employeeId);
  } catch (error) {
    logger.error({ err: error, orgId, employeeId, pointType }, "Failed to record gamification activity");
  }
}

export function registerGamificationRoutes(app: Express) {
  // Get leaderboard for the org
  app.get("/api/gamification/leaderboard", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const orgId = req.orgId;
      if (!orgId) return res.status(403).json({ message: "Organization context required" });

      // Check if gamification is globally enabled
      const org = await storage.getOrganization(orgId);
      const gamSettings = (org?.settings as any)?.gamification;
      if (gamSettings?.enabled === false) {
        return res.json([]);
      }

      const limit = parseInt(req.query.limit as string) || 20;
      const leaderboardData = await storage.getLeaderboard(orgId, limit);

      // Only fetch employees that appear in the leaderboard (not all org employees)
      const neededIds = leaderboardData.map(e => e.employeeId);
      const employeeResults = await Promise.all(
        neededIds.map(id => storage.getEmployee(orgId, id))
      );
      const employeeMap = new Map(
        employeeResults.filter(Boolean).map(e => [e!.id, e!])
      );

      // Filter out opted-out employees
      const optedOutIds = new Set(gamSettings?.optedOutEmployeeIds || []);
      const optedOutRoles = new Set(gamSettings?.optedOutRoles || []);

      const filteredData = leaderboardData.filter(entry => {
        if (optedOutIds.has(entry.employeeId)) return false;
        const emp = employeeMap.get(entry.employeeId);
        if (emp && optedOutRoles.has((emp as any).role)) return false;
        return true;
      });

      const leaderboard = filteredData.map((entry, idx) => {
        const employee = employeeMap.get(entry.employeeId);
        return {
          ...entry,
          employeeName: employee?.name || "Unknown",
          rank: idx + 1,
          level: Math.floor(entry.totalPoints / 100),
        };
      });

      res.json(leaderboard);
    } catch (error) {
      logger.error({ err: error }, "Failed to get leaderboard");
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to get leaderboard"));
    }
  });

  // Get gamification profile for an employee
  app.get("/api/gamification/profile/:employeeId", requireAuth, injectOrgContext, validateUUIDParam("employeeId"), async (req, res) => {
    try {
      const orgId = req.orgId;
      if (!orgId) return res.status(403).json({ message: "Organization context required" });

      const { employeeId } = req.params;
      const [profile, badges, employee] = await Promise.all([
        storage.getGamificationProfile(orgId, employeeId),
        storage.getEmployeeBadges(orgId, employeeId),
        storage.getEmployee(orgId, employeeId),
      ]);

      if (!employee) return res.status(404).json({ message: "Employee not found" });

      // Check opt-out status before returning profile
      const org = await storage.getOrganization(orgId);
      const gamSettings = (org?.settings as any)?.gamification;
      if (gamSettings?.enabled === false) return res.json({ optedOut: true, message: "Gamification is disabled" });
      const optedOutIds = new Set(gamSettings?.optedOutEmployeeIds || []);
      const optedOutRoles = new Set(gamSettings?.optedOutRoles || []);
      if (optedOutIds.has(employeeId) || optedOutRoles.has((employee as any).role)) {
        return res.json({ optedOut: true, message: "This employee has opted out of gamification" });
      }

      // Enrich badges with definitions
      const enrichedBadges = badges.map(b => {
        const def = BADGE_DEFINITIONS.find(d => d.id === b.badgeId);
        return { ...b, name: def?.name, description: def?.description, icon: def?.icon, category: def?.category };
      });

      res.json({
        employeeId,
        employeeName: employee.name,
        totalPoints: profile.totalPoints,
        currentStreak: profile.currentStreak,
        longestStreak: profile.longestStreak,
        level: Math.floor(profile.totalPoints / 100),
        badges: enrichedBadges,
        availableBadges: BADGE_DEFINITIONS.filter(d => !badges.some(b => b.badgeId === d.id)),
      });
    } catch (error) {
      logger.error({ err: error }, "Failed to get gamification profile");
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to get gamification profile"));
    }
  });

  // Get all badge definitions
  app.get("/api/gamification/badges", requireAuth, async (_req, res) => {
    res.json(BADGE_DEFINITIONS);
  });

  // --- Gamification settings (opt-out configuration) ---
  app.get("/api/gamification/settings", requireAuth, requireRole("admin"), injectOrgContext, async (req, res) => {
    try {
      const org = await storage.getOrganization(req.orgId!);
      const gamification = (org?.settings as any)?.gamification || { enabled: true };
      res.json(gamification);
    } catch (error) {
      res.status(500).json({ message: "Failed to get gamification settings" });
    }
  });

  app.put("/api/gamification/settings", requireAuth, requireRole("admin"), injectOrgContext, async (req, res) => {
    try {
      const orgId = req.orgId!;
      const { enabled, optedOutRoles, optedOutEmployeeIds, teamCompetitionsEnabled } = req.body;

      const org = await storage.getOrganization(orgId);
      const settings = (org?.settings || {}) as Record<string, any>;

      const gamification = {
        enabled: enabled !== false,
        optedOutRoles: Array.isArray(optedOutRoles) ? optedOutRoles : settings.gamification?.optedOutRoles,
        optedOutEmployeeIds: Array.isArray(optedOutEmployeeIds) ? optedOutEmployeeIds : settings.gamification?.optedOutEmployeeIds,
        teamCompetitionsEnabled: teamCompetitionsEnabled === true,
      };

      await storage.updateOrganization(orgId, {
        settings: { ...settings, gamification } as any,
      });

      logger.info({ orgId, gamification: { enabled: gamification.enabled } }, "Gamification settings updated");
      res.json(gamification);
    } catch (error) {
      res.status(500).json({ message: "Failed to update gamification settings" });
    }
  });

  // --- Manager-awarded custom recognition badges ---
  app.post("/api/gamification/recognize", requireAuth, requireRole("manager"), injectOrgContext, async (req, res) => {
    try {
      const orgId = req.orgId!;
      const { employeeId, badgeId, message, callId } = req.body;

      if (!employeeId || !badgeId) {
        return res.status(400).json({ message: "employeeId and badgeId are required" });
      }

      // Verify employee exists
      const employee = await storage.getEmployee(orgId, employeeId);
      if (!employee) return res.status(404).json({ message: "Employee not found" });

      // Check if gamification is enabled and employee isn't opted out
      const org = await storage.getOrganization(orgId);
      const gamSettings = (org?.settings as any)?.gamification;
      if (gamSettings?.enabled === false) {
        return res.status(403).json({ message: "Gamification is disabled for this organization" });
      }
      if (gamSettings?.optedOutEmployeeIds?.includes(employeeId)) {
        return res.status(403).json({ message: "This employee has opted out of gamification" });
      }
      const optedOutRoles = gamSettings?.optedOutRoles || [];
      if (optedOutRoles.length > 0 && optedOutRoles.includes((employee as any).role)) {
        return res.status(403).json({ message: "This employee's role has opted out of gamification" });
      }

      // For custom badges, use "custom_recognition" as the badgeId prefix
      const customBadgeId = badgeId.startsWith("custom_") ? badgeId : `custom_${badgeId}`;

      const badge = await storage.awardBadge(orgId, {
        orgId,
        employeeId,
        badgeId: customBadgeId,
        awardedAt: new Date().toISOString(),
        awardedFor: callId || undefined,
        awardedBy: req.user!.id,
        customMessage: message || undefined,
      });

      // Award bonus points for receiving recognition
      try {
        const profile = await storage.getGamificationProfile(orgId, employeeId);
        await storage.updateGamificationProfile(orgId, employeeId, {
          totalPoints: profile.totalPoints + 30, // Recognition bonus
        });
      } catch { /* non-critical */ }

      logger.info({ orgId, employeeId, badgeId: customBadgeId, awardedBy: req.user!.id }, "Custom recognition badge awarded");
      res.status(201).json(badge);
    } catch (error) {
      logger.error({ err: error }, "Failed to award recognition badge");
      res.status(500).json({ message: "Failed to award recognition badge" });
    }
  });

  // --- Team competitions ---
  app.get("/api/gamification/team-leaderboard", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const orgId = req.orgId!;

      // Check if team competitions are enabled
      const org = await storage.getOrganization(orgId);
      const gamSettings = (org?.settings as any)?.gamification;
      if (!gamSettings?.teamCompetitionsEnabled) {
        return res.json({ enabled: false, teams: [], message: "Team competitions are not enabled" });
      }

      const employees = await storage.getAllEmployees(orgId);
      const leaderboardData = await storage.getLeaderboard(orgId, 500);

      // Filter out opted-out employees/roles (same logic as main leaderboard)
      const employeeMap = new Map(employees.map(e => [e.id, e]));
      const optedOutIds = new Set(gamSettings?.optedOutEmployeeIds || []);
      const optedOutRoles = new Set(gamSettings?.optedOutRoles || []);
      const filteredLeaderboard = leaderboardData.filter(entry => {
        if (optedOutIds.has(entry.employeeId)) return false;
        const emp = employeeMap.get(entry.employeeId);
        if (emp && optedOutRoles.has((emp as any).role)) return false;
        return true;
      });

      // Group by subTeam
      const topPointsByTeam = new Map<string, number>();
      const teams: Record<string, { totalPoints: number; memberCount: number; avgPoints: number; topPerformer: string | null; badges: number }> = {};

      for (const entry of filteredLeaderboard) {
        const emp = employeeMap.get(entry.employeeId);
        const team = (emp as any)?.subTeam || "Unassigned";

        if (!teams[team]) {
          teams[team] = { totalPoints: 0, memberCount: 0, avgPoints: 0, topPerformer: null, badges: 0 };
          topPointsByTeam.set(team, 0);
        }
        teams[team].totalPoints += entry.totalPoints;
        teams[team].memberCount++;
        teams[team].badges += entry.badgeCount;
        // Track actual top performer by points (not just last with >0)
        if (entry.totalPoints > (topPointsByTeam.get(team) || 0)) {
          teams[team].topPerformer = emp?.name || null;
          topPointsByTeam.set(team, entry.totalPoints);
        }
      }

      // Compute averages and rank
      const teamList = Object.entries(teams).map(([name, data]) => ({
        team: name,
        totalPoints: data.totalPoints,
        memberCount: data.memberCount,
        avgPointsPerMember: data.memberCount > 0 ? Math.round(data.totalPoints / data.memberCount) : 0,
        totalBadges: data.badges,
        topPerformer: data.topPerformer,
      }));

      teamList.sort((a, b) => b.totalPoints - a.totalPoints);

      res.json({
        enabled: true,
        teams: teamList.map((t, i) => ({ ...t, rank: i + 1 })),
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to get team leaderboard" });
    }
  });

  // --- Effectiveness measurement ---
  app.get("/api/gamification/effectiveness", requireAuth, requireRole("admin"), injectOrgContext, async (req, res) => {
    try {
      const orgId = req.orgId!;
      const employees = await storage.getAllEmployees(orgId);
      const calls = await storage.getCallSummaries(orgId, { status: "completed" });

      // Get badge counts and points for each employee
      const stats: Array<{
        employeeId: string;
        employeeName: string;
        badgeCount: number;
        totalPoints: number;
        avgPerformanceScore: number;
        totalCalls: number;
      }> = [];

      for (const emp of employees) {
        const empCalls = calls.filter(c => c.employeeId === emp.id);
        if (empCalls.length === 0) continue;

        const badges = await storage.getEmployeeBadges(orgId, emp.id);
        const profile = await storage.getGamificationProfile(orgId, emp.id);

        const scores = empCalls
          .filter(c => c.analysis?.performanceScore)
          .map(c => parseFloat(String(c.analysis!.performanceScore)));
        const avgScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;

        stats.push({
          employeeId: emp.id,
          employeeName: emp.name,
          badgeCount: badges.length,
          totalPoints: profile.totalPoints,
          avgPerformanceScore: Math.round(avgScore * 100) / 100,
          totalCalls: empCalls.length,
        });
      }

      if (stats.length < 2) {
        return res.json({ correlation: null, message: "Need at least 2 employees with calls for analysis" });
      }

      // Compute Pearson correlation between badge count and avg performance score
      const n = stats.length;
      const meanBadges = stats.reduce((s, e) => s + e.badgeCount, 0) / n;
      const meanScore = stats.reduce((s, e) => s + e.avgPerformanceScore, 0) / n;

      let numerator = 0;
      let denomBadges = 0;
      let denomScore = 0;
      for (const e of stats) {
        const bDiff = e.badgeCount - meanBadges;
        const sDiff = e.avgPerformanceScore - meanScore;
        numerator += bDiff * sDiff;
        denomBadges += bDiff * bDiff;
        denomScore += sDiff * sDiff;
      }
      const denom = Math.sqrt(denomBadges * denomScore);
      const correlation = denom > 0 ? Math.round((numerator / denom) * 1000) / 1000 : 0;

      // Group by badge count ranges
      const highBadge = stats.filter(e => e.badgeCount >= 3);
      const lowBadge = stats.filter(e => e.badgeCount < 3);

      const avgScoreHighBadge = highBadge.length > 0
        ? Math.round((highBadge.reduce((s, e) => s + e.avgPerformanceScore, 0) / highBadge.length) * 100) / 100
        : null;
      const avgScoreLowBadge = lowBadge.length > 0
        ? Math.round((lowBadge.reduce((s, e) => s + e.avgPerformanceScore, 0) / lowBadge.length) * 100) / 100
        : null;

      res.json({
        correlation,
        interpretation: correlation > 0.5 ? "Strong positive correlation — badges correlate with higher performance"
          : correlation > 0.2 ? "Moderate positive correlation"
          : correlation > -0.2 ? "No significant correlation between badges and performance"
          : "Negative correlation — more badges don't predict higher scores",
        employeeCount: n,
        comparison: {
          highBadgeEmployees: highBadge.length,
          highBadgeAvgScore: avgScoreHighBadge,
          lowBadgeEmployees: lowBadge.length,
          lowBadgeAvgScore: avgScoreLowBadge,
          scoreDifference: avgScoreHighBadge !== null && avgScoreLowBadge !== null
            ? Math.round((avgScoreHighBadge - avgScoreLowBadge) * 100) / 100
            : null,
        },
        employees: stats.sort((a, b) => b.badgeCount - a.badgeCount),
      });
    } catch (error) {
      logger.error({ err: error }, "Failed to compute gamification effectiveness");
      res.status(500).json({ message: "Failed to compute effectiveness" });
    }
  });
}
