# Setting up a laptop

Vercel holds every setting the app needs, so nothing secret lives in git and any
laptop gets the same setup in a few commands.

## 1. Install the tools (macOS)

- [Homebrew](https://brew.sh), then:

```bash
brew install node gh
```

```bash
npm install -g vercel
```

- git comes with Apple's command line tools (`xcode-select --install`).
- Node 20 or newer is required.

## 2. Sign in

```bash
gh auth login
```

```bash
vercel login
```

## 3. Get the code and the settings

```bash
git clone https://github.com/bryce-sharp/nextjs-website && cd nextjs-website
```

```bash
npm install
```

```bash
vercel link
```

Choose the `bryce-sharps-projects` scope and the `my-website` project. Then:

```bash
vercel env pull .env.local
```

Run `vercel env pull .env.local` again whenever settings change in Vercel. It merges
into the file and keeps lines that exist only locally.

## 4. Run it

```bash
npm run dev
```

Open `http://localhost:3000` and sign in with your normal account.

## What the settings point at

| | Laptop (`npm run dev`) | Live site (`www.bstocksharp.dev`) |
|---|---|---|
| Vercel environment | Development | Production |
| Database | Neon `dev` branch, a copy of live | Neon `main` branch |
| Plaid | Sandbox (test banks) | Production (real banks) |

## Day-to-day rules

- **Real data entry happens on the live site.** Laptops work on the dev copy, so
  edits made locally never reach the live site.
- **Refresh the dev copy** when it falls behind: Neon console, Branches, `dev`,
  **Reset from parent**.
- **Live-only scripts** go through one door, which prints the live host first:

```bash
node scripts/live.mjs scripts/reset-link.mjs someusername
```

- **Schema changes:** never `npm run db:push` (it would drop data; see `CLAUDE.md`).
  Write an idempotent `scripts/migrate-<name>.mjs`, run it on dev with
  `node scripts/migrate-<name>.mjs`, then on live with
  `node scripts/live.mjs scripts/migrate-<name>.mjs` **before** merging code that
  reads the new columns.

## Claude Code

- The Claude desktop app's Code tab is Claude Code; no separate CLI is needed.
- To let Claude run live-database scripts without the auto-mode safety block, the
  repository needs `.claude/settings.json` with this rule. Claude cannot add
  permissions for itself, so a person creates and commits this file:

```json
{
  "permissions": {
    "allow": ["Bash(node scripts/live.mjs *)"]
  }
}
```

- New settings take effect in a new session.

## Running app code with node

For checks against the dev database without the web server (how the Plaid sync was
tested), `scripts/node-hooks.mjs` lets node import the app's TypeScript modules:

```bash
node --env-file=.env.local --import ./scripts/node-hooks.mjs path/to/check.mts
```
