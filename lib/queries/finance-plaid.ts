import "server-only";
import { and, asc, eq, max, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { eventLog, plaidAccounts, plaidItems, type PlaidItem } from "@/lib/db/schema";
import { requireGroupId } from "@/lib/session";
import { listEvents, type EventView } from "@/lib/events";

export type BankAccountRow = {
  id: number;
  name: string;
  mask: string | null;
  type: string;
  subtype: string | null;
  financialAccountId: number | null;
};

export type BankConnectionRow = {
  id: number;
  institutionName: string;
  status: string;
  lastError: string | null;
  lastSyncedAt: Date | null;
  /** When Plaid last sent a webhook about this login (null = none on record). */
  lastWebhookAt: Date | null;
  syncFrom: string;
  accounts: BankAccountRow[];
};

/** This group's bank logins and their accounts, oldest first. Never selects the token. */
export async function listBankConnections(): Promise<BankConnectionRow[]> {
  const groupId = await requireGroupId();
  const rows = await db
    .select({
      id: plaidItems.id,
      institutionName: plaidItems.institutionName,
      status: plaidItems.status,
      lastError: plaidItems.lastError,
      lastSyncedAt: plaidItems.lastSyncedAt,
      syncFrom: plaidItems.syncFrom,
      accountId: plaidAccounts.id,
      accountName: plaidAccounts.name,
      mask: plaidAccounts.mask,
      type: plaidAccounts.type,
      subtype: plaidAccounts.subtype,
      financialAccountId: plaidAccounts.financialAccountId,
    })
    .from(plaidItems)
    .leftJoin(plaidAccounts, eq(plaidAccounts.plaidItemId, plaidItems.id))
    .where(eq(plaidItems.groupId, groupId))
    .orderBy(asc(plaidItems.createdAt), asc(plaidAccounts.id));

  const byItem = new Map<number, BankConnectionRow>();
  for (const r of rows) {
    let item = byItem.get(r.id);
    if (!item) {
      item = {
        id: r.id,
        institutionName: r.institutionName,
        status: r.status,
        lastError: r.lastError,
        lastSyncedAt: r.lastSyncedAt,
        lastWebhookAt: null,
        syncFrom: r.syncFrom,
        accounts: [],
      };
      byItem.set(r.id, item);
    }
    if (r.accountId !== null && r.accountName !== null && r.type !== null) {
      item.accounts.push({
        id: r.accountId,
        name: r.accountName,
        mask: r.mask,
        type: r.type,
        subtype: r.subtype,
        financialAccountId: r.financialAccountId,
      });
    }
  }
  const itemKey = sql<number>`(${eventLog.data}->>'item')::int`;
  const hooks = await db
    .select({ item: itemKey, at: max(eventLog.createdAt) })
    .from(eventLog)
    .where(and(eq(eventLog.groupId, groupId), eq(eventLog.source, "plaid"), eq(eventLog.kind, "webhook")))
    .groupBy(itemKey);
  for (const h of hooks) {
    const item = byItem.get(Number(h.item));
    if (item && h.at) item.lastWebhookAt = h.at;
  }
  return [...byItem.values()];
}

/** The household's recent bank events (webhooks, syncs), newest first. */
export async function listBankActivity(limit = 12): Promise<EventView[]> {
  return listEvents(await requireGroupId(), { source: "plaid", limit });
}

export type BankAlert = { institutionName: string; status: string; lastError: string | null };

/** This group's bank logins that need the owner (anything but a healthy status). */
export async function listBankAlerts(): Promise<BankAlert[]> {
  const groupId = await requireGroupId();
  return db
    .select({
      institutionName: plaidItems.institutionName,
      status: plaidItems.status,
      lastError: plaidItems.lastError,
    })
    .from(plaidItems)
    .where(and(eq(plaidItems.groupId, groupId), ne(plaidItems.status, "ok")))
    .orderBy(asc(plaidItems.createdAt));
}

/** One item of the given group (with its encrypted token), or null. */
export async function getPlaidItemForGroup(
  id: number,
  groupId: number,
): Promise<PlaidItem | null> {
  const [row] = await db
    .select()
    .from(plaidItems)
    .where(and(eq(plaidItems.id, id), eq(plaidItems.groupId, groupId)))
    .limit(1);
  return row ?? null;
}
