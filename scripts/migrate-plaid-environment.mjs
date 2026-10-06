// One-time: plaid_items.environment, the Plaid environment each bank login was
// made in (sandbox | production). Resetting dev from live copies live's real
// logins into dev, which runs Sandbox; with this column each deployment leaves
// the other environment's logins alone. Every login that exists before this
// column is one of live's Production logins (dev holds copies of them), so
// they are all filled in as production. The default is production too, so a
// row inserted without naming its environment is never left blank. Idempotent.
//
//   node scripts/migrate-plaid-environment.mjs                    (dev database)
//   node scripts/live.mjs scripts/migrate-plaid-environment.mjs   (live, before merging)

import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";

config({ path: ".env.local", quiet: true });

const url = process.env.POSTGRES_URL_NON_POOLING ?? process.env.POSTGRES_URL;
if (!url) {
  console.error("POSTGRES_URL is not set — check .env.local");
  process.exit(1);
}
const sql = neon(url);

async function main() {
  console.log(`database host: ${new URL(url).hostname}`);
  await sql`ALTER TABLE plaid_items ADD COLUMN IF NOT EXISTS environment varchar(20) NOT NULL DEFAULT 'production'`;
  await sql`ALTER TABLE plaid_items ALTER COLUMN environment SET DEFAULT 'production'`;
  await sql`UPDATE plaid_items SET environment = 'production' WHERE environment IS NULL`;
  await sql`ALTER TABLE plaid_items ALTER COLUMN environment SET NOT NULL`;
  console.table(await sql`SELECT id, group_id, institution_name AS bank, environment FROM plaid_items ORDER BY id`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
