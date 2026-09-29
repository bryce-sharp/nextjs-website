"use client";

import * as React from "react";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import LinearProgress from "@mui/material/LinearProgress";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Chip from "@mui/material/Chip";
import { formatDate } from "@/lib/format";
import type { Milestones, Projection, WindowKey, WeightStats } from "@/lib/queries/weight";
import WeightChart from "./WeightChart";

const WINDOWS: { key: WindowKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "6mo", label: "6 mo" },
  { key: "3mo", label: "3 mo" },
  { key: "6wk", label: "6 wk" },
];
const WINDOW_LABEL: Record<WindowKey, string> = {
  all: "overall",
  "6mo": "6-mo",
  "3mo": "3-mo",
  "6wk": "6-wk",
};

const signed = (n: number, unit = "") => `${n > 0 ? "+" : ""}${n}${unit}`;
const round1 = (n: number) => Math.round(n * 10) / 10;

// Slope (lb/week) of a trend line, from its first to last drawn point.
function driftPerWeek(trend: (number | null)[]): number | null {
  let firstI = -1;
  let lastI = -1;
  for (let i = 0; i < trend.length; i++) {
    if (trend[i] != null) {
      if (firstI < 0) firstI = i;
      lastI = i;
    }
  }
  if (firstI < 0 || lastI <= firstI) return null;
  return (trend[lastI]! - trend[firstI]!) / (lastI - firstI);
}

function Tile({
  label,
  value,
  sub,
  color,
  children,
}: {
  label: string;
  value?: string;
  sub?: string;
  color?: string;
  children?: React.ReactNode;
}) {
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ textTransform: "uppercase", letterSpacing: "0.04em" }}
      >
        {label}
      </Typography>
      {value != null ? (
        <Typography variant="h5" component="div" sx={{ mt: 0.5, color }}>
          {value}
        </Typography>
      ) : null}
      {sub ? (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
          {sub}
        </Typography>
      ) : null}
      {children}
    </Paper>
  );
}

// Diverging meter (pace buffer, lose): green ahead / amber behind, centre = on pace.
function PaceGauge({ buffer }: { buffer: number }) {
  const MAX = 10;
  const clamped = Math.max(-MAX, Math.min(MAX, buffer));
  const pct = (clamped / MAX) * 50;
  const ahead = buffer >= 0;
  return (
    <Box sx={{ mt: 1.5 }}>
      <Box sx={{ position: "relative", height: 10, borderRadius: 5, bgcolor: "action.hover" }}>
        <Box
          sx={{
            position: "absolute",
            left: "50%",
            top: -3,
            bottom: -3,
            width: "2px",
            bgcolor: "divider",
            transform: "translateX(-50%)",
          }}
        />
        <Box
          sx={{
            position: "absolute",
            top: 0,
            bottom: 0,
            borderRadius: 5,
            bgcolor: ahead ? "success.main" : "warning.main",
            left: ahead ? "50%" : `${50 + pct}%`,
            width: `${Math.abs(pct)}%`,
          }}
        />
      </Box>
    </Box>
  );
}

