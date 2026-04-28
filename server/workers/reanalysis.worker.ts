/**
 * Bulk reanalysis worker — re-analyzes calls with updated prompt templates.
 *
 * Processes jobs from the "bulk-reanalysis" BullMQ queue.
 * Each job contains { orgId, callIds?, requestedBy } and re-runs
 * AI analysis on the specified (or all completed) calls.
 */
import { Worker, type Job } from "bullmq";
import type { BulkReanalysisJob } from "../services/queue";
import { moveToDeadLetter } from "../services/queue";
import { logger } from "../services/logger";

export function createReanalysisWorker(
  connection: import("bullmq").ConnectionOptions,
  getStorage: () => import("../storage/types").IStorage,
  getAiProvider: () => { isAvailable: boolean; name: string; analyzeCallTranscript: (...args: any[]) => Promise<any> },
  getAssemblyAIService: () => { processTranscriptData: (...args: any[]) => any },
): Worker<BulkReanalysisJob> {
  const worker = new Worker<BulkReanalysisJob>(
    "bulk-reanalysis",
    async (job: Job<BulkReanalysisJob>) => {
      const { orgId, callIds, requestedBy } = job.data;
      const storage = getStorage();
      const aiProvider = getAiProvider();
      const assemblyAIService = getAssemblyAIService();

      if (!aiProvider.isAvailable) {
        const msg = "Reanalysis worker: AI provider not available — job will be retried";
        logger.error({ orgId, jobId: job.id }, msg);
        throw new Error(msg);
      }

      let succeeded = 0;
      let failed = 0;
      let totalProcessed = 0;

      // Cache prompt templates by category to avoid repeated DB lookups
      const templateCache = new Map<string, any>();

      // Helper: process a single call through reanalysis
      const processCall = async (call: any) => {
        const transcriptText = call.transcript!.text!;

        let promptTemplate = undefined;
        if (call.callCategory) {
          if (templateCache.has(call.callCategory)) {
            promptTemplate = templateCache.get(call.callCategory);
          } else {
            const tmpl = await storage.getPromptTemplateByCategory(orgId, call.callCategory);
            if (tmpl) {
              promptTemplate = {
                evaluationCriteria: tmpl.evaluationCriteria,
                requiredPhrases: tmpl.requiredPhrases,
                scoringWeights: tmpl.scoringWeights,
                additionalInstructions: tmpl.additionalInstructions,
              };
            }
            templateCache.set(call.callCategory, promptTemplate);
          }
        }

        const aiAnalysis = await aiProvider.analyzeCallTranscript(
          transcriptText,
          call.id,
          call.callCategory,
          promptTemplate,
        );

        const { analysis } = assemblyAIService.processTranscriptData(
          { id: "", status: "completed", text: transcriptText, words: call.transcript?.words },
          aiAnalysis,
          call.id,
        );

        if (aiAnalysis.sub_scores) {
          const ss = aiAnalysis.sub_scores;
          analysis.subScores = {
            compliance: ss.compliance != null ? Number(ss.compliance) : undefined,
            customerExperience: ss.customer_experience != null ? Number(ss.customer_experience) : undefined,
            communication: ss.communication != null ? Number(ss.communication) : undefined,
            resolution: ss.resolution != null ? Number(ss.resolution) : undefined,
          };
        }
        if (aiAnalysis.detected_agent_name) {
          analysis.detectedAgentName = aiAnalysis.detected_agent_name;
        }

        await storage.createCallAnalysis(orgId, { ...analysis, callId: call.id });
      };

      if (callIds?.length) {
        // Specific call IDs requested — fetch only those (small set, no full table scan)
        const targetCalls = await storage.getCallsWithDetails(orgId, { status: "completed", limit: callIds.length });
        const callsWithTranscripts = targetCalls.filter((c) => callIds.includes(c.id) && c.transcript?.text);
        totalProcessed = callsWithTranscripts.length;
        for (const call of callsWithTranscripts) {
          try {
            await processCall(call);
            succeeded++;
          } catch (error) {
            logger.error({ callId: call.id, err: error }, "Reanalysis worker: call failed");
            failed++;
          }
          await job.updateProgress(Math.round(((succeeded + failed) / totalProcessed) * 100));
        }
      } else {
        // All completed calls — process in streaming chunks to avoid OOM.
        // Each chunk is fetched, processed, and discarded before the next chunk.
        const CHUNK_SIZE = 200;
        let offset = 0;
        let hasMore = true;
        while (hasMore) {
          const chunk = await storage.getCallsWithDetails(orgId, { status: "completed", limit: CHUNK_SIZE, offset });
          const withTranscripts = chunk.filter((c) => c.transcript?.text);
          for (const call of withTranscripts) {
            try {
              await processCall(call);
              succeeded++;
            } catch (error) {
              logger.error({ callId: call.id, err: error }, "Reanalysis worker: call failed");
              failed++;
            }
          }
          totalProcessed += withTranscripts.length;
          offset += CHUNK_SIZE;
          hasMore = chunk.length === CHUNK_SIZE;
          // Progress is approximate since we don't know total upfront
          await job.updateProgress(hasMore ? Math.min(95, offset / 10) : 100);
        }
      }

      logger.info({ orgId, succeeded, failed, total: totalProcessed, requestedBy }, "Reanalysis worker: complete");

      return { succeeded, failed, total: totalProcessed };
    },
    {
      connection,
      concurrency: parseInt(process.env.REANALYSIS_CONCURRENCY || "3", 10), // Parallel Bedrock calls (configurable)
    },
  );

  worker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err }, "Reanalysis worker: job failed");
    // Move permanently failed jobs to dead letter queue for admin review
    if (job && job.attemptsMade >= (job.opts?.attempts || 1)) {
      moveToDeadLetter("bulk-reanalysis", job.id || "unknown", job.data.orgId, err.message, job.data as any).catch(
        () => {},
      );
    }
  });

  return worker;
}
