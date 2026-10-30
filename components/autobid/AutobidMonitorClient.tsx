"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  Circle,
  ExternalLink,
  Loader2,
  RefreshCw,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  STAGE_GROUP,
  type AutobidGroup,
  type AutobidJob,
  type AutobidStage,
  type AutobidStep,
} from "@/lib/autobid/stages";

const REFRESH_MS = 20_000;
/** Matches the server's BID_STALE_MS: past this, the runner's claim can be taken again. */
const STALE_MS = 20 * 60 * 1000;

type View = AutobidGroup | "all";

const VIEW_LABEL: Record<View, string> = {
  active: "In progress",
  attention: "Needs you",
  done: "Registered",
  all: "All",
};

const STAGE_LABEL: Record<AutobidStage, string> = {
  queued: "Waiting for AutoGen",
  generating: "Generating resume",
  gen_failed: "Resume failed",
  ready: "Waiting for Auto-bid",
  applying: "Applying",
  needs_you: "Needs you",
  failed: "Failed",
  sent: "Sent · not registered",
  registered: "Registered",
};

const STAGE_STYLE: Record<AutobidStage, string> = {
  queued: "text-muted-foreground",
  generating: "text-primary",
  gen_failed: "text-rose-600 dark:text-rose-400",
  ready: "text-muted-foreground",
  applying: "text-primary",
  needs_you: "text-amber-700 dark:text-amber-400",
  failed: "text-rose-600 dark:text-rose-400",
  sent: "text-amber-700 dark:text-amber-400",
  registered: "text-emerald-700 dark:text-emerald-400",
};

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
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.floor(h / 24)} d ago`;
}

function StepIcon({ step }: { step: AutobidStep }) {
  if (step.state === "done") return <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />;
  if (step.state === "current") return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
  if (step.state === "failed") return <XCircle className="h-4 w-4 text-amber-600 dark:text-amber-400" />;
  return <Circle className="h-4 w-4 text-muted-foreground/40" />;
}

/** Queued → Resume → Apply → Sent → Registered, each with when it happened. */
function Steps({ steps }: { steps: AutobidStep[] }) {
  return (
    <ol className="grid grid-cols-5 gap-1">
      {steps.map((step, index) => (
        <li key={step.key} className="flex min-w-0 flex-col items-start gap-0.5">
          <div className="flex w-full items-center gap-1">
            <StepIcon step={step} />
            {index < steps.length - 1 && (
              <span
                className={cn("h-px flex-1", step.state === "done" ? "bg-emerald-500/50" : "bg-border")}
                aria-hidden="true"
              />
            )}
          </div>
          <span className={cn("text-xs", step.state === "pending" ? "text-muted-foreground" : "font-medium")}>
            {step.label}
          </span>
          <span className="truncate text-[11px] text-muted-foreground">{formatTime(step.at)}</span>
        </li>
      ))}
    </ol>
  );
}

function JobRow({
  job,
  now,
  busy,
  onRetry,
}: {
  job: AutobidJob;
  now: number;
  busy: boolean;
  onRetry: (job: AutobidJob) => void;
}) {
  const lastWord = job.log.at(-1)?.at ?? null;
  const silent = job.stage === "applying" && lastWord && now - new Date(lastWord).getTime() > STALE_MS;
  const canRetry =
    job.stage === "gen_failed" || ((job.stage === "needs_you" || job.stage === "failed") && !job.submitClicked);

  return (
    <li className="rounded-lg border bg-card p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium" title={`${job.company} · ${job.jobTitle}`}>
            {job.company || "Job"} · {job.jobTitle || "Untitled"}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            <span>#{job.id}</span>
            {job.candidate && <span>{job.candidate}</span>}
            {job.dryRun && job.stage !== "registered" && (
              <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                Dry run
              </Badge>
            )}
            {job.stage === "registered" && (
              <span>{job.sentByRunner ? "sent by Auto-bid" : "sent by hand"}</span>
            )}
            <span>updated {formatAgo(job.updatedAt, now)}</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={cn("text-xs font-medium", STAGE_STYLE[job.stage])}>{STAGE_LABEL[job.stage]}</span>
          {canRetry && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 rounded-md px-2 text-xs"
              disabled={busy}
              title={job.stage === "gen_failed" ? "Queue it for AutoGen again" : "Give it back to the Auto-bid runner"}
              onClick={() => onRetry(job)}
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Retry"}
            </Button>
          )}
          {job.jobLink && (
            <Button asChild variant="ghost" size="sm" className="h-7 rounded-md px-2 text-xs">
              <a href={job.jobLink} target="_blank" rel="noreferrer" title="Open the job">
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </Button>
          )}
        </div>
      </div>

      <div className="mt-3">
        <Steps steps={job.steps} />
      </div>

      {job.stage === "applying" && (
        <p className={cn("mt-2 text-xs", silent ? "text-amber-700 dark:text-amber-400" : "text-primary")}>
          {silent
            ? `No word from the runner since ${formatTime(lastWord)}: is the JobStrike panel still open on the VPS? The job is taken again after 20 minutes.`
            : `${job.currentStep || "Working"} · ${formatAgo(lastWord, now)}`}
        </p>
      )}
      {job.reason && (
        <p className="mt-2 flex items-start gap-1.5 rounded-md bg-amber-500/10 px-2 py-1.5 text-xs text-amber-800 dark:text-amber-300">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {job.submitClicked && job.stage !== "sent" ? "Submit was clicked: check the site before doing anything. " : ""}
            {job.reason}
          </span>
        </p>
      )}
      {job.log.length > 0 && (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            Runner steps ({job.log.length})
          </summary>
          <ol className="mt-1.5 space-y-0.5 border-l pl-3">
            {job.log.map((entry, index) => (
              <li key={`${entry.at}-${index}`} className="flex gap-2">
                <span className="w-16 shrink-0 tabular-nums text-muted-foreground">{formatTime(entry.at)}</span>
                <span className="min-w-0 break-words">{entry.text}</span>
              </li>
            ))}
          </ol>
        </details>
      )}
    </li>
  );
}

function Tile({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2">
      <div className={cn("text-2xl font-semibold tabular-nums", tone)}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

export function AutobidMonitorClient() {
  const [jobs, setJobs] = useState<AutobidJob[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadedAt, setLoadedAt] = useState<number>(0);
  const [now, setNow] = useState(() => Date.now());
  const [view, setView] = useState<View>("active");
  const [busyIds, setBusyIds] = useState<Set<number>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/autobid/jobs", { credentials: "same-origin", cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as { jobs?: AutobidJob[]; error?: string };
      if (!res.ok) throw new Error(data.error || "Could not load Auto-bid jobs.");
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
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const counts = useMemo(() => {
    const list = jobs ?? [];
    const today = startOfToday();
    const sentToday = list.filter((job) => {
      const sent = job.steps.find((step) => step.key === "sent");
      return sent?.state === "done" && sent.at && new Date(sent.at).getTime() >= today;
    }).length;
    const by = (group: AutobidGroup) => list.filter((job) => STAGE_GROUP[job.stage] === group).length;
    return {
      active: by("active"),
      attention: by("attention"),
      done: by("done"),
      all: list.length,
      sentToday,
      applying: list.filter((job) => job.stage === "applying").length,
      ready: list.filter((job) => job.stage === "ready").length,
    };
  }, [jobs]);

  const lastRunnerWord = useMemo(() => {
    const times = (jobs ?? []).flatMap((job) => job.log.map((entry) => entry.at)).sort();
    return times.at(-1) ?? null;
  }, [jobs]);

  const shown = useMemo(
    () => (jobs ?? []).filter((job) => view === "all" || STAGE_GROUP[job.stage] === view),
    [jobs, view],
  );

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
      if (done) toast.success(regenerate ? "Queued for AutoGen again." : "Given back to Auto-bid.");
      else toast.error("Not retried: it changed meanwhile. Refreshing.");
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not retry.");
    } finally {
      setBusyIds(new Set());
    }
  };

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Auto-bid</h1>
          <p className="text-xs text-muted-foreground sm:text-sm">
            Each job from Live or the Bid tab, through AutoGen and the Auto-bid runner to{" "}
            <Link href="/resume-db" className="text-primary underline-offset-4 hover:underline">
              Resume DB
            </Link>
            . Refreshes every 20 seconds.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span title="The last step any job reported from the Auto-bid runner">
            Runner last reported: {lastRunnerWord ? formatAgo(lastRunnerWord, now) : "never"}
          </span>
          <Button variant="outline" size="sm" className="h-8 rounded-md" disabled={loading} onClick={() => void load()}>
            <RefreshCw className={cn("mr-1 h-3.5 w-3.5", loading && "animate-spin")} />
            {loadedAt ? formatTime(new Date(loadedAt).toISOString()) : "Refresh"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile label="Applying now" value={counts.applying} tone={counts.applying ? "text-primary" : undefined} />
        <Tile label="Resume ready, waiting" value={counts.ready} />
        <Tile
          label="Need you"
          value={counts.attention}
          tone={counts.attention ? "text-amber-700 dark:text-amber-400" : undefined}
        />
        <Tile label="Sent today" value={counts.sentToday} tone="text-emerald-700 dark:text-emerald-400" />
      </div>

      <Tabs value={view} onValueChange={(value) => setView(value as View)}>
        <TabsList>
          {(Object.keys(VIEW_LABEL) as View[]).map((key) => (
            <TabsTrigger key={key} value={key}>
              {VIEW_LABEL[key]} ({counts[key]})
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {error && (
        <p className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">
          {error}
        </p>
      )}
      {jobs === null && !error ? (
        <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : shown.length === 0 && !error ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          {view === "attention"
            ? "Nothing needs you."
            : view === "active"
              ? "Nothing in progress. Jobs appear here when Live or the Bid tab queues them for AutoGen."
              : "No jobs yet."}
        </p>
      ) : (
        <ul className="space-y-2">
          {shown.map((job) => (
            <JobRow key={job.id} job={job} now={now} busy={busyIds.has(job.id)} onRetry={(j) => void retry(j)} />
          ))}
        </ul>
      )}
    </div>
  );
}
