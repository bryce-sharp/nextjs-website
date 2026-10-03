// Print a one-time password reset link for any login — the break-glass path
// for a group OWNER who forgot their password and has no passkey (nobody in
// the app can send the owner a link). The person opens it and picks their own
// password; no password ever passes through the terminal. Same rules as the
// owner's /group button: single use, 24-hour expiry, older live links for the
// login are revoked, and the person sees "a link from the site admin".
//
//   node scripts/reset-link.mjs <username>
//   node scripts/reset-link.mjs <username> --origin https://your-hub.example
//
// Without --origin it prints the path; put your hub's address in front of it.

import { createHash, randomBytes } from "node:crypto";
import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";

config({ path: ".env.local", quiet: true });

const url = process.env.POSTGRES_URL_NON_POOLING ?? process.env.POSTGRES_URL;
if (!url) {
  console.error("POSTGRES_URL is not set — check .env.local");
  process.exit(1);
}
const sql = neon(url);

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const username = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"))?.toLowerCase();
const origin = flag("--origin")?.replace(/\/+$/, "");
if (!username) {
  console.error("Usage: node scripts/reset-link.mjs <username> [--origin https://your-hub.example]");
  process.exit(1);
}

const [account] = await sql`SELECT id, username FROM accounts WHERE username = ${username}`;
if (!account) {
  console.error(`No login named "${username}".`);
  process.exit(1);
}

await sql`
  UPDATE password_resets SET revoked_at = now()
  WHERE account_id = ${account.id} AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now()`;
const token = randomBytes(32).toString("base64url");
const tokenHash = createHash("sha256").update(token).digest("hex");
await sql`
  INSERT INTO password_resets (account_id, created_by_account_id, token_hash, expires_at)
  VALUES (${account.id}, NULL, ${tokenHash}, now() + interval '24 hours')`;

const path = `/reset/${token}`;
console.log(`Reset link for ${account.username} (works once, expires in 24 hours):`);
console.log(origin ? `${origin}${path}` : `<your hub address>${path}`);
