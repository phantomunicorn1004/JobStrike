"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { CalendarDays, Database, Loader2, MessageCircle, RefreshCw, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { colorForCandidateKey } from "@/lib/dashboard/candidate-colors";
import type { DashboardData as ServerDashboardData } from "@/lib/dashboard/load-dashboard";
import { DEFAULT_TIMEZONE, formatYmdInTimeZone, getHourInTimeZone, todayInTimeZone } from "@/lib/timezone";
import { toast } from "sonner";
import { ResponseStatsCards } from "@/components/dashboard/ResponseStatsCards";
import { StageStatsCard } from "@/components/dashboard/StageStatsCard";
import { InsightsCard } from "@/components/dashboard/InsightsCard";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { computeStageStats } from "@/lib/dashboard/stage-stats";
import { buildResponseStats } from "@/lib/dashboard/response-stats";

type CandidateCount = { key: string; label: string; count: number; color?: string };
type CandidateOption = { key: string; label: string; color?: string };
type StageCount = { stageId: string; stageName: string; count: number };
type HourlyActivityPoint = { hour: number; count: number };
type RangeMode = "week" | "month" | "custom";

type DashboardData = ServerDashboardData;

function formatChartDate(ymd: string, timeZone: string): string {
  return formatYmdInTimeZone(ymd, timeZone, { month: "short", day: "numeric" });
}

function formatLongDate(ymd: string, timeZone: string): string {
  return formatYmdInTimeZone(ymd, timeZone, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function safeCssKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function candidateColor(candidate: { key: string; color?: string }): string {
  return candidate.color || colorForCandidateKey(candidate.key);
}

function addDays(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 12));
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

/** Calendar days from `from` to `to`, both included. */
function dayCount(from: string, to: string): number {
  if (!from || !to) return 1;
  return Math.max(1, Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000) + 1);
}

/** Monday of the week that contains `ymd`. */
function weekStart(ymd: string): string {
  const weekday = new Date(`${ymd}T12:00:00Z`).getUTCDay();
  return addDays(ymd, -((weekday + 6) % 7));
}

const DASHBOARD_TAB_KEY = "jobstrike.dashboard.tab";

/** Ranges longer than this are charted by week. */
const WEEKLY_CHART_AFTER_DAYS = 45;

type Delta = { text: string; tone: "up" | "down" | "flat" };

function percentChange(current: number, previous: number): Delta | null {
  if (!previous) return null;
  const change = Math.round(((current - previous) / previous) * 100);
  return {
    text: `${change > 0 ? "+" : ""}${change}%`,
    tone: change > 0 ? "up" : change < 0 ? "down" : "flat",
  };
}

