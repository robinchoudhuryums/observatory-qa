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
import { RiTeamLine, RiAddLine, RiDeleteBinLine, RiEditLine, RiUserLine, RiSaveLine } from "@remixicon/react";

interface UserRecord {
  id: string;
  username: string;
  name: string;
  role: string;
  createdAt?: string;
}

export default function UsersTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: users, isLoading } = useQuery<UserRecord[]>({ queryKey: ["/api/users"] });

  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Create form state
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState("viewer");

  // Edit form state
  const [editName, setEditName] = useState("");
  const [editRole, setEditRole] = useState("");
  const [editPassword, setEditPassword] = useState("");

  const createMutation = useMutation({
    mutationFn: async (data: { username: string; password: string; name: string; role: string }) => {
      const res = await apiRequest("POST", "/api/users", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: "User Created", description: "New user account has been created." });
      setShowCreate(false);
      setNewUsername("");
      setNewPassword("");
      setNewName("");
      setNewRole("viewer");
    },
    onError: (error) => {
      toast({ title: "Create Failed", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...data }: { id: string; name?: string; role?: string; password?: string }) => {
      const res = await apiRequest("PATCH", `/api/users/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: "User Updated" });
      setEditingId(null);
    },
    onError: (error) => {
      toast({ title: "Update Failed", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/users/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: "User Deleted" });
    },
    onError: (error) => {
      toast({ title: "Delete Failed", description: error.message, variant: "destructive" });
    },
  });

  const startEdit = (user: UserRecord) => {
    setEditingId(user.id);
    setEditName(user.name);
    setEditRole(user.role);
    setEditPassword("");
  };

  const handleUpdate = (id: string) => {
    const updates: Record<string, string> = {};
    if (editName) updates.name = editName;
    if (editRole) updates.role = editRole;
    if (editPassword) updates.password = editPassword;
    updateMutation.mutate({ id, ...updates });
  };

  const roleBadge = (role: string) => {
    const colors: Record<string, string> = {
      viewer: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
      manager: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
      admin: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
    };
    const labels: Record<string, string> = { viewer: "Viewer", manager: "Manager", admin: "Admin" };
    return <Badge className={colors[role] || "bg-gray-100 text-gray-800"}>{labels[role] || role}</Badge>;
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <RiTeamLine className="w-5 h-5 text-primary" />
                User Management
              </CardTitle>
              <CardDescription>Create, edit, and manage user accounts for your organization.</CardDescription>
            </div>
            <Button size="sm" onClick={() => setShowCreate(!showCreate)}>
              <RiAddLine className="w-4 h-4 mr-2" />
              Add User
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {/* Create User Form */}
          {showCreate && (
            <div className="border border-border rounded-lg p-4 mb-6 bg-muted/30">
              <h4 className="text-sm font-semibold text-foreground mb-3">Create New User</h4>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  createMutation.mutate({ username: newUsername, password: newPassword, name: newName, role: newRole });
                }}
                className="grid grid-cols-2 gap-4"
              >
                <div>
                  <label className="text-xs font-medium text-muted-foreground" htmlFor="new-user-username">
                    Username
                  </label>
                  <Input
                    id="new-user-username"
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value)}
                    placeholder="jdoe"
                    required
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground" htmlFor="new-user-name">
                    Full Name
                  </label>
                  <Input
                    id="new-user-name"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Jane Doe"
                    required
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground" htmlFor="new-user-password">
                    Password
                  </label>
                  <Input
                    id="new-user-password"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Secure password"
                    required
                    minLength={6}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground" htmlFor="new-user-role">
                    Role
                  </label>
                  <Select value={newRole} onValueChange={setNewRole}>
                    <SelectTrigger id="new-user-role">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="viewer">Viewer</SelectItem>
                      <SelectItem value="manager">Manager</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2 flex gap-2">
                  <Button type="submit" size="sm" disabled={createMutation.isPending}>
                    {createMutation.isPending ? "Creating..." : "Create User"}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setShowCreate(false)}>
                    Cancel
                  </Button>
                </div>
              </form>
            </div>
          )}

          {/* Users List */}
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 py-3">
                  <Skeleton className="h-10 w-10 rounded-full" />
                  <div className="space-y-1.5 flex-1">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-48" />
                  </div>
                </div>
              ))}
            </div>
          ) : !users || users.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <RiTeamLine className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p>No users found. Create one above.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {users.map((user) => (
                <div
                  key={user.id}
                  className="flex items-center gap-4 p-3 rounded-lg border border-border hover:bg-muted/30 transition-colors"
                >
                  <div className="w-10 h-10 bg-gradient-to-br from-primary/20 to-primary/5 rounded-full flex items-center justify-center shrink-0">
                    <span className="text-sm font-bold text-primary">{user.name?.charAt(0).toUpperCase() || "U"}</span>
                  </div>

                  {editingId === user.id ? (
                    <div className="flex-1 grid grid-cols-3 gap-3">
                      <div>
                        <label htmlFor={`edit-user-name-${user.id}`} className="sr-only">
                          Name
                        </label>
                        <Input
                          id={`edit-user-name-${user.id}`}
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          placeholder="Name"
                        />
                      </div>
                      <div>
                        <label htmlFor={`edit-user-role-${user.id}`} className="sr-only">
                          Role
                        </label>
                        <Select value={editRole} onValueChange={setEditRole}>
                          <SelectTrigger id={`edit-user-role-${user.id}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="viewer">Viewer</SelectItem>
                            <SelectItem value="manager">Manager</SelectItem>
                            <SelectItem value="admin">Admin</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <label htmlFor={`edit-user-password-${user.id}`} className="sr-only">
                          New password (optional)
                        </label>
                        <Input
                          id={`edit-user-password-${user.id}`}
                          type="password"
                          value={editPassword}
                          onChange={(e) => setEditPassword(e.target.value)}
                          placeholder="New password (optional)"
                        />
                      </div>
                      <div className="col-span-3 flex gap-2">
                        <Button size="sm" onClick={() => handleUpdate(user.id)} disabled={updateMutation.isPending}>
                          Save
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-foreground">{user.name}</p>
                          {roleBadge(user.role)}
                        </div>
                        <p className="text-sm text-muted-foreground">{user.username}</p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button variant="ghost" size="sm" onClick={() => startEdit(user)} title="Edit user">
                          <RiEditLine className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
                          onClick={() => {
                            if (confirm(`Delete user "${user.name}"? This cannot be undone.`)) {
                              deleteMutation.mutate(user.id);
                            }
                          }}
                          title="Delete user"
                        >
                          <RiDeleteBinLine className="w-4 h-4" />
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
