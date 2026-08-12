"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import JobsLayout from "@/app/jobs-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { colorForCandidateKey } from "@/lib/dashboard/candidate-colors";
import { DEFAULT_TIMEZONE, formatYmdInTimeZone, todayInTimeZone } from "@/lib/timezone";
import { toast } from "sonner";

type CandidateCount = { key: string; label: string; count: number; color?: string };
type CandidateOption = { key: string; label: string; color?: string };
type StageCount = { stageId: string; stageName: string; count: number };
type HourlyActivityPoint = { hour: number; count: number };
type RangeMode = "week" | "month" | "custom";

type DashboardData = {
  timezone: string;
  today: string;
  rangeMode: RangeMode;
  appliedDate: string;
  appliedCount: number;
  appliedCountByCandidate: CandidateCount[];
  appliedInBidRange: number;
  bidsStackedByDate: Array<Record<string, string | number>>;
  bidSeriesCandidates: CandidateCount[];
  bidFrom: string;
  bidTo: string;
  activityDate: string;
  hourlyActivity: HourlyActivityPoint[];
  stageCounts: StageCount[];
  pipelineByStage: Array<Record<string, string | number>>;
  pipelineSeriesCandidates: CandidateCount[];
  totalApplications: number;
  totalApplicationsAll: number;
  applicationsByCandidate: CandidateCount[];
  candidates: CandidateOption[];
};

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

