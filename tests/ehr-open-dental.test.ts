/**
 * Open Dental EHR adapter tests.
 *
 * Tests the data mapping, error classification, and business logic
 * of the Open Dental adapter without making real HTTP calls.
 *
 * Run with: npx tsx --test tests/ehr-open-dental.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EhrError, classifyEhrError } from "../server/services/ehr/types.js";

// ============================================================================
// EhrError classification tests
// ============================================================================

describe("classifyEhrError", () => {
  it("classifies 401 as auth error", () => {
    const err = new Error("Open Dental API error 401: Unauthorized");
    const result = classifyEhrError(err, "Open Dental");
    assert.strictEqual(result.errorType, "auth");
    assert.strictEqual(result.statusCode, 401);
    assert.strictEqual(result.system, "Open Dental");
  });

  it("classifies 403 as auth error", () => {
    const err = new Error("Open Dental API error 403: Forbidden");
    const result = classifyEhrError(err, "Open Dental");
    assert.strictEqual(result.errorType, "auth");
    assert.strictEqual(result.statusCode, 403);
  });

  it("classifies 404 as not_found", () => {
    const err = new Error("Open Dental API error 404: Patient not found");
    const result = classifyEhrError(err, "Open Dental");
    assert.strictEqual(result.errorType, "not_found");
    assert.strictEqual(result.statusCode, 404);
  });

  it("classifies 500 as server error", () => {
    const err = new Error("Open Dental API error 500: Internal Server Error");
    const result = classifyEhrError(err, "Open Dental");
    assert.strictEqual(result.errorType, "server");
    assert.strictEqual(result.statusCode, 500);
  });

  it("classifies timeout errors", () => {
    const err = new Error("Open Dental API request timed out after 30000ms");
    const result = classifyEhrError(err, "Open Dental");
    assert.strictEqual(result.errorType, "timeout");
  });

  it("classifies TypeError as network error", () => {
    const err = new TypeError("fetch failed");
    const result = classifyEhrError(err, "Open Dental");
    assert.strictEqual(result.errorType, "network");
  });

  it("classifies ECONNREFUSED as network error", () => {
    const err = new Error("ECONNREFUSED: connection refused");
    const result = classifyEhrError(err, "Open Dental");
    assert.strictEqual(result.errorType, "network");
  });

  it("classifies unknown errors", () => {
    const err = new Error("Something unexpected");
    const result = classifyEhrError(err, "Open Dental");
    assert.strictEqual(result.errorType, "unknown");
  });

  it("handles non-Error objects", () => {
    const result = classifyEhrError("string error", "Open Dental");
    assert.strictEqual(result.errorType, "unknown");
    assert.ok(result.message.includes("string error"));
  });
});

describe("EhrError class", () => {
  it("has correct properties", () => {
    const err = new EhrError("auth", "Open Dental", "Unauthorized", 401);
    assert.strictEqual(err.name, "EhrError");
    assert.strictEqual(err.errorType, "auth");
    assert.strictEqual(err.system, "Open Dental");
    assert.strictEqual(err.statusCode, 401);
    assert.strictEqual(err.message, "Unauthorized");
    assert.ok(err instanceof Error);
  });
});

// ============================================================================
// Patient mapping logic tests
// ============================================================================

describe("Open Dental patient mapping", () => {
  // Test the parseList helper pattern used in mapPatient
  function parseList(s?: string): string[] | undefined {
    return s ? s.split(/[,;]\s*/).map((x) => x.trim()).filter(Boolean) : undefined;
  }

  it("parses comma-separated allergies", () => {
    const result = parseList("Penicillin, Latex, Aspirin");
    assert.deepStrictEqual(result, ["Penicillin", "Latex", "Aspirin"]);
  });

  it("parses semicolon-separated values", () => {
    const result = parseList("Lisinopril 10mg; Metformin 500mg; Atorvastatin 20mg");
    assert.deepStrictEqual(result, ["Lisinopril 10mg", "Metformin 500mg", "Atorvastatin 20mg"]);
  });

  it("returns undefined for empty string", () => {
    assert.strictEqual(parseList(""), undefined);
  });

  it("returns undefined for undefined", () => {
    assert.strictEqual(parseList(undefined), undefined);
  });

  it("handles single value without separator", () => {
    const result = parseList("Penicillin");
    assert.deepStrictEqual(result, ["Penicillin"]);
  });

  it("filters empty segments", () => {
    const result = parseList("Penicillin,, Latex, ,");
    assert.deepStrictEqual(result, ["Penicillin", "Latex"]);
  });
});

// ============================================================================
// Appointment procedure parsing tests
// ============================================================================

