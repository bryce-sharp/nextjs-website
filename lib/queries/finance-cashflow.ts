import "server-only";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { transactions as t } from "@/lib/db/schema";
import { txnWhere, type TxnFilters } from "@/lib/queries/finance-transactions";
import { IN_CATEGORIES, REIMBURSEMENT, SPEND_CATEGORIES } from "@/lib/finance/cashflow";

// ─────────────────────────────────────────────────────────────────────────────
// CASH FLOW — "what actually moved", beside the budget's "what's left to spend"
// (never scored against it). ONE definition for every view — the budget's All
// money toggle, History, and the explorer's totals — so their numbers agree:
//   • IN  = income.
//   • OUT = discretionary, fixed, amortized (in the month it's PAID), savings
//           (bought from savings: real money, just off-budget) and fund
//           purchases. Refunds (negative rows) net against their own lane, and
//           reimbursements (paybacks for purchases) net against money out
//           under the tag of what they pay back.
//   • Never counted: Excluded rows, unreadable (needs-review) rows, and fund
//     deposits (funds are play money).
// Dated by purchase: card payments aren't in the ledger, so nothing doubles.
// ─────────────────────────────────────────────────────────────────────────────

// The lane lists come from lib/finance/cashflow (constants, never user input).
const list = (cats: readonly string[]) => sql.raw(cats.map((c) => `'${c}'`).join(", "));

const moneyIn = () =>
  sql<string>`coalesce(sum(case when not ${t.needsReview} and ${t.category} in (${list(IN_CATEGORIES)}) then ${t.amount} else 0 end), 0)`;
const moneyOut = () =>
  sql<string>`coalesce(sum(case when ${t.needsReview} then 0 when ${t.category} in (${list(SPEND_CATEGORIES)}) then ${t.amount} when ${t.category} = 'fund' then greatest(${t.amount}, 0) when ${t.category} = ${REIMBURSEMENT} then -${t.amount} else 0 end), 0)`;

const dollars = (v: string | number | null | undefined) => Math.round(Number(v ?? 0) * 100) / 100;

export type CashFlow = { moneyIn: number; moneyOut: number };
export type CashFlowSummary = CashFlow & { count: number };
export type MonthFlow = CashFlow & { month: string }; // YYYY-MM-01
export type TagSpend = { tag: string | null; amount: number };
export type CategoryFlow = CashFlow & { category: string };
export type SourceIn = { source: string | null; category: string; amount: number };

