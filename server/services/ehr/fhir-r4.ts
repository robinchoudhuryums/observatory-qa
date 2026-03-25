/**
 * FHIR R4 EHR Adapter
 *
 * Implements the IEhrAdapter interface against any FHIR R4-compliant server.
 * FHIR (Fast Healthcare Interoperability Resources) R4 is the current HL7 standard
 * used by most modern EHR vendors (Epic, Cerner, Allscripts, and many others).
 *
 * This adapter uses SMART on FHIR authentication (Bearer token). The access token
 * must be obtained through the EHR's SMART authorization flow and stored in
 * org settings as `apiKey`. Token refresh is handled externally.
 *
 * FHIR Resource mapping:
 *   EhrPatient       → FHIR Patient resource
 *   EhrAppointment   → FHIR Appointment resource
 *   EhrClinicalNote  → FHIR DocumentReference resource
 *   EhrTreatmentPlan → FHIR CarePlan resource
 *
 * Configuration (stored in org settings):
 *   baseUrl: "https://fhir.example.com/api/FHIR/R4" or any FHIR R4 endpoint
 *   apiKey: SMART on FHIR Bearer access token
 *   options.fhirVersion: "R4" (default) or "R4B"
 *   options.systemIdentifier: Identifier system URL for patient lookups (optional)
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
import { ehrRequest } from "./request.js";

/** FHIR R4 resource base type */
interface FhirResource {
  resourceType: string;
  id?: string;
}

/** FHIR Bundle wrapping a collection of resources */
interface FhirBundle extends FhirResource {
  resourceType: "Bundle";
  type: string;
  total?: number;
  entry?: Array<{ resource?: FhirResource; fullUrl?: string }>;
}

/** FHIR HumanName */
interface FhirHumanName {
  use?: string;
  family?: string;
  given?: string[];
  text?: string;
}

/** FHIR ContactPoint (phone, email) */
interface FhirContactPoint {
  system?: "phone" | "fax" | "email" | "pager" | "url" | "sms" | "other";
  value?: string;
  use?: string;
}

interface FhirPatient extends FhirResource {
  resourceType: "Patient";
  name?: FhirHumanName[];
  birthDate?: string;
  telecom?: FhirContactPoint[];
  extension?: Array<{ url?: string; valueString?: string }>;
}

interface FhirAppointment extends FhirResource {
  resourceType: "Appointment";
  status?: string;
  description?: string;
  start?: string;   // ISO 8601
  end?: string;     // ISO 8601
  minutesDuration?: number;
  participant?: Array<{
    actor?: { reference?: string; display?: string };
    status?: string;
    type?: Array<{ coding?: Array<{ code?: string }> }>;
  }>;
  reasonCode?: Array<{ coding?: Array<{ code?: string; display?: string }>; text?: string }>;
  comment?: string;
}

interface FhirDocumentReference extends FhirResource {
  resourceType: "DocumentReference";
  status?: string;
  type?: { coding?: Array<{ system?: string; code?: string; display?: string }>; text?: string };
  subject?: { reference?: string };
  date?: string;
  author?: Array<{ reference?: string; display?: string }>;
  content?: Array<{
    attachment?: {
      contentType?: string;
      data?: string;       // base64
      url?: string;
      title?: string;
    };
  }>;
}

interface FhirCarePlan extends FhirResource {
  resourceType: "CarePlan";
  status?: string;
  intent?: string;
  subject?: { reference?: string };
  created?: string;
  author?: { reference?: string; display?: string };
  activity?: Array<{
    detail?: {
      code?: { coding?: Array<{ code?: string; display?: string }> };
      status?: string;
      description?: string;
    };
  }>;
}

export class FhirR4Adapter implements IEhrAdapter {
  readonly system = "fhir_r4" as const;

  private buildHeaders(config: EhrConnectionConfig): Record<string, string> {
    return {
      "Content-Type": "application/fhir+json",
      "Accept": "application/fhir+json",
      "Authorization": `Bearer ${config.apiKey || ""}`,
    };
  }

