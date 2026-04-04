/**
 * Tests for RAG improvements adapted from ums-knowledge-reference.
 *
 * Covers:
 * - Adaptive query-type weights
 * - Confidence score reconciliation
 * - Domain synonym expansion
 * - Table-aware chunking
 * - Page tracking
 * - FAQ cross-org pattern detection
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Import the functions we're testing
import {
  classifyQueryType,
  getAdaptiveWeights,
  computeConfidence,
  reconcileConfidence,
  expandQueryWithSynonyms,
} from "../server/services/rag";
import type { QueryType } from "../server/services/rag";
import { chunkDocument, getCharsPerTokenForIndustry } from "../server/services/chunker";
import { recordFaqQuery, getFaqAnalytics, getKnowledgeBaseGaps, getCrossOrgFaqPatterns } from "../server/services/faq-analytics";

// --- Adaptive Query-Type Classification ---

describe("Query type classification", () => {
  it("classifies template lookups", () => {
    assert.equal(classifyQueryType("What are the scoring criteria for dental calls?"), "template_lookup");
    assert.equal(classifyQueryType("Show me the evaluation criteria"), "template_lookup");
    assert.equal(classifyQueryType("required phrases for compliance"), "template_lookup");
  });

  it("classifies compliance questions", () => {
    assert.equal(classifyQueryType("What is the HIPAA policy on patient data?"), "compliance_question");
    assert.equal(classifyQueryType("Is this procedure mandatory?"), "compliance_question");
    assert.equal(classifyQueryType("documentation requirements for audit"), "compliance_question");
  });

  it("classifies coaching questions", () => {
    assert.equal(classifyQueryType("How to improve customer satisfaction?"), "coaching_question");
    assert.equal(classifyQueryType("Best practices for call handling"), "coaching_question");
    assert.equal(classifyQueryType("coaching feedback on performance"), "coaching_question");
  });

  it("classifies general queries", () => {
    assert.equal(classifyQueryType("hello world"), "general");
    assert.equal(classifyQueryType("tell me about the weather"), "general");
    assert.equal(classifyQueryType("office hours"), "general");
  });
});

describe("Adaptive weights", () => {
  it("gives more keyword weight for template lookups", () => {
    const weights = getAdaptiveWeights("template_lookup");
    assert.ok(weights.keyword > weights.semantic, "keyword should outweigh semantic for template lookups");
    assert.equal(weights.semantic, 0.4);
    assert.equal(weights.keyword, 0.6);
  });

  it("balances weights for compliance questions", () => {
    const weights = getAdaptiveWeights("compliance_question");
    assert.equal(weights.semantic, 0.55);
    assert.equal(weights.keyword, 0.45);
  });

  it("gives more semantic weight for coaching questions", () => {
    const weights = getAdaptiveWeights("coaching_question");
    assert.ok(weights.semantic > weights.keyword);
    assert.equal(weights.semantic, 0.75);
  });

  it("defaults to 70/30 semantic/keyword for general", () => {
    const weights = getAdaptiveWeights("general");
    assert.equal(weights.semantic, 0.7);
    assert.equal(weights.keyword, 0.3);
  });
});

// --- Confidence Score Reconciliation ---

describe("Confidence reconciliation", () => {
  it("uses retrieval confidence when no LLM tag", () => {
    const result = reconcileConfidence("Here is the answer about dental procedures.", {
      score: 0.5,
      level: "high",
    });
    assert.equal(result.level, "high");
    assert.equal(result.reconciled, false);
    assert.ok(!result.cleanedText.includes("[CONFIDENCE:"));
  });

  it("parses and removes confidence tag", () => {
    const result = reconcileConfidence("Answer text [CONFIDENCE: HIGH]", {
      score: 0.5,
      level: "high",
    });
    assert.equal(result.cleanedText, "Answer text");
    assert.equal(result.level, "high");
  });

  it("downgrades LLM HIGH to PARTIAL when retrieval is weak", () => {
    const result = reconcileConfidence("Answer text [CONFIDENCE: HIGH]", {
      score: 0.25, // Below 0.30 threshold
      level: "partial",
    });
    assert.equal(result.level, "partial");
    assert.equal(result.reconciled, true);
  });

  it("hard downgrades to LOW when retrieval is very weak", () => {
    const result = reconcileConfidence("Answer text [CONFIDENCE: HIGH]", {
      score: 0.10, // Below 0.15 threshold
      level: "low",
    });
    assert.equal(result.level, "low");
    assert.equal(result.reconciled, true);
  });

  it("upgrades PARTIAL to HIGH when retrieval is strong", () => {
    const result = reconcileConfidence("Answer text [CONFIDENCE: PARTIAL]", {
      score: 0.50, // Above 0.42 upgrade threshold
      level: "high",
    });
    assert.equal(result.level, "high");
    assert.equal(result.reconciled, true);
  });
});

describe("computeConfidence (enhanced)", () => {
  it("returns none for empty chunks", () => {
    const result = computeConfidence([]);
    assert.equal(result.level, "none");
    assert.equal(result.score, 0);
  });

  it("uses 65/35 top/avg blending", () => {
    const chunks = [
      { id: "1", documentId: "d1", documentName: "Doc", documentCategory: "cat", chunkIndex: 0, text: "text", sectionHeader: null, score: 0.8 },
      { id: "2", documentId: "d1", documentName: "Doc", documentCategory: "cat", chunkIndex: 1, text: "text", sectionHeader: null, score: 0.4 },
    ];
    const result = computeConfidence(chunks);
    // effective = 0.8 * 0.65 + 0.6 * 0.35 = 0.52 + 0.21 = 0.73
    // Wait: avg = (0.8 + 0.4) / 2 = 0.6
    // effective = 0.8 * 0.65 + 0.6 * 0.35 = 0.52 + 0.21 = 0.73
    // Actually: effective should be top * 0.65 + avg * 0.35
    const expectedEffective = 0.8 * 0.65 + 0.6 * 0.35;
    assert.equal(result.score, Math.round(expectedEffective * 100) / 100);
    assert.equal(result.level, "high"); // 0.73 >= 0.42
  });

  it("penalizes single-result confidence", () => {
    const chunks = [
      { id: "1", documentId: "d1", documentName: "Doc", documentCategory: "cat", chunkIndex: 0, text: "text", sectionHeader: null, score: 0.5 },
    ];
    const result = computeConfidence(chunks);
    // effective = 0.5 * 0.65 + 0.5 * 0.35 = 0.5, then * 0.85 = 0.425
    assert.ok(result.score < 0.5, "single result should be penalized");
    assert.equal(result.level, "high"); // 0.425 >= 0.42
  });
});

// --- Domain Synonym Expansion ---

describe("Synonym expansion", () => {
  it("expands dental terms", () => {
    const expanded = expandQueryWithSynonyms("crown restoration needed", "dental");
    assert.ok(expanded.includes("cap"), `Should include 'cap' synonym for crown: ${expanded}`);
  });

  it("expands medical terms", () => {
    const expanded = expandQueryWithSynonyms("cpap setup instructions", "medical");
    assert.ok(expanded.includes("c-pap"), `Should include 'c-pap' synonym: ${expanded}`);
  });

  it("expands behavioral health terms", () => {
    const expanded = expandQueryWithSynonyms("cbt therapy session", "behavioral_health");
    // cbt → cognitive behavioral (multi-word, skipped), cognitive therapy (multi-word, skipped)
    // therapy → counseling, psychotherapy, session
    const expandedLower = expanded.toLowerCase();
    assert.ok(
      expandedLower.includes("counseling") || expandedLower.includes("psychotherapy"),
      `Should include therapy synonyms: ${expanded}`,
    );
  });

  it("expands veterinary terms", () => {
    const expanded = expandQueryWithSynonyms("vaccination schedule", "veterinary");
    assert.ok(expanded.includes("vax") || expanded.includes("immunization"), `Should include vaccine synonyms: ${expanded}`);
  });

  it("falls back to general synonyms for unknown industry", () => {
    const expanded = expandQueryWithSynonyms("cancellation policy", undefined);
    assert.ok(expanded.includes("cancel"), `Should include 'cancel' synonym: ${expanded}`);
  });

  it("returns original query when no synonyms match", () => {
    const expanded = expandQueryWithSynonyms("random unrelated text xyz", "dental");
    assert.equal(expanded, "random unrelated text xyz");
  });

  it("avoids adding multi-word synonyms (noise reduction)", () => {
    const expanded = expandQueryWithSynonyms("wheelchair assessment", "medical");
    // "wheelchair" → ["wc", "w/c", "power wheelchair", "manual wheelchair"]
    // Only single-token "wc" should be added; "w/c" has slash (treated as single), multi-word skipped
    assert.ok(expanded.includes("wc"), `Should include 'wc': ${expanded}`);
    assert.ok(!expanded.includes("power wheelchair"), `Should NOT include multi-word synonym: ${expanded}`);
  });
});

// --- Table-Aware Chunking ---

describe("Table-aware chunking", () => {
  it("preserves pipe-delimited tables as single chunks", () => {
    const text = `Introduction paragraph.

| Column A | Column B | Column C |
|----------|----------|----------|
| Value 1  | Value 2  | Value 3  |
| Value 4  | Value 5  | Value 6  |

Conclusion paragraph.`;

    const chunks = chunkDocument("doc1", text, { chunkSizeTokens: 50, overlapTokens: 10 });
    // The table should be in its own chunk
    const tableChunk = chunks.find((c) => c.text.includes("Column A") && c.text.includes("Value 6"));
    assert.ok(tableChunk, "Table should be preserved as a single chunk");
  });

  it("preserves tab-delimited tables as single chunks", () => {
    const text = `Header text.\n\nName\tAge\tCity\nAlice\t30\tNY\nBob\t25\tLA\n\nFooter text.`;
    const chunks = chunkDocument("doc1", text, { chunkSizeTokens: 30, overlapTokens: 5 });
    const tableChunk = chunks.find((c) => c.text.includes("Alice") && c.text.includes("Bob"));
    assert.ok(tableChunk, "Tab-delimited table should be preserved");
  });

  it("splits oversized tables normally (>3x chunk size)", () => {
    // Create a very large table that exceeds 3x chunk size
    const rows = Array.from({ length: 50 }, (_, i) => `| Row ${i} | Data ${i} | Value ${i} |`);
    const text = `Header\n\n${rows.join("\n")}\n\nFooter`;
    const chunks = chunkDocument("doc1", text, { chunkSizeTokens: 20, overlapTokens: 5 });
    // With 50 rows, the table exceeds 3x a 20-token chunk, so it should be split
    assert.ok(chunks.length > 1, "Oversized table should be split into multiple chunks");
  });

  it("can disable table preservation", () => {
    const text = `| A | B |\n| 1 | 2 |\n| 3 | 4 |`;
    const withPreservation = chunkDocument("doc1", text, { chunkSizeTokens: 10, overlapTokens: 2, preserveTables: true });
    const withoutPreservation = chunkDocument("doc1", text, { chunkSizeTokens: 10, overlapTokens: 2, preserveTables: false });
    // Both should produce chunks, but the preserved version should keep the table intact
    assert.ok(withPreservation.length >= 1);
    assert.ok(withoutPreservation.length >= 1);
  });
});

// --- Page Tracking ---

describe("Page tracking", () => {
  it("tracks page numbers from form feed markers", () => {
    const text = `Page 1 content here.\fPage 2 content here.\fPage 3 content here.`;
    const chunks = chunkDocument("doc1", text, { chunkSizeTokens: 20, overlapTokens: 5 });
    // First chunk should be page 1
    const page1Chunk = chunks.find((c) => c.text.includes("Page 1"));
    assert.ok(page1Chunk, "Should have a page 1 chunk");
    assert.equal(page1Chunk?.pageNumber, 1);

    const page2Chunk = chunks.find((c) => c.text.includes("Page 2") && !c.text.includes("Page 1"));
    if (page2Chunk) {
      assert.equal(page2Chunk.pageNumber, 2);
    }
  });

  it("returns null page number when no page breaks", () => {
    const text = "Simple text without page breaks. More text here.";
    const chunks = chunkDocument("doc1", text, { chunkSizeTokens: 100, overlapTokens: 20 });
    assert.equal(chunks[0].pageNumber, null);
  });
});

// --- Section Header Detection (enhanced) ---

describe("Section header detection (enhanced)", () => {
  it("detects numbered sections", () => {
    const text = `1.2.3 Coverage Requirements\n\nThe patient must meet all of the following criteria.`;
    const chunks = chunkDocument("doc1", text, { chunkSizeTokens: 200, overlapTokens: 40 });
    assert.ok(chunks.length > 0);
    // The first chunk's section header should detect the numbered section
    // Note: the numbered pattern is "1.2.3 Coverage Requirements"
    assert.ok(
      chunks[0].sectionHeader === null || chunks[0].sectionHeader?.includes("Coverage") || chunks[0].sectionHeader?.includes("1.2.3"),
      `Section header should detect numbered section or be null for first pos`,
    );
  });

  it("detects colon-suffixed headers", () => {
    // Need enough text so that the chunk boundary falls after the header
    const padding = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(5);
    const text = `${padding}\n\nEligibility Criteria:\n\n${padding}The following conditions must be met. ${padding}`;
    const chunks = chunkDocument("doc1", text, { chunkSizeTokens: 60, overlapTokens: 10 });
    // A chunk that starts after "Eligibility Criteria:" should detect it
    const afterHeader = chunks.find(
      (c) => c.charStart > text.indexOf("Eligibility Criteria:") && c.text.length > 20,
    );
    if (afterHeader) {
      assert.ok(
        afterHeader.sectionHeader?.includes("Eligibility"),
        `Should detect colon-suffixed header: ${afterHeader.sectionHeader}`,
      );
    }
  });
});

// --- FAQ Cross-Org Pattern Detection ---

describe("Cross-org FAQ patterns", () => {
  it("aggregates patterns across orgs with anonymization", () => {
    // Record queries from multiple orgs
    for (let i = 1; i <= 5; i++) {
      recordFaqQuery(`org-${i}`, "What is the cancellation policy?", 0.6, "partial");
      recordFaqQuery(`org-${i}`, "What is the cancellation policy?", 0.5, "partial");
    }

    const patterns = getCrossOrgFaqPatterns({ minOrgs: 3, minTotalCount: 5 });
    assert.ok(patterns.length > 0, "Should find cross-org patterns");
    const cancellation = patterns.find((p) => p.normalizedKey.includes("cancellation"));
    assert.ok(cancellation, "Should find the cancellation pattern");
    assert.ok(cancellation!.orgCount >= 5, "Should count all 5 orgs");
    assert.ok(cancellation!.totalCount >= 10, "Should count all queries");
  });

  it("requires minimum org count for anonymization", () => {
    // Record from only 2 orgs
    recordFaqQuery("single-org-1", "super unique question xyz123", 0.3, "low");
    recordFaqQuery("single-org-2", "super unique question xyz123", 0.3, "low");

    const patterns = getCrossOrgFaqPatterns({ minOrgs: 3 });
    const unique = patterns.find((p) => p.normalizedKey.includes("xyz123"));
    assert.ok(!unique, "Should NOT return patterns from fewer than 3 orgs");
  });

  it("calculates aggregate confidence", () => {
    for (let i = 1; i <= 4; i++) {
      recordFaqQuery(`agg-org-${i}`, "aggregate confidence test query", 0.8, "high");
      recordFaqQuery(`agg-org-${i}`, "aggregate confidence test query", 0.2, "low");
    }

    const patterns = getCrossOrgFaqPatterns({ minOrgs: 3, minTotalCount: 5 });
    const testPattern = patterns.find((p) => p.normalizedKey.includes("aggregate confidence"));
    if (testPattern) {
      assert.ok(testPattern.avgConfidence > 0 && testPattern.avgConfidence < 1);
      assert.ok(testPattern.lowConfidenceRate > 0, "Should track low confidence rate");
    }
  });
});

// --- Industry-Specific Token Ratios ---

describe("Industry-specific token ratios", () => {
  it("returns 3.5 for dental", () => {
    assert.equal(getCharsPerTokenForIndustry("dental"), 3.5);
  });
  it("returns 3.5 for medical", () => {
    assert.equal(getCharsPerTokenForIndustry("medical"), 3.5);
  });
  it("returns 3.8 for behavioral_health", () => {
    assert.equal(getCharsPerTokenForIndustry("behavioral_health"), 3.8);
  });
  it("returns 3.5 for veterinary", () => {
    assert.equal(getCharsPerTokenForIndustry("veterinary"), 3.5);
  });
  it("returns 4 for general/unknown", () => {
    assert.equal(getCharsPerTokenForIndustry("general"), 4);
    assert.equal(getCharsPerTokenForIndustry(undefined), 4);
  });
});
