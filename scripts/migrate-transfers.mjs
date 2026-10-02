// One-time: transfers between your own accounts. Adds
//   transactions.transfer_account_id — the account money moved INTO
//   financial_accounts.transfer_patterns — words that auto-link a row as a transfer
// Both additive (nullable / defaulted), so existing rows are untouched. Idempotent.
//
//   node scripts/migrate-transfers.mjs

import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";

config({ path: ".env.local" });

const url = process.env.POSTGRES_URL_NON_POOLING ?? process.env.POSTGRES_URL;
if (!url) {
  console.error("POSTGRES_URL is not set — check .env.local");
  process.exit(1);
}
const sql = neon(url);

async function main() {
  await sql`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS transfer_account_id integer REFERENCES financial_accounts(id) ON DELETE SET NULL`;
  await sql`ALTER TABLE financial_accounts ADD COLUMN IF NOT EXISTS transfer_patterns jsonb NOT NULL DEFAULT '[]'::jsonb`;
  const [t] = await sql`SELECT count(transfer_account_id)::int AS n FROM transactions`;
  const [a] = await sql`SELECT count(*)::int AS n FROM financial_accounts WHERE jsonb_array_length(transfer_patterns) > 0`;
  console.log(`transfers linked: ${t.n}; accounts with transfer words: ${a.n}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
