"use client";

import * as React from "react";
import { LineChart, lineClasses } from "@mui/x-charts/LineChart";
import { ChartsReferenceLine } from "@mui/x-charts/ChartsReferenceLine";
import { useTheme } from "@mui/material/styles";
import Box from "@mui/material/Box";
import { formatMoney, formatMoneyCompact } from "@/lib/format";

// Hydration-safe "are we on the client yet?" — same idiom as WeightChart, so the
// chart never renders on the server (x-charts measures the DOM).
const noopSubscribe = () => () => {};
function useMounted() {
  return React.useSyncExternalStore(noopSubscribe, () => true, () => false);
}

// The pace picture: cumulative discretionary spend this month (solid, the active
// profile's hue) with last month ghosted behind it, aligned by day-of-month —
// Chase's "how am I doing vs last month" glance. The current line stops at today
// (nulls after), so you read the gap against last month at the same day.
export default function SpendTrendChart({
  days,
  thisMonth,
  lastMonth,
  thisLabel,
  lastLabel,
  budget,
}: {
  days: number[];
  thisMonth: (number | null)[];
  lastMonth: (number | null)[];
  thisLabel: string;
  lastLabel: string;
  /** The month's budget, drawn as a horizontal reference line when positive. */
  budget?: number | null;
}) {
  const theme = useTheme();
  const mounted = useMounted();
  // theme.vars = CSS custom properties, so both lines follow light/dark mode
  // (theme.palette only holds the light scheme's values under cssVariables).
  const color = theme.vars?.palette.primary.main ?? theme.palette.primary.main; // follows the active profile
  const ghost = theme.vars?.palette.text.secondary ?? theme.palette.text.secondary;

  const fmt = (v: number | null) => (v == null ? "" : formatMoney(v));
  const series = [
    {
      id: "lastMonth",
      label: lastLabel,
      data: lastMonth,
      color: ghost,
      showMark: false,
      curve: "linear" as const,
      connectNulls: true,
      valueFormatter: fmt,
    },
    {
      id: "thisMonth",
      label: thisLabel,
      data: thisMonth,
      color,
      showMark: false,
      area: true,
      curve: "linear" as const,
      connectNulls: false,
      valueFormatter: fmt,
    },
  ];

  // The auto y-axis only fits the data, so lift it when spending is still under budget.
  const showBudget = budget != null && budget > 0;
  const dataMax = Math.max(0, ...[...thisMonth, ...lastMonth].filter((v): v is number => v != null));
  const yMax = showBudget && budget > dataMax ? budget * 1.1 : undefined;

  if (!mounted) return <Box sx={{ height: 220 }} aria-hidden />;

  return (
    <LineChart
      height={220}
      series={series}
      xAxis={[
        {
          data: days,
          scaleType: "point",
          valueFormatter: (v: number, ctx: { location: string }) =>
            ctx.location === "tick" ? `${v}` : `Day ${v}`,
          tickInterval: days.filter((day) => day === 1 || day % 5 === 0),
        },
      ]}
      yAxis={[{ max: yMax, valueFormatter: (v: number) => formatMoneyCompact(v), width: 60 }]}
      margin={{ top: 10, right: 12, bottom: 4, left: 4 }}
      slotProps={{ tooltip: { trigger: "axis" } }}
      sx={{
        [`& .${lineClasses.line}[data-series="lastMonth"]`]: { strokeDasharray: "5 4", strokeWidth: 1.5 },
        [`& .${lineClasses.line}[data-series="thisMonth"]`]: { strokeWidth: 2.5 },
        [`& .${lineClasses.area}[data-series="thisMonth"]`]: { fillOpacity: 0.12 },
      }}
    >
      {showBudget ? (
        <ChartsReferenceLine
          y={budget}
          label={`Budget ${formatMoneyCompact(budget)}`}
          labelAlign="start"
          lineStyle={{ stroke: ghost, strokeWidth: 1, opacity: 0.7 }}
          labelStyle={{ fill: ghost, fontSize: 11 }}
        />
      ) : null}
    </LineChart>
  );
}
