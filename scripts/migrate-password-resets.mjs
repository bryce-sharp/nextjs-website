// One-time: password resets. Adds
//   accounts.password_changed_at — sessions signed before it stop working
//   password_resets              — one-time /reset/<token> links (sha256 only)
// Both additive, so the deployed code keeps working before the PR merges.
// Idempotent.
//
//   node scripts/migrate-password-resets.mjs

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
  await sql`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS password_changed_at timestamptz`;
  await sql`
    CREATE TABLE IF NOT EXISTS password_resets (
      id serial PRIMARY KEY,
      account_id integer NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      created_by_account_id integer REFERENCES accounts(id) ON DELETE SET NULL,
      token_hash varchar(64) NOT NULL UNIQUE,
      expires_at timestamptz NOT NULL,
      used_at timestamptz,
      revoked_at timestamptz,
      notice_seen_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_password_resets_account ON password_resets(account_id)`;
  const [r] = await sql`SELECT count(*)::int AS n FROM password_resets`;
  console.log(`password_resets ready (${r.n} rows); accounts.password_changed_at ready`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
