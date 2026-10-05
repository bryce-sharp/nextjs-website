import "server-only";
import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { AccountBase, RemovedTransaction, Transaction } from "plaid";
import { db } from "@/lib/db";
import { plaidAccounts, plaidItems, plaidTransactions } from "@/lib/db/schema";
import { getPlaid, plaidErrorCode, plaidErrorMessage } from "@/lib/plaid/client";
import { decryptToken } from "@/lib/plaid/crypto";
import { applyPlaidItem, type ApplyStats } from "@/lib/plaid/apply";

// ─────────────────────────────────────────────────────────────────────────────
// SYNC — one bank login's changes since the saved cursor, staged into
// plaid_transactions, then applied to the ledger. Every trigger (the button,
// the webhook, the daily cron, a new connection) runs this same function, and
// the item's lease keeps two of them from running at once. Staging is an
// idempotent upsert and the cursor is saved only after it, so a crash at any
// point simply replays.
// ─────────────────────────────────────────────────────────────────────────────

export type SyncOutcome =
  | { ok: true; fetched: { added: number; modified: number; removed: number }; applied: ApplyStats }
  | { ok: false; busy: true }
  | { ok: false; busy?: false; error: string };

// Codes that mean the connection itself needs attention; anything else (a
// timeout, the bank briefly down) leaves the status alone for the next try.
const ITEM_STATUS: Record<string, string> = {
  ITEM_LOGIN_REQUIRED: "login_required",
  PENDING_DISCONNECT: "pending_disconnect",
  USER_PERMISSION_REVOKED: "revoked",
  ACCESS_NOT_GRANTED: "revoked",
  ITEM_NOT_FOUND: "revoked",
  NO_ACCOUNTS: "error",
};

// Statuses a webhook raised while the connection still works: a successful
// sync must not clear them, or the Reconnect prompt would vanish unanswered.
const ADVISORY = new Set(["new_accounts", "pending_disconnect"]);

const CHUNK = 100;
const chunks = <T,>(xs: T[]) =>
  Array.from({ length: Math.ceil(xs.length / CHUNK) }, (_, i) => xs.slice(i * CHUNK, (i + 1) * CHUNK));
const money = (n: number | null | undefined) => (n == null ? null : n.toFixed(2));

/** Run fn holding the item's lease, or return null when another run holds it. */
async function withLease<T>(plaidItemId: number, fn: () => Promise<T>): Promise<T | null> {
  const [held] = await db
    .update(plaidItems)
    .set({ syncLockedUntil: sql`now() + interval '3 minutes'` })
    .where(
      and(
        eq(plaidItems.id, plaidItemId),
        or(isNull(plaidItems.syncLockedUntil), lt(plaidItems.syncLockedUntil, sql`now()`)),
      ),
    )
    .returning({ id: plaidItems.id });
  if (!held) return null;
  try {
    return await fn();
  } finally {
    await db.update(plaidItems).set({ syncLockedUntil: null }).where(eq(plaidItems.id, plaidItemId));
  }
}

/** Every page since the cursor; restarts the whole walk if Plaid's data shifts mid-way. */
async function fetchChanges(accessToken: string, cursor: string | null) {
  const plaid = getPlaid();
  for (let attempt = 0; ; attempt++) {
    const added: Transaction[] = [];
    const modified: Transaction[] = [];
    const removed: RemovedTransaction[] = [];
    let accounts: AccountBase[] = [];
    let next = cursor ?? undefined;
    try {
      let hasMore = true;
      while (hasMore) {
        // The bank's own statement text (original_description) is sent only when asked for.
        const { data } = await plaid.transactionsSync({
          access_token: accessToken,
          cursor: next,
          count: 500,
          options: { include_original_description: true },
        });
        added.push(...data.added);
        modified.push(...data.modified);
        removed.push(...data.removed);
        accounts = data.accounts;
        next = data.next_cursor;
        hasMore = data.has_more;
      }
      return { added, modified, removed, accounts, cursor: next ?? null };
    } catch (err) {
      if (plaidErrorCode(err) === "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION" && attempt < 2) continue;
      throw err;
    }
  }
}

/** New accounts appear unmapped; known ones get fresh names and balances. */
async function saveAccounts(plaidItemId: number, accounts: AccountBase[]) {
  for (const a of accounts) {
    const fields = {
      name: a.name,
      officialName: a.official_name,
      mask: a.mask,
      currentBalance: money(a.balances.current),
      availableBalance: money(a.balances.available),
      balanceAsOf: new Date(),
    };
    await db
      .insert(plaidAccounts)
      .values({ plaidItemId, accountId: a.account_id, type: a.type, subtype: a.subtype, ...fields })
      .onConflictDoUpdate({ target: plaidAccounts.accountId, set: fields });
  }
}

