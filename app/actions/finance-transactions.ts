"use server";

import { revalidatePath } from "next/cache";
import { requireEditor } from "@/lib/auth";
import { requireGroupId } from "@/lib/session";
import {
  getTransactionDetail,
  searchTransactions,
  type TxnDetail,
  type TxnFilters,
  type TxnPage,
} from "@/lib/queries/finance-transactions";
import {
  setSpendCategoryForGroup,
  type SetCategoryResult,
} from "@/lib/queries/finance-categories";

// The explorer's "load more" — the client hands back the filters it's showing
// plus the last cursor; we re-derive the group from the session (never trust a
// client-supplied group) and return the next page. Read-only, so no revalidate.
export async function loadMoreTransactionsAction(
  filters: TxnFilters,
  cursor: string | null,
): Promise<TxnPage> {
  return searchTransactions(filters, cursor);
}

/** One transaction's details for its popup: where it came from, when, and the bank's wording. */
export async function getTransactionDetailAction(id: number): Promise<TxnDetail | null> {
  return getTransactionDetail(await requireGroupId(), id);
}

/**
 * Tag (or clear) one transaction's spend-category inline. `applyToMerchant`
 * also teaches the merchant → category rule and sweeps its siblings. The client
 * updates its own list optimistically; we still revalidate the budget page so
 * its chips reflect the change on next view.
 */
export async function setSpendCategoryAction(
  txnId: number,
  category: string | null,
  applyToMerchant: boolean,
): Promise<SetCategoryResult> {
  await requireEditor();
  const groupId = await requireGroupId();
  const clean = category && category.trim() ? category.trim().slice(0, 40) : null;
  const result = await setSpendCategoryForGroup(groupId, txnId, clean, applyToMerchant);
  revalidatePath("/finance");
  revalidatePath("/finance/transactions");
  return result;
}
