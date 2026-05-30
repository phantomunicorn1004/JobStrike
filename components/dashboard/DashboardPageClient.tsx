"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import JobsLayout from "@/app/jobs-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  ChartContainer,
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
import { CalendarDays, Loader2, RefreshCw, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { localYmd } from "@/lib/dashboard/stats";
import { toast } from "sonner";

type BidPoint = { date: string; count: number };
type StageCount = { stageId: string; stageName: string; count: number };
type BidRange = "week" | "month";

const BID_RANGE_DAYS: Record<BidRange, number> = {
  week: 7,
  month: 30,
};

type DashboardData = {
  appliedDate: string;
  appliedCount: number;
  bidsByDate: BidPoint[];
  bidFrom: string;
  bidTo: string;
  stageCounts: StageCount[];
  stageFrom: string;
  stageTo: string;
  totalApplications: number;
  totalPipelineCards: number;
};

const bidChartConfig = {
  count: { label: "Applications", color: "var(--chart-1)" },
} satisfies ChartConfig;

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

function formatChartDate(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00`);
  if (Number.isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatLongDate(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00`);
  if (Number.isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export function DashboardPageClient() {
  const today = localYmd();
  const [appliedDate, setAppliedDate] = useState(today);
  const [bidRange, setBidRange] = useState<BidRange>("month");
  const [stageFrom, setStageFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 29);
    return localYmd(d);
  });
  const [stageTo, setStageTo] = useState(today);
  const [data, setData] = useState<DashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadDashboard = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({
        date: appliedDate,
        bidDays: String(BID_RANGE_DAYS[bidRange]),
        stageFrom,
        stageTo,
      });
      const res = await fetch(`/api/dashboard?${params}`, {
        credentials: "same-origin",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to load dashboard.");
      }
      setData(await res.json());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load dashboard.");
    } finally {
      setIsLoading(false);
    }
  }, [appliedDate, bidRange, stageFrom, stageTo]);

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

  const stageTotal = useMemo(
    () => (data?.stageCounts ?? []).reduce((sum, s) => sum + s.count, 0),
    [data?.stageCounts],
  );

  const bidRangeLabel = bidRange === "week" ? "Last 7 days" : "Last 30 days";

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
                  </CardDescription>
                  <CardTitle className="text-4xl tabular-nums">
                    {data?.appliedCount ?? 0}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    {formatLongDate(appliedDate)}
                  </p>
                  <label className="grid gap-1.5 text-sm">
                    <span className="text-xs font-medium text-muted-foreground">
                      View count for date
                    </span>
                    <Input
                      type="date"
                      value={appliedDate}
                      max={today}
                      onChange={(e) => setAppliedDate(e.target.value || today)}
                      className="h-9"
                    />
                  </label>
                </CardContent>
              </Card>

              <Card className="rounded-xl md:col-span-1">
                <CardHeader className="pb-2">
                  <CardDescription>Resume DB total</CardDescription>
                  <CardTitle className="text-3xl tabular-nums">
                    {data?.totalApplications ?? 0}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    All registered applications in Resume DB.
                  </p>
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
                </CardContent>
              </Card>
            </div>

            <div className="grid min-w-0 gap-4 xl:grid-cols-2 xl:items-start">
              <Card className="min-w-0 rounded-xl">
                <CardHeader className="gap-3 space-y-0 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex items-start gap-2 min-w-0">
                    <TrendingUp className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <CardTitle className="text-lg">Applications per day</CardTitle>
                      <CardDescription className="truncate">
                        {data
                          ? `${bidRangeLabel} (${formatChartDate(data.bidFrom)} – ${formatChartDate(data.bidTo)})`
                          : bidRangeLabel}
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
                  <ChartContainer
                    config={bidChartConfig}
                    className="aspect-auto h-[200px] w-full min-h-0 min-w-0 sm:h-[220px]"
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
                        tickFormatter={formatChartDate}
                      />
                      <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={28} />
                      <ChartTooltip
                        content={
                          <ChartTooltipContent
                            labelFormatter={(value) => formatLongDate(String(value))}
                          />
                        }
                      />
                      <Bar dataKey="count" fill="var(--color-count)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ChartContainer>
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
                <CardContent className="min-w-0">
                  {(data?.stageCounts.length ?? 0) === 0 || stageTotal === 0 ? (
                    <p className="py-10 text-center text-sm text-muted-foreground">
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
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </div>
    </JobsLayout>
  );
}
