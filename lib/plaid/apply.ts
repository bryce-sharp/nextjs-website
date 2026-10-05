import "server-only";
import { and, asc, eq, getTableColumns, gte, inArray, isNotNull, isNull, lte, ne, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { plaidAccounts, plaidItems, plaidTransactions, transactions } from "@/lib/db/schema";
import { asTransfer, merchantRulesFor, transferRulesFor } from "@/lib/finance/ingest";
import { categorizeMerchant, type MerchantRule } from "@/lib/finance/sms";
import { spendCategoryFor } from "@/lib/finance/categorize";
import { spendRulesFor } from "@/lib/queries/finance-categories";
import { getGroupTimezone } from "@/lib/queries/group";
import { pickMatch, pickSplit } from "@/lib/finance/match";
import { bankDate, bankKind, ledgerAmount, type BankKind } from "@/lib/plaid/map";

// ─────────────────────────────────────────────────────────────────────────────
// APPLY — the bank's staged rows (plaid_transactions with applied_at null)
// become ledger rows. A bank row either refreshes the ledger row it already
// owns, takes over its pending row's entry when it posts, claims a card alert
// or manual row that already recorded it, pairs with the other leg of a
// transfer, or becomes a new row categorized like a card alert. The ledger row
// stays the household's: a refresh changes only what the bank owns (the posted
// amount, while nobody has adjusted it, and the pending flag). Re-runnable.
// ─────────────────────────────────────────────────────────────────────────────

export type ApplyStats = {
  inserted: number;
  claimed: number;
  updated: number;
  removed: number;
  skipped: number;
  review: number;
};

type Staged = typeof plaidTransactions.$inferSelect & {
  financialAccountId: number | null;
  accountType: string;
  /** The bank's own statement text (the wording card alerts use), when Plaid sent it. */
  statementText: string | null;
};

/** Every spelling the bank gives, most literal first: its statement text, Plaid's
 *  description, then Plaid's clean merchant name. Rules written from card alerts
 *  match the statement text; ones written from Plaid's names still match. */
const spellings = (r: Staged, withMerchant = true): string[] =>
  [r.statementText, r.name, withMerchant ? r.merchantName : null].filter((s): s is string => Boolean(s));

const DAY = 86_400_000;
const shiftDays = (iso: string, n: number) =>
  new Date(Date.parse(iso) + n * DAY).toISOString().slice(0, 10);

const DROPPED_NOTE = "The bank dropped this charge. Delete it if it never went through.";

export async function applyPlaidItem(plaidItemId: number): Promise<ApplyStats> {
  const stats: ApplyStats = { inserted: 0, claimed: 0, updated: 0, removed: 0, skipped: 0, review: 0 };
  const [item] = await db
    .select({ id: plaidItems.id, groupId: plaidItems.groupId, syncFrom: plaidItems.syncFrom })
    .from(plaidItems)
    .where(eq(plaidItems.id, plaidItemId))
    .limit(1);
  if (!item) return stats;

  const accounts = await db
    .select({ id: plaidAccounts.id, financialAccountId: plaidAccounts.financialAccountId })
    .from(plaidAccounts)
    .where(eq(plaidAccounts.plaidItemId, item.id));
  const mappedIds = accounts.filter((a) => a.financialAccountId !== null).map((a) => a.id);
  const unmappedIds = accounts.filter((a) => a.financialAccountId === null).map((a) => a.id);

  // A pending copy whose posted copy has arrived is gone, and its ledger row has
  // moved to the posted copy. A full re-read never lists it as removed, so retire it.
  const retireSupersededPending = () =>
    db
      .update(plaidTransactions)
      .set({ removedAt: new Date() })
      .where(
        and(
          eq(plaidTransactions.pending, true),
          isNull(plaidTransactions.removedAt),
          isNull(plaidTransactions.ledgerTransactionId),
          inArray(plaidTransactions.plaidAccountId, accounts.map((a) => a.id)),
          sql`exists (select 1 from plaid_transactions q where q.pending_transaction_id = ${plaidTransactions.transactionId} and q.removed_at is null)`,
        ),
      );
  const now = new Date();

  // Rows that never reach the ledger: unmapped accounts (mapping one later
  // re-queues its rows) and history from before the cutover.
  if (unmappedIds.length) {
    await db
      .update(plaidTransactions)
      .set({ appliedAt: now })
      .where(
        and(
          isNull(plaidTransactions.appliedAt),
          isNull(plaidTransactions.ledgerTransactionId),
          inArray(plaidTransactions.plaidAccountId, unmappedIds),
        ),
      );
  }
  if (!mappedIds.length) return stats;
  await db
    .update(plaidTransactions)
    .set({ appliedAt: now })
    .where(
      and(
        isNull(plaidTransactions.appliedAt),
        isNull(plaidTransactions.ledgerTransactionId),
        inArray(plaidTransactions.plaidAccountId, mappedIds),
        sql`coalesce(${plaidTransactions.authorizedDate}, ${plaidTransactions.date}) < ${item.syncFrom}`,
      ),
    );

  const staged: Staged[] = await db
    .select({
      ...getTableColumns(plaidTransactions),
      financialAccountId: plaidAccounts.financialAccountId,
      accountType: plaidAccounts.type,
      statementText: sql<string | null>`${plaidTransactions.raw}->>'original_description'`,
    })
    .from(plaidTransactions)
    .innerJoin(plaidAccounts, eq(plaidTransactions.plaidAccountId, plaidAccounts.id))
    .where(and(isNull(plaidTransactions.appliedAt), inArray(plaidTransactions.plaidAccountId, mappedIds)))
    .orderBy(asc(plaidTransactions.date), asc(plaidTransactions.id));
  if (!staged.length) {
    await retireSupersededPending();
    return stats;
  }

  const tz = await getGroupTimezone(item.groupId);
  const [spendRules, transferRules] = await Promise.all([
    spendRulesFor(item.groupId),
    transferRulesFor(item.groupId),
  ]);
  const billRules = new Map<string, MerchantRule[]>();
  const rulesOn = async (date: string) => {
    let rules = billRules.get(date);
    if (!rules) {
      rules = await merchantRulesFor(item.groupId, date);
      billRules.set(date, rules);
    }
    return rules;
  };
  const dateOf = (r: Staged) =>
    bankDate(
      {
        authorizedDatetime: (r.raw as { authorized_datetime?: string | null }).authorized_datetime ?? null,
        authorizedDate: r.authorizedDate,
        date: r.date,
      },
      tz,
    );
  const kindOf = (r: Staged): BankKind =>
    bankKind({
      amount: Number(r.amount),
      pfcPrimary: r.pfcPrimary,
      pfcDetailed: r.pfcDetailed,
      accountType: r.accountType,
      name: r.name,
    });

  // Rows a bank transaction may claim: not from a bank feed, not already owned
  // by a live bank row, on a mapped account, near the batch's dates.
  const live = staged.filter((r) => r.removedAt === null);
  const removedRows = staged.filter((r) => r.removedAt !== null);
  const finIds = [...new Set(live.map((r) => r.financialAccountId!))];
  const dates = live.map(dateOf).sort();
  const pool = live.length
    ? await db
        .select({
          id: transactions.id,
          accountId: transactions.accountId,
          transferAccountId: transactions.transferAccountId,
          postedOn: transactions.postedOn,
          merchant: transactions.merchant,
          originalAmount: transactions.originalAmount,
          category: transactions.category,
          source: transactions.source,
        })
        .from(transactions)
        .where(
          and(
            eq(transactions.groupId, item.groupId),
            ne(transactions.source, "plaid"),
            or(inArray(transactions.accountId, finIds), inArray(transactions.transferAccountId, finIds)),
            gte(transactions.postedOn, shiftDays(dates[0], -7)),
            lte(transactions.postedOn, shiftDays(dates[dates.length - 1], 7)),
            sql`not exists (select 1 from plaid_transactions p where p.removed_at is null and (p.ledger_transaction_id = ${transactions.id} or ${transactions.id} = any(p.split_ledger_ids)))`,
          ),
        )
    : [];
  const taken = new Set<number>();
  const handled = new Set<number>();

  const markApplied = (rawId: number, ledgerId: number | null, splitIds: number[] | null = null) =>
    db
      .update(plaidTransactions)
      .set({ appliedAt: new Date(), ledgerTransactionId: ledgerId, splitLedgerIds: splitIds?.length ? splitIds : null })
      .where(eq(plaidTransactions.id, rawId));

  /**
   * Bring a ledger row up to date with the bank, keeping the household's edits.
   * A payment recorded in parts only gets its status: the parts are the household's.
   */
  async function refresh(ledgerId: number, kind: BankKind, r: Staged, splitIds: number[] | null = null) {
    if (splitIds?.length) {
      await db
        .update(transactions)
        .set({ bankStatus: r.pending ? "pending" : "posted" })
        .where(inArray(transactions.id, [ledgerId, ...splitIds]));
      return;
    }
    const [row] = await db
      .select({ amount: transactions.amount, originalAmount: transactions.originalAmount })
      .from(transactions)
      .where(eq(transactions.id, ledgerId))
      .limit(1);
    if (!row) return;
    // The bank owns the size; the row keeps its sign, so a refund re-filed as a
    // reimbursement (stored positive) stays positive.
    const bank = Number(ledgerAmount(kind, Number(r.amount)));
    const sign = Math.sign(Number(row.originalAmount)) || Math.sign(bank) || 1;
    const amount = (sign * Math.abs(bank)).toFixed(2);
    const untouched = Number(row.amount) === Number(row.originalAmount);
    await db
      .update(transactions)
      .set({
        originalAmount: amount,
        ...(untouched ? { amount } : {}),
        bankStatus: r.pending ? "pending" : "posted",
      })
      .where(eq(transactions.id, ledgerId));
  }

  async function insertRow(values: {
    r: Staged;
    date: string;
    accountId: number | null;
    transferAccountId: number | null;
    amount: string;
    category: string;
    recurringExpenseId: number | null;
    spendCategory: string | null;
    needsReview: boolean;
  }): Promise<number> {
    const [row] = await db
      .insert(transactions)
      .values({
        groupId: item.groupId,
        accountId: values.accountId,
        transferAccountId: values.transferAccountId,
        postedOn: values.date,
        // Plaid's clean merchant name reads best in lists; the popup shows the bank's wording.
        merchant: (values.r.merchantName ?? values.r.name).slice(0, 200),
        amount: values.amount,
        originalAmount: values.amount,
        category: values.category,
        recurringExpenseId: values.recurringExpenseId,
        spendCategory: values.spendCategory,
        source: "plaid",
        needsReview: values.needsReview,
        bankStatus: values.r.pending ? "pending" : "posted",
      })
      .returning({ id: transactions.id });
    if (values.needsReview) stats.review++;
    return row.id;
  }

  /** Purchases, refunds, and income: categorized the way a card alert would be. */
  async function insertCategorized(r: Staged, kind: BankKind, date: string): Promise<number> {
    let amount = ledgerAmount(kind, Number(r.amount));
    let accountId: number | null = r.financialAccountId;
    let transferAccountId: number | null = null;
    let category = "income";
    let recurringExpenseId: number | null = null;
    let billCategory: string | null = null;
    if (kind !== "income") {
      // Transfer words read the bank's own text, never the merchant name a store shares.
      const transfer =
        spellings(r, false)
          .map((s) => asTransfer(s, amount, accountId, transferRules))
          .find((t) => t !== null) ?? null;
      if (transfer) {
        category = "transfer";
        accountId = transfer.accountId;
        transferAccountId = transfer.transferAccountId;
        amount = transfer.amount;
      } else {
        const rules = await rulesOn(date);
        // Bills match the most literal spelling that names one; the amount, then
        // the due month, picks between bills that share a merchant.
        const paid = Math.abs(Number(r.amount));
        let bill = categorizeMerchant("", rules, paid, date);
        for (const s of spellings(r)) {
          bill = categorizeMerchant(s, rules, paid, date);
          if (bill.recurringExpenseId !== null) break;
        }
        ({ category, recurringExpenseId } = bill);
        billCategory = rules.find((b) => b.recurringExpenseId === recurringExpenseId)?.category ?? null;
      }
    }
    const spendCategory =
      category === "transfer"
        ? null
        : (spellings(r)
            .map((s) => spendCategoryFor(category, s, billCategory, spendRules))
            .find((tag) => tag !== null) ?? null);
    return insertRow({ r, date, accountId, transferAccountId, amount, category, recurringExpenseId, spendCategory, needsReview: false });
  }

  /**
   * Money between accounts. A connected card on the other side makes it a card
   * payment (skipped); a connected account on the other side makes ONE ledger
   * row for both legs; otherwise transfer words, then a hand-entered transfer,
   * and as a last resort a one-sided row in Needs review that the other leg
   * completes when it arrives.
   */
  async function applyTransfer(r: Staged, date: string) {
    const amount = Number(r.amount);
    const abs = Math.abs(amount).toFixed(2);
    const others = await db
      .select({
        id: plaidTransactions.id,
        ledgerId: plaidTransactions.ledgerTransactionId,
        financialAccountId: plaidAccounts.financialAccountId,
        accountType: plaidAccounts.type,
      })
      .from(plaidTransactions)
      .innerJoin(plaidAccounts, eq(plaidTransactions.plaidAccountId, plaidAccounts.id))
      .innerJoin(plaidItems, eq(plaidAccounts.plaidItemId, plaidItems.id))
      .where(
        and(
          eq(plaidItems.groupId, item.groupId),
          isNull(plaidTransactions.removedAt),
          isNull(plaidTransactions.dismissedAt),
          isNotNull(plaidAccounts.financialAccountId),
          ne(plaidAccounts.financialAccountId, r.financialAccountId!),
          eq(plaidTransactions.amount, (-amount).toFixed(2)),
          sql`coalesce(${plaidTransactions.authorizedDate}, ${plaidTransactions.date}) between ${shiftDays(date, -3)} and ${shiftDays(date, 3)}`,
        ),
      )
      .orderBy(asc(plaidTransactions.id));

    if (others.some((o) => o.accountType === "credit")) {
      await markApplied(r.id, null);
      stats.skipped++;
      return;
    }

    const leg = others.find((o) => o.ledgerId !== null) ?? others[0];
    if (leg) {
      const [fromId, intoId] =
        amount > 0 ? [r.financialAccountId, leg.financialAccountId] : [leg.financialAccountId, r.financialAccountId];
      if (leg.ledgerId !== null) {
        await db
          .update(transactions)
          .set({ category: "transfer", accountId: fromId, transferAccountId: intoId, spendCategory: null, needsReview: false })
          .where(eq(transactions.id, leg.ledgerId));
        await refresh(leg.ledgerId, "transfer", r);
        await markApplied(r.id, leg.ledgerId);
        stats.updated++;
      } else {
        const id = await insertRow({
          r, date, accountId: fromId, transferAccountId: intoId, amount: abs,
          category: "transfer", recurringExpenseId: null, spendCategory: null, needsReview: false,
        });
        await markApplied(r.id, id);
        await markApplied(leg.id, id);
        handled.add(leg.id);
        stats.inserted++;
      }
      return;
    }

    const byWords = asTransfer(r.name, amount.toFixed(2), r.financialAccountId, transferRules);
    if (byWords) {
      const id = await insertRow({
        r, date, accountId: byWords.accountId, transferAccountId: byWords.transferAccountId, amount: byWords.amount,
        category: "transfer", recurringExpenseId: null, spendCategory: null, needsReview: false,
      });
      await markApplied(r.id, id);
      stats.inserted++;
      return;
    }

    const handEntered = pickMatch(
      { date, amount: Number(abs), names: spellings(r) },
      pool
        .filter(
          (c) =>
            !taken.has(c.id) &&
            c.category === "transfer" &&
            (c.accountId === r.financialAccountId || c.transferAccountId === r.financialAccountId),
        )
        .map((c) => ({ ...c, originalAmount: Number(c.originalAmount) })),
    );
    if (handEntered) {
      taken.add(handEntered.id);
      await refresh(handEntered.id, "transfer", r);
      await markApplied(r.id, handEntered.id);
      stats.claimed++;
      return;
    }

    const id = await insertRow({
      r, date,
      accountId: amount > 0 ? r.financialAccountId : null,
      transferAccountId: amount > 0 ? null : r.financialAccountId,
      amount: abs, category: "transfer", recurringExpenseId: null, spendCategory: null, needsReview: true,
    });
    await markApplied(r.id, id);
    stats.inserted++;
  }

  for (const r of live) {
    if (handled.has(r.id)) continue;
    // The household deleted this one; the bank's updates never bring it back.
    if (r.dismissedAt) {
      await markApplied(r.id, null);
      continue;
    }
    const kind = kindOf(r);
    const date = dateOf(r);

    if (r.ledgerTransactionId !== null) {
      await refresh(r.ledgerTransactionId, kind, r, r.splitLedgerIds);
      await markApplied(r.id, r.ledgerTransactionId, r.splitLedgerIds);
      stats.updated++;
      continue;
    }

    // A posted row takes over the entry (or parts) its pending row created or claimed.
    if (r.pendingTransactionId) {
      const [pendingRow] = await db
        .select({
          id: plaidTransactions.id,
          ledgerId: plaidTransactions.ledgerTransactionId,
          splitIds: plaidTransactions.splitLedgerIds,
          dismissedAt: plaidTransactions.dismissedAt,
        })
        .from(plaidTransactions)
        .where(eq(plaidTransactions.transactionId, r.pendingTransactionId))
        .limit(1);
      // Deleting a pending charge also deletes it once it posts.
      if (pendingRow?.dismissedAt) {
        await db
          .update(plaidTransactions)
          .set({ dismissedAt: new Date(), appliedAt: new Date(), ledgerTransactionId: null })
          .where(eq(plaidTransactions.id, r.id));
        continue;
      }
      if (pendingRow?.ledgerId) {
        await db
          .update(plaidTransactions)
          .set({ ledgerTransactionId: null, splitLedgerIds: null })
          .where(eq(plaidTransactions.id, pendingRow.id));
        await refresh(pendingRow.ledgerId, kind, r, pendingRow.splitIds);
        await markApplied(r.id, pendingRow.ledgerId, pendingRow.splitIds);
        stats.updated++;
        continue;
      }
    }

    if (kind === "skip") {
      await markApplied(r.id, null);
      stats.skipped++;
      continue;
    }
    if (kind === "transfer") {
      await applyTransfer(r, date);
      continue;
    }

    const amount = Number(ledgerAmount(kind, Number(r.amount)));
    const bankFacts = { date, amount, names: spellings(r) };
    const candidates = pool
      .filter((c) => {
        if (taken.has(c.id) || c.accountId !== r.financialAccountId) return false;
        if (kind === "income") return c.category === "income";
        return c.category !== "income" && c.category !== "reimbursement" && c.category !== "transfer";
      })
      .map((c) => ({ ...c, originalAmount: Number(c.originalAmount) }));
    const match = pickMatch(bankFacts, candidates);
    if (match) {
      taken.add(match.id);
      await refresh(match.id, kind, r);
      await markApplied(r.id, match.id);
      stats.claimed++;
      continue;
    }

    // One payment the household recorded in parts claims all of them.
    const parts = kind === "spend" ? pickSplit(bankFacts, candidates) : null;
    if (parts) {
      const [primary, ...rest] = [...parts].sort((a, b) => b.originalAmount - a.originalAmount).map((p) => p.id);
      for (const id of [primary, ...rest]) taken.add(id);
      await refresh(primary, kind, r, rest);
      await markApplied(r.id, primary, rest);
      stats.claimed++;
      continue;
    }

    const id = await insertCategorized(r, kind, date);
    await markApplied(r.id, id);
    stats.inserted++;
  }

  // Removals last, so a pending row that posted in this batch has already
  // handed its ledger entry to the posted row.
  for (const r of removedRows) {
    const covered = r.ledgerTransactionId === null ? [] : [r.ledgerTransactionId, ...(r.splitLedgerIds ?? [])];
    let dropped = false;
    for (const ledgerId of covered) {
      const [stillOwned] = await db
        .select({ id: plaidTransactions.id })
        .from(plaidTransactions)
        .where(
          and(
            isNull(plaidTransactions.removedAt),
            ne(plaidTransactions.id, r.id),
            sql`(${plaidTransactions.ledgerTransactionId} = ${ledgerId} or ${ledgerId} = any(${plaidTransactions.splitLedgerIds}))`,
          ),
        )
        .limit(1);
      if (stillOwned) continue;
      const [row] = await db
        .select({ source: transactions.source, note: transactions.note })
        .from(transactions)
        .where(eq(transactions.id, ledgerId))
        .limit(1);
      if (row?.source === "plaid") {
        await db.delete(transactions).where(eq(transactions.id, ledgerId));
      } else if (row) {
        await db
          .update(transactions)
          .set({ needsReview: true, bankStatus: null, ...(row.note ? {} : { note: DROPPED_NOTE }) })
          .where(eq(transactions.id, ledgerId));
        stats.review++;
      }
      dropped = true;
    }
    if (dropped) stats.removed++;
    await markApplied(r.id, null);
  }

  await retireSupersededPending();
  return stats;
}

/**
 * Before the household deletes a ledger row. A part of a split stops being
 * covered (its bank row keeps the other parts); any other bank row is dismissed
 * so the bank's later updates never bring the deleted row back.
 */
export async function releaseBankLinks(ledgerId: number): Promise<void> {
  await db.execute(sql`
    update plaid_transactions
    set split_ledger_ids = nullif(array_remove(split_ledger_ids, ${ledgerId}), '{}')
    where ${ledgerId} = any(split_ledger_ids)`);
  await db.execute(sql`
    update plaid_transactions
    set ledger_transaction_id = split_ledger_ids[1], split_ledger_ids = nullif(split_ledger_ids[2:], '{}')
    where ledger_transaction_id = ${ledgerId} and cardinality(split_ledger_ids) > 0`);
  await db
    .update(plaidTransactions)
    .set({ dismissedAt: new Date() })
    .where(eq(plaidTransactions.ledgerTransactionId, ledgerId));
}
