import "server-only";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  financialAccounts,
  accountSnapshots,
  savingsGoals,
  type FinancialAccount,
  type SavingsGoal,
} from "@/lib/db/schema";
import { requireGroupId } from "@/lib/session";
import { getGroupTimezone } from "@/lib/queries/group";
import { goalForMonth } from "@/lib/finance/savings-goal";
import { lastDayOfMonth, todayISO } from "@/lib/finance/parse";
import {
  addMonths,
  monthDiff,
  paceOver,
  type NetWorthRange,
  type Pace,
} from "@/lib/finance/net-worth";
import { cashFlowByMonth, summarizeCashFlow } from "@/lib/queries/finance-cashflow";
import { getAtlasViewForGroup } from "@/lib/queries/finance-atlas";

// ─────────────────────────────────────────────────────────────────────────────
// NET WORTH — reads + ALL derived metrics (nothing here is stored; same spirit
// as MPG/weight). The sheet this replaces: monthly per-account balances, total,
// MoM change, cumulative $/% growth vs a starting month, and the "bank saved"
// subset (flagged accounts) tracked against an effective-dated monthly goal.
//
// A row's month is the month it closes (logged on the 1st of the next). Every
// range reads from a starting point: This year starts at last year's final
// row (the sheet's "Dec"), 12 months at the row a year before the newest, All
// time at the first row. Growth and the goal line measure from it.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * THE account display order — the accounts manager, the monthly log and the
 * donut share it, so a reorder moves them together.
 * Archived last: plain `asc(archivedAt)` would put them FIRST, since Postgres
 * sorts NULLs last in ASC — hence the explicit is-not-null flag.
 */
export const accountOrder = [
  asc(sql`${financialAccounts.archivedAt} is not null`),
  asc(financialAccounts.sortOrder),
  asc(financialAccounts.id),
];

export type NetWorthStats = {
  currentMonth: string;
  currentTotal: number;
  /** vs the previous logged row; span > 1 when months in between were never logged. */
  lastChange: { value: number; span: number } | null;
  rangeChange: number | null;
  rangeChangePct: number | null;
  bankCumulative: number | null;
  bankGoalToDate: number | null;
  bankVsGoal: number | null; // cumulative − goalToDate (ahead/behind)
};

export type NetWorthDashboard = {
  range: NetWorthRange;
  /** Non-archived tracked accounts, plus any archived/untracked ones that
   *  still have balances in the window (so their history stays readable). */
  accounts: FinancialAccount[];
  /** All the group's accounts incl. archived — for the accounts manager. */
  allAccounts: FinancialAccount[];
  /** The starting point then the range's logged months, ascending. */
  months: string[];
  /** 1 when months[0] is a starting point from before the range, else 0. */
  windowStart: number;
  /** Aligned to `months`; null = no snapshot for that account that month. */
  balances: Record<number, (number | null)[]>;
  totals: number[];
  bankSaved: {
    totals: number[]; // bank-flagged subset per month
    cumulative: (number | null)[];
    goal: (number | null)[]; // cumulative goal line; null before any segment
  };
  /** Calendar months inside the window that were never logged. */
  missingMonths: string[];
  /** Last month, once it has closed and is not logged yet (the 1st-of-month ritual). */
  dueMonth: string | null;
  /** "YYYY-MM" → { accountId: balance } over ALL history, for the log dialog's prefill. */
  balancesByMonth: Record<string, Record<number, number | null>>;
  /** Average monthly change over the last 6 and 12 months of ALL history. */
  pace: { short: Pace | null; long: Pace | null };
  stats: NetWorthStats | null;
  activeGoal: SavingsGoal | null;
  /** Oldest month ever logged (YYYY-MM-01), for the log dialog's years. */
  firstLogged: string | null;
};

/** Every financial account of the group, display order, archived last. */
export async function listFinancialAccounts(): Promise<FinancialAccount[]> {
  const groupId = await requireGroupId();
  return db
    .select()
    .from(financialAccounts)
    .where(eq(financialAccounts.groupId, groupId))
    .orderBy(...accountOrder);
}

