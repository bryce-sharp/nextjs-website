"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  profiles,
  vehicles,
  workouts,
  workoutAssignments,
} from "@/lib/db/schema";
import { requireEditor, requireEditorFor } from "@/lib/auth";
import { getActiveProfile, setActiveProfileCookie } from "@/lib/profile";
import { requireGroupId } from "@/lib/session";
import { getProfile } from "@/lib/queries/profiles";
import { APPS } from "@/lib/apps";
import { cleanEquipment } from "@/lib/workout";

/** First active profile in OUR group other than `exceptId`, or null. */
async function otherActiveProfile(exceptId: number) {
  const groupId = await requireGroupId();
  const rows = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(
      and(
        eq(profiles.groupId, groupId),
        isNull(profiles.archivedAt),
        ne(profiles.id, exceptId),
      ),
    )
    .orderBy(profiles.sortOrder, profiles.id)
    .limit(1);
  return rows[0] ?? null;
}

// Switching who we are is harmless (it only changes whose data you view), so it's
// open to anyone. Adding a person is a mutation — editor-gated.

/** Make `id` the active profile and refresh every server-rendered page. */
export async function switchProfile(id: number): Promise<void> {
  // Only switch to one of OUR (active) profiles — a foreign or archived id is a
  // no-op. getActiveProfile would neutralize a bad cookie anyway; this keeps it
  // from ever being written. (Switching is freely open: viewing another person
  // was never gated, and their CLAIMED stuff stays hands-off regardless.)
  const target = await getProfile(id); // group-scoped
  if (!target || target.archivedAt) return;
  await setActiveProfileCookie(id);
  revalidatePath("/", "layout");
}

/** Create a new person and switch to them. (Unclaimed → open to the group; an
 *  account can claim them at /group to make their stuff hands-off.) */
export async function addPerson(formData: FormData): Promise<void> {
  await requireEditor();

  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Name is required.");
  const color = String(formData.get("color") ?? "").trim() || null;

  const [created] = await db
    .insert(profiles)
    .values({ groupId: await requireGroupId(), name, color })
    .returning();

  if (created) await setActiveProfileCookie(created.id);
  revalidatePath("/", "layout");
}

/** Update a person's display name, color, hidden-apps + owned-equipment. */
export async function updateProfile(
  id: number,
  formData: FormData,
): Promise<void> {
  await requireEditorFor(id); // unclaimed or claimed-by-you (see lib/auth)

  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Name is required.");
  const color = String(formData.get("color") ?? "").trim() || null;
  const hiddenApps = parseHiddenApps(formData.get("hiddenApps"));

  // Only touch equipment when the form actually carried the field. The /people
  // dialog doesn't (gear is edited in the workout app via setProfileEquipment),
  // and an absent field used to parse as [] — silently wiping someone's gear
  // every time their name or color was saved.
  const rawEquipment = formData.get("equipment");
  const equipment =
    rawEquipment != null ? { equipment: parseEquipment(rawEquipment) } : {};

  await db
    .update(profiles)
    .set({ name, color, hiddenApps, ...equipment })
    .where(eq(profiles.id, id));
  revalidatePath("/", "layout");
}

/**
 * Set just the gear a person owns — a standalone action so the workout catalog &
 * builder can offer a "My equipment" picker without touching name/color/apps.
 * Editor-gated like every other write (keeps the read-only showcase read-only).
 */
export async function setProfileEquipment(
  id: number,
  formData: FormData,
): Promise<void> {
  await requireEditorFor(id);
  const equipment = parseEquipment(formData.get("equipment"));
  await db.update(profiles).set({ equipment }).where(eq(profiles.id, id));
  revalidatePath("/", "layout");
}

/** Parse the equipment hidden field (JSON array of slugs), keeping known ones. */
function parseEquipment(raw: FormDataEntryValue | null): string[] {
  if (typeof raw !== "string" || !raw) return [];
  try {
    return cleanEquipment(JSON.parse(raw));
  } catch {
    return [];
  }
}

/**
 * Parse the hidden-apps hidden field (a JSON array of slugs) and keep only real,
 * known app slugs — so a stale or bogus value can never persist. Hiding every
 * app is meaningless (the hub falls back to showing all), so we never let the
 * last app be hidden: if the list would cover them all, we store nothing.
 */
function parseHiddenApps(raw: FormDataEntryValue | null): string[] {
  if (typeof raw !== "string" || !raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const known = new Set(APPS.map((a) => a.slug));
  const hidden = [...new Set(parsed)].filter(
    (s): s is string => typeof s === "string" && known.has(s),
  );
  return hidden.length >= known.size ? [] : hidden;
}

/**
 * Deactivate (soft-delete): hide from the switcher + stop it being active, but keep
 * ALL their data. Reversible via reactivateProfile. Can't leave zero active
 * profiles; if the archived one is currently active, switch to another first.
 */
export async function deactivateProfile(id: number): Promise<void> {
  await requireEditorFor(id); // deactivate a person you've unlocked

  const activeCount = await db.$count(
    profiles,
    and(eq(profiles.groupId, await requireGroupId()), isNull(profiles.archivedAt)),
  );
  if (activeCount <= 1) {
    throw new Error("Can't deactivate the only active profile.");
  }

  const current = await getActiveProfile();
  if (current?.id === id) {
    const other = await otherActiveProfile(id);
    if (other) await setActiveProfileCookie(other.id);
  }

  await db
    .update(profiles)
    .set({ archivedAt: new Date() })
    .where(eq(profiles.id, id));

  revalidatePath("/", "layout");
}

/**
 * Restore an archived profile. Gated by requireEditor (not requireEditorFor):
 * an archived profile can't be made active, so it can't be unlocked — requiring
 * its own unlock would strand it archived forever.
 */
export async function reactivateProfile(id: number): Promise<void> {
  await requireEditor();
  await db.update(profiles).set({ archivedAt: null }).where(eq(profiles.id, id));
  revalidatePath("/", "layout");
}

/**
 * Permanently delete a profile (irreversible). Shared cars + the workouts they
 * authored transfer to `heirId` so nothing shared is lost; their PRIVATE cars (and
 * that history) plus their weekly schedule are deleted with them.
 */
export async function deleteProfileForever(
  id: number,
  heirId: number,
): Promise<void> {
  await requireEditorFor(id); // delete a person you've unlocked

  if (heirId === id) throw new Error("Pick a different profile to inherit.");
  // Heir must be one of OUR active profiles — shared cars/workouts must never
  // transfer across the group boundary.
  const [heir] = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(
      and(
        eq(profiles.id, heirId),
        eq(profiles.groupId, await requireGroupId()),
        isNull(profiles.archivedAt),
      ),
    )
    .limit(1);
  if (!heir) throw new Error("Heir profile not found.");

  const wasActive = (await getActiveProfile())?.id === id;

  // Hand off shared belongings so the remaining people keep them.
  await db
    .update(vehicles)
    .set({ profileId: heirId })
    .where(and(eq(vehicles.profileId, id), eq(vehicles.visibility, "shared")));
  await db
    .update(workouts)
    .set({ createdByProfileId: heirId })
    .where(eq(workouts.createdByProfileId, id));

  // Delete what's solely theirs (private cars cascade their maintenance/fuel/etc.).
  await db
    .delete(vehicles)
    .where(and(eq(vehicles.profileId, id), eq(vehicles.visibility, "private")));
  await db.delete(workoutAssignments).where(eq(workoutAssignments.profileId, id));

  await db.delete(profiles).where(eq(profiles.id, id));

  if (wasActive) await setActiveProfileCookie(heirId);
  revalidatePath("/", "layout");
}
