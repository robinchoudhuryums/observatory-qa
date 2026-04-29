/**
 * Conversation-aware query reformulation.
 * Extracted from rag.ts. Pure utility — no external dependencies.
 *
 * Detects follow-up questions via pronoun/reference patterns and prepends
 * conversation context for standalone embedding/search.
 */

export function validateConversationHistory(
  history: Array<{ role: string; content: string }>,
): Array<{ role: string; content: string }> {
  const MAX_TURNS = 20;
  const MAX_TOTAL_CHARS = 50_000;
  let trimmed = history.slice(-MAX_TURNS);
  let totalChars = trimmed.reduce((sum, h) => sum + h.content.length, 0);
  while (totalChars > MAX_TOTAL_CHARS && trimmed.length > 1) {
    totalChars -= trimmed[0].content.length;
    trimmed = trimmed.slice(1);
  }
  return trimmed;
}

/**
 * Reformulate a follow-up question into a standalone query using conversation context.
 * Adapted from UMS's query reformulation strategy.
 *
 * When users ask follow-up questions like "What about that?" or "And the coverage?",
 * the query needs prior context to make sense for embedding and search.
 *
 * Strategy:
 * - Last 4 turns kept verbatim
 * - Older turns summarized into a topic list
 * - Returns a standalone query that can be embedded and searched independently
 *
 * This is a lightweight client-side reformulation (no LLM call). For production
 * conversational interfaces, consider an LLM-based reformulation step.
 */
export function reformulateWithContext(
  currentQuery: string,
  conversationHistory: Array<{ role: string; content: string }>,
): string {
  if (!conversationHistory || conversationHistory.length === 0) return currentQuery;

  // Detect if the query is a follow-up (short, contains pronouns/references)
  const isFollowUp =
    currentQuery.length < 80 &&
    /\b(?:that|this|those|these|it|they|them|the same|above|previous|also|more|what about|and the|how about)\b/i.test(
      currentQuery,
    );

  if (!isFollowUp) return currentQuery;

  // Extract topics from recent conversation
  const recentTurns = conversationHistory.slice(-4);
  const olderTurns = conversationHistory.slice(0, -4);

  // Build topic context from older turns
  let topicContext = "";
  if (olderTurns.length > 0) {
    const topics = olderTurns
      .filter((t) => t.role === "user")
      .map((t) => t.content.slice(0, 100).replace(/[?!.]+$/, ""))
      .join("; ");
    if (topics) {
      topicContext = `Context: previously discussed ${topics}. `;
    }
  }

  // Extract the most recent user question for context
  const lastUserTurn = recentTurns.filter((t) => t.role === "user").pop();
  const lastContext = lastUserTurn ? lastUserTurn.content.slice(0, 200) : "";

  // Reformulate: prepend context to the follow-up
  if (lastContext) {
    return `${topicContext}Regarding "${lastContext}": ${currentQuery}`;
  }

  return `${topicContext}${currentQuery}`;
}
