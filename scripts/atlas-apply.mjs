// Apply a reviewed list of Atlas bill changes: the edits the Atlas page makes
// (add match patterns, fix a bill in place, add a bill) plus filing ledger rows
// under a bill or re-tagging them, as the History page does. For when an audit (bill-audit.mjs)
// turns up several at once. The list lives in a JSON file outside the repo, since
// it holds household details. Dry run by default; --yes writes.
//
//   node scripts/live.mjs scripts/atlas-apply.mjs <changes.json> [--yes]
//
// The file is a JSON list; each entry is one of:
//   { "bill": 11, "addPatterns": ["TEXT"] }
//   { "bill": 1, "fix": { "amount": 84.37, "dueMonths": [1, 7] } }    the whole span, like Atlas "fix"
//      (fix also takes name, paymentsPerYear, isEstimate, and paidFrom: an account's name)
//   { "add": { "like": 1, "name": "…", "amount": 16.23, "paymentsPerYear": 12, "dueMonths": null,
//              "from": "2026-09" } }                                  copies the rest from bill "like"
//   { "refile": [2101, 2102], "toBill": 17 }                          toBill may be a current bill's name
//   { "retag": [1260], "tag": "Dining" }                              set the tag (never on transfers)

import fs from "node:fs";
import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";

config({ path: ".env.local", quiet: true });

const url = process.env.POSTGRES_URL_NON_POOLING ?? process.env.POSTGRES_URL;
if (!url) {
  console.error("POSTGRES_URL is not set — check .env.local");
  process.exit(1);
}
const sql = neon(url);

const file = process.argv.slice(2).find((a) => !a.startsWith("--"));
const write = process.argv.includes("--yes");
if (!file) {
  console.error("Usage: node scripts/atlas-apply.mjs <changes.json> [--yes]");
  process.exit(1);
}
const changes = JSON.parse(fs.readFileSync(file, "utf8"));
if (!Array.isArray(changes) || !changes.length) {
  console.error("The file must hold a non-empty JSON list of changes.");
  process.exit(1);
}

const money = (n) => Number(n).toFixed(2);
const months = (m) => (m?.length ? `[${m.join(", ")}]` : "evenly spaced");
const list = (p) => (p?.length ? p.map((x) => `"${x}"`).join(", ") : "none");
const isMonthList = (m) => m === null || (Array.isArray(m) && m.every((n) => Number.isInteger(n) && n >= 1 && n <= 12));

