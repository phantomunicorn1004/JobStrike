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
import {
  buildPrompt,
  DEFAULT_PROMPT_TEMPLATE,
  REQUIRED_BUILT_RESUME_JSON_FIELDS,
} from "@/lib/promptBuilder";
import {
  emptyProfilePromptKit,
  readProfilePromptKit,
  readSelectedProfileId,
  writeProfilePromptKit,
  writeSelectedProfileId,
  type ProfilePromptKit,
} from "@/lib/resume-builder/promptKitStorage";
import {
  fetchPromptKitFromExtension,
  pickNewerPromptKit,
  PROMPT_KIT_BRIDGE_SOURCE,
  syncPromptKitToExtension,
  type PromptKitBridgeChangedMessage,
} from "@/lib/resume-builder/promptKitExtensionSync";
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
  headerActions,
  readOnly = false,
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
  headerActions?: React.ReactNode;
  readOnly?: boolean;
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
        {headerActions ? (
          <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-1.5">
            {headerActions}
          </div>
        ) : onClear ? (
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
        readOnly={readOnly}
        disabled={disabled}
        placeholder={placeholder}
        rows={rows}
        spellCheck={false}
        className={cn(
          "field-sizing-fixed w-full resize-y text-sm leading-relaxed",
          mono && "font-mono text-xs",
          grow ? "min-h-[200px] flex-1" : "min-h-[120px]",
        )}
      />
    </div>
  );
}

