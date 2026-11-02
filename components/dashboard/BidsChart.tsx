"use client";

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

export type BidsChartSeries = { dataKey: string; name: string; fill: string };

/**
 * The dashboard's stacked bids-per-day bar chart. Kept in its own module so the dashboard
 * loads it (and recharts) after the rest of the page.
 */
export default function BidsChart({
  config,
  data,
  series,
  clickable,
  tickLabel,
  tooltipLabel,
  onBarClick,
}: {
  config: ChartConfig;
  data: Array<Record<string, string | number>>;
  series: BidsChartSeries[];
  clickable: boolean;
  tickLabel: (date: string) => string;
  tooltipLabel: (date: string) => string;
  onBarClick: (label: unknown) => void;
}) {
  return (
    <ChartContainer config={config} className="aspect-auto h-[240px] w-full">
      <BarChart
        data={data}
        margin={{ left: 0, right: 8, top: 8, bottom: 0 }}
        barCategoryGap={data.length > 20 ? 2 : "20%"}
        onClick={(state) => onBarClick(state?.activeLabel)}
        className={clickable ? "cursor-pointer" : undefined}
      >
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={16}
          tickFormatter={(value) => tickLabel(String(value))}
          className="text-[10px]"
        />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={30} className="text-[10px]" />
        <ChartTooltip
          cursor={{ fill: "var(--muted)", opacity: 0.5 }}
          content={<ChartTooltipContent labelFormatter={(value) => tooltipLabel(String(value))} />}
        />
        {series.length > 1 ? <ChartLegend content={<ChartLegendContent className="pt-2 text-[11px]" />} /> : null}
        {series.map((s, index) => (
          <Bar
            key={s.dataKey}
            dataKey={s.dataKey}
            name={s.name}
            stackId="bids"
            fill={s.fill}
            maxBarSize={40}
            radius={index === series.length - 1 ? [3, 3, 0, 0] : 0}
          />
        ))}
      </BarChart>
    </ChartContainer>
  );
}
