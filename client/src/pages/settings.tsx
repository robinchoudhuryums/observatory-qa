import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import BrandingTab from "./settings/BrandingTab";
import UsersTab from "./settings/UsersTab";
import InvitationsTab from "./settings/InvitationsTab";
import BillingTab from "./settings/BillingTab";
import ApiKeysTab from "./settings/ApiKeysTab";
import OrganizationTab from "./settings/OrganizationTab";
import {  RiPaletteLine, RiTeamLine, RiSettings3Line, RiMailLine, RiKeyLine, RiBankCardLine  } from "@remixicon/react";

type TabView = "branding" | "users" | "invitations" | "api-keys" | "billing" | "organization";

export default function SettingsPage() {
  const [tab, setTab] = useState<TabView>("branding");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [location] = useLocation();

  // Support ?tab=billing deep link (e.g. after Stripe checkout redirect)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get("tab");
    if (tabParam && ["branding", "users", "invitations", "api-keys", "billing", "organization"].includes(tabParam)) {
      setTab(tabParam as TabView);
    }

    // Handle checkout result
    const checkout = params.get("checkout");
    if (checkout === "success") {
      toast({ title: "Subscription activated", description: "Your plan has been upgraded. Features are now available." });
      queryClient.invalidateQueries({ queryKey: ["/api/billing/subscription"] });
      // Clean up URL
      params.delete("checkout");
      const cleanUrl = params.toString() ? `${window.location.pathname}?${params}` : window.location.pathname;
      window.history.replaceState({}, "", cleanUrl);
    } else if (checkout === "canceled") {
      toast({ title: "Checkout canceled", description: "No changes were made to your subscription.", variant: "destructive" });
      params.delete("checkout");
      const cleanUrl = params.toString() ? `${window.location.pathname}?${params}` : window.location.pathname;
      window.history.replaceState({}, "", cleanUrl);
    }
  }, [location]);

  return (
    <div className="min-h-screen" data-testid="settings-page">
      <header className="bg-card border-b border-border px-6 py-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Settings</h2>
          <p className="text-muted-foreground">Branding, user management, and organization configuration</p>
        </div>
      </header>

      <div className="p-6 space-y-6">
        <div className="flex gap-2 flex-wrap">
          <Button variant={tab === "branding" ? "default" : "outline"} size="sm" onClick={() => setTab("branding")}>
            <RiPaletteLine className="w-4 h-4 mr-2" />Branding
          </Button>
          <Button variant={tab === "users" ? "default" : "outline"} size="sm" onClick={() => setTab("users")}>
            <RiTeamLine className="w-4 h-4 mr-2" />Users
          </Button>
          <Button variant={tab === "invitations" ? "default" : "outline"} size="sm" onClick={() => setTab("invitations")}>
            <RiMailLine className="w-4 h-4 mr-2" />Invitations
          </Button>
          <Button variant={tab === "api-keys" ? "default" : "outline"} size="sm" onClick={() => setTab("api-keys")}>
            <RiKeyLine className="w-4 h-4 mr-2" />API Keys
          </Button>
          <Button variant={tab === "billing" ? "default" : "outline"} size="sm" onClick={() => setTab("billing")}>
            <RiBankCardLine className="w-4 h-4 mr-2" />Billing
          </Button>
          <Button variant={tab === "organization" ? "default" : "outline"} size="sm" onClick={() => setTab("organization")}>
            <RiSettings3Line className="w-4 h-4 mr-2" />Organization
          </Button>
        </div>

        {tab === "branding" && <BrandingTab />}
        {tab === "users" && <UsersTab />}
        {tab === "invitations" && <InvitationsTab />}
        {tab === "api-keys" && <ApiKeysTab />}
        {tab === "billing" && <BillingTab />}
        {tab === "organization" && <OrganizationTab />}
      </div>
    </div>
  );
}
