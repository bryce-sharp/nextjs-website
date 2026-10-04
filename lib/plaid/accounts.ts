// Which app account a newly connected bank account should feed. Pure, so it
// can be checked directly with node. A suggestion needs the same kind (a credit
// card feeds a credit_card account, checking feeds checking) AND exactly one
// candidate whose name shares a word with the bank or account name ("Ally
// Checking" for Ally's checking). Anything less stays unmapped for the owner
// to pick, because a wrong guess would file transactions under the wrong account.

export type BankAccountLike = { type: string; subtype: string | null; name: string };
export type AppAccountLike = { id: number; name: string; kind: string };

const KIND_BY_SUBTYPE: Record<string, string> = {
  checking: "checking",
  savings: "savings",
  "money market": "savings",
  cd: "savings",
  hsa: "hsa",
  brokerage: "brokerage",
  "401k": "retirement",
  "403b": "retirement",
  ira: "retirement",
  roth: "retirement",
  "roth 401k": "retirement",
};

/** The financial_accounts.kind a Plaid account corresponds to, or null. */
export function appKindFor(type: string, subtype: string | null): string | null {
  if (type === "credit") return "credit_card";
  return (subtype && KIND_BY_SUBTYPE[subtype]) || null;
}

// Words every bank uses, so they say nothing about WHICH bank ("Chase Checking"
// vs "Ally Checking" must not match on "checking").
const GENERIC = new Set([
  "account", "bank", "card", "checking", "credit", "high", "interest", "market",
  "money", "online", "plus", "rewards", "savings", "the", "yield",
]);

const words = (s: string) =>
  s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !GENERIC.has(w));

/** The suggested app account id, skipping accounts already fed by another bank account. */
export function suggestAccount(
  bank: BankAccountLike,
  institutionName: string,
  appAccounts: AppAccountLike[],
  taken: ReadonlySet<number>,
): number | null {
  const kind = appKindFor(bank.type, bank.subtype);
  if (!kind) return null;
  const bankWords = new Set(words(`${institutionName} ${bank.name}`));
  const named = appAccounts.filter(
    (a) => a.kind === kind && !taken.has(a.id) && words(a.name).some((w) => bankWords.has(w)),
  );
  return named.length === 1 ? named[0].id : null;
}
