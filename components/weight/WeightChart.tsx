"use client";

import * as React from "react";
import { LineChart, lineClasses } from "@mui/x-charts/LineChart";
import { ChartsReferenceLine } from "@mui/x-charts/ChartsReferenceLine";
import { useTheme, alpha } from "@mui/material/styles";
import Box from "@mui/material/Box";
import FormControlLabel from "@mui/material/FormControlLabel";
import Switch from "@mui/material/Switch";

// Hydration-safe "are we on the client yet?" — false on the server and during
// hydration, true immediately after. No setState-in-effect (keeps the lint rule
// happy), and it lets us skip SSR of the chart entirely.
const noopSubscribe = () => () => {};
function useMounted() {
  return React.useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

export type WeightChartProps = {
  dates: string[]; // YYYY-MM-DD weekly ticks
  actual: (number | null)[];
  target: (number | null)[];
  trend: (number | null)[];
  movingAvg: (number | null)[];
  bandLow?: (number | null)[]; // per-week maintain band lower edge
  bandHigh?: (number | null)[]; // per-week maintain band upper edge
  ghost?: (number | null)[]; // last year's actuals, aligned by week-of-year (faded)
  /** The active profile's color — the measured line's identity hue. */
  color: string;
  hasGoal: boolean;
  goalWeight?: number | null; // horizontal "Goal" reference line
  goalDate?: string | null; // YYYY-MM-DD vertical "Due" reference line
};

// The measured line wears the profile color; target (the plan) and trend (the
// projection) are neutral reference lines told apart by dash pattern + legend,
// not by competing hues — so the chart stays colorblind-safe by construction.
// The 4-week average is an optional overlay (off by default) to cut the noise.
export default function WeightChart({
  dates,
  actual,
  target,
  trend,
  movingAvg,
  bandLow,
  bandHigh,
  ghost,
  color,
  hasGoal,
  goalWeight,
  goalDate,
}: WeightChartProps) {
  const theme = useTheme();
  const mounted = useMounted();
  const [showAvg, setShowAvg] = React.useState(false);

  const x = React.useMemo(
    () => dates.map((d) => new Date(`${d}T12:00:00`)),
    [dates],
  );

  // Tight, non-zero y-domain padded a few lbs past the data (never starts at 0).
  const { yMin, yMax } = React.useMemo(() => {
    const vals = [
      ...actual,
      ...target,
      ...trend,
      ...(bandLow ?? []),
      ...(bandHigh ?? []),
      ...(ghost ?? []),
      goalWeight,
    ].filter((v): v is number => v != null);
    if (!vals.length) return { yMin: undefined, yMax: undefined };
    return {
      yMin: Math.floor((Math.min(...vals) - 4) / 5) * 5,
      yMax: Math.ceil((Math.max(...vals) + 4) / 5) * 5,
    };
  }, [actual, target, trend, bandLow, bandHigh, ghost, goalWeight]);

  const goalX = goalDate ? new Date(`${goalDate}T12:00:00`) : null;
  // Past ~80% of the axis, the "Due" label flips to the line's left so it isn't clipped.
  const goalLabelLeft =
    goalX != null &&
    x.length > 1 &&
    (goalX.getTime() - x[0].getTime()) / (x[x.length - 1].getTime() - x[0].getTime()) > 0.8;

  // theme.vars = CSS custom properties, so theme colors follow light/dark mode
  // (theme.palette only holds the light scheme's values under cssVariables).
  const referenceColor = theme.vars?.palette.text.secondary ?? theme.palette.text.secondary; // Target (the plan): neutral gray, dotted
  const trendColor = alpha(color, 0.5); // Trend: a lighter shade of the actual line, dashed
  const avgColor = theme.vars?.palette.secondary.main ?? theme.palette.secondary.main;

  const series = [
    ...(ghost && ghost.some((v) => v != null)
      ? [
          {
            id: "ghost",
            label: "last year",
            data: ghost,
            color: alpha(color, 0.3),
            showMark: false,
            curve: "linear" as const,
            connectNulls: false,
          },
        ]
      : []),
    {
      id: "actual",
      label: "Actual",
      data: actual,
      color,
      showMark: true,
      shape: "circle" as const, // MUI X cycles shapes per series; pin actual to circles
      curve: "linear" as const,
      connectNulls: false,
    },
    ...(hasGoal
      ? [
          {
            id: "target",
            label: "Target",
            data: target,
            color: referenceColor,
            showMark: false,
            curve: "linear" as const,
          },
        ]
      : []),
    {
      id: "trend",
      label: "Trend",
      data: trend,
      color: trendColor,
      showMark: false,
      curve: "linear" as const,
    },
    ...(bandLow && bandHigh && bandLow.some((v) => v != null)
      ? [
          {
            id: "bandLow",
            label: "range",
            data: bandLow,
            color: referenceColor,
            showMark: false,
            curve: "linear" as const,
            connectNulls: false,
          },
          {
            id: "bandHigh",
            label: "range",
            data: bandHigh,
            color: referenceColor,
            showMark: false,
            curve: "linear" as const,
            connectNulls: false,
          },
        ]
      : []),
    ...(showAvg
      ? [
          {
            id: "movingAvg",
            label: "4-wk avg",
            data: movingAvg,
            color: avgColor,
            showMark: false,
            curve: "monotoneX" as const,
            connectNulls: false,
          },
        ]
      : []),
  ];

  return (
    <Box>
      {mounted ? (
      <LineChart
        height={340}
        series={series}
        xAxis={[
          {
            data: x,
            scaleType: "time",
            valueFormatter: (value: Date, ctx: { location: string }) =>
              ctx.location === "tick"
                ? value.toLocaleDateString("en-US", { month: "short" })
                : value.toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  }),
          },
        ]}
        yAxis={[
          {
            min: yMin,
            max: yMax,
            valueFormatter: (v: number) => `${v}`,
            width: 44,
          },
        ]}
        margin={{ top: 8, right: 12, bottom: 4, left: 4 }}
        sx={{
          // Target = fine dots (the plan); Trend = long dashes (the projection).
          [`& .${lineClasses.line}[data-series="target"]`]: {
            strokeDasharray: "2 5",
            strokeWidth: 1.5,
          },
          [`& .${lineClasses.line}[data-series="trend"]`]: {
            strokeDasharray: "9 6",
            strokeWidth: 1.5,
          },
          [`& .${lineClasses.line}[data-series="actual"]`]: { strokeWidth: 2.5 },
          [`& .${lineClasses.line}[data-series="movingAvg"]`]: { strokeWidth: 2 },
          [`& .${lineClasses.line}[data-series="bandLow"], & .${lineClasses.line}[data-series="bandHigh"]`]: {
            strokeDasharray: "1 4",
            strokeWidth: 1,
            opacity: 0.6,
          },
          [`& .${lineClasses.line}[data-series="ghost"]`]: { strokeDasharray: "4 4", strokeWidth: 1.5 },
        }}
      >
        {/* Goal markers are solid hairlines, so they never read as one of the dashed series. */}
        {goalWeight != null ? (
          <ChartsReferenceLine
            y={goalWeight}
            label={`Goal ${goalWeight}`}
            labelAlign="start"
            lineStyle={{ stroke: referenceColor, strokeWidth: 1, opacity: 0.6 }}
            labelStyle={{ fill: referenceColor, fontSize: 11 }}
          />
        ) : null}
        {goalX != null ? (
          <ChartsReferenceLine
            x={goalX}
            label={`Due ${goalX.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`}
            labelAlign="start"
            spacing={goalLabelLeft ? { x: -5, y: 5 } : { x: 5, y: 5 }}
            lineStyle={{ stroke: referenceColor, strokeWidth: 1, opacity: 0.6 }}
            labelStyle={{
              fill: referenceColor,
              fontSize: 11,
              textAnchor: goalLabelLeft ? "end" : "start",
            }}
          />
        ) : null}
      </LineChart>
      ) : (
        <Box sx={{ height: 340 }} aria-hidden />
      )}
      <FormControlLabel
        sx={{ ml: 0.5, mt: -0.5 }}
        control={
          <Switch
            size="small"
            checked={showAvg}
            onChange={(e) => setShowAvg(e.target.checked)}
          />
        }
        label="4-week average"
        slotProps={{ typography: { variant: "body2", color: "text.secondary" } }}
      />
    </Box>
  );
}
