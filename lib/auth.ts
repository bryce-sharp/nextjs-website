// ─────────────────────────────────────────────────────────────────────────────
// AUTH LAYER 2 — "claim is the lock" (behind the global login).
//
// The hub's real security boundary is the login + group tenancy (lib/session,
// proxy.ts, lib/queries). Behind it, being signed in is enough to edit, with
// one exception — THE CLAIM: an account may claim a profile (accounts.profileId,
// managed at /group). A CLAIMED profile's stuff is editable only by its
// claiming account; an UNCLAIMED profile (a kid) is open to the whole group.
//
// (There used to be a per-device "edit mode" toggle in front of this. It
// granted nothing — every guard also checks the session and the claim — and it
// mostly got in the way, so it is gone. isEditor/requireEditor stay as the one
// seam where a future view-only role would plug in.)
//
// hashPassword/verifyPassword are for ACCOUNT passwords (login, resets, scripts).
//
// Two gates, same names as always (every write action calls one):
//   • requireEditor()          — communal writes (catalog, shared cars, …).
//   • requireEditorFor(owner)  — owned writes (workouts, private cars, weight).
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";
import { eq } from "drizzle-orm";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { accounts, groups } from "@/lib/db/schema";
import { getSession, requireSession, type Session } from "@/lib/session";
import { getProfile } from "@/lib/queries/profiles";

// ── Password hashing (scrypt via node:crypto — no deps). ACCOUNT passwords. ───
/** Hash a plaintext password → "scrypt$<saltHex>$<hashHex>". */
export function hashPassword(plain: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(plain, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

/** Verify a plaintext against a stored hash. A null hash means "no password set". */
export function verifyPassword(plain: string, stored: string | null): boolean {
  if (!stored) return true; // no password → always passes (open)
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(plain, Buffer.from(saltHex, "hex"), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// ── Edit mode (per-device toggle) ─────────────────────────────────────────────
/** Can this visitor edit? Anyone signed in (claims still guard owned data). */
export async function isEditMode(): Promise<boolean> {
  return (await getSession()) !== null;
}

// The name pages use: "may I show edit controls".
export const isEditor = isEditMode;

// ── Claims ────────────────────────────────────────────────────────────────────
/** The account id claiming this profile, or null if unclaimed. */
export async function claimedBy(profileId: number): Promise<number | null> {
  const [row] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.profileId, profileId))
    .limit(1);
  return row?.id ?? null;
}

/**
 * Can the signed-in account edit the resources OWNED by this profile?
 *   1. Must be in edit mode at all (keeps browsing read-only).
 *   2. Profile must exist IN OUR GROUP (scoped getProfile — foreign ids fail).
 *   3. Unclaimed profile → open to everyone in the group (the kid case).
 *      Claimed profile → only its claiming account ("claim is the lock").
 */
export async function canEditProfile(
  id: number | null | undefined,
): Promise<boolean> {
  if (id == null) return false;
  const session = await getSession();
  if (!session) return false;
  if (!(await isEditMode())) return false;
  if (!(await getProfile(id))) return false; // not ours → not editable
  const owner = await claimedBy(id);
  return owner === null || owner === session.accountId;
}

// ── Owner (Phase E) ───────────────────────────────────────────────────────────
// The group's owner is the ONE account that manages membership: invite links
// and removing logins (/group). Deliberately thin — owning grants no extra data
// rights (writes still go through edit mode + claims above).

/** Is the signed-in account this group's owner? (Signed out → no.) */
export async function isOwner(): Promise<boolean> {
  const session = await getSession();
  if (!session) return false;
  const [row] = await db
    .select({ ownerAccountId: groups.ownerAccountId })
    .from(groups)
    .where(eq(groups.id, session.groupId))
    .limit(1);
  return row?.ownerAccountId === session.accountId;
}

/**
 * Guard for MEMBERSHIP writes (mint/revoke invites, remove logins): owner, in
 * edit mode. Returns the session so callers don't re-fetch it.
 */
export async function requireOwner(): Promise<Session> {
  await requireEditor(); // signed in (admin actions are still writes)
  if (!(await isOwner())) {
    throw new Error("Only the group owner can manage members and invites.");
  }
  return requireSession();
}

// ── Site admins ───────────────────────────────────────────────────────────────
// The people who run the site itself: SITE_ADMINS in the deployment's
// environment, a comma-separated list of usernames. Being one grants no
// household's data; it adds only the events that belong to no household
// (a webhook the site refused) to the Activity list on /group.

/** Is the signed-in account one of the site's admins? */
export async function isSiteAdmin(): Promise<boolean> {
  const admins = (process.env.SITE_ADMINS ?? "")
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
  if (admins.length === 0) return false;
  const session = await getSession();
  if (!session) return false;
  const [row] = await db
    .select({ username: accounts.username })
    .from(accounts)
    .where(eq(accounts.id, session.accountId))
    .limit(1);
  return row !== undefined && admins.includes(row.username.toLowerCase());
}

// ── Guards (call from Server Actions) ─────────────────────────────────────────
/** Guard for COMMUNAL writes (catalog, shared cars): signed in. */
export async function requireEditor(): Promise<void> {
  await requireSession();
}

/** Guard for OWNED writes: unclaimed-or-yours. */
export async function requireEditorFor(
  ownerId: number | null | undefined,
): Promise<void> {
  if (!(await canEditProfile(ownerId))) {
    throw new Error(
      "Not authorized — this profile is claimed by another account.",
    );
  }
}
