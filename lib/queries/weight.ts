import "server-only";
import { and, asc, desc, eq, gte, isNull, lte, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { weighIns, weightPlans } from "@/lib/db/schema";
import type { WeighIn, WeightPlan } from "@/lib/db/schema";
import { requireGroupId } from "@/lib/session";
import { profileInGroup } from "./scope";

// ─────────────────────────────────────────────────────────────────────────────
// WEIGHT — reads + all DERIVED metrics (nothing here is stored; same spirit as
// MPG in the fuel queries). Postgres `numeric` comes back as a string, so every
// weight number is Number()-parsed the moment it leaves the DB.
//
// The chart is a fixed ~1-calendar-year window: it shows EVERY weigh-in, and the
// target/band for each week comes from whichever plan covers that date. So a
// plan switch mid-year hands the target off (lose line → maintain band) WITHOUT
// hiding history. Stats/trend/milestones reflect the ACTIVE plan.
// ─────────────────────────────────────────────────────────────────────────────

const MS_DAY = 86_400_000;
const PLAN_HORIZON_WEEKS = 52; // one calendar year of chart
const MIN_TREND_POINTS = 3; // fewer than this in a window → no meaningful trend

// The selectable trend windows. `weeks: null` = all history.
export const TREND_WINDOWS = [
  { key: "all", label: "All", weeks: null },
  { key: "6mo", label: "6 mo", weeks: 26 },
  { key: "3mo", label: "3 mo", weeks: 13 },
  { key: "6wk", label: "6 wk", weeks: 6 },
] as const;
export type WindowKey = (typeof TREND_WINDOWS)[number]["key"];

// `date` columns are "YYYY-MM-DD"; anchor at noon UTC so day math never rolls.
function parseDate(iso: string): Date {
  return new Date(`${iso}T12:00:00Z`);
}
function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function addWeeks(startISO: string, weeks: number): string {
  const d = parseDate(startISO);
  d.setUTCDate(d.getUTCDate() + Math.round(weeks * 7));
  return toISO(d);
}
function weeksBetween(startISO: string, iso: string): number {
  return Math.round((parseDate(iso).getTime() - parseDate(startISO).getTime()) / (7 * MS_DAY));
}
const round1 = (n: number) => Math.round(n * 10) / 10;

// ── Raw reads ─────────────────────────────────────────────────────────────────
// TENANCY: these four raw reads carry the group check (profileInGroup); every
// derived/composite function below goes through them, so it inherits the scope.

/** All weigh-ins for a profile, oldest first (chart + series order). */
export async function listWeighIns(profileId: number): Promise<WeighIn[]> {
  const groupId = await requireGroupId();
  return db
    .select()
    .from(weighIns)
    .where(
      and(eq(weighIns.profileId, profileId), profileInGroup(weighIns.profileId, groupId)),
    )
    .orderBy(asc(weighIns.measuredOn), asc(weighIns.id));
}

/** The active plan for a profile: its date window contains today (end_date null
 *  = open-ended). If plans somehow overlap, the latest-starting one wins. */
export async function getActivePlan(profileId: number): Promise<WeightPlan | null> {
  const groupId = await requireGroupId();
  const today = new Date().toISOString().slice(0, 10);
  const rows = await db
    .select()
    .from(weightPlans)
    .where(
      and(
        eq(weightPlans.profileId, profileId),
        profileInGroup(weightPlans.profileId, groupId),
        lte(weightPlans.startDate, today),
        or(isNull(weightPlans.endDate), gte(weightPlans.endDate, today)),
      ),
    )
    .orderBy(desc(weightPlans.startDate), desc(weightPlans.id))
    .limit(1);
  return rows[0] ?? null;
}

/** All plans for a profile, oldest first (for the continuous multi-plan chart). */
export async function listPlans(profileId: number): Promise<WeightPlan[]> {
  const groupId = await requireGroupId();
  return db
    .select()
    .from(weightPlans)
    .where(
      and(
        eq(weightPlans.profileId, profileId),
        profileInGroup(weightPlans.profileId, groupId),
      ),
    )
    .orderBy(asc(weightPlans.startDate), asc(weightPlans.id));
}

/** A single weigh-in by (id, profile) — scoped so one person can't edit another's. */
export async function getWeighIn(id: number, profileId: number): Promise<WeighIn | null> {
  const groupId = await requireGroupId();
  const rows = await db
    .select()
    .from(weighIns)
    .where(
      and(
        eq(weighIns.id, id),
        eq(weighIns.profileId, profileId),
        profileInGroup(weighIns.profileId, groupId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** History rows (newest first) with week-over-week delta vs the prior weigh-in. */
export async function getWeighInsWithDelta(profileId: number): Promise<
  { id: number; measuredOn: string; weight: number; note: string | null; delta: number | null }[]
> {
  const rows = await listWeighIns(profileId); // ascending
  const out = rows.map((r, i) => {
    const weight = Number(r.weight);
    const prev = i > 0 ? Number(rows[i - 1].weight) : null;
    return {
      id: r.id,
      measuredOn: r.measuredOn,
      weight,
      note: r.note,
      delta: prev != null ? round1(weight - prev) : null,
    };
  });
  return out.reverse(); // newest first for the table
}

// ── Derived dashboard ───────────────────────────────────────────────────────
export type PlanMode = "lose" | "maintain";

export type ChartBase = {
  dates: string[]; // weekly tick dates (YYYY-MM-DD) from the chart anchor
  weeks: number[];
  actual: (number | null)[];
  target: (number | null)[]; // per-week, from whichever plan covers that date
  movingAvg: (number | null)[];
  bandLow: (number | null)[]; // per-week maintain band lower edge (null off-band)
  bandHigh: (number | null)[]; // per-week maintain band upper edge (null off-band)
  ghost: (number | null)[]; // last year's actuals, aligned by week-of-year (faded)
};

export type YearSummary = {
  year: number;
  startWeight: number; // first weigh-in of the year
  currentWeight: number; // latest weigh-in of the year
  totalChange: number; // + = lost this year
  totalChangePct: number;
  weighIns: number; // count this year
  low: number; // lightest weigh-in of the year
  high: number; // heaviest weigh-in of the year
  bestWeekDrop: number | null; // biggest single-week loss this year
  lastYearAtNow: number | null; // last year's weight at the same week-of-year
};

export type WeightStats = {
  mode: PlanMode;
  current: number;
  currentDate: string;
  wowAbs: number | null;
  wowPct: number | null;
  totalLost: number;
  totalLostPct: number;
  paceBuffer: number | null; // LOSE: target − actual at latest; + = ahead, − = behind
  percentToGoal: number | null; // LOSE: 0–100 (can exceed past goal)
  distanceFromCenter: number | null; // MAINTAIN: current − hold weight (signed)
  inRange: boolean | null; // MAINTAIN: within the band right now
  weeksInRange: number | null; // MAINTAIN: trailing consecutive in-range weigh-ins
};

export type Projection = {
  onTrack: boolean;
  date: string | null;
  weeks: number | null;
  vsPlanDays: number | null;
  paceLbPerWeek: number | null;
  enoughData: boolean;
};

export type Milestones = {
  mode: PlanMode;
  earnedLoss: number[];
  earnedPct: number[];
  decadesCrossed: number[];
  atGoal: boolean;
  newLow: boolean;
  backOnPace: boolean;
  comeback: boolean;
  momentum: boolean;
  steadyLoser: boolean;
  bestWeekDrop: number | null;
  currentStreak: number;
  bestStreak: number;
  nextLossLb: number | null;
  toNextLossLb: number | null;
  inRangeNow: boolean;
  weeksInRange: number;
  longestInRange: number;
  loggingStreak: number;
};

export type WeightDashboard = {
  plan: WeightPlan | null;
  weighIns: WeighIn[];
  stats: WeightStats | null;
  chart: ChartBase;
  trends: Record<WindowKey, (number | null)[]>;
  projections: Record<WindowKey, Projection>;
  planPaceLbPerWeek: number | null;
  goalDate: string | null; // LOSE: when the plan is due to reach goal (YYYY-MM-DD)
  milestones: Milestones | null;
  yearSummary: YearSummary | null;
  year: number; // the calendar year being viewed
  availableYears: number[]; // years that have any weigh-ins (newest first)
  celebrate: YearSummary | null; // a just-finished year to auto-popup (turn window only)
};

/** Least-squares slope+intercept of y over x; null if fewer than 2 points. */
function linearFit(pts: { x: number; y: number }[]): { m: number; b: number } | null {
  const n = pts.length;
  if (n < 2) return null;
  const sx = pts.reduce((s, p) => s + p.x, 0);
  const sy = pts.reduce((s, p) => s + p.y, 0);
  const sxx = pts.reduce((s, p) => s + p.x * p.x, 0);
  const sxy = pts.reduce((s, p) => s + p.x * p.y, 0);
  const denom = n * sxx - sx * sx;
  if (denom === 0) return null;
  const m = (n * sxy - sx * sy) / denom;
  const b = (sy - m * sx) / n;
  return { m, b };
}

const emptyProjection = (enoughData: boolean): Projection => ({
  onTrack: false,
  date: null,
  weeks: null,
  vsPlanDays: null,
  paceLbPerWeek: null,
  enoughData,
});

/** A year's Wrapped summary from raw weigh-ins; null if that year has none. */
function yearSummaryFor(rows: WeighIn[], year: number): YearSummary | null {
  const inYear = rows.filter(
    (r) => r.measuredOn >= `${year}-01-01` && r.measuredOn <= `${year}-12-31`,
  );
  if (inYear.length === 0) return null;
  const w = inYear.map((r) => Number(r.weight));
  const first = w[0];
  const last = w[w.length - 1];
  let bestDrop = 0;
  for (let i = 1; i < w.length; i++) bestDrop = Math.max(bestDrop, w[i - 1] - w[i]);

  // Last year's weight at the same week-of-year as this year's latest weigh-in.
  const lastWk = weeksBetween(inYear[0].measuredOn, inYear[inYear.length - 1].measuredOn);
  const prev = rows.filter(
    (r) => r.measuredOn >= `${year - 1}-01-01` && r.measuredOn <= `${year - 1}-12-31`,
  );
  const pAnchor = prev[0]?.measuredOn ?? `${year - 1}-01-01`;
  const pMap = new Map<number, number>();
  for (const r of prev) pMap.set(weeksBetween(pAnchor, r.measuredOn), Number(r.weight));

  return {
    year,
    startWeight: first,
    currentWeight: last,
    totalChange: round1(first - last),
    totalChangePct: first ? round1(((first - last) / first) * 100) : 0,
    weighIns: w.length,
    low: round1(Math.min(...w)),
    high: round1(Math.max(...w)),
    bestWeekDrop: bestDrop > 0 ? round1(bestDrop) : null,
    lastYearAtNow: pMap.has(lastWk) ? pMap.get(lastWk)! : null,
  };
}

/** Everything the dashboard page needs for one profile, in a single call. */
export async function getWeightDashboard(
  profileId: number,
  year?: number,
): Promise<WeightDashboard> {
  const [rows, plans] = await Promise.all([listWeighIns(profileId), listPlans(profileId)]);
  const today = new Date().toISOString().slice(0, 10);
  const currentYear = Number(today.slice(0, 4));
  const viewYear = year ?? currentYear;
  // Newest year first, so the leftmost switcher button is always the latest year.
  const availableYears = [...new Set(rows.map((r) => Number(r.measuredOn.slice(0, 4))))].sort(
    (a, b) => b - a,
  );

  // The plan in effect for the viewed year: the one covering `refDate` (today for
  // the current year, else Dec 31 of that year). Const so TS narrows it below.
  const refDate = viewYear >= currentYear ? today : `${viewYear}-12-31`;
  let active: WeightPlan | null = null;
  for (const p of plans) {
    if (p.startDate <= refDate && (p.endDate == null || p.endDate >= refDate)) active = p;
  }
  const plan = active;
  const isMaintain = plan?.mode === "maintain";
  const goalWeight = plan ? Number(plan.goalWeight) : null;
  const pace = plan ? Number(plan.perWeekPace) : null;
  const rangeLb = plan?.rangeLb != null ? Number(plan.rangeLb) : null;
  const planEndDate =
    !isMaintain && plan && pace && pace > 0
      ? addWeeks(plan.startDate, (Number(plan.startWeight) - Number(plan.goalWeight)) / pace)
      : null;
  // A target-date plan stores its deadline as endDate; a pace plan's is derived.
  const goalDate = !isMaintain && plan ? (plan.endDate ?? planEndDate) : null;

  // The dashboard shows ONE calendar year; last year ghosts behind for comparison.
  const yStart = `${viewYear}-01-01`;
  const yEnd = `${viewYear}-12-31`;
  const allSeries = rows
    .filter((r) => r.measuredOn >= yStart && r.measuredOn <= yEnd)
    .map((r) => ({ date: r.measuredOn, weight: Number(r.weight) }));

  // Prior-year weigh-ins → the faded ghost line (aligned by week-of-year).
  const pStart = `${viewYear - 1}-01-01`;
  const pEnd = `${viewYear - 1}-12-31`;
  const prevSeries = rows
    .filter((r) => r.measuredOn >= pStart && r.measuredOn <= pEnd)
    .map((r) => ({ date: r.measuredOn, weight: Number(r.weight) }));

  const emptyTrends = {
    all: [] as (number | null)[],
    "6mo": [] as (number | null)[],
    "3mo": [] as (number | null)[],
    "6wk": [] as (number | null)[],
  };
  const emptyProjections = {
    all: emptyProjection(false),
    "6mo": emptyProjection(false),
    "3mo": emptyProjection(false),
    "6wk": emptyProjection(false),
  };
  const emptyChart: ChartBase = {
    dates: [],
    weeks: [],
    actual: [],
    target: [],
    movingAvg: [],
    bandLow: [],
    bandHigh: [],
    ghost: [],
  };

  // Anchor the year window at the first weigh-in of the year (or Jan 1).
  const anchorDate = allSeries[0]?.date ?? yStart;
  const prevAnchor = prevSeries[0]?.date ?? pStart;
  const ghostByWeek = new Map<number, number>();
  for (const s of prevSeries) ghostByWeek.set(weeksBetween(prevAnchor, s.date), s.weight);

  if (allSeries.length === 0) {
    return {
      plan,
      weighIns: rows,
      stats: null,
      chart: emptyChart,
      trends: emptyTrends,
      projections: emptyProjections,
      planPaceLbPerWeek: pace,
      goalDate,
      milestones: null,
      yearSummary: null,
      year: viewYear,
      availableYears,
      celebrate: null,
    };
  }

  // Full-history week placement off the anchor (for actuals + moving average).
  const actualByWeek = new Map<number, number>();
  for (const s of allSeries) actualByWeek.set(weeksBetween(anchorDate, s.date), s.weight);
  const lastWeek = weeksBetween(anchorDate, allSeries[allSeries.length - 1].date);
  const axisEnd = Math.max(PLAN_HORIZON_WEEKS, lastWeek);

  const fullOrdered = [...actualByWeek.entries()].sort((a, b) => a[0] - b[0]);
  const maByWeek = new Map<number, number>();
  for (let i = 0; i < fullOrdered.length; i++) {
    const winPts = fullOrdered.slice(Math.max(0, i - 3), i + 1);
    maByWeek.set(fullOrdered[i][0], round1(winPts.reduce((s, [, w]) => s + w, 0) / winPts.length));
  }

  // The plan covering a given date (latest-starting match, or null).
  const planCovering = (dateISO: string): WeightPlan | null => {
    let match: WeightPlan | null = null;
    for (const p of plans) {
      if (p.startDate <= dateISO && (p.endDate == null || p.endDate >= dateISO)) match = p;
    }
    return match;
  };

  const dates: string[] = [];
  const weeks: number[] = [];
  const actual: (number | null)[] = [];
  const target: (number | null)[] = [];
  const movingAvg: (number | null)[] = [];
  const bandLow: (number | null)[] = [];
  const bandHigh: (number | null)[] = [];
  const ghost: (number | null)[] = [];
  for (let w = 0; w <= axisEnd; w++) {
    weeks.push(w);
    const date = addWeeks(anchorDate, w);
    dates.push(date);
    actual.push(actualByWeek.has(w) ? actualByWeek.get(w)! : null);
    ghost.push(ghostByWeek.has(w) ? ghostByWeek.get(w)! : null);
    movingAvg.push(maByWeek.has(w) ? maByWeek.get(w)! : null);

    const p = planCovering(date);
    if (!p) {
      target.push(null);
      bandLow.push(null);
      bandHigh.push(null);
    } else if (p.mode === "maintain") {
      const g = Number(p.goalWeight);
      const r = p.rangeLb != null ? Number(p.rangeLb) : 0;
      target.push(g);
      bandLow.push(round1(g - r));
      bandHigh.push(round1(g + r));
    } else {
      const wk = weeksBetween(p.startDate, date);
      target.push(
        round1(Math.max(Number(p.goalWeight), Number(p.startWeight) - Number(p.perWeekPace) * wk)),
      );
      bandLow.push(null);
      bandHigh.push(null);
    }
  }

  // The ACTIVE plan's window drives stats/trend/milestones. Fall back to the
  // latest overall weigh-in so "current" always shows a real number.
  const activeSeries = plan
    ? allSeries.filter(
        (s) => s.date >= plan.startDate && (plan.endDate == null || s.date <= plan.endDate),
      )
    : allSeries;
  const series = activeSeries.length ? activeSeries : allSeries.slice(-1);
  const startWeight = plan ? Number(plan.startWeight) : (series[0]?.weight ?? 0);

  const activeByWeek = new Map<number, number>();
  for (const s of series) activeByWeek.set(weeksBetween(anchorDate, s.date), s.weight);
  const ordered = [...activeByWeek.entries()].sort((a, b) => a[0] - b[0]);

  // ── Trend line + projection ──
  // The TREND is plan-agnostic: a regression over ALL weigh-ins (it's continuous
  // weekly weight), windowed by the timeframe toggle — so it shows right away and
  // the toggle stays meaningful even in maintenance. Projection to the goal date
  // only applies to a LOSE plan. In maintenance the line stops at the last weigh-in
  // (no false "heading somewhere"); a lose line extends forward toward the goal.
  const trends = { ...emptyTrends } as Record<WindowKey, (number | null)[]>;
  const projections = { ...emptyProjections } as Record<WindowKey, Projection>;
  const drawEnd = isMaintain ? lastWeek : axisEnd;

  for (const win of TREND_WINDOWS) {
    const cutoffWeek = win.weeks == null ? 0 : Math.max(0, lastWeek - (win.weeks - 1));
    const winPts = fullOrdered.filter(([w]) => w >= cutoffWeek);
    const enough = winPts.length >= MIN_TREND_POINTS;
    const fit = enough ? linearFit(winPts.map(([w, y]) => ({ x: w, y }))) : null;

    const line: (number | null)[] = [];
    for (let w = 0; w <= axisEnd; w++) {
      line.push(fit && w >= cutoffWeek && w <= drawEnd ? round1(fit.m * w + fit.b) : null);
    }
    trends[win.key] = line;

    if (!fit || goalWeight == null || isMaintain) {
      projections[win.key] = emptyProjection(enough);
      continue;
    }
    const onTrack = fit.m < -0.01;
    if (!onTrack) {
      projections[win.key] = { ...emptyProjection(true), paceLbPerWeek: round1(-fit.m) };
      continue;
    }
    const crossWeek = (goalWeight - fit.b) / fit.m;
    const date = addWeeks(anchorDate, crossWeek);
    const vsPlanDays = planEndDate
      ? Math.round((parseDate(planEndDate).getTime() - parseDate(date).getTime()) / MS_DAY)
      : null;
    projections[win.key] = {
      onTrack: true,
      date,
      weeks: Math.round(crossWeek),
      vsPlanDays,
      paceLbPerWeek: round1(-fit.m),
      enoughData: true,
    };
  }

  // ── Stats (active plan + latest weigh-in) ────────────────────────────────
  const weightsAsc = series.map((s) => s.weight);
  const first = weightsAsc[0];
  const last = series[series.length - 1];
  const prev = allSeries.length >= 2 ? allSeries[allSeries.length - 2].weight : null;

  const inRangeAt = (w: number) =>
    goalWeight != null && rangeLb != null && Math.abs(w - goalWeight) <= rangeLb;
  let weeksInRangeTrailing = 0;
  for (let i = weightsAsc.length - 1; i >= 0; i--) {
    if (inRangeAt(weightsAsc[i])) weeksInRangeTrailing++;
    else break;
  }

  const targetAtLast = !isMaintain ? (target[lastWeek] ?? null) : null;

  const stats: WeightStats = {
    mode: isMaintain ? "maintain" : "lose",
    current: last.weight,
    currentDate: last.date,
    wowAbs: prev != null ? round1(last.weight - prev) : null,
    wowPct: prev ? round1(((last.weight - prev) / prev) * 100) : null,
    totalLost: round1(first - last.weight),
    totalLostPct: first ? round1(((first - last.weight) / first) * 100) : 0,
    paceBuffer: targetAtLast != null ? round1(targetAtLast - last.weight) : null,
    percentToGoal:
      !isMaintain && goalWeight != null && startWeight !== goalWeight
        ? round1(((startWeight - last.weight) / (startWeight - goalWeight)) * 100)
        : null,
    distanceFromCenter: isMaintain && goalWeight != null ? round1(last.weight - goalWeight) : null,
    inRange: isMaintain ? inRangeAt(last.weight) : null,
    weeksInRange: isMaintain ? weeksInRangeTrailing : null,
  };

  // ── Milestones (over the active plan) ────────────────────────────────────
  let best = 0;
  let run = 0;
  for (let i = 1; i < weightsAsc.length; i++) {
    if (weightsAsc[i] < weightsAsc[i - 1]) {
      run++;
      best = Math.max(best, run);
    } else run = 0;
  }
  let currentStreak = 0;
  for (let i = weightsAsc.length - 1; i > 0; i--) {
    if (weightsAsc[i] < weightsAsc[i - 1]) currentStreak++;
    else break;
  }

  let longestInRange = 0;
  let inRun = 0;
  for (const w of weightsAsc) {
    if (inRangeAt(w)) {
      inRun++;
      longestInRange = Math.max(longestInRange, inRun);
    } else inRun = 0;
  }

  const byWeekWeights = ordered.map(([, w]) => w); // active plan (loss badges)

  // Logging streak is plan-agnostic (the habit spans plans).
  const fullWeekIdxs = fullOrdered.map(([w]) => w);
  let loggingStreak = fullWeekIdxs.length ? 1 : 0;
  for (let i = fullWeekIdxs.length - 1; i > 0; i--) {
    if (fullWeekIdxs[i] - fullWeekIdxs[i - 1] === 1) loggingStreak++;
    else break;
  }

  const earnedLoss: number[] = [];
  const earnedPct: number[] = [];
  const decadesCrossed: number[] = [];
  let atGoal = false;
  let newLow = false;
  let backOnPace = false;
  let comeback = false;
  let momentum = false;
  let steadyLoser = false;
  let bestDrop = 0;
  let nextLossLb: number | null = null;

  if (!isMaintain && plan) {
    const allTimeLow = Math.min(...weightsAsc);
    for (let t = 5; t <= stats.totalLost + 1e-9; t += 5) earnedLoss.push(t);
    if (goalWeight != null && stats.percentToGoal != null) {
      for (const p of [25, 50, 75, 100]) if (stats.percentToGoal >= p) earnedPct.push(p);
    }
    atGoal = stats.percentToGoal != null && stats.percentToGoal >= 100;
    nextLossLb = atGoal ? null : (Math.floor(Math.max(0, stats.totalLost) / 5) + 1) * 5;

    const firstWeight = weightsAsc[0];
    for (let d = Math.floor(firstWeight / 10) * 10; d > last.weight; d -= 10) {
      if (d < firstWeight) decadesCrossed.push(d);
    }
    decadesCrossed.reverse();

    for (let i = 1; i < weightsAsc.length; i++) {
      bestDrop = Math.max(bestDrop, weightsAsc[i - 1] - weightsAsc[i]);
    }

    if (goalWeight != null && pace != null && series.length >= 2) {
      const psw = Number(plan.startWeight);
      const bufferAt = (dt: string, wt: number) =>
        Math.max(goalWeight, psw - pace * weeksBetween(plan.startDate, dt)) - wt;
      const a = series[series.length - 1];
      const b = series[series.length - 2];
      backOnPace = bufferAt(a.date, a.weight) >= 0 && bufferAt(b.date, b.weight) < 0;
    }

    newLow = last.weight <= allTimeLow + 1e-9;
    let recentGain = false;
    for (let i = Math.max(1, byWeekWeights.length - 5); i < byWeekWeights.length; i++) {
      if (byWeekWeights[i] > byWeekWeights[i - 1]) recentGain = true;
    }
    comeback = newLow && recentGain;

    const changes: number[] = [];
    for (let i = Math.max(1, byWeekWeights.length - 6); i < byWeekWeights.length; i++) {
      changes.push(byWeekWeights[i] - byWeekWeights[i - 1]);
    }
    const recentLosses = changes.filter((c) => c < 0).length;
    steadyLoser =
      changes.length >= 4 &&
      recentLosses >= changes.length - 1 &&
      !changes.some((c) => Math.abs(c) > 3) &&
      changes.reduce((s, c) => s + c, 0) < 0;

    let last4Down = 0;
    let last4Total = 0;
    for (let i = Math.max(1, byWeekWeights.length - 4); i < byWeekWeights.length; i++) {
      last4Total++;
      if (byWeekWeights[i] < byWeekWeights[i - 1]) last4Down++;
    }
    momentum = last4Total >= 4 && last4Down >= 3 && currentStreak < 3;
  }

  const milestones: Milestones = {
    mode: isMaintain ? "maintain" : "lose",
    earnedLoss,
    earnedPct,
    decadesCrossed,
    atGoal,
    newLow,
    backOnPace,
    comeback,
    momentum,
    steadyLoser,
    bestWeekDrop: bestDrop > 0 ? round1(bestDrop) : null,
    currentStreak: isMaintain ? 0 : currentStreak,
    bestStreak: isMaintain ? 0 : best,
    nextLossLb,
    toNextLossLb: nextLossLb != null ? round1(nextLossLb - stats.totalLost) : null,
    inRangeNow: isMaintain ? inRangeAt(last.weight) : false,
    weeksInRange: isMaintain ? weeksInRangeTrailing : 0,
    longestInRange: isMaintain ? longestInRange : 0,
    loggingStreak,
  };

  const yearSummary = yearSummaryFor(rows, viewYear);

  // A "just-finished" year to auto-celebrate, but only in the turn window (last
  // week of December, or the first week of January). Else null — no popup.
  const nowMonth = Number(today.slice(5, 7));
  const nowDay = Number(today.slice(8, 10));
  const celebrateYear =
    nowMonth === 12 && nowDay >= 25
      ? currentYear
      : nowMonth === 1 && nowDay <= 7
        ? currentYear - 1
        : null;
  const celebrate = celebrateYear ? yearSummaryFor(rows, celebrateYear) : null;

  return {
    plan,
    weighIns: rows,
    stats,
    chart: { dates, weeks, actual, target, movingAvg, bandLow, bandHigh, ghost },
    trends,
    projections,
    planPaceLbPerWeek: pace,
    goalDate,
    milestones,
    yearSummary,
    year: viewYear,
    availableYears,
    celebrate,
  };
}
