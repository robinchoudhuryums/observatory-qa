/**
 * Document chunking service for RAG.
 *
 * Splits extracted text into overlapping chunks optimized for embedding
 * and semantic retrieval. Uses a sliding window with natural break detection
 * to preserve context across chunk boundaries.
 *
 * Enhanced with patterns from ums-knowledge-reference:
 * - Table preservation: detects pipe/tab-delimited tables and keeps them whole
 * - Page tracking: maps character offsets to page numbers via page break markers
 * - Numbered section detection: "1.2.3 Title" format headers
 *
 * Ported from ums-knowledge-reference, adapted for call analysis context.
 */

export interface ChunkOptions {
  /** Target chunk size in tokens (default: 400 — tuned for mixed doc/conversational text) */
  chunkSizeTokens?: number;
  /** Overlap between adjacent chunks in tokens (default: 80) */
  overlapTokens?: number;
  /**
   * Characters per token ratio for estimation (default: 4).
   * Medical/clinical text with abbreviations (ICD-10, CPT, CDT codes) may use ~3.5.
   * Conversational transcripts with short words may use ~4.5.
   */
  charsPerToken?: number;
  /** Preserve tables as single chunks (default: true) */
  preserveTables?: boolean;
}

export interface DocumentChunk {
  documentId: string;
  chunkIndex: number;
  text: string;
  sectionHeader: string | null;
  tokenCount: number;
  charStart: number;
  charEnd: number;
  /** Page number (1-indexed) if page break markers (\f) are present */
  pageNumber: number | null;
}

/** Token estimate based on chars-per-token ratio (default 4 for English text). */
function estimateTokens(text: string, charsPerToken = 4): number {
  return Math.ceil(text.length / charsPerToken);
}

/**
 * Recommended charsPerToken ratio by industry type.
 * Medical/dental text with clinical codes (ICD-10, CPT, CDT) has shorter tokens.
 * Conversational transcripts with common words have longer tokens.
 */
export function getCharsPerTokenForIndustry(industryType?: string): number {
  switch (industryType) {
    case "dental":
    case "medical":
    case "veterinary":
      return 3.5; // Clinical codes, abbreviations, Latin terms
    case "behavioral_health":
      return 3.8; // Mix of clinical and conversational
    default:
      return 4; // General English text
  }
}

/**
 * Find a natural break point near the target position.
 * Searches backward within a window, preferring paragraph > sentence > line > raw.
 */
function findNaturalBreak(text: string, targetPos: number, windowSize = 200): number {
  const searchStart = Math.max(0, targetPos - windowSize);
  const searchText = text.slice(searchStart, targetPos);

  // Priority 1: Paragraph break (\n\n)
  const paraBreak = searchText.lastIndexOf("\n\n");
  if (paraBreak !== -1) return searchStart + paraBreak + 2;

  // Priority 2: Sentence ending (. ! ?) — find the LAST sentence break in the window
  // Use lastIndexOf-based approach instead of greedy regex to avoid O(n^2) backtracking.
  const lastSentenceEnd = Math.max(
    searchText.lastIndexOf(". "),
    searchText.lastIndexOf("! "),
    searchText.lastIndexOf("? "),
  );
  if (lastSentenceEnd !== -1) return searchStart + lastSentenceEnd + 2;

  // Priority 3: Line break
  const lineBreak = searchText.lastIndexOf("\n");
  if (lineBreak !== -1) return searchStart + lineBreak + 1;

  // Fallback: use target position
  return targetPos;
}

/**
 * Detect section headers in the text (lines that look like headings).
 * Returns the most recent header before a given position.
 */
