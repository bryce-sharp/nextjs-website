// Which engine categories are money OUT vs money IN — the one list shared by
// the cash-flow SQL (lib/queries/finance-cashflow), the tag pickers, and the
// merchant-rule matcher. Pure and dependency-free so client code can use it.

export type Flow = "out" | "in";

/** The URL/filter key for "no tag" (a slice of its own in the breakdowns). */
export const UNTAGGED = "__none__";

/** Spend lanes that count at face value (refunds net against them). */
export const SPEND_CATEGORIES = ["discretionary", "fixed", "amortized", "savings"] as const;
/** A reimbursement pays back a purchase, so it sits on the spending side and
 *  nets against it (like a refund), never as income. */
export const REIMBURSEMENT = "reimbursement";
/** Every money-out lane: the spend lanes, fund purchases (deposits excluded),
 *  and reimbursements (negative). */
export const OUT_CATEGORIES = [...SPEND_CATEGORIES, "fund", REIMBURSEMENT] as const;
/** Money in is income only; an income row may also carry a fund it was put in. */
export const IN_CATEGORIES = ["income"] as const;

/** Each lane's name in breakdowns and the Type filter (plural: it names a group of rows). */
export const LANE_LABELS: Record<string, string> = {
  discretionary: "Discretionary",
  fixed: "Fixed bills",
  amortized: "Amortized",
  savings: "Off-budget",
  fund: "Fund purchases",
  income: "Income",
  reimbursement: "Reimbursements",
  transfer: "Transfers",
};

/** Money moved between your own accounts: never in, never out, never tagged. */
export const TRANSFER = "transfer";

/** Lanes whose tags come from the Categories-tab rules (bills inherit theirs;
 *  a reimbursement takes the tag of what it pays back, picked by hand). */
export const RULE_CATEGORIES: Record<Flow, readonly string[]> = {
  out: ["discretionary", "savings", "fund"],
  in: IN_CATEGORIES,
};

/** A row's flow by its engine category; null = Excluded (never counted or tagged). */
export function flowOf(category: string): Flow | null {
  if ((OUT_CATEGORIES as readonly string[]).includes(category)) return "out";
  if ((IN_CATEGORIES as readonly string[]).includes(category)) return "in";
  return null;
}

/** Does this row count toward money out? Fund deposits and unreadable rows
 *  don't; a reimbursement does, as a credit against it. */
export function isMoneyOut(category: string, amount: number, needsReview: boolean): boolean {
  if (needsReview) return false;
  if (category === "fund") return amount > 0;
  return category === REIMBURSEMENT || (SPEND_CATEGORIES as readonly string[]).includes(category);
}

/**
 * A fixed/amortized payment the budget can't match to a bill active this month:
 * no bill picked, or linked to a version an "as of" change has since retired.
 * The budget skips these, so they belong in front of the user.
 */
export function isUnlinkedBillPayment(
  category: string,
  recurringExpenseId: number | null,
  needsReview: boolean,
  activeBillIds: ReadonlySet<number>,
): boolean {
  if (needsReview || (category !== "fixed" && category !== "amortized")) return false;
  return recurringExpenseId == null || !activeBillIds.has(recurringExpenseId);
}

/** Does this row count toward money in? */
export function isMoneyIn(category: string, needsReview: boolean): boolean {
  return !needsReview && (IN_CATEGORIES as readonly string[]).includes(category);
}

/** Which way a row's money went: into your pocket or out of it. A transfer
 *  with only an "into" account came from outside (a Zelle from a person). */
export function moneyDirection(
  category: string,
  amount: number,
  accountId: number | null,
  transferAccountId: number | null,
): "in" | "out" {
  if (category === "income" || category === REIMBURSEMENT) return "in";
  if (category === TRANSFER) return accountId == null && transferAccountId != null ? "in" : "out";
  return amount < 0 ? "in" : "out";
}

/** The stored amount for a lane, given the size and direction: income,
 *  reimbursements, and transfers are positive; money in on a spending or fund
 *  row is negative (a refund or a deposit). */
export function signedAmount(category: string, size: number, direction: "in" | "out"): number {
  const n = Math.abs(size);
  if (category === "income" || category === REIMBURSEMENT || category === TRANSFER) return n;
  return direction === "in" ? -n : n;
}