/** The months a range covers, from the full ascending list of logged months. */
function windowFor(range: NetWorthRange, all: string[]): { months: string[]; windowStart: number } {
  const latest = all.at(-1);
  if (!latest || range === "all") return { months: all, windowStart: 0 };
  if (range === "12mo") {
    const target = addMonths(latest, -12);
    const anchor = all.filter((m) => m <= target).at(-1);
    return anchor
      ? { months: all.filter((m) => m >= anchor), windowStart: 1 }
      : { months: all, windowStart: 0 };
  }
  // This year = the newest row's year, so a January visit still shows the
  // year that just closed until its first month is logged.
  const year = latest.slice(0, 4);
  const inYear = all.filter((m) => m.slice(0, 4) === year);
  const anchor = all.filter((m) => m < `${year}-01-01`).at(-1);
  return anchor ? { months: [anchor, ...inYear], windowStart: 1 } : { months: inYear, windowStart: 0 };
}

/** Session wrapper: scopes to the signed-in group, then delegates. */
export async function getNetWorthDashboard(range: NetWorthRange = "year"): Promise<NetWorthDashboard> {
  const groupId = await requireGroupId();
  return getNetWorthDashboardForGroup(groupId, range, todayISO(await getGroupTimezone(groupId)));
}

/** The whole Net Worth tab in one call (weight-dashboard shape). */
export async function getNetWorthDashboardForGroup(
  groupId: number,
  range: NetWorthRange,
  today: string,
): Promise<NetWorthDashboard> {
  const allAccounts = await db
    .select()
    .from(financialAccounts)
    .where(eq(financialAccounts.groupId, groupId))
    .orderBy(...accountOrder);

  const accountIds = allAccounts.map((a) => a.id);
  const [snaps, goals] = await Promise.all([
    accountIds.length
      ? db
          .select()
          .from(accountSnapshots)
          .where(inArray(accountSnapshots.accountId, accountIds))
          .orderBy(asc(accountSnapshots.month))
      : Promise.resolve([]),
    db
      .select()
      .from(savingsGoals)
      .where(eq(savingsGoals.groupId, groupId))
      .orderBy(asc(savingsGoals.startMonth), asc(savingsGoals.id)),
  ]);
  const activeGoal = goals.findLast((g) => g.endMonth === null) ?? null;

  // month → accountId → balance
  const byMonth = new Map<string, Map<number, number>>();
  for (const s of snaps) {
    const m = byMonth.get(s.month) ?? new Map<number, number>();
    m.set(s.accountId, Number(s.balance));
    byMonth.set(s.month, m);
  }
  const allMonths = [...byMonth.keys()].sort();
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const totalOf = (m: string) =>
    round2([...(byMonth.get(m)?.values() ?? [])].reduce((s, v) => s + v, 0));

  const balancesByMonth: Record<string, Record<number, number | null>> = {};
  for (const m of allMonths) {
    balancesByMonth[m.slice(0, 7)] = Object.fromEntries(byMonth.get(m) ?? []);
  }

  const lastClosed = addMonths(`${today.slice(0, 7)}-01`, -1);
  const latestLogged = allMonths.at(-1) ?? null;
  const dueMonth = !latestLogged || lastClosed > latestLogged ? lastClosed : null;
  const allTotals = allMonths.map(totalOf);
  const pace = {
    short: paceOver(allMonths, allTotals, 6),
    long: paceOver(allMonths, allTotals, 12),
  };

  const { months, windowStart } = windowFor(range, allMonths);

  // Accounts shown: active+tracked, plus anything with data in these months
  // (so an account archived mid-year keeps its history).
  const hasData = (a: FinancialAccount) => months.some((m) => byMonth.get(m)?.has(a.id));
  const accounts = allAccounts.filter((a) => (!a.archivedAt && a.trackBalance) || hasData(a));

  const balances: Record<number, (number | null)[]> = {};
  for (const a of accounts) {
    balances[a.id] = months.map((m) => byMonth.get(m)?.get(a.id) ?? null);
  }
  const totals = months.map(totalOf);
  const bankIds = new Set(accounts.filter((a) => a.includeInBankSaved).map((a) => a.id));
  const bankTotals = months.map((m) => {
    let sum = 0;
    for (const [id, v] of byMonth.get(m) ?? []) if (bankIds.has(id)) sum += v;
    return round2(sum);
  });

  // Cumulative vs the starting point (months[0]).
  const cumOf = (series: number[]) =>
    series.map((v, i) => (i === 0 ? null : round2(v - series[0])));
  const cumulative = cumOf(totals);
  const bankCumulative = cumOf(bankTotals);

  // Goal line: each CALENDAR month after the starting point adds that month's
  // goal, so a month left unlogged still counts toward what should be saved.
  // Null until a segment covers some month.
  const goal: (number | null)[] = months.map(() => null);
  if (months.length > 1) {
    let running = 0;
    let seen = false;
    let i = 1;
    for (let m = addMonths(months[0], 1); m <= months[months.length - 1]; m = addMonths(m, 1)) {
      const seg = goalForMonth(goals, m);
      if (seg) {
        seen = true;
        running = round2(running + Number(seg.monthlyGoal));
      }
      if (m === months[i]) {
        goal[i] = seen ? running : null;
        i++;
      }
    }
  }

  const missingMonths: string[] = [];
  if (months.length > 1) {
    const logged = new Set(months);
    for (let m = addMonths(months[0], 1); m < months[months.length - 1]; m = addMonths(m, 1)) {
      if (!logged.has(m)) missingMonths.push(m);
    }
  }

  const last = months.length - 1;
  const stats: NetWorthStats | null =
    last >= 0
      ? {
          currentMonth: months[last],
          currentTotal: totals[last],
          lastChange:
            last > 0
              ? {
                  value: round2(totals[last] - totals[last - 1]),
                  span: monthDiff(months[last - 1], months[last]),
                }
              : null,
          rangeChange: cumulative[last],
          rangeChangePct:
            cumulative[last] != null && totals[0] !== 0
              ? round2((cumulative[last]! / Math.abs(totals[0])) * 100)
              : null,
          bankCumulative: bankIds.size ? bankCumulative[last] : null,
          bankGoalToDate: goal[last],
          bankVsGoal:
            bankIds.size && bankCumulative[last] != null && goal[last] != null
              ? round2(bankCumulative[last]! - goal[last]!)
              : null,
        }
      : null;

  return {
    range,
    accounts,
    allAccounts,
    months,
    windowStart,
    balances,
    totals,
    bankSaved: { totals: bankTotals, cumulative: bankCumulative, goal },
    missingMonths,
    dueMonth,
    balancesByMonth,
    pace,
    stats,
    activeGoal,
    firstLogged: allMonths[0] ?? null,
  };
}

