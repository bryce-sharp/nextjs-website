// Read-only sanity check of the finance ledger for households with a bank feed:
//   1. bank sync health: connections, rows waiting, stale pending rows, and bank
//      rows since the cutover that never reached the ledger
//   2. rows that break the ledger's rules (signs, links, transfers)
//   3. possible duplicates since the cutover
//   4. this month: Left-to-Spend, bills, money in and out, tags, and funds
// Run it after a change to the sync or the money rules.
//
//   node scripts/finance-check.mjs                    (dev database)
//   node scripts/live.mjs scripts/finance-check.mjs   (live database)
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

const { getBudgetMonthForGroup } = await import("../lib/queries/finance-budget.ts");
const { summarizeCashFlow, cashFlowByCategory, spendByTag } = await import("../lib/queries/finance-cashflow.ts");

const money = (n) => Number(n ?? 0).toFixed(2);
const dollars = (c) => money(c / 100);
const verdict = (n, ok, bad) => (n === 0 ? `OK  ${ok}` : `CHECK  ${bad.replace("{n}", n)}`);

async function checkGroup(groupId) {
  const [g] = await sql`
    SELECT name, timezone, (now() AT TIME ZONE timezone)::date::text AS today FROM groups WHERE id = ${groupId}`;
  const [{ cutover }] = await sql`SELECT min(sync_from)::text AS cutover FROM plaid_items WHERE group_id = ${groupId}`;
  const month = `${g.today.slice(0, 7)}-01`;
  console.log(`\n=== ${g.name} · today ${g.today} · bank cutover ${cutover} ===`);

  // 1. Bank sync.
  console.log("\n1. BANK SYNC");
  console.table(
    await sql`
      SELECT id, institution_name AS bank, environment, status, last_error,
             to_char(last_synced_at AT TIME ZONE ${g.timezone}, 'Mon DD HH24:MI') AS last_synced,
             cursor IS NOT NULL AS has_position
      FROM plaid_items WHERE group_id = ${groupId} ORDER BY id`,
  );
  const [s] = await sql`
    SELECT count(*) FILTER (WHERE pt.applied_at IS NULL AND pa.financial_account_id IS NOT NULL)::int AS waiting,
           count(*) FILTER (WHERE pt.pending AND pt.removed_at IS NULL
                            AND coalesce(pt.authorized_date, pt.date) < ${g.today}::date - 10)::int AS stale_pending
    FROM plaid_transactions pt
    JOIN plaid_accounts pa ON pa.id = pt.plaid_account_id
    JOIN plaid_items pi ON pi.id = pa.plaid_item_id
    WHERE pi.group_id = ${groupId}`;
  // The daily sync runs every morning, so a bank more than 30 hours behind means it stopped.
  const freshness = await sql`
    SELECT pi.institution_name AS bank,
           floor(extract(epoch FROM now() - pi.last_synced_at) / 3600)::int AS hours_since_sync,
           (SELECT to_char(max(e.created_at) AT TIME ZONE ${g.timezone}, 'Mon DD HH24:MI') FROM event_log e
             WHERE e.source = 'plaid' AND e.kind = 'webhook' AND (e.data->>'item')::int = pi.id) AS last_webhook
    FROM plaid_items pi WHERE pi.group_id = ${groupId} ORDER BY pi.id`;
  const behind = freshness.filter((f) => f.hours_since_sync == null || f.hours_since_sync > 30);
  console.log(verdict(behind.length, "every bank synced within the last 30 hours", `{n} banks have not synced in over 30 hours: ${behind.map((f) => f.bank).join(", ")}`));
  for (const f of freshness) {
    console.log(`INFO  ${f.bank}: Plaid last reported changes ${f.last_webhook ?? "never (no webhook on record)"}`);
  }
  console.log(verdict(s.waiting, "every bank row has been filed", "{n} bank rows wait for the ledger step"));
  console.log(verdict(s.stale_pending, "no pending row older than 10 days", "{n} pending rows are older than 10 days"));
  const unfiled = await sql`
    SELECT pi.institution_name AS bank, coalesce(pt.authorized_date, pt.date)::text AS date, pt.amount::text AS amount,
           left(pt.name, 48) AS bank_text, coalesce(pt.pfc_detailed, '') AS plaid
    FROM plaid_transactions pt
    JOIN plaid_accounts pa ON pa.id = pt.plaid_account_id
    JOIN plaid_items pi ON pi.id = pa.plaid_item_id
    WHERE pi.group_id = ${groupId} AND pa.financial_account_id IS NOT NULL
      AND pt.removed_at IS NULL AND pt.dismissed_at IS NULL AND pt.ledger_transaction_id IS NULL
      AND coalesce(pt.authorized_date, pt.date) >= pi.sync_from
    ORDER BY 2`;
  const payments = unfiled.filter((r) => r.plaid === "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT" || /payment/i.test(r.bank_text));
  console.log(`INFO  ${payments.length} card payments since the cutover stay out of the ledger, as designed`);
  const others = unfiled.filter((r) => !payments.includes(r));
  console.log(verdict(others.length, "no other bank row since the cutover is missing from the ledger", "{n} bank rows since the cutover never reached the ledger"));
  if (others.length) console.table(others);

  // 2. Ledger rules.
  console.log("\n2. LEDGER RULES");
  const [r] = await sql`
    SELECT count(*) FILTER (WHERE category IN ('income', 'reimbursement', 'transfer') AND amount < 0)::int AS negative_in,
           count(*) FILTER (WHERE fund_id IS NOT NULL AND category NOT IN ('fund', 'income'))::int AS stray_fund,
           count(*) FILTER (WHERE category = 'transfer'
                            AND ((account_id IS NULL AND transfer_account_id IS NULL) OR account_id = transfer_account_id))::int AS bad_transfer,
           count(*) FILTER (WHERE needs_review)::int AS review
    FROM transactions WHERE group_id = ${groupId}`;
  console.log(verdict(r.negative_in, "income, reimbursements, and transfers are all stored positive", "{n} income, reimbursement, or transfer rows are negative"));
  console.log(verdict(r.stray_fund, "fund links only on fund purchases and income", "{n} rows carry a fund their lane ignores"));
  console.log(verdict(r.bad_transfer, "every transfer names its accounts", "{n} transfers have no account or the same account twice"));
  console.log(verdict(r.review, "nothing waits in Needs review", "{n} rows wait in Needs review"));
  // The card's side of a payment is money in on a credit account; it must never be a ledger row.
  const cardPayments = await sql`
    SELECT t.posted_on::text AS date, t.merchant, t.amount::text AS amount, t.category, pt.pfc_detailed AS plaid
    FROM transactions t
    JOIN plaid_transactions pt ON pt.ledger_transaction_id = t.id AND pt.removed_at IS NULL
    JOIN plaid_accounts pa ON pa.id = pt.plaid_account_id
    WHERE t.group_id = ${groupId} AND pa.type = 'credit' AND pt.amount < 0
      AND (pt.pfc_primary IN ('TRANSFER_IN', 'LOAN_PAYMENTS', 'LOAN_DISBURSEMENTS')
           OR pt.name ~* '\m(payment|pymt|autopay)\M')
    ORDER BY t.posted_on`;
  console.log(verdict(cardPayments.length, "no card payment reached the ledger", "{n} card payments reached the ledger as rows"));
  if (cardPayments.length) console.table(cardPayments);
  const unplaced = await sql`
    SELECT t.posted_on::text AS date, t.merchant, t.amount::text AS amount, t.category, coalesce(b.name, '(no bill)') AS bill
    FROM transactions t LEFT JOIN recurring_expenses b ON b.id = t.recurring_expense_id
    WHERE t.group_id = ${groupId} AND t.category IN ('fixed', 'amortized') AND NOT t.needs_review
      AND t.posted_on >= ${month}
      AND (b.id IS NULL OR b.start_date > t.posted_on OR (b.end_date IS NOT NULL AND b.end_date < t.posted_on))
    ORDER BY t.posted_on`;
  console.log(verdict(unplaced.length, "every bill payment this month is linked to a current bill", "{n} bill payments this month have no current bill"));
  if (unplaced.length) console.table(unplaced);

  // 3. Possible duplicates: the same amount on one account within two days, where
  // the bank has not confirmed both (two confirmed rows are two real charges).
  console.log("\n3. POSSIBLE DUPLICATES SINCE THE CUTOVER");
  const dupes = await sql`
    SELECT a.posted_on::text AS first_date, a.merchant AS first, a.source AS first_from,
           b.posted_on::text AS second_date, b.merchant AS second, b.source AS second_from, a.amount::text AS amount
    FROM transactions a
    JOIN transactions b ON b.group_id = a.group_id AND b.account_id = a.account_id AND b.amount = a.amount
      AND b.id > a.id AND abs(b.posted_on - a.posted_on) <= 2
    WHERE a.group_id = ${groupId} AND a.posted_on >= ${cutover}
      AND a.category <> 'transfer' AND b.category <> 'transfer'
      AND NOT (EXISTS (SELECT 1 FROM plaid_transactions p WHERE p.removed_at IS NULL AND (p.ledger_transaction_id = a.id OR a.id = ANY(p.split_ledger_ids)))
           AND EXISTS (SELECT 1 FROM plaid_transactions p WHERE p.removed_at IS NULL AND (p.ledger_transaction_id = b.id OR b.id = ANY(p.split_ledger_ids))))
    ORDER BY a.posted_on`;
  console.log(verdict(dupes.length, "no same-amount pairs that the bank has not confirmed", "{n} pairs to look at"));
  if (dupes.length) console.table(dupes);
  const [u] = await sql`
    SELECT count(*)::int AS n FROM transactions t
    WHERE t.group_id = ${groupId} AND t.posted_on >= ${cutover} AND t.source <> 'plaid'
      AND t.account_id IN (SELECT financial_account_id FROM plaid_accounts WHERE financial_account_id IS NOT NULL)
      AND t.posted_on < ${g.today}::date - 3
      AND NOT EXISTS (SELECT 1 FROM plaid_transactions p WHERE p.removed_at IS NULL
                      AND (p.ledger_transaction_id = t.id OR t.id = ANY(p.split_ledger_ids)))`;
  console.log(verdict(u.n, "every alert and hand entry older than 3 days is confirmed by the bank", "{n} alerts or hand entries older than 3 days are still unconfirmed"));

  // 4. This month.
  console.log(`\n4. THIS MONTH (${month.slice(0, 7)})`);
  const view = await getBudgetMonthForGroup(groupId, month, g.today);
  const c = view.computation;
  console.table([
    {
      budget: dollars(c.discretionary.budgetC),
      "spent (net)": dollars(c.discretionary.netSpentC),
      "paid back": dollars(c.discretionary.reimbursedC),
      "left to spend": dollars(c.discretionary.remainingC),
      "vs pace": dollars(c.discretionary.paceDeltaC),
      "bills expected": dollars(c.fixed.expectedC),
      "bills paid": dollars(c.fixed.actualC),
      "amortized paid": dollars(c.amortized.paidThisMonthC),
      income: dollars(c.incomeC),
    },
  ]);
  const range = { from: month, to: g.today };
  const flow = await summarizeCashFlow(groupId, range);
  console.log(`money in ${money(flow.moneyIn)} · money out ${money(flow.moneyOut)} · net ${money(flow.moneyIn - flow.moneyOut)} · ${flow.count} rows`);
  const lanes = await cashFlowByCategory(groupId, range);
  console.table(lanes.filter((l) => l.moneyIn || l.moneyOut).map((l) => ({ lane: l.category, in: money(l.moneyIn), out: money(l.moneyOut) })));
  const tags = await spendByTag(groupId, range);
  const tagSum = tags.reduce((sum, t) => sum + t.amount, 0);
  console.log(`top tags: ${tags.slice(0, 6).map((t) => `${t.tag ?? "untagged"} ${money(t.amount)}`).join(" · ")}`);
  console.log(verdict(Math.round((tagSum - flow.moneyOut) * 100) === 0 ? 0 : 1, "the tag breakdown adds up to money out", `the tag breakdown is ${money(tagSum - flow.moneyOut)} off money out`));
  if (c.funds.length) {
    console.log(`funds: ${c.funds.map((f) => `${f.name} ${dollars(f.balanceC)}${f.drawnThisMonthC ? ` (${f.drawnThisMonthC > 0 ? "−" : "+"}${dollars(Math.abs(f.drawnThisMonthC))} this month)` : ""}`).join(" · ")}`);
  }
}

async function main() {
  console.log(`database host: ${new URL(url).hostname}`);
  const groups = await sql`SELECT DISTINCT group_id FROM plaid_items ORDER BY group_id`;
  if (!groups.length) {
    console.log("No banks connected.");
    return;
  }
  for (const { group_id } of groups) await checkGroup(group_id);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
