import "server-only";
import { and, asc, eq, gte, inArray, isNotNull, lte, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  financialAccounts,
  accountSnapshots,
  compensationPlans,
  incomeDeductions,
  transactions,
  type FinancialAccount,
} from "@/lib/db/schema";
import { requireGroupId } from "@/lib/session";
import { getGroupTimezone } from "@/lib/queries/group";
import { profileInGroup } from "@/lib/queries/scope";
import { lastDayOfMonth, todayISO } from "@/lib/finance/parse";
import {
  CASH_KINDS,
  addMonths,
  monthDiff,
  paceOver,
  type NetWorthRange,
  type Pace,
} from "@/lib/finance/net-worth";
import { cashFlowByMonth } from "@/lib/queries/finance-cashflow";
import {
  PAYCHECKS_PER_YEAR,
  deductionPerCheckC,
  effectiveAt,
  getAtlasViewForGroup,
} from "@/lib/queries/finance-atlas";

// ─────────────────────────────────────────────────────────────────────────────
// NET WORTH — reads + ALL derived metrics (nothing here is stored; same spirit
// as MPG/weight). The sheet this replaces: monthly per-account balances, total,
// MoM change, and cumulative $/% growth vs a starting month. It only tracks
// money up and down; the savings goal lives with the budget (ATLAS/History).
//
// A row's month is the month it closes (logged on the 1st of the next). Every
// range reads from a starting point: This year starts at last year's final
// row (the sheet's "Dec"), 12 months at the row a year before the newest, All
// time at the first row. Growth measures from it.
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
  /** Checking + savings: the liquid money (the house fund). */
  cashTotal: number;
  cashChange: number | null;
};

/** Paycheck money flowing into one account (ATLAS deductions linked to it). */
export type AccountContributions = {
  /** Aligned to `months`: contributed since the starting point (0 at index 0). */
  cumulative: number[];
  /** Per month at the newest row, split by who pays it. */
  you: number;
  employer: number;
  /** The deductions feeding it, e.g. ["401K"]. */
  names: string[];
};

/** Money that moved through one account in the window, from transactions. */
export type AccountFlows = {
  /** Aligned to `months`: transferred in / out since the starting point. */
  movedIn: number[];
  movedOut: number[];
  /** Income that landed in the account, by tag (null = untagged), biggest first. */
  landed: { tag: string | null; amount: number }[];
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
  /** Checking + savings per month. */
  cash: number[];
  /** Calendar months inside the window that were never logged. */
  missingMonths: string[];
  /** Last month, once it has closed and is not logged yet (the 1st-of-month ritual). */
  dueMonth: string | null;
  /** "YYYY-MM" → { accountId: balance } over ALL history, for the log dialog's prefill. */
  balancesByMonth: Record<string, Record<number, number | null>>;
  /** Average monthly change over the last 6 and 12 months of ALL history. */
  pace: { short: Pace | null; long: Pace | null };
  stats: NetWorthStats | null;
  /** By account id, only for accounts some deduction lands in. */
  contributions: Record<number, AccountContributions>;
  /** By account id, only for accounts with transfers or income in the window. */
  flows: Record<number, AccountFlows>;
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
  const [snaps, plans, linked] = await Promise.all([
    accountIds.length
      ? db
          .select()
          .from(accountSnapshots)
          .where(inArray(accountSnapshots.accountId, accountIds))
          .orderBy(asc(accountSnapshots.month))
      : Promise.resolve([]),
    db
      .select()
      .from(compensationPlans)
      .where(profileInGroup(compensationPlans.profileId, groupId))
      .orderBy(asc(compensationPlans.startDate), asc(compensationPlans.id)),
    db
      .select()
      .from(incomeDeductions)
      .where(
        and(
          profileInGroup(incomeDeductions.profileId, groupId),
          isNotNull(incomeDeductions.depositAccountId),
        ),
      )
      .orderBy(asc(incomeDeductions.startDate), asc(incomeDeductions.id)),
  ]);

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
  const cashIds = new Set(accounts.filter((a) => CASH_KINDS.includes(a.kind)).map((a) => a.id));
  const cash = months.map((m) => {
    let sum = 0;
    for (const [id, v] of byMonth.get(m) ?? []) if (cashIds.has(id)) sum += v;
    return round2(sum);
  });

  // Cumulative vs the starting point (months[0]).
  const cumulative = totals.map((v, i) => (i === 0 ? null : round2(v - totals[0])));

  const missingMonths: string[] = [];
  if (months.length > 1) {
    const logged = new Set(months);
    for (let m = addMonths(months[0], 1); m < months[months.length - 1]; m = addMonths(m, 1)) {
      if (!logged.has(m)) missingMonths.push(m);
    }
  }

  const contributions = contributionsFor(months, accounts, plans, linked);
  const flows = await flowsFor(groupId, months, accounts);

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
          cashTotal: cash[last],
          cashChange: last > 0 ? round2(cash[last] - cash[0]) : null,
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
    cash,
    missingMonths,
    dueMonth,
    balancesByMonth,
    pace,
    stats,
    contributions,
    flows,
    firstLogged: allMonths[0] ?? null,
  };
}