function findSectionHeader(text: string, pos: number): string | null {
  const before = text.slice(0, pos);
  // Match markdown headers, all-caps lines, numbered sections, or "Section: ..." patterns
  const headerPatterns = [
    /^#{1,4}\s+(.+)$/gm, // Markdown: ## Header
    /^([A-Z][A-Z\s]{4,60})$/gm, // ALL CAPS LINE
    /^(?:Section|Chapter|Part)\s*[:.]?\s*(.+)$/gim,
    /^(\d+(?:\.\d+)*)\s+([A-Z].{3,80})$/gm, // Numbered: "1.2.3 Title"
    /^([A-Z][^:\n]{2,60}):\s*$/gm, // Colon-suffixed: "Coverage Criteria:"
  ];

  let lastHeader: string | null = null;
  let lastPos = -1;

  for (const pattern of headerPatterns) {
    pattern.lastIndex = 0; // Reset — regex with /g flag retains lastIndex across calls
    let match;
    while ((match = pattern.exec(before)) !== null) {
      if (match.index > lastPos) {
        lastPos = match.index;
        lastHeader = match[1]?.trim() || match[0].trim();
      }
    }
  }

  return lastHeader ? lastHeader.slice(0, 500) : null;
}

/**
 * Build a page number lookup from page break markers (\f = form feed).
 * PDF extractors typically insert \f between pages.
 * Returns a function that maps character offset → page number (1-indexed).
 */
function buildPageLookup(text: string): (charOffset: number) => number | null {
  const pageBreaks: number[] = [];
  let idx = 0;
  while ((idx = text.indexOf("\f", idx)) !== -1) {
    pageBreaks.push(idx);
    idx++;
  }

  if (pageBreaks.length === 0) return () => null;

  return (charOffset: number): number => {
    // Page 1 = before first \f, Page 2 = after first \f, etc.
    let page = 1;
    for (const breakPos of pageBreaks) {
      if (charOffset > breakPos) page++;
      else break;
    }
    return page;
  };
}

/**
 * Detect if a text block is a table (pipe-delimited or tab-delimited).
 * Tables should be kept as single chunks to preserve row/column relationships.
 */
function isTableBlock(text: string): boolean {
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length < 2) return false;

  // Pipe-delimited table: most lines contain 2+ pipe characters
  const pipeLines = lines.filter((l) => (l.match(/\|/g) || []).length >= 2);
  if (pipeLines.length >= lines.length * 0.6) return true;

  // Tab-delimited table: most lines contain 2+ tabs
  const tabLines = lines.filter((l) => (l.match(/\t/g) || []).length >= 2);
  if (tabLines.length >= lines.length * 0.6) return true;

  return false;
}

/**
 * Extract table blocks from text, returning their positions.
 * A table block is a contiguous set of lines that look like a table.
 */
function findTableBlocks(text: string): Array<{ start: number; end: number }> {
  const blocks: Array<{ start: number; end: number }> = [];
  const lines = text.split("\n");
  let lineStart = 0;
  let tableStart = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isPipeRow = (line.match(/\|/g) || []).length >= 2;
    const isTabRow = (line.match(/\t/g) || []).length >= 2;
    const isTableRow = isPipeRow || isTabRow;

    if (isTableRow && tableStart === -1) {
      tableStart = lineStart;
    } else if (!isTableRow && tableStart !== -1) {
      // End of table block — require at least 2 rows
      const tableText = text.slice(tableStart, lineStart);
      if (tableText.split("\n").filter((l) => l.trim()).length >= 2) {
        blocks.push({ start: tableStart, end: lineStart });
      }
      tableStart = -1;
    }

    lineStart += line.length + 1; // +1 for \n
  }

  // Handle table at end of text
  if (tableStart !== -1) {
    const tableText = text.slice(tableStart, text.length);
    if (tableText.split("\n").filter((l) => l.trim()).length >= 2) {
      blocks.push({ start: tableStart, end: text.length });
    }
  }

  return blocks;
}

/**
 * Split a document's extracted text into overlapping chunks for embedding.
 *
 * Enhanced with table preservation: tables are extracted as whole chunks
 * before the sliding window runs on the remaining text. This preserves
 * row/column relationships that would be destroyed by mid-table splits.
 */
