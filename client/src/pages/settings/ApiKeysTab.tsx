import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  RiAddLine,
  RiDeleteBinLine,
  RiFileCopyLine,
  RiTimeLine,
  RiKeyLine,
  RiForbidLine,
  RiTeamLine,
} from "@remixicon/react";

interface ApiKeyRecord {
  id: string;
  name: string;
  keyPrefix: string;
  permissions: string[];
  createdBy: string;
  status: string;
  expiresAt?: string;
  lastUsedAt?: string;
  createdAt?: string;
}

interface CreatedKeyResponse extends ApiKeyRecord {
  key: string; // Full key, only returned on creation
}

export default function ApiKeysTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: keys, isLoading } = useQuery<ApiKeyRecord[]>({ queryKey: ["/api/api-keys"] });

  const [showCreate, setShowCreate] = useState(false);
  const [keyName, setKeyName] = useState("");
  const [keyPerms, setKeyPerms] = useState<string[]>(["read"]);
  const [keyExpiryDays, setKeyExpiryDays] = useState("");
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: async (data: { name: string; permissions: string[]; expiresInDays?: number }) => {
      const res = await apiRequest("POST", "/api/api-keys", data);
      return res.json() as Promise<CreatedKeyResponse>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/api-keys"] });
      setNewlyCreatedKey(data.key);
      setKeyName("");
      setKeyPerms(["read"]);
      setKeyExpiryDays("");
    },
    onError: (error) => {
      toast({ title: "Failed", description: error.message, variant: "destructive" });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("PATCH", `/api/api-keys/${id}/revoke`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/api-keys"] });
      toast({ title: "API Key Revoked" });
    },
    onError: (error) => {
      toast({ title: "Failed", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/api-keys/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/api-keys"] });
      toast({ title: "API Key Deleted" });
    },
  });

  const togglePerm = (perm: string) => {
    setKeyPerms((prev) => (prev.includes(perm) ? prev.filter((p) => p !== perm) : [...prev, perm]));
  };

  const copyKey = (key: string) => {
    navigator.clipboard.writeText(key);
    toast({ title: "Copied", description: "API key copied to clipboard." });
  };

  return (
    <div className="space-y-6">
      {/* Newly created key alert */}
      {newlyCreatedKey && (
        <Card className="border-green-300 dark:border-green-800 bg-green-50 dark:bg-green-950/30">
          <CardContent className="pt-6">
            <h4 className="text-sm font-semibold text-green-800 dark:text-green-400 mb-2">
              API RiKeyLine Created — Copy it now!
            </h4>
            <p className="text-xs text-green-700 dark:text-green-500 mb-3">
              This key will not be shown again. Store it securely.
            </p>
            <div className="flex gap-2">
              <code className="flex-1 bg-white dark:bg-background border border-border rounded px-3 py-2 text-xs font-mono break-all">
                {newlyCreatedKey}
              </code>
              <Button size="sm" variant="outline" onClick={() => copyKey(newlyCreatedKey)}>
                <RiFileCopyLine className="w-4 h-4" />
              </Button>
            </div>
            <Button variant="ghost" size="sm" className="mt-2" onClick={() => setNewlyCreatedKey(null)}>
              Dismiss
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <RiKeyLine className="w-5 h-5 text-primary" />
                API Keys
              </CardTitle>
              <CardDescription>
                Create API keys for programmatic access. Use the header:{" "}
                <code className="text-xs">Authorization: Bearer obs_k_...</code>
              </CardDescription>
            </div>
            <Button
              size="sm"
              onClick={() => {
                setShowCreate(!showCreate);
                setNewlyCreatedKey(null);
              }}
            >
              <RiAddLine className="w-4 h-4 mr-2" />
              New Key
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {/* Create Form */}
          {showCreate && (
            <div className="border border-border rounded-lg p-4 mb-6 bg-muted/30">
              <h4 className="text-sm font-semibold text-foreground mb-3">Create API Key</h4>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  createMutation.mutate({
                    name: keyName,
                    permissions: keyPerms,
                    expiresInDays: keyExpiryDays ? parseInt(keyExpiryDays) : undefined,
                  });
                }}
                className="space-y-4"
              >
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Key Name</label>
                  <Input
                    value={keyName}
                    onChange={(e) => setKeyName(e.target.value)}
                    placeholder="Production API"
                    required
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Permissions</label>
                  <div className="flex gap-2 mt-1">
                    {["read", "write", "admin"].map((perm) => (
                      <Button
                        key={perm}
                        type="button"
                        size="sm"
                        variant={keyPerms.includes(perm) ? "default" : "outline"}
                        onClick={() => togglePerm(perm)}
                      >
                        {perm}
                      </Button>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    read = view data, write = upload/modify, admin = full access
                  </p>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Expiry (days, optional)</label>
                  <Input
                    type="number"
                    value={keyExpiryDays}
                    onChange={(e) => setKeyExpiryDays(e.target.value)}
                    placeholder="Never expires"
                    min={1}
                    max={365}
                  />
                </div>
                <div className="flex gap-2">
                  <Button type="submit" size="sm" disabled={createMutation.isPending}>
                    {createMutation.isPending ? "Creating..." : "Create Key"}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setShowCreate(false)}>
                    Cancel
                  </Button>
                </div>
              </form>
            </div>
          )}

          {/* Keys List */}
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 2 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : !keys || keys.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <RiKeyLine className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p>No API keys created yet.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {keys.map((k) => (
                <div
                  key={k.id}
                  className="flex items-center gap-4 p-3 rounded-lg border border-border hover:bg-muted/30 transition-colors"
                >
                  <div className="w-10 h-10 bg-gradient-to-br from-primary/20 to-primary/5 rounded-full flex items-center justify-center shrink-0">
                    <RiKeyLine className="w-4 h-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-foreground">{k.name}</p>
                      <code className="text-xs text-muted-foreground font-mono">{k.keyPrefix}...</code>
                      <Badge
                        className={
                          k.status === "active"
                            ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                            : "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
                        }
                      >
                        {k.status}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                      <span>{k.permissions.join(", ")}</span>
                      <span>by {k.createdBy}</span>
                      {k.lastUsedAt && <span>Last used: {new Date(k.lastUsedAt).toLocaleDateString()}</span>}
                      {k.expiresAt && (
                        <span className="flex items-center gap-1">
                          <RiTimeLine className="w-3 h-3" />
                          Expires {new Date(k.expiresAt).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {k.status === "active" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-amber-600"
                        onClick={() => revokeMutation.mutate(k.id)}
                        title="Revoke key"
                      >
                        <RiForbidLine className="w-4 h-4" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-red-600"
                      onClick={() => {
                        if (confirm(`Delete API key "${k.name}"?`)) deleteMutation.mutate(k.id);
                      }}
                      title="Delete key"
                    >
                      <RiDeleteBinLine className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* OAuth Status Card */}
      <OAuthStatusCard />
    </div>
  );
}

function OAuthStatusCard() {
  const { data: providers } = useQuery<{ google: boolean; local: boolean }>({
    queryKey: ["/api/auth/providers"],
    staleTime: 60000,
  });

  return (
    <Card className="bg-muted/30 border-dashed">
      <CardContent className="pt-6">
        <h4 className="text-sm font-semibold text-foreground mb-3">Single Sign-On (SSO)</h4>
        <div className="space-y-2">
          <div className="flex items-center justify-between py-2">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded bg-white dark:bg-background border border-border flex items-center justify-center">
                <span className="text-sm font-bold">G</span>
              </div>
              <div>
                <p className="text-sm font-medium">Google OAuth</p>
                <p className="text-xs text-muted-foreground">Sign in with Google Workspace</p>
              </div>
            </div>
            <Badge
              className={
                providers?.google
                  ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                  : "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400"
              }
            >
              {providers?.google ? "Configured" : "Not configured"}
            </Badge>
          </div>
          {!providers?.google && (
            <p className="text-xs text-muted-foreground">
              Set <code className="bg-muted px-1 rounded">GOOGLE_CLIENT_ID</code> and{" "}
              <code className="bg-muted px-1 rounded">GOOGLE_CLIENT_SECRET</code> environment variables to enable. Users
              with matching email domains will be auto-provisioned.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
