/**
 * Document chunking service for RAG.
 *
 * Splits extracted text into overlapping chunks optimized for embedding
 * and semantic retrieval. Uses a sliding window with natural break detection
 * to preserve context across chunk boundaries.
 *
 * Ported from ums-knowledge-reference, adapted for call analysis context.
 */

export interface ChunkOptions {
  /** Target chunk size in tokens (default: 400 — tuned for mixed doc/conversational text) */
  chunkSizeTokens?: number;
  /** Overlap between adjacent chunks in tokens (default: 80) */
  overlapTokens?: number;
}

export interface DocumentChunk {
  documentId: string;
  chunkIndex: number;
  text: string;
  sectionHeader: string | null;
  tokenCount: number;
  charStart: number;
  charEnd: number;
}

/** Conservative token estimate: ~4 characters per token for English text */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
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
  // Match markdown headers, all-caps lines, or "Section: ..." patterns
  const headerPatterns = [
    /^#{1,4}\s+(.+)$/gm,          // Markdown: ## Header
    /^([A-Z][A-Z\s]{4,60})$/gm,   // ALL CAPS LINE
    /^(?:Section|Chapter|Part)\s*[:.]?\s*(.+)$/gim,
  ];

  let lastHeader: string | null = null;
  let lastPos = -1;

  for (const pattern of headerPatterns) {
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
 * Split a document's extracted text into overlapping chunks for embedding.
 */
export function chunkDocument(
  documentId: string,
  text: string,
  options: ChunkOptions = {},
): DocumentChunk[] {
  if (!text || text.trim().length === 0) return [];

  const chunkSizeTokens = options.chunkSizeTokens ?? 400;
  const overlapTokens = Math.min(options.overlapTokens ?? 80, chunkSizeTokens - 1);
  const chunkSizeChars = chunkSizeTokens * 4;
  // Minimum step of 40 chars (~10 tokens) prevents infinite micro-chunks
  const stepChars = Math.max((chunkSizeTokens - overlapTokens) * 4, 40);

  const chunks: DocumentChunk[] = [];
  let pos = 0;
  let chunkIndex = 0;

  while (pos < text.length) {
    let endPos = pos + chunkSizeChars;

    if (endPos < text.length) {
      // Find a natural break near the end of the chunk
      endPos = findNaturalBreak(text, endPos);
    } else {
      endPos = text.length;
    }

    const chunkText = text.slice(pos, endPos).trim();
    if (chunkText.length > 0) {
      chunks.push({
        documentId,
        chunkIndex,
        text: chunkText,
        sectionHeader: findSectionHeader(text, pos),
        tokenCount: estimateTokens(chunkText),
        charStart: pos,
        charEnd: endPos,
      });
      chunkIndex++;
    }

    // Advance by step size (ensures overlap)
    const nextPos = pos + stepChars;
    // Safety: always advance at least 1 char to prevent infinite loop
    pos = nextPos > pos ? nextPos : pos + 1;

    if (pos >= text.length) break;
  }

  return chunks;
}
