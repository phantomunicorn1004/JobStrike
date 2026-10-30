"use client";

import React from "react";
import { CheckCircle2, CircleHelp, Loader2, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** No report for this long: the panel or Chrome is closed (they report every minute). */
const OFFLINE_MS = 3 * 60 * 1000;

type Check = { label: string; ok: boolean | null; note?: string };

export type AutobidReport = {
  reportedAt?: string;
  version?: string;
  state?: "off" | "waiting" | "applying" | "paused" | "limit";
  fullAuto?: boolean;
  enabled?: boolean;
  submit?: boolean;
  dailyLimit?: number;
  step?: string;
  pauseReason?: string;
  job?: { id: number; company: string; jobTitle: string } | null;
  summary?: { ready: number; sentToday: number; needsYou: number } | null;
  checks?: Check[];
  live?: {
    live?: boolean;
    autoQueue?: boolean;
    profileName?: string;
    status?: string;
    challenge?: boolean;
    hours?: string;
    lastCheckAt?: string | null;
    lastAdded?: number;
  } | null;
  log?: string[];
};

type AutogenWindow = {
  windowId: number;
  running: boolean;
  busy: boolean;
  minimized: boolean;
  chatGptActive: boolean;
  status: string;
  applicationId: number | null;
  company: string;
  jobTitle: string;
  error: string;
  updatedAt: string | null;
};

export type AutogenReport = {
  reportedAt?: string;
  version?: string;
  engine?: "chatgpt" | "api";
  windows?: AutogenWindow[];
  stats?: { completed?: number; failed?: number; skipped?: number };
  log?: Array<{ at: string; windowId: number | null; text: string }>;
};

function isOnline(reportedAt: string | undefined, now: number): boolean {
  return Boolean(reportedAt) && now - new Date(String(reportedAt)).getTime() < OFFLINE_MS;
}

function OnlineBadge({ online, reportedAt, ago }: { online: boolean; reportedAt?: string; ago: (iso: string | null) => string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs",
        online ? "text-emerald-700 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400",
      )}
      title={reportedAt ? `Last report ${new Date(reportedAt).toLocaleString()}` : "Never reported"}
    >
      <span className={cn("h-2 w-2 rounded-full", online ? "bg-emerald-500" : "bg-rose-500")} aria-hidden="true" />
      {online ? "Reporting" : reportedAt ? `Not reporting since ${ago(reportedAt)}` : "Never reported"}
    </span>
  );
}

function CheckRow({ check }: { check: Check }) {
  const Icon = check.ok ? CheckCircle2 : check.ok === false ? XCircle : CircleHelp;
  return (
    <li className="flex items-start gap-1.5 text-xs">
      <Icon
        className={cn(
          "mt-0.5 h-3.5 w-3.5 shrink-0",
          check.ok
            ? "text-emerald-600 dark:text-emerald-400"
            : check.ok === false
              ? "text-amber-600 dark:text-amber-400"
              : "text-muted-foreground",
        )}
      />
      <span>
        {check.label}
        {check.note ? <span className="text-muted-foreground"> — {check.note}</span> : null}
      </span>
    </li>
  );
}

const RUNNER_STATE: Record<NonNullable<AutobidReport["state"]>, { label: string; style: string }> = {
  off: { label: "Off", style: "text-muted-foreground" },
  waiting: { label: "Waiting for resumes", style: "text-foreground" },
  applying: { label: "Applying", style: "text-primary" },
  paused: { label: "Paused", style: "text-amber-700 dark:text-amber-400" },
  limit: { label: "Daily limit reached", style: "text-muted-foreground" },
};

function RecentLog({ lines }: { lines: string[] }) {
  if (!lines.length) return null;
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Recent activity ({lines.length})</summary>
      <ol className="mt-1.5 space-y-0.5 border-l pl-3">
        {lines.map((line, index) => (
          <li key={index} className="break-words">
            {line}
          </li>
        ))}
      </ol>
    </details>
  );
}