  private async request<T>(config: EhrConnectionConfig, method: string, path: string, body?: unknown): Promise<T> {
    const url = `${config.baseUrl.replace(/\/$/, "")}${path}`;
    return ehrRequest<T>({
      method, url, body,
      headers: this.buildHeaders(config),
      systemLabel: "FHIR R4",
    });
  }

  async testConnection(config: EhrConnectionConfig): Promise<{ connected: boolean; version?: string; error?: string }> {
    try {
      // FHIR servers expose capability statement at /metadata
      const cap = await this.request<{ fhirVersion?: string; software?: { name?: string; version?: string } }>(
        config, "GET", "/metadata"
      );
      const version = cap?.software?.version || cap?.fhirVersion || "R4";
      const name = cap?.software?.name || "FHIR Server";
      return { connected: true, version: `${name} (FHIR ${version})` };
    } catch (err) {
      return {
        connected: false,
        error: err instanceof Error ? err.message : "FHIR server unreachable",
      };
    }
  }

  async searchPatients(
    config: EhrConnectionConfig,
    query: { name?: string; dob?: string; phone?: string }
  ): Promise<EhrPatient[]> {
    const params = new URLSearchParams();
    if (query.name) params.set("name", query.name);
    if (query.dob) params.set("birthdate", query.dob);
    if (query.phone) params.set("phone", query.phone);
    params.set("_count", "20");

    const bundle = await this.request<FhirBundle>(
      config, "GET", `/Patient?${params.toString()}`
    );

    return (bundle.entry || [])
      .filter(e => e.resource?.resourceType === "Patient")
      .map(e => this.mapPatient(e.resource as FhirPatient));
  }

  async getPatient(config: EhrConnectionConfig, ehrPatientId: string): Promise<EhrPatient | null> {
    try {
      const patient = await this.request<FhirPatient>(
        config, "GET", `/Patient/${ehrPatientId}`
      );
      return this.mapPatient(patient);
    } catch {
      return null;
    }
  }

  async getAppointments(
    config: EhrConnectionConfig,
    params: { startDate: string; endDate: string; providerId?: string }
  ): Promise<EhrAppointment[]> {
    const finalParams = new URLSearchParams();
    finalParams.append("date", `ge${params.startDate}`);
    finalParams.append("date", `le${params.endDate}`);
    finalParams.set("_count", "100");
    if (params.providerId) finalParams.set("actor", `Practitioner/${params.providerId}`);

    const bundle = await this.request<FhirBundle>(
      config, "GET", `/Appointment?${finalParams.toString()}`
    );

    return (bundle.entry || [])
      .filter(e => e.resource?.resourceType === "Appointment")
      .map(e => this.mapAppointment(e.resource as FhirAppointment));
  }

  async getTodayAppointments(config: EhrConnectionConfig, providerId?: string): Promise<EhrAppointment[]> {
    const today = new Date().toISOString().split("T")[0]!;
    return this.getAppointments(config, { startDate: today, endDate: today, providerId });
  }

  async createAppointment(config: EhrConnectionConfig, apt: EhrAppointmentCreate): Promise<EhrSyncResult> {
    try {
      const startISO = new Date(`${apt.date}T${apt.startTime}:00`).toISOString();
      const endDate = new Date(`${apt.date}T${apt.startTime}:00`);
      endDate.setMinutes(endDate.getMinutes() + apt.duration);
      const endISO = endDate.toISOString();

      const resource: Partial<FhirAppointment> = {
        resourceType: "Appointment",
        status: "booked",
        start: startISO,
        end: endISO,
        minutesDuration: apt.duration,
        participant: [
          {
            actor: { reference: `Patient/${apt.patientId}` },
            status: "accepted",
          },
          {
            actor: { reference: `Practitioner/${apt.providerId}` },
            status: "accepted",
            type: [{ coding: [{ code: "PART" }] }],
          },
        ],
        comment: apt.notes,
      };

      if (apt.procedures?.length) {
        resource.reasonCode = apt.procedures.map(p => ({
          coding: [{ code: p.code, display: p.description }],
          text: p.description,
        }));
      }

      const result = await this.request<FhirAppointment>(
        config, "POST", "/Appointment", resource
      );

      return {
        success: true,
        ehrRecordId: result?.id || "",
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "Failed to create FHIR Appointment",
        timestamp: new Date().toISOString(),
      };
    }
  }

