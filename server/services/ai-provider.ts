/**
 * AI Analysis Provider — barrel re-export.
 *
 * Split into focused modules:
 *   ai-types.ts    — interfaces (CallAnalysis, AIAnalysisProvider, PromptTemplateConfig),
 *                    parseJsonResponse, buildAgentSummaryPrompt
 *   ai-prompts.ts  — all prompt builders (standard, clinical, email)
 *
 * All existing imports remain unchanged.
 */
export * from "./ai-types";
export * from "./ai-prompts";
