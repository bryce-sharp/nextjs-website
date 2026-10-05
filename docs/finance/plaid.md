# Bank sync with Plaid

_Planned 2026-10-04. Replaces the Chase SMS shortcut as the source of truth for
the Chase card, and replaces hand entry for Ally Checking and Ally Savings._

## Decisions

| Question | Decision |
|---|---|
| SMS shortcut | Runs alongside Plaid for one month (October 2026), then the shortcut is retired. The ingest endpoint may stay, unused. |
| Cutover | Bank rows dated before **2026-10-01** stay in `plaid_transactions` and never reach the ledger. |
| History | `days_requested: 730`, fetched once at the first connection (it cannot be raised later). |
| Who connects banks | The household owner only; never the demo login. |
| Banks in phase one | Chase (credit card) and Ally (checking and savings, one login). Not the X1 card. |

## How it works

- **Connect once.** The owner opens Plaid Link from Finance, Connections. The server
  swaps the one-time public token for a permanent access token, stores it
  encrypted (AES-256-GCM, `PLAID_TOKEN_KEY`), and records the bank's accounts, each
  pointed at an existing `financial_accounts` row.
- **Plaid checks the banks** one to four times a day.
- **The app pulls changes** with `/transactions/sync` and a saved cursor: only
  added, modified, and removed transactions since the last call.
- **Triggers:** the `SYNC_UPDATES_AVAILABLE` webhook (main path), a daily Vercel
  cron (backstop; Hobby allows once a day), and a Sync now button.

## Ledger rules

Plaid's sign matches the ledger (positive = money out).

- **Purchases** go through the existing bill and Categories rules (`lib/finance/ingest.ts`).
- **Pending** rows are inserted at once with `bank_status = "pending"` so the budget
  stays real-time. When the posted row arrives (`pending_transaction_id`), the same
  ledger row updates in place: household edits are kept, and the amount follows
  the bank only while the household has not adjusted it (`amount = original_amount`).
- **Card payments** (`LOAN_PAYMENTS_CREDIT_CARD_PAYMENT`) never reach the ledger, as today.
- **Venmo and Cash App payments** (`TRANSFER_OUT_*_FROM_APPS`) are spending, matching the
  wallet rule; money received through those apps lands in Needs review.
- **Deposited checks and cash** (`TRANSFER_IN_DEPOSIT`) are income.
- **Bills that share a merchant** (tithing and fast offerings at one church, two
  subscriptions from one store) are told apart by amount: an equally specific pattern
  match goes to the bill whose expected amount is closest. This applies to card alerts
  and hand entries too.
- **Payments recorded in parts:** when no single row matches, two or three rows that add
  up to the bank amount to the cent (within a day of each other, entered by hand or
  sharing the merchant) are claimed together (`plaid_transactions.split_ledger_ids`).
  Syncs never change the parts' amounts; deleting one part keeps the others covered.
- **Deposits described as payroll or direct deposit** are income even when Plaid's category
  disagrees, so a mislabeled paycheck never becomes a large refund.
- **Transfers between connected accounts** keep one ledger row (from, into); the
  second leg's raw row points at the same ledger row.
- **Income** (`INCOME_*`) is stored positive in the income lane.
- **Refunds:** money in that is not income or a transfer becomes a negative amount
  in the merchant's lane (Plaid has no refund category).
- **Uncertain** rows land in Needs review.
- **Removed pending rows** with no posted successor: deleted when Plaid created
  them; flagged for review when they had claimed an SMS or manual row.

## Avoiding duplicates

- The cutover date keeps the 1,685 imported Chase rows untouched.
- Before inserting, a bank row tries to claim an existing SMS, manual, or imported
  row on the same account (same amount, nearby date, similar merchant). The
  matcher in `scripts/reconcile-card.mjs` is the starting point.
- Every Plaid `transaction_id` is unique, and the cursor is saved only after all
  changes apply, so a crash replays safely (no multi-statement transactions
  needed on the Neon HTTP driver).
- `plaid_items.sync_locked_until` keeps two triggers from syncing one item at once.

## Data model

- `plaid_items`: one per bank login (encrypted token, cursor, status, `sync_from`).
- `plaid_accounts`: the bank's accounts, each mapped to a `financial_accounts` row or skipped.
- `plaid_transactions`: the raw bank copy of every transaction, linked to the
  ledger row it created or claimed. `applied_at` null = the ledger has not caught up.
