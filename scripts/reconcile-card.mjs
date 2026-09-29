// Read-only check: does the app have every transaction on a card statement?
// Compares a Chase "Activity" CSV export against the transactions table and
// prints what's missing, what differs (usually tips), and what the app has on
// that card that the statement doesn't (e.g. a charge reversed before posting).
// Card payments are skipped — the ledger deliberately doesn't record them.
//
//   node scripts/reconcile-card.mjs ~/Downloads/Chase4732_Activity.csv
//   node scripts/reconcile-card.mjs <csv> --account "Chase"   (default: Chase)
//   node scripts/reconcile-card.mjs <csv> --group 2           (if several households)
//   node scripts/reconcile-card.mjs <csv> --json report.json  (also save the details)
//
// Nothing is written to the database.
import fs from "node:fs";
import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";

config({ path: ".env.local", quiet: true });

const url = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
if (!url) {
  console.error("No POSTGRES_URL(_NON_POOLING) found in .env.local");
  process.exit(1);
}
const sql = neon(url);

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const csvPath = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
if (!csvPath) {
  console.error("Usage: node scripts/reconcile-card.mjs <statement.csv> [--account Chase] [--group <id>] [--json out.json]");
  process.exit(1);
}
const accountName = flag("--account") ?? "Chase";
const jsonOut = flag("--json");

// ── Statement CSV ────────────────────────────────────────────────────────────
function parseLine(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}
const mdyToIso = (mdy) => {
  const [m, d, y] = mdy.trim().split("/");
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
};

const lines = fs.readFileSync(csvPath, "utf8").split(/\r?\n/).filter((l) => l.trim());
const header = parseLine(lines[0]).map((h) => h.trim());
for (const col of ["Transaction Date", "Description", "Type", "Amount"]) {
  if (!header.includes(col)) {
    console.error(`Not a Chase activity CSV — missing the "${col}" column.`);
    process.exit(1);
  }
}
const statement = lines.slice(1).map((line, i) => {
  const f = Object.fromEntries(parseLine(line).map((v, j) => [header[j], v]));
  const amount = Number(f.Amount);
  return {
    line: i + 2,
    date: mdyToIso(f["Transaction Date"]),
    posted: f["Post Date"] ? mdyToIso(f["Post Date"]) : mdyToIso(f["Transaction Date"]),
    desc: f.Description.replace(/&amp;/g, "&").trim(),
    type: f.Type,
    // Chase: charges are negative, credits (returns, offers) positive.
    spend: amount < 0 ? Math.round(-amount * 100) / 100 : 0,
    credit: amount > 0 ? Math.round(amount * 100) / 100 : 0,
  };
});
const toCheck = statement.filter((r) => r.type !== "Payment");
const payments = statement.length - toCheck.length;
const firstDate = toCheck.reduce((m, r) => (r.date < m ? r.date : m), "9999-12-31");
const lastDate = toCheck.reduce((m, r) => (r.date > m ? r.date : m), "0000-01-01");
// Chase exports by post date: charges dated before the first post date are only
// partly included, and ones near the end may still be pending (not exported).
const firstPosted = statement.reduce((m, r) => (r.posted < m ? r.posted : m), "9999-12-31");
const lastPosted = statement.reduce((m, r) => (r.posted > m ? r.posted : m), "0000-01-01");
const addDays = (iso, n) => new Date(Date.parse(iso) + n * 86_400_000).toISOString().slice(0, 10);
const maybePending = addDays(lastPosted, -3);

// ── App data ─────────────────────────────────────────────────────────────────
const groups = await sql`SELECT id, name FROM groups WHERE NOT is_demo ORDER BY id`;
const groupId = flag("--group") ? Number(flag("--group")) : groups.length === 1 ? groups[0].id : null;
if (groupId == null || !groups.some((g) => g.id === groupId)) {
  console.error("Pick a household with --group <id>:");
  for (const g of groups) console.error(`  ${g.id}  ${g.name}`);
  process.exit(1);
}
const accounts = await sql`SELECT id, name FROM financial_accounts WHERE group_id = ${groupId}`;
const account = accounts.find((a) => a.name.toLowerCase() === accountName.toLowerCase());
if (!account) {
  console.error(`No account named "${accountName}". Pick one with --account:`);
  for (const a of accounts) console.error(`  ${a.name}`);
  process.exit(1);
}

