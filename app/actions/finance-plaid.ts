"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, isNotNull, isNull, ne } from "drizzle-orm";
import { CountryCode, Products, type AccountBase } from "plaid";
import { db } from "@/lib/db";
import {
  financialAccounts,
  groups,
  plaidAccounts,
  plaidItems,
  plaidTransactions,
  transactions,
} from "@/lib/db/schema";
import { requireOwner } from "@/lib/auth";
import { getGroupTimezone } from "@/lib/queries/group";
import { getPlaidItemForGroup } from "@/lib/queries/finance-plaid";
import { currentMonthISO } from "@/lib/finance/parse";
import {
  getPlaid,
  plaidConfigured,
  plaidErrorCode,
  plaidErrorMessage,
} from "@/lib/plaid/client";
import { decryptToken, encryptToken } from "@/lib/plaid/crypto";
import { suggestAccount } from "@/lib/plaid/accounts";
import { applyPlaidItemNow, syncPlaidItem, type SyncOutcome } from "@/lib/plaid/sync";

// Bank connections (Plaid). Connecting a bank shares account access, so every
// action here is the household OWNER's alone, and never the demo login's.

const SETTINGS = "/finance/settings";

/** Every page that shows ledger rows or bank status. */
function revalidateFinance() {
  revalidatePath(SETTINGS);
  revalidatePath("/finance");
  revalidatePath("/finance/transactions");
}

