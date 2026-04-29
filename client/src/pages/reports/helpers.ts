/**
 * Date-range and formatting helpers for the Reports page.
 * Extracted from `pages/reports.tsx` so sub-components and tests can use
 * the same logic without copying it.
 */
import type { DatePreset } from "./types";

export function getDateRange(preset: DatePreset, customFrom: string, customTo: string): { from: string; to: string } {
  const now = new Date();
  const to = now.toISOString().slice(0, 10);

  switch (preset) {
    case "last30": {
      const d = new Date(now);
      d.setDate(d.getDate() - 30);
      return { from: d.toISOString().slice(0, 10), to };
    }
    case "last90": {
      const d = new Date(now);
      d.setDate(d.getDate() - 90);
      return { from: d.toISOString().slice(0, 10), to };
    }
    case "ytd":
      return { from: `${now.getFullYear()}-01-01`, to };
    case "lastYear": {
      const y = now.getFullYear() - 1;
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    }
    case "custom":
      return { from: customFrom || to, to: customTo || to };
  }
}

export function formatMonth(m: string): string {
  const [year, month] = m.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[parseInt(month) - 1]} ${year}`;
}

export const PRESET_LABELS: Record<DatePreset, string> = {
  last30: "Last 30 Days",
  last90: "Last 90 Days",
  ytd: "Year to Date",
  lastYear: "Last Year",
  custom: "Custom Range",
};