export type NetWorthExtras = {
  /** Budget cash flow over the same months the range covers (the bank check). */
  kept: { moneyIn: number; moneyOut: number; kept: number; from: string; to: string } | null;
  runway: {
    cash: number; // bank-saved accounts, newest row
    brokerage: number; // brokerage accounts, newest row
    avgOut: number | null; // average money out per month, last full months
    avgOutMonths: number;
    bills: number; // ATLAS recurring bills, monthly
  } | null;
};

/** Cross-app numbers: the budget's cash flow and ATLAS bills next to the balances. */
export async function getNetWorthExtrasForGroup(
  groupId: number,
  dash: NetWorthDashboard,
  today: string,
): Promise<NetWorthExtras> {
  const { months } = dash;
  const last = months.length - 1;
  const thisMonth = `${today.slice(0, 7)}-01`;

  const [summary, outMonths, atlas] = await Promise.all([
    last > 0
      ? summarizeCashFlow(groupId, {
          from: addMonths(months[0], 1),
          to: lastDayOfMonth(months[last]),
        })
      : Promise.resolve(null),
    cashFlowByMonth(groupId, {
      from: addMonths(thisMonth, -6),
      to: lastDayOfMonth(addMonths(thisMonth, -1)),
    }),
    getAtlasViewForGroup(groupId, undefined, today),
  ]);

  const kept =
    summary && summary.count > 0
      ? {
          moneyIn: summary.moneyIn,
          moneyOut: summary.moneyOut,
          kept: Math.round((summary.moneyIn - summary.moneyOut) * 100) / 100,
          from: addMonths(months[0], 1),
          to: months[last],
        }
      : null;

  // Months before the first transaction would drag the average down, so skip them.
  const firstActive = outMonths.findIndex((m) => m.moneyOut > 0);
  const counted = firstActive >= 0 ? outMonths.slice(firstActive) : [];
  const avgOut = counted.length
    ? Math.round(counted.reduce((s, m) => s + m.moneyOut, 0) / counted.length)
    : null;

  const latestBalance = (pick: (a: FinancialAccount) => boolean) =>
    last >= 0
      ? dash.accounts.filter(pick).reduce((s, a) => s + (dash.balances[a.id]?.[last] ?? 0), 0)
      : 0;
  const cash = latestBalance((a) => a.includeInBankSaved);
  const runway =
    last >= 0 && cash > 0
      ? {
          cash: Math.round(cash),
          brokerage: Math.round(latestBalance((a) => a.kind === "brokerage")),
          avgOut,
          avgOutMonths: counted.length,
          bills: Math.round(atlas.totals.fixedMonthly),
        }
      : null;

  return { kept, runway };
}
