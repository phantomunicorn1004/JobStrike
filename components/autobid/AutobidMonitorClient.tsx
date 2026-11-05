"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Circle,
  ExternalLink,
  FileText,
  Hand,
  Loader2,
  RefreshCw,
  Rocket,
  Search,
  Send,
  TriangleAlert,
  X,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { TONE_DOT, TONE_PILL, type Tone } from "@/lib/ui/tone";
import { useActiveProfile } from "@/components/active-profile";
import { CandidateAvatar } from "@/components/candidate-avatar";
import { AutobidControlPanel } from "@/components/autobid/AutobidControlPanel";
import { CompanyAvatar } from "@/components/autobid/CompanyAvatar";
import { FoundJobsList } from "@/components/autobid/FoundJobsList";
import { FieldReport } from "@/components/autobid/FieldReport";
import { PanelList, type WorkerEntry } from "@/components/autobid/PanelList";
import {
  RunnerStatusPanel,
  type AutobidReport,
  type AutogenReport,
} from "@/components/autobid/RunnerStatusPanel";
import type { AutobidConfig } from "@/lib/autobid/config-shape";
import type { FoundListEntry } from "@/lib/autobid/candidates";
import {
  STAGE_GROUP,
  type AutobidGroup,
  type AutobidJob,
  type AutobidStage,
  type AutobidStep,
} from "@/lib/autobid/stages";

const REFRESH_RUNNING_MS = 20_000;
const REFRESH_IDLE_MS = 60_000;
const STALE_MS = 20 * 60 * 1000;
const OFFLINE_MS = 3 * 60 * 1000;
const QUEUE_PREVIEW = 3;

type View = AutobidGroup | "found";
type Focus = "writing" | "applying" | null;

type Runners = {
  autobid: AutobidReport | null;
  autogen: AutogenReport | null;
  workers?: WorkerEntry[];
  setupError?: string;
};

const FOCUS_STAGES: Record<Exclude<Focus, null>, AutobidStage[]> = {
  writing: ["queued", "generating"],
  applying: ["ready", "applying"],
};

const STAGE_LABEL: Record<AutobidStage, string> = {
  queued: "Waiting for resume",
  generating: "Writing resume",
  gen_failed: "Resume failed",
  ready: "Ready to apply",
  applying: "Applying now",
  needs_you: "Needs you",
  failed: "Failed",
  sent: "Sent, not saved",
  expired: "Expired",
  registered: "Applied",
};

const STAGE_TONE: Record<AutobidStage, Tone> = {
  queued: "idle",
  generating: "progress",
  gen_failed: "danger",
  ready: "idle",
  applying: "progress",
  needs_you: "attention",
  failed: "danger",
  sent: "attention",
  expired: "idle",
  registered: "success",
};

const STAGE_PILL = Object.fromEntries(
  Object.entries(STAGE_TONE).map(([stage, tone]) => [stage, TONE_PILL[tone]]),
) as Record<AutobidStage, string>;

