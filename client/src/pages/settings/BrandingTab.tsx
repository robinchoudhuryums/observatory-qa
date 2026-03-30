import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { Organization } from "@shared/schema";
import { RiPaletteLine, RiSaveLine, RiCheckboxBlankLine } from "@remixicon/react";

export default function BrandingTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: org, isLoading } = useQuery<Organization>({ queryKey: ["/api/organization"] });

  const [appName, setAppName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [primaryColor, setPrimaryColor] = useState("");
  const [initialized, setInitialized] = useState(false);

  // Initialize form from fetched org data
  if (org && !initialized) {
    setAppName(org.settings?.branding?.appName || "Observatory");
    setLogoUrl(org.settings?.branding?.logoUrl || "");
    setPrimaryColor((org.settings as any)?.branding?.primaryColor || "");
    setInitialized(true);
  }

  const mutation = useMutation({
    mutationFn: async (branding: { appName: string; logoUrl?: string; primaryColor?: string }) => {
      const res = await apiRequest("PATCH", "/api/organization/settings", { branding });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/organization"] });
      toast({ title: "Branding Updated", description: "Your branding changes have been saved." });
    },
    onError: (error) => {
      toast({ title: "Save Failed", description: error.message, variant: "destructive" });
    },
  });

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    mutation.mutate({
      appName: appName.trim() || "Observatory",
      logoUrl: logoUrl.trim() || undefined,
      primaryColor: primaryColor.trim() || undefined,
    });
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="pt-6 space-y-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <RiPaletteLine className="w-5 h-5 text-primary" />
            White-Label Branding
          </CardTitle>
          <CardDescription>
            Customize the platform appearance for your organization. Changes apply to all users in your org.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSave} className="space-y-5">
            <div>
              <label className="text-sm font-medium text-foreground">Application Name</label>
              <Input value={appName} onChange={(e) => setAppName(e.target.value)} placeholder="Observatory" />
              <p className="text-xs text-muted-foreground mt-1">
                Displayed in the sidebar, login page, and report headers.
              </p>
            </div>

            <div>
              <label className="text-sm font-medium text-foreground">Logo URL</label>
              <Input
                value={logoUrl}
                onChange={(e) => setLogoUrl(e.target.value)}
                placeholder="https://example.com/logo.png"
                type="url"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Optional. Square image recommended (32x32px or larger). Replaces the default icon in the sidebar.
              </p>
            </div>

            <div>
              <label className="text-sm font-medium text-foreground">Primary Color</label>
              <div className="flex gap-3 items-center">
                <input
                  type="color"
                  value={primaryColor || "#3b82f6"}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                  className="w-10 h-10 rounded border border-border cursor-pointer"
                />
                <Input
                  value={primaryColor}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                  placeholder="#3b82f6"
                  className="flex-1"
                />
                {primaryColor && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setPrimaryColor("")}>
                    Reset
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Override the default blue theme color. Used for buttons, active nav items, and accents.
              </p>
            </div>

            {/* Live Preview */}
            <div className="border border-border rounded-lg p-4 bg-muted/30">
              <p className="text-xs font-semibold text-muted-foreground mb-3 uppercase tracking-wider">Preview</p>
              <div className="flex items-center space-x-3">
                {logoUrl ? (
                  <img src={logoUrl} alt="Logo" className="w-8 h-8 rounded-lg object-contain" />
                ) : (
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center"
                    style={{ backgroundColor: primaryColor || "hsl(217, 91%, 60%)" }}
                  >
                    <span className="text-white text-xs font-bold">{(appName || "O").charAt(0).toUpperCase()}</span>
                  </div>
                )}
                <div>
                  <p className="font-bold text-lg text-foreground">{appName || "Observatory"}</p>
                  <p className="text-xs text-muted-foreground">QA Dashboard</p>
                </div>
              </div>
            </div>

            <Button type="submit" disabled={mutation.isPending}>
              <RiSaveLine className="w-4 h-4 mr-2" />
              {mutation.isPending ? "Saving..." : "Save Branding"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