- `transactions.bank_status`: null, `pending`, or `posted`. `source` gains `plaid`.

## Environment

| Variable | Local (`.env.local`) | Vercel Production |
|---|---|---|
| `PLAID_CLIENT_KEY` | Plaid client ID | same value |
| `PLAID_SANDBOX_SECRET` | Sandbox secret | optional |
| `PLAID_PRODUCTION_SECRET` | leave unset | Production secret |
| `PLAID_ENV` | `sandbox` | `production` (required: the live site refuses Sandbox) |
| `PLAID_TOKEN_KEY` | `openssl rand -base64 32` | a different key, also kept in a password manager |
| `PLAID_WEBHOOK_URL` | unset (Plaid cannot reach localhost) | `https://www.bstocksharp.dev/api/plaid/webhook` |
| `CRON_SECRET` | unset | random string |
| `LIVE_POSTGRES_URL`, `LIVE_POSTGRES_URL_NON_POOLING` | the live database, read only by `scripts/live.mjs` | not used |

All laptop values live in Vercel's Development environment; `vercel env pull .env.local`
fetches them (see `docs/setup.md`).

`PLAID_TOKEN_KEY` must never change once banks are connected: a new key makes the
stored access tokens unreadable, and replacing them means new connections, each
spending a Trial slot.

Local work points `POSTGRES_URL` and `POSTGRES_URL_NON_POOLING` (the only database
variables the code reads) at the Neon `dev` branch, a child of `main`, so Sandbox's
fake transactions never reach the real ledger. "Reset from parent" in the Neon
console refreshes it with current production data.

## Plaid Trial constraints

- 10 Production Items, and `/item/remove` does **not** free a slot. Test in Sandbox;
  repair broken connections with update mode (Reconnect), never by re-linking.
- Chase: choose **always** for consent duration (6 months and 1 year force a
  reconnect). Link the Chase card once; a second Chase Item with a different
  account set invalidates the first.
- Production Link needs a Data Transparency Messaging use case (Dashboard, Link
  Customization) and a filled-in app display and company profile.

## Phases

1. **Setup** (Plaid Dashboard, env vars, packages). _Done._ Vercel's Development
   environment holds the laptop settings (dev database, Sandbox keys, token key), so any
   laptop runs `vercel env pull .env.local`.
2. **Connect in Sandbox**: schema, Plaid client, token encryption, owner-only
   actions, Bank connections section on `/finance/settings`. _Built on `finance-plaid`._
3. **Sync engine**: sync loop (`lib/plaid/sync.ts`), ledger apply step
   (`lib/plaid/apply.ts`, rules in `lib/plaid/map.ts`, matcher in `lib/finance/match.ts`),
   Sync now, Pending chips. _Built and tested end to end on the dev branch with the
   `user_transactions_dynamic` Sandbox user: cutover, categorization, claiming a card
   alert, pending to posted in place, and idempotent re-syncs._
   Tables were created with `node scripts/migrate-plaid.mjs` rather than `db:push`,
   which currently wants to drop the unexplained `recurring_expenses.is_debt` column.
4. **Automation**: _Built and tested._ `POST /api/plaid/webhook` verifies the
   `Plaid-Verification` JWT (ES256, key fetched by `kid`, `iat` within 5 minutes, body
   SHA-256), then syncs after the reply on `SYNC_UPDATES_AVAILABLE` and records item
   health (`ERROR`, `LOGIN_REPAIRED`, `PENDING_DISCONNECT`, `USER_PERMISSION_REVOKED`,
   `NEW_ACCOUNTS_AVAILABLE`). `GET /api/cron/plaid` (Vercel Cron, daily at 12:00 UTC,
   `CRON_SECRET` bearer) syncs every bank. Both are allowlisted in `proxy.ts`. The
   Budget page shows a Reconnect banner when a bank needs attention.
   `PLAID_WEBHOOK_URL` is `https://www.bstocksharp.dev/api/plaid/webhook` (the bare
   domain redirects, which webhooks should not depend on).
5. **Go live**: Production keys in Vercel, push the schema to production, connect
   Chase and Ally once from a desktop browser, run beside the SMS shortcut through
   October, then retire the shortcut.
6. **Optional**: pre-fill monthly Net Worth snapshots from Plaid balances; consider
   Investments (included on the Trial) for Schwab and others.
