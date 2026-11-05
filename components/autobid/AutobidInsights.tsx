"use client";

import React, { useMemo, useState } from "react";
import { BarChart3, ChevronDown } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { countByCategory, digestOf, statsByVersion } from "@/lib/autobid/insights";
import type { AutobidJob } from "@/lib/autobid/stages";

function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function minutes(value: number | null): string {
  if (value === null) return "—";
  if (value < 60) return `${Math.round(value)} min`;
  return `${(value / 60).toFixed(1)} h`;
}

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-lg border border-border/60 px-3 py-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Today's numbers, why jobs stop, and how each extension version does. */
export function AutobidInsights({ jobs, now }: { jobs: AutobidJob[]; now: number }) {
  const [open, setOpen] = useState(false);
  const today = useMemo(() => digestOf(jobs, startOfToday(), now + 1), [jobs, now]);
  const categories = useMemo(() => countByCategory(jobs), [jobs]);
  const versions = useMemo(() => statsByVersion(jobs).slice(0, 6), [jobs]);
  const max = categories[0]?.count ?? 0;
  const total = categories.reduce((sum, c) => sum + c.count, 0);

  return (
    <Card className="gap-0 overflow-hidden border-border/70 py-0 shadow-none">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/30"
      >
        <BarChart3 className="h-4 w-4 text-muted-foreground" />
        <span className="flex-1 text-sm font-semibold">Insights</span>
        <span className="text-xs tabular-nums text-muted-foreground">
          Today: {today.sent} sent · {today.stopped} stopped
        </span>
        <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="space-y-5 border-t border-border/60 px-4 py-4">
          <section>
            <p className="mb-2 text-xs font-medium text-muted-foreground">Today</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <Stat label="Sent" value={today.sent} />
              <Stat label="Stopped" value={today.stopped} />
              <Stat label="Resumes written" value={today.resumesWritten} />
              <Stat label="Resumes failed" value={today.resumesFailed} />
              <Stat label="Queued → resume" value={minutes(today.avgQueueToResumeMin)} hint="average" />
              <Stat label="Apply → sent" value={minutes(today.avgApplyMin)} hint="average" />
            </div>
          </section>

          <section>
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              Why jobs are stopped now ({total})
            </p>
            {categories.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nothing is stopped.</p>
            ) : (
              <ul className="space-y-1.5">
                {categories.map((c) => (
                  <li
                    key={c.key}
                    className="grid grid-cols-[minmax(0,14rem)_1fr_2.5rem] items-center gap-3 text-xs"
                    title={`${c.label}: ${c.count} job${c.count === 1 ? "" : "s"} (${Math.round((c.count / total) * 100)}%)`}
                  >
                    <span className="truncate">{c.label}</span>
                    <span className="h-2 rounded-full bg-muted">
                      <span
                        className="block h-2 rounded-full bg-primary"
                        style={{ width: `${max ? Math.max(4, (c.count / max) * 100) : 0}%` }}
                      />
                    </span>
                    <span className="text-right tabular-nums text-muted-foreground">{c.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <p className="mb-2 text-xs font-medium text-muted-foreground">By extension version</p>
            {versions.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No runs recorded with a version yet. Versions are recorded from 4.43.3 on.
              </p>
            ) : (
              <table className="w-full text-xs">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th className="py-1 font-medium">Version</th>
                    <th className="py-1 text-right font-medium">Sent</th>
                    <th className="py-1 text-right font-medium">Stopped</th>
                    <th className="py-1 text-right font-medium">Sent rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {versions.map((v) => (
                    <tr key={v.version}>
                      <td className="py-1.5 font-medium">{v.version}</td>
                      <td className="py-1.5 text-right tabular-nums">{v.sent}</td>
                      <td className="py-1.5 text-right tabular-nums">{v.stopped}</td>
                      <td className="py-1.5 text-right tabular-nums">{Math.round(v.rate * 100)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      )}
    </Card>
  );
}
