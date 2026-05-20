/**
 * Pattern subscription schemas.
 *
 * A "pattern" is a recurring cluster of calls surfaced by the insights
 * engine (`/api/insights/clusters`). Managers can subscribe to a pattern
 * to receive notifications when it occurs — either on every new instance,
 * when frequency spikes statistically, or as a periodic digest.
 *
 * Subscriptions are org-scoped (INV-02). The `patternKey` is the cluster
 * id from the clustering service; we store it as opaque text since the
 * clustering service doesn't expose a stable schema-level type for it.
 */
import { z } from "zod";

export const PATTERN_TRIGGER_KINDS = ["new_instance", "sigma_2", "daily_digest", "weekly_digest"] as const;
export type PatternTriggerKind = (typeof PATTERN_TRIGGER_KINDS)[number];

export const insertPatternSubscriptionSchema = z.object({
  orgId: z.string(),
  patternKey: z.string().min(1).max(255),
  /** Optional display label captured at subscribe time (cluster labels can
      change as clustering re-runs; we snapshot the friendly name here so
      digest emails make sense even if the pattern's label drifts later). */
  patternLabel: z.string().max(500).optional(),
  triggerKind: z.enum(PATTERN_TRIGGER_KINDS),
  /** ISO timestamp when the subscription auto-expires. null = never. */
  expiresAt: z.string().nullable().optional(),
  /** User id of the manager who created the subscription. */
  createdBy: z.string().optional(),
});

export const patternSubscriptionSchema = insertPatternSubscriptionSchema.extend({
  id: z.string(),
  createdAt: z.string().optional(),
});

export type InsertPatternSubscription = z.infer<typeof insertPatternSubscriptionSchema>;
export type PatternSubscription = z.infer<typeof patternSubscriptionSchema>;
