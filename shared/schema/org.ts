import { z } from "zod";

// --- ORGANIZATION SCHEMAS ---
export const orgBrandingSchema = z.object({
  appName: z.string().default("Observatory"),
  logoUrl: z.string().optional(),
  primaryColor: z.string().optional(), // Hex color (e.g., "#10b981") to override default theme
  secondaryColor: z.string().optional(), // Hex color for accent/secondary elements
  onboardingCompleted: z.boolean().optional(),
});

export const INDUSTRY_TYPES = [
  { value: "contact_center", label: "Contact Center / Call Center" },
  { value: "healthcare", label: "Healthcare (General)" },
  { value: "dental", label: "Dental Practice" },
  { value: "behavioral_health", label: "Behavioral Health" },
  { value: "insurance", label: "Insurance" },
  { value: "financial", label: "Financial Services" },
  { value: "legal", label: "Legal" },
  { value: "veterinary", label: "Veterinary" },
  { value: "other", label: "Other" },
] as const;

export type IndustryType = typeof INDUSTRY_TYPES[number]["value"];

export const orgSettingsSchema = z.object({
  industryType: z.string().optional(),
  emailDomain: z.string().optional(),
  departments: z.array(z.string()).optional(),
  subTeams: z.record(z.string(), z.array(z.string())).optional(),
  callCategories: z.array(z.string()).optional(),
  callPartyTypes: z.array(z.string()).optional(),
  retentionDays: z.number().default(90),
  branding: orgBrandingSchema.optional(),
  bedrockModel: z.string().optional(), // Per-org model override (e.g., "us.anthropic.claude-haiku-4-5-20251001")
  maxCallsPerDay: z.number().optional(), // Per-org usage quota
  maxStorageMb: z.number().optional(), // Per-org storage limit
  // Webhook notification settings (override env vars per-org)
  webhookUrl: z.string().url().optional(),
  webhookPlatform: z.enum(["slack", "teams"]).optional(),
  webhookEvents: z.array(z.string()).optional(), // e.g., ["low_score", "agent_misconduct", "exceptional_call"]
  // SSO configuration (Enterprise plan only)
  ssoProvider: z.enum(["saml", "oidc"]).optional(),
  ssoEntityId: z.string().optional(),
  ssoSignOnUrl: z.string().url().optional(),
  ssoCertificate: z.string().optional(),
  ssoEnforced: z.boolean().optional(), // When true, only SSO login allowed
  // MFA enforcement (HIPAA recommended safeguard)
  mfaRequired: z.boolean().optional(), // When true, all users in this org must enable MFA
  // EHR integration configuration
  ehrConfig: z.object({
    system: z.enum(["open_dental", "eaglesoft", "dentrix"]),
    baseUrl: z.string(),
    apiKey: z.string().optional(),
    options: z.record(z.string()).optional(),
    enabled: z.boolean().default(false),
  }).optional(),
  // Billing alerts: send email when call quota approaches threshold
  billingAlerts: z.object({
    enabled: z.boolean().default(false),
    /** Percentage of monthly quota (50–100) at which to send an alert */
    quotaThresholdPct: z.number().min(50).max(100).default(80),
    /** Email address to notify (defaults to the admin's username/email) */
    alertEmail: z.string().email().optional(),
    /** ISO timestamp of the last quota alert email sent (prevents flooding) */
    lastQuotaAlertSentAt: z.string().optional(),
  }).optional(),
  // Provider-specific clinical note style preferences (self-learning feature)
  providerStylePreferences: z.record(z.string(), z.object({
    noteFormat: z.string().optional(),
    sectionOrder: z.array(z.string()).optional(),
    abbreviationLevel: z.enum(["minimal", "moderate", "heavy"]).optional(),
    includeNegativePertinents: z.boolean().optional(),
    defaultSpecialty: z.string().optional(),
    customSections: z.array(z.string()).optional(),
    templateOverrides: z.record(z.string()).optional(),
  })).optional(),
  // PII/PHI redaction config (overrides always-on defaults)
  piiRedaction: z.object({
    enabled: z.boolean().default(true),
    policies: z.array(z.string()).optional(), // override specific policies
    substitution: z.enum(["hash", "entity_name"]).default("hash"),
  }).optional(),
  // Custom vocabulary — word boost list for better transcription of org-specific terms
  customVocabulary: z.array(z.string()).optional(),
  // Co-signature requirements (clinical documentation)
  requiresCosignature: z.boolean().optional(),   // all notes require co-signature
  cosignatureRoles: z.array(z.string()).optional(), // ["admin", "manager"] can co-sign
  // SIEM forwarding for Enterprise customers (Splunk, Datadog, etc.)
  siemWebhookUrl: z.string().url().optional(),
  siemEnabled: z.boolean().default(false).optional(),
  // Edit pattern insights: aggregated analysis of manager manual score edits
  editPatternInsights: z.object({
    updatedAt: z.string(),
    totalEdits: z.number(),
    insights: z.array(z.object({
      dimension: z.string(),
      avgDelta: z.number(),
      editCount: z.number(),
      pattern: z.string(),
    })),
  }).optional(),
});

