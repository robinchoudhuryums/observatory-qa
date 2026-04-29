/**
 * Query-type classification + adaptive search weights.
 * Extracted from rag.ts. Pure functions — no external dependencies.
 *
 * Different query types benefit from different semantic/keyword weight balances.
 * Exact-match lookups (codes, template names) need more keyword weight;
 * conceptual questions benefit from more semantic weight.
 */

export type QueryType = "template_lookup" | "compliance_question" | "coaching_question" | "general";

/**
 * Classify a RAG query to determine optimal search weights.
 * Adapted from UMS's code_lookup/coverage_question/general classification,
 * re-targeted for Observatory QA's call analysis verticals.
 */
export function classifyQueryType(query: string): QueryType {
  const q = query.toLowerCase();

  // Template/criteria lookups — need exact keyword matching
  const templatePatterns = [
    /\b(?:template|scoring\s+criteria|evaluation\s+criteria|required\s+phrases?)\b/,
    /\b(?:prompt\s+template|call\s+categor(?:y|ies)|scoring\s+weight)\b/,
    /\b(?:what\s+(?:is|are)\s+the\s+(?:criteria|requirements|template))\b/,
  ];
  if (templatePatterns.some((p) => p.test(q))) return "template_lookup";

  // Compliance questions — balanced (need terms + context)
  const compliancePatterns = [
    /\b(?:compliance|hipaa|regulation|policy|guideline|protocol|procedure|standard)\b/,
    /\b(?:required|mandatory|must|shall|prohibited)\b/,
    /\b(?:audit|documentation\s+requirement|retention|consent)\b/,
  ];
  if (compliancePatterns.some((p) => p.test(q))) return "compliance_question";

  // Coaching questions — high semantic weight (conceptual)
  const coachingPatterns = [
    /\b(?:coach(?:ing)?|improv(?:e|ement)|feedback|training|development)\b/,
    /\b(?:best\s+practices?|recommendation|how\s+(?:to|should|can|do))\b/,
    /\b(?:performance|quality|customer\s+(?:service|experience))\b/,
  ];
  if (coachingPatterns.some((p) => p.test(q))) return "coaching_question";

  return "general";
}

/**
 * Get adaptive semantic/keyword weights based on query type.
 * Adapted from UMS's getAdaptiveWeights().
 */
export function getAdaptiveWeights(queryType: QueryType): { semantic: number; keyword: number } {
  switch (queryType) {
    case "template_lookup":
      return { semantic: 0.4, keyword: 0.6 }; // Exact terms matter most
    case "compliance_question":
      return { semantic: 0.55, keyword: 0.45 }; // Balanced — need both terms and context
    case "coaching_question":
      return { semantic: 0.75, keyword: 0.25 }; // Conceptual understanding
    case "general":
    default:
      return { semantic: 0.7, keyword: 0.3 }; // Default: favor semantic
  }
}
