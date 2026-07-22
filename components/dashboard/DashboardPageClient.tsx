"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import JobsLayout from "@/app/jobs-layout";
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
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle, CalendarDays, Loader2, RefreshCw, TrendingUp, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { DEFAULT_TIMEZONE, formatYmdInTimeZone, todayInTimeZone } from "@/lib/timezone";
import { toast } from "sonner";

type BidPoint = { date: string; count: number };
type StageCount = { stageId: string; stageName: string; count: number };
type CandidateCount = { key: string; label: string; count: number };
type CandidateOption = { key: string; label: string };
type StalePipelineCard = {
  id: number;
  source: "jobs" | "technical_jobs";
  title: string;
  companyName: string;
  stageId: string;
  stageName: string;
  daysInStage: number;
  enteredAt: string;
};
type BidRange = "week" | "month";

const BID_RANGE_DAYS: Record<BidRange, number> = {
  week: 7,
  month: 30,
};

type DashboardData = {
  appliedDate: string;
  appliedCount: number;
  appliedCountByCandidate: CandidateCount[];
  appliedInBidRange: number;
  bidsByDate: BidPoint[];
  bidsStackedByDate: Array<Record<string, string | number>>;
  bidSeriesCandidates: CandidateCount[];
  bidFrom: string;
  bidTo: string;
  stageCounts: StageCount[];
  funnelCounts: StageCount[];
  stageFrom: string;
  stageTo: string;
  timezone: string;
  totalApplications: number;
  totalApplicationsAll: number;
  applicationsByCandidate: CandidateCount[];
  totalPipelineCards: number;
  stalePipelineCards: StalePipelineCard[];
  candidates: CandidateOption[];
  candidateFilter: string | null;
  pipelineIsAccountWide: boolean;
};

const STAGE_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "#6666ff",
  "#8888ff",
  "#9944ff",
];

const CANDIDATE_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "#7c8cff",
  "#a78bfa",
  "#94a3b8",
];

function formatChartDate(ymd: string, timeZone: string): string {
  return formatYmdInTimeZone(ymd, timeZone, { month: "short", day: "numeric" });
}

