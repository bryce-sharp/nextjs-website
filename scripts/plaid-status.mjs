// Read-only health report for bank sync: connections, account mapping, what the
// sync staged and applied, and the overlap checks for the SMS-alert month (alerts
// the bank has not confirmed, rows in review, possible duplicates).
//
//   node scripts/plaid-status.mjs                    (dev database)
//   node scripts/live.mjs scripts/plaid-status.mjs   (live database)
//   add --rows to also list every ledger row the bank owns since the cutover
//
// Nothing is written.

import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";

config({ path: ".env.local", quiet: true });

const url = process.env.POSTGRES_URL_NON_POOLING ?? process.env.POSTGRES_URL;
if (!url) {
  console.error("POSTGRES_URL is not set — check .env.local");
  process.exit(1);
}
const sql = neon(url);
const money = (n) => (n == null ? "" : Number(n).toFixed(2));

async function main() {
  console.log(`database host: ${new URL(url).hostname}\n`);

  const items = await sql`
    SELECT id, group_id, institution_name, environment, status, last_error, sync_from::text AS sync_from,
           to_char(last_synced_at AT TIME ZONE 'America/Chicago', 'Mon DD HH24:MI') AS last_synced,
           (SELECT to_char(max(e.created_at) AT TIME ZONE 'America/Chicago', 'Mon DD HH24:MI') FROM event_log e
             WHERE e.source = 'plaid' AND e.kind = 'webhook' AND (e.data->>'item')::int = plaid_items.id) AS last_webhook,
           cursor IS NOT NULL AS has_cursor
    FROM plaid_items ORDER BY id`;
  if (items.length === 0) {
    console.log("No banks connected.");
    return;
  }
  console.log("CONNECTIONS");
  console.table(items.map(({ group_id, ...i }) => i));

  console.log("ACCOUNTS (what each bank account feeds)");
  console.table(
    await sql`
      SELECT pi.institution_name AS bank, pa.name, pa.mask, pa.subtype, coalesce(fa.name, '(not imported)') AS feeds
      FROM plaid_accounts pa
      JOIN plaid_items pi ON pi.id = pa.plaid_item_id
      LEFT JOIN financial_accounts fa ON fa.id = pa.financial_account_id
      ORDER BY pa.plaid_item_id, pa.id`,
  );

  console.log("BANK ROWS RECEIVED (all history, per account)");
  console.table(
    await sql`
      SELECT pa.name, pa.mask, count(*)::int AS received,
             count(*) FILTER (WHERE pt.applied_at IS NULL)::int AS waiting,
             count(pt.ledger_transaction_id)::int AS in_ledger,
             count(*) FILTER (WHERE pt.pending AND pt.removed_at IS NULL)::int AS pending,
             count(*) FILTER (WHERE pt.removed_at IS NOT NULL)::int AS removed,
             min(pt.date)::text AS first, max(pt.date)::text AS last
      FROM plaid_transactions pt JOIN plaid_accounts pa ON pa.id = pt.plaid_account_id
      GROUP BY pa.id, pa.name, pa.mask ORDER BY pa.id`,
  );

  const groupIds = [...new Set(items.map((i) => i.group_id))];

  console.log("RECENT BANK EVENTS (webhooks and syncs, newest first)");
  console.table(
    await sql`
      SELECT to_char(created_at AT TIME ZONE 'America/Chicago', 'Mon DD HH24:MI') AS at, kind, message
      FROM event_log
      WHERE source = 'plaid' AND (group_id = ANY(${groupIds}) OR group_id IS NULL)
      ORDER BY created_at DESC, id DESC LIMIT 12`,
  );
  const cutover = items.map((i) => i.sync_from).sort()[0];

  console.log(`LEDGER ROWS THE BANK OWNS (since ${cutover})`);
  console.table(
    await sql`
      SELECT CASE WHEN t.source = 'plaid' THEN 'new from bank' ELSE 'claimed ' || t.source || ' row' END AS how,
             t.category, coalesce(t.bank_status, '-') AS bank, count(*)::int AS n, sum(t.amount)::text AS total
      FROM transactions t
      WHERE t.id IN (SELECT ledger_transaction_id FROM plaid_transactions WHERE removed_at IS NULL UNION SELECT unnest(split_ledger_ids) FROM plaid_transactions WHERE removed_at IS NULL)
      GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`,
  );

  if (process.argv.includes("--rows")) {
    console.log(`EVERY LEDGER ROW THE BANK OWNS (since ${cutover})`);
    console.table(
      await sql`
        SELECT t.posted_on::text AS date, t.merchant, t.amount::text AS amount,
               CASE WHEN t.source = 'plaid' THEN 'new from bank' ELSE 'claimed ' || t.source END AS how,
               coalesce(t.bank_status, '-') AS bank, t.category, coalesce(t.spend_category, '') AS tag
        FROM transactions t
        WHERE t.group_id = ANY(${groupIds}) AND t.posted_on >= ${cutover}
          AND t.id IN (SELECT ledger_transaction_id FROM plaid_transactions WHERE removed_at IS NULL UNION SELECT unnest(split_ledger_ids) FROM plaid_transactions WHERE removed_at IS NULL)
        ORDER BY t.posted_on, t.id`,
    );
  }

  const unconfirmed = await sql`
    SELECT t.posted_on::text AS date, a.name AS account, t.source, t.merchant, t.amount::text AS amount, t.category
    FROM transactions t JOIN financial_accounts a ON a.id = t.account_id
    WHERE t.group_id = ANY(${groupIds}) AND t.posted_on >= ${cutover}
      AND t.source <> 'plaid'
      AND t.account_id IN (SELECT financial_account_id FROM plaid_accounts WHERE financial_account_id IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM plaid_transactions p WHERE p.removed_at IS NULL AND (p.ledger_transaction_id = t.id OR t.id = ANY(p.split_ledger_ids)))
    ORDER BY t.posted_on, t.id`;
  console.log(`ALERTS AND HAND ENTRIES THE BANK HAS NOT CONFIRMED (since ${cutover}): ${unconfirmed.length}`);
  console.log("  Normal for the last day or two (not posted yet). Older ones: a missed match, a charge that never posted, or a duplicate.");
  if (unconfirmed.length) console.table(unconfirmed.slice(0, 40));

  const review = await sql`
    SELECT t.posted_on::text AS date, t.merchant, t.amount::text AS amount, t.category, coalesce(t.note, '') AS note
    FROM transactions t
    WHERE t.group_id = ANY(${groupIds}) AND t.needs_review AND t.posted_on >= ${cutover}
    ORDER BY t.posted_on, t.id`;
  console.log(`NEEDS REVIEW (since ${cutover}): ${review.length}`);
  if (review.length) console.table(review);

  const dupes = await sql`
    SELECT b.posted_on::text AS bank_date, b.merchant AS bank_row, b.amount::text AS amount,
           o.posted_on::text AS other_date, o.merchant AS other_row, o.source AS other_source
    FROM transactions b
    JOIN transactions o ON o.group_id = b.group_id AND o.account_id = b.account_id AND o.id <> b.id
      AND o.amount = b.amount AND abs(o.posted_on - b.posted_on) <= 3 AND o.source <> 'plaid'
    WHERE b.group_id = ANY(${groupIds}) AND b.source = 'plaid' AND b.posted_on >= ${cutover}
      AND NOT EXISTS (SELECT 1 FROM plaid_transactions p WHERE p.removed_at IS NULL AND (p.ledger_transaction_id = o.id OR o.id = ANY(p.split_ledger_ids)))
    ORDER BY b.posted_on`;
  console.log(`POSSIBLE DUPLICATES (a new bank row next to an unconfirmed row with the same amount): ${dupes.length}`);
  if (dupes.length) console.table(dupes.map((d) => ({ ...d, amount: money(d.amount) })));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