  async pushClinicalNote(config: EhrConnectionConfig, note: EhrClinicalNote): Promise<EhrSyncResult> {
    try {
      // Encode content as base64 for FHIR attachment
      const contentBase64 = Buffer.from(note.content, "utf-8").toString("base64");

      const loinc = this.getNoteTypeLoinc(note.noteType);

      const resource: Partial<FhirDocumentReference> = {
        resourceType: "DocumentReference",
        status: "current",
        type: {
          coding: [{ system: "http://loinc.org", code: loinc.code, display: loinc.display }],
          text: loinc.display,
        },
        subject: { reference: `Patient/${note.patientId}` },
        date: new Date(note.date).toISOString(),
        author: note.providerId ? [{ reference: `Practitioner/${note.providerId}` }] : undefined,
        content: [{
          attachment: {
            contentType: "text/plain",
            data: contentBase64,
            title: `${loinc.display} — ${note.date}`,
          },
        }],
      };

      const result = await this.request<FhirDocumentReference>(
        config, "POST", "/DocumentReference", resource
      );

      return {
        success: true,
        ehrRecordId: result?.id || "",
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "Failed to push FHIR DocumentReference",
        timestamp: new Date().toISOString(),
      };
    }
  }

  async getPatientTreatmentPlans(config: EhrConnectionConfig, patientId: string): Promise<EhrTreatmentPlan[]> {
    try {
      const bundle = await this.request<FhirBundle>(
        config, "GET", `/CarePlan?patient=${patientId}&_count=20`
      );

      return (bundle.entry || [])
        .filter(e => e.resource?.resourceType === "CarePlan")
        .map(e => this.mapCarePlan(e.resource as FhirCarePlan, patientId));
    } catch {
      return [];
    }
  }

  async updateTreatmentPlan(
    config: EhrConnectionConfig,
    planId: string,
    update: EhrTreatmentPlanUpdate
  ): Promise<EhrSyncResult> {
    try {
      // FHIR patch: map our status to FHIR CarePlan status
      const fhirStatus = update.status ? this.toFhirCarePlanStatus(update.status) : undefined;

      // Use FHIR JSON Patch
      const patches = [];
      if (fhirStatus) patches.push({ op: "replace", path: "/status", value: fhirStatus });
      if (update.notes) patches.push({ op: "add", path: "/note", value: [{ text: update.notes }] });

      if (patches.length === 0) {
        return { success: true, ehrRecordId: planId, timestamp: new Date().toISOString() };
      }

      await ehrRequest<FhirCarePlan>({
        method: "PATCH",
        url: `${config.baseUrl.replace(/\/$/, "")}/CarePlan/${planId}`,
        headers: {
          ...this.buildHeaders(config),
          "Content-Type": "application/json-patch+json",
        },
        body: patches,
        systemLabel: "FHIR R4",
      });

      return {
        success: true,
        ehrRecordId: planId,
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "Failed to update FHIR CarePlan",
        timestamp: new Date().toISOString(),
      };
    }
  }

  // --- Private mapping helpers ---

  private mapPatient(p: FhirPatient): EhrPatient {
    const officialName = p.name?.find(n => n.use === "official") || p.name?.[0];
    const firstName = officialName?.given?.join(" ") || "";
    const lastName = officialName?.family || "";

    const phone = p.telecom?.find(t => t.system === "phone")?.value;
    const email = p.telecom?.find(t => t.system === "email")?.value;

    return {
      ehrPatientId: p.id || "",
      firstName,
      lastName,
      dateOfBirth: p.birthDate || "",
      phone: phone || undefined,
      email: email || undefined,
    };
  }

