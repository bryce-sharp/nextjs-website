// How one bank transaction lands in the ledger. Plaid's sign already matches
// the ledger's (positive = money out); Plaid's personal finance category picks
// the lane. Pure, so the rules can be checked directly with node.

import { dateInTz } from "@/lib/finance/parse";

/**
 * skip: a card payment (the charges already reached the ledger one by one).
 * income: money in that Plaid calls income (payroll, interest).
 * transfer: money moving between accounts.
 * refund: any other money in. spend: any other money out.
 */
export type BankKind = "skip" | "income" | "transfer" | "refund" | "spend";

export type BankKindFacts = {
  amount: number;
  pfcPrimary: string | null;
  pfcDetailed: string | null;
  accountType: string;
  name?: string;
};

// A deposit that says it is pay is income even when the category disagrees,
// so a mislabeled paycheck can never land as a giant "refund" against spending.
const PAYROLL = /\b(payroll|direct dep|dir dep)\b/i;

export function bankKind(t: BankKindFacts): BankKind {
  const primary = t.pfcPrimary ?? "";
  const detailed = t.pfcDetailed ?? "";
  if (detailed === "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT") return "skip";
  // The card's side of a payment ("Payment Thank You") is money in on a credit account.
  if (t.accountType === "credit" && t.amount < 0 && (primary === "TRANSFER_IN" || primary === "LOAN_PAYMENTS")) {
    return "skip";
  }
  // Deposited checks and cash land as income; the household re-files a payback.
  if (t.amount < 0 && (primary === "INCOME" || detailed === "TRANSFER_IN_DEPOSIT" || PAYROLL.test(t.name ?? ""))) {
    return "income";
  }
  // Money sent through Venmo or Cash App is spent: a wallet is never a transfer.
  if (primary === "TRANSFER_OUT" && detailed.includes("FROM_APPS")) return "spend";
  if (primary === "TRANSFER_IN" || primary === "TRANSFER_OUT") return "transfer";
  return t.amount < 0 ? "refund" : "spend";
}

/** The amount as the ledger stores it: income and transfers are positive, refunds negative. */
export function ledgerAmount(kind: BankKind, plaidAmount: number): string {
  const n = kind === "income" || kind === "transfer" ? Math.abs(plaidAmount) : plaidAmount;
  return n.toFixed(2);
}

/**
 * The ledger date: when the card was used (like a card alert), not when it
 * posted. An exact authorization time is dated in the household's zone.
 */
export function bankDate(
  t: { authorizedDatetime: string | null; authorizedDate: string | null; date: string },
  tz: string,
): string {
  if (t.authorizedDatetime) {
    const ms = Date.parse(t.authorizedDatetime);
    if (Number.isFinite(ms)) return dateInTz(ms, tz);
  }
  return t.authorizedDate ?? t.date;
}
