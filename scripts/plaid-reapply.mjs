// Take a bank-created ledger row back out so the sync can file it again, for
// fixing data after a rule improves. Dry run unless --yes is given.
//
//   node scripts/plaid-reapply.mjs --ledger 2077              show the plan
//   node scripts/plaid-reapply.mjs --ledger 2077 --yes        delete that row and
//        queue its bank rows; the next sync (button, webhook, cron) files them again
//   add --park to delete it WITHOUT queueing (it stays out until --requeue)
//   node scripts/plaid-reapply.mjs --requeue 512 --yes        queue a parked bank row
//   add --now to file queued rows right away instead of at the next sync (the
//        app's own ledger step, under the same lock a sync takes)
//
// Only rows the bank feed created (source = plaid) can be deleted; card alerts
// and hand entries never are. Use scripts/live.mjs to run this against live.

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

const args = process.argv.slice(2);
const yes = args.includes("--yes");
const park = args.includes("--park");
const now = args.includes("--now");
const values = (name) => args.flatMap((a, i) => (a === name && args[i + 1] ? [Number(args[i + 1])] : []));
const ledgerIds = values("--ledger");
const requeueIds = values("--requeue");

async function main() {
  console.log(`database host: ${new URL(url).hostname}${yes ? "" : "   (dry run: add --yes to execute)"}`);
  if (!ledgerIds.length && !requeueIds.length) {
    console.error("Nothing to do. Pass --ledger <transactions.id> and/or --requeue <plaid_transactions.id>.");
    process.exit(1);
  }

  const queuedItems = new Set();
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
      SELECT pt.id, left(pt.name, 50) AS name, pt.amount::text AS amount, pt.date::text AS date, pa.plaid_item_id AS item
      FROM plaid_transactions pt JOIN plaid_accounts pa ON pa.id = pt.plaid_account_id
      WHERE pt.ledger_transaction_id = ${ledgerId}`;
    console.log(`\nledger row ${ledgerId}: ${row.date} ${row.merchant} ${row.amount} (${row.category})`);
    console.table(bankRows);
    console.log(park ? "plan: delete it and park its bank rows" : "plan: delete it and queue its bank rows for the next sync");
    if (!yes) continue;
    const ids = bankRows.map((r) => r.id);
    await sql`DELETE FROM transactions WHERE id = ${ledgerId} AND source = 'plaid'`;
    if (!park && ids.length) {
      await sql`UPDATE plaid_transactions SET applied_at = NULL WHERE id = ANY(${ids})`;
      for (const r of bankRows) queuedItems.add(r.item);
    }
    console.log(park ? `done; queue later with: ${ids.map((id) => `--requeue ${id}`).join(" ")}` : "done");
  }

  for (const id of requeueIds) {
    const [raw] = await sql`
      SELECT pt.id, left(pt.name, 50) AS name, pt.amount::text AS amount, pt.ledger_transaction_id, pt.dismissed_at,
             pa.plaid_item_id AS item
      FROM plaid_transactions pt JOIN plaid_accounts pa ON pa.id = pt.plaid_account_id
      WHERE pt.id = ${id}`;
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
    queuedItems.add(raw.item);
    console.log(now ? "done" : "done; the next sync files it");
  }

  if (!now) return;
  if (!yes) {
    console.log("\n--now: would file the queued rows right away.");
    return;
  }
  const { applyPlaidItemNow } = await import("../lib/plaid/sync.ts");
  for (const item of queuedItems) {
    const stats = await applyPlaidItemNow(item);
    console.log(
      stats
        ? `\nfiled now (bank connection ${item}): ${JSON.stringify(stats)}`
        : `\nbank connection ${item} is syncing right now; that sync files them.`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
