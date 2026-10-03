"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  accounts,
  attachments,
  groups,
  invites,
  journalEntries,
  maintenanceRecords,
  profiles,
  vehicles,
  wishlistItems,
  workouts,
} from "@/lib/db/schema";
import { destroySession, requireSession } from "@/lib/session";
import { claimedBy, requireEditor, requireOwner } from "@/lib/auth";
import { getProfile } from "@/lib/queries/profiles";

// Claims are SELF-service: an account claims a profile for itself ("I am this
// person") — nobody claims on someone else's behalf. Membership is OWNER
// business (Phase E): the owner mints/revokes invite links and removes logins;
// requireOwner() gates all three. The create-account script still works as the
// break-glass path.

/** Claim a profile as the signed-in account ("this login is this person"). */
export async function claimProfileAction(
  profileId: number,
  _formData: FormData,
): Promise<void> {
  const { accountId } = await requireSession();

  const profile = await getProfile(profileId); // group-scoped
  if (!profile) throw new Error("Profile not found.");
  const owner = await claimedBy(profileId);
  if (owner !== null && owner !== accountId) {
    throw new Error("That profile is already claimed by another account.");
  }

  // Re-claiming moves YOUR claim (an account claims at most one profile).
  await db
    .update(accounts)
    .set({ profileId })
    .where(eq(accounts.id, accountId));

  revalidatePath("/group");
  revalidatePath("/", "layout");
}

/** Release the signed-in account's claim (the profile becomes open again). */
export async function releaseClaimAction(_formData: FormData): Promise<void> {
  const { accountId } = await requireSession();
  await db
    .update(accounts)
    .set({ profileId: null })
    .where(and(eq(accounts.id, accountId)));

  revalidatePath("/group");
  revalidatePath("/", "layout");
}

// ── Invites (Phase E) ─────────────────────────────────────────────────────────

const INVITE_TTL_DAYS = 7;

export type CreateInviteState =
  | { token: string; household: boolean; reusable: boolean }
  | { error: string }
  | null;

/**
 * Mint an invite link (useActionState). `destination` picks where the new login
 * lands: "household" = this group (they see everything); "own-hub" = a fresh
 * empty hub of their own. Single-use unless `reusable`; always expires in
 * 7 days. Returns the token — the client shows the full /join URL to copy.
 */
export async function createInviteAction(
  _prev: CreateInviteState,
  formData: FormData,
): Promise<CreateInviteState> {
  const session = await requireOwner();

  const household = String(formData.get("destination") ?? "household") !== "own-hub";
  const reusable = formData.get("reusable") != null;
  const note = String(formData.get("note") ?? "").trim().slice(0, 120) || null;

  // Paranoia belt: requireOwner already fails on the demo group (its owner is
  // null), but a demo invite would be nonsense — the group wipes on every tour.
  const [group] = await db
    .select({ isDemo: groups.isDemo })
    .from(groups)
    .where(eq(groups.id, session.groupId))
    .limit(1);
  if (!group || group.isDemo) return { error: "This group can't mint invites." };

  const token = randomBytes(24).toString("base64url"); // 32 chars, unguessable
  await db.insert(invites).values({
    token,
    groupId: household ? session.groupId : null,
    createdByAccountId: session.accountId,
    note,
    maxUses: reusable ? null : 1,
    expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000),
  });

  revalidatePath("/group");
  return { token, household, reusable };
}

/** Kill a live invite link (the row stays as audit trail). */
export async function revokeInviteAction(
  inviteId: number,
  _formData: FormData,
): Promise<void> {
  const session = await requireOwner();
  // Scope: only invites minted by THIS group's accounts (bound update).
  await db
    .update(invites)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(invites.id, inviteId),
        inArray(
          invites.createdByAccountId,
          db
            .select({ id: accounts.id })
            .from(accounts)
            .where(eq(accounts.groupId, session.groupId)),
        ),
      ),
    );
  revalidatePath("/group");
}

// ── Member removal (Phase E) ──────────────────────────────────────────────────

/**
 * Remove a LOGIN from the group. The person and all their data stay — deleting
 * the account row releases its claim (the profile becomes open) and cascades
 * only to the login's own passkeys. Their session cookie dies at the next
 * request via the liveness check in lib/session.
 */
export async function removeMemberAction(
  accountId: number,
  _formData: FormData,
): Promise<void> {
  const session = await requireOwner();
  if (accountId === session.accountId) {
    throw new Error("You can't remove your own login — you're the owner.");
  }
  // Bound delete: a foreign account id is a no-op, not a cross-group kick.
  await db
    .delete(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.groupId, session.groupId)));

  revalidatePath("/group");
}

// ── Lifecycle (Phase E close-out): leave / transfer / delete forever ──────────

/**
 * Leave the hub: delete YOUR OWN login (and its passkeys, via cascade). The
 * person and their data stay — leaving is the mirror of being removed. Self-
 * service like claims (it's your login; the dialog confirms).
 * The owner can't leave — transfer ownership first, or delete the hub.
 */
