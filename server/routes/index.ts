import type { Express } from "express";
import { createServer, type Server } from "http";
import { registerHealthRoutes } from "./health";
import { registerAuthRoutes } from "./auth";
import { registerAccessRoutes } from "./access";
import { registerAdminRoutes } from "./admin";
import { registerDashboardRoutes } from "./dashboard";
import { registerEmployeeRoutes } from "./employees";
import { registerCallRoutes } from "./calls";
import { registerReportRoutes } from "./reports";
import { registerCoachingRoutes } from "./coaching";
import { registerInsightRoutes } from "./insights";
import { registerRegistrationRoutes } from "./registration";

export async function registerRoutes(app: Express): Promise<Server> {
  registerHealthRoutes(app);
  registerAuthRoutes(app);
  registerRegistrationRoutes(app);
  registerAccessRoutes(app);
  registerAdminRoutes(app);
  registerDashboardRoutes(app);
  registerEmployeeRoutes(app);
  registerCallRoutes(app);
  registerReportRoutes(app);
  registerCoachingRoutes(app);
  registerInsightRoutes(app);

  const httpServer = createServer(app);
  return httpServer;
}