function AutobidCard({
  report,
  now,
  ago,
  time,
}: {
  report: AutobidReport | null;
  now: number;
  ago: (iso: string | null) => string;
  time: (iso: string | null) => string;
}) {
  const online = isOnline(report?.reportedAt, now);
  const state = report?.state ? RUNNER_STATE[report.state] : null;
  const live = report?.live;
  return (
    <section className="flex flex-col gap-2 rounded-lg border bg-card p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">JobStrike panel · Auto-bid</h2>
          {report?.fullAuto && online && (
            <Badge className="h-5 bg-emerald-600 px-1.5 text-[10px] text-white hover:bg-emerald-600">Full auto</Badge>
          )}
        </div>
        <OnlineBadge online={online} reportedAt={report?.reportedAt} ago={ago} />
      </div>
      {!report ? (
        <p className="text-xs text-muted-foreground">
          No report yet. Update the JobStrike extension on the VPS and keep its panel open.
        </p>
      ) : (
        <>
          {!online && (
            <p className="rounded-md bg-rose-500/10 px-2 py-1.5 text-xs text-rose-700 dark:text-rose-300">
              Nothing is being found or applied to: the JobStrike panel or Chrome is closed on the VPS. Open the
              panel (click the JobStrike icon) and it carries on.
            </p>
          )}
          <div className="text-sm">
            <span className={cn("font-medium", online ? state?.style : "text-muted-foreground")}>
              {state?.label ?? "Unknown"}
            </span>
            {report.enabled && !report.submit && <span className="text-muted-foreground"> · dry run</span>}
            {report.job && (
              <span className="text-muted-foreground">
                {" "}
                · #{report.job.id} {report.job.company} · {report.job.jobTitle}
              </span>
            )}
          </div>
          {report.step && report.state !== "off" && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {report.state === "applying" && online && <Loader2 className="h-3 w-3 animate-spin" />}
              {report.step}
            </p>
          )}
          {report.summary && (
            <p className="text-xs text-muted-foreground">
              {report.summary.sentToday} sent today (limit {report.dailyLimit}) · {report.summary.ready} ready ·{" "}
              {report.summary.needsYou} need you
            </p>
          )}
          {live && (
            <p className="text-xs text-muted-foreground">
              Live: {live.live ? (live.challenge ? "paused by a site check" : live.status || "on") : "off"}
              {live.lastCheckAt ? ` · last check ${time(live.lastCheckAt)}, +${live.lastAdded ?? 0} new` : ""}
              {live.autoQueue ? ` · queuing for ${live.profileName || "a profile"}` : " · not queuing for AutoGen"}
              {live.hours ? ` · hours ${live.hours}` : ""}
            </p>
          )}
          {report.checks && report.checks.length > 0 && (
            <ul className="space-y-0.5">
              {report.checks.map((check) => (
                <CheckRow key={check.label} check={check} />
              ))}
            </ul>
          )}
          <RecentLog lines={report.log ?? []} />
        </>
      )}
    </section>
  );
}

function windowLine(win: AutogenWindow): { text: string; warn: boolean } {
  if (!win.running) return { text: win.error ? `Stopped — ${win.error}` : "Stopped", warn: true };
  if (win.minimized) return { text: "Minimized: ChatGPT does not answer in a minimized window", warn: true };
  if (!win.chatGptActive && !win.busy) return { text: "The active tab is not ChatGPT", warn: true };
  if (win.busy && win.applicationId) {
    return { text: `Generating #${win.applicationId} ${win.company}${win.jobTitle ? ` · ${win.jobTitle}` : ""}`, warn: false };
  }
  return { text: "Waiting for queued jobs", warn: false };
}

function AutogenCard({
  report,
  now,
  ago,
  time,
}: {
  report: AutogenReport | null;
  now: number;
  ago: (iso: string | null) => string;
  time: (iso: string | null) => string;
}) {
  const online = isOnline(report?.reportedAt, now);
  const windows = report?.windows ?? [];
  const running = windows.filter((win) => win.running).length;
  return (
    <section className="flex flex-col gap-2 rounded-lg border bg-card p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">AutoGen · resume generation</h2>
        <OnlineBadge online={online} reportedAt={report?.reportedAt} ago={ago} />
      </div>
      {!report ? (
        <p className="text-xs text-muted-foreground">No report yet. Update the AutoGen extension on the VPS.</p>
      ) : (
        <>
          {!online && (
            <p className="rounded-md bg-rose-500/10 px-2 py-1.5 text-xs text-rose-700 dark:text-rose-300">
              No resumes are being generated: Chrome is closed on the VPS, or AutoGen is signed out.
            </p>
          )}
          <p className="text-sm">
            <span className={cn("font-medium", online && running ? "text-foreground" : "text-muted-foreground")}>
              {running} of {windows.length} window{windows.length === 1 ? "" : "s"} running
            </span>
            <span className="text-muted-foreground">
              {" "}
              · {report.engine === "api" ? "OpenAI API" : "ChatGPT tabs"}
              {report.stats
                ? ` · ${report.stats.completed ?? 0} done, ${report.stats.failed ?? 0} failed this session`
                : ""}
            </span>
          </p>
          {windows.length === 0 && online && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              No window is running: open a ChatGPT tab in a window and press Run in background.
            </p>
          )}
          {windows.length > 0 && (
            <ul className="space-y-0.5">
              {windows.map((win, index) => {
                const line = windowLine(win);
                return (
                  <li key={win.windowId} className="flex items-start gap-1.5 text-xs">
                    {win.busy && online ? (
                      <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
                    ) : line.warn ? (
                      <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                    ) : (
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                    )}
                    <span>
                      Window {index + 1}: {line.text}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          <RecentLog lines={(report.log ?? []).map((row) => `${time(row.at)}  ${row.text}`)} />
        </>
      )}
    </section>
  );
}

/** The two machines' parts of the chain, from their latest reports. */
export function RunnerStatusPanel({
  autobid,
  autogen,
  setupError,
  now,
  ago,
  time,
}: {
  autobid: AutobidReport | null;
  autogen: AutogenReport | null;
  setupError?: string;
  now: number;
  ago: (iso: string | null) => string;
  time: (iso: string | null) => string;
}) {
  if (setupError) {
    return (
      <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
        {setupError}
      </p>
    );
  }
  return (
    <div className="grid gap-2 lg:grid-cols-2">
      <AutobidCard report={autobid} now={now} ago={ago} time={time} />
      <AutogenCard report={autogen} now={now} ago={ago} time={time} />
    </div>
  );
}
