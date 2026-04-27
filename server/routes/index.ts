import type { Express } from "express";
import { createServer, type Server } from "http";
import { registerHealthRoutes } from "./health";
import { registerAuthRoutes } from "./auth";
import { registerAccessRoutes } from "./access";
import { registerAdminRoutes } from "./admin";
import { registerDashboardRoutes } from "./dashboard";
import { registerEmployeeRoutes } from "./employees";
import { registerCallRoutes } from "./calls";
import { startUploadCleanup } from "./helpers";
import { registerReportRoutes } from "./reports";
import { registerCoachingRoutes } from "./coaching";
import { registerInsightRoutes } from "./insights";
import { registerRegistrationRoutes } from "./registration";
import { registerApiKeyRoutes, apiKeyAuth } from "./api-keys";
import { registerOAuthRoutes, setupGoogleOAuth } from "./oauth";
import { registerBillingRoutes } from "./billing";
import { registerOnboardingRoutes } from "./onboarding";
import { registerPasswordResetRoutes } from "./password-reset";
import { registerExportRoutes } from "./export";
import { registerSsoRoutes, setupSamlAuth, setupOidcAuth } from "./sso";
import { registerScimRoutes } from "./scim";
import { registerMfaRoutes } from "./mfa";
import { registerABTestRoutes } from "./ab-testing";
import { registerSpendTrackingRoutes } from "./spend-tracking";
import { registerClinicalRoutes } from "./clinical";
import { registerEhrRoutes } from "./ehr";
import { registerLiveSessionRoutes } from "./live-session";
import { registerSuperAdminRoutes } from "./super-admin";
import { registerCallInsightRoutes } from "./call-insights";
import { registerFeedbackRoutes } from "./feedback";
import { registerGamificationRoutes } from "./gamification";
import { registerInsuranceNarrativeRoutes } from "./insurance-narratives";
import { registerRevenueRoutes } from "./revenue";
import { registerCalibrationRoutes } from "./calibration";
import { registerEmailRoutes } from "./emails";
import { registerLmsRoutes } from "./lms";
import { registerMarketingRoutes } from "./marketing";
import { registerBenchmarkRoutes } from "./benchmarks";
import { registerPatientJourneyRoutes } from "./patient-journey";
import { registerBaaRoutes } from "./baa";
import { registerAssemblyAIWebhookRoutes } from "./assemblyai-webhook";
import { registerCallTagRoutes } from "./call-tags";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function registerRoutes(app: Express): Promise<Server> {
  // Validate UUID params on API routes that use :id, :callId, etc.
  // This prevents malformed IDs from reaching the database layer.
  for (const param of ["id", "callId"]) {
    app.param(param, (req, res, next, value) => {
      if (req.path.startsWith("/api/") && !UUID_REGEX.test(value)) {
        res.status(400).json({ message: `Invalid ${param} format` });
        return;
      }
      next();
    });
  }

  // Register AssemblyAI webhook BEFORE auth middleware — it is public but token-verified
  registerAssemblyAIWebhookRoutes(app);

  // API key auth middleware (before routes, after session middleware)
  app.use("/api", apiKeyAuth);

  // Set up Google OAuth if configured
  await setupGoogleOAuth();

  // Set up SAML SSO (per-org IDP configuration)
  await setupSamlAuth();
  // Set up OIDC (per-org discovery; no global passport strategy needed)
  setupOidcAuth();

  registerHealthRoutes(app);
  registerAuthRoutes(app);
  registerOAuthRoutes(app);
  registerSsoRoutes(app);
  registerScimRoutes(app);
  registerRegistrationRoutes(app);
  registerPasswordResetRoutes(app);
  registerMfaRoutes(app);
  registerAccessRoutes(app);
  registerAdminRoutes(app);
  registerApiKeyRoutes(app);
  registerBillingRoutes(app);
  registerOnboardingRoutes(app);
  registerDashboardRoutes(app);
  registerEmployeeRoutes(app);
  registerCallRoutes(app);
  // Call tags + annotations (Tier 1A) — must come AFTER registerCallRoutes
  // so the /api/calls/:id namespace base is established. Tag/annotation
  // routes mount additional sub-paths under /api/calls/:id and /api/tags.
  registerCallTagRoutes(app);
  registerReportRoutes(app);
  registerCoachingRoutes(app);
  registerInsightRoutes(app);
  registerExportRoutes(app);
  registerABTestRoutes(app);
  registerSpendTrackingRoutes(app);
  registerClinicalRoutes(app);
  registerEhrRoutes(app);
  registerLiveSessionRoutes(app);
  registerSuperAdminRoutes(app);
  registerCallInsightRoutes(app);
  registerFeedbackRoutes(app);
  registerGamificationRoutes(app);
  registerInsuranceNarrativeRoutes(app);
  registerRevenueRoutes(app);
  registerCalibrationRoutes(app);
  registerEmailRoutes(app);
  registerLmsRoutes(app);
  registerMarketingRoutes(app);
  registerBenchmarkRoutes(app);
  registerPatientJourneyRoutes(app);
  registerBaaRoutes(app);

  // Start periodic cleanup of orphaned upload temp files
  startUploadCleanup();

  const httpServer = createServer(app);
  return httpServer;
}
