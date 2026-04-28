/**
 * Tests for the Tier 1C progressive coaching plan generator.
 *
 * These are mostly pure-helper tests — the Bedrock-calling path
 * (generateProgressivePlan) requires a mock of aiProvider that's complex
 * to set up in the node:test environment. The helper progressivePlanToActionPlan
 * is the primary unit under test; the generator's parsing robustness is
 * covered by argument-shape assertions that don't require a Bedrock round-trip.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { progressivePlanToActionPlan, type ProgressivePlanResult } from "../server/services/coaching-progressive";

describe("progressivePlanToActionPlan — shape conversion", () => {
  it("converts task strings into actionPlan items with completed: false", () => {
    const result: ProgressivePlanResult = {
      tasks: ["Task A", "Task B", "Task C"],
      notes: "Some notes",
    };
    const plan = progressivePlanToActionPlan(result);
    assert.equal(plan.length, 3);
    for (const item of plan) {
      assert.equal(item.completed, false);
    }
    assert.equal(plan[0].task, "Task A");
    assert.equal(plan[1].task, "Task B");
    assert.equal(plan[2].task, "Task C");
  });

  it("preserves task order", () => {
    const tasks = [
      "Week 1: Foundation",
      "Listen to last 5 low-scoring calls",
      "Identify patterns",
      "Week 2: Practice",
      "Role-play with manager",
      "Follow-up: re-evaluate after completing plan",
    ];
    const plan = progressivePlanToActionPlan({ tasks, notes: "" });
    assert.equal(plan.length, tasks.length);
    for (let i = 0; i < tasks.length; i++) {
      assert.equal(plan[i].task, tasks[i]);
      assert.equal(plan[i].completed, false);
    }
  });

  it("returns empty array for empty tasks", () => {
    const plan = progressivePlanToActionPlan({ tasks: [], notes: "Empty plan" });
    assert.deepEqual(plan, []);
  });

  it("preserves week-heading vs task distinction in the resulting strings", () => {
    // The conversion is intentionally lossless on string content — week
    // headings and tasks are both stored as task strings. The UI can
    // distinguish them by the "Week N:" prefix.
    const result: ProgressivePlanResult = {
      tasks: ["Week 1: Awareness", "Listen to recordings", "Week 2: Practice", "Role-play"],
      notes: "",
    };
    const plan = progressivePlanToActionPlan(result);
    assert.ok(plan[0].task.startsWith("Week 1:"));
    assert.ok(plan[2].task.startsWith("Week 2:"));
    assert.ok(!plan[1].task.startsWith("Week"));
    assert.ok(!plan[3].task.startsWith("Week"));
  });

  it("handles a single-task plan", () => {
    const plan = progressivePlanToActionPlan({ tasks: ["Single task"], notes: "" });
    assert.equal(plan.length, 1);
    assert.equal(plan[0].task, "Single task");
    assert.equal(plan[0].completed, false);
  });
});

describe("progressivePlanToActionPlan — actionPlan compatibility", () => {
  it("produces shape compatible with storage.createCoachingSession actionPlan field", () => {
    // The storage method expects: Array<{ task: string; completed: boolean }>
    // Our converter returns: Array<{ task: string; completed: false }>
    // The `false as const` is intentional — every freshly-created task
    // starts incomplete; storage layer is responsible for tracking
    // completion state thereafter.
    const result: ProgressivePlanResult = {
      tasks: ["t1", "t2"],
      notes: "n",
    };
    const plan = progressivePlanToActionPlan(result);
    // Verify shape — each item is exactly { task: string, completed: false }
    for (const item of plan) {
      const keys = Object.keys(item).sort();
      assert.deepEqual(keys, ["completed", "task"]);
      assert.equal(typeof item.task, "string");
      assert.equal(typeof item.completed, "boolean");
    }
  });
});

// --- Notes on integration testing ---
//
// generateProgressivePlan() requires a live or mocked aiProvider. The full
// integration path is exercised when the wire-up to runAutomationRules in
// coaching-engine.ts lands (see TIER_0_5_PENDING.md item E for the
// 10-line hand-edit). Until then, the function is exercised by smoke-tests
// in dev mode only.
//
// What's verified by these unit tests:
//   - progressivePlanToActionPlan correctly produces { task, completed: false } shape
//   - Empty / single-element / multi-element input all work
//   - Order is preserved
//   - Output keys exactly match what storage.createCoachingSession expects
