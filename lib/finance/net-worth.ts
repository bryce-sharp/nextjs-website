// Pure Net Worth math, shared by the server query and the client views. A
// snapshot's month is the month it closes: the "Sep 2026" row holds the
// balances logged on Oct 1, so a change between two rows is what those
// months did.

export type NetWorthRange = "year" | "12mo" | "all";

export const NET_WORTH_RANGES: { value: NetWorthRange; label: string }[] = [
  { value: "year", label: "This year" },
  { value: "12mo", label: "12 months" },
  { value: "all", label: "All time" },
];

export const rangeLabel = (r: NetWorthRange) =>
  NET_WORTH_RANGES.find((x) => x.value === r)?.label ?? "This year";

/** YYYY-MM-01 shifted by `n` calendar months. */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 10);
}

/** Whole calendar months from `a` to `b` (both YYYY-MM-01); negative when b is earlier. */
export function monthDiff(a: string, b: string): number {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return (by - ay) * 12 + (bm - am);
}

/** Display groups for the donut's Types view; credit cards never hold a tracked balance. */
const TYPE_OF_KIND: Record<string, string> = {
  checking: "Cash",
  savings: "Cash",
  brokerage: "Brokerage",
  retirement: "Retirement",
  hsa: "HSA",
  crypto: "Crypto",
  credit_card: "Credit",
  wallet: "Wallet",
  other: "Other",
};
export const TYPE_ORDER = ["Cash", "Brokerage", "Retirement", "HSA", "Crypto", "Wallet", "Credit", "Other"];
export const typeOfKind = (kind: string) => TYPE_OF_KIND[kind] ?? "Other";

export const KIND_LABELS: Record<string, string> = {
  checking: "Checking",
  savings: "Savings",
  brokerage: "Brokerage",
  retirement: "Retirement",
  crypto: "Crypto",
  hsa: "HSA",
  credit_card: "Credit card",
  wallet: "Spending wallet",
  other: "Other",
};

/** Liquid money: what Runway and the Cash tile count. */
export const CASH_KINDS = ["checking", "savings"];
/** Accounts whose growth splits into money put in vs market. */
export const INVESTMENT_KINDS = ["brokerage", "retirement", "hsa", "crypto"];
/** Where savings can live: every account you own except spending money and debt.
 *  Moving money between two of these is a transfer; into a wallet, it is spent. */
export const isSavingsKind = (kind: string) => kind !== "wallet" && kind !== "credit_card";

const round2 = (n: number) => Math.round(n * 100) / 100;

export type MonthChange = { month: string; change: number; span: number };

/** Row-to-row changes; `span` > 1 means the earlier month(s) were never logged. */
export function changesOf(months: string[], series: (number | null)[]): (MonthChange | null)[] {
  return months.map((m, i) => {
    if (i === 0) return null;
    const v = series[i];
    const prev = series[i - 1];
    if (v == null || prev == null) return null;
    return { month: m, change: round2(v - prev), span: monthDiff(months[i - 1], m) };
  });
}

export type AccountStats = {
  start: number | null;
  end: number | null;
  change: number | null;
  changePct: number | null;
  avgPerMonth: number | null;
  best: MonthChange | null;
  worst: MonthChange | null;
  share: number | null; // % of the total at `end`
  startShare: number | null;
};

/** One account across the window: index 0 is the starting point, `upTo` the month in view. */
export function accountStats(
  months: string[],
  balances: (number | null)[],
  totals: number[],
  upTo = months.length - 1,
): AccountStats {
  const firstIdx = balances.findIndex((v, i) => i <= upTo && v != null);
  const start = firstIdx >= 0 ? balances[firstIdx] : null;
  const end = balances[upTo] ?? null;
  const change = start != null && end != null && firstIdx < upTo ? round2(end - start) : null;
  const elapsed = firstIdx >= 0 ? monthDiff(months[firstIdx], months[upTo]) : 0;
  // Single-month changes only, so a two-month gap never reads as a record month.
  const monthly = changesOf(months.slice(0, upTo + 1), balances.slice(0, upTo + 1)).filter(
    (c): c is MonthChange => c != null && c.span === 1,
  );
  const best = monthly.length ? monthly.reduce((a, b) => (b.change > a.change ? b : a)) : null;
  const worst = monthly.length ? monthly.reduce((a, b) => (b.change < a.change ? b : a)) : null;
  const shareAt = (i: number) => {
    const v = balances[i];
    return v != null && totals[i] > 0 ? round2((v / totals[i]) * 100) : null;
  };
  return {
    start,
    end,
    change,
    changePct: change != null && start ? round2((change / Math.abs(start)) * 100) : null,
    avgPerMonth: change != null && elapsed > 0 ? round2(change / elapsed) : null,
    best: best && best.change > 0 ? best : null,
    worst: worst && worst.change < 0 ? worst : null,
    share: shareAt(upTo),
    startShare: firstIdx >= 0 ? shareAt(firstIdx) : null,
  };
}

export type Pace = { months: number; perMonth: number };

/**
 * Average monthly change over the last `n` calendar months, measured from the
 * newest logged month back to the logged month nearest `n` months earlier
 * (or the oldest one when history is shorter). Null with under two months logged.
 */
export function paceOver(months: string[], totals: number[], n: number): Pace | null {
  if (months.length < 2) return null;
  const last = months.length - 1;
  const target = addMonths(months[last], -n);
  let from = 0;
  for (let i = 0; i < last; i++) if (months[i] <= target) from = i;
  const span = monthDiff(months[from], months[last]);
  if (span <= 0) return null;
  return { months: span, perMonth: round2((totals[last] - totals[from]) / span) };
}

const MILESTONES = [
  50_000, 100_000, 150_000, 200_000, 250_000, 300_000, 400_000, 500_000, 750_000,
  1_000_000, 1_500_000, 2_000_000, 3_000_000, 5_000_000,
];

export type Projection = { years: number; month: string; value: number };
export type Milestone = { amount: number; month: string };

/** Straight-line outlook: the same dollars per month, every month, from the latest total. */
export function projectLinear(latestMonth: string, latest: number, perMonth: number) {
  const projections: Projection[] = [1, 5, 10, 20].map((years) => ({
    years,
    month: addMonths(latestMonth, years * 12),
    value: Math.round(latest + perMonth * years * 12),
  }));
  const milestones: Milestone[] =
    perMonth > 0
      ? MILESTONES.filter((m) => m > latest)
          .slice(0, 3)
          .map((amount) => ({
            amount,
            month: addMonths(latestMonth, Math.ceil((amount - latest) / perMonth)),
          }))
      : [];
  return { projections, milestones };
}