// Rows can land a few days from the card's transaction date (alerts vs posting).
const rows = await sql`
  SELECT id, account_id, posted_on::text AS posted_on, merchant, amount::float8 AS amount,
         category, source, needs_review
  FROM transactions
  WHERE group_id = ${groupId}
    AND posted_on BETWEEN (${firstDate}::date - 3) AND (${lastDate}::date + 5)
  ORDER BY posted_on, id`;

// ── Matching ─────────────────────────────────────────────────────────────────
const MS_DAY = 86_400_000;
const dayGap = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / MS_DAY);
const tokens = (s) =>
  (s ?? "").toUpperCase().replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter((t) => t.length >= 3);
// Rough merchant likeness: alerts and statements spell the same place differently.
function likeness(a, b) {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.length || !tb.length) return 0;
  let score = ta[0].slice(0, 4) === tb[0].slice(0, 4) ? 2 : 0;
  for (const t of ta) if (t.length >= 4 && tb.some((u) => u.startsWith(t.slice(0, 4)))) score += 1;
  return score;
}
// The app stores a charge as +amount; a credit as −amount (refund) or +amount (reimbursement).
const sameMoney = (r, t, amount) =>
  r.spend > 0
    ? t.category !== "reimbursement" && t.category !== "income" && Math.abs(t.amount - amount) < 0.005
    : Math.abs(t.amount + amount) < 0.005 || (t.category === "reimbursement" && Math.abs(t.amount - amount) < 0.005);

const used = new Set();
const near = (r) =>
  rows.filter((t) => !used.has(t.id) && !t.needs_review && dayGap(t.posted_on, r.date) >= -3 && dayGap(t.posted_on, r.date) <= 5);
function pick(r, candidates) {
  let best = null;
  for (const t of candidates) {
    const score = likeness(r.desc, t.merchant) * 10 - Math.abs(dayGap(t.posted_on, r.date));
    if (!best || score > best.score) best = { t, score };
  }
  return best?.t ?? null;
}

const exact = [];
const split = [];
const differs = [];
for (const r of toCheck) {
  const amount = r.spend || r.credit;
  const t = pick(r, near(r).filter((t) => sameMoney(r, t, amount)));
  if (t) {
    used.add(t.id);
    exact.push({ r, t });
    r.done = true;
  }
}
// One statement line split across two app rows (e.g. part of an order re-tagged).
for (const r of toCheck.filter((x) => !x.done && x.spend > 0)) {
  const cands = near(r).filter((t) => likeness(r.desc, t.merchant) >= 2 && t.amount > 0);
  outer: for (let i = 0; i < cands.length; i++) {
    for (let j = i + 1; j < cands.length; j++) {
      if (Math.abs(cands[i].amount + cands[j].amount - r.spend) < 0.005) {
        used.add(cands[i].id);
        used.add(cands[j].id);
        split.push({ r, t: [cands[i], cands[j]] });
        r.done = true;
        break outer;
      }
    }
  }
}
// Same place, different amount (tips added after the alert, partial auths).
for (const r of toCheck.filter((x) => !x.done && x.spend > 0)) {
  const t = pick(
    r,
    near(r).filter((t) => {
      const ratio = t.amount / r.spend;
      return ratio >= 0.65 && ratio <= 1.35 && likeness(r.desc, t.merchant) >= 2;
    }),
  );
  if (t) {
    used.add(t.id);
    differs.push({ r, t });
    r.done = true;
  }
}

const missing = toCheck.filter((r) => !r.done);
// On this card in the app, inside the dates the export fully covers, matched to nothing.
const extra = rows.filter(
  (t) =>
    !used.has(t.id) &&
    t.account_id === account.id &&
    t.posted_on >= firstPosted &&
    t.posted_on <= lastDate &&
    t.category !== "income" &&
    t.category !== "ignored", // Excluded rows are already dealt with
);
const unreadable = rows.filter((t) => t.needs_review && t.posted_on >= firstDate && t.posted_on <= lastDate);