function formatLongDate(ymd: string, timeZone: string): string {
  return formatYmdInTimeZone(ymd, timeZone, {
    weekday: "short",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function safeCssKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export function DashboardPageClient() {
  const [timezone, setTimezone] = useState(DEFAULT_TIMEZONE);
  const today = todayInTimeZone(timezone);
  const [appliedDate, setAppliedDate] = useState("");
  const [bidRange, setBidRange] = useState<BidRange>("month");
  const [stageFrom, setStageFrom] = useState("");
  const [stageTo, setStageTo] = useState("");
  const [candidateFilter, setCandidateFilter] = useState("");
  const [data, setData] = useState<DashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadDashboard = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({
        bidDays: String(BID_RANGE_DAYS[bidRange]),
      });
      if (appliedDate) params.set("date", appliedDate);
      if (stageFrom) params.set("stageFrom", stageFrom);
      if (stageTo) params.set("stageTo", stageTo);
      if (candidateFilter) params.set("candidateFilter", candidateFilter);
      const res = await fetch(`/api/dashboard?${params}`, {
        credentials: "same-origin",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to load dashboard.");
      }
      const next = (await res.json()) as DashboardData;
      setData(next);
      if (next.timezone) setTimezone(next.timezone);
      setAppliedDate(next.appliedDate);
      setStageFrom(next.stageFrom);
      setStageTo(next.stageTo);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load dashboard.");
    } finally {
      setIsLoading(false);
    }
  }, [appliedDate, bidRange, candidateFilter, stageFrom, stageTo]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  const stageChartConfig = useMemo(() => {
    const config: ChartConfig = {};
    for (const [index, stage] of (data?.stageCounts ?? []).entries()) {
      config[stage.stageId] = {
        label: stage.stageName,
        color: STAGE_COLORS[index % STAGE_COLORS.length],
      };
    }
    return config;
  }, [data?.stageCounts]);

  const bidStackedConfig = useMemo(() => {
    const config: ChartConfig = {};
    for (const [index, candidate] of (data?.bidSeriesCandidates ?? []).entries()) {
      config[safeCssKey(candidate.key)] = {
        label: candidate.label,
        color: CANDIDATE_COLORS[index % CANDIDATE_COLORS.length],
      };
    }
    return config;
  }, [data?.bidSeriesCandidates]);

  const stackedChartData = useMemo(() => {
    return (data?.bidsStackedByDate ?? []).map((point) => {
      const next: Record<string, string | number> = { date: point.date };
      for (const candidate of data?.bidSeriesCandidates ?? []) {
        next[safeCssKey(candidate.key)] = Number(point[candidate.key] ?? 0);
      }
      return next;
    });
  }, [data?.bidSeriesCandidates, data?.bidsStackedByDate]);

  const resumeDbBarData = useMemo(() => {
    const rows = data?.applicationsByCandidate ?? [];
    const max = Math.max(1, ...rows.map((row) => row.count));
    return rows.map((row) => ({ ...row, pct: Math.round((row.count / max) * 100) }));
  }, [data?.applicationsByCandidate]);

  const funnelMax = useMemo(
    () => Math.max(1, ...(data?.funnelCounts ?? []).map((s) => s.count)),
    [data?.funnelCounts],
  );

  const stageTotal = useMemo(
    () => (data?.stageCounts ?? []).reduce((sum, s) => sum + s.count, 0),
    [data?.stageCounts],
  );

  const bidRangeLabel = bidRange === "week" ? "Last 7 days" : "Last 30 days";
  const selectedCandidateLabel =
    data?.candidates.find((c) => c.key === candidateFilter)?.label ?? null;

  return (
    <JobsLayout>
      <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Dashboard</h1>
            <p className="text-sm text-muted-foreground">
              Applications and pipeline activity at a glance.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-sm">
              <Users className="h-4 w-4 text-muted-foreground" />
              <select
                value={candidateFilter}
                onChange={(e) => setCandidateFilter(e.target.value)}
                className="border-input bg-card dark:bg-input/30 h-9 min-w-[180px] rounded-md border px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                aria-label="Filter dashboard by candidate"
              >
                <option value="">All candidates</option>
                {(data?.candidates ?? []).map((candidate) => (
                  <option key={candidate.key} value={candidate.key}>
                    {candidate.label}
                  </option>
                ))}
              </select>
            </label>
            <Button
              variant="outline"
              size="sm"
              className="rounded-lg"
              onClick={loadDashboard}
              disabled={isLoading}
            >
              <RefreshCw className={cn("h-4 w-4 sm:mr-2", isLoading && "animate-spin")} />
              <span className="hidden sm:inline">Refresh</span>
            </Button>
          </div>
        </div>

        {isLoading && !data ? (
          <Card className="flex min-h-[240px] items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </Card>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <Card className="rounded-xl md:col-span-1">
                <CardHeader className="pb-2">
                  <CardDescription className="flex items-center gap-1.5">
                    <CalendarDays className="h-4 w-4" />
                    Applied jobs
                    {selectedCandidateLabel ? ` · ${selectedCandidateLabel}` : ""}
                  </CardDescription>
                  <CardTitle className="text-4xl tabular-nums">
                    {data?.appliedCount ?? 0}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    {appliedDate
                      ? formatLongDate(appliedDate, timezone)
                      : "Pick a date"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {data?.appliedInBidRange ?? 0} applied in the chart range
                    {data
                      ? ` (${formatChartDate(data.bidFrom, timezone)} – ${formatChartDate(data.bidTo, timezone)})`
                      : ""}
                    .
                  </p>
                  <label className="grid gap-1.5 text-sm">
                    <span className="text-xs font-medium text-muted-foreground">
                      View count for date
                    </span>
                    <Input
                      type="date"
                      value={appliedDate || today}
                      max={today}
                      onChange={(e) => setAppliedDate(e.target.value || today)}
                      className="h-9"
                    />
                  </label>
                  {(data?.appliedCountByCandidate.length ?? 0) > 0 ? (
                    <ul className="max-h-[120px] space-y-1 overflow-y-auto text-xs">
                      {(data?.appliedCountByCandidate ?? []).map((item) => (
                        <li
                          key={item.key}
                          className="flex items-center justify-between gap-2 rounded-md border px-2 py-1"
                        >
                          <span className="truncate">{item.label}</span>
                          <span className="tabular-nums font-medium">{item.count}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </CardContent>
              </Card>

              <Card className="rounded-xl md:col-span-1">
                <CardHeader className="pb-2">
                  <CardDescription>Resume DB</CardDescription>
                  <CardTitle className="text-3xl tabular-nums">
                    {data?.totalApplications ?? 0}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    {candidateFilter
                      ? `Registered applications for ${selectedCandidateLabel ?? "selected candidate"}.`
                      : `All registered applications (${data?.totalApplicationsAll ?? 0} total).`}
                  </p>
                  {resumeDbBarData.length > 0 ? (
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">Per candidate</p>
                      <ul className="max-h-[160px] space-y-2 overflow-y-auto">
                        {resumeDbBarData.map((row) => (
                          <li key={row.key} className="space-y-1">
                            <div className="flex items-center justify-between gap-2 text-xs">
                              <span
                                className={cn(
                                  "truncate",
                                  candidateFilter === row.key && "font-medium text-foreground",
                                )}
                              >
                                {row.label}
                              </span>
                              <span className="shrink-0 tabular-nums text-muted-foreground">
                                {row.count}
                                {data?.totalApplicationsAll
                                  ? ` · ${Math.round((row.count / data.totalApplicationsAll) * 100)}%`
                                  : ""}
                              </span>
                            </div>
                            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                              <div
                                className={cn(
                                  "h-full rounded-full",
                                  candidateFilter === row.key ? "bg-primary" : "bg-primary/80",
                                )}
                                style={{ width: `${row.pct}%` }}
                              />
                            </div>
                          </li>
                        ))}
                      </ul>
                      <Button asChild variant="link" className="h-auto px-0 text-xs">
                        <Link href="/resume-db">Open Resume DB</Link>
                      </Button>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">No registered applications yet.</p>
                  )}
                </CardContent>
              </Card>

              <Card className="rounded-xl md:col-span-1">
                <CardHeader className="pb-2">
                  <CardDescription>Pipeline cards</CardDescription>
                  <CardTitle className="text-3xl tabular-nums">
                    {data?.totalPipelineCards ?? 0}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    Active cards across all Job Pipeline stages.
                  </p>
                  {candidateFilter ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Pipeline is account-wide and is not filtered by candidate.
                    </p>
                  ) : null}
                </CardContent>
              </Card>
            </div>

            <div className="grid min-w-0 gap-4 xl:grid-cols-2 xl:items-start">
              <Card className="min-w-0 rounded-xl">
                <CardHeader className="gap-3 space-y-0 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex min-w-0 items-start gap-2">
                    <TrendingUp className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <CardTitle className="text-lg">Applications per day</CardTitle>
                      <CardDescription className="truncate">
                        {data
                          ? `${bidRangeLabel} (${formatChartDate(data.bidFrom, timezone)} – ${formatChartDate(data.bidTo, timezone)})`
                          : bidRangeLabel}
                        {selectedCandidateLabel ? ` · ${selectedCandidateLabel}` : " · stacked by candidate"}
                      </CardDescription>
                    </div>
                  </div>
                  <ToggleGroup
                    type="single"
                    value={bidRange}
                    onValueChange={(value) => {
                      if (value === "week" || value === "month") setBidRange(value);
                    }}
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                  >
                    <ToggleGroupItem value="week" aria-label="Weekly view">
                      Weekly
                    </ToggleGroupItem>
                    <ToggleGroupItem value="month" aria-label="Monthly view">
                      Monthly
                    </ToggleGroupItem>
                  </ToggleGroup>
                </CardHeader>
                <CardContent className="min-w-0">
                  {(data?.bidSeriesCandidates.length ?? 0) === 0 ? (
                    <ChartContainer
                      config={{ count: { label: "Applications", color: "var(--chart-1)" } }}
                      className="aspect-auto h-[220px] w-full min-h-0 min-w-0 sm:h-[260px]"
                    >
                      <BarChart
                        data={data?.bidsByDate ?? []}
                        margin={{ left: 0, right: 4, top: 8, bottom: 0 }}
                      >
                        <CartesianGrid vertical={false} />
                        <XAxis
                          dataKey="date"
                          tickLine={false}
                          axisLine={false}
                          tickMargin={8}
                          interval={bidRange === "month" ? 4 : 0}
                          minTickGap={bidRange === "month" ? 8 : 16}
                          tickFormatter={(value) => formatChartDate(String(value), timezone)}
                        />
                        <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={28} />
                        <ChartTooltip
                          content={
                            <ChartTooltipContent
                              labelFormatter={(value) => formatLongDate(String(value), timezone)}
                            />
                          }
                        />
                        <Bar dataKey="count" fill="var(--color-count)" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ChartContainer>
                  ) : (
                    <ChartContainer
                      config={bidStackedConfig}
                      className="aspect-auto h-[220px] w-full min-h-0 min-w-0 sm:h-[260px]"
                    >
                      <BarChart
                        data={stackedChartData}
                        margin={{ left: 0, right: 4, top: 8, bottom: 0 }}
                      >
                        <CartesianGrid vertical={false} />
                        <XAxis
                          dataKey="date"
                          tickLine={false}
                          axisLine={false}
                          tickMargin={8}
                          interval={bidRange === "month" ? 4 : 0}
                          minTickGap={bidRange === "month" ? 8 : 16}
                          tickFormatter={(value) => formatChartDate(String(value), timezone)}
                        />
                        <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={28} />
                        <ChartTooltip
                          content={
                            <ChartTooltipContent
                              labelFormatter={(value) => formatLongDate(String(value), timezone)}
                            />
                          }
                        />
                        {(data?.bidSeriesCandidates.length ?? 0) > 1 ? (
                          <ChartLegend content={<ChartLegendContent />} />
                        ) : null}
                        {(data?.bidSeriesCandidates ?? []).map((candidate, index) => (
                          <Bar
                            key={candidate.key}
                            dataKey={safeCssKey(candidate.key)}
                            name={candidate.label}
                            stackId="applications"
                            fill={CANDIDATE_COLORS[index % CANDIDATE_COLORS.length]}
                            radius={
                              index === (data?.bidSeriesCandidates.length ?? 0) - 1
                                ? [4, 4, 0, 0]
                                : [0, 0, 0, 0]
                            }
                          />
                        ))}
                      </BarChart>
                    </ChartContainer>
                  )}
                </CardContent>
              </Card>

              <Card className="min-w-0 rounded-xl">
                <CardHeader className="gap-3 space-y-0 sm:flex-row sm:items-end sm:justify-between">
                  <div className="min-w-0">
                    <CardTitle className="text-lg">Pipeline by stage</CardTitle>
                    <CardDescription>
                      Cards counted by when they entered their current stage
                      {stageTotal > 0 ? ` (${stageTotal} total)` : ""}.
                    </CardDescription>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-end gap-2">
                    <label className="grid gap-1 text-xs text-muted-foreground">
                      From
                      <Input
                        type="date"
                        value={stageFrom}
                        max={stageTo}
                        onChange={(e) => setStageFrom(e.target.value)}
                        className="h-9 w-[132px]"
                      />
                    </label>
                    <label className="grid gap-1 text-xs text-muted-foreground">
                      To
                      <Input
                        type="date"
                        value={stageTo}
                        min={stageFrom}
                        max={today}
                        onChange={(e) => setStageTo(e.target.value)}
                        className="h-9 w-[132px]"
                      />
                    </label>
                  </div>
                </CardHeader>
                <CardContent className="min-w-0 space-y-4">
                  {(data?.stageCounts.length ?? 0) === 0 || stageTotal === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      No pipeline cards entered a stage in this date range.
                    </p>
                  ) : (
                    <div className="grid min-w-0 gap-4 sm:grid-cols-[minmax(0,160px)_minmax(0,1fr)] sm:items-center">
                      <ChartContainer
                        config={stageChartConfig}
                        className="mx-auto aspect-square h-[160px] w-full max-w-[160px] min-w-0 sm:mx-0"
                      >
                        <PieChart>
                          <ChartTooltip content={<ChartTooltipContent nameKey="stageName" />} />
                          <Pie
                            data={data?.stageCounts ?? []}
                            dataKey="count"
                            nameKey="stageName"
                            innerRadius={44}
                            outerRadius={72}
                            paddingAngle={2}
                          >
                            {(data?.stageCounts ?? []).map((entry, index) => (
                              <Cell
                                key={entry.stageId}
                                fill={STAGE_COLORS[index % STAGE_COLORS.length]}
                              />
                            ))}
                          </Pie>
                        </PieChart>
                      </ChartContainer>
                      <ul className="grid max-h-[220px] min-w-0 gap-1.5 overflow-y-auto text-sm">
                        {(data?.stageCounts ?? []).map((stage, index) => (
                          <li
                            key={stage.stageId}
                            className="flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5"
                          >
                            <span className="flex min-w-0 items-center gap-2">
                              <span
                                className="h-2.5 w-2.5 shrink-0 rounded-full"
                                style={{
                                  backgroundColor: STAGE_COLORS[index % STAGE_COLORS.length],
                                }}
                              />
                              <span className="truncate">{stage.stageName}</span>
                            </span>
                            <span className="shrink-0 tabular-nums font-medium">
                              {stage.count}
                              <span className="ml-1 font-normal text-muted-foreground">
                                ({stageTotal ? Math.round((stage.count / stageTotal) * 100) : 0}%)
                              </span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {(data?.funnelCounts.length ?? 0) > 0 ? (
                    <div className="space-y-2 border-t pt-3">
                      <p className="text-xs font-medium text-muted-foreground">
                        Funnel snapshot (same date range)
                      </p>
                      <ul className="space-y-2">
                        {(data?.funnelCounts ?? []).map((stage, index) => (
                          <li key={stage.stageId} className="space-y-1">
                            <div className="flex items-center justify-between gap-2 text-xs">
                              <span className="truncate">{stage.stageName}</span>
                              <span className="tabular-nums text-muted-foreground">
                                {stage.count}
                              </span>
                            </div>
                            <div className="h-2 overflow-hidden rounded-full bg-muted">
                              <div
                                className="h-full rounded-full"
                                style={{
                                  width: `${Math.round((stage.count / funnelMax) * 100)}%`,
                                  backgroundColor: STAGE_COLORS[index % STAGE_COLORS.length],
                                }}
                              />
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            </div>

            <Card className="rounded-xl">
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-1.5">
                  <AlertTriangle className="h-4 w-4" />
                  Stale pipeline cards
                </CardDescription>
                <CardTitle className="text-lg">Needs attention</CardTitle>
              </CardHeader>
              <CardContent>
                {(data?.stalePipelineCards.length ?? 0) === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No cards have sat in the same stage for 7+ days.
                  </p>
                ) : (
                  <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                    {(data?.stalePipelineCards ?? []).map((card) => (
                      <li
                        key={`${card.source}-${card.id}`}
                        className="rounded-lg border px-3 py-2 text-sm"
                      >
                        <div className="font-medium leading-snug">{card.title}</div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {card.companyName}
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-2 text-xs">
                          <span className="rounded-md bg-muted px-1.5 py-0.5">{card.stageName}</span>
                          <span className="tabular-nums text-muted-foreground">
                            {card.daysInStage}d
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                <Button asChild variant="link" className="mt-2 h-auto px-0 text-xs">
                  <Link href="/jobs">Open Job Pipeline</Link>
                </Button>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </JobsLayout>
  );
}
