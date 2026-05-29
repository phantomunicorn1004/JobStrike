"use client";

export const dynamic = "force-dynamic";

import React, { useState, useEffect } from "react";
import { CopyButton } from "@/components/ui/copy-button";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { Edit2, Loader2, Plus, Trash2 } from "lucide-react";

type Profile = {
  id: number;
  full_name: string;
  dob: string;
  work_emails: string[];
  phone_numbers: string[];
  ssn: string;
  address: string;
  city: string;
  state: string;
  postal_code: string;
  university: string;
  linkedin: string;
};

/** Draft for editing one profile (arrays as comma-separated strings) */
type ProfileEditDraft = {
  full_name: string;
  dob: string;
  work_emails: string;
  phone_numbers: string;
  ssn: string;
  address: string;
  city: string;
  state: string;
  postal_code: string;
  university: string;
  linkedin: string;
};

const emptyNewProfile = {
  full_name: "",
  dob: "",
  work_emails: "",
  phone_numbers: "",
  ssn: "",
  address: "",
  city: "",
  state: "",
  postal_code: "",
  university: "",
  linkedin: "",
};

export default function ProfilePage() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [editingProfileId, setEditingProfileId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<ProfileEditDraft | null>(null);
  const [savingProfileId, setSavingProfileId] = useState<number | null>(null);
  const [addProfileOpen, setAddProfileOpen] = useState(false);
  const [newProfile, setNewProfile] = useState(emptyNewProfile);
  const [isAdding, setIsAdding] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const supabase = getSupabaseBrowserClient();

  useEffect(() => {
    fetchProfiles();
  }, []);

  const fetchProfiles = async () => {
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .order("id");

      if (error) throw error;
      setProfiles(data || []);
    } catch (error) {
      console.error("Error fetching profiles:", error);
      toast.error("Failed to load profiles");
    } finally {
      setIsLoading(false);
    }
  };

  const handleStartEdit = (profile: Profile) => {
    setEditingProfileId(profile.id);
    setEditDraft({
      full_name: profile.full_name,
      dob: profile.dob,
      work_emails: profile.work_emails.join(", "),
      phone_numbers: profile.phone_numbers.join(", "),
      ssn: profile.ssn,
      address: profile.address,
      city: profile.city,
      state: profile.state,
      postal_code: profile.postal_code,
      university: profile.university,
      linkedin: profile.linkedin,
    });
  };

  const handleCancelEdit = () => {
    setEditingProfileId(null);
    setEditDraft(null);
  };

  const handleSaveProfile = async () => {
    if (!editingProfileId || !editDraft) return;
    const d = editDraft;
    if (!d.full_name.trim()) {
      toast.error("Full name is required");
      return;
    }
    setSavingProfileId(editingProfileId);
    try {
      const work_emails = d.work_emails.split(",").map((s) => s.trim()).filter(Boolean);
      const phone_numbers = d.phone_numbers.split(",").map((s) => s.trim()).filter(Boolean);
      const { error } = await supabase
        .from("profiles")
        .update({
          full_name: d.full_name.trim(),
          dob: d.dob.trim(),
          work_emails: work_emails.length ? work_emails : [],
          phone_numbers: phone_numbers.length ? phone_numbers : [],
          ssn: d.ssn.trim(),
          address: d.address.trim(),
          city: d.city.trim(),
          state: d.state.trim(),
          postal_code: d.postal_code.trim(),
          university: d.university.trim(),
          linkedin: d.linkedin.trim(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", editingProfileId);
      if (error) throw error;
      setProfiles((prev) =>
        prev.map((p) =>
          p.id === editingProfileId
            ? {
                ...p,
                full_name: d.full_name.trim(),
                dob: d.dob.trim(),
                work_emails: work_emails.length ? work_emails : [],
                phone_numbers: phone_numbers.length ? phone_numbers : [],
                ssn: d.ssn.trim(),
                address: d.address.trim(),
                city: d.city.trim(),
                state: d.state.trim(),
                postal_code: d.postal_code.trim(),
                university: d.university.trim(),
                linkedin: d.linkedin.trim(),
              }
            : p
        )
      );
      setEditingProfileId(null);
      setEditDraft(null);
      toast.success("Profile updated");
    } catch (err) {
      console.error(err);
      toast.error("Failed to update profile");
    } finally {
      setSavingProfileId(null);
    }
  };

  const handleAddProfile = async () => {
    const name = newProfile.full_name.trim();
    if (!name || !newProfile.dob.trim() || !newProfile.ssn.trim() || !newProfile.address.trim() ||
        !newProfile.city.trim() || !newProfile.state.trim() || !newProfile.postal_code.trim() ||
        !newProfile.university.trim() || !newProfile.linkedin.trim()) {
      toast.error("Please fill all required fields");
      return;
    }
    setIsAdding(true);
    try {
      const work_emails = newProfile.work_emails
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const phone_numbers = newProfile.phone_numbers
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const { error } = await supabase.from("profiles").insert({
        full_name: name,
        dob: newProfile.dob.trim(),
        work_emails: work_emails.length ? work_emails : [],
        phone_numbers: phone_numbers.length ? phone_numbers : [],
        ssn: newProfile.ssn.trim(),
        address: newProfile.address.trim(),
        city: newProfile.city.trim(),
        state: newProfile.state.trim(),
        postal_code: newProfile.postal_code.trim(),
        university: newProfile.university.trim(),
        linkedin: newProfile.linkedin.trim(),
      });
      if (error) throw error;
      setNewProfile(emptyNewProfile);
      setAddProfileOpen(false);
      await fetchProfiles();
      toast.success("Profile added");
    } catch (err) {
      console.error(err);
      toast.error("Failed to add profile");
    } finally {
      setIsAdding(false);
    }
  };

  const handleDeleteProfile = async (profileId: number) => {
    setIsDeleting(true);
    try {
      const { error } = await supabase.from("profiles").delete().eq("id", profileId);
      if (error) throw error;
      setDeleteConfirmId(null);
      setProfiles((prev) => prev.filter((p) => p.id !== profileId));
      toast.success("Profile removed");
    } catch (err) {
      console.error(err);
      toast.error("Failed to remove profile");
    } finally {
      setIsDeleting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="w-full mx-auto py-12">
        <p className="text-muted-foreground">Loading profiles...</p>
      </div>
    );
  }

  return (
    <div className="w-full mx-auto py-12">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
        <h1 className="text-3xl font-bold">User Profiles</h1>
        <Dialog open={addProfileOpen} onOpenChange={setAddProfileOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="h-4 w-4" />
              Add profile
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Add profile</DialogTitle>
            </DialogHeader>
            <div className="grid gap-3 py-2">
              <div className="grid gap-1.5">
                <Label>Full name *</Label>
                <Input
                  value={newProfile.full_name}
                  onChange={(e) => setNewProfile((p) => ({ ...p, full_name: e.target.value }))}
                  placeholder="Full name"
                />
              </div>
              <div className="grid gap-1.5">
                <Label>DOB *</Label>
                <Input
                  value={newProfile.dob}
                  onChange={(e) => setNewProfile((p) => ({ ...p, dob: e.target.value }))}
                  placeholder="e.g. 07/20/1995"
                />
              </div>
              <div className="grid gap-1.5">
                <Label>Work emails (comma-separated)</Label>
                <Input
                  value={newProfile.work_emails}
                  onChange={(e) => setNewProfile((p) => ({ ...p, work_emails: e.target.value }))}
                  placeholder="email1@example.com, email2@example.com"
                />
              </div>
              <div className="grid gap-1.5">
                <Label>Phone numbers (comma-separated)</Label>
                <Input
                  value={newProfile.phone_numbers}
                  onChange={(e) => setNewProfile((p) => ({ ...p, phone_numbers: e.target.value }))}
                  placeholder="+1 234 567 8900, +1 098 765 4321"
                />
              </div>
              <div className="grid gap-1.5">
                <Label>SSN *</Label>
                <Input
                  value={newProfile.ssn}
                  onChange={(e) => setNewProfile((p) => ({ ...p, ssn: e.target.value }))}
                  placeholder="Last 4 or full"
                />
              </div>
              <div className="grid gap-1.5">
                <Label>Address *</Label>
                <Input
                  value={newProfile.address}
                  onChange={(e) => setNewProfile((p) => ({ ...p, address: e.target.value }))}
                  placeholder="Street address"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label>City *</Label>
                  <Input
                    value={newProfile.city}
                    onChange={(e) => setNewProfile((p) => ({ ...p, city: e.target.value }))}
                    placeholder="City"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label>State *</Label>
                  <Input
                    value={newProfile.state}
                    onChange={(e) => setNewProfile((p) => ({ ...p, state: e.target.value }))}
                    placeholder="State"
                  />
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label>Postal code *</Label>
                <Input
                  value={newProfile.postal_code}
                  onChange={(e) => setNewProfile((p) => ({ ...p, postal_code: e.target.value }))}
                  placeholder="ZIP / Postal code"
                />
              </div>
              <div className="grid gap-1.5">
                <Label>University *</Label>
                <Input
                  value={newProfile.university}
                  onChange={(e) => setNewProfile((p) => ({ ...p, university: e.target.value }))}
                  placeholder="University name (years)"
                />
              </div>
              <div className="grid gap-1.5">
                <Label>LinkedIn *</Label>
                <Input
                  value={newProfile.linkedin}
                  onChange={(e) => setNewProfile((p) => ({ ...p, linkedin: e.target.value }))}
                  placeholder="https://linkedin.com/in/..."
                />
              </div>
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">Cancel</Button>
              </DialogClose>
              <Button onClick={handleAddProfile} disabled={isAdding}>
                {isAdding ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Adding…
                  </>
                ) : (
                  "Add profile"
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <div className="flex flex-col md:flex-row gap-8 w-full">
        {profiles.map((profile) => (
          <div
            key={profile.id}
            className="flex-1 min-w-[320px] space-y-4 rounded-lg border border-border bg-card p-6 text-card-foreground shadow-sm"
          >
            <div className="mb-2 flex items-start justify-between gap-2">
              <h2 className="text-2xl font-semibold truncate min-w-0 flex-1">
                {editingProfileId === profile.id && editDraft ? editDraft.full_name : profile.full_name}
              </h2>
              <div className="flex items-center gap-1 shrink-0">
                {editingProfileId === profile.id ? (
                  <>
                    <Button size="sm" variant="ghost" onClick={handleCancelEdit} disabled={savingProfileId === profile.id}>
                      Cancel
                    </Button>
                    <Button size="sm" onClick={handleSaveProfile} disabled={savingProfileId === profile.id}>
                      {savingProfileId === profile.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        "Save"
                      )}
                    </Button>
                  </>
                ) : (
                  <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => handleStartEdit(profile)}>
                    <Edit2 className="h-4 w-4" />
                  </Button>
                )}
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 text-destructive hover:text-destructive"
                  onClick={() => setDeleteConfirmId(profile.id)}
                  disabled={editingProfileId === profile.id}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <AlertDialog open={deleteConfirmId === profile.id} onOpenChange={(open) => !open && setDeleteConfirmId(null)}>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Remove profile?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will permanently remove &quot;{profile.full_name}&quot;. Jobs linked to this profile name will not be updated.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => handleDeleteProfile(profile.id)}
                      disabled={isDeleting}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Remove"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
            <div className="grid grid-cols-1 gap-4">
              {editingProfileId === profile.id && editDraft ? (
                <>
                  <div className="grid gap-1.5">
                    <Label>Full name</Label>
                    <Input
                      value={editDraft.full_name}
                      onChange={(e) => setEditDraft((d) => d && { ...d, full_name: e.target.value })}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label>DOB</Label>
                    <Input value={editDraft.dob} onChange={(e) => setEditDraft((d) => d && { ...d, dob: e.target.value })} />
                  </div>
                  <div className="grid gap-1.5">
                    <Label>Work emails (comma-separated)</Label>
                    <Input
                      value={editDraft.work_emails}
                      onChange={(e) => setEditDraft((d) => d && { ...d, work_emails: e.target.value })}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label>Phone numbers (comma-separated)</Label>
                    <Input
                      value={editDraft.phone_numbers}
                      onChange={(e) => setEditDraft((d) => d && { ...d, phone_numbers: e.target.value })}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label>SSN</Label>
                    <Input value={editDraft.ssn} onChange={(e) => setEditDraft((d) => d && { ...d, ssn: e.target.value })} />
                  </div>
                  <div className="grid gap-1.5">
                    <Label>Address</Label>
                    <Input
                      value={editDraft.address}
                      onChange={(e) => setEditDraft((d) => d && { ...d, address: e.target.value })}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="grid gap-1.5">
                      <Label>City</Label>
                      <Input value={editDraft.city} onChange={(e) => setEditDraft((d) => d && { ...d, city: e.target.value })} />
                    </div>
                    <div className="grid gap-1.5">
                      <Label>State</Label>
                      <Input value={editDraft.state} onChange={(e) => setEditDraft((d) => d && { ...d, state: e.target.value })} />
                    </div>
                  </div>
                  <div className="grid gap-1.5">
                    <Label>Postal code</Label>
                    <Input
                      value={editDraft.postal_code}
                      onChange={(e) => setEditDraft((d) => d && { ...d, postal_code: e.target.value })}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label>University</Label>
                    <Input
                      value={editDraft.university}
                      onChange={(e) => setEditDraft((d) => d && { ...d, university: e.target.value })}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label>LinkedIn</Label>
                    <Input
                      value={editDraft.linkedin}
                      onChange={(e) => setEditDraft((d) => d && { ...d, linkedin: e.target.value })}
                    />
                  </div>
                </>
              ) : (
                <>
                  <ReadOnlyField label="DOB" value={profile.dob} />
                  <ReadOnlyField label="SSN" value={profile.ssn} />
                  <ReadOnlyField label="Phone" value={profile.phone_numbers.join(", ")} />
                  <ReadOnlyField label="Emails" value={profile.work_emails.join(", ")} />
                  <ReadOnlyField label="Address" value={profile.address} />
                  <ReadOnlyField label="City" value={profile.city} />
                  <ReadOnlyField label="State" value={profile.state} />
                  <ReadOnlyField label="Postal Code" value={profile.postal_code} />
                  <ReadOnlyField label="University" value={profile.university} />
                  <div className="flex items-center gap-2">
                    <b>LinkedIn:</b>
                    <a
                      className="text-primary hover:underline truncate min-w-0"
                      target="_blank"
                      rel="noopener noreferrer"
                      href={profile.linkedin}
                    >
                      {profile.linkedin}
                    </a>
                    <CopyButton value={profile.linkedin} />
                  </div>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <b className="shrink-0">{label}:</b>
      <span className="truncate min-w-0">{value}</span>
      <CopyButton value={value} />
    </div>
  );
}
