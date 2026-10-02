// ─────────────────────────────────────────────────────────────────────────────
// THE BUDGET ENGINE — pure math from (config effective for a month + that
// month's transactions) to the month's complete picture. No imports, no DB, no
// dates from the environment: everything arrives as plain data, so the same
// function serves the budget page, the widget endpoint, month-close snapshots,
// and direct node tests.
//
// The lanes (the gist's structure, formalized — and the cardinal rule from
// Bryce: NEVER present raw outflow vs the envelope as the score):
//   • DISCRETIONARY — the headline. spent vs budget, daily pace. Reimbursements
//     credit back. The budget is ATLAS's discretion-left, adjusted when a
//     variable bill's actual posts differently than its estimate.
//   • FIXED — monthly bills, billed-vs-expected per bill (reconciliation).
//   • AMORTIZED — non-monthly bills as sinking funds: every month reserves
//     amount×paymentsPerYear÷12; the real bill consumes the reserve, never the
//     month's discretionary.
//   • Funds draw their own pools; income and savings are tracked, never spend;
//     ignored is invisible; needs-review is surfaced, excluded from math.
//
// All money in integer CENTS.
// ─────────────────────────────────────────────────────────────────────────────

export type TxnCategory =
  | "discretionary"
  | "fixed"
  | "amortized"
  | "savings"
  | "reimbursement"
  | "fund"
  | "income"
  | "transfer"
  | "ignored";

export type EngineTxn = {
  id: number;
  postedOn: string; // YYYY-MM-DD, inside `month`
  amountC: number; // signed; negative = credit/top-up
  category: TxnCategory;
  recurringExpenseId: number | null;
  fundId: number | null;
  needsReview: boolean;
};

export type EngineRecurring = {
  id: number;
  name: string;
  /** The real bill size per occurrence. */
  perOccurrenceC: number;
  /** Monthly reservation: perOccurrence × paymentsPerYear ÷ 12 (caller rounds). */
  monthlyC: number;
  paymentsPerYear: number; // 12 = fixed lane, else amortized lane
  isEstimate: boolean;
  /** Does its dueMonths include this month (12/yr bills are always due)? */
  dueThisMonth: boolean;
  /** Most recent matched payment BEFORE this month (sinking-fund accrual). */
  lastActualOn: string | null;
  startDate: string; // fallback accrual anchor when never paid
};

export type EngineFund = {
  id: number;
  name: string;
  ownerName: string | null;
  startingBalanceC: number;
  /** Σ of ALL fund txn amounts ever, before this month (caller computes). */
  drawnBeforeC: number;
};

export type EngineInput = {
  month: string; // YYYY-MM-01
  /** Pace anchor: today when viewing the live month; ignored for past months. */
  today: string; // YYYY-MM-DD
  /** ATLAS discretion-left for this month's config, in cents (pre-adjustment). */
  discretionaryBudgetC: number;
  recurring: EngineRecurring[];
  txns: EngineTxn[]; // ONLY this month's rows
  funds: EngineFund[];
};

export type FixedRow = {
  recurringExpenseId: number;
  name: string;
  expectedC: number;
  /** Σ matched txns this month; null = nothing posted yet. */
  actualC: number | null;
  isEstimate: boolean;
  /** expected − actual (positive frees budget); any posted fixed bill. */
  deltaC: number | null;
};

export type AmortizedRow = {
  recurringExpenseId: number;
  name: string;
  monthlyC: number; // the reservation
  targetC: number; // the real bill it saves toward
  /** Reserve saved so far: monthly × months since last payment, capped. */
  accruedC: number;
  monthsAccrued: number;
  dueThisMonth: boolean;
  /** What actually posted this month (consumes the reserve); null = nothing. */
  paidThisMonthC: number | null;
};

