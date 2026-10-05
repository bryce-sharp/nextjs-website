import "server-only";
import { and, desc, eq, gt, gte, ilike, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { financialAccounts, plaidAccounts, plaidItems, plaidTransactions, transactions } from "@/lib/db/schema";
import { requireGroupId } from "@/lib/session";
import { IN_CATEGORIES, REIMBURSEMENT, SPEND_CATEGORIES, type Flow } from "@/lib/finance/cashflow";
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
        inArray(transactions.category, [...SPEND_CATEGORIES, REIMBURSEMENT]),
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
    accountId: t.accountId,
    transferAccountId: t.transferAccountId,
    needsReview: t.needsReview,
    note: t.note,
    source: t.source,
    bankStatus: t.bankStatus,
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

// ── One transaction's details (the row popup) ────────────────────────────────

/** The bank's copy of a ledger row, as the popup shows it. */
export type TxnBankCopy = {
  institution: string;
  account: string; // the bank's account name and last digits
  name: string; // the bank's description, as Plaid sends it
  merchantName: string | null; // Plaid's clean merchant name
  statementText: string | null; // the bank's original statement text, when Plaid sent it
  category: string | null; // Plaid's category, readable
  pending: boolean;
  reportedAt: string; // when the bank first reported it (its pending version, if any)
  postedAt: string | null; // when the posted version arrived
  logoUrl: string | null;
  website: string | null;
};

export type TxnDetail = {
  arrivedAt: string; // when the row reached the app
  rawText: string | null; // a text alert as it was received
  accountConnected: boolean; // the row's account has a bank feed
  bank: TxnBankCopy[]; // two for a transfer between connected accounts
  split: { total: number; parts: number } | null; // one bank payment recorded in parts
};

/** "FOOD_AND_DRINK" + "FOOD_AND_DRINK_FAST_FOOD" → "Food and drink · Fast food". */
function readableCategory(primary: string | null, detailed: string | null): string | null {
  if (!primary) return null;
  const words = (s: string) => s.toLowerCase().replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
  const rest = detailed?.startsWith(`${primary}_`) ? detailed.slice(primary.length + 1) : null;
  return rest ? `${words(primary)} · ${words(rest)}` : words(primary);
}

export async function getTransactionDetail(groupId: number, id: number): Promise<TxnDetail | null> {
  const [t] = await db
    .select({ createdAt: transactions.createdAt, rawText: transactions.rawText, accountId: transactions.accountId })
    .from(transactions)
    .where(and(eq(transactions.id, id), eq(transactions.groupId, groupId)))
    .limit(1);
  if (!t) return null;

  const raw = plaidTransactions.raw;
  const copies = await db
    .select({
      institution: plaidItems.institutionName,
      account: plaidAccounts.name,
      mask: plaidAccounts.mask,
      name: plaidTransactions.name,
      merchantName: plaidTransactions.merchantName,
      pfcPrimary: plaidTransactions.pfcPrimary,
      pfcDetailed: plaidTransactions.pfcDetailed,
      pending: plaidTransactions.pending,
      amount: plaidTransactions.amount,
      createdAt: plaidTransactions.createdAt,
      pendingTransactionId: plaidTransactions.pendingTransactionId,
      splitLedgerIds: plaidTransactions.splitLedgerIds,
      statementText: sql<string | null>`${raw}->>'original_description'`,
      logoUrl: sql<string | null>`coalesce(${raw}->>'logo_url', ${raw}->'counterparties'->0->>'logo_url')`,
      website: sql<string | null>`${raw}->>'website'`,
    })
    .from(plaidTransactions)
    .innerJoin(plaidAccounts, eq(plaidTransactions.plaidAccountId, plaidAccounts.id))
    .innerJoin(plaidItems, eq(plaidAccounts.plaidItemId, plaidItems.id))
    .where(
      and(
        eq(plaidItems.groupId, groupId),
        isNull(plaidTransactions.removedAt),
        sql`(${plaidTransactions.ledgerTransactionId} = ${id} or ${id} = any(${plaidTransactions.splitLedgerIds}))`,
      ),
    );

  // A posted copy that replaced a pending one: the pending one is when the bank first saw it.
  const pendingIds = copies.map((c) => c.pendingTransactionId).filter((x): x is string => x != null);
  const firstSeen = pendingIds.length
    ? await db
        .select({ transactionId: plaidTransactions.transactionId, createdAt: plaidTransactions.createdAt })
        .from(plaidTransactions)
        .where(inArray(plaidTransactions.transactionId, pendingIds))
    : [];

  const [connected] = t.accountId
    ? await db
        .select({ id: plaidAccounts.id })
        .from(plaidAccounts)
        .innerJoin(financialAccounts, eq(plaidAccounts.financialAccountId, financialAccounts.id))
        .where(and(eq(plaidAccounts.financialAccountId, t.accountId), eq(financialAccounts.groupId, groupId)))
        .limit(1)
    : [];

  const splitCopy = copies.find((c) => c.splitLedgerIds?.length);
  return {
    arrivedAt: t.createdAt.toISOString(),
    rawText: t.rawText,
    accountConnected: Boolean(connected),
    bank: copies.map((c) => {
      const pendingFirst = firstSeen.find((f) => f.transactionId === c.pendingTransactionId);
      return {
        institution: c.institution,
        account: c.mask ? `${c.account} ····${c.mask}` : c.account,
        name: c.name,
        merchantName: c.merchantName,
        statementText: c.statementText,
        category: readableCategory(c.pfcPrimary, c.pfcDetailed),
        pending: c.pending,
        reportedAt: (pendingFirst?.createdAt ?? c.createdAt).toISOString(),
        postedAt: c.pending ? null : pendingFirst ? c.createdAt.toISOString() : null,
        logoUrl: c.logoUrl,
        website: c.website,
      };
    }),
    split: splitCopy
      ? { total: Math.abs(Number(splitCopy.amount)), parts: 1 + (splitCopy.splitLedgerIds?.length ?? 0) }
      : null,
  };
}

// ── Session wrappers ──────────────────────────────────────────────────────────
export async function searchTransactions(
  f: TxnFilters,
  cursor: string | null,
): Promise<TxnPage> {
  return searchTransactionsForGroup(await requireGroupId(), f, cursor);
}
