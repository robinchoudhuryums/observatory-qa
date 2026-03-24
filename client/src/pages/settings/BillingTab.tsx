import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { PLAN_DEFINITIONS, type PlanTier } from "@shared/schema";
import {  RiShieldLine, RiCheckLine, RiArrowRightUpLine, RiFlashlightLine, RiBankCardLine, RiExternalLinkLine, RiSaveLine, RiHistoryLine  } from "@remixicon/react";

interface SubscriptionInfo {
  subscription: {
    planTier: PlanTier;
    status: string;
    billingInterval: string;
    cancelAtPeriodEnd?: boolean;
    currentPeriodEnd?: string;
    stripeCustomerId?: string;
  };
  plan: {
    name: string;
    description: string;
    monthlyPriceUsd: number;
    yearlyPriceUsd: number;
    limits: Record<string, number | boolean>;
  };
  usage: {
    callsThisMonth: number;
    aiAnalysesThisMonth: number;
    apiCallsThisMonth: number;
    storageMbUsed: number;
  };
  stripeConfigured: boolean;
}

export default function BillingTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: subInfo, isLoading } = useQuery<SubscriptionInfo>({
    queryKey: ["/api/billing/subscription"],
  });

  const { data: plans } = useQuery<Array<{
    tier: PlanTier; name: string; description: string;
    monthlyPriceUsd: number; yearlyPriceUsd: number;
    limits: Record<string, number | boolean>;
    stripeConfigured: boolean;
  }>>({
    queryKey: ["/api/billing/plans"],
  });

  const { data: usageHistory } = useQuery<Array<{ month: string; usage: Record<string, number> }>>({
    queryKey: ["/api/billing/usage"],
  });

  const [billingInterval, setBillingInterval] = useState<"monthly" | "yearly">("monthly");

  const checkoutMutation = useMutation({
    mutationFn: async ({ tier, interval }: { tier: string; interval: string }) => {
      const res = await apiRequest("POST", "/api/billing/checkout", { tier, interval });
      return res.json() as Promise<{ url: string }>;
    },
    onSuccess: (data) => {
      window.location.href = data.url;
    },
    onError: (error) => {
      toast({ title: "Failed", description: error.message, variant: "destructive" });
    },
  });

  const portalMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/billing/portal");
      return res.json() as Promise<{ url: string }>;
    },
    onSuccess: (data) => {
      window.location.href = data.url;
    },
    onError: (error) => {
      toast({ title: "Failed", description: error.message, variant: "destructive" });
    },
  });

  const downgradeMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/billing/downgrade");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/billing/subscription"] });
      toast({ title: "Plan updated" });
    },
  });

  if (isLoading) {
    return <div className="space-y-4">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-32 w-full" />)}</div>;
  }

  const currentTier = subInfo?.subscription?.planTier || "free";
  const currentPlan = PLAN_DEFINITIONS[currentTier];
  const usage = subInfo?.usage || { callsThisMonth: 0, aiAnalysesThisMonth: 0, apiCallsThisMonth: 0, storageMbUsed: 0 };

  return (
    <div className="space-y-6">
      {/* Current Plan */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <RiBankCardLine className="w-5 h-5 text-primary" />
                Current Plan: {currentPlan.name}
              </CardTitle>
              <CardDescription>{currentPlan.description}</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Badge className={
                subInfo?.subscription?.status === "active"
                  ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                  : subInfo?.subscription?.status === "past_due"
                    ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400"
                    : "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400"
              }>
                {subInfo?.subscription?.status || "active"}
              </Badge>
              {subInfo?.subscription?.cancelAtPeriodEnd && (
                <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">
                  Cancels {subInfo.subscription.currentPeriodEnd ? new Date(subInfo.subscription.currentPeriodEnd).toLocaleDateString() : "soon"}
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Usage Meters */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <UsageMeter
              label="Calls"
              used={usage.callsThisMonth}
              limit={currentPlan.limits.callsPerMonth}
              icon={<RiArrowRightUpLine className="w-4 h-4" />}
            />
            <UsageMeter
              label="AI Analyses"
              used={usage.aiAnalysesThisMonth}
              limit={currentPlan.limits.aiAnalysesPerMonth}
              icon={<RiFlashlightLine className="w-4 h-4" />}
            />
            <UsageMeter
              label="API Calls"
              used={usage.apiCallsThisMonth}
              limit={currentPlan.limits.apiCallsPerMonth}
              icon={<RiArrowRightUpLine className="w-4 h-4" />}
            />
            <UsageMeter
              label="Storage (MB)"
              used={Math.round(usage.storageMbUsed)}
              limit={currentPlan.limits.storageMb}
              icon={<RiShieldLine className="w-4 h-4" />}
            />
          </div>

          {/* Manage buttons */}
          <div className="flex gap-2">
            {subInfo?.subscription?.stripeCustomerId && (
              <Button variant="outline" size="sm" onClick={() => portalMutation.mutate()} disabled={portalMutation.isPending}>
                <RiExternalLinkLine className="w-4 h-4 mr-2" />
                {portalMutation.isPending ? "Opening..." : "Manage in Stripe"}
              </Button>
            )}
            {currentTier !== "free" && (
              <Button
                variant="ghost"
                size="sm"
                className="text-red-600"
                onClick={() => {
                  const lostFeatures: string[] = [];
                  if (currentPlan.limits.customPromptTemplates) lostFeatures.push("Custom prompt templates");
                  if (currentPlan.limits.ragEnabled) lostFeatures.push("Knowledge base (RAG)");
                  if (currentPlan.limits.ssoEnabled) lostFeatures.push("SSO/SAML");
                  if (currentPlan.limits.clinicalDocumentationEnabled) lostFeatures.push("Clinical documentation");
                  if (currentPlan.limits.prioritySupport) lostFeatures.push("Priority support");
                  const callWarning = usage.callsThisMonth > 50 ? `\n\nWarning: You've used ${usage.callsThisMonth} calls this month. Free plan allows 50.` : "";
                  const msg = `Downgrade to the free plan?\n\nYou'll lose access to:\n${lostFeatures.map(f => `  - ${f}`).join("\n")}${callWarning}\n\nChanges take effect at the end of your billing period.`;
                  if (confirm(msg)) {
                    downgradeMutation.mutate();
                  }
                }}
              >
                Downgrade to Free
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Plan Comparison */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Plans</CardTitle>
          <div className="flex gap-2 mt-2">
            <Button
              variant={billingInterval === "monthly" ? "default" : "outline"}
              size="sm"
              onClick={() => setBillingInterval("monthly")}
            >
              Monthly
            </Button>
            <Button
              variant={billingInterval === "yearly" ? "default" : "outline"}
              size="sm"
              onClick={() => setBillingInterval("yearly")}
            >
              Yearly
              <Badge className="ml-2 bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 text-xs">Save 20%</Badge>
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-2">Annual plans billed at full year price upfront</p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {(plans || Object.entries(PLAN_DEFINITIONS).map(([tier, def]) => ({ tier: tier as PlanTier, ...def, stripeConfigured: false }))).map((plan) => {
              const isCurrent = plan.tier === currentTier;
              const price = billingInterval === "monthly" ? plan.monthlyPriceUsd : Math.round(plan.yearlyPriceUsd / 12);

              return (
                <div
                  key={plan.tier}
                  className={`rounded-lg border p-4 ${isCurrent ? "border-primary bg-primary/5" : "border-border"}`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-semibold text-foreground">{plan.name}</h3>
                    {isCurrent && <Badge>Current</Badge>}
                  </div>
                  <p className="text-2xl font-bold text-foreground mb-1">
                    {plan.tier === "enterprise" ? "Custom" : price === 0 ? "Free" : `$${price}`}
                    {plan.tier !== "enterprise" && price > 0 && <span className="text-sm font-normal text-muted-foreground">/mo</span>}
                  </p>
                  {plan.tier === "enterprise" ? (
                    <p className="text-xs text-muted-foreground mb-3">Pricing based on your needs</p>
                  ) : (billingInterval === "yearly" && price > 0 && (
                    <p className="text-xs text-muted-foreground mb-3">
                      ${plan.yearlyPriceUsd}/yr billed annually
                    </p>
                  ))}
                  <p className="text-sm text-muted-foreground mb-4">{plan.description}</p>

                  <ul className="space-y-2 text-sm mb-4">
                    <PlanFeature label={`${plan.limits.callsPerMonth === -1 ? "Unlimited" : plan.limits.callsPerMonth} calls/mo`} />
                    <PlanFeature label={`${plan.limits.aiAnalysesPerMonth === -1 ? "Unlimited" : plan.limits.aiAnalysesPerMonth} AI analyses/mo`} />
                    <PlanFeature label={`${plan.limits.maxUsers === -1 ? "Unlimited" : plan.limits.maxUsers} users`} />
                    <PlanFeature label={`${Number(plan.limits.storageMb) >= 100000 ? "100 GB" : Number(plan.limits.storageMb) >= 10000 ? "10 GB" : plan.limits.storageMb + " MB"} storage`} />
                    {plan.limits.customPromptTemplates && <PlanFeature label="Custom prompt templates" />}
                    {plan.limits.ragEnabled && <PlanFeature label="Knowledge base (RAG)" />}
                    {plan.limits.clinicalDocumentationEnabled && <PlanFeature label="Clinical documentation" />}
                    {plan.limits.ssoEnabled && <PlanFeature label="SSO / SAML" />}
                    {plan.limits.prioritySupport && <PlanFeature label="Priority support" />}
                    {(plan.limits.baseSeats as number) > 0 && (
                      <PlanFeature label={`${plan.limits.baseSeats} seats included`} />
                    )}
                    {(plan.limits.pricePerAdditionalSeatUsd as number) > 0 && (
                      <PlanFeature label={`+$${plan.limits.pricePerAdditionalSeatUsd}/seat/mo`} />
                    )}
                    {(plan.limits.overagePricePerCallUsd as number) > 0 && (
                      <PlanFeature label={`$${plan.limits.overagePricePerCallUsd}/call over quota`} />
                    )}
                  </ul>

                  {!isCurrent && plan.tier === "enterprise" && (
                    <Button className="w-full" size="sm" variant="outline" asChild>
                      <a href="mailto:sales@observatory-qa.com">
                        Contact Sales
                      </a>
                    </Button>
                  )}
                  {!isCurrent && plan.tier !== "free" && plan.tier !== "enterprise" && (
                    <Button
                      className="w-full"
                      size="sm"
                      disabled={checkoutMutation.isPending || !subInfo?.stripeConfigured}
                      onClick={() => checkoutMutation.mutate({ tier: plan.tier, interval: billingInterval })}
                    >
                      {checkoutMutation.isPending ? "Redirecting..." : `Upgrade to ${plan.name}`}
                    </Button>
                  )}
                  {!isCurrent && plan.tier === "free" && currentTier !== "free" && (
                    <Button
                      variant="outline"
                      className="w-full"
                      size="sm"
                      onClick={() => {
                        if (confirm("Downgrade to free?")) downgradeMutation.mutate();
                      }}
                    >
                      Downgrade
                    </Button>
                  )}
                  {!subInfo?.stripeConfigured && !["free", "enterprise"].includes(plan.tier) && !isCurrent && (
                    <p className="text-xs text-muted-foreground mt-2 text-center">
                      Stripe not configured
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Usage History */}
      {usageHistory && usageHistory.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <RiArrowRightUpLine className="w-5 h-5 text-primary" />
              Usage History
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 text-muted-foreground font-medium">Month</th>
                    <th className="text-right py-2 text-muted-foreground font-medium">Calls</th>
                    <th className="text-right py-2 text-muted-foreground font-medium">AI Analyses</th>
                    <th className="text-right py-2 text-muted-foreground font-medium">API Calls</th>
                    <th className="text-right py-2 text-muted-foreground font-medium">Storage (MB)</th>
                  </tr>
                </thead>
                <tbody>
                  {usageHistory.map((row) => (
                    <tr key={row.month} className="border-b border-border/50">
                      <td className="py-2 font-medium text-foreground">{row.month}</td>
                      <td className="py-2 text-right text-foreground">{row.usage.transcription || 0}</td>
                      <td className="py-2 text-right text-foreground">{row.usage.ai_analysis || 0}</td>
                      <td className="py-2 text-right text-foreground">{row.usage.api_call || 0}</td>
                      <td className="py-2 text-right text-foreground">{Math.round(row.usage.storage_mb || 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function UsageMeter({ label, used, limit, icon }: { label: string; used: number; limit: number; icon: React.ReactNode }) {
  const isUnlimited = limit === -1;
  const percentage = isUnlimited ? 0 : Math.min((used / limit) * 100, 100);
  const isNearLimit = !isUnlimited && percentage >= 80;
  const isOverLimit = !isUnlimited && percentage >= 100;

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-center gap-2 text-muted-foreground mb-1">
        {icon}
        <span className="text-xs font-medium">{label}</span>
      </div>
      <p className={`text-lg font-bold ${isOverLimit ? "text-red-600" : isNearLimit ? "text-amber-600" : "text-foreground"}`}>
        {used.toLocaleString()}
        <span className="text-xs font-normal text-muted-foreground">
          {isUnlimited ? " / unlimited" : ` / ${limit.toLocaleString()}`}
        </span>
      </p>
      {!isUnlimited && (
        <div className="w-full bg-muted rounded-full h-1.5 mt-2">
          <div
            className={`h-1.5 rounded-full transition-all ${isOverLimit ? "bg-red-500" : isNearLimit ? "bg-amber-500" : "bg-primary"}`}
            style={{ width: `${Math.min(percentage, 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}

function PlanFeature({ label }: { label: string }) {
  return (
    <li className="flex items-center gap-2 text-foreground">
      <RiCheckLine className="w-4 h-4 text-green-600 shrink-0" />
      {label}
    </li>
  );
}