async function main() {
  console.log(`database host: ${new URL(url).hostname}`);
  console.log(write ? "Writing.\n" : "Dry run: nothing is written. Add --yes to apply.\n");

  const today = new Date().toISOString().slice(0, 10);
  const bills = await sql`
    SELECT id, group_id, name, category, necessity, amount::float8 AS amount, payments_per_year, due_months,
           due_day, paid_from_account_id, is_estimate, merchant_patterns, notes,
           start_date::text AS start_date, end_date::text AS end_date
    FROM recurring_expenses`;
  const byId = new Map(bills.map((b) => [b.id, b]));
  const accounts = await sql`SELECT id, group_id, name, archived_at IS NOT NULL AS archived FROM financial_accounts`;
  const accountName = (id) => accounts.find((a) => a.id === id)?.name ?? "no account";
  const groups = new Set();
  const billFor = (id) => {
    const b = byId.get(id);
    if (!b) throw new Error(`No bill ${id}.`);
    groups.add(b.group_id);
    return b;
  };
  const added = new Map(); // name (lowercase) -> planned or inserted bill

  for (const [i, c] of changes.entries()) {
    const n = `${i + 1}.`;
    if (c.addPatterns) {
      const b = billFor(c.bill);
      const have = b.merchant_patterns ?? [];
      const fresh = c.addPatterns
        .map((p) => String(p).trim())
        .filter((p) => p && !have.some((h) => h.toLowerCase() === p.toLowerCase()));
      if (!fresh.length) {
        console.log(`${n} ${b.name} (bill ${b.id}): already has ${list(c.addPatterns)}.`);
        continue;
      }
      const next = [...have, ...fresh];
      console.log(`${n} ${b.name} (bill ${b.id}): patterns ${list(have)} -> ${list(next)}`);
      if (write) await sql`UPDATE recurring_expenses SET merchant_patterns = ${JSON.stringify(next)}::jsonb WHERE id = ${b.id}`;
    } else if (c.fix) {
      const b = billFor(c.bill);
      const f = c.fix;
      const unknown = Object.keys(f).filter(
        (k) => !["amount", "name", "paymentsPerYear", "dueMonths", "isEstimate", "paidFrom"].includes(k),
      );
      if (unknown.length) throw new Error(`${n} fix cannot change ${unknown.join(", ")}.`);
      if ("dueMonths" in f && !isMonthList(f.dueMonths)) throw new Error(`${n} dueMonths must be months 1-12 or null.`);
      if ("amount" in f && !(Number(f.amount) > 0)) throw new Error(`${n} amount must be positive.`);
      let paidFrom = b.paid_from_account_id;
      if ("paidFrom" in f) {
        const wanted = String(f.paidFrom).toLowerCase();
        const acct = accounts.find(
          (a) => a.group_id === b.group_id && !a.archived && (a.id === f.paidFrom || a.name.toLowerCase() === wanted),
        );
        if (!acct) throw new Error(`${n} no open account "${f.paidFrom}" in this household.`);
        paidFrom = acct.id;
      }
      const next = {
        name: f.name ?? b.name,
        amount: "amount" in f ? Number(f.amount) : b.amount,
        paymentsPerYear: f.paymentsPerYear ?? b.payments_per_year,
        dueMonths: "dueMonths" in f ? f.dueMonths : b.due_months,
        isEstimate: f.isEstimate ?? b.is_estimate,
      };
      const diff = [
        next.name !== b.name && `name "${b.name}" -> "${next.name}"`,
        next.amount !== b.amount && `amount ${money(b.amount)} -> ${money(next.amount)}`,
        next.paymentsPerYear !== b.payments_per_year && `payments a year ${b.payments_per_year} -> ${next.paymentsPerYear}`,
        months(next.dueMonths) !== months(b.due_months) && `due months ${months(b.due_months)} -> ${months(next.dueMonths)}`,
        next.isEstimate !== b.is_estimate && `estimate ${b.is_estimate} -> ${next.isEstimate}`,
        paidFrom !== b.paid_from_account_id &&
          `paid from ${accountName(b.paid_from_account_id)} -> ${accountName(paidFrom)}`,
      ].filter(Boolean);
      if (!diff.length) {
        console.log(`${n} ${b.name} (bill ${b.id}): already up to date.`);
        continue;
      }
      console.log(`${n} ${b.name} (bill ${b.id}, ${b.start_date} on): ${diff.join("; ")}`);
      if (write) {
        await sql`
          UPDATE recurring_expenses
          SET name = ${next.name}, amount = ${money(next.amount)}, payments_per_year = ${next.paymentsPerYear},
              due_months = ${next.dueMonths?.length ? JSON.stringify(next.dueMonths) : null}::jsonb,
              is_estimate = ${next.isEstimate}, paid_from_account_id = ${paidFrom}
          WHERE id = ${b.id}`;
      }
    } else if (c.add) {
      const a = c.add;
      const like = billFor(a.like);
      const from = /^\d{4}-\d{2}$/.test(a.from ?? "") ? `${a.from}-01` : null;
      if (!a.name || !(Number(a.amount) > 0) || !from) throw new Error(`${n} add needs like, name, amount, and from (YYYY-MM).`);
      if (!isMonthList(a.dueMonths ?? null)) throw new Error(`${n} dueMonths must be months 1-12 or null.`);
      const exists = bills.find(
        (b) => b.group_id === like.group_id && b.name.toLowerCase() === a.name.toLowerCase() && (b.end_date === null || b.end_date >= today),
      );
      if (exists) {
        console.log(`${n} "${a.name}" already exists (bill ${exists.id}).`);
        added.set(a.name.toLowerCase(), exists);
        continue;
      }
      const row = {
        group_id: like.group_id,
        name: a.name,
        category: like.category,
        necessity: like.necessity,
        amount: Number(a.amount),
        payments_per_year: a.paymentsPerYear ?? like.payments_per_year,
        due_months: a.dueMonths ?? null,
        due_day: a.dueDay ?? null,
        paid_from_account_id: like.paid_from_account_id,
        is_estimate: a.isEstimate ?? like.is_estimate,
        merchant_patterns: a.patterns ?? like.merchant_patterns ?? [],
        start_date: from,
      };
      console.log(
        `${n} add "${row.name}": ${money(row.amount)}, ${row.payments_per_year} a year, due ${months(row.due_months)}, ` +
          `from ${from}, patterns ${list(row.merchant_patterns)} (category, account, and necessity from "${like.name}")`,
      );
      if (write) {
        const [inserted] = await sql`
          INSERT INTO recurring_expenses (group_id, name, category, necessity, amount, payments_per_year, due_months,
                                          due_day, paid_from_account_id, is_estimate, merchant_patterns, start_date)
          VALUES (${row.group_id}, ${row.name}, ${row.category}, ${row.necessity}, ${money(row.amount)},
                  ${row.payments_per_year}, ${row.due_months?.length ? JSON.stringify(row.due_months) : null}::jsonb,
                  ${row.due_day}, ${row.paid_from_account_id}, ${row.is_estimate},
                  ${JSON.stringify(row.merchant_patterns)}::jsonb, ${row.start_date})
          RETURNING id, group_id, name, category, payments_per_year`;
        console.log(`   added as bill ${inserted.id}`);
        added.set(row.name.toLowerCase(), inserted);
      } else {
        added.set(row.name.toLowerCase(), { ...row, id: null });
      }
    } else if (c.refile) {
      const target =
        typeof c.toBill === "number"
          ? billFor(c.toBill)
          : (added.get(String(c.toBill).toLowerCase()) ??
            bills.find((b) => b.name.toLowerCase() === String(c.toBill).toLowerCase() && (b.end_date === null || b.end_date >= today)));
      if (!target) throw new Error(`${n} no current bill named "${c.toBill}".`);
      groups.add(target.group_id);
      const lane = target.payments_per_year === 12 ? "fixed" : "amortized";
      const rows = await sql`
        SELECT t.id, t.group_id, t.posted_on::text AS date, t.merchant, t.amount::text AS amount, t.category,
               coalesce(r.name, '') AS bill
        FROM transactions t LEFT JOIN recurring_expenses r ON r.id = t.recurring_expense_id
        WHERE t.id = ANY(${c.refile})`;
      for (const id of c.refile) {
        const t = rows.find((r) => r.id === id);
        if (!t) throw new Error(`${n} no transaction ${id}.`);
        if (t.group_id !== target.group_id) throw new Error(`${n} transaction ${id} belongs to another household.`);
        if (!["discretionary", "fixed", "amortized"].includes(t.category)) {
          throw new Error(`${n} transaction ${id} is ${t.category}; only spending can be filed under a bill.`);
        }
        console.log(`${n} ${t.date} ${t.merchant} ${t.amount}: ${t.bill || t.category} -> ${target.name} (${lane})`);
      }
      if (write) {
        if (target.id == null) throw new Error(`${n} the bill "${target.name}" was not added.`);
        await sql`
          UPDATE transactions
          SET recurring_expense_id = ${target.id}, category = ${lane}, needs_review = false,
              spend_category = coalesce(spend_category, ${target.category})
          WHERE id = ANY(${c.refile})`;
      }
    } else if (c.retag) {
      const tag = String(c.tag ?? "").trim().slice(0, 40);
      if (!tag) throw new Error(`${n} retag needs a tag.`);
      const rows = await sql`
        SELECT id, group_id, posted_on::text AS date, merchant, amount::text AS amount, category,
               coalesce(spend_category, 'untagged') AS tag
        FROM transactions WHERE id = ANY(${c.retag})`;
      for (const id of c.retag) {
        const t = rows.find((r) => r.id === id);
        if (!t) throw new Error(`${n} no transaction ${id}.`);
        if (t.category === "transfer") throw new Error(`${n} transaction ${id} is a transfer; transfers are never tagged.`);
        groups.add(t.group_id);
        console.log(`${n} ${t.date} ${t.merchant} ${t.amount} (${t.category}): ${t.tag} -> ${tag}`);
      }
      if (new Set(rows.map((r) => r.group_id)).size > 1) throw new Error(`${n} the rows belong to different households.`);
      if (write) await sql`UPDATE transactions SET spend_category = ${tag} WHERE id = ANY(${c.retag}) AND category <> 'transfer'`;
    } else {
      throw new Error(`${n} unknown change: ${JSON.stringify(c)}`);
    }
  }
  if (groups.size > 1) console.log(`\nNote: these changes touch ${groups.size} households.`);
  console.log(write ? "\nDone." : "\nDry run only.");
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
