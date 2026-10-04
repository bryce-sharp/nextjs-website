"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  transactions,
  funds,
  financialAccounts,
  recurringExpenses,
  profiles,
  plaidTransactions,
} from "@/lib/db/schema";
import { requireEditor } from "@/lib/auth";
import { requireGroupId } from "@/lib/session";
import { getGroupTimezone } from "@/lib/queries/group";
import { parseMoney, parseStr, parseInt as parseBoundedInt, todayISO } from "@/lib/finance/parse";
import { categorizeMerchant } from "@/lib/finance/sms";
import { asTransfer, merchantRulesFor, resolveSpendCategory, transferRulesFor } from "@/lib/finance/ingest";
import { toTxnRow } from "@/lib/queries/finance-transactions";
import type { TxnRowData } from "@/components/finance/TransactionRow";

// Budget writes — HOUSEHOLD data (requireEditor). The transaction TABLE is the
// point of the whole app: SMS seeds a row, then anyone edits the row freely.

const BUDGET = "/finance"; // the Budget tab is the finance app's landing page
const EXPLORER = "/finance/transactions";

const TXN_CATEGORIES = new Set([
  "discretionary",
  "fixed",
  "amortized",
  "savings",
  "reimbursement",
  "fund",
  "income",
  "transfer",
  "ignored",
]);

/** A transaction row in OUR group, or throw. */
async function scopedTxn(id: number) {
  const groupId = await requireGroupId();
  const [row] = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.id, id), eq(transactions.groupId, groupId)))
    .limit(1);
  if (!row) throw new Error("Transaction not found.");
  return { row, groupId };
}

/** Validate a fund id belongs to the group (or null). */
async function validFund(groupId: number, id: number | null): Promise<number | null> {
  if (id === null) return null;
  const [f] = await db
    .select({ id: funds.id })
    .from(funds)
    .where(and(eq(funds.id, id), eq(funds.groupId, groupId)))
    .limit(1);
  return f ? id : null;
}

/** Validate a recurring-bill id belongs to the group (or null). */
async function validBill(groupId: number, id: number | null): Promise<number | null> {
  if (id === null) return null;
  const [b] = await db
    .select({ id: recurringExpenses.id })
    .from(recurringExpenses)
    .where(and(eq(recurringExpenses.id, id), eq(recurringExpenses.groupId, groupId)))
    .limit(1);
  return b ? id : null;
}

/** Validate an account id belongs to the group (or null), with its kind. */
async function validAccount(
  groupId: number,
  id: number | null,
): Promise<{ id: number; kind: string } | null> {
  if (id === null) return null;
  const [a] = await db
    .select({ id: financialAccounts.id, kind: financialAccounts.kind })
    .from(financialAccounts)
    .where(and(eq(financialAccounts.id, id), eq(financialAccounts.groupId, groupId)))
    .limit(1);
  return a ?? null;
}

/** Both sides of a transfer: two different accounts, neither a spending wallet
 *  (money into a wallet is spent; money out of one was never counted). */
function checkTransfer(from: { kind: string } | null, into: { id: number; kind: string } | null, fromId: number | null) {
  if (!into) throw new Error("Pick the account the money moved into.");
  if (into.id === fromId) throw new Error("A transfer needs two different accounts.");
  if (into.kind === "wallet" || from?.kind === "wallet") {
    throw new Error("Money into a spending wallet counts as spending, so record it as Discretionary instead.");
  }
}

/**
 * Edit a transaction — the Lauren-proof path. PARTIAL: only fields present in
 * the form are touched, so an inline one-field save (tap a new category) never
 * blanks the note. Any edit clears needsReview (a human has looked at it now).
 * Returns the saved row so a paged list can patch it in place.
 */
