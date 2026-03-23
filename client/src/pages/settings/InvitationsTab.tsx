import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { Invitation } from "@shared/schema";
import {  RiAddLine, RiDeleteBinLine, RiMailLine, RiFileCopyLine, RiTimeLine  } from "@remixicon/react";

export default function InvitationsTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: invitations, isLoading } = useQuery<Invitation[]>({ queryKey: ["/api/invitations"] });

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("viewer");

  const createMutation = useMutation({
    mutationFn: async (data: { email: string; role: string }) => {
      const res = await apiRequest("POST", "/api/invitations", data);
      return res.json();
    },
    onSuccess: (data: Invitation) => {
      queryClient.invalidateQueries({ queryKey: ["/api/invitations"] });
      toast({ title: "Invitation Sent", description: `Invitation created for ${data.email}` });
      setInviteEmail("");
      setInviteRole("viewer");
    },
    onError: (error) => {
      toast({ title: "Failed", description: error.message, variant: "destructive" });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/invitations/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/invitations"] });
      toast({ title: "Invitation Revoked" });
    },
    onError: (error) => {
      toast({ title: "Failed", description: error.message, variant: "destructive" });
    },
  });

  const copyInviteLink = (token: string) => {
    const url = `${window.location.origin}?invite=${token}`;
    navigator.clipboard.writeText(url);
    toast({ title: "Link Copied", description: "Invitation link copied to clipboard." });
  };

  const statusBadge = (status: string) => {
    const colors: Record<string, string> = {
      pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
      accepted: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
      expired: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400",
      revoked: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
    };
    return <Badge className={colors[status] || ""}>{status}</Badge>;
  };

  const roleBadge = (role: string) => {
    const colors: Record<string, string> = {
      viewer: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
      manager: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
      admin: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
    };
    return <Badge className={colors[role] || ""}>{role}</Badge>;
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <RiMailLine className="w-5 h-5 text-primary" />
            Team Invitations
          </CardTitle>
          <CardDescription>
            Invite team members by email. They'll receive a link to create their account and join your organization.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Invite Form */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              createMutation.mutate({ email: inviteEmail, role: inviteRole });
            }}
            className="flex gap-3 mb-6"
          >
            <Input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="colleague@company.com"
              required
              className="flex-1"
            />
            <Select value={inviteRole} onValueChange={setInviteRole}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="viewer">Viewer</SelectItem>
                <SelectItem value="manager">Manager</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
            <Button type="submit" disabled={createMutation.isPending}>
              <RiAddLine className="w-4 h-4 mr-2" />
              {createMutation.isPending ? "Sending..." : "Invite"}
            </Button>
          </form>

          {/* Invitations List */}
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 2 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : !invitations || invitations.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <RiMailLine className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p>No invitations sent yet.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {invitations.map((inv) => (
                <div key={inv.id} className="flex items-center gap-4 p-3 rounded-lg border border-border hover:bg-muted/30 transition-colors">
                  <div className="w-10 h-10 bg-gradient-to-br from-primary/20 to-primary/5 rounded-full flex items-center justify-center shrink-0">
                    <RiMailLine className="w-4 h-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-foreground truncate">{inv.email}</p>
                      {roleBadge(inv.role)}
                      {statusBadge(inv.status)}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                      <span>by {inv.invitedBy}</span>
                      {inv.createdAt && <span>{new Date(inv.createdAt).toLocaleDateString()}</span>}
                      {inv.expiresAt && inv.status === "pending" && (
                        <span className="flex items-center gap-1">
                          <RiTimeLine className="w-3 h-3" />
                          Expires {new Date(inv.expiresAt).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {inv.status === "pending" && (
                      <>
                        <Button variant="ghost" size="sm" onClick={() => copyInviteLink(inv.token)} title="Copy invite link">
                          <RiFileCopyLine className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-red-600 hover:text-red-700"
                          onClick={() => revokeMutation.mutate(inv.id)}
                          title="Revoke invitation"
                        >
                          <RiDeleteBinLine className="w-4 h-4" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