export async function leaveHubAction(_formData: FormData): Promise<void> {
  const session = await requireSession();
  const [group] = await db
    .select({ ownerAccountId: groups.ownerAccountId, isDemo: groups.isDemo })
    .from(groups)
    .where(eq(groups.id, session.groupId))
    .limit(1);
  // A demo visitor "leaving" would delete the SHARED demo login mid-tour.
  if (!group || group.isDemo) throw new Error("The demo hub can't be left.");
  if (group.ownerAccountId === session.accountId) {
    throw new Error(
      "You're the owner — transfer ownership first (or delete the hub).",
    );
  }

  await db.delete(accounts).where(eq(accounts.id, session.accountId));
  await destroySession();
  redirect("/login");
}

/** Hand the owner role to another member (they gain invites/removal; you keep everything else). */
export async function transferOwnershipAction(formData: FormData): Promise<void> {
  const session = await requireOwner();
  const newOwnerId = Number(formData.get("newOwnerId"));
  if (!Number.isInteger(newOwnerId) || newOwnerId === session.accountId) {
    throw new Error("Pick another member to hand the keys to.");
  }
  // The new owner must be a login in THIS group (bound check).
  const [target] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.id, newOwnerId), eq(accounts.groupId, session.groupId)))
    .limit(1);
  if (!target) throw new Error("That login isn't a member of this hub.");

  await db
    .update(groups)
    .set({ ownerAccountId: newOwnerId })
    .where(eq(groups.id, session.groupId));
  revalidatePath("/group");
}

/**
 * Delete the WHOLE hub, forever: every person, car, workout, weigh-in, login
 * and invite. Owner-only, and the form must echo the hub's exact name back
 * (the type-the-name ritual). Deletion order matters:
 *   1. attachment rows — polymorphic (no FK), they'd survive the cascade;
 *   2. workouts — `ON DELETE RESTRICT` behind profiles (the guard that stops a
 *      profile delete nuking shared routines) would abort the group cascade;
 *   3. the group row — everything else cascades off it (accounts→passkeys+
 *      invites, profiles→weight data, vehicles→records/fuel/parts/journal…).
 * Other members' sessions die at their next request (liveness check).
 */
export async function deleteHubAction(formData: FormData): Promise<void> {
  const session = await requireOwner();
  const [group] = await db
    .select({ name: groups.name, isDemo: groups.isDemo })
    .from(groups)
    .where(eq(groups.id, session.groupId))
    .limit(1);
  if (!group || group.isDemo) throw new Error("This hub can't be deleted.");

  const typed = String(formData.get("confirm") ?? "").trim();
  if (typed !== group.name) {
    throw new Error("The name you typed doesn't match this hub's name.");
  }

  const groupVehicles = db
    .select({ id: vehicles.id })
    .from(vehicles)
    .where(eq(vehicles.groupId, session.groupId));
  await db
    .delete(attachments)
    .where(
      or(
        and(eq(attachments.ownerType, "vehicle"), inArray(attachments.ownerId, groupVehicles)),
        and(
          eq(attachments.ownerType, "maintenance"),
          inArray(
            attachments.ownerId,
            db
              .select({ id: maintenanceRecords.id })
              .from(maintenanceRecords)
              .where(inArray(maintenanceRecords.vehicleId, groupVehicles)),
          ),
        ),
        and(
          eq(attachments.ownerType, "journal"),
          inArray(
            attachments.ownerId,
            db
              .select({ id: journalEntries.id })
              .from(journalEntries)
              .where(inArray(journalEntries.vehicleId, groupVehicles)),
          ),
        ),
        and(
          eq(attachments.ownerType, "wishlist"),
          inArray(
            attachments.ownerId,
            db
              .select({ id: wishlistItems.id })
              .from(wishlistItems)
              .where(inArray(wishlistItems.vehicleId, groupVehicles)),
          ),
        ),
      ),
    );

  await db.delete(workouts).where(
    inArray(
      workouts.createdByProfileId,
      db
        .select({ id: profiles.id })
        .from(profiles)
        .where(eq(profiles.groupId, session.groupId)),
    ),
  );

  await db.delete(groups).where(eq(groups.id, session.groupId));

  await destroySession();
  redirect("/login");
}

/** Rename the household (shown on /group and in invite greetings). */
export async function renameGroupAction(formData: FormData): Promise<void> {
  await requireEditor();
  const { groupId } = await requireSession();
  const name = String(formData.get("name") ?? "").trim().slice(0, 120);
  if (!name) throw new Error("Group name is required.");

  await db.update(groups).set({ name }).where(eq(groups.id, groupId));
  revalidatePath("/group");
}

/** A real IANA timezone? Intl throws on garbage — cheap, correct validation. */
function isValidTimeZone(tz: string): boolean {
  try {
    Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Set the household timezone — pins the finance app's "today" (see parse.ts). */
export async function updateGroupTimezoneAction(formData: FormData): Promise<void> {
  await requireEditor();
  const { groupId } = await requireSession();
  const tz = String(formData.get("timezone") ?? "").trim().slice(0, 64);
  if (!tz || !isValidTimeZone(tz)) throw new Error("Pick a valid timezone.");

  await db.update(groups).set({ timezone: tz }).where(eq(groups.id, groupId));
  revalidatePath("/group");
  revalidatePath("/finance"); // budget/atlas recompute their "current month"
}