function hourLabel(hour: number): string {
  const suffix = hour < 12 ? "a" : "p";
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}${suffix}`;
}

/** "Other" bundles the profiles beyond the largest ones in the charts. */
const OTHER_KEY = "other";

/** Profiles shown on first load: every one with bids, and every one with pipeline cards. */
function defaultSelection(d: DashboardData): string[] {
  const keys = (d.bidSeriesCandidates.length ? d.bidSeriesCandidates : d.applicationsByCandidate).map((c) => c.key);
  for (const c of d.pipelineSeriesCandidates) keys.push(c.key);
  return keys;
}

export function DashboardPageClient({
  initialData = null,
}: {
  initialData?: DashboardData | null;
}) {
  const [timezone, setTimezone] = useState(
    () => initialData?.timezone || DEFAULT_TIMEZONE,
  );
  const today = todayInTimeZone(timezone);
  const [rangeMode, setRangeMode] = useState<RangeMode>(
    () => initialData?.rangeMode || "month",
  );
  const [customFrom, setCustomFrom] = useState(() => initialData?.bidFrom || "");
  const [customTo, setCustomTo] = useState(() => initialData?.bidTo || "");
  const [activityDate, setActivityDate] = useState(
    () => initialData?.activityDate || "",
  );
  const [appliedDate, setAppliedDate] = useState(
    () => initialData?.appliedDate || "",
  );
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(
    () => new Set(initialData ? defaultSelection(initialData) : []),
  );
  const selectionInitializedRef = useRef(Boolean(initialData));
  // Profiles already offered once: a profile that appears later (its first bid) starts selected.
  const knownKeysRef = useRef(new Set(initialData ? defaultSelection(initialData) : []));
  // Only the latest request may update the page (quick range clicks can answer out of order).
  const requestRef = useRef(0);
  const [data, setData] = useState<DashboardData | null>(() => initialData);
  const [isLoading, setIsLoading] = useState(() => !initialData);
  const skipInitialFetchRef = useRef(Boolean(initialData));

  const loadDashboard = useCallback(async (overrides?: {
    activityDate?: string;
    appliedDate?: string;
    rangeMode?: "week" | "month" | "custom";
    customFrom?: string;
    customTo?: string;
  }) => {
    const request = ++requestRef.current;
    setIsLoading(true);
    try {
      const nextRangeMode = overrides?.rangeMode ?? rangeMode;
      const nextActivity = overrides?.activityDate ?? activityDate;
      const nextApplied = overrides?.appliedDate ?? appliedDate;
      const nextFrom = overrides?.customFrom ?? customFrom;
      const nextTo = overrides?.customTo ?? customTo;

      const params = new URLSearchParams({ rangeMode: nextRangeMode });
      if (nextRangeMode === "custom") {
        if (nextFrom) params.set("bidFrom", nextFrom);
        if (nextTo) params.set("bidTo", nextTo);
      }
      if (nextActivity) params.set("activityDate", nextActivity);
      if (nextApplied) params.set("date", nextApplied);

      const res = await fetch(`/api/dashboard?${params}`, {
        credentials: "same-origin",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to load dashboard.");
      }
      const next = (await res.json()) as DashboardData;
      if (request !== requestRef.current) return;
      setData(next);
      if (next.timezone) setTimezone(next.timezone);
      setActivityDate((current) => current || next.activityDate);
      setAppliedDate((current) => current || next.appliedDate);
      if (!customFrom) setCustomFrom(next.bidFrom);
      if (!customTo) setCustomTo(next.bidTo);
      const offered = defaultSelection(next);
      if (!selectionInitializedRef.current) {
        setSelectedKeys(new Set(offered));
        selectionInitializedRef.current = true;
      } else {
        const fresh = offered.filter((key) => !knownKeysRef.current.has(key));
        if (fresh.length) setSelectedKeys((current) => new Set([...current, ...fresh]));
      }
      for (const key of offered) knownKeysRef.current.add(key);
    } catch (error) {
      if (request !== requestRef.current) return;
      toast.error(error instanceof Error ? error.message : "Failed to load dashboard.");
    } finally {
      if (request === requestRef.current) setIsLoading(false);
    }
  }, [activityDate, appliedDate, rangeMode, customFrom, customTo]);

  // Initial + range-mode/custom-range loads only — date picks call loadDashboard directly
  // so setting dates from the response does not trigger a second full fetch.
  useEffect(() => {
    if (skipInitialFetchRef.current) {
      skipInitialFetchRef.current = false;
      return;
    }
    void loadDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: avoid activity/applied date loop
  }, [rangeMode, rangeMode === "custom" ? customFrom : "", rangeMode === "custom" ? customTo : ""]);

  const candidateOptions = useMemo(() => {
    if (!data) return [];
    const map = new Map<string, CandidateOption>();
    for (const c of data.candidates) map.set(c.key, c);
    for (const c of data.applicationsByCandidate) {
      if (!map.has(c.key)) map.set(c.key, c);
    }
    for (const c of data.pipelineSeriesCandidates) {
      if (c.key !== OTHER_KEY && !map.has(c.key)) map.set(c.key, c);
    }
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [data]);

  // A profile is in the selection directly, or through "Other" when it is not
  // one of the profiles charted on its own.
  const seriesKeys = useMemo(
    () => new Set((data?.bidSeriesCandidates ?? []).map((c) => c.key)),
    [data?.bidSeriesCandidates],
  );
  const profileSelected = useCallback(
    (key: string) => selectedKeys.has(key) || (selectedKeys.has(OTHER_KEY) && !seriesKeys.has(key)),
    [selectedKeys, seriesKeys],
  );

  // An empty selection ("None") shows no profile, not all of them.
  const visibleBidCandidates = useMemo(() => {
    const all = data?.bidSeriesCandidates ?? [];
    return all.filter((c) => selectedKeys.has(c.key));
  }, [data?.bidSeriesCandidates, selectedKeys]);

  const bidChartConfig = useMemo(() => {
    const config: ChartConfig = {};
    for (const candidate of visibleBidCandidates) {
      config[safeCssKey(candidate.key)] = {
        label: candidate.label,
        color: candidateColor(candidate),
      };
    }
    return config;
  }, [visibleBidCandidates]);

  const bidChartData = useMemo(() => {
    return (data?.bidsStackedByDate ?? []).map((point) => {
      const next: Record<string, string | number> = { date: String(point.date) };
      let total = 0;
      for (const candidate of visibleBidCandidates) {
        const value = Number(point[candidate.key] ?? 0);
        next[safeCssKey(candidate.key)] = value;
        total += value;
      }
      next.total = total;
      return next;
    });
  }, [data?.bidsStackedByDate, visibleBidCandidates]);

  const selectedRangeTotal = useMemo(
    () => bidChartData.reduce((sum, point) => sum + Number(point.total ?? 0), 0),
    [bidChartData],
  );

  const dayBreakdown = useMemo(() => {
    const rows = data?.appliedCountByCandidate ?? [];
    return rows.filter((row) => profileSelected(row.key));
  }, [data?.appliedCountByCandidate, profileSelected]);

  const selectedDayTotal = useMemo(
    () => dayBreakdown.reduce((sum, row) => sum + row.count, 0),
    [dayBreakdown],
  );

  const visiblePipelineCandidates = useMemo(() => {
    const all = data?.pipelineSeriesCandidates ?? [];
    return all.filter((c) => selectedKeys.has(c.key));
  }, [data?.pipelineSeriesCandidates, selectedKeys]);

  const pipelineChartData = useMemo(() => {
    return (data?.pipelineByStage ?? []).map((point) => {
      const next: Record<string, string | number> = {
        stageId: String(point.stageId),
        stageName: String(point.stageName),
      };
      let total = 0;
      for (const candidate of visiblePipelineCandidates) {
        const value = Number(point[candidate.key] ?? 0);
        next[safeCssKey(candidate.key)] = value;
        total += value;
      }
      next.total = total;
      return next;
    });
  }, [data?.pipelineByStage, visiblePipelineCandidates]);

  const filteredStageCounts = useMemo(() => {
    return pipelineChartData
      .map((point) => ({
        stageId: String(point.stageId),
        stageName: String(point.stageName),
        count: Number(point.total ?? 0),
      }))
      .filter((s) => s.count > 0);
  }, [pipelineChartData]);

  const stageTotal = useMemo(
    () => filteredStageCounts.reduce((sum, s) => sum + s.count, 0),
    [filteredStageCounts],
  );

  // Bids per hour on the activity day, for the selected profiles.
  const hourly = useMemo(() => {
    const rows = data?.stageStatRows ?? [];
    if (!rows.length || !activityDate) return data?.hourlyActivity ?? [];
    const counts = Array.from({ length: 24 }, () => 0);
    for (const row of rows) {
      if (row.d !== activityDate || !profileSelected(row.p)) continue;
      const hour = getHourInTimeZone(row.at, timezone);
      if (hour >= 0 && hour < 24) counts[hour] += 1;
    }
    return counts.map((count, hour) => ({ hour, count }));
  }, [data?.stageStatRows, data?.hourlyActivity, activityDate, profileSelected, timezone]);

  const hourlyMax = useMemo(() => Math.max(1, ...hourly.map((h) => h.count)), [hourly]);

  const hourlyTotal = useMemo(() => hourly.reduce((sum, h) => sum + h.count, 0), [hourly]);

  const resumeBars = useMemo(() => {
    const rows = (data?.applicationsByCandidate ?? []).filter((r) => profileSelected(r.key));
    const max = Math.max(1, ...rows.map((r) => r.count));
    return rows.map((row) => ({
      ...row,
      pct: Math.round((row.count / max) * 100),
      share: data?.totalApplicationsAll
        ? Math.round((row.count / data.totalApplicationsAll) * 100)
        : 0,
    }));
  }, [data?.applicationsByCandidate, data?.totalApplicationsAll, profileSelected]);

  const toggleCandidate = (key: string, checked: boolean) => {
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const selectAllCandidates = () => {
    const keys = new Set(candidateOptions.map((c) => c.key));
    for (const c of data?.bidSeriesCandidates ?? []) keys.add(c.key);
    for (const c of data?.pipelineSeriesCandidates ?? []) keys.add(c.key);
    setSelectedKeys(keys);
  };

  const clearCandidates = () => setSelectedKeys(new Set());

  const rangeDays = data ? dayCount(data.bidFrom, data.bidTo) : 1;

  // Headline figures for the selected profiles: this period, and the period of
  // the same length just before it (from every application, so no extra request).
  const kpis = useMemo(() => {
    const rows = data?.stageStatRows ?? [];
    const stages = data?.pipelineStages ?? [];
    const totals = (from: string, to: string) => {
      let registered = 0;
      let responded = 0;
      if (!from || !to) return { registered, responded };
      const table = computeStageStats(rows, stages, { from, to, groupBy: "profile" }, timezone);
      for (const line of table.lines) {
        if (!profileSelected(line.key)) continue;
        registered += line.applied;
        responded += line.responded;
      }
      return { registered, responded };
    };
    const current = totals(data?.bidFrom ?? "", data?.bidTo ?? "");
    const previous = data
      ? totals(addDays(data.bidFrom, -rangeDays), addDays(data.bidFrom, -1))
      : { registered: 0, responded: 0 };
    const rate = (t: { registered: number; responded: number }) =>
      t.registered ? (t.responded / t.registered) * 100 : 0;

    const activeDays = bidChartData.filter((point) => Number(point.total ?? 0) > 0).length;
    const dayBefore = appliedDate ? addDays(appliedDate, -1) : "";
    const dayBeforeCount = dayBefore
      ? rows.filter((row) => row.d === dayBefore && profileSelected(row.p)).length
      : 0;

    const currentRate = rate(current);
    const previousRate = rate(previous);
    return {
      activeDays,
      perActiveDay: activeDays ? selectedRangeTotal / activeDays : 0,
      dayBefore,
      dayBeforeCount,
      registered: current.registered,
      responded: current.responded,
      responseRate: currentRate,
      bidsChange: percentChange(current.registered, previous.registered),
      previousBids: previous.registered,
      previousRate: previous.registered ? previousRate : null,
      allTime: resumeBars.reduce((sum, row) => sum + row.count, 0),
      profiles: resumeBars.length,
    };
  }, [data, timezone, profileSelected, selectedRangeTotal, resumeBars, rangeDays, bidChartData, appliedDate]);

  // Profiles with no bid in the range are left out of the chart instead of drawn as zero.
  const chartCandidates = useMemo(
    () =>
      visibleBidCandidates.filter((candidate) => {
        const key = safeCssKey(candidate.key);
        return bidChartData.some((point) => Number(point[key] ?? 0) > 0);
      }),
    [visibleBidCandidates, bidChartData],
  );

  // One bar per day, or per week (Monday to Sunday) for long ranges.
  const weeklyChart = rangeDays > WEEKLY_CHART_AFTER_DAYS;
  const bidBars = useMemo(() => {
    if (!weeklyChart) return bidChartData;
    const weeks = new Map<string, Record<string, string | number>>();
    for (const point of bidChartData) {
      const week = weekStart(String(point.date));
      let bucket = weeks.get(week);
      if (!bucket) {
        bucket = { date: week, total: 0 };
        weeks.set(week, bucket);
      }
      for (const [key, value] of Object.entries(point)) {
        if (key === "date") continue;
        bucket[key] = Number(bucket[key] ?? 0) + Number(value ?? 0);
      }
    }
    return [...weeks.values()];
  }, [bidChartData, weeklyChart]);

  // Response analytics for the selected profiles, computed in the browser from
  // every application's pipeline history (all time).
  const analyticsRows = useMemo(
    () => (data?.stageStatRows ?? []).filter((row) => profileSelected(row.p)),
    [data?.stageStatRows, profileSelected],
  );
  const responseStats = useMemo(() => {
    if (!data?.stageStatRows?.length || !data.pipelineStages?.length) return data?.responseStats ?? null;
    return buildResponseStats(
      analyticsRows,
      data.pipelineStages.map((stage, index) => ({ ...stage, sort_order: index })),
      timezone,
    );
  }, [analyticsRows, data?.stageStatRows, data?.pipelineStages, data?.responseStats, timezone]);
  const profileLines = useMemo(
    () =>
      data?.pipelineStages
        ? computeStageStats(analyticsRows, data.pipelineStages, { groupBy: "profile" }, timezone).lines
        : [],
    [analyticsRows, data?.pipelineStages, timezone],
  );
  const pace = useMemo(() => {
    let busiest: { label: string; count: number } | null = null;
    for (const point of bidChartData) {
      const count = Number(point.total ?? 0);
      if (count > 0 && (!busiest || count > busiest.count)) {
        busiest = { label: formatChartDate(String(point.date), timezone), count };
      }
    }
    return { rangeDays, activeDays: kpis.activeDays, perActiveDay: kpis.perActiveDay, busiest };
  }, [bidChartData, timezone, rangeDays, kpis.activeDays, kpis.perActiveDay]);

  const maxStageCount = useMemo(
    () => Math.max(1, ...pipelineChartData.map((point) => Number(point.total ?? 0))),
    [pipelineChartData],
  );

  // Remembered tab (a per-browser convenience only).
  const [tab, setTab] = useState<"overview" | "responses">("overview");
  useEffect(() => {
    try {
      if (window.localStorage.getItem(DASHBOARD_TAB_KEY) === "responses") setTab("responses");
    } catch {
      // storage unavailable: start on Overview
    }
  }, []);
  const changeTab = (value: string) => {
    const next = value === "responses" ? "responses" : "overview";
    setTab(next);
    try {
      window.localStorage.setItem(DASHBOARD_TAB_KEY, next);
    } catch {
      // storage unavailable: the tab is just not remembered
    }
  };

  const focusDay = (label: unknown) => {
    const value = typeof label === "string" ? label : "";
    if (weeklyChart || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value === appliedDate) return;
    setAppliedDate(value);
    void loadDashboard({ appliedDate: value });
  };

  const rangeLabel = data
    ? `${formatChartDate(data.bidFrom, timezone)} – ${formatChartDate(data.bidTo, timezone)}`
    : "";

  return (
    <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col gap-5">
      {/* Header: title, period, refresh */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Your bids, pipeline and response rates{rangeLabel ? ` · ${rangeLabel}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup
            type="single"
            value={rangeMode}
            onValueChange={(value) => {
              if (value === "week" || value === "month" || value === "custom") {
                setRangeMode(value);
              }
            }}
            variant="outline"
            size="sm"
          >
            <ToggleGroupItem value="week" className="h-8 px-3 text-xs">
              7 days
            </ToggleGroupItem>
            <ToggleGroupItem value="month" className="h-8 px-3 text-xs">
              30 days
            </ToggleGroupItem>
            <ToggleGroupItem value="custom" className="h-8 px-3 text-xs">
              Custom
            </ToggleGroupItem>
          </ToggleGroup>
          {rangeMode === "custom" ? (
            <div className="flex items-center gap-1.5">
              <Input
                type="date"
                value={customFrom}
                max={customTo || today}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="h-8 w-[138px] text-xs"
                aria-label="Custom from"
              />
              <span className="text-xs text-muted-foreground">to</span>
              <Input
                type="date"
                value={customTo}
                min={customFrom}
                max={today}
                onChange={(e) => setCustomTo(e.target.value)}
                className="h-8 w-[138px] text-xs"
                aria-label="Custom to"
              />
            </div>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => void loadDashboard()}
            disabled={isLoading}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} />
            <span className="ml-1.5">Refresh</span>
          </Button>
        </div>
      </div>

      {/* Profile filter: applies to every section below */}
      {candidateOptions.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs font-medium text-muted-foreground">Profiles</span>
          {candidateOptions.map((candidate) => {
            const checked = selectedKeys.has(candidate.key);
            const color = candidateColor(candidate);
            return (
              <button
                key={candidate.key}
                type="button"
                onClick={() => toggleCandidate(candidate.key, !checked)}
                aria-pressed={checked}
                className={cn(
                  "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors",
                  checked
                    ? "border-transparent bg-secondary text-foreground"
                    : "border-dashed border-border text-muted-foreground hover:text-foreground",
                )}
              >
                <span
                  className={cn("h-2 w-2 rounded-full", !checked && "opacity-40")}
                  style={{ backgroundColor: color }}
                  aria-hidden
                />
                <span className="max-w-[160px] truncate">{candidate.label}</span>
              </button>
            );
          })}
          <span className="mx-1 h-4 w-px bg-border" aria-hidden />
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={selectAllCandidates}>
            All
          </Button>
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={clearCandidates}>
            None
          </Button>
        </div>
      ) : null}

      {isLoading && !data ? (
        <div className="flex min-h-[320px] items-center justify-center rounded-xl border border-border/70">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {/* Headline figures */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiTile
              icon={Send}
              label={appliedDate === today || !appliedDate ? "Bids today" : "Bids on day"}
              value={selectedDayTotal.toLocaleString()}
              // Today is still in progress: comparing it with a full day would mislead.
              delta={appliedDate && appliedDate !== today ? percentChange(selectedDayTotal, kpis.dayBeforeCount) : null}
              hint={
                appliedDate
                  ? `${formatLongDate(appliedDate, timezone)} · day before ${kpis.dayBeforeCount}`
                  : "—"
              }
            />
            <KpiTile
              icon={CalendarDays}
              label={`Bids in ${rangeDays} days`}
              value={selectedRangeTotal.toLocaleString()}
              delta={kpis.bidsChange}
              deltaTitle={`Previous ${rangeDays} days: ${kpis.previousBids}`}
              hint={
                kpis.activeDays
                  ? `≈ ${Math.round(kpis.perActiveDay)} per bidding day · ${kpis.activeDays} of ${rangeDays} days`
                  : "No bids in range"
              }
            />
            <KpiTile
              icon={MessageCircle}
              label="Response rate"
              value={kpis.registered ? `${kpis.responseRate.toFixed(1)}%` : "—"}
              hintTitle={
                kpis.previousRate != null
                  ? `Previous ${rangeDays} days: ${kpis.previousRate.toFixed(1)}%. Older bids have had more time to get answers, so the latest period usually looks lower.`
                  : undefined
              }
              hint={
                kpis.registered
                  ? `${kpis.responded} of ${kpis.registered} bids${
                      kpis.previousRate != null ? ` · before ${kpis.previousRate.toFixed(1)}%` : ""
                    }`
                  : "No bids in range"
              }
              accent
            />
            <KpiTile
              icon={Database}
              label="All-time bids"
              value={kpis.allTime.toLocaleString()}
              hint={`${kpis.profiles} profile${kpis.profiles === 1 ? "" : "s"} selected`}
            />
          </div>

          <Tabs value={tab} onValueChange={changeTab} className="min-w-0 gap-4">
            <TabsList>
              <TabsTrigger value="overview" className="px-4 text-xs">
                Overview
              </TabsTrigger>
              <TabsTrigger value="responses" className="px-4 text-xs">
                Response analytics
              </TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="mt-0 flex min-w-0 flex-col gap-4">
          <InsightsCard stats={responseStats} profileLines={profileLines} pace={pace} />

          {/* Bids over time */}
          <Card className="min-w-0 border-border/70 shadow-none">
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0 pb-2">
              <div>
                <CardTitle className="text-base font-medium">Bids over time</CardTitle>
                <CardDescription className="text-xs">
                  {weeklyChart
                    ? "Bids per week (Mon–Sun), by profile"
                    : "Bids per day, by profile · click a bar to see that day below"}
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Focus day</span>
                <Input
                  type="date"
                  value={appliedDate || today}
                  max={today}
                  onChange={(e) => {
                    const value = e.target.value || today;
                    setAppliedDate(value);
                    void loadDashboard({ appliedDate: value });
                  }}
                  className="h-8 w-[138px] text-xs"
                  aria-label="Focus day"
                />
              </div>
            </CardHeader>
            <CardContent className="space-y-3 pt-1">
              {visibleBidCandidates.length === 0 ? (
                <EmptyState text="Select a profile above to see its bids." />
              ) : chartCandidates.length === 0 ? (
                <EmptyState text="No bids in this range for the selected profiles." />
              ) : (
                <ChartContainer config={bidChartConfig} className="aspect-auto h-[240px] w-full">
                  <BarChart
                    data={bidBars}
                    margin={{ left: 0, right: 8, top: 8, bottom: 0 }}
                    barCategoryGap={bidBars.length > 20 ? 2 : "20%"}
                    onClick={(state) => focusDay(state?.activeLabel)}
                    className={weeklyChart ? undefined : "cursor-pointer"}
                  >
                    <CartesianGrid vertical={false} strokeDasharray="3 3" />
                    <XAxis
                      dataKey="date"
                      tickLine={false}
                      axisLine={false}
                      tickMargin={8}
                      minTickGap={16}
                      tickFormatter={(value) => formatChartDate(String(value), timezone)}
                      className="text-[10px]"
                    />
                    <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={30} className="text-[10px]" />
                    <ChartTooltip
                      cursor={{ fill: "var(--muted)", opacity: 0.5 }}
                      content={
                        <ChartTooltipContent
                          labelFormatter={(value) =>
                            weeklyChart
                              ? `Week of ${formatChartDate(String(value), timezone)}`
                              : formatLongDate(String(value), timezone)
                          }
                        />
                      }
                    />
                    {chartCandidates.length > 1 ? (
                      <ChartLegend content={<ChartLegendContent className="pt-2 text-[11px]" />} />
                    ) : null}
                    {chartCandidates.map((candidate, index) => (
                      <Bar
                        key={candidate.key}
                        dataKey={safeCssKey(candidate.key)}
                        name={candidate.label}
                        stackId="bids"
                        fill={candidateColor(candidate)}
                        maxBarSize={40}
                        radius={index === chartCandidates.length - 1 ? [3, 3, 0, 0] : 0}
                      />
                    ))}
                  </BarChart>
                </ChartContainer>
              )}
              {dayBreakdown.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1.5 border-t border-border/60 pt-3">
                  <span className="mr-1 text-[11px] text-muted-foreground">
                    {appliedDate ? formatLongDate(appliedDate, timezone) : "Focus day"}
                  </span>
                  {dayBreakdown.map((item) => (
                    <span
                      key={item.key}
                      className="inline-flex items-center gap-1.5 rounded-md bg-muted/60 px-2 py-0.5 text-[11px] tabular-nums"
                    >
                      <span
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ backgroundColor: candidateColor(item) }}
                        aria-hidden
                      />
                      <span className="text-muted-foreground">{item.label}</span>
                      <span className="font-medium">{item.count}</span>
                    </span>
                  ))}
                </div>
              ) : null}
            </CardContent>
          </Card>

          {/* Pipeline | Activity | Profiles */}
          <div className="grid min-w-0 gap-4 lg:grid-cols-3">
            <Card className="min-w-0 border-border/70 shadow-none">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-medium">Pipeline</CardTitle>
                <CardDescription className="text-xs">
                  Where cards are now, if they moved there in this range
                  {stageTotal > 0 ? ` · ${stageTotal} cards` : ""}
                </CardDescription>
              </CardHeader>
              <CardContent className="min-w-0 pt-1">
                {stageTotal === 0 ? (
                  <EmptyState text="No pipeline movement in this range for the selected profiles." compact />
                ) : (
                  <>
                    <ul className="space-y-3">
                      {pipelineChartData.map((point) => {
                        const count = Number(point.total ?? 0);
                        const share = stageTotal ? Math.round((count / stageTotal) * 100) : 0;
                        return (
                          <li key={String(point.stageId)} className="space-y-1">
                            <div className="flex items-center justify-between gap-2 text-xs">
                              <span className="truncate">{String(point.stageName)}</span>
                              <span className="shrink-0 tabular-nums text-muted-foreground">
                                <span className={cn("font-medium", count ? "text-foreground" : "")}>{count}</span>
                                {count ? ` · ${share}%` : ""}
                              </span>
                            </div>
                            <div className="h-2.5 overflow-hidden rounded-full bg-muted">
                              <div
                                className="flex h-full overflow-hidden rounded-full"
                                style={{ width: `${count ? Math.max((count / maxStageCount) * 100, 3) : 0}%` }}
                              >
                                {visiblePipelineCandidates.map((candidate) => {
                                  const value = Number(point[safeCssKey(candidate.key)] ?? 0);
                                  if (!value) return null;
                                  return (
                                    <div
                                      key={candidate.key}
                                      className="h-full"
                                      title={`${candidate.label}: ${value}`}
                                      style={{ width: `${(value / count) * 100}%`, backgroundColor: candidateColor(candidate) }}
                                    />
                                  );
                                })}
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                    {visiblePipelineCandidates.length > 1 ? (
                      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 border-t border-border/60 pt-2.5">
                        {visiblePipelineCandidates.map((candidate) => (
                          <span key={candidate.key} className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: candidateColor(candidate) }} />
                            {candidate.label}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </>
                )}
              </CardContent>
            </Card>

              <Card className="border-border/70 shadow-none">
                <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 pb-2">
                  <div>
                    <CardTitle className="text-base font-medium">Hourly activity</CardTitle>
                    <CardDescription className="text-xs">{hourlyTotal} bids by hour</CardDescription>
                  </div>
                  <Input
                    type="date"
                    value={activityDate || today}
                    max={today}
                    onChange={(e) => {
                      const value = e.target.value || today;
                      setActivityDate(value);
                      void loadDashboard({ activityDate: value });
                    }}
                    className="h-8 w-[138px] text-xs"
                    aria-label="Activity day"
                  />
                </CardHeader>
                <CardContent className="pt-1">
                  <div className="grid gap-1" style={{ gridTemplateColumns: "repeat(12, minmax(0, 1fr))" }}>
                    {hourly.map((slot) => {
                      const intensity = slot.count / hourlyMax;
                      return (
                        <div key={slot.hour} title={`${hourLabel(slot.hour)}: ${slot.count}`}>
                          <div
                            className="aspect-square rounded-md border border-border/40"
                            style={{
                              backgroundColor:
                                slot.count === 0
                                  ? "color-mix(in srgb, var(--muted) 35%, transparent)"
                                  : `color-mix(in srgb, var(--primary) ${Math.round(28 + intensity * 72)}%, transparent)`,
                            }}
                          />
                          <span className="mt-0.5 block text-center text-[9px] text-muted-foreground">
                            {slot.hour % 3 === 0 ? hourLabel(slot.hour) : ""}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    {activityDate ? formatLongDate(activityDate, timezone) : "—"} · darker = more bids
                  </p>
                </CardContent>
              </Card>

              <Card className="border-border/70 shadow-none">
                <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 pb-2">
                  <div>
                    <CardTitle className="text-base font-medium">Bids by profile</CardTitle>
                    <CardDescription className="text-xs">All time, from Resume DB</CardDescription>
                  </div>
                  <Button asChild variant="ghost" size="sm" className="h-8 px-2 text-xs">
                    <Link href="/resume-db">Open Resume DB</Link>
                  </Button>
                </CardHeader>
                <CardContent className="space-y-2.5 pt-1">
                  {resumeBars.length === 0 ? (
                    <EmptyState text="No profiles selected." compact />
                  ) : (
                    resumeBars.map((row) => (
                      <div key={row.key} className="space-y-1">
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: candidateColor(row) }} />
                            <span className="truncate">{row.label}</span>
                          </span>
                          <span className="tabular-nums text-muted-foreground">
                            <span className="font-medium text-foreground">{row.count.toLocaleString()}</span> · {row.share}%
                          </span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${row.pct}%`, backgroundColor: candidateColor(row) }}
                          />
                        </div>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
          </div>
            </TabsContent>

            <TabsContent value="responses" className="mt-0 flex min-w-0 flex-col gap-4">
          <p className="text-xs text-muted-foreground">
            How far your bids get, by profile, platform and timing. A bid counts as answered once its card is on the
            pipeline board, so move cards when companies reply to keep these accurate.
          </p>

          <StageStatsCard
            rows={data?.stageStatRows ? analyticsRows : undefined}
            stages={data?.pipelineStages}
            timezone={timezone}
            pageFrom={data?.bidFrom}
            pageTo={data?.bidTo}
          />

          <ResponseStatsCards stats={responseStats} />
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}

function KpiTile({
  icon: Icon,
  label,
  value,
  hint,
  delta = null,
  deltaTitle,
  hintTitle,
  accent = false,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  hint: string;
  /** Change against the previous period. */
  delta?: Delta | null;
  deltaTitle?: string;
  hintTitle?: string;
  accent?: boolean;
}) {
  return (
    <Card className={cn("border-border/70 shadow-none", accent && "border-primary/30 bg-primary/[0.04]")}>
      <CardContent className="flex items-start justify-between gap-3 p-4">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <p className="text-2xl font-semibold tabular-nums tracking-tight sm:text-3xl">{value}</p>
            {delta ? (
              <span
                title={deltaTitle}
                className={cn(
                  "rounded-md px-1.5 py-0.5 text-[11px] font-medium tabular-nums",
                  delta.tone === "up" && "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
                  delta.tone === "down" && "bg-rose-500/15 text-rose-600 dark:text-rose-400",
                  delta.tone === "flat" && "bg-muted text-muted-foreground",
                )}
              >
                {delta.tone === "up" ? "▲ " : delta.tone === "down" ? "▼ " : ""}
                {delta.text}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground sm:truncate" title={hintTitle ?? hint}>
            {hint}
          </p>
        </div>
        <span
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground",
            accent && "bg-primary/15 text-primary",
          )}
        >
          <Icon className="h-4 w-4" />
        </span>
      </CardContent>
    </Card>
  );
}

function EmptyState({ text, compact = false }: { text: string; compact?: boolean }) {
  return (
    <p
      className={cn(
        "rounded-lg border border-dashed border-border/70 text-center text-sm text-muted-foreground",
        compact ? "px-3 py-4" : "px-4 py-12",
      )}
    >
      {text}
    </p>
  );
}
