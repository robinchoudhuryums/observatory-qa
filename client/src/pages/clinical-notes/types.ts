/**
 * Type definitions for the Clinical Notes page.
 * Extracted from `pages/clinical-notes.tsx` so sub-components can share
 * them without re-declaring shapes.
 */
import type { ClinicalNote } from "@shared/schema";

export interface QualityFeedbackEntry {
  rating: number;
  comment?: string;
  improvementAreas?: string[];
  ratedBy?: string;
  ratedAt?: string;
}

export interface CallWithClinical {
  id: string;
  fileName?: string;
  status: string;
  duration?: number;
  callCategory?: string;
  uploadedAt?: string;
  analysis?: {
    summary?: string;
    clinicalNote?: ClinicalNote & {
      attestedBy?: string;
      attestedAt?: string;
      consentRecordedBy?: string;
      consentRecordedAt?: string;
      editHistory?: Array<{ editedBy: string; editedAt: string; fieldsChanged: string[] }>;
      validationWarnings?: string[];
      weightedCompleteness?: number;
      sectionDepth?: Record<string, "empty" | "minimal" | "adequate" | "thorough">;
      qualityFeedback?: QualityFeedbackEntry[];
    };
  };
  employee?: { name: string };
}

/** Convenience alias for the (decorated) clinical note shape used in render. */
export type ClinicalNoteWithMeta = NonNullable<NonNullable<CallWithClinical["analysis"]>["clinicalNote"]>;
