import "server-only";
import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";

// ─────────────────────────────────────────────────────────────────────────────
// PLAID CLIENT — one per server instance, configured from the environment:
// PLAID_CLIENT_KEY (Plaid's client_id), one secret per Plaid environment
// (PLAID_SANDBOX_SECRET, PLAID_PRODUCTION_SECRET), and PLAID_ENV to pick
// between them. Anything but PLAID_ENV=production means Sandbox, so a missing
// value can never touch real accounts. Server-only: the secret must never
// reach a browser, and SDK errors carry request headers (the secret included),
// so callers log and return only the extracted code and message below.
// ─────────────────────────────────────────────────────────────────────────────

export type PlaidEnv = "sandbox" | "production";

export function plaidEnv(): PlaidEnv {
  return process.env.PLAID_ENV === "production" ? "production" : "sandbox";
}

function plaidSecret(): string | undefined {
  return plaidEnv() === "production"
    ? process.env.PLAID_PRODUCTION_SECRET
    : process.env.PLAID_SANDBOX_SECRET;
}

/**
 * True when every key is set, so pages can explain instead of failing. The
 * live site never runs in Sandbox: Sandbox's fake transactions would land in
 * the real ledger.
 */
export function plaidConfigured(): boolean {
  if (process.env.VERCEL_ENV === "production" && plaidEnv() !== "production") return false;
  return Boolean(process.env.PLAID_CLIENT_KEY && plaidSecret() && process.env.PLAID_TOKEN_KEY);
}

let client: PlaidApi | null = null;

export function getPlaid(): PlaidApi {
  if (!plaidConfigured()) {
    throw new Error("Bank sync is not set up (PLAID_CLIENT_KEY, PLAID_ENV and its secret, PLAID_TOKEN_KEY).");
  }
  client ??= new PlaidApi(
    new Configuration({
      basePath: PlaidEnvironments[plaidEnv()],
      baseOptions: {
        headers: {
          "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_KEY,
          "PLAID-SECRET": plaidSecret(),
        },
      },
    }),
  );
  return client;
}

type PlaidErrorBody = { error_code?: unknown; error_message?: unknown; display_message?: unknown };

function errorBody(err: unknown): PlaidErrorBody | null {
  const data = (err as { response?: { data?: unknown } } | null)?.response?.data;
  return data && typeof data === "object" ? (data as PlaidErrorBody) : null;
}

/** Plaid's error code from a failed SDK call (e.g. ITEM_LOGIN_REQUIRED), or null. */
export function plaidErrorCode(err: unknown): string | null {
  const code = errorBody(err)?.error_code;
  return typeof code === "string" ? code : null;
}

/** A safe, human message for a failed SDK call: never the raw error object. */
export function plaidErrorMessage(err: unknown, fallback: string): string {
  const body = errorBody(err);
  const message =
    (typeof body?.display_message === "string" && body.display_message) ||
    (typeof body?.error_message === "string" && body.error_message);
  return message || fallback;
}
