"use client";

import React from "react";
import { Activity, CalendarCheck, Clock, Trophy, TrendingDown, UserRound } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { ResponseRow, ResponseStats } from "@/lib/dashboard/response-stats";
import type { StageStatLine } from "@/lib/dashboard/stage-stats";

/** Groups with fewer bids than this are too small to call best or worst. */
export const MIN_BIDS_FOR_INSIGHT = 30;

type Tone = "good" | "warn" | "info";

type Insight = {
  key: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  value: string;
  detail: string;
  tone: Tone;
};

export type PaceSummary = {
  rangeDays: number;
  activeDays: number;
  perActiveDay: number;
  busiest: { label: string; count: number } | null;
};

type Rated = { label: string; applied: number; rate: number };

function rated(rows: ResponseRow[]): Rated[] {
  return rows
    .filter((row) => row.applied >= MIN_BIDS_FOR_INSIGHT)
    .map((row) => ({ label: row.label, applied: row.applied, rate: row.responseRate }));
}

function best(rows: Rated[]): Rated | null {
  if (rows.length < 2) return null;
  return rows.reduce((top, row) => (row.rate > top.rate ? row : top));
}

function worst(rows: Rated[]): Rated | null {
  if (rows.length < 2) return null;
  return rows.reduce((low, row) => (row.rate < low.rate ? row : low));
}

const pct = (value: number) => `${value.toFixed(1)}%`;

/** Plain-language highlights picked from the response statistics. */
export function InsightsCard({
  stats,
  profileLines,
  pace,
}: {
  stats: ResponseStats | null;
  profileLines: StageStatLine[];
  pace: PaceSummary;
}) {
  const insights: Insight[] = [];
  const overall = stats?.totals.responseRate ?? 0;

  if (stats) {
    const platforms = rated(stats.byPlatform);
    const top = best(platforms);
    if (top && top.rate > overall) {
      insights.push({
        key: "platform-best",
        icon: Trophy,
        title: "Best platform",
        value: `${top.label} · ${pct(top.rate)}`,
        detail: `vs ${pct(overall)} overall · ${top.applied} bids`,
        tone: "good",
      });
    }
    const low = worst(platforms);
    if (low && top && low.label !== top.label && low.rate < overall * 0.75) {
      insights.push({
        key: "platform-worst",
        icon: TrendingDown,
        title: "Fewest answers",
        value: `${low.label} · ${pct(low.rate)}`,
        detail: `vs ${pct(overall)} overall · ${low.applied} bids`,
        tone: "warn",
      });
    }
    const time = best(rated(stats.byTimeOfDay));
    if (time && time.rate > overall) {
      insights.push({
        key: "time",
        icon: Clock,
        title: "Best time to apply",
        value: `${time.label} · ${pct(time.rate)}`,
        detail: `${time.applied} bids sent in that window`,
        tone: "good",
      });
    }
    const day = best(rated(stats.byWeekday));
    if (day && day.rate > overall) {
      insights.push({
        key: "weekday",
        icon: CalendarCheck,
        title: "Best weekday",
        value: `${day.label} · ${pct(day.rate)}`,
        detail: `${day.applied} bids sent on ${day.label}s`,
        tone: "good",
      });
    }
  }

  const profile = best(
    profileLines
      .filter((line) => line.applied >= MIN_BIDS_FOR_INSIGHT)
      .map((line) => ({
        label: line.label,
        applied: line.applied,
        rate: line.applied ? (line.responded / line.applied) * 100 : 0,
      })),
  );
  if (profile) {
    insights.push({
      key: "profile",
      icon: UserRound,
      title: "Best profile",
      value: `${profile.label} · ${pct(profile.rate)}`,
      detail: `${profile.applied} bids`,
      tone: "good",
    });
  }

  if (pace.activeDays > 0) {
    insights.push({
      key: "pace",
      icon: Activity,
      title: "Your pace",
      value: `≈ ${Math.round(pace.perActiveDay)} bids per bidding day`,
      detail: `${pace.activeDays} of ${pace.rangeDays} days${
        pace.busiest ? ` · busiest ${pace.busiest.label} (${pace.busiest.count})` : ""
      }`,
      tone: "info",
    });
  }

  return (
    <Card className="min-w-0 border-border/70 shadow-none">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-medium">Highlights</CardTitle>
        <CardDescription className="text-xs">
          Picked from every answer so far for the selected profiles · groups under {MIN_BIDS_FOR_INSIGHT} bids are
          skipped
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-1">
        {insights.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border/70 px-3 py-4 text-center text-sm text-muted-foreground">
            Highlights appear once a platform, time or profile has {MIN_BIDS_FOR_INSIGHT}+ bids.
          </p>
        ) : (
          <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
            {insights.map((item) => (
              <div
                key={item.key}
                className="flex min-w-0 items-start gap-3 rounded-lg border border-border/60 bg-muted/20 p-3"
              >
                <span
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                    item.tone === "good" && "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
                    item.tone === "warn" && "bg-amber-500/15 text-amber-600 dark:text-amber-400",
                    item.tone === "info" && "bg-primary/15 text-primary",
                  )}
                >
                  <item.icon className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <p className="text-[11px] font-medium text-muted-foreground">{item.title}</p>
                  <p className="truncate text-sm font-semibold" title={item.value}>
                    {item.value}
                  </p>
                  <p className="truncate text-[11px] text-muted-foreground" title={item.detail}>
                    {item.detail}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
