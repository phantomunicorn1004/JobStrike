"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AdminLayout from "@/app/admin-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { AppUser, UserRole } from "@/lib/auth/types";

export function UserManagementClient() {
  const router = useRouter();
  const [users, setUsers] = useState<AppUser[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [editUser, setEditUser] = useState<AppUser | null>(null);
  const [editUsername, setEditUsername] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [editRole, setEditRole] = useState<UserRole>("member");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const [usersRes, meRes] = await Promise.all([
        fetch("/api/admin/users", { cache: "no-store" }),
        fetch("/api/auth/me", { cache: "no-store" }),
      ]);
      if (meRes.ok) {
        const meData = await meRes.json();
        setCurrentUserId(meData.user?.id ?? null);
      }
      if (!usersRes.ok) {
        const err = await usersRes.json().catch(() => ({}));
        throw new Error(err.error || "Failed to load users.");
      }
      const data = await usersRes.json();
      setUsers(data.users ?? []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load users.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const openEdit = (user: AppUser) => {
    setEditUser(user);
    setEditUsername(user.username);
    setEditPassword("");
    setEditRole(user.role);
  };

  const handleSave = async () => {
    if (!editUser) return;
    if (editUsername.trim().length < 3) {
      toast.error("Username must be at least 3 characters.");
      return;
    }
    if (editPassword && editPassword.length < 8) {
      toast.error("Password must be at least 8 characters.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/users/${editUser.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: editUsername,
          password: editPassword || undefined,
          role: editRole,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Update failed.");
      toast.success("User updated.");
      setEditUser(null);
      await loadUsers();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Update failed.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (user: AppUser) => {
    if (!window.confirm(`Delete user "${user.username}"?`)) return;
    setDeletingId(user.id);
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Delete failed.");
      toast.success("User deleted.");
      await loadUsers();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Delete failed.");
    } finally {
      setDeletingId(null);
    }
  };

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  };

  return (
    <AdminLayout onLogout={handleLogout}>
      <div className="flex min-h-0 w-full flex-1 flex-col gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">User management</h1>
          <p className="text-sm text-muted-foreground">
            View, update, and delete registered accounts.
          </p>
        </div>

        <div className="rounded-xl border bg-card shadow-sm">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : users.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">No users found.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Username</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right w-[140px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">{user.username}</TableCell>
                    <TableCell className="capitalize">{user.role}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(user.created_at).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-8 w-8"
                          aria-label={`Edit ${user.username}`}
                          onClick={() => openEdit(user)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          aria-label={`Delete ${user.username}`}
                          disabled={user.id === currentUserId || deletingId === user.id}
                          onClick={() => handleDelete(user)}
                        >
                          {deletingId === user.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </div>

      <Dialog open={editUser != null} onOpenChange={(open) => !open && setEditUser(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update user</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="edit-username">Username</Label>
              <Input
                id="edit-username"
                value={editUsername}
                onChange={(e) => setEditUsername(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-password">New password (optional)</Label>
              <Input
                id="edit-password"
                type="password"
                value={editPassword}
                onChange={(e) => setEditPassword(e.target.value)}
                placeholder="Leave blank to keep current"
              />
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <Select value={editRole} onValueChange={(v) => setEditRole(v as UserRole)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">Member</SelectItem>
                  <SelectItem value="admin">Administrator</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditUser(null)}>
              Cancel
            </Button>
            <Button type="button" onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
