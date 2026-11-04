"use client";

import React from "react";
import { cn } from "@/lib/utils";

/** One machine's latest report, as /api/autobid/status lists them. */
export type WorkerEntry = {
  instanceId: string;
  kind: "panel" | "autogen";
  reportedAt: string;
  status: Record<string, unknown>;
};

const ONLINE_MS = 3 * 60 * 1000;

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Every JobStrike panel that reported in the last 10 minutes. With more than
 * one open (another Chrome profile, another computer), each says whether it is
 * working and, if not, why: one panel's problem no longer stops the run.
 */
export function PanelList({
  workers,
  now,
  ago,
}: {
  workers: WorkerEntry[];
  now: number;
  ago: (iso: string | null) => string;
}) {
  const panels = workers.filter((w) => w.kind === "panel");
  if (panels.length < 2) return null;
  return (
    <section className="rounded-md border px-3 py-2 text-xs">
      <p className="mb-1 font-medium text-foreground">Open JobStrike panels ({panels.length})</p>
      <ul className="space-y-1">
        {panels.map((panel) => {
          const s = panel.status;
          const online = now - new Date(panel.reportedAt).getTime() < ONLINE_MS;
          const problem = text(s.setupError);
          const job = s.job as { company?: string } | null | undefined;
          const doing = job?.company ? `Applying: ${job.company}` : text(s.step) || text(s.state) || "—";
          return (
            <li key={panel.instanceId} className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-mono text-muted-foreground">{panel.instanceId.slice(0, 8)}</span>
              <span className="text-muted-foreground">v{text(s.version) || "?"}</span>
              <span className={online ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"}>
                {online ? "online" : `seen ${ago(panel.reportedAt)}`}
              </span>
              <span className={cn("min-w-0 break-words", problem ? "text-amber-700 dark:text-amber-400" : "text-foreground")}>
                {problem || doing}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
