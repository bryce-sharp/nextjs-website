"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq, inArray, isNull, max, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { financialAccounts, accountSnapshots, savingsGoals } from "@/lib/db/schema";
import { requireEditor } from "@/lib/auth";
import { requireGroupId } from "@/lib/session";
import { accountOrder } from "@/lib/queries/finance-networth";
import { getAtlasViewForGroup } from "@/lib/queries/finance-atlas";
import { getGroupTimezone } from "@/lib/queries/group";
import { todayISO } from "@/lib/finance/parse";

// Net worth writes. Everything here is HOUSEHOLD data → requireEditor()
// (communal), scoped to the session group. Money fields arrive as raw strings
// from NumberField's hidden input.

// Net Worth renders at /finance/net-worth, but ACCOUNTS are shared with Budget
// (/finance), ATLAS and Settings — so revalidate the whole finance subtree with
// layout scope rather than tracking which page reads what. Also keeps this
// correct if the tabs ever move again.
const FINANCE = "/finance";

/** "2026-08" (input type=month) or "2026-08-xx" → "2026-08-01"; null if bogus. */
function normalizeMonth(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  const m = /^(\d{4})-(\d{2})/.exec(s);
  if (!m) return null;
  const mm = Number(m[2]);
  if (mm < 1 || mm > 12) return null;
  return `${m[1]}-${m[2]}-01`;
}

/** A clean money string ("1234.56") or null. Negatives allowed (loans someday). */
function money(raw: FormDataEntryValue | null): string | null {
  const s = String(raw ?? "").trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n.toFixed(2) : null;
}

const ACCOUNT_KINDS = new Set([
  "checking",
  "savings",
  "brokerage",
  "retirement",
  "crypto",
  "hsa",
  "credit_card",
  "wallet",
  "other",
]);

// ── The monthly ritual ────────────────────────────────────────────────────────
/**
 * Log (or overwrite) one month's balances in a single statement. The form
 * carries one `balance_<accountId>` field per account; blanks are skipped, so a
 * partial log is fine and never nulls out an existing value.
 */
export async function saveSnapshotsAction(formData: FormData): Promise<void> {
  await requireEditor();
  const groupId = await requireGroupId();

  const month = normalizeMonth(formData.get("month"));
  if (!month) throw new Error("Pick a month.");

  // Only OUR accounts can be written — unknown/foreign ids are ignored.
  const ours = await db
    .select({ id: financialAccounts.id })
    .from(financialAccounts)
    .where(eq(financialAccounts.groupId, groupId));

  const rows = ours.flatMap(({ id }) => {
    const balance = money(formData.get(`balance_${id}`));
    return balance === null ? [] : [{ accountId: id, month, balance }];
  });
  if (rows.length === 0) throw new Error("Enter at least one balance.");

  // One multi-row upsert = one statement (atomic on the transactionless driver).
  await db
    .insert(accountSnapshots)
    .values(rows)
    .onConflictDoUpdate({
      target: [accountSnapshots.accountId, accountSnapshots.month],
      set: { balance: sql`excluded.balance` },
    });

  revalidatePath(FINANCE, "layout");
}

/** Remove one account's snapshot for one month (fat-fingered a month). */
export async function deleteSnapshotAction(
  accountId: number,
  month: string,
  _formData: FormData,
): Promise<void> {
  await requireEditor();
  const groupId = await requireGroupId();
  const normalized = normalizeMonth(month);
  if (!normalized) return;

  const [account] = await db
    .select({ id: financialAccounts.id })
    .from(financialAccounts)
    .where(
      and(eq(financialAccounts.id, accountId), eq(financialAccounts.groupId, groupId)),
    )
    .limit(1);
  if (!account) throw new Error("Account not found.");

  await db
    .delete(accountSnapshots)
    .where(
      and(
        eq(accountSnapshots.accountId, accountId),
        eq(accountSnapshots.month, normalized),
      ),
    );
  revalidatePath(FINANCE, "layout");
}

/** Delete a whole month's row — every account's balance for that month. */
export async function deleteMonthSnapshotsAction(
  month: string,
  _formData: FormData,
): Promise<void> {
  await requireEditor();
  const groupId = await requireGroupId();
  const normalized = normalizeMonth(month);
  if (!normalized) return;

  const ours = await db
    .select({ id: financialAccounts.id })
    .from(financialAccounts)
    .where(eq(financialAccounts.groupId, groupId));
  const ids = ours.map((a) => a.id);
  if (ids.length === 0) return;

  await db
    .delete(accountSnapshots)
    .where(
      and(
        inArray(accountSnapshots.accountId, ids),
        eq(accountSnapshots.month, normalized),
      ),
    );
  revalidatePath(FINANCE, "layout");
}

