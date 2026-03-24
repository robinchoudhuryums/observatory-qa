import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { PLAN_DEFINITIONS, type PlanTier } from "@shared/schema";
import {
  RiShieldLine, RiCheckLine, RiArrowRightUpLine, RiFlashlightLine,
  RiBankCardLine, RiExternalLinkLine, RiAlertLine, RiTimeLine,
  RiGiftLine, RiBellLine,
} from "@remixicon/react";

interface SubscriptionInfo {
  subscription: {
    planTier: PlanTier;
    status: string;
    billingInterval: string;
    cancelAtPeriodEnd?: boolean;
    currentPeriodEnd?: string;
    stripeCustomerId?: string;
    stripeSubscriptionId?: string;
    pastDueAt?: string;
  };
  plan: {
    name: string;
    description: string;
    monthlyPriceUsd: number;
    yearlyPriceUsd: number;
    trialDays?: number;
    limits: Record<string, number | boolean>;
  };
  usage: {
    callsThisMonth: number;
    aiAnalysesThisMonth: number;
    apiCallsThisMonth: number;
    storageMbUsed: number;
  };
  forecast: {
    projectedCallsEom: number;
    daysUntilCallQuotaExceeded: number | null;
    daysRemaining: number;
  };
  gracePeriodDaysLeft: number | null;
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
    monthlyPriceUsd: number; yearlyPriceUsd: number; trialDays?: number;
    limits: Record<string, number | boolean>;
    stripeConfigured: boolean;
  }>>({
    queryKey: ["/api/billing/plans"],
  });

  const { data: usageHistory } = useQuery<Array<{ month: string; usage: Record<string, number> }>>({
    queryKey: ["/api/billing/usage"],
  });

  const [billingInterval, setBillingInterval] = useState<"monthly" | "yearly">("monthly");

  // Billing alert form state
  const [alertEnabled, setAlertEnabled] = useState<boolean | null>(null);
  const [alertThreshold, setAlertThreshold] = useState<string>("");
  const [alertEmail, setAlertEmail] = useState<string>("");

  const checkoutMutation = useMutation({
    mutationFn: async ({ tier, interval }: { tier: string; interval: string }) => {
      const res = await apiRequest("POST", "/api/billing/checkout", { tier, interval });
      return res.json() as Promise<{ url: string }>;
    },
    onSuccess: (data) => { window.location.href = data.url; },
    onError: (error) => { toast({ title: "Failed", description: error.message, variant: "destructive" }); },
  });

  // Mid-cycle upgrade for existing Stripe subscribers
  const upgradeMutation = useMutation({
    mutationFn: async ({ tier, interval }: { tier: string; interval: string }) => {
      const res = await apiRequest("POST", "/api/billing/upgrade", { tier, interval });
      const body = await res.json() as { success?: boolean; url?: string; message?: string };
      if (!res.ok) throw new Error(body.message || "Upgrade failed");
      return body;
    },
    onSuccess: (data) => {
      if ("url" in data && data.url) {
        window.location.href = data.url as string;
      } else {
        queryClient.invalidateQueries({ queryKey: ["/api/billing/subscription"] });
        toast({ title: "Plan upgraded", description: "Prorated charge applied to your next invoice." });
      }
    },
    onError: (error) => { toast({ title: "Upgrade failed", description: error.message, variant: "destructive" }); },
  });

  const portalMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/billing/portal");
      return res.json() as Promise<{ url: string }>;
    },
    onSuccess: (data) => { window.location.href = data.url; },
    onError: (error) => { toast({ title: "Failed", description: error.message, variant: "destructive" }); },
  });

  const downgradeMutation = useMutation({
    mutationFn: async () => { await apiRequest("POST", "/api/billing/downgrade"); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/billing/subscription"] });
      toast({ title: "Plan updated" });
    },
  });

  const alertsMutation = useMutation({
    mutationFn: async (body: { enabled: boolean; quotaThresholdPct: number; alertEmail?: string }) => {
      const res = await apiRequest("PATCH", "/api/billing/alerts", body);
      if (!res.ok) throw new Error("Failed to save");
    },
    onSuccess: () => { toast({ title: "Alert settings saved" }); },
    onError: () => { toast({ title: "Failed to save alert settings", variant: "destructive" }); },
  });

  if (isLoading) {
    return <div className="space-y-4">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-32 w-full" />)}</div>;
  }

  const currentTier = subInfo?.subscription?.planTier || "free";
  const currentPlan = PLAN_DEFINITIONS[currentTier];
  const usage = subInfo?.usage || { callsThisMonth: 0, aiAnalysesThisMonth: 0, apiCallsThisMonth: 0, storageMbUsed: 0 };
  const forecast = subInfo?.forecast;
  const status = subInfo?.subscription?.status;
  const isTrialing = status === "trialing";
  const isPastDue = status === "past_due";
  const hasActiveStripeSub = !!subInfo?.subscription?.stripeSubscriptionId && (status === "active" || status === "trialing");

  // Determine upgrade action: mid-cycle update vs. new checkout
  function handleUpgrade(tier: string) {
    if (hasActiveStripeSub) {
      if (confirm(`Upgrade to ${tier} now? Stripe will apply prorated charges to your next invoice.`)) {
        upgradeMutation.mutate({ tier, interval: billingInterval });
      }
    } else {
      checkoutMutation.mutate({ tier, interval: billingInterval });
    }
  }

  const trialEndDate = isTrialing && subInfo?.subscription?.currentPeriodEnd
    ? new Date(subInfo.subscription.currentPeriodEnd)
    : null;
  const trialDaysLeft = trialEndDate
    ? Math.max(0, Math.ceil((trialEndDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : null;

  return (
    <div className="space-y-6">
      {/* ── Dunning banner: past_due with grace period countdown ── */}
      {isPastDue && (
        <div className="flex items-start gap-3 p-4 rounded-lg border border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/30">
          <RiAlertLine className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-red-800 dark:text-red-300">Payment failed — action required</p>
            <p className="text-sm text-red-700 dark:text-red-400 mt-0.5">
              {subInfo?.gracePeriodDaysLeft != null && subInfo.gracePeriodDaysLeft > 0
                ? `Your account is in a ${subInfo.gracePeriodDaysLeft}-day grace period. Update your payment method to avoid losing access.`
                : "Your grace period has expired. Uploads and edits are blocked until payment is resolved."}
            </p>
          </div>
          {subInfo?.subscription?.stripeCustomerId && (
            <Button size="sm" variant="destructive" onClick={() => portalMutation.mutate()} disabled={portalMutation.isPending}>
              Update Payment
            </Button>
          )}
        </div>
      )}

      {/* ── Trial banner ── */}
      {isTrialing && trialDaysLeft !== null && (
        <div className="flex items-start gap-3 p-4 rounded-lg border border-indigo-300 bg-indigo-50 dark:border-indigo-800 dark:bg-indigo-950/30">
          <RiGiftLine className="w-5 h-5 text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-indigo-800 dark:text-indigo-300">
              Free trial — {trialDaysLeft} day{trialDaysLeft !== 1 ? "s" : ""} remaining
            </p>
            <p className="text-sm text-indigo-700 dark:text-indigo-400 mt-0.5">
              {trialEndDate && `Trial ends ${trialEndDate.toLocaleDateString("en-US", { month: "long", day: "numeric" })}. `}
              Add a payment method now — you won't be charged until the trial ends.
            </p>
          </div>
          {subInfo?.subscription?.stripeCustomerId && (
            <Button size="sm" variant="outline" className="border-indigo-400 text-indigo-700" onClick={() => portalMutation.mutate()} disabled={portalMutation.isPending}>
              Add Payment Method
            </Button>
          )}
        </div>
      )}

      {/* ── Current Plan ── */}
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
                isTrialing
                  ? "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400"
                  : isPastDue
                    ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
                    : status === "active"
                      ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                      : "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400"
              }>
                {isTrialing ? "Trialing" : status || "active"}
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
          {/* Usage Meters with forecast */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <UsageMeter
              label="Calls"
              used={usage.callsThisMonth}
              limit={currentPlan.limits.callsPerMonth as number}
              projected={forecast?.projectedCallsEom}
              icon={<RiArrowRightUpLine className="w-4 h-4" />}
            />
            <UsageMeter
              label="AI Analyses"
              used={usage.aiAnalysesThisMonth}
              limit={currentPlan.limits.aiAnalysesPerMonth as number}
              icon={<RiFlashlightLine className="w-4 h-4" />}
            />
            <UsageMeter
              label="API Calls"
              used={usage.apiCallsThisMonth}
              limit={currentPlan.limits.apiCallsPerMonth as number}
              icon={<RiArrowRightUpLine className="w-4 h-4" />}
            />
            <UsageMeter
              label="Storage (MB)"
              used={Math.round(usage.storageMbUsed)}
              limit={currentPlan.limits.storageMb as number}
              icon={<RiShieldLine className="w-4 h-4" />}
            />
          </div>

          {/* Quota forecast warning */}
          {forecast?.daysUntilCallQuotaExceeded != null && forecast.daysUntilCallQuotaExceeded <= 7 && (
            <div className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 rounded-md p-2 mb-4">
              <RiTimeLine className="w-4 h-4 shrink-0" />
              {forecast.daysUntilCallQuotaExceeded === 0
                ? "At your current rate, you'll exceed your call quota today."
                : `At your current rate, you'll exceed your call quota in ~${forecast.daysUntilCallQuotaExceeded} day${forecast.daysUntilCallQuotaExceeded !== 1 ? "s" : ""}.`}
              {" "}Consider upgrading to avoid disruptions.
            </div>
          )}

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
                  if (confirm(msg)) { downgradeMutation.mutate(); }
                }}
              >
                Downgrade to Free
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Plan Comparison ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Plans</CardTitle>
          <div className="flex gap-2 mt-2">
            <Button variant={billingInterval === "monthly" ? "default" : "outline"} size="sm" onClick={() => setBillingInterval("monthly")}>Monthly</Button>
            <Button variant={billingInterval === "yearly" ? "default" : "outline"} size="sm" onClick={() => setBillingInterval("yearly")}>
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
              const hasTrial = (plan as any).trialDays && !hasActiveStripeSub;

              return (
                <div key={plan.tier} className={`rounded-lg border p-4 ${isCurrent ? "border-primary bg-primary/5" : "border-border"}`}>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-semibold text-foreground">{plan.name}</h3>
                    <div className="flex items-center gap-1">
                      {isCurrent && <Badge>Current</Badge>}
                      {hasTrial && !isCurrent && (
                        <Badge className="bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400 text-xs">
                          {(plan as any).trialDays}-day trial
                        </Badge>
                      )}
                    </div>
                  </div>
                  <p className="text-2xl font-bold text-foreground mb-1">
                    {plan.tier === "enterprise" ? "Custom" : price === 0 ? "Free" : `$${price}`}
                    {plan.tier !== "enterprise" && price > 0 && <span className="text-sm font-normal text-muted-foreground">/mo</span>}
                  </p>
                  {plan.tier === "enterprise" ? (
                    <p className="text-xs text-muted-foreground mb-3">Pricing based on your needs</p>
                  ) : (billingInterval === "yearly" && price > 0 && (
                    <p className="text-xs text-muted-foreground mb-3">${plan.yearlyPriceUsd}/yr billed annually</p>
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
                    {(plan.limits.baseSeats as number) > 0 && <PlanFeature label={`${plan.limits.baseSeats} seats included`} />}
                    {(plan.limits.pricePerAdditionalSeatUsd as number) > 0 && <PlanFeature label={`+$${plan.limits.pricePerAdditionalSeatUsd}/seat/mo`} />}
                    {(plan.limits.overagePricePerCallUsd as number) > 0 && <PlanFeature label={`$${plan.limits.overagePricePerCallUsd}/call over quota`} />}
                  </ul>

                  {!isCurrent && plan.tier === "enterprise" && (
                    <Button className="w-full" size="sm" variant="outline" asChild>
                      <a href="mailto:sales@observatory-qa.com">Contact Sales</a>
                    </Button>
                  )}
                  {!isCurrent && plan.tier !== "free" && plan.tier !== "enterprise" && (
                    <Button
                      className="w-full"
                      size="sm"
                      disabled={(checkoutMutation.isPending || upgradeMutation.isPending) || !subInfo?.stripeConfigured}
                      onClick={() => handleUpgrade(plan.tier)}
                    >
                      {checkoutMutation.isPending || upgradeMutation.isPending
                        ? "Processing..."
                        : hasTrial
                          ? `Start ${(plan as any).trialDays}-Day Free Trial`
                          : hasActiveStripeSub
                            ? `Upgrade to ${plan.name}`
                            : `Subscribe to ${plan.name}`}
                    </Button>
                  )}
                  {!isCurrent && plan.tier === "free" && currentTier !== "free" && (
                    <Button variant="outline" className="w-full" size="sm"
                      onClick={() => { if (confirm("Downgrade to free?")) downgradeMutation.mutate(); }}>
                      Downgrade
                    </Button>
                  )}
                  {!subInfo?.stripeConfigured && !["free", "enterprise"].includes(plan.tier) && !isCurrent && (
                    <p className="text-xs text-muted-foreground mt-2 text-center">Stripe not configured</p>
                  )}
                </div>
              );
            })}
          </div>
          {hasActiveStripeSub && (
            <p className="text-xs text-muted-foreground mt-3">
              Upgrades apply immediately with prorated charges on your next invoice. Downgrades take effect at period end.
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── Spend Alerts ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <RiBellLine className="w-5 h-5 text-primary" />
            Spend Alerts
          </CardTitle>
          <CardDescription>
            Get an email when your call usage approaches the plan limit.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SpendAlertsForm
            initialEnabled={alertEnabled}
            initialThreshold={alertThreshold}
            initialEmail={alertEmail}
            onSave={(enabled, threshold, email) => {
              setAlertEnabled(enabled);
              setAlertThreshold(threshold);
              setAlertEmail(email);
              alertsMutation.mutate({
                enabled,
                quotaThresholdPct: threshold ? parseInt(threshold, 10) : 80,
                alertEmail: email || undefined,
              });
            }}
            isSaving={alertsMutation.isPending}
          />
        </CardContent>
      </Card>

      {/* ── Usage History ── */}
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

// ── Sub-components ──────────────────────────────────────────────────────────

function UsageMeter({
  label, used, limit, projected, icon,
}: {
  label: string; used: number; limit: number; projected?: number; icon: React.ReactNode;
}) {
  const isUnlimited = limit === -1;
  const percentage = isUnlimited ? 0 : Math.min((used / limit) * 100, 100);
  const projectedPct = (!isUnlimited && projected != null) ? Math.min((projected / limit) * 100, 120) : null;
  const isNearLimit = !isUnlimited && percentage >= 80;
  const isOverLimit = !isUnlimited && percentage >= 100;
  const willExceed = !isUnlimited && projectedPct != null && projectedPct > 100 && !isOverLimit;

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
        <div className="w-full bg-muted rounded-full h-1.5 mt-2 relative overflow-hidden">
          <div
            className={`h-1.5 rounded-full transition-all ${isOverLimit ? "bg-red-500" : isNearLimit ? "bg-amber-500" : "bg-primary"}`}
            style={{ width: `${Math.min(percentage, 100)}%` }}
          />
          {projectedPct != null && projectedPct > percentage && (
            <div
              className="absolute top-0 h-1.5 rounded-full opacity-30 bg-amber-400"
              style={{ left: `${Math.min(percentage, 100)}%`, width: `${Math.min(projectedPct - percentage, 100 - percentage)}%` }}
            />
          )}
        </div>
      )}
      {willExceed && projected != null && (
        <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
          Projected: {projected.toLocaleString()} by month end
        </p>
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

function SpendAlertsForm({
  initialEnabled, initialThreshold, initialEmail, onSave, isSaving,
}: {
  initialEnabled: boolean | null;
  initialThreshold: string;
  initialEmail: string;
  onSave: (enabled: boolean, threshold: string, email: string) => void;
  isSaving: boolean;
}) {
  const [enabled, setEnabled] = useState(initialEnabled ?? false);
  const [threshold, setThreshold] = useState(initialThreshold || "80");
  const [email, setEmail] = useState(initialEmail || "");

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Switch id="alerts-enabled" checked={enabled} onCheckedChange={setEnabled} />
        <Label htmlFor="alerts-enabled">Enable quota alerts</Label>
      </div>
      {enabled && (
        <div className="space-y-3 pl-1">
          <div className="flex items-center gap-3">
            <Label className="w-40 text-sm text-muted-foreground">Alert at (%)</Label>
            <Input
              type="number"
              min={50}
              max={100}
              value={threshold}
              onChange={e => setThreshold(e.target.value)}
              className="w-24"
              placeholder="80"
            />
            <span className="text-xs text-muted-foreground">of monthly call quota</span>
          </div>
          <div className="flex items-center gap-3">
            <Label className="w-40 text-sm text-muted-foreground">Notify email</Label>
            <Input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-64"
              placeholder="admin@your-org.com (defaults to your account email)"
            />
          </div>
        </div>
      )}
      <Button size="sm" onClick={() => onSave(enabled, threshold, email)} disabled={isSaving}>
        {isSaving ? "Saving..." : "Save alert settings"}
      </Button>
    </div>
  );
}
