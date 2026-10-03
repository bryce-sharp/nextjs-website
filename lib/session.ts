// ─────────────────────────────────────────────────────────────────────────────
// SESSION (server side) — the global-login cookie, read/written via next/headers.
//
// This is the REAL security boundary of the hub (unlike the per-profile edit
// locks, which are a social "hands off my stuff" layer behind it — see lib/auth).
// proxy.ts does the page-level redirect using the same token via
// lib/session-core; these helpers are for Server Actions and data-layer guards.
// Writes (createSession/destroySession) must be called from a Server Action or
// Route Handler — Next.js forbids setting cookies during rendering.
//
// The session carries BOTH ids: accountId (who signed in) and groupId (whose
// data they may touch). Every query in lib/queries scopes itself to the
// session's group via requireGroupId() — tenancy is enforced in the data
// layer, not left to each page to remember.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { accounts } from "@/lib/db/schema";
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  mintSessionToken,
  readSessionToken,
  type SessionPayload,
} from "@/lib/session-core";

export type Session = Pick<SessionPayload, "accountId" | "groupId" | "iat">;

function secret(): string {
  const s = process.env.COOKIE_SECRET;
  if (!s) throw new Error("COOKIE_SECRET is not set (check .env.local)");
  return s;
}

/** Start a session (call from a login action). */
export async function createSession(
  accountId: number,
  groupId: number,
): Promise<void> {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + SESSION_TTL_SECONDS;
  const token = await mintSessionToken({ accountId, groupId, exp, iat }, secret());
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production", // allow http on localhost
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

/** End the session (sign out). */
export async function destroySession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

/** The signed-in session, or null. Pure cookie check — no DB query. */
export async function getSession(): Promise<Session | null> {
  if (!process.env.COOKIE_SECRET) return null;
  const raw = (await cookies()).get(SESSION_COOKIE)?.value;
  const payload = await readSessionToken(raw, secret());
  return payload
    ? { accountId: payload.accountId, groupId: payload.groupId, iat: payload.iat }
    : null;
}

// LIVENESS (Phase E): the cookie alone can outlive the account — member removal
// deletes the row, but the removed device still holds a valid-signed token for
// up to 90 days. So the data layer double-checks the account still exists (and
// still belongs to the token's group), and that the device signed in after the
// password last changed — a reset signs every other device out. cache() memoizes per request: one tiny
// SELECT no matter how many queries a page runs. The proxy stays cookie-only on
// purpose — it's the convenience redirect, not the boundary.
const accountAlive = cache(
  async (accountId: number, groupId: number, iat: number | undefined): Promise<boolean> => {
    const [row] = await db
      .select({ groupId: accounts.groupId, passwordChangedAt: accounts.passwordChangedAt })
      .from(accounts)
      .where(eq(accounts.id, accountId))
      .limit(1);
    if (row == null || row.groupId !== groupId) return false;
    if (row.passwordChangedAt == null) return true;
    return (iat ?? 0) >= Math.floor(row.passwordChangedAt.getTime() / 1000);
  },
);

/** Data-layer guard: throw unless signed in. Belt to the proxy's suspenders. */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) throw new Error("Not signed in.");
  if (!(await accountAlive(session.accountId, session.groupId, session.iat))) {
    // Removed member (or a group move): the token is dead. Send them through
    // /signout, which clears the cookie and lands on /login — redirecting to
    // /login directly would loop (the proxy bounces signed-cookie holders off it).
    redirect("/signout");
  }
  return session;
}

/** The session's group, or null when signed out (icons/manifest/login page). */
export async function getSessionGroupId(): Promise<number | null> {
  return (await getSession())?.groupId ?? null;
}

/**
 * The group every query must scope to. Throws when signed out — queries have
 * no business running without a tenant (the proxy keeps signed-out traffic on
 * public routes, which never reach lib/queries).
 */
export async function requireGroupId(): Promise<number> {
  return (await requireSession()).groupId;
}
