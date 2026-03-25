/**
 * EHR Adapter Interface — abstract layer for integrating with dental/medical EHR systems.
 *
 * Each EHR system implements this interface. The adapter handles:
 * - Patient record lookup (demographics, insurance, history)
 * - Appointment data retrieval (for call context enrichment)
 * - Clinical note push (write completed notes back to EHR)
 * - Treatment plan sync (read/write treatment plans)
 * - Bidirectional appointment scheduling (optional, adapter-specific)
 *
 * Per-org EHR configuration is stored in org settings.
 */

export interface EhrPatient {
  ehrPatientId: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  phone?: string;
  email?: string;
  insurance?: {
    carrier: string;
    groupNumber?: string;
    subscriberId?: string;
    planType?: string;
  };
  allergies?: string[];
  medications?: string[];
  medicalAlerts?: string[];
  lastVisitDate?: string;
}

export interface EhrAppointment {
  ehrAppointmentId: string;
  patientId: string;
  patientName: string;
  providerId: string;
  providerName: string;
  date: string;
  startTime: string;
  duration: number; // minutes
  status: "scheduled" | "confirmed" | "checked_in" | "in_progress" | "completed" | "cancelled" | "no_show";
  procedures?: Array<{ code: string; description: string }>;
  notes?: string;
}

export interface EhrClinicalNote {
  patientId: string;
  providerId: string;
  date: string;
  noteType: string;
  content: string;
  structuredData?: Record<string, unknown>;
  procedureCodes?: Array<{ code: string; description: string }>;
  diagnosisCodes?: Array<{ code: string; description: string }>;
}

export interface EhrTreatmentPlan {
  ehrPlanId: string;
  patientId: string;
  providerId: string;
  status: "proposed" | "accepted" | "in_progress" | "completed" | "declined";
  phases: Array<{
    phase: number;
    description: string;
    procedures: Array<{
      code: string;
      description: string;
      toothNumber?: string;
      surface?: string;
      fee: number;
      insuranceEstimate: number;
      patientEstimate: number;
    }>;
  }>;
  totalFee: number;
  totalInsurance: number;
  totalPatient: number;
  createdAt: string;
}

export interface EhrConnectionConfig {
  /** EHR system type */
  system: "open_dental" | "eaglesoft" | "dentrix" | "fhir_r4" | "mock";
  /** API base URL or server address */
  baseUrl: string;
  /** API key, token, or credentials (encrypted at rest) */
  apiKey?: string;
  /** Additional system-specific configuration */
  options?: Record<string, string>;
  /** Whether this integration is active */
  enabled?: boolean;
  /**
   * AWS Secrets Manager ARN for storing EHR credentials.
   * When set, the apiKey is fetched from Secrets Manager at runtime
   * rather than being stored (even encrypted) in org settings.
   */
  secretArn?: string;
}

export interface EhrSyncResult {
  success: boolean;
  ehrRecordId?: string;
  error?: string;
  timestamp: string;
}

/**
 * Health status for an EHR integration.
 * Stored in org settings and updated by the health monitor worker.
 */
export interface EhrHealthStatus {
  orgId: string;
  system: string;
  connected: boolean;
  lastChecked: string;
  lastError?: string;
  consecutiveFailures: number;
  /** ISO timestamp when the connection first went down (for alert dedup) */
  downSince?: string;
  /** ISO timestamp of last successful connection */
  lastSuccessAt?: string;
}

/**
 * Result of attempting to match an inbound call to a scheduled EHR appointment.
 */
export interface AppointmentMatchResult {
  matched: boolean;
  appointment?: EhrAppointment;
  patient?: EhrPatient;
  /** Confidence in the match */
  confidence: "high" | "medium" | "low";
  /** Human-readable reason for the match (or non-match) */
  matchReason?: string;
}

/** Fields for creating a new appointment in an EHR system */
export interface EhrAppointmentCreate {
  patientId: string;
  providerId: string;
  date: string;        // ISO date: YYYY-MM-DD
  startTime: string;   // HH:mm
  duration: number;    // minutes
  procedures?: Array<{ code: string; description: string }>;
  notes?: string;
}

/** Fields for updating a treatment plan in an EHR system */
export interface EhrTreatmentPlanUpdate {
  status?: EhrTreatmentPlan["status"];
  notes?: string;
  /** Accept or decline a specific phase */
  phaseUpdates?: Array<{
    phase: number;
    status: "accepted" | "declined";
  }>;
}

/**
 * Abstract EHR adapter — implemented per EHR system.
 * All methods are org-scoped (config comes from org settings).
 */
export interface IEhrAdapter {
  /** The EHR system this adapter supports */
  readonly system: EhrConnectionConfig["system"];

  /** Test the connection to the EHR system */
  testConnection(config: EhrConnectionConfig): Promise<{ connected: boolean; version?: string; error?: string }>;

  // --- Patient Operations ---

  /** Search for a patient by name, DOB, phone, or other criteria */
  searchPatients(config: EhrConnectionConfig, query: { name?: string; dob?: string; phone?: string }): Promise<EhrPatient[]>;

  /** Get a specific patient by EHR patient ID */
  getPatient(config: EhrConnectionConfig, ehrPatientId: string): Promise<EhrPatient | null>;

  // --- Appointment Operations ---

  /** Get appointments for a date range */
  getAppointments(config: EhrConnectionConfig, params: { startDate: string; endDate: string; providerId?: string }): Promise<EhrAppointment[]>;

  /** Get today's appointments (convenience) */
  getTodayAppointments(config: EhrConnectionConfig, providerId?: string): Promise<EhrAppointment[]>;

  /**
   * Create a new appointment in the EHR system.
   * Optional — not all adapters support write operations.
   */
  createAppointment?(config: EhrConnectionConfig, appointment: EhrAppointmentCreate): Promise<EhrSyncResult>;

  // --- Clinical Note Operations ---

  /** Push a clinical note to the EHR */
  pushClinicalNote(config: EhrConnectionConfig, note: EhrClinicalNote): Promise<EhrSyncResult>;

  // --- Treatment Plan Operations ---

  /** Get treatment plans for a patient */
  getPatientTreatmentPlans(config: EhrConnectionConfig, patientId: string): Promise<EhrTreatmentPlan[]>;

  /**
   * Update a treatment plan in the EHR system.
   * Optional — not all adapters support write operations.
   */
  updateTreatmentPlan?(config: EhrConnectionConfig, planId: string, update: EhrTreatmentPlanUpdate): Promise<EhrSyncResult>;
}