/**
 * Transfers and income per account across the window, by the month they
 * posted: the same (starting point, newest] span the snapshots cover.
 */
async function flowsFor(
  groupId: number,
  months: string[],
  accounts: FinancialAccount[],
): Promise<Record<number, AccountFlows>> {
  if (months.length < 2 || accounts.length === 0) return {};
  const ids = accounts.map((a) => a.id);
  const rows = await db
    .select({
      postedOn: transactions.postedOn,
      amount: transactions.amount,
      category: transactions.category,
      accountId: transactions.accountId,
      transferAccountId: transactions.transferAccountId,
      tag: transactions.spendCategory,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.groupId, groupId),
        eq(transactions.needsReview, false),
        inArray(transactions.category, ["income", "transfer"]),
        gte(transactions.postedOn, addMonths(months[0], 1)),
        lte(transactions.postedOn, lastDayOfMonth(months[months.length - 1])),
        or(inArray(transactions.accountId, ids), inArray(transactions.transferAccountId, ids)),
      ),
    );

  const round2 = (n: number) => Math.round(n * 100) / 100;
  const out: Record<number, AccountFlows> = {};
  const get = (id: number) =>
    (out[id] ??= { movedIn: months.map(() => 0), movedOut: months.map(() => 0), landed: [] });
  const landed = new Map<number, Map<string | null, number>>();
  // A posting counts toward every logged month at or after its own month.
  const addFrom = (series: number[], postedOn: string, amount: number) => {
    const m = `${postedOn.slice(0, 7)}-01`;
    for (let i = 1; i < months.length; i++) if (months[i] >= m) series[i] += amount;
  };
  for (const r of rows) {
    const amount = Number(r.amount);
    if (r.category === "transfer") {
      if (r.transferAccountId != null && ids.includes(r.transferAccountId)) {
        addFrom(get(r.transferAccountId).movedIn, r.postedOn, amount);
      }
      if (r.accountId != null && ids.includes(r.accountId)) {
        addFrom(get(r.accountId).movedOut, r.postedOn, amount);
      }
    } else if (r.accountId != null && ids.includes(r.accountId)) {
      get(r.accountId);
      const byTag = landed.get(r.accountId) ?? new Map<string | null, number>();
      byTag.set(r.tag, (byTag.get(r.tag) ?? 0) + amount);
      landed.set(r.accountId, byTag);
    }
  }
  for (const [id, f] of Object.entries(out)) {
    f.movedIn = f.movedIn.map(round2);
    f.movedOut = f.movedOut.map(round2);
    f.landed = [...(landed.get(Number(id)) ?? [])]
      .map(([tag, amount]) => ({ tag, amount: round2(amount) }))
      .sort((a, b) => b.amount - a.amount);
  }
  return out;
}

/**
 * Paycheck contributions per account across the window, with ATLAS's own math
 * (the plan and deductions in effect on each payday). Semimonthly pay lands on
 * the 15th and the last day, and money from a month-end payday reaches the
 * account days later, in the NEXT month (the HSA shows the Sep 30 paycheck
 * arriving Oct 1). So a month gets last month's final paycheck plus its own
 * mid-month one. Other cadences fall back to the monthly average.
 */
