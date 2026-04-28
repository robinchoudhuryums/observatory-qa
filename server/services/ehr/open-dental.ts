/**
 * Open Dental EHR Adapter
 *
 * Open Dental is an open-source dental practice management software with a
 * well-documented REST API (Open Dental API / FHIR). This adapter integrates
 * Observatory QA with Open Dental for:
 * - Patient record lookup (demographics, insurance, allergies, medications)
 * - Appointment data (for call context enrichment)
 * - Clinical note push (write AI-generated notes back to patient records)
 * - Treatment plan retrieval (for treatment acceptance call scoring)
 *
 * API Documentation: https://www.opendental.com/site/apiDocumentation.html
 * The API uses a developer key + customer key authentication model.
 *
 * Configuration (stored in org settings):
 *   baseUrl: "https://<practice-server>/api/v1" or Open Dental Cloud URL
 *   apiKey: Developer key
 *   options.customerKey: Customer-specific API key
 */

import type {
  IEhrAdapter,
  EhrConnectionConfig,
  EhrPatient,
  EhrAppointment,
  EhrClinicalNote,
  EhrTreatmentPlan,
  EhrSyncResult,
  EhrAppointmentCreate,
} from "./types.js";
import { classifyEhrError } from "./types.js";
import { ehrRequest } from "./request.js";
import { logger } from "../logger.js";

export class OpenDentalAdapter implements IEhrAdapter {
  readonly system = "open_dental" as const;