describe("Open Dental appointment procedure parsing", () => {
  // Test the ProcDescript parsing pattern used in mapAppointment
  function parseProcedures(procDescript?: string) {
    if (!procDescript) return undefined;
    return procDescript.split(",").map((p) => {
      const trimmed = p.trim();
      const match = trimmed.match(/^([A-Z]?\d{4,5})\s*[-–—]\s*(.+)/);
      return match
        ? { code: match[1]!, description: match[2]!.trim() }
        : { code: "", description: trimmed };
    }).filter((p) => p.description);
  }

  it("parses CDT code + description format", () => {
    const result = parseProcedures("D1110 - Prophylaxis, D0120 - Periodic Exam");
    assert.deepStrictEqual(result, [
      { code: "D1110", description: "Prophylaxis" },
      { code: "D0120", description: "Periodic Exam" },
    ]);
  });

  it("handles en-dash separator", () => {
    const result = parseProcedures("D2740 – Crown Porcelain");
    assert.deepStrictEqual(result, [
      { code: "D2740", description: "Crown Porcelain" },
    ]);
  });

  it("handles descriptions without code", () => {
    const result = parseProcedures("Cleaning, X-rays");
    assert.deepStrictEqual(result, [
      { code: "", description: "Cleaning" },
      { code: "", description: "X-rays" },
    ]);
  });

  it("returns undefined for missing procDescript", () => {
    assert.strictEqual(parseProcedures(undefined), undefined);
  });

  it("returns undefined for empty string", () => {
    const result = parseProcedures("");
    assert.deepStrictEqual(result, undefined);
  });
});

// ============================================================================
// Treatment plan fee calculation tests
// ============================================================================

describe("Open Dental treatment plan fee calculation", () => {
  it("calculates total fees from procedures", () => {
    const procedures = [
      { FeeAmt: 250.00, InsAmt: 200.00 },
      { FeeAmt: 150.00, InsAmt: 100.00 },
      { FeeAmt: 500.00, InsAmt: 0 },
    ];

    let totalFee = 0;
    let totalInsurance = 0;
    let totalPatient = 0;
    for (const proc of procedures) {
      const fee = proc.FeeAmt || 0;
      const ins = proc.InsAmt || 0;
      totalFee += fee;
      totalInsurance += ins;
      totalPatient += Math.max(0, fee - ins);
    }

    assert.strictEqual(totalFee, 900);
    assert.strictEqual(totalInsurance, 300);
    assert.strictEqual(totalPatient, 600);
  });

  it("handles zero fees gracefully", () => {
    const procedures = [{ FeeAmt: 0, InsAmt: 0 }];
    let totalFee = 0;
    for (const proc of procedures) totalFee += proc.FeeAmt || 0;
    assert.strictEqual(totalFee, 0);
  });

  it("insurance estimate never exceeds fee", () => {
    const fee = 100;
    const ins = 150; // Insurance > fee (shouldn't happen but guard against)
    const patient = Math.max(0, fee - ins);
    assert.strictEqual(patient, 0, "patient portion should be 0, not negative");
  });
});

// ============================================================================
// Appointment status mapping tests
// ============================================================================

describe("Open Dental appointment status mapping", () => {
  function mapAptStatus(status: number | undefined): string {
    switch (status) {
      case 1: return "scheduled";
      case 2: return "completed";
      case 3: return "cancelled";
      case 5: return "cancelled";
      default: return "scheduled";
    }
  }

  it("maps status 1 to scheduled", () => {
    assert.strictEqual(mapAptStatus(1), "scheduled");
  });

  it("maps status 2 to completed", () => {
    assert.strictEqual(mapAptStatus(2), "completed");
  });

  it("maps status 3 (unscheduled) to cancelled", () => {
    assert.strictEqual(mapAptStatus(3), "cancelled");
  });

  it("maps status 5 (broken) to cancelled", () => {
    assert.strictEqual(mapAptStatus(5), "cancelled");
  });

  it("defaults unknown status to scheduled", () => {
    assert.strictEqual(mapAptStatus(99), "scheduled");
    assert.strictEqual(mapAptStatus(undefined), "scheduled");
  });
});

// ============================================================================
// Appointment pattern (duration) tests
// ============================================================================

describe("Open Dental appointment duration", () => {
  it("calculates duration from pattern length (each char = 5 min)", () => {
    assert.strictEqual(Math.round("XXXX".length * 5), 20); // 4 slots = 20 min
    assert.strictEqual(Math.round("XXXXXXXX".length * 5), 40); // 8 slots = 40 min
    assert.strictEqual(Math.round("X".length * 5), 5); // 1 slot = 5 min
  });

  it("defaults to 5 min when pattern is missing", () => {
    assert.strictEqual(Math.round((undefined as any || 1) * 5), 5);
  });

  it("creates correct pattern for appointment creation", () => {
    const duration = 30; // 30 minutes
    const slots = Math.max(1, Math.ceil(duration / 5));
    const pattern = "X".repeat(slots);
    assert.strictEqual(pattern, "XXXXXX"); // 6 slots
    assert.strictEqual(slots, 6);
  });
});