function kitEquals(a: ProfilePromptKit, b: ProfilePromptKit): boolean {
  return (
    a.template === b.template &&
    a.resumeTemplateJson === b.resumeTemplateJson &&
    a.jobDescription === b.jobDescription &&
    a.output === b.output
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
      const fromExt = await fetchPromptKitFromExtension(id);
      if (!fromExt.available) return;

      const merged = pickNewerPromptKit(local, fromExt.kit, fromExt.exists);
      writeProfilePromptKit(id, merged, undefined, { touchUpdatedAt: false });
      setKit(merged);
      setSavedKit(merged);

      // If this browser's kit is newer (or extension empty), push it into the extension.
      const localIsNewer = merged === local && Boolean(local.updatedAt);
      const extensionMissing = !fromExt.exists;
      if (localIsNewer || (extensionMissing && Boolean(local.updatedAt))) {
        void syncPromptKitToExtension(id, local);
      }
    } catch {
      // Keep localStorage kit when bridge fails.
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

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window) return;
      const data = event.data as PromptKitBridgeChangedMessage | null;
      if (!data || data.source !== PROMPT_KIT_BRIDGE_SOURCE) return;
      if (data.type !== "prompt-kit-changed") return;
      if (profileId == null || data.profileId !== profileId) return;
      if (dirty) return;
      const next = data.kit;
      writeProfilePromptKit(profileId, next, undefined, { touchUpdatedAt: false });
      setKit(next);
      setSavedKit(next);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [profileId, dirty]);

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
      const next = writeProfilePromptKit(profileId, kit);
      setKit(next);
      setSavedKit(next);
      const sync = await syncPromptKitToExtension(profileId, next);
      if (sync.synced) {
        if (sync.kit) {
          setKit(sync.kit);
          setSavedKit(sync.kit);
          writeProfilePromptKit(profileId, sync.kit, undefined, {
            touchUpdatedAt: false,
          });
        }
        toast.success("Prompt kit saved and synced to the extension.");
      } else if (!sync.ok) {
        toast.error(sync.error || "Saved locally, but extension sync failed.");
      } else {
        toast.success(
          "Prompt kit saved in this browser. Open this site with Remote Helper Ext enabled to sync.",
        );
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to save prompt kit.",
      );
    } finally {
      setSaving(false);
    }
  };

  const handleBuild = () => {
    if (profileId == null) {
      toast.error("Select a profile first.");
      return;
    }
    const { prompt, missingPlaceholders } = buildPrompt(
      kit.template,
      kit.resumeTemplateJson,
      kit.jobDescription,
    );
    patchKit({ output: prompt });
    if (missingPlaceholders.length > 0) {
      toast.warning(`Built with empty: ${missingPlaceholders.join(", ")}`);
      return;
    }
    toast.success("Prompt built");
  };

  const handleBuildAndCopy = async () => {
    if (profileId == null) {
      toast.error("Select a profile first.");
      return;
    }
    const { prompt, missingPlaceholders } = buildPrompt(
      kit.template,
      kit.resumeTemplateJson,
      kit.jobDescription,
    );
    patchKit({ output: prompt });
    if (!prompt.trim()) {
      toast.error("Nothing to copy.");
      return;
    }
    try {
      await navigator.clipboard.writeText(prompt);
      if (missingPlaceholders.length > 0) {
        toast.warning(`Copied (empty: ${missingPlaceholders.join(", ")})`);
      } else {
        toast.success("Built and copied");
      }
    } catch {
      toast.error("Built, but copy failed");
    }
  };

  const handleCopy = async () => {
    if (!kit.output.trim()) {
      toast.error("Build a prompt first.");
      return;
    }
    try {
      await navigator.clipboard.writeText(kit.output);
      toast.success("Copied");
    } catch {
      toast.error("Copy failed");
    }
  };

  const handleResetTemplate = () => {
    patchKit({ template: DEFAULT_PROMPT_TEMPLATE });
    toast.success("Template reset");
  };

  const handleClearInputs = () => {
    patchKit({ resumeTemplateJson: "", jobDescription: "" });
    toast.success("Inputs cleared");
  };

  const handleClearAll = () => {
    setKit(emptyProfilePromptKit());
    toast.success("Cleared all");
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
              Per-profile prompt kit for the GPT-assisted JSON path. Built JSON must
              include{" "}
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
                `Last saved ${new Date(savedKit.updatedAt).toLocaleString()} (local).`
              ) : (
                "No saved kit yet for this profile (uses default template)."
              )}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={handleSave}
              disabled={editorsDisabled || saving || !dirty}
            >
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save prompt kit
            </Button>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-2 lg:items-stretch">
          <div className="flex min-h-0 flex-col gap-4">
            <FieldBlock
              id="rb-prompt-template"
              label="Original prompt"
              hint="Template with placeholders {resume_template_json} and {job_description}."
              value={kit.template}
              onChange={(value) => patchKit({ template: value })}
              onClear={() => patchKit({ template: "" })}
              mono
              rows={8}
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
              rows={6}
              disabled={editorsDisabled}
            />

            <FieldBlock
              id="rb-job-description"
              label="job_description"
              value={kit.jobDescription}
              onChange={(value) => patchKit({ jobDescription: value })}
              onClear={() => patchKit({ jobDescription: "" })}
              placeholder="Paste job description..."
              rows={6}
              disabled={editorsDisabled}
            />
          </div>

          <FieldBlock
            id="rb-prompt-output"
            label="Final prompt"
            hint="Build for the selected profile, then copy into GPT."
            value={kit.output}
            readOnly
            placeholder={
              editorsDisabled
                ? "Select a profile to build a prompt…"
                : "Output appears here..."
            }
            mono
            rows={20}
            grow
            disabled={editorsDisabled}
            headerActions={
              <>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleBuild}
                  disabled={editorsDisabled}
                >
                  Build
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => void handleBuildAndCopy()}
                  disabled={editorsDisabled}
                >
                  Build + Copy
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void handleCopy()}
                  disabled={editorsDisabled || !kit.output.trim()}
                >
                  Copy
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={handleResetTemplate}
                  disabled={editorsDisabled}
                >
                  Reset template
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={handleClearInputs}
                  disabled={editorsDisabled}
                >
                  Clear inputs
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={handleClearAll}
                  disabled={editorsDisabled}
                >
                  Clear all
                </Button>
              </>
            }
          />
        </div>
      </div>
    </JobsLayout>
  );
}