// ── Accounts ──────────────────────────────────────────────────────────────────
function parseAccount(formData: FormData) {
  const kindRaw = String(formData.get("kind") ?? "other");
  return {
    name: String(formData.get("name") ?? "").trim(),
    kind: ACCOUNT_KINDS.has(kindRaw) ? kindRaw : "other",
    trackBalance: formData.get("trackBalance") != null,
    // One word or phrase per line; deduped case-insensitively, kept as typed.
    transferPatterns: [
      ...new Map(
        String(formData.get("transferPatterns") ?? "")
          .split("\n")
          .map((x) => x.trim().slice(0, 60))
          .filter(Boolean)
          .map((x) => [x.toLowerCase(), x] as const),
      ).values(),
    ].slice(0, 20),
    carriesDiscretion: formData.get("carriesDiscretion") != null,
    notes: String(formData.get("notes") ?? "").trim() || null,
  };
}

export async function addAccountAction(formData: FormData): Promise<void> {
  await requireEditor();
  const groupId = await requireGroupId();
  const data = parseAccount(formData);
  if (!data.name) throw new Error("Account name is required.");

  const [{ maxSort }] = await db
    .select({ maxSort: max(financialAccounts.sortOrder) })
    .from(financialAccounts)
    .where(eq(financialAccounts.groupId, groupId));

  await db
    .insert(financialAccounts)
    .values({ ...data, groupId, sortOrder: (maxSort ?? 0) + 1 });
  revalidatePath(FINANCE, "layout");
}

export async function updateAccountAction(
  id: number,
  formData: FormData,
): Promise<void> {
  await requireEditor();
  const groupId = await requireGroupId();
  const data = parseAccount(formData);
  if (!data.name) throw new Error("Account name is required.");

  await db
    .update(financialAccounts)
    .set(data)
    .where(
      and(eq(financialAccounts.id, id), eq(financialAccounts.groupId, groupId)),
    );
  revalidatePath(FINANCE, "layout");
}

/**
 * Move an account one slot up/down in display order — which is also the history
 * table's column order and the chart's stacking order.
 *
 * Renumbers the whole group 1..n in ONE statement rather than swapping the two
 * rows: it's atomic on the transactionless driver, and it self-heals duplicate
 * sortOrders (a plain swap between two rows sharing a value is a no-op).
 */
export async function moveAccountAction(
  id: number,
  dir: "up" | "down",
  _formData: FormData,
): Promise<void> {
  await requireEditor();
  const groupId = await requireGroupId();

  const rows = await db
    .select({
      id: financialAccounts.id,
      archivedAt: financialAccounts.archivedAt,
    })
    .from(financialAccounts)
    .where(eq(financialAccounts.groupId, groupId))
    .orderBy(...accountOrder);

  const target = rows.find((r) => r.id === id);
  if (!target) return;

  // Active and archived render as separate blocks — a move never jumps between
  // them, so find the neighbor within the target's own block.
  const isActive = (r: { archivedAt: Date | null }) => r.archivedAt === null;
  const block = rows.filter((r) => isActive(r) === isActive(target));
  const idx = block.findIndex((r) => r.id === id);
  const nIdx = dir === "up" ? idx - 1 : idx + 1;
  if (nIdx < 0 || nIdx >= block.length) return; // already at the end — no-op

  [block[idx], block[nIdx]] = [block[nIdx], block[idx]];

  // Splice the reordered block back over the full list, then number 1..n.
  const blockIds = block.map((r) => r.id);
  let cursor = 0;
  const ordered = rows.map((r) =>
    isActive(r) === isActive(target) ? blockIds[cursor++] : r.id,
  );

  await db
    .update(financialAccounts)
    .set({
      // ::int on every branch — untyped placeholders in a CASE come back as
      // text, which Postgres refuses to assign to an integer column.
      sortOrder: sql`case ${financialAccounts.id} ${sql.join(
        ordered.map((rowId, i) => sql`when ${rowId} then ${i + 1}::int`),
        sql` `,
      )} end`,
    })
    .where(
      and(
        eq(financialAccounts.groupId, groupId),
        inArray(financialAccounts.id, ordered),
      ),
    );

  revalidatePath(FINANCE, "layout");
}

/** Soft-close (keep history) or reopen an account. */
export async function setAccountArchivedAction(
  id: number,
  archived: boolean,
  _formData: FormData,
): Promise<void> {
  await requireEditor();
  const groupId = await requireGroupId();
  await db
    .update(financialAccounts)
    .set({ archivedAt: archived ? new Date() : null })
    .where(
      and(eq(financialAccounts.id, id), eq(financialAccounts.groupId, groupId)),
    );
  revalidatePath(FINANCE, "layout");
}

