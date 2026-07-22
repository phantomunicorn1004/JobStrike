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
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts";
import { Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { DEFAULT_TIMEZONE, formatYmdInTimeZone, todayInTimeZone } from "@/lib/timezone";
import { toast } from "sonner";

type BidPoint = { date: string; count: number };
type StageCount = { stageId: string; stageName: string; count: number };
type CandidateCount = { key: string; label: string; count: number };
type CandidateOption = { key: string; label: string };
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
  stageFrom: string;
  stageTo: string;
  timezone: string;
  totalApplications: number;
  totalApplicationsAll: number;
  applicationsByCandidate: CandidateCount[];
  candidates: CandidateOption[];
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
    month: "short",
    day: "numeric",
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

  const bidLineConfig = useMemo(() => {
    const config: ChartConfig = {};
    for (const [index, candidate] of (data?.bidSeriesCandidates ?? []).entries()) {
      config[safeCssKey(candidate.key)] = {
        label: candidate.label,
        color: CANDIDATE_COLORS[index % CANDIDATE_COLORS.length],
      };
    }
    return config;
  }, [data?.bidSeriesCandidates]);

  const lineChartData = useMemo(() => {
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

  const stageTotal = useMemo(
    () => (data?.stageCounts ?? []).reduce((sum, s) => sum + s.count, 0),
    [data?.stageCounts],
  );

  const bidRangeLabel = bidRange === "week" ? "7 days" : "30 days";
  const selectedCandidateLabel =
    data?.candidates.find((c) => c.key === candidateFilter)?.label ?? null;

  return (
    <JobsLayout>
      <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col gap-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Dashboard</h1>
            <p className="text-xs text-muted-foreground sm:text-sm">
              Application activity
              {selectedCandidateLabel ? ` · ${selectedCandidateLabel}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={candidateFilter}
              onChange={(e) => setCandidateFilter(e.target.value)}
              className="border-input bg-card dark:bg-input/30 h-8 min-w-[160px] rounded-md border px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
              aria-label="Filter dashboard by candidate"
            >
              <option value="">All candidates</option>
              {(data?.candidates ?? []).map((candidate) => (
                <option key={candidate.key} value={candidate.key}>
                  {candidate.label}
                </option>
              ))}
            </select>
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              onClick={loadDashboard}
              disabled={isLoading}
            >
              <RefreshCw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} />
              <span className="sr-only sm:not-sr-only sm:ml-1.5">Refresh</span>
            </Button>
          </div>
        </div>

        {isLoading && !data ? (
          <div className="flex min-h-[220px] items-center justify-center rounded-xl border">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <Card className="border-border/70 shadow-none">
                <CardHeader className="gap-1 space-y-0 pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <CardDescription className="text-xs">Applied</CardDescription>
                      <CardTitle className="mt-1 text-3xl font-semibold tabular-nums tracking-tight">
                        {data?.appliedCount ?? 0}
                      </CardTitle>
                    </div>
                    <Input
                      type="date"
                      value={appliedDate || today}
                      max={today}
                      onChange={(e) => setAppliedDate(e.target.value || today)}
                      className="h-8 w-[140px] text-xs"
                      aria-label="Applied date"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {appliedDate ? formatLongDate(appliedDate, timezone) : "—"}
                    {" · "}
                    {data?.appliedInBidRange ?? 0} in {bidRangeLabel}
                  </p>
                </CardHeader>
                {(data?.appliedCountByCandidate.length ?? 0) > 1 ? (
                  <CardContent className="pt-0">
                    <ul className="flex flex-wrap gap-1.5">
                      {(data?.appliedCountByCandidate ?? []).map((item) => (
                        <li
                          key={item.key}
                          className="rounded-md bg-muted/60 px-2 py-1 text-xs tabular-nums"
                        >
                          <span className="text-muted-foreground">{item.label}</span>
                          <span className="ml-1.5 font-medium">{item.count}</span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                ) : null}
              </Card>

              <Card className="border-border/70 shadow-none">
                <CardHeader className="gap-1 space-y-0 pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <CardDescription className="text-xs">Resume DB</CardDescription>
                      <CardTitle className="mt-1 text-3xl font-semibold tabular-nums tracking-tight">
                        {data?.totalApplications ?? 0}
                      </CardTitle>
                    </div>
                    <Button asChild variant="ghost" size="sm" className="h-8 px-2 text-xs">
                      <Link href="/resume-db">Open</Link>
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {candidateFilter
                      ? selectedCandidateLabel ?? "Selected candidate"
                      : `${data?.totalApplicationsAll ?? 0} registered total`}
                  </p>
                </CardHeader>
                {resumeDbBarData.length > 0 ? (
                  <CardContent className="space-y-2.5 pt-0">
                    {resumeDbBarData.map((row) => (
                      <div key={row.key} className="space-y-1">
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span
                            className={cn(
                              "truncate",
                              candidateFilter === row.key && "font-medium",
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
                        <div className="h-1 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-primary/75"
                            style={{ width: `${row.pct}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </CardContent>
                ) : null}
              </Card>
            </div>

            <div className="grid min-w-0 gap-4 xl:grid-cols-2">
              <Card className="min-w-0 border-border/70 shadow-none">
                <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 pb-2">
                  <div className="min-w-0">
                    <CardTitle className="text-base font-medium">Applications / day</CardTitle>
                    <CardDescription className="text-xs">
                      {data
                        ? `${bidRangeLabel} · ${formatChartDate(data.bidFrom, timezone)}–${formatChartDate(data.bidTo, timezone)}`
                        : bidRangeLabel}
                    </CardDescription>
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
                    <ToggleGroupItem value="week" className="h-7 px-2.5 text-xs">
                      7d
                    </ToggleGroupItem>
                    <ToggleGroupItem value="month" className="h-7 px-2.5 text-xs">
                      30d
                    </ToggleGroupItem>
                  </ToggleGroup>
                </CardHeader>
                <CardContent className="min-w-0 pt-2">
                  {(data?.bidSeriesCandidates.length ?? 0) === 0 ? (
                    <ChartContainer
                      config={{ count: { label: "Applications", color: "var(--chart-1)" } }}
                      className="aspect-auto h-[210px] w-full"
                    >
                      <LineChart
                        data={data?.bidsByDate ?? []}
                        margin={{ left: 0, right: 4, top: 8, bottom: 0 }}
                      >
                        <CartesianGrid vertical={false} strokeDasharray="3 3" />
                        <XAxis
                          dataKey="date"
                          tickLine={false}
                          axisLine={false}
                          tickMargin={8}
                          interval={bidRange === "month" ? 4 : 0}
                          minTickGap={bidRange === "month" ? 8 : 16}
                          tickFormatter={(value) => formatChartDate(String(value), timezone)}
                          className="text-[10px]"
                        />
                        <YAxis
                          allowDecimals={false}
                          tickLine={false}
                          axisLine={false}
                          width={28}
                          className="text-[10px]"
                        />
                        <ChartTooltip
                          content={
                            <ChartTooltipContent
                              labelFormatter={(value) => formatLongDate(String(value), timezone)}
                            />
                          }
                        />
                        <Line
                          type="monotone"
                          dataKey="count"
                          stroke="var(--color-count)"
                          strokeWidth={2}
                          dot={false}
                          activeDot={{ r: 3 }}
                        />
                      </LineChart>
                    </ChartContainer>
                  ) : (
                    <ChartContainer config={bidLineConfig} className="aspect-auto h-[210px] w-full">
                      <LineChart
                        data={lineChartData}
                        margin={{ left: 0, right: 4, top: 8, bottom: 0 }}
                      >
                        <CartesianGrid vertical={false} strokeDasharray="3 3" />
                        <XAxis
                          dataKey="date"
                          tickLine={false}
                          axisLine={false}
                          tickMargin={8}
                          interval={bidRange === "month" ? 4 : 0}
                          minTickGap={bidRange === "month" ? 8 : 16}
                          tickFormatter={(value) => formatChartDate(String(value), timezone)}
                          className="text-[10px]"
                        />
                        <YAxis
                          allowDecimals={false}
                          tickLine={false}
                          axisLine={false}
                          width={28}
                          className="text-[10px]"
                        />
                        <ChartTooltip
                          content={
                            <ChartTooltipContent
                              labelFormatter={(value) => formatLongDate(String(value), timezone)}
                            />
                          }
                        />
                        {(data?.bidSeriesCandidates.length ?? 0) > 1 ? (
                          <ChartLegend content={<ChartLegendContent className="pt-2 text-xs" />} />
                        ) : null}
                        {(data?.bidSeriesCandidates ?? []).map((candidate, index) => (
                          <Line
                            key={candidate.key}
                            type="monotone"
                            dataKey={safeCssKey(candidate.key)}
                            name={candidate.label}
                            stroke={CANDIDATE_COLORS[index % CANDIDATE_COLORS.length]}
                            strokeWidth={2}
                            dot={false}
                            activeDot={{ r: 3 }}
                          />
                        ))}
                      </LineChart>
                    </ChartContainer>
                  )}
                </CardContent>
              </Card>

              <Card className="min-w-0 border-border/70 shadow-none">
                <CardHeader className="flex flex-row flex-wrap items-end justify-between gap-3 space-y-0 pb-2">
                  <div className="min-w-0">
                    <CardTitle className="text-base font-medium">Pipeline</CardTitle>
                    <CardDescription className="text-xs">
                      Stage entries
                      {stageTotal > 0 ? ` · ${stageTotal}` : ""}
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      type="date"
                      value={stageFrom}
                      max={stageTo}
                      onChange={(e) => setStageFrom(e.target.value)}
                      className="h-8 w-[128px] text-xs"
                      aria-label="Pipeline from date"
                    />
                    <Input
                      type="date"
                      value={stageTo}
                      min={stageFrom}
                      max={today}
                      onChange={(e) => setStageTo(e.target.value)}
                      className="h-8 w-[128px] text-xs"
                      aria-label="Pipeline to date"
                    />
                  </div>
                </CardHeader>
                <CardContent className="min-w-0 pt-2">
                  {(data?.stageCounts.length ?? 0) === 0 || stageTotal === 0 ? (
                    <p className="py-12 text-center text-sm text-muted-foreground">
                      No stage activity in this range.
                    </p>
                  ) : (
                    <div className="grid min-w-0 items-center gap-4 sm:grid-cols-[140px_minmax(0,1fr)]">
                      <ChartContainer
                        config={stageChartConfig}
                        className="mx-auto aspect-square h-[140px] w-full max-w-[140px]"
                      >
                        <PieChart>
                          <ChartTooltip content={<ChartTooltipContent nameKey="stageName" />} />
                          <Pie
                            data={data?.stageCounts ?? []}
                            dataKey="count"
                            nameKey="stageName"
                            innerRadius={40}
                            outerRadius={64}
                            paddingAngle={2}
                            strokeWidth={0}
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
                      <ul className="grid max-h-[200px] gap-1 overflow-y-auto">
                        {(data?.stageCounts ?? []).map((stage, index) => (
                          <li
                            key={stage.stageId}
                            className="flex items-center justify-between gap-2 rounded-md px-1.5 py-1 text-xs"
                          >
                            <span className="flex min-w-0 items-center gap-2">
                              <span
                                className="h-2 w-2 shrink-0 rounded-full"
                                style={{
                                  backgroundColor: STAGE_COLORS[index % STAGE_COLORS.length],
                                }}
                              />
                              <span className="truncate">{stage.stageName}</span>
                            </span>
                            <span className="shrink-0 tabular-nums text-muted-foreground">
                              {stage.count}
                              <span className="ml-1">
                                ({stageTotal ? Math.round((stage.count / stageTotal) * 100) : 0}%)
                              </span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </div>
    </JobsLayout>
  );
}
