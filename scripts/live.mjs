// Run one of the scripts in scripts/ against the LIVE database instead of the
// Neon dev branch that .env.local points at. This is the one door to live data
// from a laptop: Claude Code pre-approves exactly this command (.claude/
// settings.json), and CLAUDE.md says to use nothing else.
//
//   node scripts/live.mjs scripts/migrate-plaid.mjs [args...]
//
// Reads LIVE_POSTGRES_URL and LIVE_POSTGRES_URL_NON_POOLING (vercel env pull
// brings them), prints the target host, then runs the script with those as its
// POSTGRES_URL / POSTGRES_URL_NON_POOLING.

import { spawnSync } from "node:child_process";
import path from "node:path";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const [script, ...args] = process.argv.slice(2);
const target = script ? path.posix.normalize(script) : "";
if (!/^scripts\/[\w.-]+\.mjs$/.test(target) || target === "scripts/live.mjs") {
  console.error("Usage: node scripts/live.mjs scripts/<name>.mjs [args...]");
  process.exit(1);
}

const pooled = process.env.LIVE_POSTGRES_URL;
const direct = process.env.LIVE_POSTGRES_URL_NON_POOLING;
if (!pooled || !direct) {
  console.error("LIVE_POSTGRES_URL and LIVE_POSTGRES_URL_NON_POOLING are not set. Run: vercel env pull .env.local");
  process.exit(1);
}

console.log(`LIVE database: ${new URL(direct).hostname}`);
const result = spawnSync(process.execPath, [target, ...args], {
  stdio: "inherit",
  env: { ...process.env, POSTGRES_URL: pooled, POSTGRES_URL_NON_POOLING: direct },
});
process.exit(result.status ?? 1);
