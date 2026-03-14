import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
import { AudioWaveform, UserPlus, AlertTriangle } from "lucide-react";

interface InviteAcceptProps {
  token: string;
  onComplete: () => void;
}

interface InviteInfo {
  email: string;
  role: string;
  orgName: string;
  status: string;
  expiresAt?: string;
}

export default function InviteAcceptPage({ token, onComplete }: InviteAcceptProps) {
  const { toast } = useToast();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const { data: invite, isLoading: loadingInvite, error } = useQuery<InviteInfo>({
    queryKey: [`/api/invitations/token/${token}`],
    queryFn: getQueryFn({ on401: "returnNull" }),
    retry: false,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      await apiRequest("POST", "/api/invitations/accept", {
        token,
        username,
        password,
        name,
      });
      toast({
        title: "Welcome!",
        description: `You've joined ${invite?.orgName}. Redirecting to dashboard...`,
      });
      onComplete();
    } catch (err: any) {
      const msg = err.message?.includes(":") ? err.message.split(": ").slice(1).join(": ") : err.message;
      toast({ title: "Failed", description: msg, variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  if (loadingInvite) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <AudioWaveform className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !invite || invite.status !== "pending") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center">
            <AlertTriangle className="w-12 h-12 text-destructive mx-auto mb-4" />
            <h2 className="text-xl font-bold text-foreground mb-2">Invalid Invitation</h2>
            <p className="text-muted-foreground mb-4">
              {invite?.status === "accepted"
                ? "This invitation has already been used."
                : invite?.status === "expired"
                  ? "This invitation has expired."
                  : "This invitation link is invalid or has been revoked."}
            </p>
            <Button variant="outline" onClick={() => window.location.href = "/"}>
              Go to Login
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="max-w-md w-full">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <div className="w-12 h-12 bg-gradient-to-br from-primary/20 to-primary/5 rounded-lg flex items-center justify-center">
              <UserPlus className="w-6 h-6 text-primary" />
            </div>
          </div>
          <CardTitle className="text-2xl">Join {invite.orgName}</CardTitle>
          <CardDescription>
            You've been invited as a <Badge variant="secondary" className="mx-1">{invite.role}</Badge>
          </CardDescription>
          <p className="text-sm text-muted-foreground mt-1">
            Invited email: <strong>{invite.email}</strong>
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-sm font-medium text-foreground">Full Name</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your full name"
                required
              />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">Username</label>
              <Input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Choose a username"
                required
                autoComplete="username"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">Password</label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                required
                minLength={8}
                autoComplete="new-password"
              />
            </div>
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? (
                <AudioWaveform className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <UserPlus className="w-4 h-4 mr-2" />
              )}
              Create Account & Join
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
