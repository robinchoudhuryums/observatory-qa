/**
 * Speaker role detection tests — verifies that agent vs customer roles
 * are correctly identified from transcript greeting patterns and AI-detected names.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectSpeakerRolesFromTranscript, type TranscriptWord } from "../server/services/assemblyai.js";

/** Helper to build a word array from speaker-tagged text. */
function buildWords(segments: Array<{ speaker: string; text: string }>): TranscriptWord[] {
  const words: TranscriptWord[] = [];
  let time = 0;
  for (const seg of segments) {
    for (const w of seg.text.split(/\s+/)) {
      if (!w) continue;
      words.push({ text: w, start: time, end: time + 300, confidence: 0.95, speaker: seg.speaker });
      time += 350;
    }
  }
  return words;
}

describe("Speaker role detection", () => {
  it("detects agent via 'thank you for calling' pattern", () => {
    const words = buildWords([
      { speaker: "A", text: "Thank you for calling Acme Dental how can I help you" },
      { speaker: "B", text: "Hi I am calling to schedule an appointment" },
    ]);
    const roles = detectSpeakerRolesFromTranscript(words);
    assert.ok(roles, "Should detect roles");
    assert.equal(roles!["A"], "agent");
    assert.equal(roles!["B"], "customer");
  });

  it("detects agent via 'my name is' pattern", () => {
    const words = buildWords([
      { speaker: "B", text: "Hello" },
      { speaker: "A", text: "Hi my name is Sarah how may I assist you today" },
    ]);
    const roles = detectSpeakerRolesFromTranscript(words);
    assert.ok(roles, "Should detect roles");
    assert.equal(roles!["A"], "agent");
    assert.equal(roles!["B"], "customer");
  });

  it("detects agent via AI-detected name match", () => {
    const words = buildWords([
      { speaker: "B", text: "Hi is this the dental office" },
      { speaker: "A", text: "Yes this is Marcus with Acme Dental" },
    ]);
    const roles = detectSpeakerRolesFromTranscript(words, "Marcus");
    assert.ok(roles, "Should detect roles via name match");
    assert.equal(roles!["A"], "agent");
    assert.equal(roles!["B"], "customer");
  });

  it("AI name match takes priority over greeting patterns", () => {
    // Both speakers have agent-like greetings, but AI detected the name for B
    const words = buildWords([
      { speaker: "A", text: "Welcome to the practice how can I help" },
      { speaker: "B", text: "Hi my name is Jordan I am transferring you" },
    ]);
    const roles = detectSpeakerRolesFromTranscript(words, "Jordan");
    assert.ok(roles, "Should detect roles via name match");
    assert.equal(roles!["B"], "agent");
    assert.equal(roles!["A"], "customer");
  });

  it("detects customer via 'I am calling about' pattern when no agent greeting", () => {
    const words = buildWords([
      { speaker: "A", text: "Hello" },
      { speaker: "B", text: "Hi I am calling about my insurance claim" },
    ]);
    // Neither speaker has a strong agent pattern, B has customer pattern
    // Agent detection requires at least 1 agent pattern match, so this should be null
    const roles = detectSpeakerRolesFromTranscript(words);
    assert.equal(roles, null, "Should be inconclusive without agent greeting");
  });

  it("returns null for ambiguous transcripts", () => {
    const words = buildWords([
      { speaker: "A", text: "Hello" },
      { speaker: "B", text: "Hi" },
    ]);
    const roles = detectSpeakerRolesFromTranscript(words);
    assert.equal(roles, null, "Should return null for ambiguous transcripts");
  });

  it("returns null for single-speaker transcripts", () => {
    const words = buildWords([
      { speaker: "A", text: "Thank you for calling Acme Dental this is a voicemail" },
    ]);
    const roles = detectSpeakerRolesFromTranscript(words);
    assert.equal(roles, null, "Single speaker should return null");
  });

  it("returns null for too few words", () => {
    const words = buildWords([
      { speaker: "A", text: "Hi" },
      { speaker: "B", text: "Hello" },
    ]);
    const roles = detectSpeakerRolesFromTranscript(words);
    assert.equal(roles, null, "Too few words should return null");
  });

  it("handles 'you have reached' pattern", () => {
    const words = buildWords([
      { speaker: "A", text: "You have reached the office of Dr Smith please hold" },
      { speaker: "B", text: "Okay I will wait" },
    ]);
    const roles = detectSpeakerRolesFromTranscript(words);
    assert.ok(roles, "Should detect roles");
    assert.equal(roles!["A"], "agent");
  });

  it("handles 'how may I help' pattern", () => {
    const words = buildWords([
      { speaker: "B", text: "Good morning Acme Dental how may I help you today" },
      { speaker: "A", text: "I need to schedule a cleaning" },
    ]);
    const roles = detectSpeakerRolesFromTranscript(words);
    assert.ok(roles, "Should detect roles");
    assert.equal(roles!["B"], "agent");
    assert.equal(roles!["A"], "customer");
  });
});
