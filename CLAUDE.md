# CLAUDE.md

Working rules for Claude Code in this repository. Laptop setup for people is in
`docs/setup.md`; the architecture is in `ARCHITECTURE.md`.

## Databases: dev by default, live through one door

- `.env.local` points `POSTGRES_URL` and `POSTGRES_URL_NON_POOLING` at the Neon `dev`
  branch, a copy of live. `npm run dev`, drizzle-kit, and every script in `scripts/`
  use it.
- The live database is reached only with `node scripts/live.mjs scripts/<name>.mjs`
  (it reads `LIVE_POSTGRES_URL*` and prints the live host). Tell the user before running
  anything against live.
- The user refreshes dev from live in the Neon console (dev branch, Reset from parent).

## Schema changes

- Never run `npm run db:push`. The live database has drift that push would "fix"
  destructively: `recurring_expenses.is_debt` (not in `schema.ts`, origin unknown) and
  foreign keys named by older migration scripts.
- Instead write an idempotent `scripts/migrate-<name>.mjs` (see `migrate-plaid.mjs`),
  use Drizzle's constraint names, run it on dev, then on live through `scripts/live.mjs`
  before merging code that reads the new columns (preview builds use the live database).

## Environment

- Vercel is the source of truth. Development holds laptop settings
  (`vercel env pull .env.local`); Production holds the live site's. Development cannot
  hold Secrets, and Secrets cannot be read back.
- Plaid: `PLAID_CLIENT_KEY`; `PLAID_SANDBOX_SECRET` or `PLAID_PRODUCTION_SECRET`, chosen
  by `PLAID_ENV`; `PLAID_TOKEN_KEY` (encrypts stored bank tokens: never change it once
  banks are connected); `PLAID_WEBHOOK_URL`; `CRON_SECRET`. The live site refuses Sandbox.
- `SITE_ADMINS`: comma-separated usernames (today `bstocksharp`) who also see site events
  (those with no household) on the Activity tab of /group. It grants no household data.

## Plaid bank sync

- Plan, decisions, and status: `docs/finance/plaid.md`. Code: `lib/plaid/*` (sync, apply,
  map, webhook), `app/api/plaid/webhook`, `app/api/cron/plaid`, `scripts/migrate-plaid.mjs`.
- The Plaid Trial allows 10 Production Items, and removing one does not free its slot.
  Test with Sandbox; repair broken connections with Reconnect (update mode), never by
  linking again.
- The ledger row is the household's: syncs only refresh bank-owned fields, and deleted
  rows stay deleted (`plaid_transactions.dismissed_at`).
- Dev holds copies of live's real bank logins after every reset. `plaid_items.environment`
  keeps each deployment to logins of its own `PLAID_ENV`; leave the copies alone (never
  disconnect them from dev).
- Read-only checks (add `node scripts/live.mjs` in front for live): `plaid-status.mjs`
  (sync health), `bill-audit.mjs` (bill patterns against the bank's own text; `--try`
  tests a pattern before it is added). `plaid-reapply.mjs` takes a bank-created row back
  out so the sync files it again (dry run unless `--yes`; `--now` files it right away).
  `plaid-redownload.mjs` clears a bank's sync position so its next sync re-reads the
  whole history (dry run unless `--yes`). `finance-check.mjs` is the read-only sanity
  check of the whole ledger (sync health, sign and link rules, duplicates, this month). `atlas-apply.mjs` applies a
  reviewed JSON list of Atlas changes (patterns, fixes, new bills, re-filing rows; dry run
  unless `--yes`); keep the list in the scratchpad, never in the repo.

## Event log

- `event_log` is the app-wide timeline: write to it with `logEvent` from `lib/events.ts`
  (it never throws). Plaid webhooks and syncs (with their trigger) are logged today; the
  daily cron prunes rows older than 180 days. Server logs on the Hobby plan last an hour,
  so record anything you will want to check later here.
- Give each event its household (`groupId`); null means a site event, which only site
  admins see. Record a failure with `data.ok = false` or a kind ending in `_rejected` or
  `_failed`, so the Activity tab on /group shows it in red.

## Checking app code without the server

`node --env-file=.env.local --import ./scripts/node-hooks.mjs check.mts` runs real app
modules (aliases resolved, `server-only` stubbed) against the dev database.
