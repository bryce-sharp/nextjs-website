import "server-only";
import { and, asc, desc, eq, gte, inArray, lt, lte, isNull, isNotNull, ne, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  transactions,
  recurringExpenses,
  funds,
  profiles,
  type Transaction,
} from "@/lib/db/schema";
import { computeBudgetMonth, type EngineTxn, type BudgetComputation } from "@/lib/finance/budget-engine";
import { getAtlasViewForGroup } from "@/lib/queries/finance-atlas";
import { lastDayOfMonth, todayISO, currentMonthISO } from "@/lib/finance/parse";
import { requireGroupId } from "@/lib/session";
import { getGroupTimezone } from "@/lib/queries/group";
import {
  cashFlowByCategory,
  cashFlowByMonthAndCategory,
  dailyMoneyOut,
  type CategoryFlow,
} from "@/lib/queries/finance-cashflow";
import {
  buildMonthReport,
  sumReportInputs,
  type MonthReport,
  type MonthReportInput,
} from "@/lib/finance/month-report";
import { formatMonth } from "@/lib/format";

// ─────────────────────────────────────────────────────────────────────────────
// BUDGET reads. The engine (lib/finance/budget-engine) is pure; this layer
// gathers a month's inputs — ATLAS discretion-left, effective recurring bills,
// the month's transactions, and fund draw-history — and runs it. Group-scoped
// via an explicit groupId so BOTH the session page and the token-authed widget
// route can call it (the widget has no session, same split as the ATLAS core).
// ─────────────────────────────────────────────────────────────────────────────

const cents = (v: string | number | null | undefined): number =>
  v == null ? 0 : Math.round(Number(v) * 100);

function monthBounds(month: string): { start: string; end: string } {
  return { start: `${month.slice(0, 7)}-01`, end: lastDayOfMonth(month) };
}

export type BudgetView = {
  computation: BudgetComputation;
  month: string;
  /** Is any compensation effective this month? False → budget is "unconfigured"
   *  (income 0 − bills = a misleading negative), so the page shows a note. */
  hasIncome: boolean;
  /** The ATLAS plan behind the budget, in cents (the month report's "planned"). */
  plan: {
    monthlyNetC: number;
    billsC: number;
    savingsGoalC: number;
    paycheckSavingsC: number;
    /** What paychecks have saved so far: all of it once the month is over. */
    paycheckSavedSoFarC: number;
  };
};

/**
 * Compute a month for a group — ALWAYS live. There's no freeze/snapshot: config
 * is effective-dated, so a past month already reads the pay & bills that were
 * true then, and a later raise can't rewrite it. That also means every month
 * stays freely editable (backfill a forgotten charge anytime). `today` is the
 * pace anchor (only meaningful for the current month).
 */
