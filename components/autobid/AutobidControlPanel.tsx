"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Loader2, Play, Rocket, Settings2, Square } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useActiveProfile } from "@/components/active-profile";
import { LIMITS, type AutobidConfig } from "@/lib/autobid/config-shape";

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

type NumberKey = "dailyLimit" | "windows" | "everyMinutes" | "freshnessHours" | "gapMin" | "gapMax";

export function AutobidControlPanel({
  appliedVersion,
  panelOnline,
  sentToday,
  onConfig,
  footer,
}: {
  appliedVersion: number | null;
  panelOnline: boolean;
  sentToday: number;
  onConfig?: (config: AutobidConfig) => void;
  footer?: React.ReactNode;
}) {
  const [config, setConfig] = useState<AutobidConfig | null>(null);
  const [draft, setDraft] = useState<Partial<AutobidConfig>>({});
  const { profiles } = useActiveProfile();
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
  }, [load]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, config?.running ? 20_000 : 60_000);
    return () => clearInterval(timer);
  }, [load, config?.running]);

  useEffect(() => {
    if (config) onConfig?.(config);
  }, [config, onConfig]);

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
      <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
        {error}
      </p>
    ) : null;
  }

  const view = { ...config, ...draft };
  const running = config.running;
  const applied = appliedVersion !== null && appliedVersion >= config.version;
  const mode = !view.submit ? "dry" : view.once ? "once" : "submit";

  const change = (edit: Partial<AutobidConfig>) => {
    if (running) void save(edit);
    else setDraft((d) => ({ ...d, ...edit }));
  };

  const numberInput = (key: NumberKey, limits: readonly [number, number], step?: number, label?: string) => (
    <Input
      type="number"
      aria-label={label}
      min={limits[0]}
      max={limits[1]}
      step={step}
      value={view[key]}
      onChange={(e) =>
        setDraft((d) => ({ ...d, [key]: e.target.value === "" ? ("" as unknown as number) : Number(e.target.value) }))
      }
      onBlur={(e) => {
        if (e.target.value.trim() === "") setDraft(({ [key]: _dropped, ...rest }) => rest);
        else change({ [key]: Number(e.target.value) });
      }}
    />
  );

  const startStop = async () => {
    if (running) {
      if (await save({ running: false, note: "" })) toast.success("Stopping. The VPS stops within about 20 seconds.");
      return;
    }
    if (!view.profileId) {
      toast.error("Choose a profile first.");
      return;
    }
    const profile = profiles.find((p) => p.id === view.profileId);
    const setup = Object.fromEntries(SETUP_FIELDS.map((key) => [key, view[key]])) as Partial<AutobidConfig>;
    const saved = await save({ ...setup, profileName: profile?.full_name ?? view.profileName, running: true });
    if (saved) {
      toast.success(
        !saved.submit
          ? `Dry run for ${saved.profileName}: one job is filled and left open, then it stops.`
          : saved.once
            ? `Test run for ${saved.profileName}: one job is applied to, then it stops.`
            : `Started for ${saved.profileName}. The VPS picks it up within about 20 seconds.`,
      );
    }
  };

  const status = !running
    ? { tone: "idle", label: "Auto-bid is off", sub: "Press Start and it finds jobs, writes resumes and applies for you." }
    : !panelOnline
      ? { tone: "warn", label: "Waiting for the VPS", sub: "Started, but the JobStrike panel on the VPS isn't responding yet." }
      : !applied
        ? { tone: "warn", label: "Starting…", sub: "Sending your setup to the VPS." }
        : { tone: "on", label: "Auto-bid is running", sub: `Applying as ${config.profileName || "your profile"}.` };
  const percent = Math.min(100, Math.round((sentToday / Math.max(1, config.dailyLimit)) * 100));

  return (
    <Card
      className={cn(
        "gap-0 overflow-hidden border-border/70 py-0 shadow-none",
        status.tone === "on" && "border-primary/30",
        status.tone === "warn" && "border-amber-500/30",
      )}
    >
      <CardContent className="p-0">
        <div
          className={cn(
            "flex flex-col gap-5 p-5 lg:flex-row lg:items-center lg:gap-8",
            status.tone === "on" && "bg-primary/[0.04]",
          )}
        >
          {/* Status */}
          <div className="flex min-w-0 flex-1 items-center gap-4">
            <span
              className={cn(
                "relative flex h-12 w-12 shrink-0 items-center justify-center rounded-xl",
                status.tone === "on" && "bg-primary/10 text-primary",
                status.tone === "warn" && "bg-amber-500/15 text-amber-700 dark:text-amber-400",
                status.tone === "idle" && "bg-muted text-muted-foreground",
              )}
            >
              <Rocket className="h-5 w-5" />
              <span
                className={cn(
                  "absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-card",
                  status.tone === "on" && "bg-emerald-500",
                  status.tone === "warn" && "animate-pulse bg-amber-500",
                  status.tone === "idle" && "bg-muted-foreground/40",
                )}
              />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold tracking-tight">{status.label}</h2>
                {mode !== "submit" && (
                  <span className="rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                    {mode === "dry" ? "Dry run" : "Test run"}
                  </span>
                )}
              </div>
              <p className="text-sm text-muted-foreground">{status.sub}</p>
            </div>
          </div>

          {/* Today's progress */}
          <div className="w-full lg:w-60">
            <div className="flex items-baseline justify-between">
              <span className="text-xs font-medium text-muted-foreground">Sent today</span>
              <span className="tabular-nums">
                <span className="text-xl font-semibold tracking-tight">{sentToday}</span>
                <span className="text-sm text-muted-foreground"> / {config.dailyLimit}</span>
              </span>
            </div>
            <Progress value={percent} className="mt-2 h-1.5" />
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              {sentToday >= config.dailyLimit
                ? "Daily limit reached. It continues tomorrow."
                : `${config.dailyLimit - sentToday} left today`}
            </p>
          </div>

          {/* Actions */}
          <div className="flex shrink-0 items-center gap-2">
            <SettingsDialog view={view} running={running} change={change}
              setHours={(hours) => setDraft((d) => ({ ...d, hours }))}
              numberInput={numberInput} mode={mode}
            />
            <Button
              disabled={saving}
              onClick={() => void startStop()}
              className={cn(
                "h-10 min-w-[120px] flex-1 lg:flex-none",
                running
                  ? "bg-rose-600 text-white hover:bg-rose-700 dark:bg-rose-600 dark:hover:bg-rose-700"
                  : "bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-700",
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
        </div>

        {config.note && !running && (
          <p className="mx-5 mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
            {config.note}
          </p>
        )}

        {/* Profile + daily limit */}
        <div className="grid grid-cols-1 gap-3 border-t border-border/60 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_140px]">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Apply as</span>
            <Select
              value={view.profileId ? String(view.profileId) : ""}
              onValueChange={(v) => {
                const id = Number(v) || null;
                change({ profileId: id, profileName: profiles.find((p) => p.id === id)?.full_name ?? "" });
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Choose a profile…" />
              </SelectTrigger>
              <SelectContent>
                {profiles.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>{p.full_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Daily limit</span>
            {numberInput("dailyLimit", LIMITS.dailyLimit)}
          </label>
          {!running && Object.keys(draft).length > 0 && (
            <p className="text-[11px] text-muted-foreground sm:col-span-2">Changes are saved when you press Start.</p>
          )}
        </div>

        {footer && <div className="border-t border-border/60 bg-muted/30 px-5 py-3">{footer}</div>}
      </CardContent>
    </Card>
  );
}

/* ─── Settings dialog ─── */

function SettingsDialog({
  view, running, change, setHours, numberInput, mode,
}: {
  view: AutobidConfig;
  running: boolean;
  change: (edit: Partial<AutobidConfig>) => void;
  setHours: (hours: string) => void;
  numberInput: (key: NumberKey, limits: readonly [number, number], step?: number, label?: string) => React.ReactNode;
  mode: "dry" | "once" | "submit";
}) {
  const field = "flex flex-col gap-1.5";
  const labelCls = "text-sm font-medium";
  const hint = "text-xs text-muted-foreground";
  const toggle =
    "flex cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2.5 text-sm transition-colors hover:bg-muted/60";

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="icon" className="h-9 w-9" title="Settings" aria-label="Settings">
          <Settings2 className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Auto-bid settings</DialogTitle>
          <DialogDescription>
            The defaults work for most people. {running ? "Changes apply right away." : "Changes are saved when you press Start."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 pt-2">
          <div className={field}>
            <span className={labelCls}>Run mode</span>
            <Select value={mode} onValueChange={(v) => change({ submit: v !== "dry", once: v === "once" })}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="submit">Full auto: apply continuously</SelectItem>
                <SelectItem value="once">Test: apply to one job, then stop</SelectItem>
                <SelectItem value="dry">Dry run: fill one job without submitting</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className={field}>
            <span className={labelCls}>Where to find jobs</span>
            <div className="grid grid-cols-2 gap-2">
              <label className={toggle}>
                <input type="checkbox" className="accent-primary" checked={view.hiringCafe} onChange={(e) => change({ hiringCafe: e.target.checked })} />
                HiringCafe
              </label>
              <label className={toggle}>
                <input type="checkbox" className="accent-primary" checked={view.jobright} onChange={(e) => change({ jobright: e.target.checked })} />
                Jobright
              </label>
            </div>
          </div>

          <div className={field}>
            <span className={labelCls}>Only run during these hours</span>
            <Input
              value={view.hours}
              placeholder="All day (e.g. 09:00-18:00)"
              onChange={(e) => setHours(e.target.value)}
              onBlur={(e) => change({ hours: e.target.value })}
            />
            <span className={hint}>VPS clock. Leave empty to run all day.</span>
          </div>

          <details className="group rounded-lg border border-border/60">
            <summary className="cursor-pointer select-none px-3 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground">
              Advanced tuning
            </summary>
            <div className="grid grid-cols-2 gap-3 border-t border-border/60 p-3">
              <label className={field}>
                <span className={hint}>Check for jobs every (min)</span>
                {numberInput("everyMinutes", LIMITS.everyMinutes, 5)}
              </label>
              <label className={field}>
                <span className={hint}>Only jobs posted within (h)</span>
                {numberInput("freshnessHours", LIMITS.freshnessHours)}
              </label>
              <div className={cn(field, "col-span-2 sm:col-span-1")}>
                <span className={hint}>Wait between applications (min)</span>
                <div className="flex items-center gap-2">
                  {numberInput("gapMin", LIMITS.gap, undefined, "At least")}
                  <span className="text-muted-foreground">–</span>
                  {numberInput("gapMax", LIMITS.gap, undefined, "At most")}
                </div>
              </div>
              <label className={cn(field, "col-span-2 sm:col-span-1")}>
                <span className={hint}>Resumes written at once</span>
                {numberInput("windows", LIMITS.windows)}
              </label>
            </div>
          </details>
        </div>
      </DialogContent>
    </Dialog>
  );
}
