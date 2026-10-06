import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gt, inArray, isNotNull, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";
import { accounts, passkeys, passwordResets } from "@/lib/db/schema";

// ─────────────────────────────────────────────────────────────────────────────
// PASSWORD RESETS — one-time /reset/<token> links. The token is the credential
// for someone locked out, so only its sha256 is stored and every read checks
// liveness (unused, unrevoked, unexpired). Minted by the group owner for
// another member (app/actions/password.ts) or by scripts/reset-link.mjs.
// ─────────────────────────────────────────────────────────────────────────────

export const RESET_TTL_HOURS = 24;
export const MIN_PASSWORD_LENGTH = 8;
/** Signed in this recently, a password change needs no current password. */
export const FRESH_SIGN_IN_SECONDS = 15 * 60;

/** Did this session sign in within FRESH_SIGN_IN_SECONDS? */
export function isFreshSignIn(iat: number | undefined): boolean {
  return iat != null && Date.now() / 1000 - iat <= FRESH_SIGN_IN_SECONDS;
}

/** Whole hours until a link expires (at least 1, for display). */
export function hoursUntil(when: Date): number {
  return Math.max(1, Math.round((when.getTime() - Date.now()) / 3_600_000));
}

export const hashResetToken = (token: string) => createHash("sha256").update(token).digest("hex");

const live = () =>
  and(isNull(passwordResets.usedAt), isNull(passwordResets.revokedAt), gt(passwordResets.expiresAt, new Date()));

/** The new-password rules shared by the reset page and Change password. */
export function newPasswordError(password: string, confirm: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password !== confirm) return "Passwords do not match.";
  return null;
}

/** Mint a link for `accountId`, revoking its older live links. Returns the raw token. */
export async function mintResetLink(accountId: number, createdByAccountId: number | null): Promise<string> {
  await db
    .update(passwordResets)
    .set({ revokedAt: new Date() })
    .where(and(eq(passwordResets.accountId, accountId), live()));
  const token = randomBytes(32).toString("base64url");
  await db.insert(passwordResets).values({
    accountId,
    createdByAccountId,
    tokenHash: hashResetToken(token),
    expiresAt: new Date(Date.now() + RESET_TTL_HOURS * 60 * 60 * 1000),
  });
  return token;
}

export type LiveReset = { id: number; accountId: number; username: string };

/** The live reset a token opens, or null for unknown, used, revoked, and expired alike. */
export async function findLiveReset(token: string): Promise<LiveReset | null> {
  if (!token || token.length > 100) return null;
  const [row] = await db
    .select({ id: passwordResets.id, accountId: passwordResets.accountId, username: accounts.username })
    .from(passwordResets)
    .innerJoin(accounts, eq(passwordResets.accountId, accounts.id))
    .where(and(eq(passwordResets.tokenHash, hashResetToken(token)), live()))
    .limit(1);
  return row ?? null;
}

/** Revoke every live link for an account (after any password change). */
export async function revokeLiveResets(accountId: number): Promise<void> {
  await db
    .update(passwordResets)
    .set({ revokedAt: new Date() })
    .where(and(eq(passwordResets.accountId, accountId), live()));
}

export type PendingReset = { id: number; accountId: number; expiresAt: Date };

/** Live links for these accounts (the owner's /group list). */
export async function listPendingResets(accountIds: number[]): Promise<PendingReset[]> {
  if (!accountIds.length) return [];
  return db
    .select({ id: passwordResets.id, accountId: passwordResets.accountId, expiresAt: passwordResets.expiresAt })
    .from(passwordResets)
    .where(and(inArray(passwordResets.accountId, accountIds), live()))
    .orderBy(desc(passwordResets.id));
}

const creators = alias(accounts, "creators");

export type ResetRecord = {
  id: number;
  usedAt: Date;
  /** Who minted the link; null = the site admin's script. */
  createdBy: string | null;
  createdBySelf: boolean;
  noticeSeen: boolean;
};

/** Links that were used on this account, newest first (the /group sign-in history). */
export async function listUsedResets(accountId: number, limit = 5): Promise<ResetRecord[]> {
  const rows = await db
    .select({
      id: passwordResets.id,
      usedAt: passwordResets.usedAt,
      createdById: passwordResets.createdByAccountId,
      createdBy: creators.username,
      noticeSeenAt: passwordResets.noticeSeenAt,
    })
    .from(passwordResets)
    .leftJoin(creators, eq(passwordResets.createdByAccountId, creators.id))
    .where(and(eq(passwordResets.accountId, accountId), isNotNull(passwordResets.usedAt)))
    .orderBy(desc(passwordResets.usedAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    usedAt: r.usedAt!,
    createdBy: r.createdBy ?? null,
    createdBySelf: r.createdById === accountId,
    noticeSeen: r.noticeSeenAt != null,
  }));
}

/**
 * Where to land after signing in: the reset notice first (a used link not yet
 * acknowledged), then, for a password sign-in without any passkey, the nudge
 * to add Face ID. Otherwise wherever they were headed.
 */
export async function afterSignIn(accountId: number, from: string, method: "password" | "passkey"): Promise<string> {
  const dest = from.startsWith("/") && !from.startsWith("//") ? from : "/";
  const [unseen] = await db
    .select({ id: passwordResets.id })
    .from(passwordResets)
    .where(
      and(
        eq(passwordResets.accountId, accountId),
        isNotNull(passwordResets.usedAt),
        isNull(passwordResets.noticeSeenAt),
      ),
    )
    .limit(1);
  if (unseen) return "/group?tab=sign-in";
  if (method === "password") {
    const [key] = await db
      .select({ id: passkeys.id })
      .from(passkeys)
      .where(eq(passkeys.accountId, accountId))
      .limit(1);
    if (!key) return `/group?tab=sign-in&nudge=1&next=${encodeURIComponent(dest)}`;
  }
  return dest;
}