export async function getBudgetMonthForGroup(
  groupId: number,
  month: string,
  today: string,
): Promise<BudgetView> {
  const { start, end } = monthBounds(month);

  // ATLAS discretion-left for this month's effective config (the budget base).
  // Pass `today` so its point-in-time asOf uses the household's zone, not UTC.
  const atlas = await getAtlasViewForGroup(groupId, month, today);
  const discretionaryBudgetC = cents(atlas.totals.discretionLeft);
  const hasIncome = atlas.totals.monthlyNet > 0;

  // Effective recurring bills + their last matched payment BEFORE this month.
  const bills = await db
    .select()
    .from(recurringExpenses)
    .where(
      and(
        eq(recurringExpenses.groupId, groupId),
        lte(recurringExpenses.startDate, end),
        or(isNull(recurringExpenses.endDate), gte(recurringExpenses.endDate, start)),
      ),
    );

  const priorPaid = await db
    .select({
      recurringExpenseId: transactions.recurringExpenseId,
      postedOn: transactions.postedOn,
    })
    .from(transactions)
    .where(
      and(eq(transactions.groupId, groupId), lt(transactions.postedOn, start)),
    )
    .orderBy(desc(transactions.postedOn));
  const lastPaidBy = new Map<number, string>();
  for (const p of priorPaid) {
    if (p.recurringExpenseId != null && !lastPaidBy.has(p.recurringExpenseId)) {
      lastPaidBy.set(p.recurringExpenseId, p.postedOn);
    }
  }
  const viewedMonthNum = Number(month.slice(5, 7));

  const recurring = bills.map((b) => {
    const perOccurrenceC = cents(b.amount);
    return {
      id: b.id,
      name: b.name,
      perOccurrenceC,
      monthlyC: Math.round((perOccurrenceC * b.paymentsPerYear) / 12),
      paymentsPerYear: b.paymentsPerYear,
      isEstimate: b.isEstimate,
      dueThisMonth:
        b.paymentsPerYear === 12 ||
        (b.dueMonths?.includes(viewedMonthNum) ?? false),
      lastActualOn: lastPaidBy.get(b.id) ?? null,
      startDate: b.startDate,
    };
  });

  // This month's transactions.
  const monthTxns = await db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.groupId, groupId),
        gte(transactions.postedOn, start),
        lte(transactions.postedOn, end),
      ),
    )
    .orderBy(asc(transactions.postedOn), asc(transactions.id));
  const engineTxns: EngineTxn[] = monthTxns.map((t) => ({
    id: t.id,
    postedOn: t.postedOn,
    amountC: cents(t.amount),
    category: t.category as EngineTxn["category"],
    recurringExpenseId: t.recurringExpenseId,
    fundId: t.fundId,
    needsReview: t.needsReview,
  }));

  // Funds + what moved them before this month: purchases draw, income put in adds.
  const groupFunds = await db
    .select({
      id: funds.id,
      name: funds.name,
      startingBalance: funds.startingBalance,
      ownerName: profiles.name,
    })
    .from(funds)
    .leftJoin(profiles, eq(funds.ownerProfileId, profiles.id))
    .where(and(eq(funds.groupId, groupId), isNull(funds.closedAt)));

  const priorFundDraws = await db
    .select({ fundId: transactions.fundId, amount: transactions.amount, category: transactions.category })
    .from(transactions)
    .where(
      and(
        eq(transactions.groupId, groupId),
        inArray(transactions.category, ["fund", "income"]),
        isNotNull(transactions.fundId),
        lt(transactions.postedOn, start),
      ),
    );
  const drawnBefore = new Map<number, number>();
  for (const d of priorFundDraws) {
    if (d.fundId != null) {
      const c = d.category === "income" ? -cents(d.amount) : cents(d.amount);
      drawnBefore.set(d.fundId, (drawnBefore.get(d.fundId) ?? 0) + c);
    }
  }

  const engineFunds = groupFunds.map((f) => ({
    id: f.id,
    name: f.name,
    ownerName: f.ownerName,
    startingBalanceC: cents(f.startingBalance),
    drawnBeforeC: drawnBefore.get(f.id) ?? 0,
  }));

  const computation = computeBudgetMonth({
    month: start,
    today,
    discretionaryBudgetC,
    recurring,
    txns: engineTxns,
    funds: engineFunds,
  });

  return {
    computation,
    month: start,
    hasIncome,
    plan: {
      monthlyNetC: cents(atlas.totals.monthlyNet),
      billsC: cents(atlas.totals.fixedMonthly),
      savingsGoalC: cents(atlas.totals.savingsGoal),
      paycheckSavingsC: cents(atlas.totals.savingsFromPaycheck),
      paycheckSavedSoFarC: paycheckSavedSoFarC(
        atlas.totals.paycheckSavingsChecks,
        cents(atlas.totals.savingsFromPaycheck),
        computation.dayOfMonth,
        computation.daysInMonth,
      ),
    },
  };
}

/**
 * Paycheck savings that have happened by `day` of the month. Semimonthly pay
 * lands on the 15th and the last day, monthly on the last day; other cadences
 * accrue evenly. A finished month (day = last day) always counts the full plan.
 */
function paycheckSavedSoFarC(
  checks: { payFrequency: string; perCheck: number }[],
  planC: number,
  day: number,
  daysInMonth: number,
): number {
  if (day >= daysInMonth) return planC;
  let c = 0;
  for (const ch of checks) {
    const perC = cents(ch.perCheck);
    if (ch.payFrequency === "semimonthly") c += day >= 15 ? perC : 0;
    else if (ch.payFrequency !== "monthly") c += Math.round((perC * (ch.payFrequency === "weekly" ? 52 : 26) * day) / 12 / daysInMonth);
  }
  return Math.min(c, planC);
}

/** A month's report inputs from its computation + cash-flow lanes (null = no plan). */
function monthReportInput(view: BudgetView, lanes: CategoryFlow[]): MonthReportInput | null {
  if (!view.hasIncome) return null;
  const dl = (c: number) => Math.round(c) / 100;
  const out = (c: string) => lanes.find((l) => l.category === c)?.moneyOut ?? 0;
  const inn = (c: string) => lanes.find((l) => l.category === c)?.moneyIn ?? 0;
  const disc = view.computation.discretionary;
  return {
    plan: {
      moneyIn: dl(view.plan.monthlyNetC),
      bills: dl(view.plan.billsC),
      discretionary: dl(disc.budgetC),
      savingsGoal: dl(view.plan.savingsGoalC),
      estimateAdjustment: dl(disc.estimateAdjustmentC),
      paycheckSavings: dl(view.plan.paycheckSavingsC),
    },
    actual: {
      income: inn("income"),
      // Reimbursements net against money out, so their lane's money out is negative.
      reimbursed: -out("reimbursement"),
      discretionary: out("discretionary"),
      bills: out("fixed") + out("amortized"),
      offBudget: out("savings"),
      funds: out("fund"),
      paycheckSavings: dl(view.plan.paycheckSavedSoFarC),
    },
  };
}

