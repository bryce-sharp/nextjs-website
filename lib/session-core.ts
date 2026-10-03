// ─────────────────────────────────────────────────────────────────────────────
// SESSION TOKEN — runtime-agnostic mint/verify for the global-login cookie.
//
// Deliberately uses ONLY Web APIs (crypto.subtle, btoa/atob, TextEncoder) so the
// same code runs in the proxy (edge runtime — no node:crypto there) AND in
// Server Actions (node). The cookie-facing helpers live in lib/session.ts; this
// file is just the math. Token shape: `base64url(JSON payload).base64url(HMAC)`,
// same sign-then-verify scheme as the hub_edit_unlocks cookie in lib/auth.ts.
//
// The expiry lives INSIDE the signed payload (not just the cookie's maxAge) —
// a client can keep a cookie alive forever, but it can't forge a fresh `exp`.
// ─────────────────────────────────────────────────────────────────────────────

export const SESSION_COOKIE = "hub_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 90; // 90 days, rolling (the proxy re-issues)

export type SessionPayload = {
  accountId: number;
  // The account's group (tenancy boundary), baked in at login so no request
  // ever needs a DB query to know whose data it may touch. Trade-off: moving
  // an account between groups requires that person to sign in again.
  groupId: number;
  exp: number; // epoch seconds
  // When this device signed in (epoch seconds). Kept across rolling renewals,
  // so a password change can kill every session signed before it. Missing on
  // tokens from before resets existed (treated as 0).
  iat?: number;
};

const enc = new TextEncoder();

function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function toB64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array | null {
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

// ── Generic signed tokens ─────────────────────────────────────────────────────
// The session cookie and the WebAuthn challenge cookie (lib/webauthn.ts) share
// this: any JSON payload with an `exp`, signed and expiry-checked the same way.

/** Sign any payload (must carry `exp`, epoch seconds) → `body.signature`. */
export async function mintToken(
  payload: { exp: number } & Record<string, unknown>,
  secret: string,
): Promise<string> {
  const body = toB64url(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(body));
  return `${body}.${toB64url(new Uint8Array(sig))}`;
}

/** Verify signature + expiry → the payload, or null for anything invalid. */
export async function readToken<T extends { exp: number }>(
  token: string | undefined | null,
  secret: string,
): Promise<T | null> {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const body = token.slice(0, dot);
  const sig = fromB64url(token.slice(dot + 1));
  if (!sig) return null;

  // crypto.subtle.verify is constant-time — no timing tell on bad signatures.
  const valid = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(secret),
    sig as BufferSource,
    enc.encode(body),
  );
  if (!valid) return null;

  const bytes = fromB64url(body);
  if (!bytes) return null;
  try {
    const p = JSON.parse(new TextDecoder().decode(bytes));
    if (typeof p?.exp !== "number") return null;
    if (p.exp * 1000 <= Date.now()) return null; // expired
    return p as T;
  } catch {
    return null;
  }
}

// ── The session token specifically ────────────────────────────────────────────
export function mintSessionToken(
  payload: SessionPayload,
  secret: string,
): Promise<string> {
  return mintToken(payload, secret);
}

export async function readSessionToken(
  token: string | undefined | null,
  secret: string,
): Promise<SessionPayload | null> {
  const p = await readToken<SessionPayload>(token, secret);
  // Pre-groups tokens (no groupId) are rejected — that one-time re-login is
  // how existing sessions pick up the tenancy claim.
  if (!p || typeof p.accountId !== "number" || typeof p.groupId !== "number") {
    return null;
  }
  return {
    accountId: p.accountId,
    groupId: p.groupId,
    exp: p.exp,
    iat: typeof p.iat === "number" ? p.iat : undefined,
  };
}