// Owns the timeframe window so the trend line + the projection/drift box stay in
// lockstep. Renders a lose OR a maintain layout depending on the plan mode.
export default function WeightBody({
  stats,
  hasGoal,
  planPace,
  color,
  dates,
  actual,
  target,
  movingAvg,
  bandLow,
  bandHigh,
  ghost,
  holdWeight,
  holdRange,
  goalWeight,
  goalDate,
  trends,
  projections,
  milestones,
}: {
  stats: WeightStats;
  hasGoal: boolean;
  planPace: number | null;
  color: string;
  dates: string[];
  actual: (number | null)[];
  target: (number | null)[];
  movingAvg: (number | null)[];
  bandLow: (number | null)[];
  bandHigh: (number | null)[];
  ghost: (number | null)[];
  holdWeight?: number | null;
  holdRange?: number | null;
  goalWeight?: number | null; // LOSE only; maintain already draws its hold band
  goalDate?: string | null;
  trends: Record<WindowKey, (number | null)[]>;
  projections: Record<WindowKey, Projection>;
  milestones: Milestones;
}) {
  const [win, setWin] = React.useState<WindowKey>("all");
  const maintain = stats.mode === "maintain";
  const proj = projections[win];

  // Projected-goal tile (lose), driven by the selected window.
  let projValue = "—";
  let projSub: string | undefined;
  let projColor: string | undefined;
  if (hasGoal && !maintain) {
    if (!proj.enoughData) {
      projSub = "not enough data this window";
    } else if (proj.onTrack && proj.date) {
      projValue = formatDate(proj.date);
      const ahead = proj.vsPlanDays != null && proj.vsPlanDays >= 0;
      projColor = ahead ? "success.main" : "warning.main";
      const vs =
        proj.vsPlanDays != null
          ? ` · ${Math.round(Math.abs(proj.vsPlanDays) / 7)} wk ${ahead ? "ahead" : "behind"}`
          : "";
      projSub = `${WINDOW_LABEL[win]} pace ${proj.paceLbPerWeek}/wk${vs}`;
    } else {
      projValue = "Off pace";
      projColor = "warning.main";
      projSub = "trend not heading to goal";
    }
  }

  // Drift box (maintain): is the selected window trending up/down or holding?
  const drift = maintain ? driftPerWeek(trends[win]) : null;
  const holding = drift != null && Math.abs(drift) < 0.1;

  // The 1–2 most notable badges, tucked under the chart (replaces the old full
  // Milestones section). Priority-ordered; we take the top two that apply.
  type Badge = { label: string; color: "success" | "warning" | "info" | "primary" };
  const m = milestones;
  const badges: Badge[] = [];
  if (maintain) {
    badges.push(
      m.inRangeNow
        ? { label: "In range ✓", color: "success" }
        : { label: "Out of range", color: "warning" },
    );
    if (m.weeksInRange >= 2) badges.push({ label: `${m.weeksInRange} wk in range`, color: "success" });
    if (m.loggingStreak >= 3) badges.push({ label: `📆 ${m.loggingStreak} wk logged`, color: "primary" });
  } else {
    if (m.currentStreak >= 2) badges.push({ label: `🔥 ${m.currentStreak}-wk streak`, color: "warning" });
    if (m.newLow) badges.push({ label: "New low 🎯", color: "info" });
    if (m.comeback) badges.push({ label: "Comeback 💪", color: "success" });
    if (m.backOnPace) badges.push({ label: "Back on pace 🚀", color: "info" });
    if (m.decadesCrossed.length) badges.push({ label: `Under ${m.decadesCrossed[0]}`, color: "success" });
    if (m.earnedPct.length) badges.push({ label: `${Math.max(...m.earnedPct)}% to goal`, color: "success" });
    if (m.earnedLoss.length) badges.push({ label: `${Math.max(...m.earnedLoss)} lb lost`, color: "success" });
    if (m.loggingStreak >= 3) badges.push({ label: `📆 ${m.loggingStreak} wk logged`, color: "primary" });
  }
  const topBadges = badges.slice(0, 2);

  return (
    <>
      <Box
        sx={{
          display: "grid",
          gap: 1.5,
          gridTemplateColumns: { xs: "1fr 1fr", md: "repeat(3, 1fr)" },
          mb: 3,
        }}
      >
        <Tile
          label="Current"
          value={`${stats.current} lb`}
          sub={`as of ${formatDate(stats.currentDate)}`}
        />
        <Tile
          label="Week over week"
          value={stats.wowAbs == null ? "—" : `${signed(stats.wowAbs)} lb`}
          color={
            stats.wowAbs == null || stats.wowAbs === 0
              ? undefined
              : stats.wowAbs < 0
                ? "success.main"
                : "warning.main"
          }
          sub={stats.wowPct != null ? signed(stats.wowPct, "%") : undefined}
        />

        {maintain ? (
          <>
            <Tile
              label="From goal"
              value={
                stats.distanceFromCenter == null
                  ? "—"
                  : `${signed(stats.distanceFromCenter)} lb`
              }
              color={stats.inRange ? "success.main" : "warning.main"}
              sub={
                holdWeight != null && holdRange != null
                  ? `hold ${holdWeight} ±${holdRange}`
                  : undefined
              }
            />
            <Tile
              label="In range"
              value={stats.inRange ? "Yes ✓" : "Out"}
              color={stats.inRange ? "success.main" : "warning.main"}
              sub={
                stats.weeksInRange != null
                  ? `${stats.weeksInRange} wk in a row`
                  : undefined
              }
            />
            <Tile
              label="Total change"
              value={`${signed(-stats.totalLost)} lb`}
              color={stats.totalLost > 0 ? "success.main" : undefined}
              sub="since this plan began"
            />
            <Tile
              label="Trend"
              value={drift == null ? "—" : holding ? "Holding ✓" : drift > 0 ? "Drifting up" : "Drifting down"}
              color={drift == null ? undefined : holding ? "success.main" : "warning.main"}
              sub={
                drift != null && !holding
                  ? `${signed(round1(drift))} lb/wk (${WINDOW_LABEL[win]})`
                  : `${WINDOW_LABEL[win]} window`
              }
            />
          </>
        ) : (
          <>
            <Tile
              label="Total lost"
              value={`${stats.totalLost} lb`}
              color={stats.totalLost > 0 ? "success.main" : undefined}
              sub={`${signed(-stats.totalLostPct, "%")} since start`}
            />
            {hasGoal && stats.paceBuffer != null ? (
              <Tile
                label="Pace buffer"
                value={`${Math.abs(stats.paceBuffer)} lb ${stats.paceBuffer >= 0 ? "ahead" : "behind"}`}
                color={stats.paceBuffer >= 0 ? "success.main" : "warning.main"}
              >
                <PaceGauge buffer={stats.paceBuffer} />
              </Tile>
            ) : null}
            {hasGoal && stats.percentToGoal != null ? (
              <Tile label="Progress to goal" value={`${Math.round(stats.percentToGoal)}%`}>
                <LinearProgress
                  variant="determinate"
                  value={Math.max(0, Math.min(100, stats.percentToGoal))}
                  sx={{ mt: 1.5, height: 8, borderRadius: 4 }}
                />
              </Tile>
            ) : null}
            {hasGoal ? (
              <Tile label="Projected goal" value={projValue} sub={projSub} color={projColor} />
            ) : null}
          </>
        )}
      </Box>

      <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2.5 } }}>
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          justifyContent="space-between"
          flexWrap="wrap"
          sx={{ mb: 1.5, px: 1, rowGap: 1 }}
        >
          <Typography variant="h6">{maintain ? "Maintaining" : "Trend"}</Typography>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={win}
            onChange={(_, v: WindowKey | null) => v && setWin(v)}
            aria-label="Trend timeframe"
          >
            {WINDOWS.map((w) => (
              <ToggleButton key={w.key} value={w.key} sx={{ px: 1.5, py: 0.5 }}>
                {w.label}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </Stack>

        <WeightChart
          dates={dates}
          actual={actual}
          target={target}
          trend={trends[win]}
          movingAvg={movingAvg}
          bandLow={bandLow}
          bandHigh={bandHigh}
          ghost={ghost}
          color={color}
          hasGoal={hasGoal}
          goalWeight={goalWeight}
          goalDate={goalDate}
        />
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="center"
          flexWrap="wrap"
          sx={{ px: 1, mt: 0.5, gap: 1 }}
        >
          <Typography variant="caption" color="text.secondary">
            {maintain && holdWeight != null && holdRange != null
              ? `Holding ${holdWeight} ±${holdRange} lb · ${WINDOW_LABEL[win]} trend`
              : hasGoal && planPace != null
                ? `Plan pace ${planPace} lb/wk${goalDate ? ` · due ${formatDate(goalDate)}` : ""} · ${WINDOW_LABEL[win]} trend`
                : ""}
          </Typography>
          {topBadges.length > 0 ? (
            <Stack direction="row" flexWrap="wrap" useFlexGap sx={{ gap: 0.75 }}>
              {topBadges.map((b) => (
                <Chip key={b.label} size="small" color={b.color} variant="filled" label={b.label} />
              ))}
            </Stack>
          ) : null}
        </Stack>
      </Paper>
    </>
  );
}