/** The month report from a computed month + its cash-flow lanes (null = no plan).
 *  A month is in progress while its pace day is short of its last day. */
export function monthReportFrom(view: BudgetView, lanes: CategoryFlow[]): MonthReport | null {
  const input = monthReportInput(view, lanes);
  if (!input) return null;
  return buildMonthReport(input, {
    inProgress: view.computation.dayOfMonth < view.computation.daysInMonth,
  });
}

export type RangeReport = {
  report: MonthReport;
  /** First/last month covered (YYYY-MM-01) and how many months that is. */
  first: string;
  last: string;
  months: number;
  /** The current month sat inside the range but was left out (in progress). */
  skippedCurrent: boolean;
};

/**
 * The plan-vs-actual report summed across a range: every WHOLE, finished month
 * inside [from, to] that has transactions and an ATLAS plan. The month in
 * progress is left out (its unposted bills and paychecks would read as misses),
 * as are partial months at a custom range's edges.
 */
export async function getRangeReportForGroup(
  groupId: number,
  from: string | undefined,
  to: string | undefined,
  today: string,
): Promise<RangeReport | null> {
  const current = `${today.slice(0, 7)}-01`;
  const inRange = (m: string) =>
    (!from || m >= from) && (!to || lastDayOfMonth(m) <= to);
  const withData = (await listBudgetMonthsForGroup(groupId)).filter(inRange);
  const months = withData.filter((m) => m < current);
  if (months.length === 0) return null;

  const [views, lanes] = await Promise.all([
    Promise.all(months.map((m) => getBudgetMonthForGroup(groupId, m, today))),
    cashFlowByMonthAndCategory(groupId, { from: months[0], to: lastDayOfMonth(months.at(-1)!) }),
  ]);
  const covered: string[] = [];
  const inputs: MonthReportInput[] = [];
  months.forEach((m, i) => {
    const input = monthReportInput(views[i], lanes.filter((l) => l.month === m));
    if (input) {
      inputs.push(input);
      covered.push(m);
    }
  });
  if (inputs.length === 0) return null;

  return {
    report: buildMonthReport(sumReportInputs(inputs)),
    first: covered[0],
    last: covered.at(-1)!,
    months: covered.length,
    skippedCurrent: withData.includes(current),
  };
}

/** One month's plan-vs-actual report for a group (History's drill-down). */
export async function getMonthReportForGroup(
  groupId: number,
  month: string,
  today: string,
): Promise<MonthReport | null> {
  const { start, end } = monthBounds(month);
  const [view, lanes] = await Promise.all([
    getBudgetMonthForGroup(groupId, start, today),
    cashFlowByCategory(groupId, { from: start, to: end }),
  ]);
  return monthReportFrom(view, lanes);
}

// ── Session wrappers (the budget page; the API routes use the …ForGroup core) ─
export async function getBudgetMonth(month: string): Promise<BudgetView> {
  const groupId = await requireGroupId();
  return getBudgetMonthForGroup(groupId, month, todayISO(await getGroupTimezone(groupId)));
}

export async function listMonthTransactionsForSession(
  month: string,
): Promise<Transaction[]> {
  return listMonthTransactions(await requireGroupId(), month);
}

export type RecentMonth = {
  month: string; // YYYY-MM-01
  spent: number; // discretionary net, dollars
  budget: number; // discretionary budget, dollars
  remaining: number;
};

/**
 * The few months with data just BEFORE `month` (the one being viewed — so a
 * past month shows its own lead-up, not today's), newest first, each computed
 * the same way the page does.
 */
export async function listRecentMonths(month: string, limit = 3): Promise<RecentMonth[]> {
  const groupId = await requireGroupId();
  const tz = await getGroupTimezone(groupId);
  const viewed = `${month.slice(0, 7)}-01`;
  const past = (await listBudgetMonths()).filter((m) => m < viewed);
  const recent = past.slice(-limit).reverse(); // newest first
  const dl = (c: number) => Math.round(c) / 100;

  const out: RecentMonth[] = [];
  for (const m of recent) {
    const v = await getBudgetMonthForGroup(groupId, m, todayISO(tz));
    out.push({
      month: m,
      spent: dl(v.computation.discretionary.netSpentC),
      budget: dl(v.computation.discretionary.budgetC),
      remaining: dl(v.computation.discretionary.remainingC),
    });
  }
  return out;
}