/** Row count plus money in/out for exactly the rows these filters match. */
export async function summarizeCashFlow(groupId: number, f: TxnFilters): Promise<CashFlowSummary> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int`, moneyIn: moneyIn(), moneyOut: moneyOut() })
    .from(t)
    .where(txnWhere(groupId, f));
  return {
    count: Number(row?.count ?? 0),
    moneyIn: dollars(row?.moneyIn),
    moneyOut: dollars(row?.moneyOut),
  };
}

function monthsBetween(first: string, last: string): string[] {
  const out: string[] = [];
  let y = Number(first.slice(0, 4));
  let m = Number(first.slice(5, 7));
  const endKey = last.slice(0, 7);
  for (let guard = 0; guard < 600; guard++) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    out.push(`${key}-01`);
    if (key >= endKey) break;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/** Money in/out per month, every month in the span present (quiet months = 0). */
export async function cashFlowByMonth(groupId: number, f: TxnFilters): Promise<MonthFlow[]> {
  const month = sql<string>`to_char(${t.postedOn}, 'YYYY-MM')`;
  const rows = await db
    .select({ month, moneyIn: moneyIn(), moneyOut: moneyOut() })
    .from(t)
    .where(txnWhere(groupId, f))
    .groupBy(month)
    .orderBy(asc(month));
  if (rows.length === 0) return [];
  const byKey = new Map(rows.map((r) => [r.month, r]));
  const first = f.from && f.from.slice(0, 7) < rows[0].month ? f.from : rows[0].month;
  const lastRow = rows[rows.length - 1].month;
  const last = f.to && f.to.slice(0, 7) > lastRow ? f.to : lastRow;
  return monthsBetween(first, last).map((m) => {
    const r = byKey.get(m.slice(0, 7));
    return { month: m, moneyIn: dollars(r?.moneyIn), moneyOut: dollars(r?.moneyOut) };
  });
}

/** Money out per spend tag (null = untagged), biggest first; refund-only tags drop. */
export async function spendByTag(groupId: number, f: TxnFilters): Promise<TagSpend[]> {
  const rows = await db
    .select({ tag: t.spendCategory, amount: moneyOut() })
    .from(t)
    .where(txnWhere(groupId, f))
    .groupBy(t.spendCategory)
    .orderBy(desc(moneyOut()));
  return rows
    .map((r) => ({ tag: r.tag, amount: dollars(r.amount) }))
    .filter((r) => r.amount > 0);
}

/** Money in per income tag (null = untagged), biggest first. */
export async function incomeByTag(groupId: number, f: TxnFilters): Promise<TagSpend[]> {
  const rows = await db
    .select({ tag: t.spendCategory, amount: moneyIn() })
    .from(t)
    .where(txnWhere(groupId, f))
    .groupBy(t.spendCategory)
    .orderBy(desc(moneyIn()));
  return rows
    .map((r) => ({ tag: r.tag, amount: dollars(r.amount) }))
    .filter((r) => r.amount > 0);
}

/** Money in/out per engine category (the "by type" lanes). */
export async function cashFlowByCategory(groupId: number, f: TxnFilters): Promise<CategoryFlow[]> {
  const rows = await db
    .select({ category: t.category, moneyIn: moneyIn(), moneyOut: moneyOut() })
    .from(t)
    .where(txnWhere(groupId, f))
    .groupBy(t.category);
  return rows.map((r) => ({
    category: r.category,
    moneyIn: dollars(r.moneyIn),
    moneyOut: dollars(r.moneyOut),
  }));
}

/** Money in/out per month (YYYY-MM-01) per engine category — a range's lanes in one query. */
export async function cashFlowByMonthAndCategory(
  groupId: number,
  f: TxnFilters,
): Promise<(CategoryFlow & { month: string })[]> {
  const month = sql<string>`to_char(${t.postedOn}, 'YYYY-MM')`;
  const rows = await db
    .select({ month, category: t.category, moneyIn: moneyIn(), moneyOut: moneyOut() })
    .from(t)
    .where(txnWhere(groupId, f))
    .groupBy(month, t.category);
  return rows.map((r) => ({
    month: `${r.month}-01`,
    category: r.category,
    moneyIn: dollars(r.moneyIn),
    moneyOut: dollars(r.moneyOut),
  }));
}

/** Money in by source (the merchant field on income rows). */
export async function moneyInBySource(groupId: number, f: TxnFilters): Promise<SourceIn[]> {
  const amount = sql<string>`coalesce(sum(${t.amount}), 0)`;
  const rows = await db
    .select({ source: t.merchant, category: t.category, amount })
    .from(t)
    .where(
      and(txnWhere(groupId, f), eq(t.needsReview, false), inArray(t.category, [...IN_CATEGORIES])),
    )
    .groupBy(t.merchant, t.category)
    .orderBy(desc(amount));
  return rows
    .map((r) => ({ source: r.source, category: r.category, amount: dollars(r.amount) }))
    .filter((r) => r.amount !== 0);
}

/** Money out per posted day (for the cumulative "so far" curve). */
export async function dailyMoneyOut(
  groupId: number,
  from: string,
  to: string,
): Promise<{ postedOn: string; amount: number }[]> {
  const rows = await db
    .select({ postedOn: t.postedOn, amount: moneyOut() })
    .from(t)
    .where(txnWhere(groupId, { from, to }))
    .groupBy(t.postedOn);
  return rows.map((r) => ({ postedOn: r.postedOn, amount: dollars(r.amount) }));
}
