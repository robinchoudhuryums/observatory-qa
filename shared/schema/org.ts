import { z } from "zod";

// --- ORGANIZATION SCHEMAS ---
const hexColorRegex = /^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/;

export const orgBrandingSchema = z.object({
  appName: z.string().max(100).default("Observatory"),
  logoUrl: z.string().max(2048).optional(),
  primaryColor: z.string().regex(hexColorRegex, "Invalid hex color (e.g. #10b981)").optional(),
  secondaryColor: z.string().regex(hexColorRegex, "Invalid hex color (e.g. #10b981)").optional(),
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

export type IndustryType = (typeof INDUSTRY_TYPES)[number]["value"];

export const orgSettingsSchema = z.object({
  industryType: z.string().max(50).optional(),
  emailDomain: z
    .string()
    .max(255)
    .regex(/^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/, "Invalid domain format")
    .optional(),
  departments: z.array(z.string().min(1).max(100)).max(100).optional(),
  subTeams: z.record(z.string().max(100), z.array(z.string().min(1).max(100)).max(50)).optional(),
  callCategories: z.array(z.string().min(1).max(100)).max(50).optional(),
  callPartyTypes: z.array(z.string().min(1).max(100)).max(20).optional(),
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
  // Group-to-role mapping: IDP group name → Observatory role
  // e.g. { "observatory-admins": "admin", "observatory-managers": "manager" }
  ssoGroupRoleMap: z.record(z.string(), z.enum(["admin", "manager", "viewer"])).optional(),
  // SSO attribute name that contains group membership (default: "groups")
  ssoGroupAttribute: z.string().optional(),
  // Per-org SSO session max age (hours). Overrides the platform 8-hour max.
  // SSO users must re-authenticate after this many hours regardless of activity.
  ssoSessionMaxHours: z.number().min(1).max(72).optional(),
  // IDP SLO (Single Logout) endpoint — enables sync logout
  ssoLogoutUrl: z.string().url().optional(),
  // Certificate expiry (ISO date string, auto-computed from ssoCertificate PEM on save)
  ssoCertificateExpiry: z.string().optional(),
  // Secondary certificate for rotation: both old and new certs valid simultaneously
  ssoNewCertificate: z.string().optional(),
  ssoNewCertificateExpiry: z.string().optional(),
  // OIDC configuration (when ssoProvider = "oidc")
  oidcDiscoveryUrl: z.string().url().optional(), // e.g. https://accounts.google.com
  oidcClientId: z.string().optional(),
  oidcClientSecret: z.string().optional(),
  // SCIM 2.0 provisioning (Enterprise plan only)
  scimEnabled: z.boolean().optional(),
  scimTokenHash: z.string().optional(), // SHA-256 hash of the bearer token
  scimTokenPrefix: z.string().optional(), // First 8 chars for identification
  // MFA enforcement (HIPAA recommended safeguard)
  mfaRequired: z.boolean().optional(), // When true, all users in this org must enable MFA
  // Grace period: days users have to enroll after mfaRequired is first turned on
  mfaGracePeriodDays: z.number().min(1).max(30).optional(), // default 7
  // ISO timestamp when mfaRequired was first enabled (used to compute deadlines)
  mfaRequiredEnabledAt: z.string().optional(),
  // EHR integration configuration
  ehrConfig: z
    .object({
      system: z.enum(["open_dental", "eaglesoft", "dentrix"]),
      baseUrl: z.string(),
      apiKey: z.string().optional(),
      options: z.record(z.string()).optional(),
      enabled: z.boolean().default(false),
    })
    .optional(),
  // Billing alerts: send email when call quota approaches threshold
  billingAlerts: z
    .object({
      enabled: z.boolean().default(false),
      /** Percentage of monthly quota (50–100) at which to send an alert */
      quotaThresholdPct: z.number().min(50).max(100).default(80),
      /** Email address to notify (defaults to the admin's username/email) */
      alertEmail: z.string().email().optional(),
      /** ISO timestamp of the last quota alert email sent (prevents flooding) */
      lastQuotaAlertSentAt: z.string().optional(),
    })
    .optional(),
  // Gamification settings
  gamification: z
    .object({
      /** Global enable/disable for gamification features */
      enabled: z.boolean().default(true),
      /** Roles that are opted out of leaderboards/badges (e.g., ["viewer"] for clinical settings) */
      optedOutRoles: z.array(z.string()).optional(),
      /** Individual employee IDs opted out of gamification */
      optedOutEmployeeIds: z.array(z.string()).optional(),
      /** Enable team/department competitions */
      teamCompetitionsEnabled: z.boolean().default(false),
    })
    .optional(),
  // Budget alerts: admin-configurable spend thresholds
  budgetAlerts: z
    .object({
      enabled: z.boolean().default(false),
      /** Monthly spend threshold in USD — alert when estimated spend exceeds this */
      monthlyBudgetUsd: z.number().min(0).optional(),
      /** Email address for budget alerts */
      alertEmail: z.string().email().optional(),
      /** ISO timestamp of last budget alert sent (prevents flooding, max 1/day) */
      lastBudgetAlertSentAt: z.string().optional(),
    })
    .optional(),
  // Provider-specific clinical note style preferences (self-learning feature)
  providerStylePreferences: z
    .record(
      z.string(),
      z.object({
        noteFormat: z.string().optional(),
        sectionOrder: z.array(z.string()).optional(),
        abbreviationLevel: z.enum(["minimal", "moderate", "heavy"]).optional(),
        includeNegativePertinents: z.boolean().optional(),
        defaultSpecialty: z.string().optional(),
        customSections: z.array(z.string()).optional(),
        templateOverrides: z.record(z.string()).optional(),
      }),
    )
    .optional(),
  // PII/PHI redaction config (overrides always-on defaults)
  piiRedaction: z
    .object({
      enabled: z.boolean().default(true),
      policies: z.array(z.string()).optional(), // override specific policies
      substitution: z.enum(["hash", "entity_name"]).default("hash"),
    })
    .optional(),
  // Custom vocabulary — word boost list for better transcription of org-specific terms
  customVocabulary: z.array(z.string().min(1).max(200).trim()).max(1000).optional(),
  // Co-signature requirements (clinical documentation)
  requiresCosignature: z.boolean().optional(), // all notes require co-signature
  cosignatureRoles: z.array(z.string()).optional(), // ["admin", "manager"] can co-sign
  // SIEM forwarding for Enterprise customers (Splunk, Datadog, etc.)
  siemWebhookUrl: z.string().url().optional(),
  siemEnabled: z.boolean().default(false).optional(),
  // Per-org KMS envelope encryption (when AWS_KMS_KEY_ID is set)
  // The encrypted DEK (data encryption key) is stored here; the KEK (key encryption key)
  // lives in AWS KMS and is identified by kmsKeyId. PHI fields are encrypted with the DEK,
  // not the master key, enabling efficient key rotation without re-encrypting all data.
  encryptedDataKey: z.string().optional(), // KMS-encrypted DEK blob (base64)
  kmsKeyId: z.string().optional(), // CMK ARN used to encrypt the DEK
  // Speaker role configuration — maps speaker labels to roles for call analysis.
  // Default: { A: "agent", B: "customer" }. Override per-org when agent doesn't speak first
  // (e.g., IVR-routed calls where customer speaks first).
  defaultSpeakerRoles: z.record(z.string(), z.string()).optional(),
  // Edit pattern insights: aggregated analysis of manager manual score edits
  editPatternInsights: z
    .object({
      updatedAt: z.string(),
      totalEdits: z.number(),
      insights: z.array(
        z.object({
          dimension: z.string(),
          avgDelta: z.number(),
          editCount: z.number(),
          pattern: z.string(),
        }),
      ),
    })
    .optional(),
});

export const insertOrganizationSchema = z.object({
  name: z.string().min(1),
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, "Slug must be lowercase alphanumeric with hyphens"),
  settings: orgSettingsSchema.optional(),
  status: z.enum(["active", "suspended", "trial", "deleted"]).default("active"),
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
  // WebAuthn/Passkey credentials (each user can have multiple hardware keys / passkeys)
  webauthnCredentials: z
    .array(
      z.object({
        credentialId: z.string(), // base64url-encoded credential ID
        publicKey: z.string(), // base64url-encoded COSE public key
        counter: z.number(), // signature counter for replay protection
        transports: z.array(z.string()).optional(), // usb, nfc, ble, internal
        name: z.string(), // user-assigned device name
        createdAt: z.string(),
      }),
    )
    .optional(),
  // Trusted device tokens — hashed bearer tokens set after MFA, exempt for N days
  mfaTrustedDevices: z
    .array(
      z.object({
        tokenHash: z.string(), // SHA-256 of the cookie value
        name: z.string(), // device name / browser info
        createdAt: z.string(),
        expiresAt: z.string(),
      }),
    )
    .optional(),
  // Grace period deadline for MFA enrollment (set when org enables mfaRequired)
  mfaEnrollmentDeadline: z.string().optional(), // ISO date
  // Team scope for managers — limits visibility to employees/calls in this subTeam only
  subTeam: z.string().optional(),
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

// --- TYPES ---
export type InsertOrganization = z.infer<typeof insertOrganizationSchema>;
export type Organization = z.infer<typeof organizationSchema>;
export type OrgSettings = z.infer<typeof orgSettingsSchema>;
export type OrgBranding = z.infer<typeof orgBrandingSchema>;

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = z.infer<typeof userSchema>;

export type InsertEmployee = z.infer<typeof insertEmployeeSchema>;
export type Employee = z.infer<typeof employeeSchema>;