/** Upsert added and modified rows (queued for apply), and flag removed ones. */
async function stageTransactions(
  plaidItemId: number,
  changes: { added: Transaction[]; modified: Transaction[]; removed: RemovedTransaction[] },
) {
  const accountRows = await db
    .select({ id: plaidAccounts.id, accountId: plaidAccounts.accountId })
    .from(plaidAccounts)
    .where(eq(plaidAccounts.plaidItemId, plaidItemId));
  const accountIdOf = new Map(accountRows.map((a) => [a.accountId, a.id]));

  const rows = [...changes.added, ...changes.modified].flatMap((t) => {
    const plaidAccountId = accountIdOf.get(t.account_id);
    if (plaidAccountId === undefined) return [];
    return [
      {
        plaidAccountId,
        transactionId: t.transaction_id,
        pendingTransactionId: t.pending_transaction_id,
        pending: t.pending,
        amount: t.amount.toFixed(2),
        date: t.date,
        authorizedDate: t.authorized_date,
        name: t.name.slice(0, 300),
        merchantName: t.merchant_name?.slice(0, 200) ?? null,
        pfcPrimary: t.personal_finance_category?.primary ?? null,
        pfcDetailed: t.personal_finance_category?.detailed ?? null,
        raw: t,
      },
    ];
  });
  for (const batch of chunks(rows)) {
    await db
      .insert(plaidTransactions)
      .values(batch)
      .onConflictDoUpdate({
        target: plaidTransactions.transactionId,
        set: {
          plaidAccountId: sql`excluded.plaid_account_id`,
          pendingTransactionId: sql`excluded.pending_transaction_id`,
          pending: sql`excluded.pending`,
          amount: sql`excluded.amount`,
          date: sql`excluded.date`,
          authorizedDate: sql`excluded.authorized_date`,
          name: sql`excluded.name`,
          merchantName: sql`excluded.merchant_name`,
          pfcPrimary: sql`excluded.pfc_primary`,
          pfcDetailed: sql`excluded.pfc_detailed`,
          raw: sql`excluded.raw`,
          removedAt: sql`null`,
          appliedAt: sql`null`,
        },
      });
  }
  for (const batch of chunks(changes.removed.map((r) => r.transaction_id))) {
    await db
      .update(plaidTransactions)
      .set({ removedAt: new Date(), appliedAt: null })
      .where(inArray(plaidTransactions.transactionId, batch));
  }
}

export async function syncPlaidItem(plaidItemId: number): Promise<SyncOutcome> {
  const outcome = await withLease(plaidItemId, async (): Promise<SyncOutcome> => {
    const [item] = await db.select().from(plaidItems).where(eq(plaidItems.id, plaidItemId)).limit(1);
    if (!item) return { ok: false, error: "That bank connection no longer exists." };

    let fetched: { added: number; modified: number; removed: number };
    try {
      const changes = await fetchChanges(decryptToken(item.accessTokenEnc), item.cursor);
      await saveAccounts(item.id, changes.accounts);
      await stageTransactions(item.id, changes);
      await db
        .update(plaidItems)
        .set({
          cursor: changes.cursor,
          lastSyncedAt: new Date(),
          ...(ADVISORY.has(item.status) ? {} : { status: "ok", lastError: null }),
        })
        .where(eq(plaidItems.id, item.id));
      fetched = { added: changes.added.length, modified: changes.modified.length, removed: changes.removed.length };
    } catch (err) {
      const code = plaidErrorCode(err);
      const message = plaidErrorMessage(err, "The bank sync failed. Try again.");
      if (code && ITEM_STATUS[code]) {
        await db
          .update(plaidItems)
          .set({ status: ITEM_STATUS[code], lastError: message })
          .where(eq(plaidItems.id, item.id));
      }
      console.error("plaid sync failed", code ?? (err instanceof Error ? err.message : "unknown error"));
      return { ok: false, error: message };
    }

    try {
      return { ok: true, fetched, applied: await applyPlaidItem(item.id) };
    } catch (err) {
      console.error("plaid apply failed", err instanceof Error ? err.message : "unknown error");
      return { ok: false, error: "Fetched from the bank, but updating the budget failed. The next sync retries it." };
    }
  });
  return outcome ?? { ok: false, busy: true };
}

/** Apply already-staged rows (after a mapping change) under the same lease. */
export async function applyPlaidItemNow(plaidItemId: number): Promise<ApplyStats | null> {
  return withLease(plaidItemId, () => applyPlaidItem(plaidItemId));
}
