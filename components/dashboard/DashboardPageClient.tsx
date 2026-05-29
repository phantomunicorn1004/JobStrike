"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import JobsLayout from "@/app/jobs-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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
  count: { label: "Applications", color: "hsl(var(--chart-1))" },
} satisfies ChartConfig;

const STAGE_COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
  "#6366f1",
  "#14b8a6",
  "#f97316",
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
        stageFrom,
        stageTo,
      });
      const res = await fetch(`/api/dashboard?${params}`);
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
  }, [appliedDate, stageFrom, stageTo]);

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

  return (
    <JobsLayout>
      <div className="flex min-h-0 w-full flex-1 flex-col gap-4">
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

            <Card className="rounded-xl">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <CardTitle className="text-lg">Applications per day</CardTitle>
                    <CardDescription>
                      Bid / application count from Resume DB (
                      {data ? `${formatChartDate(data.bidFrom)} – ${formatChartDate(data.bidTo)}` : "last 30 days"})
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <ChartContainer config={bidChartConfig} className="aspect-[2/1] w-full min-h-[240px]">
                  <BarChart data={data?.bidsByDate ?? []} margin={{ left: 0, right: 8, top: 8 }}>
                    <CartesianGrid vertical={false} />
                    <XAxis
                      dataKey="date"
                      tickLine={false}
                      axisLine={false}
                      tickMargin={8}
                      minTickGap={24}
                      tickFormatter={formatChartDate}
                    />
                    <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={32} />
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

            <Card className="rounded-xl">
              <CardHeader className="gap-4 space-y-0 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <CardTitle className="text-lg">Pipeline by stage</CardTitle>
                  <CardDescription>
                    Cards counted by when they entered their current stage
                    {stageTotal > 0 ? ` (${stageTotal} total)` : ""}.
                  </CardDescription>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <label className="grid gap-1 text-xs text-muted-foreground">
                    From
                    <Input
                      type="date"
                      value={stageFrom}
                      max={stageTo}
                      onChange={(e) => setStageFrom(e.target.value)}
                      className="h-9 w-[140px]"
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
                      className="h-9 w-[140px]"
                    />
                  </label>
                </div>
              </CardHeader>
              <CardContent>
                {(data?.stageCounts.length ?? 0) === 0 || stageTotal === 0 ? (
                  <p className="py-12 text-center text-sm text-muted-foreground">
                    No pipeline cards entered a stage in this date range.
                  </p>
                ) : (
                  <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-center">
                    <ChartContainer
                      config={stageChartConfig}
                      className="mx-auto aspect-square w-full max-w-[320px]"
                    >
                      <PieChart>
                        <ChartTooltip content={<ChartTooltipContent nameKey="stageName" />} />
                        <Pie
                          data={data?.stageCounts ?? []}
                          dataKey="count"
                          nameKey="stageName"
                          innerRadius={56}
                          outerRadius={96}
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
                    <ul className="grid gap-2 text-sm">
                      {(data?.stageCounts ?? []).map((stage, index) => (
                        <li
                          key={stage.stageId}
                          className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
                        >
                          <span className="flex items-center gap-2 min-w-0">
                            <span
                              className="h-2.5 w-2.5 shrink-0 rounded-full"
                              style={{
                                backgroundColor: STAGE_COLORS[index % STAGE_COLORS.length],
                              }}
                            />
                            <span className="truncate">{stage.stageName}</span>
                          </span>
                          <span className="tabular-nums font-medium shrink-0">
                            {stage.count}
                            <span className="text-muted-foreground font-normal ml-1">
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
          </>
        )}
      </div>
    </JobsLayout>
  );
}
