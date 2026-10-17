"use client";

import React, { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { todayInTimeZone } from "@/lib/timezone";
import {
  REJECTION_STAGE_RE,
  computeStageStats,
  type StageStatGroupBy,
  type StageStatLine,
  type StageStatRow,
  type StageStatStage,
} from "@/lib/dashboard/stage-stats";

type Period = "page" | "7" | "30" | "90" | "month" | "all" | "custom";

const ALL = "__all__";

function addDays(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 12));
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

function percent(part: number, whole: number): string {
  if (!whole) return "–";
  const value = (part / whole) * 100;
  return `${value >= 10 || value === 0 ? Math.round(value) : value.toFixed(1)}%`;
}

function StageLineRow({
  line,
  stages,
  strong = false,
}: {
  line: StageStatLine;
  stages: StageStatStage[];
  strong?: boolean;
}) {
  return (
    <tr className={cn("border-b last:border-0", strong && "bg-muted/40 font-semibold")}>
      <td className="max-w-[220px] truncate py-2 pr-3" title={line.label}>
        {line.label}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">{line.applied}</td>
      {stages.map((stage) => {
        const count = line.reached[stage.id] ?? 0;
        return (
          <td key={stage.id} className="px-3 py-2 text-right tabular-nums">
            <span className={cn(!count && "text-muted-foreground")}>{count}</span>
            <span className="ml-1 text-[11px] font-normal text-muted-foreground">
              {count ? percent(count, line.applied) : ""}
            </span>
          </td>
        );
      })}
      <td className="py-2 pl-3 text-right tabular-nums">{percent(line.responded, line.applied)}</td>
    </tr>
  );
}

/**
 * Applications per pipeline column, by profile or by ATS, for any period.
 * Counts are of applications sent in the period, and of every column each of
 * them has been in since (from the pipeline cards' stage history).
 */
export function StageStatsCard({
  rows,
  stages,
  timezone,
  pageFrom = "",
  pageTo = "",
}: {
  rows: StageStatRow[] | undefined;
  stages: StageStatStage[] | undefined;
  timezone: string;
  /** The dashboard's own period (header), used until another period is picked here. */
  pageFrom?: string;
  pageTo?: string;
}) {
  const [period, setPeriod] = useState<Period>("page");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [groupBy, setGroupBy] = useState<StageStatGroupBy>("profile");
  const [profile, setProfile] = useState(ALL);
  const [ats, setAts] = useState(ALL);

  const allRows = rows ?? [];
  const allStages = stages ?? [];
  const today = todayInTimeZone(timezone);

  const range = useMemo(() => {
    if (period === "page") return { from: pageFrom, to: pageTo };
    if (period === "all") return { from: "", to: "" };
    if (period === "custom") return { from: customFrom, to: customTo };
    if (period === "month") return { from: `${today.slice(0, 8)}01`, to: today };
    return { from: addDays(today, -(Number(period) - 1)), to: today };
  }, [period, customFrom, customTo, today, pageFrom, pageTo]);

  const profiles = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of allRows) if (!seen.has(row.p)) seen.set(row.p, row.pl);
    return [...seen.entries()].map(([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [allRows]);

  const platforms = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of allRows) counts.set(row.ats, (counts.get(row.ats) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
  }, [allRows]);

  // A profile picked here and then turned off above falls back to all profiles.
  const activeProfile = profile !== ALL && profiles.some((item) => item.key === profile) ? profile : ALL;

  const table = useMemo(
    () =>
      computeStageStats(
        allRows,
        allStages,
        {
          from: range.from,
          to: range.to,
          groupBy,
          profile: activeProfile === ALL ? "" : activeProfile,
          ats: ats === ALL ? "" : ats,
        },
        timezone,
      ),
    [allRows, allStages, range, groupBy, activeProfile, ats, timezone],
  );

  if (!rows) return null;

  return (
    <Card className="min-w-0 border-border/70 shadow-none">
      <CardHeader className="space-y-3 pb-2">
        <div>
          <CardTitle className="text-base font-medium">Stage statistics</CardTitle>
          <CardDescription className="text-xs">
            Applications sent in the period, and how many reached each pipeline column
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={period} onValueChange={(value) => setPeriod(value as Period)}>
            <SelectTrigger className="h-8 w-[170px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="page">Dashboard range</SelectItem>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
              <SelectItem value="month">This month</SelectItem>
              <SelectItem value="all">All time</SelectItem>
              <SelectItem value="custom">Custom…</SelectItem>
            </SelectContent>
          </Select>
          {period === "custom" && (
            <>
              <Input
                type="date"
                className="h-8 w-[145px] text-xs"
                value={customFrom}
                max={customTo || today}
                onChange={(event) => setCustomFrom(event.target.value)}
                aria-label="From"
              />
              <span className="text-xs text-muted-foreground">to</span>
              <Input
                type="date"
                className="h-8 w-[145px] text-xs"
                value={customTo}
                min={customFrom || undefined}
                max={today}
                onChange={(event) => setCustomTo(event.target.value)}
                aria-label="To"
              />
            </>
          )}
          <ToggleGroup
            type="single"
            size="sm"
            value={groupBy}
            onValueChange={(value) => value && setGroupBy(value as StageStatGroupBy)}
          >
            <ToggleGroupItem value="profile" className="h-8 px-2 text-xs">
              By profile
            </ToggleGroupItem>
            <ToggleGroupItem value="ats" className="h-8 px-2 text-xs">
              By ATS
            </ToggleGroupItem>
          </ToggleGroup>
          <Select value={activeProfile} onValueChange={setProfile}>
            <SelectTrigger className="h-8 w-[170px] text-xs">
              <SelectValue placeholder="All profiles" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All profiles</SelectItem>
              {profiles.map((item) => (
                <SelectItem key={item.key} value={item.key}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={ats} onValueChange={setAts}>
            <SelectTrigger className="h-8 w-[150px] text-xs">
              <SelectValue placeholder="All ATS" />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              <SelectItem value={ALL}>All ATS</SelectItem>
              {platforms.map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="pt-1">
        {table.total.applied === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No applications in this period.</p>
        ) : (
          <div className="min-w-0 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3 text-left font-medium">{groupBy === "profile" ? "Profile" : "ATS"}</th>
                  <th className="px-3 py-2 text-right font-medium">Registered</th>
                  {allStages.map((stage) => (
                    <th
                      key={stage.id}
                      className={cn(
                        "px-3 py-2 text-right font-medium",
                        REJECTION_STAGE_RE.test(stage.name) && "text-destructive",
                      )}
                    >
                      {stage.name}
                    </th>
                  ))}
                  <th className="py-2 pl-3 text-right font-medium">Response</th>
                </tr>
              </thead>
              <tbody>
                {table.lines.map((line) => (
                  <StageLineRow key={line.key} line={line} stages={allStages} />
                ))}
                {table.lines.length > 1 && <StageLineRow line={table.total} stages={allStages} strong />}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-[11px] text-muted-foreground">
          Counts the applications registered in the period. Each column counts those that have been in it at any
          time (from the pipeline history), with the share of registered. Response = jobs moved onto the
          board, to any column (a rejection included), ÷ registered. Recent applications have had less time to get an answer, so short periods show
          lower rates.
        </p>
      </CardContent>
    </Card>
  );
}