  private buildHeaders(config: EhrConnectionConfig): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `ODFHIR ${config.apiKey}/${config.options?.customerKey || ""}`,
    };
  }

  private async request<T>(config: EhrConnectionConfig, method: string, path: string, body?: unknown): Promise<T> {
    const url = `${config.baseUrl.replace(/\/$/, "")}${path}`;
    return ehrRequest<T>({
      method,
      url,
      body,
      headers: this.buildHeaders(config),
      systemLabel: "Open Dental",
    });
  }

  async testConnection(config: EhrConnectionConfig): Promise<{ connected: boolean; version?: string; error?: string }> {
    try {
      // Open Dental API version/status endpoint
      const result = await this.request<{ Version?: string }>(config, "GET", "/patients?Limit=1");
      return { connected: true, version: result?.Version || "unknown" };
    } catch (err) {
      return {
        connected: false,
        error: err instanceof Error ? err.message : "Connection failed",
      };
    }
  }

  async searchPatients(
    config: EhrConnectionConfig,
    query: { name?: string; dob?: string; phone?: string },
  ): Promise<EhrPatient[]> {
    const params = new URLSearchParams();
    if (query.name) {
      const parts = query.name.trim().split(/\s+/);
      if (parts.length >= 2) {
        params.set("FName", parts[0]!);
        params.set("LName", parts.slice(1).join(" "));
      } else {
        params.set("LName", parts[0]!);
      }
    }
    if (query.dob) params.set("Birthdate", query.dob);
    if (query.phone) params.set("HmPhone", query.phone);
    params.set("Limit", "20");

    const patients = await this.request<OpenDentalPatient[]>(config, "GET", `/patients?${params.toString()}`);

    return patients.map((p) => this.mapPatient(p));
  }

  async getPatient(config: EhrConnectionConfig, ehrPatientId: string): Promise<EhrPatient | null> {
    try {
      const patient = await this.request<OpenDentalPatient>(config, "GET", `/patients/${ehrPatientId}`);
      return this.mapPatient(patient);
    } catch (err) {
      const ehrErr = classifyEhrError(err, "Open Dental");
      if (ehrErr.errorType === "not_found") return null;
      logger.error(
        { err: ehrErr, ehrPatientId, errorType: ehrErr.errorType },
        `Open Dental getPatient failed: ${ehrErr.errorType}`,
      );
      throw ehrErr;
    }
  }

  async getAppointments(
    config: EhrConnectionConfig,
    params: { startDate: string; endDate: string; providerId?: string },
  ): Promise<EhrAppointment[]> {
    const queryParams = new URLSearchParams({
      date: params.startDate,
      dateEnd: params.endDate,
    });
    if (params.providerId) queryParams.set("provNum", params.providerId);

    const appointments = await this.request<OpenDentalAppointment[]>(
      config,
      "GET",
      `/appointments?${queryParams.toString()}`,
    );

    return appointments.map((a) => this.mapAppointment(a));
  }

  async getTodayAppointments(config: EhrConnectionConfig, providerId?: string): Promise<EhrAppointment[]> {
    const today = new Date().toISOString().split("T")[0]!;
    return this.getAppointments(config, { startDate: today, endDate: today, providerId });
  }

  async pushClinicalNote(config: EhrConnectionConfig, note: EhrClinicalNote): Promise<EhrSyncResult> {
    try {
      // Open Dental uses "commlog" (communication log) or "procnote" for clinical notes
      const result = await this.request<{ CommlogNum?: number; ProcNoteNum?: number }>(config, "POST", "/commlog", {
        PatNum: note.patientId,
        CommDateTime: note.date,
        CommType: 0, // General note
        Note: note.content,
        Mode_: 0, // None (documentation)
        UserNum: note.providerId,
      });

      return {
        success: true,
        ehrRecordId: String(result?.CommlogNum || result?.ProcNoteNum || ""),
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "Failed to push note",
        timestamp: new Date().toISOString(),
      };
    }
  }

  async getPatientTreatmentPlans(config: EhrConnectionConfig, patientId: string): Promise<EhrTreatmentPlan[]> {
    try {
      const plans = await this.request<OpenDentalTreatPlan[]>(config, "GET", `/treatplans?PatNum=${patientId}`);

      // Fetch procedure details for each plan. Open Dental stores procedures as ProcTP
      // (treatment plan procedures) linked via TreatPlanNum.
      const enrichedPlans: EhrTreatmentPlan[] = [];
      for (const plan of plans) {
        let procedures: OpenDentalProcTP[] = [];
        try {
          procedures = await this.request<OpenDentalProcTP[]>(
            config,
            "GET",
            `/proctp?TreatPlanNum=${plan.TreatPlanNum}`,
          );
        } catch {
          // Non-fatal: return plan without procedure details
          logger.debug({ treatPlanNum: plan.TreatPlanNum }, "Open Dental: could not fetch plan procedures");
        }

        let totalFee = 0;
        let totalInsurance = 0;
        let totalPatient = 0;
        const mappedProcs = procedures.map((proc) => {
          const fee = proc.FeeAmt || 0;
          const ins = proc.InsAmt || 0;
          const pat = fee - ins;
          totalFee += fee;
          totalInsurance += ins;
          totalPatient += Math.max(0, pat);
          return {
            code: proc.ProcCode || "",
            description: proc.Descript || "",
            toothNumber: proc.ToothNumTP || undefined,
            surface: proc.Surface || undefined,
            fee,
            insuranceEstimate: ins,
            patientEstimate: Math.max(0, pat),
          };
        });

        enrichedPlans.push({
          ehrPlanId: String(plan.TreatPlanNum),
          patientId,
          providerId: "",
          status: this.mapTreatPlanStatus(plan.TPStatus),
          phases:
            mappedProcs.length > 0
              ? [{ phase: 1, description: plan.Heading || "Treatment Plan", procedures: mappedProcs }]
              : [],
          totalFee: Math.round(totalFee * 100) / 100,
          totalInsurance: Math.round(totalInsurance * 100) / 100,
          totalPatient: Math.round(totalPatient * 100) / 100,
          createdAt: plan.DateTP || new Date().toISOString(),
        });
      }

      return enrichedPlans;
    } catch (err) {
      const ehrErr = classifyEhrError(err, "Open Dental");
      if (ehrErr.errorType === "not_found") return [];
      logger.error(
        { err: ehrErr, patientId, errorType: ehrErr.errorType },
        `Open Dental getPatientTreatmentPlans failed: ${ehrErr.errorType}`,
      );
      throw ehrErr;
    }
  }

  /**
   * Create an appointment in Open Dental.
   * Maps the generic EhrAppointmentCreate to Open Dental's appointment format.
   */
  async createAppointment(config: EhrConnectionConfig, appointment: EhrAppointmentCreate): Promise<EhrSyncResult> {
    try {
      // Build the time pattern: each character = 5 min slot. "X" = provider time.
      const slots = Math.max(1, Math.ceil(appointment.duration / 5));
      const pattern = "X".repeat(slots);

      const result = await this.request<{ AptNum?: number }>(config, "POST", "/appointments", {
        PatNum: parseInt(appointment.patientId, 10),
        ProvNum: parseInt(appointment.providerId, 10),
        AptDateTime: `${appointment.date}T${appointment.startTime}:00`,
        Pattern: pattern,
        AptStatus: 1, // Scheduled
        Note: appointment.notes || "",
        ProcDescript: appointment.procedures?.map((p) => `${p.code} - ${p.description}`).join(", ") || "",
      });

      return {
        success: true,
        ehrRecordId: String(result?.AptNum || ""),
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "Failed to create appointment",
        timestamp: new Date().toISOString(),
      };
    }
  }

  // --- Private mapping helpers ---

  private mapPatient(p: OpenDentalPatient): EhrPatient {
    // Parse comma-separated allergy/medication strings into arrays
    const parseList = (s?: string) =>
      s
        ? s
            .split(/[,;]\s*/)
            .map((x) => x.trim())
            .filter(Boolean)
        : undefined;

    return {
      ehrPatientId: String(p.PatNum),
      firstName: p.FName || "",
      lastName: p.LName || "",
      dateOfBirth: p.Birthdate || "",
      phone: p.HmPhone || p.WirelessPhone || undefined,
      email: p.Email || undefined,
      insurance: p.carrierName
        ? {
            carrier: p.carrierName,
            groupNumber: p.GroupNum || undefined,
            subscriberId: p.SubscriberID || undefined,
            planType: p.PlanType || undefined,
          }
        : undefined,
      allergies: parseList(p.MedicalComp),
      medications: parseList(p.MedicalHistory),
      medicalAlerts: p.MedUrgNote ? [p.MedUrgNote] : undefined,
      lastVisitDate: p.DateLastVisit || undefined,
    };
  }

  private mapAppointment(a: OpenDentalAppointment): EhrAppointment {
    // Parse procedure description (format: "D1110 - Prophylaxis, D0120 - Periodic Exam")
    const procedures = a.ProcDescript
      ? a.ProcDescript.split(",")
          .map((p) => {
            const trimmed = p.trim();
            const match = trimmed.match(/^([A-Z]?\d{4,5})\s*[-–—]\s*(.+)/);
            return match ? { code: match[1]!, description: match[2]!.trim() } : { code: "", description: trimmed };
          })
          .filter((p) => p.description)
      : undefined;

    return {
      ehrAppointmentId: String(a.AptNum),
      patientId: String(a.PatNum),
      patientName: a.PatientName || "",
      providerId: String(a.ProvNum),
      providerName: a.ProviderName || "",
      date: a.AptDateTime?.split("T")[0] || "",
      startTime: a.AptDateTime?.split("T")[1]?.slice(0, 5) || "",
      duration: Math.round((a.Pattern?.length || 1) * 5), // Each char = 5 min in Open Dental
      status: this.mapAptStatus(a.AptStatus),
      procedures: procedures && procedures.length > 0 ? procedures : undefined,
      notes: a.Note || undefined,
    };
  }

  private mapAptStatus(status: number | undefined): EhrAppointment["status"] {
    switch (status) {
      case 1:
        return "scheduled";
      case 2:
        return "completed";
      case 3:
        return "cancelled"; // Unscheduled list
      case 5:
        return "cancelled"; // Broken
      default:
        return "scheduled";
    }
  }

  private mapTreatPlanStatus(status: number | undefined): EhrTreatmentPlan["status"] {
    switch (status) {
      case 0:
        return "proposed"; // Active
      case 1:
        return "completed"; // Inactive
      default:
        return "proposed";
    }
  }
}

