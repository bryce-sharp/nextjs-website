// One-time: add income_deductions.deposit_account_id — the financial account a
// paycheck deduction lands in (401k, HSA), so Net Worth can split an account's
// growth into paycheck contributions vs everything else. Nullable and
// additive, so every existing deduction stays unlinked. Idempotent.
//
//   node scripts/migrate-deduction-account.mjs

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
  await sql`ALTER TABLE income_deductions ADD COLUMN IF NOT EXISTS deposit_account_id integer REFERENCES financial_accounts(id) ON DELETE SET NULL`;
  const [row] = await sql`SELECT count(*)::int AS total, count(deposit_account_id)::int AS linked FROM income_deductions`;
  console.log(`income_deductions: ${row.total} rows, ${row.linked} linked to an account`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
