import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { safeStorage } from "@/lib/utils";
import type { Organization } from "@shared/schema";
import {
  RiSettings3Line,
  RiSaveLine,
  RiNotification3Line,
  RiLockLine,
  RiInformationLine,
  RiCheckLine,
} from "@remixicon/react";

export default function OrganizationTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: org, isLoading } = useQuery<Organization>({ queryKey: ["/api/organization"] });

  const [emailDomain, setEmailDomain] = useState("");
  const [retentionDays, setRetentionDays] = useState("90");
  const [departments, setDepartments] = useState("");
  const [callCategories, setCallCategories] = useState("");
  const [maxCallsPerDay, setMaxCallsPerDay] = useState("");
  const [maxStorageMb, setMaxStorageMb] = useState("");
  // Webhook config
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookPlatform, setWebhookPlatform] = useState<"slack" | "teams">("slack");
  const [webhookEvents, setWebhookEvents] = useState("");
  // SSO config
  const [ssoProvider, setSsoProvider] = useState<"saml" | "oidc" | "">();
  const [ssoEntityId, setSsoEntityId] = useState("");
  const [ssoSignOnUrl, setSsoSignOnUrl] = useState("");
  const [ssoCertificate, setSsoCertificate] = useState("");
  const [ssoEnforced, setSsoEnforced] = useState(false);
  const [initialized, setInitialized] = useState(false);

  // RiCheckLine plan for SSO eligibility
  const { data: subscription } = useQuery<{ planTier?: string }>({ queryKey: ["/api/billing/subscription"] });
  const isEnterprise = subscription?.planTier === "enterprise";

  if (org && !initialized) {
    setEmailDomain(org.settings?.emailDomain || "");
    setRetentionDays(String(org.settings?.retentionDays ?? 90));
    setDepartments((org.settings?.departments || []).join(", "));
    setCallCategories((org.settings?.callCategories || []).join(", "));
    setMaxCallsPerDay(org.settings?.maxCallsPerDay ? String(org.settings.maxCallsPerDay) : "");
    setMaxStorageMb(org.settings?.maxStorageMb ? String(org.settings.maxStorageMb) : "");
    setWebhookUrl(org.settings?.webhookUrl || "");
    setWebhookPlatform(org.settings?.webhookPlatform || "slack");
    setWebhookEvents((org.settings?.webhookEvents || []).join(", "));
    setSsoProvider(org.settings?.ssoProvider || "");
    setSsoEntityId(org.settings?.ssoEntityId || "");
    setSsoSignOnUrl(org.settings?.ssoSignOnUrl || "");
    setSsoCertificate(org.settings?.ssoCertificate || "");
    setSsoEnforced(org.settings?.ssoEnforced || false);
    setInitialized(true);
  }

  const mutation = useMutation({
    mutationFn: async (settings: Record<string, unknown>) => {
      const res = await apiRequest("PATCH", "/api/organization/settings", settings);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/organization"] });
      toast({ title: "Settings Saved" });
    },
    onError: (error) => {
      toast({ title: "Save Failed", description: error.message, variant: "destructive" });
    },
  });

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const parsedDepartments = departments
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const parsedCategories = callCategories
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const parsedEvents = webhookEvents
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    mutation.mutate({
      emailDomain: emailDomain.trim() || undefined,
      retentionDays: parseInt(retentionDays) || 90,
      departments: parsedDepartments.length > 0 ? parsedDepartments : undefined,
      callCategories: parsedCategories.length > 0 ? parsedCategories : undefined,
      maxCallsPerDay: maxCallsPerDay ? parseInt(maxCallsPerDay) : undefined,
      maxStorageMb: maxStorageMb ? parseInt(maxStorageMb) : undefined,
      webhookUrl: webhookUrl.trim() || undefined,
      webhookPlatform: webhookPlatform,
      webhookEvents: parsedEvents.length > 0 ? parsedEvents : undefined,
      ...(isEnterprise
        ? {
            ssoProvider: ssoProvider || undefined,
            ssoEntityId: ssoEntityId.trim() || undefined,
            ssoSignOnUrl: ssoSignOnUrl.trim() || undefined,
            ssoCertificate: ssoCertificate.trim() || undefined,
            ssoEnforced,
          }
        : {}),
    });
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <Skeleton className="h-40 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <RiSettings3Line className="w-5 h-5 text-primary" />
            Organization Configuration
          </CardTitle>
          <CardDescription>
            Configure organization-wide settings. Current org: <strong>{org?.name}</strong> ({org?.slug})
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSave} className="space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-foreground" htmlFor="org-email-domain">
                  Email Domain
                </label>
                <Input
                  id="org-email-domain"
                  value={emailDomain}
                  onChange={(e) => setEmailDomain(e.target.value)}
                  placeholder="company.com"
                />
                <p className="text-xs text-muted-foreground mt-1">Used for user email validation.</p>
              </div>
              <div>
                <label className="text-sm font-medium text-foreground" htmlFor="org-retention-days">
                  Data Retention (days)
                </label>
                <Input
                  id="org-retention-days"
                  type="number"
                  value={retentionDays}
                  onChange={(e) => setRetentionDays(e.target.value)}
                  min={7}
                  max={365}
                />
                <p className="text-xs text-muted-foreground mt-1">Calls older than this are auto-purged.</p>
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-foreground" htmlFor="org-departments">
                Departments
              </label>
              <Input
                id="org-departments"
                value={departments}
                onChange={(e) => setDepartments(e.target.value)}
                placeholder="Sales, Support, Billing"
              />
              <p className="text-xs text-muted-foreground mt-1">Comma-separated list of department names.</p>
            </div>

            <div>
              <label className="text-sm font-medium text-foreground" htmlFor="org-call-categories">
                Call Categories
              </label>
              <Input
                id="org-call-categories"
                value={callCategories}
                onChange={(e) => setCallCategories(e.target.value)}
                placeholder="inbound, outbound, internal"
              />
              <p className="text-xs text-muted-foreground mt-1">Custom categories for organizing calls.</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-foreground" htmlFor="org-max-calls-per-day">
                  Max Calls / Day
                </label>
                <Input
                  id="org-max-calls-per-day"
                  type="number"
                  value={maxCallsPerDay}
                  onChange={(e) => setMaxCallsPerDay(e.target.value)}
                  placeholder="Unlimited"
                  min={1}
                />
                <p className="text-xs text-muted-foreground mt-1">Daily upload quota.</p>
              </div>
              <div>
                <label className="text-sm font-medium text-foreground" htmlFor="org-max-storage-mb">
                  Max Storage (MB)
                </label>
                <Input
                  id="org-max-storage-mb"
                  type="number"
                  value={maxStorageMb}
                  onChange={(e) => setMaxStorageMb(e.target.value)}
                  placeholder="Unlimited"
                  min={100}
                />
                <p className="text-xs text-muted-foreground mt-1">Total storage limit for audio files.</p>
              </div>
            </div>

            <Button type="submit" disabled={mutation.isPending}>
              <RiSaveLine className="w-4 h-4 mr-2" />
              {mutation.isPending ? "Saving..." : "Save Settings"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Webhook Configuration */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <RiNotification3Line className="w-5 h-5 text-primary" />
            Webhook Notifications
          </CardTitle>
          <CardDescription>
            Receive Slack or Teams notifications when calls are flagged. Overrides server-level defaults.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSave} className="space-y-4">
            <div>
              <label className="text-sm font-medium text-foreground" htmlFor="webhook-url">
                Webhook URL
              </label>
              <Input
                id="webhook-url"
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                placeholder="https://hooks.slack.com/services/..."
                type="url"
              />
              <p className="text-xs text-muted-foreground mt-1">Slack or Teams incoming webhook URL.</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-foreground" htmlFor="webhook-platform">
                  Platform
                </label>
                <Select value={webhookPlatform} onValueChange={(v) => setWebhookPlatform(v as "slack" | "teams")}>
                  <SelectTrigger id="webhook-platform">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="slack">Slack</SelectItem>
                    <SelectItem value="teams">Microsoft Teams</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium text-foreground" htmlFor="webhook-events">
                  Event Types
                </label>
                <Input
                  id="webhook-events"
                  value={webhookEvents}
                  onChange={(e) => setWebhookEvents(e.target.value)}
                  placeholder="low_score, agent_misconduct, exceptional_call"
                />
                <p className="text-xs text-muted-foreground mt-1">Comma-separated event types to notify on.</p>
              </div>
            </div>
            <Button type="submit" disabled={mutation.isPending}>
              <RiSaveLine className="w-4 h-4 mr-2" />
              {mutation.isPending ? "Saving..." : "Save Webhook Settings"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* SSO Configuration (Enterprise only) */}
      <Card className={!isEnterprise ? "opacity-60" : ""}>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <RiLockLine className="w-5 h-5 text-primary" />
            Single Sign-On (SSO)
            {!isEnterprise && (
              <Badge variant="secondary" className="ml-2">
                Enterprise
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            {isEnterprise
              ? "Configure SAML or OIDC single sign-on for your organization."
              : "SSO is available on the Enterprise plan. Upgrade to enable."}
          </CardDescription>
        </CardHeader>
        {isEnterprise && (
          <CardContent>
            <form onSubmit={handleSave} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-foreground" htmlFor="sso-provider">
                    SSO Provider
                  </label>
                  <Select value={ssoProvider || ""} onValueChange={(v) => setSsoProvider(v as "saml" | "oidc" | "")}>
                    <SelectTrigger id="sso-provider">
                      <SelectValue placeholder="Select provider..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="saml">SAML 2.0</SelectItem>
                      <SelectItem value="oidc">OpenID Connect (OIDC)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground" htmlFor="sso-entity-id">
                    Entity ID / Client ID
                  </label>
                  <Input
                    id="sso-entity-id"
                    value={ssoEntityId}
                    onChange={(e) => setSsoEntityId(e.target.value)}
                    placeholder="https://idp.example.com/entity"
                  />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium text-foreground" htmlFor="sso-sign-on-url">
                  Sign-On URL
                </label>
                <Input
                  id="sso-sign-on-url"
                  value={ssoSignOnUrl}
                  onChange={(e) => setSsoSignOnUrl(e.target.value)}
                  placeholder="https://idp.example.com/sso/saml"
                  type="url"
                />
                <p className="text-xs text-muted-foreground mt-1">IdP login URL for redirect-based authentication.</p>
              </div>
              <div>
                <label className="text-sm font-medium text-foreground" htmlFor="sso-certificate">
                  Certificate (PEM)
                </label>
                <Textarea
                  id="sso-certificate"
                  value={ssoCertificate}
                  onChange={(e) => setSsoCertificate(e.target.value)}
                  placeholder="-----BEGIN CERTIFICATE-----&#10;..."
                  rows={4}
                  className="font-mono text-xs"
                />
                <p className="text-xs text-muted-foreground mt-1">X.509 certificate for signature verification.</p>
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={ssoEnforced}
                    onChange={(e) => setSsoEnforced(e.target.checked)}
                    className="rounded border-border"
                  />
                  <span className="text-sm font-medium text-foreground">Enforce SSO</span>
                </label>
                <p className="text-xs text-muted-foreground">
                  When enabled, password login is disabled for all users. API keys still work.
                </p>
              </div>

              {/* SP Metadata for IDP configuration */}
              {org?.slug && (
                <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                  <h4 className="text-sm font-semibold text-foreground">Service Provider Details</h4>
                  <p className="text-xs text-muted-foreground">
                    Provide these to your Identity Provider (Okta, Azure AD, Google Workspace, etc.):
                  </p>
                  <div className="space-y-1.5">
                    <div>
                      <span className="text-xs font-medium text-muted-foreground">
                        ACS URL (Assertion Consumer Service):
                      </span>
                      <code className="block text-xs bg-background rounded px-2 py-1 mt-0.5 font-mono">{`${window.location.origin}/api/auth/sso/callback`}</code>
                    </div>
                    <div>
                      <span className="text-xs font-medium text-muted-foreground">SP Entity ID:</span>
                      <code className="block text-xs bg-background rounded px-2 py-1 mt-0.5 font-mono">{`${window.location.origin}/api/auth/sso/metadata/${org.slug}`}</code>
                    </div>
                    <div>
                      <span className="text-xs font-medium text-muted-foreground">SP Metadata URL:</span>
                      <code className="block text-xs bg-background rounded px-2 py-1 mt-0.5 font-mono">{`${window.location.origin}/api/auth/sso/metadata/${org.slug}`}</code>
                    </div>
                    <div>
                      <span className="text-xs font-medium text-muted-foreground">SSO Login URL (for users):</span>
                      <code className="block text-xs bg-background rounded px-2 py-1 mt-0.5 font-mono">{`${window.location.origin}/api/auth/sso/${org.slug}`}</code>
                    </div>
                  </div>
                </div>
              )}

              <Button type="submit" disabled={mutation.isPending}>
                <RiSaveLine className="w-4 h-4 mr-2" />
                {mutation.isPending ? "Saving..." : "Save SSO Settings"}
              </Button>
            </form>
          </CardContent>
        )}
      </Card>

      {/* Replay Onboarding Tour */}
      <Card>
        <CardContent className="pt-6 flex items-center justify-between">
          <div>
            <h4 className="text-sm font-semibold text-foreground">Onboarding Tour</h4>
            <p className="text-xs text-muted-foreground">Replay the guided tour to see key features and tips.</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              safeStorage.removeItem("observatory-tour-completed");
              window.location.href = "/dashboard";
            }}
          >
            Replay Tour
          </Button>
        </CardContent>
      </Card>

      {/* Org Info (read-only) */}
      <Card className="bg-muted/30 border-dashed">
        <CardContent className="pt-6">
          <h4 className="text-sm font-semibold text-foreground mb-2">Organization Info</h4>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Name</p>
              <p className="font-medium">{org?.name}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Slug</p>
              <p className="font-mono">{org?.slug}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Status</p>
              <Badge variant={org?.status === "active" ? "default" : "secondary"}>{org?.status}</Badge>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
