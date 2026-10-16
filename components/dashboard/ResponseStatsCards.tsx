"use client";

import React, { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import type { ResponseRow, ResponseStats } from "@/lib/dashboard/response-stats";

/** Fewer bids than this make a rate too noisy to compare. */
const MIN_BIDS_FOR_RATE = 10;

function RateBar({ rate, best }: { rate: number; best: number }) {
  const width = best > 0 ? Math.max(2, Math.round((rate / best) * 100)) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted sm:w-32">
        <div className="h-full rounded-full bg-primary" style={{ width: `${width}%` }} />
      </div>
      <span className="w-12 text-right tabular-nums font-medium">{rate.toFixed(1)}%</span>
    </div>
  );
}

function ResponseTable({
  rows,
  stages,
  firstColumn,
  showEmpty = false,
}: {
  rows: ResponseRow[];
  stages: ResponseStats["stages"];
  firstColumn: string;
  showEmpty?: boolean;
}) {
  const shown = showEmpty ? rows : rows.filter((row) => row.applied > 0);
  const best = Math.max(0, ...shown.filter((r) => r.applied >= MIN_BIDS_FOR_RATE).map((r) => r.responseRate));
  if (shown.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">No registered applications yet.</p>;
  }
  return (
    <div className="min-w-0 overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr className="border-b text-[11px] uppercase tracking-wide text-muted-foreground">
            <th className="py-2 pr-3 text-left font-medium">{firstColumn}</th>
            <th className="px-3 py-2 text-right font-medium">Applied</th>
            <th className="px-3 py-2 text-right font-medium">Heard back</th>
            {stages.map((stage) => (
              <th key={stage.id} className="px-3 py-2 text-right font-medium">
                {stage.name}
              </th>
            ))}
            <th className="py-2 pl-3 text-left font-medium">Response rate</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((row) => {
            const thin = row.applied < MIN_BIDS_FOR_RATE;
            return (
              <tr key={row.key} className="border-b last:border-0">
                <td className="py-2 pr-3">{row.label}</td>
                <td className="px-3 py-2 text-right tabular-nums">{row.applied}</td>
                <td className="px-3 py-2 text-right tabular-nums">{row.heardBack}</td>
                {stages.map((stage) => (
                  <td
                    key={stage.id}
                    className={cn(
                      "px-3 py-2 text-right tabular-nums",
                      !row.reached[stage.id] && "text-muted-foreground",
                    )}
                  >
                    {row.reached[stage.id] ?? 0}
                  </td>
                ))}
                <td className={cn("py-2 pl-3", thin && "opacity-50")}
                  title={thin ? `Fewer than ${MIN_BIDS_FOR_RATE} applications: too few to compare` : undefined}
                >
                  <RateBar rate={row.responseRate} best={best} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Answers by platform, and by when the application was sent. */
export function ResponseStatsCards({ stats }: { stats: ResponseStats | null | undefined }) {
  const [timeView, setTimeView] = useState<"time" | "weekday">("time");
  if (!stats) return null;
  const { totals } = stats;
  return (
    <div className="grid min-w-0 gap-4">
      <Card className="min-w-0 border-border/70 shadow-none">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium">By platform</CardTitle>
          <CardDescription className="text-xs">
            Which boards answer · all time · {totals.applied} applied, {totals.heardBack} heard back (
            {totals.responseRate.toFixed(1)}%)
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-1">
          <ResponseTable rows={stats.byPlatform} stages={stats.stages} firstColumn="Platform" />
          <p className="mt-2 text-[11px] text-muted-foreground">
            Heard back = the card moved past the first pipeline column (a rejection column counts as an answer).
            Later columns count applications that got at least that far. Rates from fewer than {MIN_BIDS_FOR_RATE}{" "}
            applications are dimmed.
          </p>
        </CardContent>
      </Card>

      <Card className="min-w-0 border-border/70 shadow-none">
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 pb-2">
          <div>
            <CardTitle className="text-base font-medium">By when you applied</CardTitle>
            <CardDescription className="text-xs">Response rate by the time each application was registered</CardDescription>
          </div>
          <ToggleGroup
            type="single"
            size="sm"
            value={timeView}
            onValueChange={(value) => value && setTimeView(value as "time" | "weekday")}
          >
            <ToggleGroupItem value="time" className="h-7 px-2 text-xs">
              Time of day
            </ToggleGroupItem>
            <ToggleGroupItem value="weekday" className="h-7 px-2 text-xs">
              Weekday
            </ToggleGroupItem>
          </ToggleGroup>
        </CardHeader>
        <CardContent className="pt-1">
          <ResponseTable
            rows={timeView === "time" ? stats.byTimeOfDay : stats.byWeekday}
            stages={stats.stages}
            firstColumn={timeView === "time" ? "Applied between" : "Weekday"}
            showEmpty
          />
        </CardContent>
      </Card>
    </div>
  );
}