/** A bill version for the bill-pickers; its dates let a picker offer only the version in effect. */
export type BillOption = {
  id: number;
  name: string;
  paymentsPerYear: number;
  startDate: string;
  endDate: string | null;
};

const billOptionColumns = {
  id: recurringExpenses.id,
  name: recurringExpenses.name,
  paymentsPerYear: recurringExpenses.paymentsPerYear,
  startDate: recurringExpenses.startDate,
  endDate: recurringExpenses.endDate,
};

/** Recurring bills effective in a month, for the txn detail bill-picker. */
export async function listBillsForMonth(month: string): Promise<BillOption[]> {
  const groupId = await requireGroupId();
  const { start, end } = monthBounds(month);
  return db
    .select(billOptionColumns)
    .from(recurringExpenses)
    .where(
      and(
        eq(recurringExpenses.groupId, groupId),
        lte(recurringExpenses.startDate, end),
        or(isNull(recurringExpenses.endDate), gte(recurringExpenses.endDate, start)),
      ),
    )
    .orderBy(asc(recurringExpenses.name));
}

/** Every version of every bill, for the explorer's bill-picker (its rows span all months). */
export async function listBills(): Promise<BillOption[]> {
  const groupId = await requireGroupId();
  return db
    .select(billOptionColumns)
    .from(recurringExpenses)
    .where(eq(recurringExpenses.groupId, groupId))
    .orderBy(asc(recurringExpenses.name));
}

/** Open funds, for the explorer's fund-picker and "→ fund" row labels. */
export async function listOpenFunds(): Promise<{ id: number; name: string }[]> {
  const groupId = await requireGroupId();
  return db
    .select({ id: funds.id, name: funds.name })
    .from(funds)
    .where(and(eq(funds.groupId, groupId), isNull(funds.closedAt)))
    .orderBy(asc(funds.name));
}

/**
 * Distinct merchant labels used before, most-used first, for the add/edit
 * type-ahead: expense MERCHANTS and income SOURCES kept separate so grandma
 * never suggests while logging gas. Free typing still adds anything new.
 */
export async function listMerchantSuggestions(): Promise<{
  merchants: string[];
  sources: string[];
}> {
  const groupId = await requireGroupId();
  const grab = async (income: boolean, limit: number) => {
    const rows = await db
      .select({ merchant: transactions.merchant })
      .from(transactions)
      .where(
        and(
          eq(transactions.groupId, groupId),
          isNotNull(transactions.merchant),
          income
            ? eq(transactions.category, "income")
            : ne(transactions.category, "income"),
        ),
      )
      .groupBy(transactions.merchant)
      .orderBy(desc(sql`count(*)`))
      .limit(limit);
    return rows.map((r) => r.merchant).filter((m): m is string => !!m);
  };
  const [merchants, sources] = await Promise.all([grab(false, 500), grab(true, 100)]);
  return { merchants, sources };
}

/** Months that have transactions — session-less core (for the token endpoint). */
export async function listBudgetMonthsForGroup(groupId: number): Promise<string[]> {
  const txnMonths = await db
    .selectDistinct({ m: transactions.postedOn })
    .from(transactions)
    .where(eq(transactions.groupId, groupId));
  const set = new Set<string>();
  for (const r of txnMonths) set.add(`${r.m.slice(0, 7)}-01`);
  return [...set].sort();
}

/** Months that have transactions (drives the month switcher). */
export async function listBudgetMonths(): Promise<string[]> {
  return listBudgetMonthsForGroup(await requireGroupId());
}

export type RecentMonthBar = { month: string; spent: number; budget: number };

/**
 * The last few completed months as DISCRETIONARY spent-vs-budget — the widget's
 * "Recent Months" list. Discretionary (not whole-household) so it's coherent
 * with the widget's "left to spend" framing. Session-less for the token route.
 */
export async function listRecentMonthsForGroup(
  groupId: number,
  limit: number,
  today: string,
): Promise<RecentMonthBar[]> {
  const current = `${today.slice(0, 7)}-01`;
  const past = (await listBudgetMonthsForGroup(groupId)).filter((m) => m < current);
  const recent = past.slice(-limit).reverse(); // newest first
  const dl = (c: number) => Math.round(c) / 100;
  const out: RecentMonthBar[] = [];
  for (const m of recent) {
    const { computation: c } = await getBudgetMonthForGroup(groupId, m, today);
    out.push({
      month: m,
      spent: dl(c.discretionary.netSpentC),
      budget: dl(c.discretionary.budgetC),
    });
  }
  return out;
}

