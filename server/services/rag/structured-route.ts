/**
 * Structured reference short-circuit.
 * Extracted from rag.ts.
 *
 * Certain queries can be answered directly from structured data (prompt
 * templates, document metadata, evaluation criteria) without the full RAG
 * pipeline (embed → search → rerank). This saves 2-4 seconds and reduces
 * Bedrock costs by avoiding an embedding round trip + a vector search.
 */
import { eq, and } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as tables from "../../db/schema";
import { logger } from "../logger";

export type QueryRoute = "structured" | "hybrid" | "rag";

/**
 * Classify whether a query can be short-circuited via structured data lookup.
 * Adapted from UMS's query route classification.
 *
 * - "structured": Pure metadata lookup (skip RAG entirely)
 * - "hybrid": Has structured elements but also needs RAG context
 * - "rag": Full RAG pipeline needed
 */
export function classifyQueryRoute(query: string): QueryRoute {
  const q = query.toLowerCase();

  // Structured patterns — can be answered from DB metadata alone
  const structuredPatterns = [
    /^(?:what|list|show)\s+(?:are|is)\s+(?:the\s+)?(?:evaluation|scoring)\s+(?:criteria|weights?|template)/,
    /^(?:what|list|show)\s+(?:are|is)\s+(?:the\s+)?(?:required\s+phrases?|call\s+categor(?:y|ies))/,
    /^(?:what|list|show)\s+(?:are|is)\s+(?:the\s+)?(?:prompt\s+templates?)\b/,
    /^(?:how\s+many|count)\s+(?:documents?|templates?|categories)/,
  ];

  // Hybrid patterns — structured data + RAG context needed
  const hybridPatterns = [
    /\b(?:scoring\s+criteria|evaluation\s+criteria)\b.*\b(?:about|for|regarding)\b/,
    /\b(?:template|category)\b.*\b(?:and|with|including)\b.*\b(?:document|handbook|policy)\b/,
  ];

  // Check structured first (most restrictive)
  if (structuredPatterns.some((p) => p.test(q))) return "structured";
  if (hybridPatterns.some((p) => p.test(q))) return "hybrid";
  return "rag";
}

/**
 * Answer a query directly from structured data without the RAG pipeline.
 * Returns formatted context from prompt templates and document metadata.
 *
 * This is the "short-circuit" path: no embedding, no vector search, no Bedrock call.
 */
export async function getStructuredAnswer(
  db: NodePgDatabase,
  orgId: string,
  queryText: string,
): Promise<{
  answer: string;
  source: "structured";
  confidence: "high";
} | null> {
  const q = queryText.toLowerCase();

  try {
    // Template/criteria queries → return from prompt_templates table
    if (/(?:criteria|template|scoring|required\s+phrase|call\s+categor)/.test(q)) {
      const templates = await db
        .select({
          callCategory: tables.promptTemplates.callCategory,
          evaluationCriteria: tables.promptTemplates.evaluationCriteria,
          requiredPhrases: tables.promptTemplates.requiredPhrases,
          scoringWeights: tables.promptTemplates.scoringWeights,
        })
        .from(tables.promptTemplates)
        .where(eq(tables.promptTemplates.orgId, orgId))
        .limit(20);

      if (templates.length === 0) return null;

      const lines = templates.map((t) => {
        const parts = [`**${t.callCategory || "General"}**`];
        if (t.evaluationCriteria) parts.push(`Criteria: ${(t.evaluationCriteria as string).slice(0, 300)}`);
        if (t.scoringWeights) {
          const w = t.scoringWeights as Record<string, number>;
          parts.push(
            `Weights: ${Object.entries(w)
              .map(([k, v]) => `${k}=${v}`)
              .join(", ")}`,
          );
        }
        if (t.requiredPhrases) {
          const phrases = t.requiredPhrases as Array<{ phrase: string }>;
          if (phrases.length > 0) {
            parts.push(`Required phrases: ${phrases.map((p) => p.phrase).join("; ")}`);
          }
        }
        return parts.join("\n");
      });

      return {
        answer: `Here are the evaluation templates configured for your organization:\n\n${lines.join("\n\n---\n\n")}`,
        source: "structured",
        confidence: "high",
      };
    }

    // Document count/list queries → return from reference_documents table
    if (/(?:document|how\s+many|count)/.test(q)) {
      const docs = await db
        .select({
          name: tables.referenceDocuments.name,
          category: tables.referenceDocuments.category,
          indexingStatus: tables.referenceDocuments.indexingStatus,
          retrievalCount: tables.referenceDocuments.retrievalCount,
        })
        .from(tables.referenceDocuments)
        .where(and(eq(tables.referenceDocuments.orgId, orgId), eq(tables.referenceDocuments.isActive, true)))
        .limit(50);

      if (docs.length === 0) {
        return {
          answer:
            "No documents are currently in your knowledge base. Upload documents via the admin panel to enable RAG-powered analysis.",
          source: "structured",
          confidence: "high",
        };
      }

      const summary = docs
        .map(
          (d) =>
            `- **${d.name}** (${d.category || "uncategorized"}) — ${d.indexingStatus}, retrieved ${d.retrievalCount || 0} times`,
        )
        .join("\n");

      return {
        answer: `Your knowledge base contains ${docs.length} active document(s):\n\n${summary}`,
        source: "structured",
        confidence: "high",
      };
    }
  } catch (err) {
    logger.debug({ err }, "Structured answer lookup failed — falling through to RAG");
  }

  return null;
}
