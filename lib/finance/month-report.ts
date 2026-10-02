// A month's budget report: the plan (ATLAS pay, bills, discretionary budget,
// savings goal) against what actually happened, line by line, built so the
// line differences add up EXACTLY to what you kept vs the goal. Savings
// counts every account you own, so the paycheck's 401k/HSA money sits on top.
// Its actual is the ATLAS plan for the paydays that have passed, so a finished
// month matches the plan and never moves the gap. Discretionary
// matches the Budget page (net of reimbursements; variable bills reconcile
// into it, so planned bills absorb the same adjustment), and money in/out
// match History's cash-flow totals. Pure — shared by History and Budget.

import { formatMoney } from "@/lib/format";

export type MonthReportInput = {
  plan: {
    moneyIn: number; // ATLAS monthly net pay
    bills: number; // ATLAS fixed + amortized, monthly-normalized
    discretionary: number; // the Budget page's budget (incl. the adjustment)
    savingsGoal: number; // the take-home part
    estimateAdjustment: number; // Σ(estimate − actual) for posted variable bills
    paycheckSavings: number; // 401k/HSA deductions into your accounts
  };
  actual: {
    income: number;
    reimbursed: number;
    discretionary: number; // gross (refunds netted), before reimbursements
    bills: number; // fixed + amortized rows
    offBudget: number;
    funds: number; // fund purchases (deposits excluded)
    paycheckSavings: number; // the plan's paycheck savings from paydays that have passed
  };
};

export type ReportLineKey = "in" | "bills" | "disc" | "off" | "funds";
export type ReportLine = {
  key: ReportLineKey;
  label: string;
  note?: string;
  planned: number | null; // null = nothing planned for it
  actual: number;
  /** Effect on what you kept: positive helped, negative cost you. */
  effect: number;
};
export type MonthReport = {
  lines: ReportLine[];
  kept: { goal: number; actual: number; diff: number };
  /** Kept plus the paycheck's savings, against the whole goal. */
  saved: { paycheckPlanned: number; paycheck: number; goal: number; actual: number; diff: number };
  verdict: string;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Several months as one: plans and actuals summed field by field. Each month
 *  balances on its own, so the sum balances too (Σ differences = Σ kept − Σ goals). */
export function sumReportInputs(inputs: MonthReportInput[]): MonthReportInput {
  const plan = { moneyIn: 0, bills: 0, discretionary: 0, savingsGoal: 0, estimateAdjustment: 0, paycheckSavings: 0 };
  const actual = { income: 0, reimbursed: 0, discretionary: 0, bills: 0, offBudget: 0, funds: 0, paycheckSavings: 0 };
  for (const i of inputs) {
    for (const k of Object.keys(plan) as (keyof typeof plan)[]) plan[k] = r2(plan[k] + i.plan[k]);
    for (const k of Object.keys(actual) as (keyof typeof actual)[]) actual[k] = r2(actual[k] + i.actual[k]);
  }
  return { plan, actual };
}

// How each line reads when it helped / hurt, for the verdict.
const PHRASE: Record<ReportLineKey, { hurt: string; helped: string }> = {
  in: { hurt: "money in was {x} under plan", helped: "money in was {x} over plan" },
  bills: { hurt: "bills came in {x} over plan", helped: "bills came in {x} under plan" },
  disc: { hurt: "discretionary ran {x} over budget", helped: "discretionary came in {x} under budget" },
  off: { hurt: "off-budget purchases took {x}", helped: "" },
  funds: { hurt: "fund purchases took {x}", helped: "" },
};
const phrase = (l: ReportLine, kind: "hurt" | "helped") =>
  PHRASE[l.key][kind].replace("{x}", formatMoney(Math.abs(l.effect)));
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function buildMonthReport(
  { plan, actual }: MonthReportInput,
  { inProgress = false }: { inProgress?: boolean } = {},
): MonthReport {
  const billsPlanned = r2(plan.bills - plan.estimateAdjustment);
  const discActual = r2(actual.discretionary - actual.reimbursed);
  const lines: ReportLine[] = [
    {
      key: "in",
      label: "Money in",
      // Reimbursements pay back purchases, so they net inside Discretionary.
      note: actual.reimbursed > 0 ? `excl. ${formatMoney(actual.reimbursed)} reimbursed (in Discretionary)` : undefined,
      planned: plan.moneyIn,
      actual: actual.income,
      effect: r2(actual.income - plan.moneyIn),
    },
    { key: "bills", label: "Bills", note: "fixed + amortized", planned: billsPlanned, actual: r2(actual.bills), effect: r2(billsPlanned - actual.bills) },
    {
      key: "disc",
      label: "Discretionary",
      note: actual.reimbursed > 0 ? `after ${formatMoney(actual.reimbursed)} reimbursed` : undefined,
      planned: plan.discretionary,
      actual: discActual,
      effect: r2(plan.discretionary - discActual),
    },
    { key: "off", label: "Off-budget purchases", planned: null, actual: r2(actual.offBudget), effect: r2(-actual.offBudget) },
    { key: "funds", label: "Fund purchases", planned: null, actual: r2(actual.funds), effect: r2(-actual.funds) },
  ];
  const keptActual = r2(
    actual.income + actual.reimbursed - actual.bills - actual.discretionary - actual.offBudget - actual.funds,
  );
  const diff = r2(keptActual - plan.savingsGoal);
  const saved = {
    paycheckPlanned: r2(plan.paycheckSavings),
    paycheck: r2(actual.paycheckSavings),
    goal: r2(plan.savingsGoal + plan.paycheckSavings),
    actual: r2(keptActual + actual.paycheckSavings),
    diff: r2(keptActual + actual.paycheckSavings - plan.savingsGoal - plan.paycheckSavings),
  };

  const worst = lines.reduce<ReportLine | null>((w, l) => (l.effect < (w?.effect ?? -0.5) ? l : w), null);
  const best = lines.reduce<ReportLine | null>((b, l) => (l.effect > (b?.effect ?? 0.5) ? l : b), null);
  let verdict: string;
  const disc = lines.find((l) => l.key === "disc")!;
  if (inProgress) {
    // Mid-month, unposted paychecks and bills look like misses; the live signal
    // is the discretionary pace.
    verdict = `So far this month, discretionary is ${formatMoney(Math.abs(disc.effect))} ${disc.effect >= 0 ? "under" : "over"} budget.`;
  } else if (plan.savingsGoal > 0 && diff < 0 && worst) {
    const outcome =
      saved.actual >= 0
        ? `saved ${formatMoney(saved.actual)} instead of ${formatMoney(saved.goal)}`
        : `ended ${formatMoney(-saved.actual)} down instead of saving ${formatMoney(saved.goal)}`;
    verdict = `${cap(phrase(worst, "hurt"))}, the main reason you ${outcome}.`;
  } else if (plan.savingsGoal > 0 && diff >= 0) {
    verdict = `You saved ${formatMoney(diff)} more than your goal${best && PHRASE[best.key].helped ? `, mostly because ${phrase(best, "helped")}` : ""}.`;
  } else {
    const outcome = keptActual >= 0 ? `kept ${formatMoney(keptActual)}` : `ended ${formatMoney(-keptActual)} down`;
    verdict = `You ${outcome}${worst ? `; ${phrase(worst, "hurt")}` : ""}.`;
  }

  return { lines, kept: { goal: plan.savingsGoal, actual: keptActual, diff }, saved, verdict };
}