export type SpendTrend = {
  days: number[]; // 1..daysInViewedMonth (shared x-axis)
  thisMonth: (number | null)[]; // cumulative discretionary net; null after today
  lastMonth: (number | null)[]; // cumulative discretionary net for the prior month
  thisLabel: string;
  lastLabel: string;
};

/**
 * Cumulative spend by day-of-month for the viewed month and the one before it —
 * the "how am I tracking vs last month" curve. `discretionary` = net of
 * reimbursements (matches the pace headline); `all` = every dollar out, per the
 * cash-flow definition. The current month's line stops at today (nulls after)
 * so the gap is read at the same day-of-month.
 */
export async function getSpendTrend(
  month: string,
  lane: "discretionary" | "all" = "discretionary",
): Promise<SpendTrend> {
  const groupId = await requireGroupId();
  const tz = await getGroupTimezone(groupId);
  const today = todayISO(tz);

  const cur = `${month.slice(0, 7)}-01`;
  const y = Number(cur.slice(0, 4));
  const mo = Number(cur.slice(5, 7));
  const prev = `${mo === 1 ? y - 1 : y}-${String(mo === 1 ? 12 : mo - 1).padStart(2, "0")}-01`;
  const curDays = Number(lastDayOfMonth(cur).slice(8, 10));
  const prevDays = Number(lastDayOfMonth(prev).slice(8, 10));
  const curPrefix = cur.slice(0, 7);
  const prevPrefix = prev.slice(0, 7);

  // Per-day signed cents; for discretionary, reimbursements pull the total down.
  const signedRows =
    lane === "all"
      ? (await dailyMoneyOut(groupId, prev, lastDayOfMonth(cur))).map((r) => ({
          postedOn: r.postedOn,
          signed: cents(r.amount),
        }))
      : (
          await db
            .select({
              postedOn: transactions.postedOn,
              amount: transactions.amount,
              category: transactions.category,
            })
            .from(transactions)
            .where(
              and(
                eq(transactions.groupId, groupId),
                gte(transactions.postedOn, prev),
                lte(transactions.postedOn, lastDayOfMonth(cur)),
                or(
                  eq(transactions.category, "discretionary"),
                  eq(transactions.category, "reimbursement"),
                ),
              ),
            )
        ).map((r) => ({
          postedOn: r.postedOn,
          signed: r.category === "reimbursement" ? -cents(r.amount) : cents(r.amount),
        }));

  const curDaily = new Array<number>(curDays + 1).fill(0);
  const prevDaily = new Array<number>(prevDays + 1).fill(0);
  for (const r of signedRows) {
    const day = Number(r.postedOn.slice(8, 10));
    const prefix = r.postedOn.slice(0, 7);
    if (prefix === curPrefix && day >= 1 && day <= curDays) curDaily[day] += r.signed;
    else if (prefix === prevPrefix && day >= 1 && day <= prevDays) prevDaily[day] += r.signed;
  }

  // Only cap at "today" when the viewed month IS the current one.
  const capDay = today.slice(0, 7) === curPrefix ? Number(today.slice(8, 10)) : curDays;
  const dl = (c: number) => Math.round(c) / 100;

  const days: number[] = [];
  const thisMonth: (number | null)[] = [];
  const lastMonth: (number | null)[] = [];
  let runCur = 0;
  let runPrev = 0;
  for (let dnum = 1; dnum <= curDays; dnum++) {
    days.push(dnum);
    runCur += curDaily[dnum];
    thisMonth.push(dnum <= capDay ? dl(runCur) : null);
    if (dnum <= prevDays) {
      runPrev += prevDaily[dnum];
      lastMonth.push(dl(runPrev));
    } else {
      lastMonth.push(null);
    }
  }

  return { days, thisMonth, lastMonth, thisLabel: formatMonth(cur), lastLabel: formatMonth(prev) };
}

/** Raw transaction rows for a month (the editable table). */
export async function listMonthTransactions(
  groupId: number,
  month: string,
): Promise<Transaction[]> {
  const { start, end } = monthBounds(month);
  return db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.groupId, groupId),
        gte(transactions.postedOn, start),
        lte(transactions.postedOn, end),
      ),
    )
    .orderBy(desc(transactions.postedOn), desc(transactions.id));
}
