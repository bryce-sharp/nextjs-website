// Download a bank connection's whole history again on its next sync, for when
// the app starts asking Plaid for something new (like the bank's statement
// text). Clears the saved sync position; the next sync (Sync now, a webhook, or
// the daily cron) re-reads every transaction. Nothing is duplicated: each bank
// row updates in place, the ledger step only refreshes bank-owned fields, and
// rows before the cutover never reach the ledger. Dry run unless --yes.
//
//   node scripts/plaid-redownload.mjs                    (dev database)
//   node scripts/live.mjs scripts/plaid-redownload.mjs   (live database)
//   --item <id>   only that connection (default: all)
//   --yes         clear the position; then press Sync now in Finance, Settings

import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";

config({ path: ".env.local", quiet: true });

const url = process.env.POSTGRES_URL_NON_POOLING ?? process.env.POSTGRES_URL;
if (!url) {
  console.error("POSTGRES_URL is not set — check .env.local");
  process.exit(1);
}
const sql = neon(url);

const args = process.argv.slice(2);
const yes = args.includes("--yes");
const at = args.indexOf("--item");
const only = at >= 0 ? Number(args[at + 1]) : null;
if (at >= 0 && !Number.isInteger(only)) {
  console.error("--item needs a connection id (see plaid-status.mjs).");
  process.exit(1);
}

async function main() {
  console.log(`database host: ${new URL(url).hostname}${yes ? "" : "   (dry run: add --yes to clear)"}`);
  const items = await sql`
    SELECT pi.id, pi.institution_name, pi.status, pi.cursor IS NOT NULL AS has_position,
           (SELECT count(*)::int FROM plaid_transactions pt JOIN plaid_accounts pa ON pa.id = pt.plaid_account_id
             WHERE pa.plaid_item_id = pi.id) AS stored_rows
    FROM plaid_items pi
    WHERE ${only}::int IS NULL OR pi.id = ${only}
    ORDER BY pi.id`;
  if (!items.length) {
    console.log(only ? `No connection ${only}.` : "No banks connected.");
    return;
  }
  console.table(items);
  if (!yes) {
    console.log("plan: clear each saved position; the next sync downloads the full history again");
    return;
  }
  await sql`UPDATE plaid_items SET cursor = NULL WHERE ${only}::int IS NULL OR id = ${only}`;
  console.log("done; press Sync now (Finance, Settings) or wait for the next webhook or the daily sync");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