// ── Report ───────────────────────────────────────────────────────────────────
const money = (n) => `$${n.toFixed(2)}`;
const sum = (xs) => xs.reduce((s, x) => s + x, 0);
const pad = (s, n) => String(s).padEnd(n);

console.log(`\n${csvPath}`);
console.log(`${firstDate} → ${lastDate} · account "${account.name}"`);
console.log(
  `${toCheck.length} to check (${payments} card payments skipped): ${exact.length} exact, ` +
    `${split.length} split across rows, ${differs.length} different amount, ${missing.length} missing\n`,
);

if (missing.length) {
  const charges = missing.filter((r) => r.spend > 0);
  console.log(`MISSING FROM THE APP — ${missing.length} (${money(sum(charges.map((r) => r.spend)))} in charges)`);
  for (const r of missing) {
    console.log(`  ${r.date}  ${pad(r.spend ? money(r.spend) : `−${money(r.credit)}`, 11)} ${r.desc}${r.type !== "Sale" ? `  (${r.type})` : ""}`);
  }
  console.log();
}
if (differs.length) {
  console.log(`DIFFERENT AMOUNT — ${differs.length} (usually a tip added after the alert)`);
  for (const { r, t } of differs) {
    const delta = Math.round((r.spend - t.amount) * 100) / 100;
    console.log(`  ${r.date}  app ${pad(money(t.amount), 10)} statement ${pad(money(r.spend), 10)} ${delta > 0 ? "+" : ""}${delta.toFixed(2)}  ${r.desc}  [id ${t.id}]`);
  }
  console.log();
}
if (extra.length) {
  console.log(`IN THE APP ON "${account.name}" BUT NOT ON THE STATEMENT — ${extra.length}`);
  console.log("  (a charge reversed before posting, a duplicate, or the wrong account)");
  for (const t of extra) {
    const pending = t.posted_on > maybePending ? "  — may still be pending" : "";
    console.log(`  ${t.posted_on}  ${pad(money(t.amount), 11)} ${t.merchant ?? "—"}  (${t.category}, ${t.source})  [id ${t.id}]${pending}`);
  }
  console.log();
}
if (unreadable.length) {
  console.log(`UNREADABLE ALERTS IN RANGE — ${unreadable.length} (may be some of the missing above)`);
  for (const t of unreadable) console.log(`  ${t.posted_on}  ${t.merchant ?? "—"}  [id ${t.id}]`);
  console.log();
}
if (split.length) {
  console.log(`SPLIT ACROSS ROWS — ${split.length} (totals match; listed for reference)`);
  for (const { r, t } of split) {
    console.log(`  ${r.date}  ${money(r.spend)} = ${t.map((x) => money(x.amount)).join(" + ")}  ${r.desc}`);
  }
  console.log();
}
if (!missing.length && !differs.length && !extra.length) console.log("Everything on the statement is in the app. ✓\n");

if (jsonOut) {
  const row = (t) => ({ id: t.id, date: t.posted_on, merchant: t.merchant, amount: t.amount, category: t.category, source: t.source });
  fs.writeFileSync(
    jsonOut,
    JSON.stringify(
      {
        statement: csvPath,
        range: { from: firstDate, to: lastDate },
        account: account.name,
        counts: { toCheck: toCheck.length, payments, exact: exact.length, split: split.length, differs: differs.length, missing: missing.length, extra: extra.length },
        missing: missing.map(({ done: _d, ...r }) => r),
        differs: differs.map(({ r, t }) => ({ statement: { date: r.date, desc: r.desc, amount: r.spend }, app: row(t) })),
        extra: extra.map(row),
        split: split.map(({ r, t }) => ({ statement: { date: r.date, desc: r.desc, amount: r.spend }, app: t.map(row) })),
      },
      null,
      2,
    ),
  );
  console.log(`Details saved to ${jsonOut}`);
}