export function chunkDocument(documentId: string, text: string, options: ChunkOptions = {}): DocumentChunk[] {
  if (!text || text.trim().length === 0) return [];

  const chunkSizeTokens = options.chunkSizeTokens ?? 400;
  const overlapTokens = Math.min(options.overlapTokens ?? 80, chunkSizeTokens - 1);
  const cpt = options.charsPerToken ?? 4;
  const chunkSizeChars = chunkSizeTokens * cpt;
  // Minimum step of 40 chars (~10 tokens) prevents infinite micro-chunks
  const stepChars = Math.max((chunkSizeTokens - overlapTokens) * cpt, 40);
  const preserveTables = options.preserveTables !== false; // Default true

  const pageLookup = buildPageLookup(text);
  const chunks: DocumentChunk[] = [];
  let chunkIndex = 0;

  // Phase 1: Extract table blocks as whole chunks (if enabled)
  const tableBlocks = preserveTables ? findTableBlocks(text) : [];
  const tableRanges = new Set<string>(); // "start-end" for quick lookup

  for (const block of tableBlocks) {
    const tableText = text.slice(block.start, block.end).trim();
    if (tableText.length > 0) {
      // Only preserve if the table isn't too large (>3x chunk size → split normally)
      if (estimateTokens(tableText, cpt) <= chunkSizeTokens * 3) {
        chunks.push({
          documentId,
          chunkIndex,
          text: tableText,
          sectionHeader: findSectionHeader(text, block.start),
          tokenCount: estimateTokens(tableText, cpt),
          charStart: block.start,
          charEnd: block.end,
          pageNumber: pageLookup(block.start),
        });
        chunkIndex++;
        tableRanges.add(`${block.start}-${block.end}`);
      }
    }
  }

  // Phase 2: Sliding window on non-table text segments
  // Build a list of text segments that aren't covered by table blocks
  const segments: Array<{ start: number; end: number }> = [];
  let segStart = 0;
  const sortedTables = [...tableBlocks]
    .filter((b) => tableRanges.has(`${b.start}-${b.end}`))
    .sort((a, b) => a.start - b.start);

  for (const table of sortedTables) {
    if (segStart < table.start) {
      segments.push({ start: segStart, end: table.start });
    }
    segStart = table.end;
  }
  if (segStart < text.length) {
    segments.push({ start: segStart, end: text.length });
  }

  // If no tables were extracted, process the whole text as one segment
  if (segments.length === 0 && tableBlocks.length === 0) {
    segments.push({ start: 0, end: text.length });
  }

  for (const segment of segments) {
    let pos = segment.start;

    while (pos < segment.end) {
      let endPos = pos + chunkSizeChars;

      if (endPos < segment.end) {
        // Find a natural break near the end of the chunk
        endPos = findNaturalBreak(text, endPos);
        // Don't break past the segment boundary
        endPos = Math.min(endPos, segment.end);
      } else {
        endPos = segment.end;
      }

      const chunkText = text.slice(pos, endPos).trim();
      if (chunkText.length > 0) {
        chunks.push({
          documentId,
          chunkIndex,
          text: chunkText,
          sectionHeader: findSectionHeader(text, pos),
          tokenCount: estimateTokens(chunkText, cpt),
          charStart: pos,
          charEnd: endPos,
          pageNumber: pageLookup(pos),
        });
        chunkIndex++;
      }

      // Advance by step size (ensures overlap)
      const nextPos = pos + stepChars;
      // Safety: always advance at least 1 char to prevent infinite loop
      pos = nextPos > pos ? nextPos : pos + 1;

      if (pos >= segment.end) break;
    }
  }

  // Sort by charStart to maintain document order (tables may have been prepended)
  chunks.sort((a, b) => a.charStart - b.charStart);
  // Re-index after sorting
  for (let i = 0; i < chunks.length; i++) {
    chunks[i].chunkIndex = i;
  }

  return chunks;
}