export type BudgetComputation = {
  version: 1;
  month: string;
  daysInMonth: number;
  dayOfMonth: number; // pace basis (= daysInMonth for past months)
  discretionary: {
    baseBudgetC: number;
    estimateAdjustmentC: number; // Σ(estimate − actual) for posted estimates
    budgetC: number; // base + adjustment
    spentC: number; // Σ discretionary txns (gross)
    reimbursedC: number; // Σ reimbursement txns
    netSpentC: number; // spent − reimbursed
    remainingC: number; // budget − netSpent
    perDayC: number;
    allowedSoFarC: number; // perDay × dayOfMonth
    paceDeltaC: number; // allowedSoFar − netSpent (+ = under pace)
  };
  fixed: { expectedC: number; actualC: number; rows: FixedRow[] };
  amortized: { reservedMonthlyC: number; paidThisMonthC: number; rows: AmortizedRow[] };
  savingsC: number;
  incomeC: number;
  fundDrawsC: number; // this month's fund outflows (their pools, not the budget)
  ignoredCount: number;
  needsReviewCount: number;
  funds: { id: number; name: string; ownerName: string | null; balanceC: number; drawnThisMonthC: number }[];
  /** The gist widget's bar: every tracked outflow this month (fixed +
   *  amortized + net discretionary + savings + fund draws). Income never. */
  totalOutflowC: number;
  /** The gist's planned-spend tick: allowedSoFar + actual fixed + amortized. */
  plannedTickC: number;
  /** The detailed-view analytics (all discretionary-lane unless noted). */
  analytics: {
    todayC: number;
    yesterdayC: number;
    last7C: number;
    daysLeft: number;
    /** ceil(overspend ÷ perDay) — "days till back in the green". 0 if on pace. */
    daysToCatchUp: number;
    /** Run-rate: netSpent ÷ dayOfMonth × daysInMonth. */
    projectedSpendC: number;
  };
};

