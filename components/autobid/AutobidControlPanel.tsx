"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Loader2, Play, Square } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { LIMITS, type AutobidConfig } from "@/lib/autobid/config-shape";

type Profile = { id: number; full_name: string };

/** What a Start sends: the form's fields only (not the note, version or who saved it). */
const SETUP_FIELDS = [
  "profileId",
  "profileName",
  "submit",
  "once",
  "dailyLimit",
  "windows",
  "hours",
  "everyMinutes",
  "hiringCafe",
  "jobright",
  "freshnessHours",
  "ashby",
  "gapMin",
  "gapMax",
] as const satisfies ReadonlyArray<keyof AutobidConfig>;

/**
 * Start/Stop and the setup for the whole chain, from any computer. The
 * JobStrike panel on the VPS reads the same setup every 20 seconds and runs it.
 */
export function AutobidControlPanel({
  appliedVersion,
  panelOnline,
}: {
  /** The setup version the VPS panel last applied (from its status report). */
  appliedVersion: number | null;
  panelOnline: boolean;
}) {
  const [config, setConfig] = useState<AutobidConfig | null>(null);
  const [draft, setDraft] = useState<Partial<AutobidConfig>>({});
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/autobid/config", { credentials: "same-origin", cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as { config?: AutobidConfig; error?: string };
      if (!res.ok || !data.config) throw new Error(data.error || "Could not load the Auto-bid setup.");
      setConfig(data.config);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the Auto-bid setup.");
    }
  }, []);

  useEffect(() => {
    void load();
    void fetch("/api/profiles", { credentials: "same-origin" })
      .then((res) => (res.ok ? res.json() : { profiles: [] }))
      .then((data: { profiles?: Profile[] }) => setProfiles(data.profiles ?? []))
      .catch(() => {});
    // Follows changes made in the panel on the VPS.
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 20_000);
    return () => clearInterval(timer);
  }, [load]);

  const save = async (edit: Partial<AutobidConfig>) => {
    setSaving(true);
    try {
      const res = await fetch("/api/autobid/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(edit),
      });
      const data = (await res.json().catch(() => ({}))) as { config?: AutobidConfig; error?: string };
      if (!res.ok || !data.config) throw new Error(data.error || "Could not save.");
      setConfig(data.config);
      setDraft({});
      return data.config;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save.");
      return null;
    } finally {
      setSaving(false);
    }
  };

  if (!config) {
    return error ? (
      <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
        {error}
      </p>
    ) : null;
  }

  const view = { ...config, ...draft };
  const running = config.running;
  const applied = appliedVersion !== null && appliedVersion >= config.version;

  /** A number field left: an emptied one goes back to the saved value. */
  const changeNumber = (
    key: "dailyLimit" | "windows" | "everyMinutes" | "freshnessHours" | "gapMin" | "gapMax",
    text: string,
  ) => {
    if (text.trim() === "") {
      setDraft(({ [key]: _dropped, ...rest }) => rest);
      return;
    }
    change({ [key]: Number(text) });
  };

  /** A field changed: kept as a draft while stopped, saved at once while running. */
  const change = (edit: Partial<AutobidConfig>) => {
    if (running) void save(edit);
    else setDraft((d) => ({ ...d, ...edit }));
  };

  const startStop = async () => {
    if (running) {
      if (await save({ running: false, note: "" })) toast.success("Stopping. The VPS stops within about 20 seconds.");
      return;
    }
    const profile = profiles.find((p) => p.id === view.profileId);
    const setup = Object.fromEntries(SETUP_FIELDS.map((key) => [key, view[key]])) as Partial<AutobidConfig>;
    const saved = await save({ ...setup, profileName: profile?.full_name ?? view.profileName, running: true });
    if (saved) {
      toast.success(
        !saved.submit
          ? `Starting a dry run for ${saved.profileName}: one job is filled and left open, then it stops.`
          : saved.once
            ? `Starting a test run for ${saved.profileName}: one job is applied to and registered, then it stops.`
            : `Starting for ${saved.profileName}. The VPS picks it up within about 20 seconds.`,
      );
    }
  };

  const field = "flex flex-col gap-1 text-xs text-muted-foreground";

  return (
    <section className={cn("flex flex-col gap-3 rounded-lg border bg-card p-3 sm:p-4", running && "border-emerald-500/40")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">
            {running ? (!config.submit ? "Dry run" : config.once ? "Test run" : "Running") : "Stopped"}
            {running && config.profileName ? <span className="font-normal text-muted-foreground"> · {config.profileName}</span> : null}
          </h2>
          <p className="text-xs text-muted-foreground">
            {!panelOnline
              ? "The JobStrike panel on the VPS is not reporting: changes apply when it is open again."
              : applied
                ? "The VPS is following this setup."
                : "Waiting for the VPS to pick up the change (up to 20 seconds)…"}
          </p>
        </div>
        <Button
          size="lg"
          disabled={saving}
          onClick={() => void startStop()}
          className={cn(
            "min-w-32 rounded-lg text-white",
            running ? "bg-rose-600 hover:bg-rose-700" : "bg-emerald-600 hover:bg-emerald-700",
          )}
        >
          {saving ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : running ? (
            <Square className="mr-1.5 h-4 w-4" />
          ) : (
            <Play className="mr-1.5 h-4 w-4" />
          )}
          {running ? "Stop" : "Start"}
        </Button>
      </div>

      {config.note && !running && (
        <p className="rounded-md bg-amber-500/10 px-2 py-1.5 text-xs text-amber-800 dark:text-amber-300">{config.note}</p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className={field}>
          Profile
          <select
            className="h-9 rounded-md border bg-background px-2 text-sm text-foreground"
            value={view.profileId ?? ""}
            onChange={(e) => {
              const id = Number(e.target.value) || null;
              change({ profileId: id, profileName: profiles.find((p) => p.id === id)?.full_name ?? "" });
            }}
          >
            <option value="">Choose a profile…</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name}
              </option>
            ))}
          </select>
        </label>
        <label className={field}>
          Mode
          <select
            className="h-9 rounded-md border bg-background px-2 text-sm text-foreground"
            value={!view.submit ? "dry" : view.once ? "once" : "submit"}
            onChange={(e) => change({ submit: e.target.value !== "dry", once: e.target.value === "once" })}
          >
            <option value="dry">Dry run: fill one job, then stop</option>
            <option value="once">Test run: apply to one job with Submit, then stop</option>
            <option value="submit">Submit: apply by itself</option>
          </select>
        </label>
        <label className={field}>
          Applications per day
          <Input
            type="number"
            min={LIMITS.dailyLimit[0]}
            max={LIMITS.dailyLimit[1]}
            value={view.dailyLimit}
            onChange={(e) => setDraft((d) => ({ ...d, dailyLimit: e.target.value === "" ? ("" as unknown as number) : Number(e.target.value) }))}
            onBlur={(e) => changeNumber("dailyLimit", e.target.value)}
          />
        </label>
        <label className={field}>
          ChatGPT windows (AutoGen)
          <Input
            type="number"
            min={LIMITS.windows[0]}
            max={LIMITS.windows[1]}
            value={view.windows}
            onChange={(e) => setDraft((d) => ({ ...d, windows: e.target.value === "" ? ("" as unknown as number) : Number(e.target.value) }))}
            onBlur={(e) => changeNumber("windows", e.target.value)}
          />
        </label>
        <label className={field}>
          Check HiringCafe every (minutes)
          <Input
            type="number"
            min={LIMITS.everyMinutes[0]}
            max={LIMITS.everyMinutes[1]}
            step={5}
            value={view.everyMinutes}
            onChange={(e) => setDraft((d) => ({ ...d, everyMinutes: e.target.value === "" ? ("" as unknown as number) : Number(e.target.value) }))}
            onBlur={(e) => changeNumber("everyMinutes", e.target.value)}
          />
        </label>
        <label className={field}>
          HiringCafe: posted within (hours)
          <Input
            type="number"
            min={LIMITS.freshnessHours[0]}
            max={LIMITS.freshnessHours[1]}
            value={view.freshnessHours}
            onChange={(e) => setDraft((d) => ({ ...d, freshnessHours: e.target.value === "" ? ("" as unknown as number) : Number(e.target.value) }))}
            onBlur={(e) => changeNumber("freshnessHours", e.target.value)}
          />
        </label>
        <div className={field}>
          Minutes between applications
          <div className="flex items-center gap-2">
            <Input
              type="number"
              aria-label="At least (minutes)"
              min={LIMITS.gap[0]}
              max={LIMITS.gap[1]}
              value={view.gapMin}
              onChange={(e) => setDraft((d) => ({ ...d, gapMin: e.target.value === "" ? ("" as unknown as number) : Number(e.target.value) }))}
              onBlur={(e) => changeNumber("gapMin", e.target.value)}
            />
            <span className="text-foreground">–</span>
            <Input
              type="number"
              aria-label="At most (minutes)"
              min={LIMITS.gap[0]}
              max={LIMITS.gap[1]}
              value={view.gapMax}
              onChange={(e) => setDraft((d) => ({ ...d, gapMax: e.target.value === "" ? ("" as unknown as number) : Number(e.target.value) }))}
              onBlur={(e) => changeNumber("gapMax", e.target.value)}
            />
          </div>
        </div>
        <div className={field}>
          Sources
          <div className="flex h-9 items-center gap-4 text-sm text-foreground">
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={view.hiringCafe} onChange={(e) => change({ hiringCafe: e.target.checked })} />
              HiringCafe
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={view.jobright} onChange={(e) => change({ jobright: e.target.checked })} />
              Jobright
            </label>
          </div>
        </div>
        <label className={cn(field, "sm:col-span-2")}>
          Look for jobs only between (VPS clock; empty = all day)
          <Input
            value={view.hours}
            placeholder="All day"
            onChange={(e) => setDraft((d) => ({ ...d, hours: e.target.value }))}
            onBlur={(e) => change({ hours: e.target.value })}
          />
        </label>
        <label className={cn(field, "sm:col-span-2 justify-end")}>
          <span className="flex h-9 items-center gap-1.5 text-sm text-foreground">
            <input type="checkbox" checked={view.ashby} onChange={(e) => change({ ashby: e.target.checked })} />
            Queue Ashby jobs too (filled, then left for you to press Submit)
          </span>
        </label>
      </div>
      {!running && Object.keys(draft).length > 0 && (
        <p className="text-xs text-muted-foreground">Changes are saved when you press Start.</p>
      )}
    </section>
  );
}