function hourLabel(hour: number): string {
  const suffix = hour < 12 ? "a" : "p";
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}${suffix}`;
}

export function DashboardPageClient() {
  const [timezone, setTimezone] = useState(DEFAULT_TIMEZONE);
  const today = todayInTimeZone(timezone);
  const [rangeMode, setRangeMode] = useState<RangeMode>("month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [activityDate, setActivityDate] = useState("");
  const [appliedDate, setAppliedDate] = useState("");
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  const selectionInitializedRef = useRef(false);
  const [data, setData] = useState<DashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadDashboard = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({ rangeMode });
      if (rangeMode === "custom") {
        if (customFrom) params.set("bidFrom", customFrom);
        if (customTo) params.set("bidTo", customTo);
      }
      if (activityDate) params.set("activityDate", activityDate);
      if (appliedDate) params.set("date", appliedDate);

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
      setActivityDate((current) => current || next.activityDate);
      setAppliedDate((current) => current || next.appliedDate);
      if (!customFrom) setCustomFrom(next.bidFrom);
      if (!customTo) setCustomTo(next.bidTo);
      if (!selectionInitializedRef.current) {
        const defaults = new Set(
          (next.bidSeriesCandidates.length
            ? next.bidSeriesCandidates
            : next.applicationsByCandidate
          ).map((c) => c.key),
        );
        setSelectedKeys(defaults);
        selectionInitializedRef.current = true;
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load dashboard.");
    } finally {
      setIsLoading(false);
    }
  }, [
    activityDate,
    appliedDate,
    rangeMode,
    rangeMode === "custom" ? customFrom : "",
    rangeMode === "custom" ? customTo : "",
  ]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const candidateOptions = useMemo(() => {
    if (!data) return [];
    const map = new Map<string, CandidateOption>();
    for (const c of data.candidates) map.set(c.key, c);
    for (const c of data.applicationsByCandidate) {
      if (!map.has(c.key)) map.set(c.key, c);
    }
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [data]);

  const visibleBidCandidates = useMemo(() => {
    const all = data?.bidSeriesCandidates ?? [];
    if (selectedKeys.size === 0) return all;
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
    if (selectedKeys.size === 0) return rows;
    return rows.filter((row) => selectedKeys.has(row.key));
  }, [data?.appliedCountByCandidate, selectedKeys]);

  const selectedDayTotal = useMemo(
    () => dayBreakdown.reduce((sum, row) => sum + row.count, 0),
    [dayBreakdown],
  );

  const visiblePipelineCandidates = useMemo(() => {
    const all = data?.pipelineSeriesCandidates ?? [];
    if (selectedKeys.size === 0) return all;
    return all.filter((c) => selectedKeys.has(c.key));
  }, [data?.pipelineSeriesCandidates, selectedKeys]);

  const pipelineChartConfig = useMemo(() => {
    const config: ChartConfig = {};
    for (const candidate of visiblePipelineCandidates) {
      config[safeCssKey(candidate.key)] = {
        label: candidate.label,
        color: candidateColor(candidate),
      };
    }
    return config;
  }, [visiblePipelineCandidates]);

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

  const hourlyMax = useMemo(
    () => Math.max(1, ...(data?.hourlyActivity ?? []).map((h) => h.count)),
    [data?.hourlyActivity],
  );

  const hourlyTotal = useMemo(
    () => (data?.hourlyActivity ?? []).reduce((sum, h) => sum + h.count, 0),
    [data?.hourlyActivity],
  );

  const resumeBars = useMemo(() => {
    const rows =
      selectedKeys.size > 0
        ? (data?.applicationsByCandidate ?? []).filter((r) => selectedKeys.has(r.key))
        : (data?.applicationsByCandidate ?? []);
    const max = Math.max(1, ...rows.map((r) => r.count));
    return rows.map((row) => ({
      ...row,
      pct: Math.round((row.count / max) * 100),
      share: data?.totalApplicationsAll
        ? Math.round((row.count / data.totalApplicationsAll) * 100)
        : 0,
    }));
  }, [data?.applicationsByCandidate, data?.totalApplicationsAll, selectedKeys]);

  const toggleCandidate = (key: string, checked: boolean) => {
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const selectAllCandidates = () => {
    setSelectedKeys(new Set(candidateOptions.map((c) => c.key)));
  };

  const clearCandidates = () => setSelectedKeys(new Set());

  return (
    <JobsLayout>
      <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
            <p className="text-xs text-muted-foreground">
              Application activity for your account
            </p>
          </div>
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

        {isLoading && !data ? (
          <div className="flex min-h-[240px] items-center justify-center rounded-xl border">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <Card className="border-border/70 shadow-none">
              <CardHeader className="gap-3 space-y-0 pb-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardDescription className="text-xs">Applications</CardDescription>
                    <CardTitle className="mt-1 text-3xl font-semibold tabular-nums tracking-tight">
                      {selectedDayTotal}
                    </CardTitle>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {appliedDate ? formatLongDate(appliedDate, timezone) : "—"}
                      {" · "}
                      {selectedRangeTotal} in range
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      type="date"
                      value={appliedDate || today}
                      max={today}
                      onChange={(e) => setAppliedDate(e.target.value || today)}
                      className="h-8 w-[138px] text-xs"
                      aria-label="Focus day"
                    />
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
                      <ToggleGroupItem value="week" className="h-8 px-2.5 text-xs">
                        Week
                      </ToggleGroupItem>
                      <ToggleGroupItem value="month" className="h-8 px-2.5 text-xs">
                        Month
                      </ToggleGroupItem>
                      <ToggleGroupItem value="custom" className="h-8 px-2.5 text-xs">
                        Custom
                      </ToggleGroupItem>
                    </ToggleGroup>
                    {rangeMode === "custom" ? (
                      <>
                        <Input
                          type="date"
                          value={customFrom}
                          max={customTo || today}
                          onChange={(e) => setCustomFrom(e.target.value)}
                          className="h-8 w-[138px] text-xs"
                          aria-label="Custom from"
                        />
                        <Input
                          type="date"
                          value={customTo}
                          min={customFrom}
                          max={today}
                          onChange={(e) => setCustomTo(e.target.value)}
                          className="h-8 w-[138px] text-xs"
                          aria-label="Custom to"
                        />
                      </>
                    ) : null}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] text-muted-foreground">Profiles</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-[11px]"
                    onClick={selectAllCandidates}
                  >
                    All
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-[11px]"
                    onClick={clearCandidates}
                  >
                    None
                  </Button>
                  <div className="flex flex-wrap gap-1.5">
                    {candidateOptions.map((candidate) => {
                      const checked = selectedKeys.has(candidate.key);
                      const color = candidateColor(candidate);
                      return (
                        <label
                          key={candidate.key}
                          className={cn(
                            "inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-[11px]",
                            checked ? "border-primary/40 bg-primary/5" : "border-border/70",
                          )}
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(value) =>
                              toggleCandidate(candidate.key, value === true)
                            }
                            className="size-3.5"
                          />
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: color }}
                            aria-hidden
                          />
                          <span className="max-w-[120px] truncate">{candidate.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 pt-0">
                {dayBreakdown.length > 0 ? (
                  <ul className="flex flex-wrap gap-1.5">
                    {dayBreakdown.map((item) => (
                      <li
                        key={item.key}
                        className="rounded-md bg-muted/50 px-2 py-1 text-[11px] tabular-nums"
                      >
                        <span className="text-muted-foreground">{item.label}</span>
                        <span className="ml-1.5 font-medium">{item.count}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}

                <ChartContainer config={bidChartConfig} className="aspect-auto h-[230px] w-full">
                  <LineChart data={bidChartData} margin={{ left: 0, right: 4, top: 8, bottom: 0 }}>
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
                    {visibleBidCandidates.length > 1 ? (
                      <ChartLegend content={<ChartLegendContent className="pt-1 text-[11px]" />} />
                    ) : null}
                    {visibleBidCandidates.map((candidate) => (
                      <Line
                        key={candidate.key}
                        type="monotone"
                        dataKey={safeCssKey(candidate.key)}
                        name={candidate.label}
                        stroke={candidateColor(candidate)}
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 3 }}
                      />
                    ))}
                  </LineChart>
                </ChartContainer>
                <p className="text-[11px] text-muted-foreground">
                  {data
                    ? `${formatChartDate(data.bidFrom, timezone)} – ${formatChartDate(data.bidTo, timezone)}`
                    : null}
                </p>
              </CardContent>
            </Card>

            <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
              <Card className="min-w-0 border-border/70 shadow-none">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base font-medium">Pipeline</CardTitle>
                  <CardDescription className="text-xs">
                    Profiles by stage
                    {stageTotal > 0 ? ` · ${stageTotal}` : ""}
                    {data
                      ? ` · ${formatChartDate(data.bidFrom, timezone)}–${formatChartDate(data.bidTo, timezone)}`
                      : ""}
                  </CardDescription>
                </CardHeader>
                <CardContent className="min-w-0 space-y-3 pt-1">
                  {stageTotal === 0 ? (
                    <p className="py-10 text-center text-sm text-muted-foreground">
                      No pipeline activity in this range for selected profiles.
                    </p>
                  ) : (
                    <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_200px] lg:items-start">
                      <ChartContainer
                        config={pipelineChartConfig}
                        className="aspect-auto h-[220px] w-full"
                      >
                        <LineChart
                          data={pipelineChartData}
                          margin={{ left: 0, right: 4, top: 8, bottom: 0 }}
                        >
                          <CartesianGrid vertical={false} strokeDasharray="3 3" />
                          <XAxis
                            dataKey="stageName"
                            tickLine={false}
                            axisLine={false}
                            tickMargin={8}
                            interval={0}
                            className="text-[10px]"
                          />
                          <YAxis
                            allowDecimals={false}
                            tickLine={false}
                            axisLine={false}
                            width={28}
                            className="text-[10px]"
                          />
                          <ChartTooltip content={<ChartTooltipContent />} />
                          {visiblePipelineCandidates.length > 1 ? (
                            <ChartLegend
                              content={<ChartLegendContent className="pt-1 text-[11px]" />}
                            />
                          ) : null}
                          {visiblePipelineCandidates.map((candidate) => (
                            <Line
                              key={candidate.key}
                              type="monotone"
                              dataKey={safeCssKey(candidate.key)}
                              name={candidate.label}
                              stroke={candidateColor(candidate)}
                              strokeWidth={2}
                              dot={{ r: 3 }}
                              activeDot={{ r: 4 }}
                            />
                          ))}
                        </LineChart>
                      </ChartContainer>
                      <ul className="grid max-h-[220px] gap-1 overflow-y-auto">
                        {filteredStageCounts.map((stage, index) => (
                          <li
                            key={stage.stageId}
                            className="flex items-center justify-between gap-2 rounded-md px-1.5 py-1 text-xs"
                          >
                            <span className="flex min-w-0 items-center gap-2">
                              <span
                                className="h-2 w-2 shrink-0 rounded-full bg-primary/70"
                                style={{
                                  opacity: 1 - index * 0.08,
                                }}
                              />
                              <span className="truncate">{stage.stageName}</span>
                            </span>
                            <span className="shrink-0 tabular-nums text-muted-foreground">
                              {stage.count}
                              <span className="ml-1">
                                ({stageTotal ? Math.round((stage.count / stageTotal) * 100) : 0}
                                %)
                              </span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </CardContent>
              </Card>

              <div className="grid min-w-0 gap-4">
                <Card className="border-border/70 shadow-none">
                  <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 pb-2">
                    <div>
                      <CardTitle className="text-base font-medium">Hourly activity</CardTitle>
                      <CardDescription className="text-xs">
                        Applied counts by hour · {hourlyTotal} total
                      </CardDescription>
                    </div>
                    <Input
                      type="date"
                      value={activityDate || today}
                      max={today}
                      onChange={(e) => setActivityDate(e.target.value || today)}
                      className="h-8 w-[138px] text-xs"
                      aria-label="Activity day"
                    />
                  </CardHeader>
                  <CardContent className="pt-1">
                    <div
                      className="grid gap-1"
                      style={{ gridTemplateColumns: "repeat(24, minmax(0, 1fr))" }}
                    >
                      {(data?.hourlyActivity ?? []).map((slot) => {
                        const intensity = slot.count / hourlyMax;
                        return (
                          <div
                            key={slot.hour}
                            title={`${hourLabel(slot.hour)}: ${slot.count}`}
                            className="group relative"
                          >
                            <div
                              className="aspect-square rounded-[3px] border border-border/40"
                              style={{
                                backgroundColor:
                                  slot.count === 0
                                    ? "hsl(var(--muted) / 0.35)"
                                    : `color-mix(in srgb, var(--primary) ${Math.round(28 + intensity * 72)}%, transparent)`,
                              }}
                            />
                            <span className="mt-0.5 block text-center text-[9px] text-muted-foreground opacity-70">
                              {slot.hour % 3 === 0 ? hourLabel(slot.hour) : ""}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      {activityDate ? formatLongDate(activityDate, timezone) : "—"}
                      {" · darker = more applications"}
                    </p>
                  </CardContent>
                </Card>

                <Card className="border-border/70 shadow-none">
                  <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 pb-2">
                    <div>
                      <CardDescription className="text-xs">Resume DB</CardDescription>
                      <CardTitle className="mt-1 text-2xl font-semibold tabular-nums">
                        {selectedKeys.size > 0
                          ? resumeBars.reduce((sum, row) => sum + row.count, 0)
                          : (data?.totalApplications ?? 0)}
                      </CardTitle>
                    </div>
                    <Button asChild variant="ghost" size="sm" className="h-8 px-2 text-xs">
                      <Link href="/resume-db">Open</Link>
                    </Button>
                  </CardHeader>
                  <CardContent className="space-y-2 pt-0">
                    {resumeBars.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No registered applications.</p>
                    ) : (
                      resumeBars.map((row) => (
                        <div key={row.key} className="space-y-1">
                          <div className="flex items-center justify-between gap-2 text-[11px]">
                            <span className="flex min-w-0 items-center gap-1.5">
                              <span
                                className="h-2 w-2 rounded-full"
                                style={{ backgroundColor: candidateColor(row) }}
                              />
                              <span className="truncate">{row.label}</span>
                            </span>
                            <span className="tabular-nums text-muted-foreground">
                              {row.count} · {row.share}%
                            </span>
                          </div>
                          <div className="h-1 overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${row.pct}%`,
                                backgroundColor: candidateColor(row),
                              }}
                            />
                          </div>
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          </>
        )}
      </div>
    </JobsLayout>
  );
}
