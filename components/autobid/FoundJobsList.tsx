"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { CandidateStatus, FoundListEntry } from "@/lib/autobid/candidates";

const STATUS_LABEL: Record<CandidateStatus, string> = {
  queued: "Queued",
  passed: "Fits · waiting for room",
  found: "Checking",
  skipped: "Skipped",
  expired: "Expired",
};

const STATUS_STYLE: Record<CandidateStatus, string> = {
  queued: "text-emerald-700 dark:text-emerald-400",
  passed: "text-primary",
  found: "text-muted-foreground",
  skipped: "text-muted-foreground",
  expired: "text-muted-foreground",
};

const FILTERS: Array<CandidateStatus | "all"> = ["all", "queued", "passed", "found", "skipped", "expired"];

function ago(iso: string | null, now: number): string {
  if (!iso) return "";
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h` : `${Math.round(hours / 24)} d`;
}

/**
 * Every job Live found in the last 24 hours and what the server decided:
 * queued, fits but waiting for room, skipped (with the reason), or expired.
 */
export function FoundJobsList({ refreshKey }: { refreshKey: number }) {
  const [found, setFound] = useState<FoundListEntry[] | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<CandidateStatus | "all">("all");
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/autobid/found", { credentials: "same-origin", cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as { found?: FoundListEntry[]; error?: string };
      if (!res.ok) throw new Error(data.error || "Could not load the found jobs.");
      setFound(data.found ?? []);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the found jobs.");
    } finally {
      setNow(Date.now());
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const counts = useMemo(() => {
    const list = found ?? [];
    return Object.fromEntries(
      FILTERS.map((key) => [key, key === "all" ? list.length : list.filter((job) => job.status === key).length]),
    ) as Record<CandidateStatus | "all", number>;
  }, [found]);

  const shown = (found ?? []).filter((job) => filter === "all" || job.status === filter);

  if (error) {
    return (
      <p className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">
        {error}
      </p>
    );
  }
  if (found === null) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        {FILTERS.filter((key) => key === "all" || counts[key] > 0).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={cn(
              "rounded-full border px-2.5 py-0.5 text-xs",
              filter === key ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted",
            )}
          >
            {key === "all" ? "All" : STATUS_LABEL[key]} ({counts[key]})
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No jobs found in the last 24 hours. Live sends what it finds here while Auto-bid runs.
        </p>
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {shown.map((job) => (
            <li key={job.id} className="flex flex-col gap-0.5 px-3 py-2 sm:flex-row sm:items-center sm:gap-3">
              <div className="min-w-0 flex-1">
                <a
                  href={job.jobLink}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex max-w-full items-center gap-1 truncate text-sm font-medium hover:underline"
                >
                  <span className="truncate">
                    {job.company ? `${job.company} · ` : ""}
                    {job.jobTitle}
                  </span>
                  <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
                </a>
                <p className="truncate text-xs text-muted-foreground">
                  {[job.site || "Other site", job.source, job.postedAt ? `posted ${ago(job.postedAt, now)} ago` : "", `found ${ago(job.foundAt, now)} ago`]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                {job.reason && (job.status === "skipped" || job.status === "expired" || job.status === "passed") && (
                  <p className="text-xs text-muted-foreground" title={job.reason}>
                    {job.reason.length > 180 ? `${job.reason.slice(0, 180)}…` : job.reason}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {job.fitScore !== null && (
                  <Badge variant="outline" title="Role fit from the AI check (0–100)">
                    Fit {Math.round(job.fitScore)}
                  </Badge>
                )}
                <span className={cn("text-xs font-medium", STATUS_STYLE[job.status])}>{STATUS_LABEL[job.status]}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
