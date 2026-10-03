"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { accounts, groups } from "@/lib/db/schema";
import { hashPassword, verifyPassword } from "@/lib/auth";
import { createSession, destroySession } from "@/lib/session";
import { setActiveProfileCookie } from "@/lib/profile";
import { reseedDemoGroup } from "@/lib/demo";
import { afterSignIn } from "@/lib/password-reset";

// The global login/logout. Accounts are created only via
// scripts/create-account.mjs (no signup UI by design — see the schema notes).

export type LoginState = { error: string } | null;

// Verified against when the username doesn't exist, so "no such user" costs the
// same scrypt work as "wrong password" — no timing tell for username guessing.
const DUMMY_HASH = hashPassword("dummy-timing-equalizer");

/** Login form action (useActionState). On success: session cookie + redirect. */
export async function loginAction(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const username = String(formData.get("username") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");
  const from = String(formData.get("from") ?? "");

  if (!username || !password) {
    return { error: "Enter a username and password." };
  }

  const [account] = await db
    .select()
    .from(accounts)
    .where(eq(accounts.username, username))
    .limit(1);

  const ok = account
    ? verifyPassword(password, account.passwordHash)
    : (verifyPassword(password, DUMMY_HASH), false);
  if (!ok || !account) {
    return { error: "Incorrect username or password." };
  }

  // Demo groups get wiped + reseeded on every sign-in, so each visitor tours
  // pristine data no matter what the previous one did.
  const [group] = await db
    .select()
    .from(groups)
    .where(eq(groups.id, account.groupId))
    .limit(1);
  if (group?.isDemo) await reseedDemoGroup(group.id);

  await createSession(account.id, account.groupId);
  // Signing in as a claimed account means "I am that person" — switch to them.
  if (account.profileId !== null) await setActiveProfileCookie(account.profileId);
  // Only same-site paths — never a full URL (open-redirect guard). A pending
  // reset notice or the add-Face-ID nudge comes first.
  redirect(await afterSignIn(account.id, from, "password"));
}

/** Sign out: drop the session cookie and land on the login page. */
export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect("/login");
}