// --- Open Dental API types (subset of fields we use) ---

interface OpenDentalPatient {
  PatNum: number;
  FName: string;
  LName: string;
  Birthdate?: string;
  HmPhone?: string;
  WirelessPhone?: string;
  Email?: string;
  carrierName?: string;
  GroupNum?: string;
  SubscriberID?: string;
  PlanType?: string;
  MedicalComp?: string; // Allergies (comma-separated text)
  MedicalHistory?: string; // Medications/conditions (comma-separated text)
  MedUrgNote?: string;
  DateLastVisit?: string;
}

interface OpenDentalAppointment {
  AptNum: number;
  PatNum: number;
  PatientName?: string;
  ProvNum: number;
  ProviderName?: string;
  AptDateTime?: string;
  Pattern?: string;
  AptStatus?: number;
  Note?: string;
  ProcDescript?: string;
}

interface OpenDentalTreatPlan {
  TreatPlanNum: number;
  PatNum: number;
  TPStatus?: number;
  Heading?: string;
  DateTP?: string;
  Note?: string;
}

/** Treatment plan procedure — individual procedure line item within a treatment plan. */
interface OpenDentalProcTP {
  ProcTPNum?: number;
  TreatPlanNum: number;
  PatNum?: number;
  ProcCode?: string;
  Descript?: string;
  FeeAmt?: number;
  InsAmt?: number;
  ToothNumTP?: string;
  Surface?: string;
  Priority?: number;
}
