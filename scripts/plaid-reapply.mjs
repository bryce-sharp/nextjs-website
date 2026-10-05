// Take a bank-created ledger row back out so the sync can file it again, for
// fixing data after a rule improves. Dry run unless --yes is given.
//
//   node scripts/plaid-reapply.mjs --ledger 2077              show the plan
//   node scripts/plaid-reapply.mjs --ledger 2077 --yes        delete that row and
//        queue its bank rows; the next sync (button, webhook, cron) files them again
//   add --park to delete it WITHOUT queueing (it stays out until --requeue)
//   node scripts/plaid-reapply.mjs --requeue 512 --yes        queue a parked bank row
//
// Only rows the bank feed created (source = plaid) can be deleted; card alerts
// and hand entries never are. Use scripts/live.mjs to run this against live.

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
const park = args.includes("--park");
const values = (name) => args.flatMap((a, i) => (a === name && args[i + 1] ? [Number(args[i + 1])] : []));
const ledgerIds = values("--ledger");
const requeueIds = values("--requeue");

async function main() {
  console.log(`database host: ${new URL(url).hostname}${yes ? "" : "   (dry run: add --yes to execute)"}`);
  if (!ledgerIds.length && !requeueIds.length) {
    console.error("Nothing to do. Pass --ledger <transactions.id> and/or --requeue <plaid_transactions.id>.");
    process.exit(1);
  }

  for (const ledgerId of ledgerIds) {
    const [row] = await sql`
      SELECT id, posted_on::text AS date, merchant, amount::text AS amount, category, source
      FROM transactions WHERE id = ${ledgerId}`;
    if (!row) {
      console.error(`No ledger row ${ledgerId}.`);
      process.exit(1);
    }
    if (row.source !== "plaid") {
      console.error(`Refusing: ledger row ${ledgerId} came from "${row.source}", not the bank feed.`);
      process.exit(1);
    }
    const bankRows = await sql`
      SELECT id, left(name, 50) AS name, amount::text AS amount, date::text AS date
      FROM plaid_transactions WHERE ledger_transaction_id = ${ledgerId}`;
    console.log(`\nledger row ${ledgerId}: ${row.date} ${row.merchant} ${row.amount} (${row.category})`);
    console.table(bankRows);
    console.log(park ? "plan: delete it and park its bank rows" : "plan: delete it and queue its bank rows for the next sync");
    if (!yes) continue;
    const ids = bankRows.map((r) => r.id);
    await sql`DELETE FROM transactions WHERE id = ${ledgerId} AND source = 'plaid'`;
    if (!park && ids.length) await sql`UPDATE plaid_transactions SET applied_at = NULL WHERE id = ANY(${ids})`;
    console.log(park ? `done; queue later with: ${ids.map((id) => `--requeue ${id}`).join(" ")}` : "done");
  }

  for (const id of requeueIds) {
    const [raw] = await sql`
      SELECT id, left(name, 50) AS name, amount::text AS amount, ledger_transaction_id, dismissed_at
      FROM plaid_transactions WHERE id = ${id}`;
    if (!raw) {
      console.error(`No bank row ${id}.`);
      process.exit(1);
    }
    if (raw.ledger_transaction_id !== null) {
      console.error(`Refusing: bank row ${id} is already filed as ledger row ${raw.ledger_transaction_id}.`);
      process.exit(1);
    }
    console.log(`\nbank row ${id}: ${raw.name} ${raw.amount}${raw.dismissed_at ? " (was deleted by hand; requeue restores it)" : ""}`);
    if (!yes) continue;
    await sql`UPDATE plaid_transactions SET applied_at = NULL, dismissed_at = NULL WHERE id = ${id}`;
    console.log("done; the next sync files it");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