function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function formatTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return d.getTime() >= startOfToday() ? time : `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
}

function formatAgo(iso: string | null, now: number): string {
  if (!iso) return "";
  const ms = now - new Date(iso).getTime();
  if (Number.isNaN(ms)) return "";
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function isOnline(reportedAt: string | undefined, now: number): boolean {
  return Boolean(reportedAt) && now - new Date(String(reportedAt)).getTime() < OFFLINE_MS;
}

function canRetry(job: AutobidJob): boolean {
  return job.stage === "gen_failed" || ((job.stage === "needs_you" || job.stage === "failed") && !job.submitClicked);
}

/* ─── System health (shown at the bottom of the control card) ─── */

function healthOf(runners: Runners, running: boolean, now: number) {
  const issues: string[] = [];
  const add = (text: string | undefined) => {
    if (text && !issues.includes(text)) issues.push(text);
  };
  const a = runners.autobid;
  const g = runners.autogen;
  const aOnline = isOnline(a?.reportedAt, now);
  const gOnline = isOnline(g?.reportedAt, now);
  const writers = (g?.windows ?? []).filter((w) => w.running).length;

  add(runners.setupError);
  if (running && !aOnline) add("The JobStrike panel on the VPS isn't responding. Open Chrome and the JobStrike panel there.");
  if (aOnline && a) {
    add(a.setupError);
    for (const check of a.checks ?? []) {
      if (check.ok === false) add(check.note ? `${check.label}: ${check.note}` : check.label);
    }
    if (a.live?.challenge) add(a.live.status || "Job search is paused by a site check.");
  }
  if (running && aOnline && !gOnline) add("AutoGen isn't responding, so no resumes are being written.");
  if (running && gOnline && writers === 0) add("No resume writer is running on the VPS.");

  return { issues, aOnline, gOnline, writers, lastSearch: a?.live?.lastCheckAt ?? null, lastAdded: a?.live?.lastAdded ?? 0 };
}

function HealthStrip({ runners, running, now }: { runners: Runners; running: boolean; now: number }) {
  const h = healthOf(runners, running, now);
  const dot = (ok: boolean) => (
    <span
      className={cn(
        "h-1.5 w-1.5 rounded-full",
        ok ? "bg-emerald-500" : running ? "bg-rose-500" : "bg-muted-foreground/40",
      )}
    />
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          {dot(h.aOnline)}
          VPS {h.aOnline ? "online" : "offline"}
        </span>
        <span className="inline-flex items-center gap-1.5">
          {dot(h.gOnline && h.writers > 0)}
          {h.gOnline ? `${h.writers} resume writer${h.writers === 1 ? "" : "s"}` : "AutoGen offline"}
        </span>
        {h.lastSearch && (
          <span>
            Last search {formatTime(h.lastSearch)} · {h.lastAdded} new
          </span>
        )}
        <Sheet>
          <SheetTrigger asChild>
            <button type="button" className="ml-auto font-medium text-primary hover:underline">
              System details
            </button>
          </SheetTrigger>
          <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
            <SheetHeader>
              <SheetTitle>System details</SheetTitle>
              <SheetDescription>What the VPS reports: the JobStrike panel, AutoGen and its resume writers.</SheetDescription>
            </SheetHeader>
            <div className="space-y-3 px-4 pb-6">
              <RunnerStatusPanel
                autobid={runners.autobid}
                autogen={runners.autogen}
                setupError={runners.setupError}
                now={now}
                ago={(iso) => formatAgo(iso, now)}
                time={formatTime}
              />
              {runners.workers && <PanelList workers={runners.workers} now={now} ago={(iso) => formatAgo(iso, now)} />}
            </div>
          </SheetContent>
        </Sheet>
      </div>
      {h.issues.length > 0 && (
        <ul className="space-y-1">
          {h.issues.map((issue) => (
            <li key={issue} className="flex items-start gap-2 text-xs text-amber-800 dark:text-amber-300">
              <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" />
              {issue}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ─── Pipeline: Found → Writing → Applying → Sent ─── */

type FlowStep = {
  key: string;
  label: string;
  count: number;
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
  live: boolean;
  selected: boolean;
  onPick: () => void;
};

function Pipeline({ steps }: { steps: FlowStep[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {steps.map((s, index) => (
        <button
          key={s.key}
          type="button"
          onClick={s.onPick}
          className={cn(
            "group relative rounded-xl border bg-card p-4 text-left transition-colors hover:bg-muted/40",
            s.selected ? "border-primary/40 bg-primary/[0.04]" : "border-border/70",
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-muted-foreground">{s.label}</span>
            <span
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-lg",
                s.live ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
              )}
            >
              <s.icon className="h-3.5 w-3.5" />
            </span>
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className={cn("text-2xl font-semibold tabular-nums tracking-tight sm:text-3xl", s.count === 0 && "text-muted-foreground/50")}>
              {s.count}
            </span>
            {s.live && (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-primary">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/60" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
                </span>
                live
              </span>
            )}
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">{s.hint}</p>
          {index < steps.length - 1 && (
            <span className="absolute -right-[18px] top-1/2 z-10 hidden h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full border border-border/70 bg-background text-muted-foreground lg:flex">
              <ChevronRight className="h-3.5 w-3.5" />
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

/* ─── Needs-you queue ─── */

function AttentionQueue({
  jobs, busyIds, onRetry, onSeeAll,
}: {
  jobs: AutobidJob[];
  busyIds: Set<number>;
  onRetry: (job: AutobidJob) => void;
  onSeeAll: () => void;
}) {
  return (
    <Card className="gap-0 overflow-hidden border-amber-500/30 py-0 shadow-none">
      <div className="flex items-center gap-3 border-b border-amber-500/20 bg-amber-500/[0.06] px-4 py-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-700 dark:text-amber-400">
          <Hand className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">
            {jobs.length} job{jobs.length === 1 ? " needs" : "s need"} you
          </p>
          <p className="text-xs text-muted-foreground">Auto-bid stopped on these. Finish them by hand or retry.</p>
        </div>
        {jobs.length > QUEUE_PREVIEW && (
          <Button variant="ghost" size="sm" className="h-8 shrink-0 text-xs" onClick={onSeeAll}>
            See all
            <ChevronRight className="ml-0.5 h-3.5 w-3.5" />
          </Button>
        )}
      </div>
      <ul className="divide-y divide-border/60">
        {jobs.slice(0, QUEUE_PREVIEW).map((job) => (
          <li key={job.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <CompanyAvatar name={job.company} />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{job.company || "Job"}</span>
                  <span className={cn("shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium", STAGE_PILL[job.stage])}>
                    {STAGE_LABEL[job.stage]}
                  </span>
                </div>
                <p className="truncate text-xs text-muted-foreground">{job.jobTitle}</p>
                {job.reason && (
                  <p className="mt-1 line-clamp-2 text-xs text-amber-800 dark:text-amber-300" title={job.reason}>
                    {job.reason}
                  </p>
                )}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2 pl-12 sm:pl-0">
              {canRetry(job) && (
                <Button variant="outline" size="sm" className="h-8" disabled={busyIds.has(job.id)} onClick={() => onRetry(job)}>
                  {busyIds.has(job.id) ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1 h-3.5 w-3.5" />}
                  Retry
                </Button>
              )}
              {job.jobLink && (
                <Button asChild size="sm" className="h-8">
                  <a href={job.jobLink} target="_blank" rel="noreferrer">
                    Open job
                    <ExternalLink className="ml-1 h-3.5 w-3.5" />
                  </a>
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* ─── Job rows ─── */

function MiniProgress({ steps, className }: { steps: AutobidStep[]; className?: string }) {
  return (
    <div className={cn("flex items-center gap-1", className)} title={steps.map((s) => `${s.label}: ${s.state}`).join(" · ")}>
      {steps.map((step) => (
        <span
          key={step.key}
          className={cn(
            "h-1.5 flex-1 rounded-full",
            step.state === "done" && TONE_DOT.success,
            step.state === "current" && cn("animate-pulse", TONE_DOT.progress),
            step.state === "failed" && TONE_DOT.danger,
            step.state === "pending" && "bg-muted",
          )}
        />
      ))}
    </div>
  );
}

function StepIcon({ step }: { step: AutobidStep }) {
  if (step.state === "done") return <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />;
  if (step.state === "current") return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
  if (step.state === "failed") return <XCircle className="h-4 w-4 text-rose-600 dark:text-rose-400" />;
  return <Circle className="h-4 w-4 text-muted-foreground/30" />;
}

function Timeline({ steps }: { steps: AutobidStep[] }) {
  return (
    <ol className="grid grid-cols-5 gap-1">
      {steps.map((step, index) => (
        <li key={step.key} className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center gap-1">
            <StepIcon step={step} />
            {index < steps.length - 1 && (
              <span className={cn("h-px flex-1", step.state === "done" ? "bg-emerald-500/40" : "bg-border")} />
            )}
          </div>
          <span className={cn("text-xs", step.state === "pending" ? "text-muted-foreground/60" : "font-medium")}>{step.label}</span>
          {step.at && <span className="text-[10px] tabular-nums text-muted-foreground">{formatTime(step.at)}</span>}
        </li>
      ))}
    </ol>
  );
}

function JobRow({
  job, now, open, busy, onToggle, onRetry,
}: {
  job: AutobidJob;
  now: number;
  open: boolean;
  busy: boolean;
  onToggle: () => void;
  onRetry: (job: AutobidJob) => void;
}) {
  const lastWord = job.log.at(-1)?.at ?? null;
  const silent = job.stage === "applying" && lastWord && now - new Date(lastWord).getTime() > STALE_MS;

  return (
    <li className={cn(open && "bg-muted/20")}>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
        className="flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/30"
      >
        <CompanyAvatar name={job.company} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{job.company || "Job"}</span>
            {job.dryRun && job.stage !== "registered" && (
              <span className="shrink-0 rounded-md border px-1.5 text-[10px] text-muted-foreground">Dry run</span>
            )}
            <span className={cn("shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium sm:hidden", STAGE_PILL[job.stage])}>
              {STAGE_LABEL[job.stage]}
            </span>
          </div>
          <p className="truncate text-xs text-muted-foreground" title={job.jobTitle}>
            {job.jobTitle || "Untitled position"}
          </p>
          {job.stage === "applying" && (
            <p className={cn("mt-0.5 flex items-center gap-1 truncate text-xs", silent ? "text-amber-700 dark:text-amber-400" : "text-primary")}>
              {silent ? <TriangleAlert className="h-3 w-3 shrink-0" /> : <Loader2 className="h-3 w-3 shrink-0 animate-spin" />}
              <span className="truncate">
                {silent ? `No update since ${formatTime(lastWord)}. Is the panel still open?` : job.currentStep || "Working…"}
              </span>
            </p>
          )}
        </div>
        {job.profileId !== null && (
          <span className="hidden md:block" title={job.candidate}>
            <CandidateAvatar profileId={job.profileId} name={job.candidate} className="h-5 w-5 text-[9px]" />
          </span>
        )}
        <MiniProgress steps={job.steps} className="hidden w-24 md:flex" />
        <span className={cn("hidden w-[118px] rounded-md px-2 py-1 text-center text-[11px] font-medium sm:inline-block", STAGE_PILL[job.stage])}>
          {STAGE_LABEL[job.stage]}
        </span>
        <span className="hidden w-14 text-right text-xs tabular-nums text-muted-foreground lg:block">
          {formatAgo(job.updatedAt, now)}
        </span>
        <div className="flex shrink-0 items-center" onClick={(e) => e.stopPropagation()}>
          {canRetry(job) && (
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" disabled={busy}
              title={job.stage === "gen_failed" ? "Write the resume again" : "Try applying again"}
              onClick={() => onRetry(job)}
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            </Button>
          )}
          {job.jobLink && (
            <Button asChild variant="ghost" size="sm" className="h-8 w-8 p-0">
              <a href={job.jobLink} target="_blank" rel="noreferrer" title="Open the job posting">
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </Button>
          )}
        </div>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </div>

      {open && (
        <div className="space-y-4 border-t border-border/60 px-4 py-4 sm:pl-16">
          <Timeline steps={job.steps} />

          {job.reason && (
            <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <div>
                {job.submitClicked && job.stage !== "sent" && <span className="font-medium">Submit was already clicked. </span>}
                {job.reason}
              </div>
            </div>
          )}

          {job.log.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground">Activity</p>
              <ol className="space-y-1 border-l-2 border-border pl-3 text-xs">
                {job.log.map((entry, index) => (
                  <li key={`${entry.at}-${index}`} className="flex gap-3">
                    <span className="w-16 shrink-0 tabular-nums text-muted-foreground">{formatTime(entry.at)}</span>
                    <span className="min-w-0 break-words">{entry.text}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
          {job.log.length > 1 && <FieldReport jobId={job.id} />}
          {job.candidate && <p className="text-[11px] text-muted-foreground">Profile: {job.candidate}</p>}
        </div>
      )}
    </li>
  );
}

/* ─── Empty states ─── */

const EMPTY: Record<AutobidGroup, { icon: React.ComponentType<{ className?: string }>; title: string; body: string }> = {
  active: {
    icon: Rocket,
    title: "Nothing in progress",
    body: "When a matching job is found, a resume is written and the application is sent automatically.",
  },
  attention: {
    icon: CheckCircle2,
    title: "Nothing needs you",
    body: "Every job is being handled automatically.",
  },
  done: {
    icon: Send,
    title: "No finished jobs yet",
    body: "Sent applications are saved to Resume DB and listed here.",
  },
};

function Empty({ group, running, query }: { group: AutobidGroup; running: boolean; query: string }) {
  const e = EMPTY[group];
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
        <e.icon className="h-5 w-5 text-muted-foreground" />
      </span>
      <div>
        <p className="font-medium">{query ? "No matching jobs" : e.title}</p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
          {query ? "Try another company or title." : `${group === "active" && !running ? "Press Start above to begin. " : ""}${e.body}`}
        </p>
      </div>
    </div>
  );
}

/* ─── Page ─── */

export function AutobidMonitorClient() {
  const [jobs, setJobs] = useState<AutobidJob[] | null>(null);
  const [found, setFound] = useState<FoundListEntry[] | null>(null);
  const [runners, setRunners] = useState<Runners | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadedAt, setLoadedAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [tab, setTab] = useState<View>("active");
  const [focus, setFocus] = useState<Focus>(null);
  const [query, setQuery] = useState("");
  const [openIds, setOpenIds] = useState<Set<number>>(new Set());
  const [busyIds, setBusyIds] = useState<Set<number>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const opts = { credentials: "same-origin", cache: "no-store" } as const;
      const [res, statusRes, foundRes] = await Promise.all([
        fetch("/api/autobid/jobs", opts),
        fetch("/api/autobid/status", opts).catch(() => null),
        fetch("/api/autobid/found", opts).catch(() => null),
      ]);
      const data = (await res.json().catch(() => ({}))) as { jobs?: AutobidJob[]; error?: string };
      if (!res.ok) throw new Error(data.error || "Could not load Auto-bid jobs.");
      if (statusRes?.ok) setRunners(await statusRes.json().catch(() => null));
      if (foundRes?.ok) {
        const body = (await foundRes.json().catch(() => ({}))) as { found?: FoundListEntry[] };
        setFound(body.found ?? []);
      }
      setJobs(data.jobs ?? []);
      setError("");
      setLoadedAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load Auto-bid jobs.");
    } finally {
      setLoading(false);
      setNow(Date.now());
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, running ? REFRESH_RUNNING_MS : REFRESH_IDLE_MS);
    return () => clearInterval(timer);
  }, [load, running]);

  const [configProfileId, setConfigProfileId] = useState<number | null>(null);
  const onConfig = useCallback((config: AutobidConfig) => {
    setRunning(config.running);
    setConfigProfileId(config.profileId);
  }, []);

  const { profileId: activeProfileId, profile: activeProfile, setProfileId: setActiveProfileId } = useActiveProfile();
  const list = useMemo(
    () => (jobs ?? []).filter((job) => activeProfileId === null || job.profileId === activeProfileId),
    [jobs, activeProfileId],
  );

  const counts = useMemo(() => {
    const today = startOfToday();
    const of = (...stages: AutobidStage[]) => list.filter((job) => stages.includes(job.stage)).length;
    const by = (group: AutobidGroup) => list.filter((job) => STAGE_GROUP[job.stage] === group).length;
    return {
      active: by("active"),
      attention: by("attention"),
      done: by("done"),
      writing: of(...FOCUS_STAGES.writing),
      generating: of("generating"),
      applying: of(...FOCUS_STAGES.applying),
      applyingNow: of("applying"),
      sentToday: list.filter((job) => {
        const sent = job.steps.find((step) => step.key === "sent");
        return sent?.state === "done" && sent.at && new Date(sent.at).getTime() >= today;
      }).length,
    };
  }, [list]);

  // The control card counts the candidate Auto-bid applies as, whatever the page filter shows.
  const sentTodayForRunner = useMemo(() => {
    const today = startOfToday();
    return (jobs ?? []).filter((job) => {
      if (configProfileId !== null && job.profileId !== configProfileId) return false;
      const sent = job.steps.find((step) => step.key === "sent");
      return sent?.state === "done" && sent.at && new Date(sent.at).getTime() >= today;
    }).length;
  }, [jobs, configProfileId]);

  const attentionJobs = useMemo(() => list.filter((job) => STAGE_GROUP[job.stage] === "attention"), [list]);

  const shown = useMemo(() => {
    if (tab === "found") return [];
    const q = query.trim().toLowerCase();
    return list.filter(
      (job) =>
        STAGE_GROUP[job.stage] === tab &&
        (!focus || tab !== "active" || FOCUS_STAGES[focus].includes(job.stage)) &&
        (!q || `${job.company} ${job.jobTitle}`.toLowerCase().includes(q)),
    );
  }, [list, tab, focus, query]);

  const pickTab = (next: View, nextFocus: Focus = null) => {
    setTab(next);
    setFocus(nextFocus);
  };

  const toggleOpen = (id: number) =>
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const retry = async (job: AutobidJob) => {
    setBusyIds(new Set([job.id]));
    const regenerate = job.stage === "gen_failed";
    try {
      const res = await fetch(regenerate ? "/api/autogen/enqueue" : "/api/autobid/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ ids: [job.id] }),
      });
      const data = (await res.json().catch(() => ({}))) as { queued?: number; retried?: number; error?: string };
      if (!res.ok) throw new Error(data.error || "Could not retry.");
      const done = Number(regenerate ? data.queued : data.retried) > 0;
      if (done) toast.success(regenerate ? "The resume will be written again." : "It will be tried again.");
      else toast.error("Not retried: it changed meanwhile. Refreshing.");
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not retry.");
    } finally {
      setBusyIds(new Set());
    }
  };

  const foundList = (found ?? []).filter((f) => activeProfileId === null || f.profileId === activeProfileId);
  const matched = foundList.filter((f) => f.status === "queued" || f.status === "passed").length;

  const flow: FlowStep[] = [
    {
      key: "found",
      label: "Found",
      count: foundList.length,
      hint: `${matched} matched in the last 24h`,
      icon: Search,
      live: false,
      selected: tab === "found",
      onPick: () => pickTab("found"),
    },
    {
      key: "writing",
      label: "Writing resume",
      count: counts.writing,
      hint: "Tailored to each job",
      icon: FileText,
      live: counts.generating > 0,
      selected: tab === "active" && focus === "writing",
      onPick: () => pickTab("active", "writing"),
    },
    {
      key: "applying",
      label: "Applying",
      count: counts.applying,
      hint: "Filling and submitting",
      icon: Rocket,
      live: counts.applyingNow > 0,
      selected: tab === "active" && focus === "applying",
      onPick: () => pickTab("active", "applying"),
    },
    {
      key: "sent",
      label: "Sent today",
      count: counts.sentToday,
      hint: "Saved to Resume DB",
      icon: Send,
      live: false,
      selected: tab === "done",
      onPick: () => pickTab("done"),
    },
  ];

  const tabItems: { value: View; label: string; count: number }[] = [
    { value: "active", label: "In progress", count: counts.active },
    { value: "attention", label: "Needs you", count: counts.attention },
    { value: "done", label: "Finished", count: counts.done },
    { value: "found", label: "Found", count: foundList.length },
  ];

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-5">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Auto-bid</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Finds jobs, writes a tailored resume, applies, and saves each one to{" "}
            <Link href="/resume-db" className="font-medium text-primary underline-offset-4 hover:underline">
              Resume DB
            </Link>
            .
          </p>
        </div>
        <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-muted-foreground" disabled={loading} onClick={() => void load()}>
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          {loadedAt ? `Updated ${formatTime(new Date(loadedAt).toISOString())}` : "Refresh"}
        </Button>
      </div>

      <AutobidControlPanel
        appliedVersion={typeof runners?.autobid?.configVersion === "number" ? runners.autobid.configVersion : null}
        panelOnline={isOnline(runners?.autobid?.reportedAt, now)}
        sentToday={sentTodayForRunner}
        onConfig={onConfig}
        footer={runners ? <HealthStrip runners={runners} running={running} now={now} /> : null}
      />

      <Pipeline steps={flow} />

      {attentionJobs.length > 0 && tab !== "attention" && (
        <AttentionQueue jobs={attentionJobs} busyIds={busyIds} onRetry={(j) => void retry(j)} onSeeAll={() => pickTab("attention")} />
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
          <XCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Applications */}
      <Card className="gap-0 overflow-hidden border-border/70 py-0 shadow-none">
        <Tabs value={tab} onValueChange={(v) => pickTab(v as View)} className="gap-0">
          <div className="flex flex-col gap-3 border-b border-border/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="-mx-1 overflow-x-auto px-1 sm:mx-0 sm:px-0">
            <TabsList className="w-max">
              {tabItems.map(({ value, label, count }) => (
                <TabsTrigger key={value} value={value} className="gap-1.5">
                  {label}
                  {count > 0 && (
                    <span
                      className={cn(
                        "rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums leading-none",
                        value === "attention" ? "bg-amber-500/15 text-amber-700 dark:text-amber-400" : "bg-muted-foreground/10 text-muted-foreground",
                      )}
                    >
                      {count}
                    </span>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
            </div>
            <div className="relative sm:w-64">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search company or title"
                className="h-9 pl-8"
              />
            </div>
          </div>

          {((focus && tab === "active") || activeProfile) && (
            <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-4 py-2 text-xs text-muted-foreground">
              Showing
              {activeProfile && (
                <button
                  type="button"
                  onClick={() => setActiveProfileId(null)}
                  title="Show all candidates"
                  className="inline-flex items-center gap-1.5 rounded-full bg-muted py-0.5 pl-0.5 pr-2 font-medium text-foreground hover:bg-accent"
                >
                  <CandidateAvatar profileId={activeProfile.id} name={activeProfile.full_name} className="h-4 w-4 text-[8px]" />
                  {activeProfile.full_name}
                  <X className="h-3 w-3 text-muted-foreground" />
                </button>
              )}
              {focus && tab === "active" && (
                <button
                  type="button"
                  onClick={() => setFocus(null)}
                  className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary hover:bg-primary/15"
                >
                  {focus === "writing" ? "Writing resume" : "Applying"}
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          )}

          <TabsContent value="found">
            {found === null ? (
              <div className="flex min-h-[240px] items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <FoundJobsList found={foundList} query={query} now={now} />
            )}
          </TabsContent>

          {(["active", "attention", "done"] as const).map((group) => (
            <TabsContent key={group} value={group}>
              {jobs === null ? (
                <div className="flex min-h-[240px] items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : shown.length === 0 ? (
                <Empty group={group} running={running} query={query} />
              ) : (
                <ul className="divide-y divide-border/60">
                  {shown.map((job) => (
                    <JobRow
                      key={job.id}
                      job={job}
                      now={now}
                      open={openIds.has(job.id)}
                      busy={busyIds.has(job.id)}
                      onToggle={() => toggleOpen(job.id)}
                      onRetry={(j) => void retry(j)}
                    />
                  ))}
                </ul>
              )}
            </TabsContent>
          ))}
        </Tabs>
      </Card>
    </div>
  );
}