/** Hard delete — cascades every snapshot. The UI confirms loudly. */
export async function deleteAccountAction(
  id: number,
  _formData: FormData,
): Promise<void> {
  await requireEditor();
  const groupId = await requireGroupId();
  await db
    .delete(financialAccounts)
    .where(
      and(eq(financialAccounts.id, id), eq(financialAccounts.groupId, groupId)),
    );
  revalidatePath(FINANCE, "layout");
}

// ── Savings goal (effective-dated segments, weightPlans-style) ────────────────
/**
 * The dialog takes the WHOLE goal (401k and HSA included); the row stores the
 * take-home part, what ATLAS sets aside before discretionary. Paycheck savings
 * are read as of the later of the start month and this month, so the goal
 * you type is the goal you see today.
 */
async function takeHomePart(groupId: number, total: string, startMonth: string): Promise<string> {
  const today = todayISO(await getGroupTimezone(groupId));
  const thisMonth = `${today.slice(0, 7)}-01`;
  const asOf = startMonth > thisMonth ? startMonth : thisMonth;
  const atlas = await getAtlasViewForGroup(groupId, asOf, today);
  return Math.max(0, Number(total) - atlas.totals.savingsFromPaycheck).toFixed(2);
}

/**
 * Edit the ACTIVE goal in place (typo fix / same-timeframe adjustment). The
 * start month is editable too: it decides when the goal line starts
 * accumulating, so getting it wrong is the one mistake that makes the goal
 * look like it doesn't exist.
 */
export async function saveSavingsGoalAction(formData: FormData): Promise<void> {
  await requireEditor();
  const groupId = await requireGroupId();

  const monthlyGoal = money(formData.get("monthlyGoal"));
  if (monthlyGoal === null) throw new Error("Monthly goal is required.");

  // Latest-starting open segment — the same row the dashboard calls "active",
  // so Adjust always edits the goal the dialog just showed.
  const [active] = await db
    .select()
    .from(savingsGoals)
    .where(and(eq(savingsGoals.groupId, groupId), isNull(savingsGoals.endMonth)))
    .orderBy(desc(savingsGoals.startMonth), desc(savingsGoals.id))
    .limit(1);

  const startMonth =
    normalizeMonth(formData.get("startMonth")) ??
    active?.startMonth ??
    normalizeMonth(new Date().toISOString())!;

  const takeHome = await takeHomePart(groupId, monthlyGoal, startMonth);
  if (active) {
    await db
      .update(savingsGoals)
      .set({ monthlyGoal: takeHome, startMonth })
      .where(eq(savingsGoals.id, active.id));
  } else {
    await db.insert(savingsGoals).values({ groupId, monthlyGoal: takeHome, startMonth });
  }
  revalidatePath(FINANCE, "layout");
}

/**
 * Start a NEW goal segment from a month (raise season). INSERT the new segment
 * FIRST, then end-date the old — a crash between the two leaves a harmless
 * overlap (latest-starting wins) instead of a hole.
 */
export async function startSavingsGoalAction(formData: FormData): Promise<void> {
  await requireEditor();
  const groupId = await requireGroupId();

  const monthlyGoal = money(formData.get("monthlyGoal"));
  const startMonth = normalizeMonth(formData.get("startMonth"));
  if (monthlyGoal === null || !startMonth) {
    throw new Error("Monthly goal and start month are required.");
  }

  const [active] = await db
    .select()
    .from(savingsGoals)
    .where(and(eq(savingsGoals.groupId, groupId), isNull(savingsGoals.endMonth)))
    .limit(1);

  await db
    .insert(savingsGoals)
    .values({ groupId, monthlyGoal: await takeHomePart(groupId, monthlyGoal, startMonth), startMonth });

  if (active && active.startMonth < startMonth) {
    // Previous segment ends the month before the new one starts.
    const d = new Date(`${startMonth}T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - 1);
    const endMonth = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
    await db
      .update(savingsGoals)
      .set({ endMonth })
      .where(eq(savingsGoals.id, active.id));
  } else if (active) {
    // New segment starts at/before the old one — the old row is superseded
    // entirely; close it out at its own start so it can't shadow anything.
    await db
      .update(savingsGoals)
      .set({ endMonth: active.startMonth })
      .where(eq(savingsGoals.id, active.id));
  }
  revalidatePath(FINANCE, "layout");
}
