# Bryce's Garage

Hi, I'm Bryce. This is my personal website — a **hub of small apps** I actually
use day to day. It's a work in progress.

I had an old site (bstocksharp.github.io) but only ever pushed the build to
production and lost the source. Lesson learned — everything lives on GitHub now.

## Apps

### 🏁 The Garage — `/garage`

Track my vehicles: maintenance history, fuel & MPG, parts inventory, spend
summaries, and due-soon reminders. Each car also has a phased **Build plan**
(with progress), a **Wishlist** (with budget), and a **Build journal**.

### 📖 The Miata Bible — `/garage/bible`

Everything for the dream NA Miata in one place: buying guide, build philosophy
(reliability → safety → handling → power), the OEM+ dream spec, and resources.

## Coming next / ideas

- **Exercise companion** — a weekly workout schedule I can interact with (next up).

The root (`/`) is a launcher; a header switcher hops between apps. Adding a new
app = a folder under `app/` + one entry in [`lib/apps.tsx`](lib/apps.tsx).
Public to view, password to edit.

## Stack

Next.js 15 (App Router, RSC + Server Actions) · React 19 · MUI v7 (CSS-variable
theme, tokens in [`app/tokens.ts`](app/tokens.ts)) · Drizzle ORM on Neon
Postgres · deployed on Vercel.

## Develop

New laptop? Follow [docs/setup.md](docs/setup.md): install the tools, `vercel link`,
then `vercel env pull .env.local`.

```bash
npm run dev            # dev server → http://localhost:3000
npm run build          # production build
npm run lint

npm run db:push        # sync lib/db/schema.ts to the database
npm run db:studio      # browse/edit the DB in a GUI (local.drizzle.studio)
node scripts/inspect-db.mjs   # quick: list the DB tables
node scripts/reconcile-card.mjs <chase.csv>   # read-only: statement vs app transactions
```

## Layout

```
app/            routes: / (hub), /garage/*, /unlock; per-app layouts
components/     UI — forms, sections, headers, app-switcher
lib/            db (schema + client), auth, queries/, apps registry, helpers
scripts/        dev DB utilities
```
