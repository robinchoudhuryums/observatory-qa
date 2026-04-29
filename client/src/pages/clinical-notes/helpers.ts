/**
 * Pure helpers for the Clinical Notes page.
 * Extracted from `pages/clinical-notes.tsx` so sub-components can use the
 * same formatting logic without copying it.
 */

const FORMAT_LABELS: Record<string, string> = {
  soap: "SOAP",
  dap: "DAP",
  birp: "BIRP",
  hpi_focused: "HPI-Focused",
  procedure_note: "Procedure Note",
  progress_note: "Progress Note",
  dental_exam: "Dental Exam",
  dental_operative: "Dental Operative",
  dental_perio: "Periodontal",
  dental_endo: "Endodontic",
  dental_ortho_progress: "Ortho Progress",
  dental_surgery: "Oral Surgery",
  dental_treatment_plan: "Treatment Plan",
};

/** Map a clinical-note format key to a display label (e.g. "soap" → "SOAP"). */
export function formatLabel(format: string): string {
  return FORMAT_LABELS[format] || format.toUpperCase();
}

/**
 * Build the printable HTML wrapper around the cloned note DOM and trigger
 * the browser print dialog in a new window. Sanitizes the title to prevent
 * injection via the patient/employee name.
 *
 * Pulled out of the page so the print stylesheet lives in one place and
 * the page render isn't carrying ~30 lines of <style> string.
 */
export function openPrintWindow(printContent: HTMLElement, patientName: string | undefined): void {
  const printWindow = window.open("", "_blank");
  if (!printWindow) return;

  // Sanitize title — patient/employee name is reflected into the document <title>.
  const safeTitle = (patientName || "Patient").replace(/[<>&"']/g, "");

  const doc = printWindow.document;
  doc.open();
  doc.write(`<html><head><title>Clinical Note — ${safeTitle}</title>
    <style>
      body { font-family: system-ui, -apple-system, sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; color: #1a1a1a; font-size: 14px; }
      h1 { font-size: 20px; border-bottom: 2px solid #333; padding-bottom: 8px; }
      h2 { font-size: 16px; margin-top: 20px; color: #333; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
      .meta { color: #666; font-size: 12px; margin-bottom: 20px; }
      .draft { background: #fff3cd; border: 1px solid #ffc107; padding: 8px 12px; border-radius: 4px; margin: 10px 0; font-weight: bold; }
      .codes { display: flex; gap: 8px; flex-wrap: wrap; }
      .code { background: #f0f0f0; padding: 2px 8px; border-radius: 4px; font-family: monospace; font-size: 12px; }
      ul { padding-left: 20px; }
      p { line-height: 1.6; }
      @media print { .no-print { display: none; } }
    </style></head><body></body></html>`);

  // Deep clone the rendered note so we ship the actual DOM (including
  // computed React state) rather than re-serializing it through innerHTML,
  // which would expose any user-supplied note content as XSS.
  const cloned = printContent.cloneNode(true) as HTMLElement;
  doc.body.appendChild(cloned);

  const printScript = doc.createElement("script");
  printScript.textContent = "window.print(); window.close();";
  doc.body.appendChild(printScript);
  doc.close();
}
