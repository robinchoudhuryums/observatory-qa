/**
 * Dentrix EHR Adapter
 *
 * Dentrix (Henry Schein) is the largest dental practice management system in the US.
 * This adapter targets the Dentrix Ascend REST API (cloud) and is compatible with
 * on-premise Dentrix G7/Enterprise installations that expose the same REST surface.
 *
 * Dentrix Ascend API uses Bearer token (OAuth 2.0) authentication. The token is
 * obtained outside this adapter (stored in org settings as apiKey) and must be
 * refreshed per the practice's OAuth flow before expiry.
 *
 * Documentation: https://developer.dentrixascend.com/
 *
 * Configuration (stored in org settings):
 *   baseUrl: "https://api.dentrixascend.com" or on-premise URL
 *   apiKey: OAuth Bearer access token
 *   options.clinicId: Clinic/practice identifier (required for multi-location)
 *   options.practitionerId: Default provider ID for note push
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
  EhrTreatmentPlanUpdate,
} from "./types.js";
import { classifyEhrError } from "./types.js";
import { ehrRequest } from "./request.js";
import { logger } from "../logger.js";

export class DentrixAdapter implements IEhrAdapter {
  readonly system = "dentrix" as const;

  private buildHeaders(config: EhrConnectionConfig): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${config.apiKey || ""}`,
    };
    if (config.options?.clinicId) {
      headers["X-Clinic-Id"] = config.options.clinicId;
    }
    return headers;
  }

  private async request<T>(config: EhrConnectionConfig, method: string, path: string, body?: unknown): Promise<T> {
    const url = `${config.baseUrl.replace(/\/$/, "")}${path}`;
    return ehrRequest<T>({
      method,
      url,
      body,
      headers: this.buildHeaders(config),
      systemLabel: "Dentrix",
    });
  }

  async testConnection(config: EhrConnectionConfig): Promise<{ connected: boolean; version?: string; error?: string }> {
    try {
      // Dentrix Ascend uses /v1/practices to verify the token and get practice info
      const result = await this.request<{ version?: string; practiceId?: string; status?: string }>(
        config,
        "GET",
        "/v1/practices",
      );
      return { connected: true, version: result?.version || "Dentrix Ascend" };
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
    if (query.name) params.set("name", query.name);
    if (query.dob) params.set("dateOfBirth", query.dob);
    if (query.phone) params.set("phone", query.phone);
    params.set("limit", "20");

    const response = await this.request<{ patients?: DentrixPatient[]; data?: DentrixPatient[] }>(
      config,
      "GET",
      `/v1/patients?${params.toString()}`,
    );

    const patients = response.patients || response.data || [];
    return patients.map((p) => this.mapPatient(p));
  }

  async getPatient(config: EhrConnectionConfig, ehrPatientId: string): Promise<EhrPatient | null> {
    try {
      const patient = await this.request<DentrixPatient>(config, "GET", `/v1/patients/${ehrPatientId}`);
      return this.mapPatient(patient);
    } catch (err) {
      const ehrErr = classifyEhrError(err, "Dentrix");
      if (ehrErr.errorType === "not_found") return null;
      logger.error(
        { err: ehrErr, ehrPatientId, errorType: ehrErr.errorType },
        `Dentrix getPatient failed: ${ehrErr.errorType}`,
      );
      throw ehrErr;
    }
  }

  async getAppointments(
    config: EhrConnectionConfig,
    params: { startDate: string; endDate: string; providerId?: string },
  ): Promise<EhrAppointment[]> {
    const queryParams = new URLSearchParams({
      startDate: params.startDate,
      endDate: params.endDate,
    });
    if (params.providerId) queryParams.set("providerId", params.providerId);

    const response = await this.request<{ appointments?: DentrixAppointment[]; data?: DentrixAppointment[] }>(
      config,
      "GET",
      `/v1/appointments?${queryParams.toString()}`,
    );

    const appointments = response.appointments || response.data || [];
    return appointments.map((a) => this.mapAppointment(a));
  }

  async getTodayAppointments(config: EhrConnectionConfig, providerId?: string): Promise<EhrAppointment[]> {
    const today = new Date().toISOString().split("T")[0]!;
    return this.getAppointments(config, { startDate: today, endDate: today, providerId });
  }

  async createAppointment(config: EhrConnectionConfig, apt: EhrAppointmentCreate): Promise<EhrSyncResult> {
    try {
      const result = await this.request<{ appointmentId?: string; id?: string }>(config, "POST", "/v1/appointments", {
        patientId: apt.patientId,
        providerId: apt.providerId,
        date: apt.date,
        startTime: apt.startTime,
        durationMinutes: apt.duration,
        procedures: apt.procedures,
        notes: apt.notes,
      });

      return {
        success: true,
        ehrRecordId: result?.appointmentId || result?.id || "",
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

  async pushClinicalNote(config: EhrConnectionConfig, note: EhrClinicalNote): Promise<EhrSyncResult> {
    try {
      // Dentrix uses /v1/clinical-notes for documentation
      // Falls back to /v1/patient-communications for general notes
      let result: { noteId?: string; communicationId?: string; id?: string } | null = null;
      let endpoint = "/v1/clinical-notes";

      try {
        result = await this.request<{ noteId?: string; id?: string }>(config, "POST", endpoint, {
          patientId: note.patientId,
          providerId: note.providerId || config.options?.practitionerId,
          date: note.date,
          type: note.noteType?.toUpperCase() || "SOAP",
          content: note.content,
          procedureCodes: note.procedureCodes?.map((c) => c.code),
          diagnosisCodes: note.diagnosisCodes?.map((c) => c.code),
        });
      } catch (noteErr) {
        // If clinical-notes endpoint fails, try patient communications
        const msg = noteErr instanceof Error ? noteErr.message : "";
        if (msg.includes("404") || msg.includes("405")) {
          endpoint = "/v1/patient-communications";
          result = await this.request<{ communicationId?: string; id?: string }>(config, "POST", endpoint, {
            patientId: note.patientId,
            providerId: note.providerId || config.options?.practitionerId,
            date: note.date,
            type: "clinical_note",
            note: note.content,
          });
        } else {
          throw noteErr;
        }
      }

      return {
        success: true,
        ehrRecordId: result?.noteId || result?.communicationId || result?.id || "",
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "Failed to push note to Dentrix",
        timestamp: new Date().toISOString(),
      };
    }
  }

  async getPatientTreatmentPlans(config: EhrConnectionConfig, patientId: string): Promise<EhrTreatmentPlan[]> {
    try {
      const response = await this.request<{ treatmentPlans?: DentrixTreatmentPlan[]; data?: DentrixTreatmentPlan[] }>(
        config,
        "GET",
        `/v1/patients/${patientId}/treatment-plans`,
      );

      const plans = response.treatmentPlans || response.data || [];
      return plans.map((plan) => this.mapTreatmentPlan(plan, patientId));
    } catch (err) {
      const ehrErr = classifyEhrError(err, "Dentrix");
      if (ehrErr.errorType === "not_found") return [];
      logger.error(
        { err: ehrErr, patientId, errorType: ehrErr.errorType },
        `Dentrix getPatientTreatmentPlans failed: ${ehrErr.errorType}`,
      );
      throw ehrErr;
    }
  }

  async updateTreatmentPlan(
    config: EhrConnectionConfig,
    planId: string,
    update: EhrTreatmentPlanUpdate,
  ): Promise<EhrSyncResult> {
    try {
      await this.request<{ id?: string }>(config, "PATCH", `/v1/treatment-plans/${planId}`, {
        status: update.status,
        notes: update.notes,
        phaseUpdates: update.phaseUpdates,
      });

      return {
        success: true,
        ehrRecordId: planId,
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "Failed to update treatment plan",
        timestamp: new Date().toISOString(),
      };
    }
  }

  // --- Private mapping helpers ---

  private mapPatient(p: DentrixPatient): EhrPatient {
    const firstName = p.firstName || p.first_name || p.givenName || "";
    const lastName = p.lastName || p.last_name || p.familyName || "";

    return {
      ehrPatientId: String(p.id || p.patientId || ""),
      firstName,
      lastName,
      dateOfBirth: p.dateOfBirth || p.dob || p.birthDate || "",
      phone: p.primaryPhone || p.mobilePhone || p.homePhone || p.phone || undefined,
      email: p.email || p.emailAddress || undefined,
      insurance:
        p.primaryInsurance || p.insurance
          ? {
              carrier: p.primaryInsurance?.carrier || p.insurance?.name || "",
              groupNumber: p.primaryInsurance?.groupNumber || p.insurance?.groupNumber || undefined,
              subscriberId: p.primaryInsurance?.subscriberId || p.insurance?.memberId || undefined,
              planType: p.primaryInsurance?.planType || p.insurance?.planType || undefined,
            }
          : undefined,
      allergies: p.allergies?.map((a) => (typeof a === "string" ? a : a.name || String(a))) || undefined,
      medications: p.medications?.map((m) => (typeof m === "string" ? m : m.name || String(m))) || undefined,
      medicalAlerts: p.medicalAlerts || p.alerts || undefined,
      lastVisitDate: p.lastVisitDate || p.lastAppointmentDate || undefined,
    };
  }

  private mapAppointment(a: DentrixAppointment): EhrAppointment {
    return {
      ehrAppointmentId: String(a.id || a.appointmentId || ""),
      patientId: String(a.patientId || ""),
      patientName: a.patientName || [a.patientFirstName, a.patientLastName].filter(Boolean).join(" ") || "",
      providerId: String(a.providerId || ""),
      providerName: a.providerName || a.dentistName || "",
      date: (a.date || a.appointmentDate || "").split("T")[0] || "",
      startTime: a.startTime || a.time || (a.date || "").split("T")[1]?.slice(0, 5) || "",
      duration: a.durationMinutes || a.duration || 30,
      status: this.mapAptStatus(a.status || a.appointmentStatus),
      procedures: a.procedures?.map((p) => ({ code: p.code, description: p.description || p.name || "" })),
      notes: a.notes || a.note || undefined,
    };
  }

  private mapTreatmentPlan(plan: DentrixTreatmentPlan, patientId: string): EhrTreatmentPlan {
    return {
      ehrPlanId: String(plan.id || plan.treatmentPlanId || ""),
      patientId,
      providerId: String(plan.providerId || ""),
      status: this.mapPlanStatus(plan.status),
      phases: (plan.phases || []).map((phase, i) => ({
        phase: phase.phaseNumber || i + 1,
        description: phase.description || `Phase ${i + 1}`,
        procedures: (phase.procedures || []).map((p) => ({
          code: p.procedureCode || p.code || "",
          description: p.procedureDescription || p.description || "",
          toothNumber: p.toothNumber || p.tooth || undefined,
          surface: p.surface || undefined,
          fee: p.fee || p.totalFee || 0,
          insuranceEstimate: p.insuranceEstimate || p.insurancePortion || 0,
          patientEstimate: p.patientEstimate || p.patientPortion || 0,
        })),
      })),
      totalFee: plan.totalFee || plan.totalAmount || 0,
      totalInsurance: plan.totalInsurance || plan.insuranceAmount || 0,
      totalPatient: plan.totalPatient || plan.patientAmount || 0,
      createdAt: plan.createdAt || plan.createdDate || new Date().toISOString(),
    };
  }

  private mapAptStatus(status: string | undefined): EhrAppointment["status"] {
    switch (status?.toLowerCase()) {
      case "scheduled":
      case "booked":
        return "scheduled";
      case "confirmed":
        return "confirmed";
      case "checked_in":
      case "arrived":
      case "in_office":
        return "checked_in";
      case "in_progress":
      case "in_chair":
      case "being_seen":
        return "in_progress";
      case "completed":
      case "complete":
      case "done":
        return "completed";
      case "cancelled":
      case "canceled":
        return "cancelled";
      case "no_show":
      case "noshow":
      case "missed":
        return "no_show";
      default:
        return "scheduled";
    }
  }

  private mapPlanStatus(status: string | undefined): EhrTreatmentPlan["status"] {
    switch (status?.toLowerCase()) {
      case "proposed":
      case "pending":
      case "draft":
        return "proposed";
      case "accepted":
      case "approved":
      case "active":
        return "accepted";
      case "in_progress":
      case "started":
        return "in_progress";
      case "completed":
      case "done":
      case "finished":
        return "completed";
      case "declined":
      case "rejected":
      case "cancelled":
        return "declined";
      default:
        return "proposed";
    }
  }
}

// --- Dentrix API types (Ascend REST API field shapes) ---

interface DentrixPatient {
  id?: string;
  patientId?: string;
  firstName?: string;
  first_name?: string;
  givenName?: string;
  lastName?: string;
  last_name?: string;
  familyName?: string;
  dateOfBirth?: string;
  dob?: string;
  birthDate?: string;
  primaryPhone?: string;
  mobilePhone?: string;
  homePhone?: string;
  phone?: string;
  email?: string;
  emailAddress?: string;
  primaryInsurance?: {
    carrier?: string;
    groupNumber?: string;
    subscriberId?: string;
    planType?: string;
  };
  insurance?: {
    name?: string;
    groupNumber?: string;
    memberId?: string;
    planType?: string;
  };
  allergies?: Array<string | { name?: string }>;
  medications?: Array<string | { name?: string }>;
  medicalAlerts?: string[];
  alerts?: string[];
  lastVisitDate?: string;
  lastAppointmentDate?: string;
}

interface DentrixAppointment {
  id?: string;
  appointmentId?: string;
  patientId?: string;
  patientName?: string;
  patientFirstName?: string;
  patientLastName?: string;
  providerId?: string;
  providerName?: string;
  dentistName?: string;
  date?: string;
  appointmentDate?: string;
  startTime?: string;
  time?: string;
  durationMinutes?: number;
  duration?: number;
  status?: string;
  appointmentStatus?: string;
  procedures?: Array<{ code: string; description?: string; name?: string }>;
  notes?: string;
  note?: string;
}

interface DentrixTreatmentPlan {
  id?: string;
  treatmentPlanId?: string;
  providerId?: string;
  status?: string;
  phases?: Array<{
    phaseNumber?: number;
    description?: string;
    procedures?: Array<{
      procedureCode?: string;
      code?: string;
      procedureDescription?: string;
      description?: string;
      toothNumber?: string;
      tooth?: string;
      surface?: string;
      fee?: number;
      totalFee?: number;
      insuranceEstimate?: number;
      insurancePortion?: number;
      patientEstimate?: number;
      patientPortion?: number;
    }>;
  }>;
  totalFee?: number;
  totalAmount?: number;
  totalInsurance?: number;
  insuranceAmount?: number;
  totalPatient?: number;
  patientAmount?: number;
  createdAt?: string;
  createdDate?: string;
}
