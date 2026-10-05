// Pure spend-category resolution (F4c). Mirrors the SMS merchant matcher: a
// case-insensitive substring, longest pattern wins. Dependency-free so it's
// shared by ingest, the backfill, manual "apply to all", and tests.

import { flowOf, type Flow } from "@/lib/finance/cashflow";

/** A merchant → tag rule; `flow` says which side of the ledger it tags. */
export type SpendRule = { pattern: string; category: string; flow?: Flow };

/** The rule that governs a merchant: longest matching pattern wins (so a
 *  specific "WM SUPERCENTER #4279" override beats a broad "WALMART"). Null if
 *  no rule matches — the merchant is "ungrouped". */
export function longestMatchingRule<T extends SpendRule>(
  merchant: string,
  rules: T[],
): T | null {
  const m = merchant.toLowerCase();
  let best: T | null = null;
  for (const r of rules) {
    if (!r.pattern) continue;
    if (m.includes(r.pattern.toLowerCase())) {
      if (!best || r.pattern.length > best.pattern.length) best = r;
    }
  }
  return best;
}

/** Only the rules for one side of the ledger (legacy rules without a flow are spending). */
export function rulesForFlow<T extends SpendRule>(rules: T[], flow: Flow): T[] {
  return rules.filter((r) => (r.flow ?? "out") === flow);
}

/**
 * The tag for a transaction:
 *  - fixed / amortized → the linked bill's ATLAS category, else a spending rule
 *  - other money out (discretionary, savings, fund) → the longest spending rule
 *  - income → the longest income rule
 *  - reimbursement → null: it takes the tag of what it pays back, picked by hand
 *  - Excluded → null (never counted, so never tagged)
 */
export function spendCategoryFor(
  engineCategory: string,
  merchant: string | null,
  billCategory: string | null,
  rules: SpendRule[],
): string | null {
  const flow = flowOf(engineCategory);
  if (!flow || engineCategory === "reimbursement") return null;
  if ((engineCategory === "fixed" || engineCategory === "amortized") && billCategory) {
    return billCategory;
  }
  if (!merchant) return null;
  return longestMatchingRule(merchant, rulesForFlow(rules, flow))?.category ?? null;
}
