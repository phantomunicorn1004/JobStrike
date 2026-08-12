"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import JobsLayout from "@/app/jobs-layout";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { REQUIRED_BUILT_RESUME_JSON_FIELDS } from "@/lib/promptBuilder";
import {
  emptyProfilePromptKit,
  readProfilePromptKit,
  readSelectedProfileId,
  writeProfilePromptKit,
  writeSelectedProfileId,
  type ProfilePromptKit,
} from "@/lib/resume-builder/promptKitStorage";
import {
  fetchProfilePromptKit,
  localPromptKitHasDraft,
  saveProfilePromptKit,
} from "@/lib/resume-builder/promptKitApi";
import { syncPromptKitToExtension } from "@/lib/resume-builder/promptKitExtensionSync";
import {
  fetchJson2docxHealth,
  readJson2docxSettingsFromStorage,
} from "@/lib/json2docx/settings";

type ProfileOption = { id: number; full_name: string };

type HealthState =
  | { status: "idle" | "checking" | "disabled" }
  | { status: "online"; version: string }
  | { status: "offline"; error: string };

function FieldBlock({
  id,
  label,
  hint,
  value,
  onChange,
  onClear,
  placeholder,
  mono = false,
  rows = 8,
  grow = false,
  disabled = false,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  onChange?: (value: string) => void;
  onClear?: () => void;
  placeholder?: string;
  mono?: boolean;
  rows?: number;
  grow?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className={cn("flex min-h-0 w-full flex-col gap-1.5", grow && "h-full flex-1")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 shrink-0">
          <label htmlFor={id} className="text-sm font-medium text-foreground">
            {label}
          </label>
          {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
        </div>
        {onClear ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 px-2 text-xs"
            onClick={onClear}
            disabled={disabled}
          >
            Clear
          </Button>
        ) : null}
      </div>
      <Textarea
        id={id}
        value={value}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        disabled={disabled}
        placeholder={placeholder}
        rows={rows}
        spellCheck={false}
        className={cn(
          "field-sizing-fixed w-full resize-y text-sm leading-relaxed",
          mono && "font-mono text-xs",
          grow ? "min-h-[220px] flex-1" : "min-h-[160px]",
        )}
      />
    </div>
  );
}

function kitEquals(a: ProfilePromptKit, b: ProfilePromptKit): boolean {
  return (
    a.template === b.template && a.resumeTemplateJson === b.resumeTemplateJson
  );
}

export function ResumeBuilderPageClient() {
  const [profiles, setProfiles] = useState<ProfileOption[]>([]);
  const [profilesLoading, setProfilesLoading] = useState(true);
  const [profileId, setProfileId] = useState<number | null>(null);
  const [kit, setKit] = useState<ProfilePromptKit>(() => emptyProfilePromptKit());
  const [savedKit, setSavedKit] = useState<ProfilePromptKit>(() => emptyProfilePromptKit());
  const [saving, setSaving] = useState(false);
  const [health, setHealth] = useState<HealthState>({ status: "idle" });

  const dirty = profileId != null && !kitEquals(kit, savedKit);
  const editorsDisabled = profileId == null;

  const loadKitForProfile = useCallback(async (id: number) => {
    const local = readProfilePromptKit(id);
    setKit(local);
    setSavedKit(local);
    try {
      const remote = await fetchProfilePromptKit(id);
      if (!remote.exists && localPromptKitHasDraft(local)) {
        const seeded = await saveProfilePromptKit(id, local);
        writeProfilePromptKit(id, seeded.kit, undefined, { touchUpdatedAt: false });
        setKit(seeded.kit);
        setSavedKit(seeded.kit);
        void syncPromptKitToExtension(id, seeded.kit);
        return;
      }

      const next = remote.exists ? remote.kit : emptyProfilePromptKit();
      writeProfilePromptKit(id, next, undefined, { touchUpdatedAt: false });
      setKit(next);
      setSavedKit(next);
      if (remote.exists) {
        void syncPromptKitToExtension(id, next);
      }
    } catch (error) {
      // Keep localStorage kit when API fails (offline / unauthorized).
      toast.error(
        error instanceof Error ? error.message : "Failed to load prompt kit from server.",
      );
    }
  }, []);

  const refreshJson2docxHealth = useCallback(async () => {
    const settings = readJson2docxSettingsFromStorage();
    if (!settings.enabled) {
      setHealth({ status: "disabled" });
      return;
    }
    setHealth({ status: "checking" });
    const result = await fetchJson2docxHealth(settings.baseUrl);
    if (result.ok) {
      setHealth({ status: "online", version: result.version });
    } else {
      setHealth({ status: "offline", error: result.error });
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setProfilesLoading(true);
      try {
        const res = await fetch("/api/profiles", { credentials: "same-origin" });
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(err.error || "Failed to load profiles");
        }
        const data = (await res.json()) as {
          profiles?: { id: number; full_name: string }[];
        };
        if (cancelled) return;
        const list = (data.profiles ?? []).map((p) => ({
          id: p.id,
          full_name: p.full_name,
        }));
        setProfiles(list);

        const storedId = readSelectedProfileId();
        const initial =
          storedId != null && list.some((p) => p.id === storedId)
            ? storedId
            : list[0]?.id ?? null;
        setProfileId(initial);
        if (initial != null) {
          writeSelectedProfileId(initial);
          void loadKitForProfile(initial);
        } else {
          setKit(emptyProfilePromptKit());
          setSavedKit(emptyProfilePromptKit());
        }
      } catch (error) {
        if (!cancelled) {
          toast.error(
            error instanceof Error ? error.message : "Failed to load profiles",
          );
        }
      } finally {
        if (!cancelled) setProfilesLoading(false);
      }
    })();
    void refreshJson2docxHealth();
    return () => {
      cancelled = true;
    };
  }, [loadKitForProfile, refreshJson2docxHealth]);

  const selectProfile = (raw: string) => {
    const id = Number(raw);
    if (!Number.isFinite(id) || id < 1) return;
    if (dirty) {
      const ok = window.confirm(
        "You have unsaved prompt kit changes. Switch profile and discard them?",
      );
      if (!ok) return;
    }
    setProfileId(id);
    writeSelectedProfileId(id);
    void loadKitForProfile(id);
  };

  const patchKit = (partial: Partial<ProfilePromptKit>) => {
    setKit((prev) => ({ ...prev, ...partial }));
  };

  const handleSave = async () => {
    if (profileId == null) {
      toast.error("Select a profile first.");
      return;
    }
    setSaving(true);
    try {
      const payload: ProfilePromptKit = {
        ...kit,
        jobDescription: kit.jobDescription || savedKit.jobDescription || "",
        output: kit.output || savedKit.output || "",
      };
      const saved = await saveProfilePromptKit(profileId, payload);
      writeProfilePromptKit(profileId, saved.kit, undefined, { touchUpdatedAt: false });
      setKit(saved.kit);
      setSavedKit(saved.kit);
      const sync = await syncPromptKitToExtension(profileId, saved.kit);
      if (sync.synced) {
        toast.success("Prompt kit saved to your account (synced to extension).");
      } else {
        toast.success("Prompt kit saved to your account.");
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to save prompt kit.",
      );
    } finally {
      setSaving(false);
    }
  };

  const healthLabel = (() => {
    switch (health.status) {
      case "checking":
        return "Checking json2docx…";
      case "disabled":
        return "json2docx disabled";
      case "online":
        return health.version
          ? `json2docx connected (v${health.version})`
          : "json2docx connected";
      case "offline":
        return `json2docx offline (${health.error})`;
      default:
        return "json2docx…";
    }
  })();

  return (
    <JobsLayout>
      <div className="flex h-full min-h-0 w-full flex-col gap-4">
        <header className="flex shrink-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-lg font-semibold">Resume Builder</h1>
            <p className="text-xs text-muted-foreground">
              Edit and save the per-profile prompt kit to your account (works across
              Chrome profiles once signed in). Build &amp; Copy and job description live
              in the extension Register tab. Built JSON must include{" "}
              {REQUIRED_BUILT_RESUME_JSON_FIELDS.map((field) => (
                <code key={field} className="mx-0.5">
                  {field}
                </code>
              ))}
              . Keep{" "}
              <Link href="/resume-tailor" className="underline underline-offset-2">
                Resume Tailor
              </Link>{" "}
              for the workflow canvas.
            </p>
          </div>
          <div className="flex flex-col items-stretch gap-2 sm:items-end">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span
                className={cn(
                  "inline-block h-2 w-2 rounded-full bg-muted-foreground/50",
                  health.status === "online" && "bg-emerald-500",
                  health.status === "offline" && "bg-destructive",
                  health.status === "checking" && "bg-amber-500",
                )}
                aria-hidden
              />
              <span>{healthLabel}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => void refreshJson2docxHealth()}
              >
                Refresh
              </Button>
              <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" asChild>
                <Link href="/settings">Settings</Link>
              </Button>
            </div>
          </div>
        </header>

        <div className="flex shrink-0 flex-col gap-3 rounded-lg border border-border bg-muted/20 p-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="w-full space-y-1.5 sm:max-w-sm">
            <Label htmlFor="resumeBuilderProfile">Profile</Label>
            <Select
              value={profileId != null ? String(profileId) : undefined}
              onValueChange={selectProfile}
              disabled={profilesLoading || profiles.length === 0}
            >
              <SelectTrigger id="resumeBuilderProfile" className="w-full bg-background">
                <SelectValue
                  placeholder={
                    profilesLoading
                      ? "Loading profiles…"
                      : profiles.length === 0
                        ? "No profiles yet"
                        : "Select a profile"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {profiles.map((profile) => (
                  <SelectItem key={profile.id} value={String(profile.id)}>
                    {profile.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {profiles.length === 0 && !profilesLoading ? (
                <>
                  Create a profile on the{" "}
                  <Link href="/profile" className="underline underline-offset-2">
                    Profile
                  </Link>{" "}
                  page first.
                </>
              ) : dirty ? (
                "Unsaved changes for this profile."
              ) : savedKit.updatedAt ? (
                `Last saved ${new Date(savedKit.updatedAt).toLocaleString()} (account).`
              ) : (
                "No saved kit yet for this profile (uses default template)."
              )}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={() => void handleSave()}
              disabled={editorsDisabled || saving || !dirty}
            >
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save prompt kit
            </Button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4">
          <FieldBlock
            id="rb-prompt-template"
            label="Original prompt"
            hint="Template with placeholders {resume_template_json} and {job_description}. The extension fills job description from Note when building."
            value={kit.template}
            onChange={(value) => patchKit({ template: value })}
            onClear={() => patchKit({ template: "" })}
            mono
            rows={12}
            grow
            disabled={editorsDisabled}
          />

          <FieldBlock
            id="rb-resume-template-json"
            label="resume_template_json"
            hint='Include "resume_template" (e.g. Jose / Oscar) in the base JSON when possible.'
            value={kit.resumeTemplateJson}
            onChange={(value) => patchKit({ resumeTemplateJson: value })}
            onClear={() => patchKit({ resumeTemplateJson: "" })}
            placeholder='{"resume_template":"Jose","profile_title":{...}}'
            mono
            rows={10}
            grow
            disabled={editorsDisabled}
          />
        </div>
      </div>
    </JobsLayout>
  );
}
