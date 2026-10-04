// Matching a bank transaction to a row already in the ledger (a card alert, a
// manual add, an import), ported from scripts/reconcile-card.mjs so the bank
// sync claims rows by the same rules the statement reconcile has proven. Pure.

const MS_DAY = 86_400_000;

/** Whole days from b to a (both "YYYY-MM-DD"). */
export function dayGap(a: string, b: string): number {
  return Math.round((Date.parse(a) - Date.parse(b)) / MS_DAY);
}

const tokens = (s: string | null) =>
  (s ?? "").toUpperCase().replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter((t) => t.length >= 3);

/** Rough merchant likeness: alerts and bank feeds spell the same place differently. */
export function likeness(a: string | null, b: string | null): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.length || !tb.length) return 0;
  let score = ta[0].slice(0, 4) === tb[0].slice(0, 4) ? 2 : 0;
  for (const t of ta) if (t.length >= 4 && tb.some((u) => u.startsWith(t.slice(0, 4)))) score += 1;
  return score;
}

export type MatchCandidate = {
  postedOn: string;
  merchant: string | null;
  /** What posted (or alerted), in the ledger's sign. */
  originalAmount: number;
};

export type BankFacts = {
  date: string;
  /** In the ledger's sign. */
  amount: number;
  /** Every spelling the bank gives (raw descriptor, clean merchant name). */
  names: (string | null)[];
};

/**
 * The ledger row a bank transaction should claim, or null. Within -3..+5 days:
 * the same amount wins first (best merchant likeness, then the nearest date;
 * a merchant that shares nothing must be within a day); failing that, the same
 * place at 65-135% of the amount (a tip added after the alert).
 */
export function pickMatch<T extends MatchCandidate>(bank: BankFacts, candidates: T[]): T | null {
  const near = candidates.filter((c) => {
    const gap = dayGap(c.postedOn, bank.date);
    return gap >= -3 && gap <= 5;
  });
  const like = (c: T) => Math.max(0, ...bank.names.map((n) => likeness(n, c.merchant)));
  const best = (pool: T[]) => {
    let top: { c: T; score: number } | null = null;
    for (const c of pool) {
      const score = like(c) * 10 - Math.abs(dayGap(c.postedOn, bank.date));
      if (!top || score > top.score) top = { c, score };
    }
    return top?.c ?? null;
  };

  const exact = near.filter(
    (c) =>
      Math.abs(c.originalAmount - bank.amount) < 0.005 &&
      (like(c) >= 1 || Math.abs(dayGap(c.postedOn, bank.date)) <= 1),
  );
  if (exact.length) return best(exact);
  if (bank.amount <= 0) return null;
  return best(
    near.filter((c) => {
      const ratio = c.originalAmount / bank.amount;
      return ratio >= 0.65 && ratio <= 1.35 && like(c) >= 2;
    }),
  );
}