/** YYYY-MM-DD shifted by whole days (UTC noon anchor avoids DST rollovers). */
function addDaysISO(iso: string, delta: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function daysInMonthOf(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Whole months from the month of `fromISO` to `month` (exclusive→inclusive). */
function monthsBetween(fromISO: string, month: string): number {
  const [fy, fm] = fromISO.split("-").map(Number);
  const [ty, tm] = month.split("-").map(Number);
  return Math.max(0, (ty - fy) * 12 + (tm - fm));
}

export function computeBudgetMonth(input: EngineInput): BudgetComputation {
  const daysInMonth = daysInMonthOf(input.month);
  // Past month → the whole month elapsed; live month → today's day-of-month.
  const dayOfMonth = input.today.slice(0, 7) === input.month.slice(0, 7)
    ? Number(input.today.slice(8, 10))
    : daysInMonth;

  // Live txns only — review rows are surfaced, never counted.
  const txns = input.txns.filter((t) => !t.needsReview);
  const needsReviewCount = input.txns.length - txns.length;
  const sum = (cat: TxnCategory) =>
    txns.filter((t) => t.category === cat).reduce((s, t) => s + t.amountC, 0);

  const fixedRecurring = input.recurring.filter((r) => r.paymentsPerYear === 12);
  const amortizedRecurring = input.recurring.filter((r) => r.paymentsPerYear !== 12);

  // Σ matched txns per recurring bill (a bill can post in several charges).
  const actualByRecurring = new Map<number, number>();
  for (const t of txns) {
    if (t.recurringExpenseId == null) continue;
    if (t.category !== "fixed" && t.category !== "amortized") continue;
    actualByRecurring.set(
      t.recurringExpenseId,
      (actualByRecurring.get(t.recurringExpenseId) ?? 0) + t.amountC,
    );
  }

  // ── Fixed lane: billed vs expected; EVERY posted bill reconciles ─────────────
  const fixedRows: FixedRow[] = fixedRecurring.map((r) => {
    const actual = actualByRecurring.get(r.id) ?? null;
    return {
      recurringExpenseId: r.id,
      name: r.name,
      expectedC: r.monthlyC,
      actualC: actual,
      isEstimate: r.isEstimate,
      // Every fixed bill reconciles its real charge against the plan; the gap
      // frees up (or eats into) discretionary — a Spectrum overrun is real money
      // gone, same as an electric one. isEstimate is now only a display label
      // ("this one's a guess"), no longer a switch on this math.
      deltaC: actual !== null ? r.monthlyC - actual : null,
    };
  });
  // A posted actual replaces its plan; the difference flows into (or out of) the
  // discretionary budget. (Named "estimate" adjustment for history — it's now
  // every fixed bill, not just estimates.)
  const estimateAdjustmentC = fixedRows.reduce((s, r) => s + (r.deltaC ?? 0), 0);

  // ── Amortized lane: sinking funds ────────────────────────────────────────────
  const amortizedRows: AmortizedRow[] = amortizedRecurring.map((r) => {
    const paid = actualByRecurring.get(r.id) ?? null;
    // Accrue from the month AFTER the last payment (that payment reset the
    // fund); never paid → from the bill's start month, inclusive.
    const monthsAccrued = r.lastActualOn
      ? monthsBetween(r.lastActualOn, input.month)
      : monthsBetween(r.startDate, input.month) + 1;
    return {
      recurringExpenseId: r.id,
      name: r.name,
      monthlyC: r.monthlyC,
      targetC: r.perOccurrenceC,
      accruedC: Math.min(r.perOccurrenceC, r.monthlyC * monthsAccrued),
      monthsAccrued,
      dueThisMonth: r.dueThisMonth,
      paidThisMonthC: paid,
    };
  });

  // ── Discretionary lane (the headline) ────────────────────────────────────────
  const spentC = sum("discretionary");
  const reimbursedC = sum("reimbursement");
  const netSpentC = spentC - reimbursedC;
  const budgetC = input.discretionaryBudgetC + estimateAdjustmentC;
  const perDayC = Math.round(budgetC / daysInMonth);
  const allowedSoFarC = Math.round((budgetC / daysInMonth) * dayOfMonth);

  const fixedActualC = fixedRows.reduce((s, r) => s + (r.actualC ?? 0), 0);
  const amortizedPaidC = amortizedRows.reduce((s, r) => s + (r.paidThisMonthC ?? 0), 0);
  const savingsC = sum("savings");
  const incomeC = sum("income");
  const fundDrawsC = sum("fund");

  // Time-period discretionary spend (gross, by posted date) for the detail view.
  const discRows = txns.filter((t) => t.category === "discretionary");
  const spentOn = (iso: string) =>
    discRows.filter((t) => t.postedOn === iso).reduce((s, t) => s + t.amountC, 0);
  const weekStart = addDaysISO(input.today, -6);
  const last7C = discRows
    .filter((t) => t.postedOn >= weekStart && t.postedOn <= input.today)
    .reduce((s, t) => s + t.amountC, 0);
  const daysLeft = Math.max(0, daysInMonth - dayOfMonth);
  const paceDeltaC = allowedSoFarC - netSpentC;
  const daysToCatchUp =
    paceDeltaC < 0 && perDayC > 0 ? Math.ceil(-paceDeltaC / perDayC) : 0;
  const projectedSpendC = dayOfMonth > 0 ? Math.round((netSpentC / dayOfMonth) * daysInMonth) : 0;

  const funds = input.funds.map((f) => {
    const drawnThisMonthC = txns
      .filter((t) => t.category === "fund" && t.fundId === f.id)
      .reduce((s, t) => s + t.amountC, 0);
    return {
      id: f.id,
      name: f.name,
      ownerName: f.ownerName,
      balanceC: f.startingBalanceC - f.drawnBeforeC - drawnThisMonthC,
      drawnThisMonthC,
    };
  });

  return {
    version: 1,
    month: input.month,
    daysInMonth,
    dayOfMonth,
    discretionary: {
      baseBudgetC: input.discretionaryBudgetC,
      estimateAdjustmentC,
      budgetC,
      spentC,
      reimbursedC,
      netSpentC,
      remainingC: budgetC - netSpentC,
      perDayC,
      allowedSoFarC,
      paceDeltaC: allowedSoFarC - netSpentC,
    },
    fixed: {
      expectedC: fixedRows.reduce((s, r) => s + r.expectedC, 0),
      actualC: fixedActualC,
      rows: fixedRows,
    },
    amortized: {
      reservedMonthlyC: amortizedRows.reduce((s, r) => s + r.monthlyC, 0),
      paidThisMonthC: amortizedPaidC,
      rows: amortizedRows,
    },
    savingsC,
    incomeC,
    fundDrawsC,
    ignoredCount: txns.filter((t) => t.category === "ignored").length,
    needsReviewCount,
    funds,
    totalOutflowC: fixedActualC + amortizedPaidC + netSpentC + savingsC + fundDrawsC,
    plannedTickC: allowedSoFarC + fixedActualC + amortizedPaidC,
    analytics: {
      todayC: spentOn(input.today),
      yesterdayC: spentOn(addDaysISO(input.today, -1)),
      last7C,
      daysLeft,
      daysToCatchUp,
      projectedSpendC,
    },
  };
}