export async function updateTransactionAction(
  id: number,
  formData: FormData,
): Promise<TxnRowData> {
  await requireEditor();
  const { row, groupId } = await scopedTxn(id);
  const has = (k: string) => formData.has(k);

  const set: Record<string, unknown> = { needsReview: false };

  if (has("category")) {
    const c = String(formData.get("category"));
    if (TXN_CATEGORIES.has(c)) set.category = c;
  }
  if (has("amount")) {
    const a = parseMoney(formData.get("amount"));
    if (a !== null) set.amount = a;
  }
  if (has("merchant")) set.merchant = parseStr(formData.get("merchant"));
  if (has("note")) set.note = parseStr(formData.get("note"));
  if (has("postedOn")) {
    const d = parseStr(formData.get("postedOn"));
    if (d) set.postedOn = d;
  }
  if (has("fundId")) {
    set.fundId = await validFund(
      groupId,
      parseBoundedInt(formData.get("fundId"), 1, 2 ** 31),
    );
  }
  if (has("recurringExpenseId")) {
    set.recurringExpenseId = await validBill(
      groupId,
      parseBoundedInt(formData.get("recurringExpenseId"), 1, 2 ** 31),
    );
  }
  if (has("accountId")) {
    set.accountId =
      (await validAccount(groupId, parseBoundedInt(formData.get("accountId"), 1, 2 ** 31)))?.id ?? null;
  }
  if (has("transferAccountId")) {
    set.transferAccountId =
      (await validAccount(groupId, parseBoundedInt(formData.get("transferAccountId"), 1, 2 ** 31)))?.id ??
      null;
  }

  // Links only mean something for their category; keep them honest whether the
  // category changed in THIS save or was already set. fund ↔ fund category,
  // recurring bill ↔ fixed/amortized.
  const effectiveCategory = (set.category as string | undefined) ?? row.category;
  if (effectiveCategory !== "fund") set.fundId = null;
  if (effectiveCategory !== "fixed" && effectiveCategory !== "amortized") {
    set.recurringExpenseId = null;
  }
  if (effectiveCategory === "transfer") {
    const fromId = ("accountId" in set ? set.accountId : row.accountId) as number | null;
    const intoId = ("transferAccountId" in set ? set.transferAccountId : row.transferAccountId) as number | null;
    checkTransfer(await validAccount(groupId, fromId), await validAccount(groupId, intoId), fromId);
    set.spendCategory = null; // transfers are never tagged
  } else {
    set.transferAccountId = null;
  }

  // An untagged row picks up its tag from the merchant rules (e.g. fixing an
  // unreadable alert's merchant); an existing tag is never overwritten here.
  if (row.spendCategory == null && effectiveCategory !== "transfer") {
    set.spendCategory = await resolveSpendCategory(
      groupId,
      effectiveCategory,
      "merchant" in set ? (set.merchant as string | null) : row.merchant,
      "recurringExpenseId" in set
        ? (set.recurringExpenseId as number | null)
        : row.recurringExpenseId,
    );
  }

  const [saved] = await db
    .update(transactions)
    .set(set)
    .where(eq(transactions.id, id))
    .returning();
  revalidatePath(BUDGET);
  revalidatePath(EXPLORER);
  return toTxnRow(saved);
}

/** Quick-add a transaction the bank didn't text (gas), or income (paycheck,
 *  a gift). Income is entered positive; it's excluded from all spend math. */
export async function addManualTransactionAction(formData: FormData): Promise<void> {
  await requireEditor();
  const groupId = await requireGroupId();

  const amount = parseMoney(formData.get("amount"));
  if (amount === null || Number(amount) <= 0) throw new Error("Enter an amount.");
  const postedOn = parseStr(formData.get("postedOn")) ?? todayISO(await getGroupTimezone(groupId));
  const merchant = parseStr(formData.get("merchant"));
  const kindRaw = formData.get("kind");
  const kind = kindRaw === "income" ? "income" : kindRaw === "transfer" ? "transfer" : "expense";
  const categoryRaw = String(formData.get("category") ?? "auto");

  // Category resolution: income is forced by the toggle; "auto" runs the same
  // merchant categorizer the SMS path uses (so "Progressive" → amortized on its
  // bill); an explicit non-income choice is honored as-is.
  let category: string;
  let autoRecurringId: number | null = null;
  let storeAmount = amount; // the signed value actually stored
  let transferAccountId: number | null = null;
  if (kind === "transfer") {
    category = "transfer";
  } else if (kind === "income") {
    // Money in picks a budget destination: "spend" credits Left-to-Spend (a
    // negative discretionary row — reads green "+", raises the budget);
    // "reimbursement" is a payback (credits the budget, tracked on its own);
    // anything else is just tracked with no budget effect.
    const destination = String(formData.get("destination"));
    if (destination === "spend") {
      category = "discretionary";
      storeAmount = (-Number(amount)).toFixed(2);
    } else if (destination === "reimbursement") {
      category = "reimbursement";
    } else {
      category = "income";
    }
  } else if (categoryRaw === "auto") {
    const rules = await merchantRulesFor(groupId, postedOn);
    const c = categorizeMerchant(merchant ?? "", rules);
    category = c.category;
    autoRecurringId = c.recurringExpenseId;
    // An account's transfer words beat the bill and tag rules.
    const t = asTransfer(
      merchant,
      amount,
      parseBoundedInt(formData.get("accountId"), 1, 2 ** 31),
      await transferRulesFor(groupId),
    );
    if (t) {
      category = "transfer";
      autoRecurringId = null;
      transferAccountId = t.transferAccountId;
    }
  } else if (TXN_CATEGORIES.has(categoryRaw) && categoryRaw !== "income") {
    category = categoryRaw;
  } else {
    category = "discretionary";
  }

  // Optional account attribution (which card/bank), scoped to the group.
  let accountId = parseBoundedInt(formData.get("accountId"), 1, 2 ** 31);
  if (accountId !== null) {
    const [a] = await db
      .select({ id: financialAccounts.id })
      .from(financialAccounts)
      .where(and(eq(financialAccounts.id, accountId), eq(financialAccounts.groupId, groupId)))
      .limit(1);
    if (!a) accountId = null;
  }
  if (kind === "transfer") {
    const into = await validAccount(
      groupId,
      parseBoundedInt(formData.get("transferAccountId"), 1, 2 ** 31),
    );
    checkTransfer(await validAccount(groupId, accountId), into, accountId);
    transferAccountId = into!.id;
  }
  const fundId = category === "fund"
    ? await validFund(groupId, parseBoundedInt(formData.get("fundId"), 1, 2 ** 31))
    : null;
  // Auto-detect already resolved a bill link; an explicit fixed/amortized pick
  // takes it from the form.
  const recurringExpenseId =
    category === "fixed" || category === "amortized"
      ? autoRecurringId ??
        (await validBill(groupId, parseBoundedInt(formData.get("recurringExpenseId"), 1, 2 ** 31)))
      : null;

  await db.insert(transactions).values({
    groupId,
    accountId,
    transferAccountId,
    postedOn,
    merchant,
    amount: storeAmount,
    originalAmount: storeAmount,
    category,
    fundId,
    recurringExpenseId,
    spendCategory:
      category === "transfer"
        ? null
        : await resolveSpendCategory(groupId, category, merchant, recurringExpenseId),
    source: "manual",
    note: parseStr(formData.get("note")),
  });

  // Income can ALSO bump a fund in one go (grandma's $100 → Lauren's envelope).
  // Funds are play money, so this adjusts the fund's balance DIRECTLY — not a
  // second ledger row, so no phantom "+$100 / −$100" pair.
  if (kind === "income") {
    const bumpFundId = await validFund(
      groupId,
      parseBoundedInt(formData.get("depositFundId"), 1, 2 ** 31),
    );
    if (bumpFundId !== null) {
      const [f] = await db
        .select({ b: funds.startingBalance })
        .from(funds)
        .where(eq(funds.id, bumpFundId))
        .limit(1);
      if (f) {
        await db
          .update(funds)
          .set({ startingBalance: (Number(f.b) + Number(amount)).toFixed(2) })
          .where(eq(funds.id, bumpFundId));
      }
    }
  }
  revalidatePath(BUDGET);
}

