import "server-only";
import { and, desc, eq, gt, gte, ilike, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { transactions } from "@/lib/db/schema";
import { requireGroupId } from "@/lib/session";
import { IN_CATEGORIES, SPEND_CATEGORIES, type Flow } from "@/lib/finance/cashflow";
import type { TxnRowData } from "@/components/finance/TransactionRow";

// ─────────────────────────────────────────────────────────────────────────────
// TRANSACTIONS EXPLORER (F4b) — an all-time, filterable search over the ledger
// ("when did I spend at Walmart?"). Keyset-paginated for smooth infinite scroll;
// group-scoped via requireGroupId so a filter can never reach another household.
// Rows edit through the same TransactionsTable as the budget month view.
// ─────────────────────────────────────────────────────────────────────────────

export type TxnFilters = {
  q?: string; // merchant substring (case-insensitive)
  min?: number; // amount >=
  max?: number; // amount <=
  from?: string; // postedOn >= YYYY-MM-DD
  to?: string; // postedOn <= YYYY-MM-DD
  category?: string; // exact spend-category match
  uncategorized?: boolean; // spendCategory IS NULL (find rows still to tag)
  flow?: Flow; // only rows that count as money out / money in (a tapped slice)
  lane?: string; // exact engine category (discretionary, fixed, income…); pair with its flow
  merchants?: string[]; // exact merchant names (a merchant group's catch); [] = none
};

export type TxnPage = {
  rows: TxnRowData[];
  /** "YYYY-MM-DD:id" of the last row; pass back to fetch the next page. Null = done. */
  nextCursor: string | null;
};

export const EXPLORER_PAGE_SIZE = 50;

// Rows are ordered (postedOn desc, id desc). A "date:id" cursor fetches strictly
// older rows — the id tiebreak keeps same-day rows from overlapping or skipping.
function cursorCond(cursor: string | null) {
  if (!cursor) return undefined;
  const idx = cursor.lastIndexOf(":");
  if (idx < 0) return undefined;
  const d = cursor.slice(0, idx);
  const id = Number(cursor.slice(idx + 1));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !Number.isInteger(id)) return undefined;
  return or(
    lt(transactions.postedOn, d),
    and(eq(transactions.postedOn, d), lt(transactions.id, id)),
  );
}

/** The group-scoped filter condition — shared with the cash-flow totals so the
 *  numbers always describe exactly the rows the list shows. */
export function txnWhere(groupId: number, f: TxnFilters, cursor: string | null = null) {
  const conds = [eq(transactions.groupId, groupId)];
  if (f.q) conds.push(ilike(transactions.merchant, `%${f.q}%`));
  if (f.merchants) {
    conds.push(f.merchants.length ? inArray(transactions.merchant, f.merchants) : sql`false`);
  }
  if (f.min != null) conds.push(gte(transactions.amount, String(f.min)));
  if (f.max != null) conds.push(lte(transactions.amount, String(f.max)));
  if (f.from) conds.push(gte(transactions.postedOn, f.from));
  if (f.to) conds.push(lte(transactions.postedOn, f.to));
  if (f.uncategorized) conds.push(isNull(transactions.spendCategory));
  else if (f.category) conds.push(eq(transactions.spendCategory, f.category));
  if (f.lane) conds.push(eq(transactions.category, f.lane));
  // Mirrors the cash-flow sums, so a slice's list adds up to the slice.
  if (f.flow === "out") {
    conds.push(eq(transactions.needsReview, false));
    conds.push(
      or(
        inArray(transactions.category, [...SPEND_CATEGORIES]),
        and(eq(transactions.category, "fund"), gt(transactions.amount, "0")),
      )!,
    );
  } else if (f.flow === "in") {
    conds.push(eq(transactions.needsReview, false));
    conds.push(inArray(transactions.category, [...IN_CATEGORIES]));
  }
  const cc = cursorCond(cursor);
  if (cc) conds.push(cc);
  return and(...conds);
}

/** DB row → the client row shape, shared by every transaction list and edit. */
export function toTxnRow(t: typeof transactions.$inferSelect): TxnRowData {
  return {
    id: t.id,
    postedOn: t.postedOn,
    merchant: t.merchant,
    amount: Number(t.amount),
    originalAmount: Number(t.originalAmount),
    category: t.category,
    spendCategory: t.spendCategory,
    fundId: t.fundId,
    recurringExpenseId: t.recurringExpenseId,
    needsReview: t.needsReview,
    note: t.note,
    source: t.source,
  };
}

export async function searchTransactionsForGroup(
  groupId: number,
  f: TxnFilters,
  cursor: string | null,
  limit = EXPLORER_PAGE_SIZE,
): Promise<TxnPage> {
  // Fetch one extra to know whether another page exists without a second query.
  const rows = await db
    .select()
    .from(transactions)
    .where(txnWhere(groupId, f, cursor))
    .orderBy(desc(transactions.postedOn), desc(transactions.id))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? `${last.postedOn}:${last.id}` : null;
  return { rows: page.map(toTxnRow), nextCursor };
}

// ── Session wrappers ──────────────────────────────────────────────────────────
export async function searchTransactions(
  f: TxnFilters,
  cursor: string | null,
): Promise<TxnPage> {
  return searchTransactionsForGroup(await requireGroupId(), f, cursor);
}
