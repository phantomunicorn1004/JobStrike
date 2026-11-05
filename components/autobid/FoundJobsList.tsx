"use client";

import React, { useMemo, useState } from "react";
import { ExternalLink, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { TONE_PILL } from "@/lib/ui/tone";
import { CompanyAvatar } from "@/components/autobid/CompanyAvatar";
import type { CandidateStatus, FoundListEntry } from "@/lib/autobid/candidates";

const STATUS_LABEL: Record<CandidateStatus, string> = {
  queued: "Queued",
  passed: "Fits · waiting",
  found: "Checking",
  skipped: "Skipped",
  expired: "Expired",
};

const STATUS_PILL: Record<CandidateStatus, string> = {
  queued: TONE_PILL.success,
  passed: TONE_PILL.progress,
  found: TONE_PILL.idle,
  skipped: TONE_PILL.idle,
  expired: TONE_PILL.idle,
};

const FILTERS: Array<CandidateStatus | "all"> = ["all", "queued", "passed", "found", "skipped", "expired"];

function ago(iso: string | null, now: number): string {
  if (!iso) return "";
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`;
}

function fitTone(score: number): string {
  if (score >= 75) return "text-emerald-700 dark:text-emerald-400";
  if (score >= 50) return "text-foreground";
  return "text-muted-foreground";
}

/** Every job Live found in the last 24 hours and what the server decided about it. */
export function FoundJobsList({ found, query, now }: { found: FoundListEntry[]; query: string; now: number }) {
  const [filter, setFilter] = useState<CandidateStatus | "all">("all");

  const matching = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? found.filter((job) => `${job.company} ${job.jobTitle}`.toLowerCase().includes(q)) : found;
  }, [found, query]);

  const counts = useMemo(
    () =>
      Object.fromEntries(
        FILTERS.map((key) => [key, key === "all" ? matching.length : matching.filter((job) => job.status === key).length]),
      ) as Record<CandidateStatus | "all", number>,
    [matching],
  );

  const shown = matching.filter((job) => filter === "all" || job.status === filter);

  return (
    <div>
      {found.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-b border-border/60 px-4 py-2.5">
          {FILTERS.filter((key) => key === "all" || counts[key] > 0).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={cn(
                "rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                filter === key ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground",
              )}
            >
              {key === "all" ? "All" : STATUS_LABEL[key]}
              <span className="ml-1 tabular-nums opacity-70">{counts[key]}</span>
            </button>
          ))}
        </div>
      )}

      {shown.length === 0 ? (
        <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
            <Search className="h-5 w-5 text-muted-foreground" />
          </span>
          <div>
            <p className="font-medium">{query ? "No matching jobs" : "No jobs found yet"}</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
              {query
                ? "Try another company or title."
                : "Jobs found in the last 24 hours show up here, with whether each one was queued or skipped and why."}
            </p>
          </div>
        </div>
      ) : (
        <ul className="divide-y divide-border/60">
          {shown.map((job) => (
            <li key={job.id} className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/30">
              <CompanyAvatar name={job.company} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{job.company || "Unknown company"}</span>
                  <span className={cn("shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium sm:hidden", STATUS_PILL[job.status])}>
                    {STATUS_LABEL[job.status]}
                  </span>
                </div>
                <p className="truncate text-xs text-muted-foreground" title={job.jobTitle}>{job.jobTitle}</p>
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground/70">
                  {[job.site || "Other site", job.source, job.postedAt ? `posted ${ago(job.postedAt, now)} ago` : ""]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                {job.reason && (job.status === "skipped" || job.status === "expired" || job.status === "passed") && (
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground" title={job.reason}>
                    {job.reason}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-3 self-center">
                {job.fitScore !== null && (
                  <span className="hidden text-right sm:block" title="Role fit from the AI check (0–100)">
                    <span className={cn("block text-sm font-semibold tabular-nums", fitTone(job.fitScore))}>
                      {Math.round(job.fitScore)}
                    </span>
                    <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">Fit</span>
                  </span>
                )}
                <span
                  className={cn("hidden w-[104px] rounded-md px-2 py-1 text-center text-[11px] font-medium sm:inline-block", STATUS_PILL[job.status])}
                >
                  {STATUS_LABEL[job.status]}
                </span>
                <span className="hidden w-8 text-right text-xs tabular-nums text-muted-foreground md:block">
                  {ago(job.foundAt, now)}
                </span>
                {job.jobLink && (
                  <a
                    href={job.jobLink}
                    target="_blank"
                    rel="noreferrer"
                    title="Open the job posting"
                    className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
