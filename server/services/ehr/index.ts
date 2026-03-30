/**
 * EHR Adapter Factory
 *
 * Creates the appropriate EHR adapter based on the org's configured EHR system.
 * EHR configuration is stored in org settings under `ehrConfig`.
 *
 * Supported systems:
 *   - open_dental  : Open Dental (bidirectional)
 *   - eaglesoft    : Eaglesoft/Patterson eDex (bidirectional with eDex v2+)
 *   - dentrix      : Dentrix Ascend / G7 (bidirectional)
 *   - fhir_r4      : Any FHIR R4-compliant server (bidirectional)
 *   - mock         : Development/demo adapter
 *
 * Usage:
 *   const adapter = getEhrAdapter("open_dental");
 *   const patients = await adapter.searchPatients(config, { name: "Smith" });
 */

import type { IEhrAdapter, EhrConnectionConfig } from "./types.js";
import { OpenDentalAdapter } from "./open-dental.js";
import { EaglesoftAdapter } from "./eaglesoft.js";
import { DentrixAdapter } from "./dentrix.js";
import { FhirR4Adapter } from "./fhir-r4.js";
import { MockEhrAdapter } from "./mock.js";

const adapters: Record<string, IEhrAdapter> = {
  open_dental: new OpenDentalAdapter(),
  eaglesoft: new EaglesoftAdapter(),
  dentrix: new DentrixAdapter(),
  fhir_r4: new FhirR4Adapter(),
  mock: new MockEhrAdapter(),
};

/**
 * Get the EHR adapter for a given system type.
 * Returns null if the system is not supported.
 */
export function getEhrAdapter(system: EhrConnectionConfig["system"]): IEhrAdapter | null {
  return adapters[system] || null;
}

/**
 * List all supported EHR systems.
 */
export function getSupportedEhrSystems(): Array<{
  system: string;
  label: string;
  status: string;
  supportsWrite: boolean;
}> {
  return [
    { system: "open_dental", label: "Open Dental", status: "available", supportsWrite: true },
    { system: "eaglesoft", label: "Eaglesoft (Patterson)", status: "available", supportsWrite: true },
    { system: "dentrix", label: "Dentrix (Henry Schein)", status: "available", supportsWrite: true },
    { system: "fhir_r4", label: "FHIR R4 (any SMART-compliant EHR)", status: "available", supportsWrite: true },
    { system: "mock", label: "Mock (Development/Demo)", status: "available", supportsWrite: false },
  ];
}

export type {
  IEhrAdapter,
  EhrConnectionConfig,
  EhrPatient,
  EhrAppointment,
  EhrClinicalNote,
  EhrTreatmentPlan,
  EhrSyncResult,
  EhrHealthStatus,
  AppointmentMatchResult,
  EhrAppointmentCreate,
  EhrTreatmentPlanUpdate,
} from "./types.js";