/** A one-line result for the page, e.g. "4 new, 2 matched to card alerts". */
function describe(outcome: SyncOutcome): string {
  if (!outcome.ok) return outcome.busy ? "A sync for this bank is already running." : outcome.error;
  const a = outcome.applied;
  const parts = [
    a.inserted && `${a.inserted} new`,
    a.claimed && `${a.claimed} matched to existing rows`,
    a.updated && `${a.updated} updated`,
    a.removed && `${a.removed} removed by the bank`,
    a.skipped && `${a.skipped} card payments skipped`,
    a.review && `${a.review} need review`,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "Already up to date.";
}

// Shown in Plaid's pop-up ("Bryce Sharp App uses Plaid..."); keep it
// matching the app name in the Plaid Dashboard. 30 characters max.
const CLIENT_NAME = "Bryce Sharp App";

// Fetched once at the first connection and fixed for the item's life, so ask
// for the most Plaid allows; rows before syncFrom never reach the ledger anyway.
const HISTORY_DAYS = 730;

type Result = { ok: true } | { error: string };

/** The owner's group, refusing the demo login and unconfigured deployments. */
async function requireBankAdmin(): Promise<number> {
  const session = await requireOwner();
  if (!plaidConfigured()) throw new Error("Bank sync is not set up on this deployment.");
  const [group] = await db
    .select({ isDemo: groups.isDemo })
    .from(groups)
    .where(eq(groups.id, session.groupId))
    .limit(1);
  if (!group || group.isDemo) throw new Error("The demo hub cannot connect banks.");
  return session.groupId;
}

const money = (n: number | null | undefined) => (n == null ? null : n.toFixed(2));

function balanceFields(a: AccountBase) {
  return {
    currentBalance: money(a.balances.current),
    availableBalance: money(a.balances.available),
    balanceAsOf: new Date(),
  };
}

/**
 * A short-lived link token for Plaid's pop-up. Without an item it starts a new
 * connection; with one it opens repair ("update") mode, which keeps the same
 * access token, so no Trial slot is spent fixing a connection.
 */
export async function createLinkTokenAction(
  plaidItemId: number | null,
): Promise<{ linkToken: string } | { error: string }> {
  const groupId = await requireBankAdmin();
  let accessToken: string | null = null;
  if (plaidItemId !== null) {
    const item = await getPlaidItemForGroup(plaidItemId, groupId);
    if (!item) return { error: "That bank connection no longer exists." };
    accessToken = decryptToken(item.accessTokenEnc);
  }
  try {
    const { data } = await getPlaid().linkTokenCreate({
      client_name: CLIENT_NAME,
      language: "en",
      country_codes: [CountryCode.Us],
      // A stable, non-personal id for this household (Plaid forbids PII here).
      user: { client_user_id: `group-${groupId}` },
      ...(accessToken
        ? { access_token: accessToken, update: { account_selection_enabled: true } }
        : {
            products: [Products.Transactions],
            transactions: { days_requested: HISTORY_DAYS },
          }),
      ...(process.env.PLAID_WEBHOOK_URL ? { webhook: process.env.PLAID_WEBHOOK_URL } : {}),
    });
    return { linkToken: data.link_token };
  } catch (err) {
    console.error("plaid link token failed", plaidErrorCode(err));
    return { error: plaidErrorMessage(err, "Could not start Plaid. Try again.") };
  }
}

/**
 * Finish a new connection: swap the one-time public token for the permanent
 * access token, store it encrypted BEFORE anything else can fail (losing it
 * would strand the connection), then record the bank's accounts, each with a
 * suggested app account. Returns the name of an already-connected item at the
 * same bank, so the page can warn about a duplicate.
 */
export async function connectBankAction(
  publicToken: string,
): Promise<{ ok: true; duplicateOf: string | null; summary: string } | { error: string }> {
  const groupId = await requireBankAdmin();
  const plaid = getPlaid();

  let itemRowId: number;
  let accessToken: string;
  try {
    const { data } = await plaid.itemPublicTokenExchange({ public_token: publicToken });
    accessToken = data.access_token;
    const tz = await getGroupTimezone(groupId);
    const [row] = await db
      .insert(plaidItems)
      .values({
        groupId,
        itemId: data.item_id,
        accessTokenEnc: encryptToken(accessToken),
        institutionName: "Bank",
        syncFrom: currentMonthISO(tz),
      })
      .returning({ id: plaidItems.id });
    itemRowId = row.id;
  } catch (err) {
    console.error("plaid exchange failed", plaidErrorCode(err));
    return { error: plaidErrorMessage(err, "Could not finish connecting. Try again.") };
  }

  try {
    const { data } = await plaid.accountsGet({ access_token: accessToken });
    const institutionId = data.item.institution_id ?? null;
    let institutionName = data.item.institution_name ?? null;
    if (!institutionName && institutionId) {
      const { data: inst } = await plaid.institutionsGetById({
        institution_id: institutionId,
        country_codes: [CountryCode.Us],
      });
      institutionName = inst.institution.name;
    }
    await db
      .update(plaidItems)
      .set({ institutionId, institutionName: institutionName ?? "Bank" })
      .where(eq(plaidItems.id, itemRowId));

    const [appAccounts, alreadyFed, sameBank] = await Promise.all([
      db
        .select({ id: financialAccounts.id, name: financialAccounts.name, kind: financialAccounts.kind })
        .from(financialAccounts)
        .where(and(eq(financialAccounts.groupId, groupId), isNull(financialAccounts.archivedAt))),
      db
        .select({ id: plaidAccounts.financialAccountId })
        .from(plaidAccounts)
        .innerJoin(plaidItems, eq(plaidAccounts.plaidItemId, plaidItems.id))
        .where(eq(plaidItems.groupId, groupId)),
      institutionId
        ? db
            .select({ name: plaidItems.institutionName })
            .from(plaidItems)
            .where(
              and(
                eq(plaidItems.groupId, groupId),
                eq(plaidItems.institutionId, institutionId),
                ne(plaidItems.id, itemRowId),
              ),
            )
            .limit(1)
        : Promise.resolve([]),
    ]);

    const taken = new Set(alreadyFed.map((r) => r.id).filter((id): id is number => id !== null));
    const rows = data.accounts.map((a) => {
      const suggestion = suggestAccount(a, institutionName ?? "", appAccounts, taken);
      if (suggestion !== null) taken.add(suggestion);
      return {
        plaidItemId: itemRowId,
        accountId: a.account_id,
        financialAccountId: suggestion,
        name: a.name,
        officialName: a.official_name,
        mask: a.mask,
        type: a.type,
        subtype: a.subtype,
        ...balanceFields(a),
      };
    });
    if (rows.length > 0) await db.insert(plaidAccounts).values(rows);
    // The first sync also switches on Plaid's update webhooks for this item.
    const summary = describe(await syncPlaidItem(itemRowId, "connect"));
    revalidateFinance();
    return { ok: true, duplicateOf: sameBank[0]?.name ?? null, summary };
  } catch (err) {
    // The connection itself is saved; only the account list is missing, and
    // the first sync fills it in.
    console.error("plaid accounts failed", plaidErrorCode(err));
    await db
      .update(plaidItems)
      .set({ status: "error", lastError: plaidErrorMessage(err, "Could not read the bank's accounts.") })
      .where(eq(plaidItems.id, itemRowId));
    revalidateFinance();
    return { error: "Connected, but the account list did not load. It will fill in on the next sync." };
  }
}

/**
 * Point one bank account at an app account (or null to stop importing it). An
 * app account takes one feed, so the same money is never imported twice. The
 * account's not-yet-imported bank rows are queued for the next apply step.
 */
export async function mapBankAccountAction(
  plaidAccountId: number,
  financialAccountId: number | null,
): Promise<Result> {
  const groupId = await requireBankAdmin();

  const [bankAccount] = await db
    .select({
      id: plaidAccounts.id,
      plaidItemId: plaidAccounts.plaidItemId,
      previous: plaidAccounts.financialAccountId,
    })
    .from(plaidAccounts)
    .innerJoin(plaidItems, eq(plaidAccounts.plaidItemId, plaidItems.id))
    .where(and(eq(plaidAccounts.id, plaidAccountId), eq(plaidItems.groupId, groupId)))
    .limit(1);
  if (!bankAccount) return { error: "That bank account no longer exists." };

  if (financialAccountId !== null) {
    const [target] = await db
      .select({ id: financialAccounts.id, name: financialAccounts.name })
      .from(financialAccounts)
      .where(
        and(
          eq(financialAccounts.id, financialAccountId),
          eq(financialAccounts.groupId, groupId),
          isNull(financialAccounts.archivedAt),
        ),
      )
      .limit(1);
    if (!target) return { error: "Pick one of your open accounts." };

    const groupItems = db
      .select({ id: plaidItems.id })
      .from(plaidItems)
      .where(eq(plaidItems.groupId, groupId));
    const [clash] = await db
      .select({ id: plaidAccounts.id })
      .from(plaidAccounts)
      .where(
        and(
          eq(plaidAccounts.financialAccountId, financialAccountId),
          ne(plaidAccounts.id, plaidAccountId),
          inArray(plaidAccounts.plaidItemId, groupItems),
        ),
      )
      .limit(1);
    if (clash) return { error: `${target.name} already gets transactions from another bank account.` };
  }

  await db
    .update(plaidAccounts)
    .set({ financialAccountId })
    .where(eq(plaidAccounts.id, plaidAccountId));

  // Pointing the feed at a different account moves what it already imported.
  const { previous } = bankAccount;
  if (previous !== null && financialAccountId !== null && previous !== financialAccountId) {
    const imported = db
      .select({ id: plaidTransactions.ledgerTransactionId })
      .from(plaidTransactions)
      .where(
        and(
          eq(plaidTransactions.plaidAccountId, plaidAccountId),
          isNotNull(plaidTransactions.ledgerTransactionId),
        ),
      );
    await db
      .update(transactions)
      .set({ accountId: financialAccountId })
      .where(and(eq(transactions.groupId, groupId), eq(transactions.accountId, previous), inArray(transactions.id, imported)));
    await db
      .update(transactions)
      .set({ transferAccountId: financialAccountId })
      .where(
        and(eq(transactions.groupId, groupId), eq(transactions.transferAccountId, previous), inArray(transactions.id, imported)),
      );
  }

  await db
    .update(plaidTransactions)
    .set({ appliedAt: null })
    .where(
      and(
        eq(plaidTransactions.plaidAccountId, plaidAccountId),
        isNull(plaidTransactions.ledgerTransactionId),
        isNull(plaidTransactions.removedAt),
      ),
    );
  await applyPlaidItemNow(bankAccount.plaidItemId);
  revalidateFinance();
  return { ok: true };
}

/** Sync one bank now. The webhook and the daily cron run this same sync. */
export async function syncBankAction(
  plaidItemId: number,
): Promise<{ ok: true; summary: string } | { error: string }> {
  const groupId = await requireBankAdmin();
  const item = await getPlaidItemForGroup(plaidItemId, groupId);
  if (!item) return { error: "That bank connection no longer exists." };
  const outcome = await syncPlaidItem(item.id, "manual");
  revalidateFinance();
  return outcome.ok ? { ok: true, summary: describe(outcome) } : { error: describe(outcome) };
}

/** After repair mode succeeds the access token is unchanged: clear the alarm and catch up. */
export async function markBankRepairedAction(
  plaidItemId: number,
): Promise<{ ok: true; summary: string } | { error: string }> {
  const groupId = await requireBankAdmin();
  const item = await getPlaidItemForGroup(plaidItemId, groupId);
  if (!item) return { error: "That bank connection no longer exists." };
  await db
    .update(plaidItems)
    .set({ status: "ok", lastError: null })
    .where(eq(plaidItems.id, item.id));
  const outcome = await syncPlaidItem(item.id, "reconnect");
  revalidateFinance();
  return outcome.ok ? { ok: true, summary: describe(outcome) } : { error: describe(outcome) };
}

/**
 * Disconnect a bank: revoke access at Plaid, then drop the item, its accounts,
 * and its raw rows. Ledger transactions stay. On the free Trial this does NOT
 * free a connection slot, so prefer Reconnect for a broken connection.
 */
export async function disconnectBankAction(
  plaidItemId: number,
  _formData: FormData,
): Promise<void> {
  const groupId = await requireBankAdmin();
  const item = await getPlaidItemForGroup(plaidItemId, groupId);
  if (!item) return;
  try {
    await getPlaid().itemRemove({ access_token: decryptToken(item.accessTokenEnc) });
  } catch (err) {
    const code = plaidErrorCode(err);
    // Already gone at Plaid: nothing left to revoke, so drop the local copy.
    if (code !== "ITEM_NOT_FOUND" && code !== "INVALID_ACCESS_TOKEN") {
      console.error("plaid item remove failed", code);
      throw new Error(plaidErrorMessage(err, "Could not disconnect the bank. Try again."));
    }
  }
  await db.delete(plaidItems).where(eq(plaidItems.id, item.id));
  revalidatePath(SETTINGS);
}
