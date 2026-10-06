// One-time: the app-wide event log (event_log): webhook arrivals, syncs and
// what started them, and anything else worth a timeline. Additive and
// idempotent; constraint and index names match Drizzle's.
//
//   node scripts/migrate-event-log.mjs                    (dev database)
//   node scripts/live.mjs scripts/migrate-event-log.mjs   (live, before merging)

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
    CREATE TABLE IF NOT EXISTS event_log (
      id serial PRIMARY KEY,
      group_id integer CONSTRAINT event_log_group_id_groups_id_fk REFERENCES groups(id) ON DELETE CASCADE,
      source varchar(40) NOT NULL,
      kind varchar(60) NOT NULL,
      message text,
      data jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_event_log_group_time ON event_log (group_id, created_at)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_event_log_source_time ON event_log (source, created_at)`;
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM event_log`;
  console.log(`event_log ready (${n} rows)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