export const insertOrganizationSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/, "Slug must be lowercase alphanumeric with hyphens"),
  settings: orgSettingsSchema.optional(),
  status: z.enum(["active", "suspended", "trial"]).default("active"),
});

export const organizationSchema = insertOrganizationSchema.extend({
  id: z.string(),
  createdAt: z.string().optional(),
});

// --- USER SCHEMAS ---
export const insertUserSchema = z.object({
  orgId: z.string(),
  username: z.string(),
  passwordHash: z.string(),
  name: z.string(),
  role: z.string().default("viewer"),
  mfaEnabled: z.boolean().optional(),
  mfaSecret: z.string().optional(),
  mfaBackupCodes: z.array(z.string()).optional(),
});

export const userSchema = insertUserSchema.extend({
  id: z.string(),
  orgId: z.string(),
  createdAt: z.string().optional(),
});

// --- EMPLOYEE SCHEMAS ---
export const insertEmployeeSchema = z.object({
  orgId: z.string(),
  name: z.string(),
  role: z.string().optional(),
  email: z.string(),
  initials: z.string().max(2).optional(),
  status: z.enum(["Active", "Inactive"]).default("Active").optional(),
  subTeam: z.string().optional(),
});

export const employeeSchema = insertEmployeeSchema.extend({
  id: z.string(),
  orgId: z.string(),
  createdAt: z.string().optional(),
});

// --- DEFAULT SUB-TEAMS (originally UMS Power Mobility, now used as defaults) ---
// Organizations can override these via org settings (orgSettings.subTeams)
export const DEFAULT_SUBTEAMS: Record<string, readonly string[]> = {
  "Intake - Power Mobility": [
    "PPD",
    "MA Education",
    "Appt Scheduling",
    "PT Education",
    "Appt Passed",
    "PT Eval",
    "MDO Follow-Up",
    "Medical Review",
    "Prior Authorization",
  ],
};

/** @deprecated Use org settings subTeams instead. Kept for backward compatibility. */
export const POWER_MOBILITY_SUBTEAMS = DEFAULT_SUBTEAMS["Intake - Power Mobility"]!;

// --- TYPES ---
export type InsertOrganization = z.infer<typeof insertOrganizationSchema>;
export type Organization = z.infer<typeof organizationSchema>;
export type OrgSettings = z.infer<typeof orgSettingsSchema>;
export type OrgBranding = z.infer<typeof orgBrandingSchema>;

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = z.infer<typeof userSchema>;

export type InsertEmployee = z.infer<typeof insertEmployeeSchema>;
export type Employee = z.infer<typeof employeeSchema>;