function contributionsFor(
  months: string[],
  accounts: FinancialAccount[],
  plans: (typeof compensationPlans.$inferSelect)[],
  linked: (typeof incomeDeductions.$inferSelect)[],
): Record<number, AccountContributions> {
  const shown = new Set(accounts.map((a) => a.id));
  const rows = linked.filter((d) => d.depositAccountId != null && shown.has(d.depositAccountId));
  if (!rows.length || months.length === 0) return {};
  const people = [...new Set(rows.map((d) => d.profileId))];

  type Split = Map<number, { you: number; employer: number }>;
  const add = (out: Split, d: (typeof rows)[number], c: number) => {
    const e = out.get(d.depositAccountId!) ?? { you: 0, employer: 0 };
    if (d.source === "employer") e.employer += c;
    else e.you += c;
    out.set(d.depositAccountId!, e);
  };
  // One payday's deductions, in cents, as of `date`; `times` scales the average fallback.
  const payday = (out: Split, profileId: number, date: string, times = 1) => {
    const plan = effectiveAt(plans.filter((p) => p.profileId === profileId), date).at(-1);
    if (!plan) return;
    const grossC = Math.round(Number(plan.grossPerPaycheck) * 100);
    for (const d of effectiveAt(rows.filter((r) => r.profileId === profileId), date)) {
      add(out, d, deductionPerCheckC(d, grossC) * times);
    }
  };

  // accountId → { you, employer } cents that LANDED during one calendar month.
  const landedIn = (month: string) => {
    const out: Split = new Map();
    const monthEnd = lastDayOfMonth(month);
    for (const profileId of people) {
      const plan = effectiveAt(plans.filter((p) => p.profileId === profileId), monthEnd).at(-1);
      const freq = plan?.payFrequency;
      if (freq === "semimonthly" || freq === "monthly") {
        payday(out, profileId, lastDayOfMonth(addMonths(month, -1)));
        if (freq === "semimonthly") payday(out, profileId, `${month.slice(0, 7)}-15`);
      } else if (plan) {
        payday(out, profileId, monthEnd, (PAYCHECKS_PER_YEAR[plan.payFrequency] ?? 24) / 12);
      }
    }
    return out;
  };

  // The steady monthly rate at a month's end (what "adds $X/mo" reports).
  const rateOf = (month: string) => {
    const out: Split = new Map();
    const monthEnd = lastDayOfMonth(month);
    for (const profileId of people) {
      const plan = effectiveAt(plans.filter((p) => p.profileId === profileId), monthEnd).at(-1);
      if (plan) payday(out, profileId, monthEnd, (PAYCHECKS_PER_YEAR[plan.payFrequency] ?? 24) / 12);
    }
    return out;
  };

  const ids = [...new Set(rows.map((d) => d.depositAccountId!))];
  const running = new Map(ids.map((id) => [id, 0]));
  const cumulative = new Map(ids.map((id) => [id, months.map(() => 0)]));
  let i = 1;
  for (let m = addMonths(months[0], 1); m <= months[months.length - 1]; m = addMonths(m, 1)) {
    for (const [id, e] of landedIn(m)) running.set(id, (running.get(id) ?? 0) + e.you + e.employer);
    if (m === months[i]) {
      for (const id of ids) cumulative.get(id)![i] = Math.round(running.get(id)!) / 100;
      i++;
    }
  }

  const latest = rateOf(months[months.length - 1]);
  const out: Record<number, AccountContributions> = {};
  for (const id of ids) {
    const e = latest.get(id) ?? { you: 0, employer: 0 };
    out[id] = {
      cumulative: cumulative.get(id)!,
      you: Math.round(e.you) / 100,
      employer: Math.round(e.employer) / 100,
      names: [...new Set(rows.filter((d) => d.depositAccountId === id).map((d) => d.name))],
    };
  }
  return out;
}

export type NetWorthExtras = {
  runway: {
    cash: number; // checking + savings, newest row
    brokerage: number; // brokerage accounts, newest row
    avgOut: number | null; // average money out per month, last full months
    avgOutMonths: number;
    bills: number; // ATLAS recurring bills, monthly
  } | null;
};

/** Cross-app numbers: the budget's spending and ATLAS bills next to the balances. */
export async function getNetWorthExtrasForGroup(
  groupId: number,
  dash: NetWorthDashboard,
  today: string,
): Promise<NetWorthExtras> {
  const { months } = dash;
  const last = months.length - 1;
  const thisMonth = `${today.slice(0, 7)}-01`;

  const [outMonths, atlas] = await Promise.all([
    cashFlowByMonth(groupId, {
      from: addMonths(thisMonth, -6),
      to: lastDayOfMonth(addMonths(thisMonth, -1)),
    }),
    getAtlasViewForGroup(groupId, undefined, today),
  ]);

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
  const cash = latestBalance((a) => CASH_KINDS.includes(a.kind));
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

  return { runway };
}