  private mapAppointment(a: FhirAppointment): EhrAppointment {
    const patientParticipant = a.participant?.find(p =>
      p.actor?.reference?.startsWith("Patient/")
    );
    const practitionerParticipant = a.participant?.find(p =>
      p.actor?.reference?.startsWith("Practitioner/") ||
      p.type?.some(t => t.coding?.some(c => c.code === "PART"))
    );

    const patientId = patientParticipant?.actor?.reference?.replace("Patient/", "") || "";
    const providerId = practitionerParticipant?.actor?.reference?.replace("Practitioner/", "") || "";

    const startDate = a.start ? new Date(a.start) : new Date();
    const endDate = a.end ? new Date(a.end) : new Date(startDate.getTime() + 30 * 60 * 1000);
    const durationMinutes = a.minutesDuration || Math.round((endDate.getTime() - startDate.getTime()) / 60000);

    const procedures = a.reasonCode?.map(rc => ({
      code: rc.coding?.[0]?.code || "",
      description: rc.coding?.[0]?.display || rc.text || "",
    })).filter(p => p.code) || undefined;

    return {
      ehrAppointmentId: a.id || "",
      patientId,
      patientName: patientParticipant?.actor?.display || "",
      providerId,
      providerName: practitionerParticipant?.actor?.display || "",
      date: startDate.toISOString().split("T")[0]!,
      startTime: startDate.toISOString().split("T")[1]?.slice(0, 5) || "",
      duration: durationMinutes,
      status: this.mapAptStatus(a.status),
      procedures: procedures?.length ? procedures : undefined,
      notes: a.comment || a.description || undefined,
    };
  }

  private mapCarePlan(c: FhirCarePlan, patientId: string): EhrTreatmentPlan {
    const providerId = c.author?.reference?.replace("Practitioner/", "") || "";

    const procedures = (c.activity || [])
      .filter(a => a.detail?.code)
      .map(a => ({
        code: a.detail?.code?.coding?.[0]?.code || "",
        description: a.detail?.code?.coding?.[0]?.display || a.detail?.description || "",
        fee: 0,
        insuranceEstimate: 0,
        patientEstimate: 0,
      }));

    return {
      ehrPlanId: c.id || "",
      patientId,
      providerId,
      status: this.mapCarePlanStatus(c.status),
      phases: procedures.length ? [{ phase: 1, description: "Plan", procedures }] : [],
      totalFee: 0,
      totalInsurance: 0,
      totalPatient: 0,
      createdAt: c.created || new Date().toISOString(),
    };
  }

  private mapAptStatus(status: string | undefined): EhrAppointment["status"] {
    switch (status) {
      case "booked": case "pending": return "scheduled";
      case "arrived": return "checked_in";
      case "fulfilled": return "completed";
      case "cancelled": case "noshow": return status === "noshow" ? "no_show" : "cancelled";
      case "waitlist": return "scheduled";
      default: return "scheduled";
    }
  }

  private mapCarePlanStatus(status: string | undefined): EhrTreatmentPlan["status"] {
    switch (status) {
      case "draft": return "proposed";
      case "active": return "accepted";
      case "on-hold": return "in_progress";
      case "completed": return "completed";
      case "revoked": case "entered-in-error": return "declined";
      default: return "proposed";
    }
  }

  private toFhirCarePlanStatus(status: EhrTreatmentPlan["status"]): string {
    switch (status) {
      case "proposed": return "draft";
      case "accepted": case "in_progress": return "active";
      case "completed": return "completed";
      case "declined": return "revoked";
    }
  }

  /** Map note type to LOINC code for FHIR DocumentReference */
  private getNoteTypeLoinc(noteType: string): { code: string; display: string } {
    switch (noteType?.toLowerCase()) {
      case "soap": return { code: "11506-3", display: "Progress note" };
      case "dap": return { code: "11506-3", display: "Progress note (DAP)" };
      case "birp": return { code: "11506-3", display: "Progress note (BIRP)" };
      case "hpi": return { code: "34117-2", display: "History and physical note" };
      case "procedure": return { code: "28570-0", display: "Procedure note" };
      case "discharge": return { code: "18842-5", display: "Discharge summary" };
      default: return { code: "34109-9", display: "Note" };
    }
  }
}
