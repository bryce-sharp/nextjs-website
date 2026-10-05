// Read-only check of the bills' match patterns (Atlas) against the bank's own
// wording, using the history bank sync stored. Uses the sync's real rules, so it
// shows what bank sync would do with each charge if it arrived today:
//   1. every current bill: what its patterns catch in the bank's text
//   2. payments the ledger filed under a bill that the patterns would miss,
//      with a suggested pattern
//   3. charges that repeat month after month that no bill catches
//   4. patterns several bills share (the amount picks between them)
//
//   node scripts/bill-audit.mjs                    (dev database)
//   node scripts/live.mjs scripts/bill-audit.mjs   (live database)
//   --months 24        look further back (default 12)
//   --try "PATTERN"    instead, list every bank row a pattern would catch and
//                      where bank sync files it today (repeatable)
//
// Nothing is written.

import "./node-hooks.mjs";
import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";

config({ path: ".env.local", quiet: true });

const url = process.env.POSTGRES_URL_NON_POOLING ?? process.env.POSTGRES_URL;
if (!url) {
  console.error("POSTGRES_URL is not set — check .env.local");
  process.exit(1);
}
const sql = neon(url);

const { categorizeMerchant } = await import("../lib/finance/sms.ts");
const { bankKind } = await import("../lib/plaid/map.ts");
const { longestMatchingRule } = await import("../lib/finance/categorize.ts");

const args = process.argv.slice(2);
const flagAt = args.indexOf("--months");
const months = flagAt >= 0 ? Number(args[flagAt + 1]) : 12;
if (!Number.isInteger(months) || months < 1 || months > 24) {
  console.error("--months must be a whole number from 1 to 24");
  process.exit(1);
}
const tries = args.flatMap((a, i) => (a === "--try" && args[i + 1] ? [args[i + 1]] : []));

const today = new Date().toISOString().slice(0, 10);
const since = (() => {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
})();
const DAY = 86_400_000;
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
const money = (n) => (n == null || Number.isNaN(n) ? "" : Number(n).toFixed(2));
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const clip = (s, n = 60) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const every = (perYear) =>
  ({ 1: "yearly", 2: "twice a year", 4: "quarterly", 12: "monthly", 24: "twice a month", 26: "every 2 weeks", 52: "weekly" })[perYear] ??
  `${perYear}/yr`;

