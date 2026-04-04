/**
 * Auto-calibration drift detection + telephony ingestion tests.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("Auto-calibration drift detection", () => {
  it("percentile computes correct values", async () => {
    const { _testExports } = await import("../server/services/auto-calibration.js");
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    assert.equal(_testExports.percentile(sorted, 50), 5.5);
    assert.equal(_testExports.percentile(sorted, 0), 1);
    assert.equal(_testExports.percentile(sorted, 100), 10);
    assert.equal(_testExports.percentile(sorted, 10), 1.9);
  });

  it("percentile handles empty array", async () => {
    const { _testExports } = await import("../server/services/auto-calibration.js");
    assert.equal(_testExports.percentile([], 50), 0);
  });

  it("percentile handles single element", async () => {
    const { _testExports } = await import("../server/services/auto-calibration.js");
    assert.equal(_testExports.percentile([7], 50), 7);
  });
});

describe("Telephony ingestion framework", () => {
  it("getTelephonyConfig returns null when not configured", async () => {
    const { getTelephonyConfig } = await import("../server/services/telephony-ingestion.js");
    assert.equal(getTelephonyConfig(undefined), null);
    assert.equal(getTelephonyConfig({}), null);
    assert.equal(getTelephonyConfig({ telephonyConfig: { enabled: false } }), null);
  });

  it("getTelephonyConfig returns config when enabled", async () => {
    const { getTelephonyConfig } = await import("../server/services/telephony-ingestion.js");
    const config = getTelephonyConfig({
      telephonyConfig: { provider: "webhook", enabled: true },
    });
    assert.ok(config);
    assert.equal(config!.provider, "webhook");
    assert.equal(config!.enabled, true);
  });

  it("TelephonyRecording interface supports all fields", async () => {
    const recording: import("../server/services/telephony-ingestion.js").TelephonyRecording = {
      externalId: "rec-123",
      direction: "inbound",
      extension: "1001",
      externalNumber: "+15551234567",
      startTime: new Date().toISOString(),
      durationSeconds: 300,
      audioUrl: "https://cdn.example.com/recording.mp3",
      callCategory: "inbound",
    };
    assert.equal(recording.direction, "inbound");
    assert.equal(recording.durationSeconds, 300);
  });
});
