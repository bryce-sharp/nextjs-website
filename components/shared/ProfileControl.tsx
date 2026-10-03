import { listProfiles } from "@/lib/queries/profiles";
import { listGroupMembers } from "@/lib/queries/groups";
import { getActiveProfile } from "@/lib/profile";
import { getSession } from "@/lib/session";
import ProfileMenu, { type ProfilePick } from "./ProfileMenu";

// Server component: reads who's active + the roster, then hands a plain,
// serializable slice to the client menu. Passed into AppHeader as a prop.
export default async function ProfileControl() {
  const [profiles, active, members, session] = await Promise.all([
    listProfiles(),
    getActiveProfile(),
    listGroupMembers(),
    getSession(),
  ]);

  // profileId → the username holding its claim, for profiles claimed by SOMEONE
  // ELSE. "Claim is the lock" (lib/auth): those profiles' OWNED data is theirs
  // alone, so the menu marks them.
  // Your own claimed profile is not locked — you're the one who can edit it.
  const lockedBy = new Map<number, string>();
  for (const m of members) {
    if (m.profileId != null && m.id !== session?.accountId) {
      lockedBy.set(m.profileId, m.username);
    }
  }

  const pick = (p: { id: number; name: string; color: string | null }): ProfilePick => ({
    id: p.id,
    name: p.name,
    color: p.color,
    lockedBy: lockedBy.get(p.id) ?? null,
  });

  return (
    <ProfileMenu
      active={active ? pick(active) : null}
      profiles={profiles.map(pick)}
    />
  );
}