/** The bank text's words before the first one carrying a number (store and phone numbers, reference codes). */
function leadingWords(text) {
  const kept = [];
  for (const word of text.trim().split(/\s+/)) {
    if (kept.length && /[\d#]/.test(word)) break;
    kept.push(word);
  }
  return kept.join(" ").toUpperCase();
}

function commonWordPrefix(texts) {
  const split = texts.map((t) => t.split(" "));
  const out = [];
  for (let i = 0; split[0][i] && split.every((s) => s[i] === split[0][i]); i++) out.push(split[0][i]);
  return out.join(" ");
}

const contains = (row, pattern) => {
  const p = pattern.toLowerCase();
  return row.name.toLowerCase().includes(p) || Boolean(row.merchant_name?.toLowerCase().includes(p));
};

async function auditGroup(groupId) {
  const bills = await sql`
    SELECT id, name, amount::float8 AS amount, payments_per_year, merchant_patterns, is_estimate,
           paid_from_account_id, start_date::text AS start_date, end_date::text AS end_date
    FROM recurring_expenses WHERE group_id = ${groupId} ORDER BY name, start_date`;
  const accounts = await sql`
    SELECT fa.id, fa.name, fa.kind, fa.transfer_patterns, fa.archived_at IS NOT NULL AS archived,
           EXISTS (SELECT 1 FROM plaid_accounts pa WHERE pa.financial_account_id = fa.id) AS connected
    FROM financial_accounts fa WHERE fa.group_id = ${groupId}`;
  const bank = await sql`
    SELECT pt.id, pa.financial_account_id AS account_id, pa.type AS account_type, pt.amount::float8 AS amount,
           coalesce(pt.authorized_date, pt.date)::text AS date, pt.name, pt.merchant_name,
           pt.pfc_primary, pt.pfc_detailed, pt.ledger_transaction_id, pt.split_ledger_ids
    FROM plaid_transactions pt
    JOIN plaid_accounts pa ON pa.id = pt.plaid_account_id
    JOIN plaid_items pi ON pi.id = pa.plaid_item_id
    WHERE pi.group_id = ${groupId} AND pa.financial_account_id IS NOT NULL
      AND pt.removed_at IS NULL AND NOT pt.pending
      AND coalesce(pt.authorized_date, pt.date) >= ${since}
    ORDER BY coalesce(pt.authorized_date, pt.date), pt.id`;
  const linked = await sql`
    SELECT t.id, t.posted_on::text AS date, t.merchant, t.original_amount::float8 AS amount,
           t.source, t.recurring_expense_id, t.account_id
    FROM transactions t
    WHERE t.group_id = ${groupId} AND t.recurring_expense_id IS NOT NULL AND t.posted_on >= ${since}
      AND t.account_id IN (SELECT financial_account_id FROM plaid_accounts WHERE financial_account_id IS NOT NULL)
    ORDER BY t.posted_on, t.id`;

  if (!bank.length) {
    console.log(`No posted bank rows since ${since}.`);
    return;
  }
  const accountName = new Map(accounts.map((a) => [a.id, a.name]));
  const billById = new Map(bills.map((b) => [b.id, b]));
  const current = bills.filter((b) => b.start_date <= today && (b.end_date === null || b.end_date >= today));
  const nameKey = (b) => b.name.trim().toLowerCase();
  const currentByName = new Map(current.map((b) => [nameKey(b), b]));

  // What bank sync would do with each row today (lib/plaid/apply.ts, insertCategorized).
  const rules = current.map((b) => ({
    recurringExpenseId: b.id,
    paymentsPerYear: b.payments_per_year,
    patterns: b.merchant_patterns ?? [],
    category: null,
    amount: b.amount,
  }));
  const transferRules = accounts
    .filter((a) => !a.archived && a.kind !== "wallet")
    .flatMap((a) => (a.transfer_patterns ?? []).map((pattern) => ({ pattern, accountId: a.id })));
  const routeOf = new Map();
  for (const row of bank) {
    const kind = bankKind({
      amount: row.amount,
      pfcPrimary: row.pfc_primary,
      pfcDetailed: row.pfc_detailed,
      accountType: row.account_type,
      name: row.name,
    });
    let route = { kind, billId: null };
    if (kind === "spend") {
      if (longestMatchingRule(row.name, transferRules.filter((t) => t.accountId !== row.account_id))) {
        route = { kind: "transfer words", billId: null };
      } else {
        const paid = Math.abs(row.amount);
        let bill = categorizeMerchant(row.name, rules, paid);
        if (bill.recurringExpenseId === null && row.merchant_name) bill = categorizeMerchant(row.merchant_name, rules, paid);
        route = { kind, billId: bill.recurringExpenseId };
      }
    }
    routeOf.set(row.id, route);
  }

  const kinds = {};
  for (const r of routeOf.values()) kinds[r.kind] = (kinds[r.kind] ?? 0) + 1;
  console.log(`Posted bank rows since ${since}: ${bank.length} (${Object.entries(kinds).map(([k, n]) => `${n} ${k}`).join(", ")})\n`);

  // Each bill-linked ledger row's bank copy: the row bank sync linked, else the
  // same amount on the same account within 5 days.
  const owned = new Map();
  const used = new Set();
  for (const row of bank) {
    if (row.ledger_transaction_id) owned.set(row.ledger_transaction_id, { row, split: Boolean(row.split_ledger_ids?.length) });
    for (const id of row.split_ledger_ids ?? []) owned.set(id, { row, split: true });
    if (row.ledger_transaction_id) used.add(row.id);
  }
  const perBill = new Map(); // current bill id -> { payments, found, caught, splits, misses: [] }
  const billCopies = new Map(); // bank row id -> the bill its ledger copy is filed under
  for (const t of linked) {
    const segment = billById.get(t.recurring_expense_id);
    const bill = segment && currentByName.get(nameKey(segment));
    if (!bill) continue; // the bill has ended
    const stats = perBill.get(bill.id) ?? { payments: 0, found: 0, caught: 0, splits: 0, misses: [] };
    perBill.set(bill.id, stats);
    stats.payments++;
    let copy = owned.get(t.id) ?? null;
    if (!copy) {
      let best = null;
      for (const row of bank) {
        if (used.has(row.id) || row.account_id !== t.account_id) continue;
        if (Math.abs(Math.abs(row.amount) - Math.abs(t.amount)) > 0.005) continue;
        const gap = Math.abs(daysBetween(t.date, row.date));
        if (gap <= 5 && (!best || gap < best.gap)) best = { row, gap };
      }
      if (best) {
        used.add(best.row.id);
        copy = { row: best.row, split: false };
      }
    }
    if (!copy) continue;
    stats.found++;
    billCopies.set(copy.row.id, bill);
    if (copy.split) {
      stats.splits++;
      continue;
    }
    const route = routeOf.get(copy.row.id);
    if (route.billId === bill.id) stats.caught++;
    else stats.misses.push({ ledger: t, row: copy.row, route });
  }

  if (tries.length) {
    for (const pattern of tries) {
      const rows = bank.filter((r) => contains(r, pattern));
      console.log(`TRY "${pattern}": ${rows.length} bank rows since ${since} contain it`);
      if (!rows.length) continue;
      console.table(
        rows.map((r) => {
          const route = routeOf.get(r.id);
          return {
            date: r.date,
            account: accountName.get(r.account_id),
            amount: money(r.amount),
            text: r.name,
            merchant: clip(r.merchant_name ?? "", 30),
            plaid: r.pfc_detailed ?? "",
            "files under today":
              route.billId != null ? billById.get(route.billId).name : route.kind === "spend" ? "no bill" : route.kind,
            "ledger bill": billCopies.get(r.id)?.name ?? "",
          };
        }),
      );
    }
    return;
  }

  // 1. Current bills.
  const caughtBy = new Map();
  for (const row of bank) {
    const id = routeOf.get(row.id).billId;
    if (id != null) caughtBy.set(id, [...(caughtBy.get(id) ?? []), row]);
  }
  console.log(`1. CURRENT BILLS: what the patterns catch in the bank's text since ${since}`);
  console.log("   pattern (n) = bank rows containing it; caught = rows bank sync would file under the bill");
  console.table(
    current.map((b) => {
      const rows = caughtBy.get(b.id) ?? [];
      const expected = (b.payments_per_year * months) / 12;
      const typical = median(rows.map((r) => Math.abs(r.amount)));
      const paidFrom = accounts.find((a) => a.id === b.paid_from_account_id);
      const notes = [];
      if (paidFrom && !paidFrom.connected) notes.push(`paid from ${paidFrom.name} (not connected)`);
      if (!(b.merchant_patterns ?? []).length) notes.push("no patterns");
      else if (!rows.length && paidFrom?.connected !== false) notes.push("catches nothing");
      if (rows.length > expected * 1.5 + 1) notes.push("catches more than expected");
      if (rows.length >= 2 && !b.is_estimate && Math.abs(typical - b.amount) / b.amount > 0.15) notes.push(`bank usually ${money(typical)}`);
      return {
        id: b.id,
        bill: clip(b.name, 28),
        every: every(b.payments_per_year),
        amount: money(b.amount),
        patterns: clip((b.merchant_patterns ?? []).map((p) => `${p} (${bank.filter((r) => contains(r, p)).length})`).join(" | ") || "-", 70),
        expected: Math.round(expected),
        caught: rows.length,
        typical: money(typical),
        notes: notes.join("; "),
      };
    }),
  );

  // 2. Ledger payments the patterns would miss.
  const missRows = [];
  for (const [billId, stats] of perBill) {
    if (!stats.misses.length) continue;
    const bill = billById.get(billId);
    const why = new Set(
      stats.misses.map(({ route }) => {
        if (route.kind === "transfer") return "bank calls it a transfer (patterns never apply)";
        if (route.kind === "transfer words") return "an account's transfer words catch it first";
        if (route.kind !== "spend") return `bank calls it ${route.kind}`;
        if (route.billId != null) return `goes to ${billById.get(route.billId)?.name}`;
        return "no pattern matches";
      }),
    );
    const unmatched = stats.misses.filter(({ route }) => route.kind === "spend" && route.billId == null).map((m) => m.row);
    let suggestion = "";
    if (unmatched.length) {
      const firsts = [...new Set(unmatched.map((r) => leadingWords(r.name)))];
      const common = commonWordPrefix(firsts);
      const picks = firsts.length > 1 && common.length >= 4 ? [common] : firsts;
      suggestion = picks
        .map((p) => {
          const others = bank.filter((r) => !billCopies.has(r.id) && routeOf.get(r.id).kind === "spend" && contains(r, p));
          return others.length ? `${p} (also ${others.length} other)` : p;
        })
        .join(" | ");
    }
    missRows.push({
      id: billId,
      bill: clip(bill.name, 28),
      payments: stats.payments,
      "bank copy": stats.found,
      caught: stats.caught,
      split: stats.splits,
      missed: stats.misses.length,
      why: [...why].join("; "),
      "bank text": clip([...new Set(stats.misses.map((m) => `${m.row.name}${m.row.merchant_name ? ` [${m.row.merchant_name}]` : ""}`))].slice(0, 2).join(" / "), 70),
      suggest: suggestion,
    });
  }
  console.log(`2. PAYMENTS FILED UNDER A BILL THAT ITS PATTERNS WOULD MISS IN THE BANK'S TEXT: ${missRows.length} bills`);
  console.log("   payments = ledger rows on connected accounts; bank copy = found in bank history; split = recorded in parts");
  if (missRows.length) console.table(missRows);
  const noCopy = [...perBill].filter(([, s]) => s.found < s.payments);
  if (noCopy.length) {
    console.log("   Ledger payments with no bank copy (amount or date differs, or the bank never saw it):");
    console.log(`   ${noCopy.map(([id, s]) => `${billById.get(id).name} ${s.payments - s.found}`).join(", ")}`);
  }
  console.log();

  // 3. Repeating charges no bill catches.
  const groups = new Map();
  for (const row of bank) {
    const route = routeOf.get(row.id);
    if (route.kind !== "spend" || route.billId != null || billCopies.has(row.id) || row.amount <= 0) continue;
    const key = (row.merchant_name ?? leadingWords(row.name)).toUpperCase();
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const BILLISH = new Set(["RENT_AND_UTILITIES", "LOAN_PAYMENTS", "GOVERNMENT_AND_NON_PROFIT", "BANK_FEES"]);
  const repeating = [];
  for (const [key, rows] of groups) {
    const monthsSeen = new Set(rows.map((r) => r.date.slice(0, 7))).size;
    const last = rows[rows.length - 1];
    if (monthsSeen < 3 || rows.length > monthsSeen * 2.5 || daysBetween(last.date, today) > 62) continue;
    const typical = median(rows.map((r) => r.amount));
    const steady = rows.filter((r) => Math.abs(r.amount - typical) <= typical * 0.1).length / rows.length >= 0.6;
    // Outside bill-like categories, only a steady charge about once a month for 4+ months looks like a bill.
    if (!BILLISH.has(last.pfc_primary) && (!steady || monthsSeen < 4 || rows.length > monthsSeen * 1.3)) continue;
    repeating.push({
      merchant: clip(key, 30),
      account: [...new Set(rows.map((r) => accountName.get(r.account_id)))].join(", "),
      months: monthsSeen,
      count: rows.length,
      typical: money(typical),
      steady: steady ? "yes" : "no",
      last: last.date,
      plaid: last.pfc_detailed ?? "",
      "bank text": clip(last.name, 40),
      suggest: leadingWords(last.name),
    });
  }
  repeating.sort((a, b) => b.months - a.months || Number(b.typical) - Number(a.typical));
  console.log(`3. CHARGES THAT REPEAT AND STILL APPEAR (seen in the last 2 months) THAT NO BILL CATCHES: ${repeating.length}`);
  console.log("   bill-like Plaid categories from 3 months; others need a steady amount about monthly for 4+ months");
  if (repeating.length) console.table(repeating.slice(0, 50));
  console.log();

  // 4. Patterns several bills share.
  const byPattern = new Map();
  for (const b of current) {
    for (const p of b.merchant_patterns ?? []) {
      const k = p.trim().toLowerCase();
      if (k) byPattern.set(k, [...(byPattern.get(k) ?? []), b]);
    }
  }
  const shared = [...byPattern]
    .filter(([, bs]) => new Set(bs.map((b) => b.id)).size > 1)
    .map(([pattern, bs]) => {
      const amounts = bs.map((b) => b.amount).sort((a, b) => a - b);
      const close = amounts.some((a, i) => i > 0 && amounts[i - 1] / a > 0.85);
      return {
        pattern,
        bills: bs.map((b) => `${b.name} ${money(b.amount)}`).join(" | "),
        note: close ? "amounts within 15%: the amount cannot reliably tell them apart" : "the closer amount wins",
      };
    });
  console.log(`4. PATTERNS SHARED BY SEVERAL CURRENT BILLS: ${shared.length}`);
  if (shared.length) console.table(shared);
}

async function main() {
  console.log(`database host: ${new URL(url).hostname}`);
  const groups = await sql`SELECT DISTINCT group_id FROM plaid_items ORDER BY group_id`;
  if (!groups.length) {
    console.log("No banks connected.");
    return;
  }
  for (const { group_id } of groups) {
    if (groups.length > 1) console.log(`\n=== household ${group_id} ===`);
    console.log();
    await auditGroup(group_id);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
