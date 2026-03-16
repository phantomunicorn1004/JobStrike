"use client";

// Force dynamic rendering to prevent static prerendering
// This ensures the route segment is rendered at request time
export const dynamic = "force-dynamic";

import React, { useState, useEffect } from "react";
import { CopyButton } from "@/components/ui/copy-button";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { Edit2, Check, X, Loader2 } from "lucide-react";

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

type EditingField = {
  profileId: number;
  field: string;
};

export default function ProfilePage() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [editingField, setEditingField] = useState<EditingField | null>(null);
  const [editValue, setEditValue] = useState("");
  const [savingField, setSavingField] = useState<EditingField | null>(null);
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

  const handleEditClick = (profileId: number, field: string, currentValue: string | string[]) => {
    const value = Array.isArray(currentValue) ? currentValue.join(", ") : currentValue;
    setEditingField({ profileId, field });
    setEditValue(value);
  };

  const handleCancel = () => {
    setEditingField(null);
    setEditValue("");
  };

  const handleSave = async (profileId: number, field: string) => {
    setSavingField({ profileId, field });
    try {
      let updateValue: string | string[] = editValue.trim();

      // Convert comma-separated strings to arrays for email and phone fields
      if (field === "work_emails" || field === "phone_numbers") {
        updateValue = editValue
          .split(",")
          .map((item) => item.trim())
          .filter((item) => item.length > 0);
      }

      const { error } = await supabase
        .from("profiles")
        .update({ [field]: updateValue, updated_at: new Date().toISOString() })
        .eq("id", profileId);

      if (error) throw error;

      // Update local state
      setProfiles((prev) =>
        prev.map((profile) =>
          profile.id === profileId
            ? { ...profile, [field]: updateValue }
            : profile
        )
      );

      setEditingField(null);
      setEditValue("");
      toast.success("Profile updated successfully");
    } catch (error) {
      console.error("Error updating profile:", error);
      toast.error("Failed to update profile");
    } finally {
      setSavingField(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent, profileId: number, field: string) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSave(profileId, field);
    } else if (e.key === "Escape") {
      handleCancel();
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
      <h1 className="text-3xl font-bold mb-8">User Profiles</h1>
      <div className="flex flex-col md:flex-row gap-8 w-full">
        {profiles.map((profile) => (
          <div
            key={profile.id}
            className="border flex-1 min-w-[320px] p-6 rounded-lg shadow-sm bg-card text-card-foreground space-y-4"
          >
            <div className="mb-2">
              {editingField?.profileId === profile.id && editingField?.field === "full_name" ? (
                <div className="flex items-center gap-2">
                  <Input
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={(e) => handleKeyDown(e, profile.id, "full_name")}
                    onBlur={() => {
                      if (savingField?.profileId !== profile.id || savingField?.field !== "full_name") {
                        handleCancel();
                      }
                    }}
                    className="text-2xl font-semibold flex-1"
                    autoFocus
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => handleSave(profile.id, "full_name")}
                    disabled={savingField?.profileId === profile.id && savingField?.field === "full_name"}
                  >
                    {savingField?.profileId === profile.id && savingField?.field === "full_name" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Check className="h-4 w-4" />
                    )}
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={handleCancel}
                    disabled={savingField?.profileId === profile.id && savingField?.field === "full_name"}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <h2 className="text-2xl font-semibold">{profile.full_name}</h2>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6"
                    onClick={() => handleEditClick(profile.id, "full_name", profile.full_name)}
                  >
                    <Edit2 className="h-3 w-3" />
                  </Button>
                </div>
              )}
            </div>
            <div className="grid grid-cols-1 gap-4">
              <EditableField
                label="DOB"
                value={profile.dob}
                profileId={profile.id}
                field="dob"
                editingField={editingField}
                editValue={editValue}
                setEditValue={setEditValue}
                savingField={savingField}
                onEditClick={handleEditClick}
                onSave={handleSave}
                onCancel={handleCancel}
                onKeyDown={handleKeyDown}
              />
              <EditableField
                label="SSN"
                value={profile.ssn}
                profileId={profile.id}
                field="ssn"
                editingField={editingField}
                editValue={editValue}
                setEditValue={setEditValue}
                savingField={savingField}
                onEditClick={handleEditClick}
                onSave={handleSave}
                onCancel={handleCancel}
                onKeyDown={handleKeyDown}
              />
              <EditableField
                label="Phone"
                value={profile.phone_numbers.join(", ")}
                profileId={profile.id}
                field="phone_numbers"
                editingField={editingField}
                editValue={editValue}
                setEditValue={setEditValue}
                savingField={savingField}
                onEditClick={handleEditClick}
                onSave={handleSave}
                onCancel={handleCancel}
                onKeyDown={handleKeyDown}
                isArray={true}
              />
              <EditableField
                label="Emails"
                value={profile.work_emails.join(", ")}
                profileId={profile.id}
                field="work_emails"
                editingField={editingField}
                editValue={editValue}
                setEditValue={setEditValue}
                savingField={savingField}
                onEditClick={handleEditClick}
                onSave={handleSave}
                onCancel={handleCancel}
                onKeyDown={handleKeyDown}
                isArray={true}
              />
              <EditableField
                label="Address"
                value={profile.address}
                profileId={profile.id}
                field="address"
                editingField={editingField}
                editValue={editValue}
                setEditValue={setEditValue}
                savingField={savingField}
                onEditClick={handleEditClick}
                onSave={handleSave}
                onCancel={handleCancel}
                onKeyDown={handleKeyDown}
              />
              <EditableField
                label="City"
                value={profile.city}
                profileId={profile.id}
                field="city"
                editingField={editingField}
                editValue={editValue}
                setEditValue={setEditValue}
                savingField={savingField}
                onEditClick={handleEditClick}
                onSave={handleSave}
                onCancel={handleCancel}
                onKeyDown={handleKeyDown}
              />
              <EditableField
                label="State"
                value={profile.state}
                profileId={profile.id}
                field="state"
                editingField={editingField}
                editValue={editValue}
                setEditValue={setEditValue}
                savingField={savingField}
                onEditClick={handleEditClick}
                onSave={handleSave}
                onCancel={handleCancel}
                onKeyDown={handleKeyDown}
              />
              <EditableField
                label="Postal Code"
                value={profile.postal_code}
                profileId={profile.id}
                field="postal_code"
                editingField={editingField}
                editValue={editValue}
                setEditValue={setEditValue}
                savingField={savingField}
                onEditClick={handleEditClick}
                onSave={handleSave}
                onCancel={handleCancel}
                onKeyDown={handleKeyDown}
              />
              <EditableField
                label="University"
                value={profile.university}
                profileId={profile.id}
                field="university"
                editingField={editingField}
                editValue={editValue}
                setEditValue={setEditValue}
                savingField={savingField}
                onEditClick={handleEditClick}
                onSave={handleSave}
                onCancel={handleCancel}
                onKeyDown={handleKeyDown}
              />
              <div className="flex items-center">
                <b>LinkedIn: </b>
                {editingField?.profileId === profile.id && editingField?.field === "linkedin" ? (
                  <div className="ml-1 flex-1 flex items-center gap-2">
                    <Input
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => handleKeyDown(e, profile.id, "linkedin")}
                      onBlur={() => {
                        if (savingField?.profileId !== profile.id || savingField?.field !== "linkedin") {
                          handleCancel();
                        }
                      }}
                      className="flex-1"
                      autoFocus
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => handleSave(profile.id, "linkedin")}
                      disabled={savingField?.profileId === profile.id && savingField?.field === "linkedin"}
                    >
                      {savingField?.profileId === profile.id && savingField?.field === "linkedin" ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Check className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={handleCancel}
                      disabled={savingField?.profileId === profile.id && savingField?.field === "linkedin"}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <>
                    <a
                      className="ml-1 text-blue-600"
                      target="_blank"
                      rel="noopener noreferrer"
                      href={profile.linkedin}
                    >
                      {profile.linkedin}
                    </a>
                    <CopyButton value={profile.linkedin} />
                    <Button
                      size="icon"
                      variant="ghost"
                      className="ml-1 h-6 w-6"
                      onClick={() => handleEditClick(profile.id, "linkedin", profile.linkedin)}
                    >
                      <Edit2 className="h-3 w-3" />
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

type EditableFieldProps = {
  label: string;
  value: string;
  profileId: number;
  field: string;
  editingField: EditingField | null;
  editValue: string;
  setEditValue: (value: string) => void;
  savingField: EditingField | null;
  onEditClick: (profileId: number, field: string, currentValue: string | string[]) => void;
  onSave: (profileId: number, field: string) => void;
  onCancel: () => void;
  onKeyDown: (e: React.KeyboardEvent, profileId: number, field: string) => void;
  isArray?: boolean;
};

function EditableField({
  label,
  value,
  profileId,
  field,
  editingField,
  editValue,
  setEditValue,
  savingField,
  onEditClick,
  onSave,
  onCancel,
  onKeyDown,
  isArray = false,
}: EditableFieldProps) {
  const isEditing = editingField?.profileId === profileId && editingField?.field === field;
  const isSaving = savingField?.profileId === profileId && savingField?.field === field;

  return (
    <div className="flex items-center">
      <b>{label}:</b>{" "}
      {isEditing ? (
        <div className="ml-1 flex-1 flex items-center gap-2">
          <Input
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => onKeyDown(e, profileId, field)}
            onBlur={() => {
              if (!isSaving) {
                onCancel();
              }
            }}
            className="flex-1"
            autoFocus
            placeholder={isArray ? "Comma-separated values" : ""}
          />
          <Button
            size="icon"
            variant="ghost"
            onClick={() => onSave(profileId, field)}
            disabled={isSaving}
          >
            {isSaving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={onCancel}
            disabled={isSaving}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <>
          <span className="ml-1">{value}</span>
          <CopyButton value={value} />
          <Button
            size="icon"
            variant="ghost"
            className="ml-1 h-6 w-6"
            onClick={() => onEditClick(profileId, field, value)}
          >
            <Edit2 className="h-3 w-3" />
          </Button>
        </>
      )}
    </div>
  );
}
