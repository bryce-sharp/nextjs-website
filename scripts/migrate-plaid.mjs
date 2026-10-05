// One-time: bank sync (Plaid). Adds
//   plaid_items, plaid_accounts, plaid_transactions — bank logins, their
//     accounts, and the bank's raw copy of each transaction (dismissed_at
//     remembers rows the household deleted; split_ledger_ids, payments the
//     household recorded in parts)
//   transactions.bank_status — null | pending | posted, from the bank feed
// All additive, so existing rows are untouched. Idempotent. Constraint names
// match Drizzle's, so db:push sees these tables as already in sync.
//
// Used instead of db:push because the database has unrelated drift that push
// would "fix" destructively (recurring_expenses.is_debt, which is not in
// schema.ts, plus foreign keys named by earlier scripts).
//
//   node scripts/migrate-plaid.mjs     (prints which database it touched)

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

  await sql`
    CREATE TABLE IF NOT EXISTS plaid_items (
      id serial PRIMARY KEY,
      group_id integer NOT NULL
        CONSTRAINT plaid_items_group_id_groups_id_fk REFERENCES groups(id) ON DELETE CASCADE,
      item_id varchar(100) NOT NULL CONSTRAINT plaid_items_item_id_unique UNIQUE,
      access_token_enc text NOT NULL,
      institution_id varchar(40),
      institution_name varchar(120) NOT NULL,
      status varchar(30) NOT NULL DEFAULT 'ok',
      last_error text,
      cursor text,
      sync_from date NOT NULL,
      last_synced_at timestamptz,
      sync_locked_until timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_plaid_items_group ON plaid_items (group_id)`;

  await sql`
    CREATE TABLE IF NOT EXISTS plaid_accounts (
      id serial PRIMARY KEY,
      plaid_item_id integer NOT NULL
        CONSTRAINT plaid_accounts_plaid_item_id_plaid_items_id_fk REFERENCES plaid_items(id) ON DELETE CASCADE,
      account_id varchar(100) NOT NULL CONSTRAINT plaid_accounts_account_id_unique UNIQUE,
      financial_account_id integer
        CONSTRAINT plaid_accounts_financial_account_id_financial_accounts_id_fk
        REFERENCES financial_accounts(id) ON DELETE SET NULL,
      name varchar(200) NOT NULL,
      official_name varchar(200),
      mask varchar(10),
      type varchar(30) NOT NULL,
      subtype varchar(40),
      current_balance numeric(12, 2),
      available_balance numeric(12, 2),
      balance_as_of timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_plaid_accounts_item ON plaid_accounts (plaid_item_id)`;

  await sql`
    CREATE TABLE IF NOT EXISTS plaid_transactions (
      id serial PRIMARY KEY,
      plaid_account_id integer NOT NULL
        CONSTRAINT plaid_transactions_plaid_account_id_plaid_accounts_id_fk
        REFERENCES plaid_accounts(id) ON DELETE CASCADE,
      transaction_id varchar(100) NOT NULL CONSTRAINT plaid_transactions_transaction_id_unique UNIQUE,
      pending_transaction_id varchar(100),
      ledger_transaction_id integer
        CONSTRAINT plaid_transactions_ledger_transaction_id_transactions_id_fk
        REFERENCES transactions(id) ON DELETE SET NULL,
      pending boolean NOT NULL,
      amount numeric(12, 2) NOT NULL,
      date date NOT NULL,
      authorized_date date,
      name varchar(300) NOT NULL,
      merchant_name varchar(200),
      pfc_primary varchar(60),
      pfc_detailed varchar(100),
      raw jsonb NOT NULL,
      removed_at timestamptz,
      applied_at timestamptz,
      dismissed_at timestamptz,
      split_ledger_ids integer[],
      created_at timestamptz NOT NULL DEFAULT now()
    )`;
  await sql`ALTER TABLE plaid_transactions ADD COLUMN IF NOT EXISTS dismissed_at timestamptz`;
  await sql`ALTER TABLE plaid_transactions ADD COLUMN IF NOT EXISTS split_ledger_ids integer[]`;
  await sql`CREATE INDEX IF NOT EXISTS idx_plaid_txn_ledger ON plaid_transactions (ledger_transaction_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_plaid_txn_account_date ON plaid_transactions (plaid_account_id, date)`;

  await sql`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS bank_status varchar(10)`;

  const tables = await sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name LIKE 'plaid_%' ORDER BY table_name`;
  console.log(`plaid tables: ${tables.map((t) => t.table_name).join(", ")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
