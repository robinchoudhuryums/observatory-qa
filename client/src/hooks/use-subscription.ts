import { useQuery } from "@tanstack/react-query";
import { PLAN_DEFINITIONS, type PlanTier, type PlanLimits } from "@shared/schema";
import { getQueryFn } from "@/lib/queryClient";

interface SubscriptionResponse {
  subscription: { planTier: PlanTier; status: string };
  plan: { name: string; limits: PlanLimits };
  usage: { callsThisMonth: number; aiAnalysesThisMonth: number; storageMbUsed: number };
}

/**
 * Returns the current org's subscription tier and computed plan limits.
 * Caches for 60 seconds — plan changes are infrequent.
 * Falls back gracefully to "free" limits when unauthenticated or loading.
 */
export function useSubscription() {
  const { data, isLoading } = useQuery<SubscriptionResponse>({
    queryKey: ["/api/billing/subscription"],
    staleTime: 60 * 1000,
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  const planTier = (data?.subscription?.planTier ?? "free") as PlanTier;
  const planLimits: PlanLimits = PLAN_DEFINITIONS[planTier]?.limits ?? PLAN_DEFINITIONS.free.limits;

  return {
    subscription: data?.subscription,
    plan: data?.plan,
    usage: data?.usage,
    planTier,
    planLimits,
    isLoading,
    /** True if the subscription is active or in trial */
    isActive: data?.subscription?.status === "active" || data?.subscription?.status === "trialing",
    isFree: planTier === "free",
    isStarter: planTier === "starter",
    isProfessional: planTier === "professional",
    isEnterprise: planTier === "enterprise",
    hasClinicalDocs: planLimits.clinicalDocumentationEnabled,
    hasPrioritySupport: planLimits.prioritySupport,
    hasRag: planLimits.ragEnabled,
    hasAbTesting: planLimits.abTestingEnabled,
    hasSimulatedCalls: planLimits.simulatedCallsEnabled,
    hasSso: planLimits.ssoEnabled,
    hasCustomTemplates: planLimits.customPromptTemplates,
  };
}
