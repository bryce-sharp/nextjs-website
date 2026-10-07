import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { plaidItems } from "@/lib/db/schema";
import { getPlaid } from "@/lib/plaid/client";
import { syncPlaidItem } from "@/lib/plaid/sync";
import { logEvent } from "@/lib/events";

// ─────────────────────────────────────────────────────────────────────────────
// WEBHOOKS — Plaid calls /api/plaid/webhook when a bank login has news. Nothing
// in a call is trusted until it verifies: the Plaid-Verification header is an
// ES256 JWT signed by a key fetched from Plaid by its kid, issued under five
// minutes ago, carrying the SHA-256 of the exact body received.
// ─────────────────────────────────────────────────────────────────────────────

type Jwk = { kty: string; crv: string; x: string; y: string; expired_at?: number | null };
export type KeyFetcher = (kid: string) => Promise<Jwk | null>;

const MAX_AGE_SECONDS = 5 * 60;
const keyCache = new Map<string, CryptoKey>();

async function plaidKey(kid: string): Promise<Jwk | null> {
  const { data } = await getPlaid().webhookVerificationKeyGet({ key_id: kid });
  return data.key as Jwk;
}

const fromB64url = (s: string) => new Uint8Array(Buffer.from(s, "base64url"));

function decodePart<T>(part: string): T | null {
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

export async function verifyPlaidWebhook(
  body: string,
  token: string | null,
  fetchKey: KeyFetcher = plaidKey,
): Promise<boolean> {
  const parts = token?.split(".") ?? [];
  if (parts.length !== 3) return false;
  const [headerPart, payloadPart, signaturePart] = parts;
  const header = decodePart<{ alg?: string; kid?: string }>(headerPart);
  const payload = decodePart<{ iat?: number; request_body_sha256?: string }>(payloadPart);
  if (!header || !payload || header.alg !== "ES256" || !header.kid) return false;

  let key = keyCache.get(header.kid);
  if (!key) {
    const jwk = await fetchKey(header.kid).catch(() => null);
    if (!jwk || jwk.expired_at) return false;
    key = await crypto.subtle.importKey(
      "jwk",
      { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y },
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    keyCache.set(header.kid, key);
  }

  const signed = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    fromB64url(signaturePart),
    new TextEncoder().encode(`${headerPart}.${payloadPart}`),
  );
  if (!signed) return false;
  if (typeof payload.iat !== "number" || Date.now() / 1000 - payload.iat > MAX_AGE_SECONDS) return false;

  const expected = Buffer.from(createHash("sha256").update(body).digest("hex"));
  const claimed = Buffer.from(String(payload.request_body_sha256 ?? ""));
  return expected.length === claimed.length && timingSafeEqual(expected, claimed);
}

export type PlaidWebhook = {
  webhook_type?: string;
  webhook_code?: string;
  item_id?: string;
  error?: { error_code?: string; error_message?: string; display_message?: string | null } | null;
};

/** A webhook in a few words, for the event log. */
function describeHook(type: string | undefined, code: string | undefined): string {
  switch (`${type}:${code}`) {
    case "TRANSACTIONS:SYNC_UPDATES_AVAILABLE":
      return "new activity at the bank";
    case "ITEM:ERROR":
      return "connection error";
    case "ITEM:LOGIN_REPAIRED":
      return "connection repaired";
    case "ITEM:PENDING_DISCONNECT":
    case "ITEM:PENDING_EXPIRATION":
      return "will disconnect soon";
    case "ITEM:USER_PERMISSION_REVOKED":
    case "ITEM:USER_ACCOUNT_REVOKED":
      return "access revoked at the bank";
    case "ITEM:NEW_ACCOUNTS_AVAILABLE":
      return "new accounts available";
    case "ITEM:WEBHOOK_UPDATE_ACKNOWLEDGED":
      return "webhook address confirmed";
    default:
      return `${type ?? "?"} ${code ?? "?"}`;
  }
}

// Older-format notices Plaid still sends beside SYNC_UPDATES_AVAILABLE; a
// /transactions/sync integration does not need them, so they are not logged.
const LEGACY_TRANSACTIONS = new Set(["INITIAL_UPDATE", "HISTORICAL_UPDATE", "DEFAULT_UPDATE", "TRANSACTIONS_REMOVED"]);

/**
 * What a verified webhook does. Every one the app acts on is written to the
 * event log, which is how anyone can tell the webhooks arrive. Syncs go
 * through `later`, which runs them after the reply: Plaid wants an answer
 * within 10 seconds and retries otherwise.
 */
export async function handlePlaidWebhook(
  hook: PlaidWebhook,
  later: (work: () => Promise<unknown>) => void,
): Promise<void> {
  if (hook.webhook_type === "TRANSACTIONS" && LEGACY_TRANSACTIONS.has(hook.webhook_code ?? "")) return;
  const [item] = hook.item_id
    ? await db
        .select({ id: plaidItems.id, groupId: plaidItems.groupId, bank: plaidItems.institutionName })
        .from(plaidItems)
        .where(eq(plaidItems.itemId, hook.item_id))
        .limit(1)
    : [];
  await logEvent({
    groupId: item?.groupId ?? null,
    source: "plaid",
    kind: "webhook",
    message: `${item?.bank ?? "Unknown connection"}: ${describeHook(hook.webhook_type, hook.webhook_code)}`,
    data: {
      item: item?.id ?? null,
      type: hook.webhook_type ?? null,
      code: hook.webhook_code ?? null,
      ...(hook.error?.error_code ? { error: hook.error.error_code } : {}),
    },
  });
  if (!item) return;
  const setStatus = (status: string, lastError: string | null) =>
    db.update(plaidItems).set({ status, lastError }).where(eq(plaidItems.id, item.id));

  switch (`${hook.webhook_type}:${hook.webhook_code}`) {
    case "TRANSACTIONS:SYNC_UPDATES_AVAILABLE":
      later(() => syncPlaidItem(item.id, "webhook"));
      return;
    case "ITEM:ERROR": {
      const message =
        hook.error?.display_message || hook.error?.error_message || "The bank connection needs attention.";
      await setStatus(hook.error?.error_code === "ITEM_LOGIN_REQUIRED" ? "login_required" : "error", message);
      return;
    }
    case "ITEM:LOGIN_REPAIRED":
      await setStatus("ok", null);
      later(() => syncPlaidItem(item.id, "webhook"));
      return;
    case "ITEM:PENDING_DISCONNECT":
    case "ITEM:PENDING_EXPIRATION":
      await setStatus("pending_disconnect", "The bank will disconnect this soon. Reconnect to keep syncing.");
      return;
    case "ITEM:USER_PERMISSION_REVOKED":
    case "ITEM:USER_ACCOUNT_REVOKED":
      await setStatus("revoked", "Access was revoked at the bank. Reconnect to resume syncing.");
      return;
    case "ITEM:NEW_ACCOUNTS_AVAILABLE":
      await setStatus("new_accounts", "The bank has new accounts. Reconnect to choose whether to add them.");
      return;
  }
}