export async function deleteTransactionAction(
  id: number,
  _formData: FormData,
): Promise<void> {
  await requireEditor();
  await scopedTxn(id); // group-scope check
  // A row the bank feed knows about stays deleted: later bank updates skip it.
  await db
    .update(plaidTransactions)
    .set({ dismissedAt: new Date() })
    .where(eq(plaidTransactions.ledgerTransactionId, id));
  await db.delete(transactions).where(eq(transactions.id, id));
  revalidatePath(BUDGET);
  revalidatePath(EXPLORER);
}

// ── Funds — imaginary envelopes (balance disconnected from real accounts) ─────
export async function createFundAction(formData: FormData): Promise<void> {
  await requireEditor();
  const groupId = await requireGroupId();
  const name = parseStr(formData.get("name"));
  if (!name) throw new Error("Name the fund.");
  const startingBalance = parseMoney(formData.get("startingBalance")) ?? "0.00";

  // Optional owner (Lauren's fund vs a shared pot), scoped to the group.
  let ownerProfileId = parseBoundedInt(formData.get("ownerProfileId"), 1, 2 ** 31);
  if (ownerProfileId !== null) {
    const [p] = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(and(eq(profiles.id, ownerProfileId), eq(profiles.groupId, groupId)))
      .limit(1);
    if (!p) ownerProfileId = null;
  }

  await db.insert(funds).values({ groupId, name, startingBalance, ownerProfileId });
  revalidatePath(BUDGET);
}

/** A fund row in OUR group, or throw. */
async function scopedFund(id: number) {
  const groupId = await requireGroupId();
  const [row] = await db
    .select()
    .from(funds)
    .where(and(eq(funds.id, id), eq(funds.groupId, groupId)))
    .limit(1);
  if (!row) throw new Error("Fund not found.");
  return { row, groupId };
}

/**
 * Adjust a fund's balance DIRECTLY — funds are imaginary envelopes, so this is
 * play money, NOT a real transaction, and never touches the ledger. A positive
 * amount adds, a negative removes / zeroes out. The set balance lives on the
 * fund; only real spends (fund-category ledger rows) draw it down elsewhere, so
 * balance = startingBalance − Σ(real draws).
 */
export async function adjustFundAction(
  fundId: number,
  formData: FormData,
): Promise<void> {
  await requireEditor();
  const { row } = await scopedFund(fundId);
  const amount = parseMoney(formData.get("amount"));
  if (amount === null || Number(amount) === 0) throw new Error("Enter an amount.");
  const next = (Number(row.startingBalance) + Number(amount)).toFixed(2);
  await db.update(funds).set({ startingBalance: next }).where(eq(funds.id, fundId));
  revalidatePath(BUDGET);
}

/** Close a fund (spent out / no longer used). History stays; it leaves the
 *  active list. */
export async function closeFundAction(id: number, _formData: FormData): Promise<void> {
  await requireEditor();
  await scopedFund(id);
  await db.update(funds).set({ closedAt: new Date() }).where(eq(funds.id, id));
  revalidatePath(BUDGET);
}
