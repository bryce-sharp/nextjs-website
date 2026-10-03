"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { accounts, groups, passwordResets } from "@/lib/db/schema";
import { hashPassword, requireOwner, verifyPassword } from "@/lib/auth";
import { createSession, requireSession } from "@/lib/session";
import {
  findLiveReset,
  isFreshSignIn,
  mintResetLink,
  newPasswordError,
  revokeLiveResets,
} from "@/lib/password-reset";

// Password changes: self-service while signed in, and the owner-issued reset
// link for a member who is locked out. The owner mints the link; the member
// picks the password on their own device, so the owner never knows it.

export type ResetLinkResult = { ok: true; token: string } | { ok: false; error: string };

/** Owner only: a one-time reset link for another login in this hub. */
export async function createResetLinkAction(accountId: number): Promise<ResetLinkResult> {
  const session = await requireOwner();
  if (accountId === session.accountId) {
    return { ok: false, error: "Change your own password on the Security page." };
  }
  const [target] = await db
    .select({ groupId: accounts.groupId, isDemo: groups.isDemo })
    .from(accounts)
    .innerJoin(groups, eq(accounts.groupId, groups.id))
    .where(eq(accounts.id, accountId))
    .limit(1);
  if (!target || target.groupId !== session.groupId || target.isDemo) {
    return { ok: false, error: "That login is not in this hub." };
  }
  const token = await mintResetLink(accountId, session.accountId);
  revalidatePath("/group");
  return { ok: true, token };
}

/** Owner only: cancel a live reset link (the row stays as history). */
export async function revokeResetLinkAction(id: number, _formData: FormData): Promise<void> {
  const session = await requireOwner();
  const [row] = await db
    .select({ groupId: accounts.groupId })
    .from(passwordResets)
    .innerJoin(accounts, eq(passwordResets.accountId, accounts.id))
    .where(eq(passwordResets.id, id))
    .limit(1);
  if (!row || row.groupId !== session.groupId) return;
  await db
    .update(passwordResets)
    .set({ revokedAt: new Date() })
    .where(and(eq(passwordResets.id, id), isNull(passwordResets.usedAt), isNull(passwordResets.revokedAt)));
  revalidatePath("/group");
}

export type ResetPasswordState = { error: string } | { done: true; username: string } | null;

/**
 * The /reset/<token> form — runs with NO session (the token is the
 * credential). Marking the link used comes first and is conditional, so two
 * submits can never both succeed. Setting passwordChangedAt signs out every
 * existing session of the account.
 */
export async function resetPasswordAction(
  _prev: ResetPasswordState,
  formData: FormData,
): Promise<ResetPasswordState> {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  const problem = newPasswordError(password, confirm);
  if (problem) return { error: problem };

  const reset = await findLiveReset(token);
  if (!reset) return { error: "This reset link is no longer valid. Ask for a new one." };

  const now = new Date();
  const [claimed] = await db
    .update(passwordResets)
    .set({ usedAt: now })
    .where(and(eq(passwordResets.id, reset.id), isNull(passwordResets.usedAt), isNull(passwordResets.revokedAt)))
    .returning({ id: passwordResets.id });
  if (!claimed) return { error: "This reset link is no longer valid. Ask for a new one." };

  await db
    .update(accounts)
    .set({ passwordHash: hashPassword(password), passwordChangedAt: now })
    .where(eq(accounts.id, reset.accountId));
  await revokeLiveResets(reset.accountId);
  return { done: true, username: reset.username };
}

export type ChangePasswordState = { error: string } | { ok: true } | null;

/**
 * Change your own password. The current password is required unless you
 * signed in within the last 15 minutes (Face ID counts), which is how someone
 * who forgot it but has a passkey sets a new one. Other devices are signed
 * out; this one gets a fresh session so it stays in.
 */
export async function changePasswordAction(
  _prev: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  const session = await requireSession();
  const current = String(formData.get("current") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  const problem = newPasswordError(password, confirm);
  if (problem) return { error: problem };

  const [account] = await db
    .select({ passwordHash: accounts.passwordHash, groupId: accounts.groupId })
    .from(accounts)
    .where(eq(accounts.id, session.accountId))
    .limit(1);
  if (!account) return { error: "Account not found." };

  if (!isFreshSignIn(session.iat) && !verifyPassword(current, account.passwordHash)) {
    return {
      error: current
        ? "Your current password is not right."
        : "Enter your current password, or sign out and back in with Face ID first.",
    };
  }

  await db
    .update(accounts)
    .set({ passwordHash: hashPassword(password), passwordChangedAt: new Date() })
    .where(eq(accounts.id, session.accountId));
  await revokeLiveResets(session.accountId);
  // The change just ended every session, including this one; sign this device back in.
  await createSession(session.accountId, account.groupId);
  revalidatePath("/group");
  return { ok: true };
}

/** Dismiss the "your password was reset" notice (the history keeps the record). */
export async function acknowledgeResetNoticeAction(_formData: FormData): Promise<void> {
  const { accountId } = await requireSession();
  await db
    .update(passwordResets)
    .set({ noticeSeenAt: new Date() })
    .where(
      and(
        eq(passwordResets.accountId, accountId),
        isNotNull(passwordResets.usedAt),
        isNull(passwordResets.noticeSeenAt),
      ),
    );
  revalidatePath("/group");
}
