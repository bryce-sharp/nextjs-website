import Link from "@/components/shared/AppLink";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Container from "@mui/material/Container";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import GroupNameEditor from "./GroupNameEditor";
import GroupTabs, { type GroupTab } from "./GroupTabs";
import PeopleTab from "./PeopleTab";
import TimezoneSetting from "./TimezoneSetting";
import InvitesPanel, { type InviteRow } from "./InvitesPanel";
import DangerZone from "./DangerZone";
import SignInSection from "./SignInSection";
import ActivityLog from "./ActivityLog";
import { getSession } from "@/lib/session";
import { isEditor } from "@/lib/auth";
import { getMyGroup, listGroupMembers } from "@/lib/queries/groups";
import { listPendingInvites } from "@/lib/queries/invites";
import { activityViewer, listActivity, listActivitySources } from "@/lib/queries/activity";

export const metadata = { title: "Group" };

/** Whole days until a date, never below zero. */
function daysUntil(date: Date): number {
  return Math.max(0, Math.floor((date.getTime() - Date.now()) / 86_400_000));
}

// The household's control room (/people redirects here), one tab per job:
//   People    profiles and logins, and the claims that tie them together
//   Invites   the owner's invite links
//   Activity  the event log: the owner's household events, plus site events
//             for a site admin
//   Sign-in   the signed-in account's own password and passkeys; sign-in
//             sends people here with a reset notice or the add-Face-ID nudge
//   Settings  the time zone and the exit doors (leave, transfer, delete)
export default async function GroupPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; nudge?: string; next?: string }>;
}) {
  const { tab, nudge, next } = await searchParams;
  const session = await getSession();
  if (!session) redirect("/login"); // proxy already gates; belt anyway

  const [group, canEdit, viewer] = await Promise.all([getMyGroup(), isEditor(), activityViewer()]);
  // Membership controls (invites, removal, reset links) are the OWNER's.
  const viewerIsOwner =
    group?.ownerAccountId != null && group.ownerAccountId === session.accountId;
  const manages = viewerIsOwner && canEdit;

  const tabs: { value: GroupTab; label: string }[] = [
    { value: "people", label: "People" },
    ...(manages ? [{ value: "invites" as const, label: "Invites" }] : []),
    ...(viewer ? [{ value: "activity" as const, label: "Activity" }] : []),
    { value: "sign-in", label: "Sign-in" },
    { value: "settings", label: "Settings" },
  ];
  const wanted = nudge === "1" ? "sign-in" : tab;
  const active = tabs.find((t) => t.value === wanted)?.value ?? "people";

  // Invite and reset links need an absolute URL: derive the origin from Host
  // headers (same idiom as lib/webauthn), never an env var.
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto =
    h.get("x-forwarded-proto") ??
    (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  const origin = `${proto}://${host}`;

  const inviteRows: InviteRow[] =
    active === "invites"
      ? (await listPendingInvites()).map((inv) => ({
          id: inv.id,
          link: `${origin}/join/${inv.token}`,
          note: inv.note,
          household: inv.groupId !== null,
          reusable: inv.maxUses === null,
          expiresInDays: daysUntil(inv.expiresAt),
        }))
      : [];
  const [activity, activitySources] =
    active === "activity" && viewer
      ? await Promise.all([listActivity(viewer), listActivitySources(viewer)])
      : [null, []];
  const members = active === "settings" ? await listGroupMembers() : [];

  return (
    <Container maxWidth="sm" sx={{ py: { xs: 4, md: 6 } }}>
      <Button
        component={Link}
        href="/"
        startIcon={<ArrowBackIcon />}
        color="inherit"
        sx={{ mb: 2 }}
      >
        Back to hub
      </Button>

      <Stack spacing={2.5}>
        <GroupNameEditor name={group?.name ?? "Group"} canEdit={canEdit} />

        <GroupTabs active={active} tabs={tabs} />

        {active === "people" ? (
          <PeopleTab
            accountId={session.accountId}
            ownerAccountId={group?.ownerAccountId ?? null}
            canEdit={canEdit}
            viewerIsOwner={viewerIsOwner}
            origin={origin}
          />
        ) : null}

        {active === "invites" ? (
          <Stack spacing={2}>
            <InvitesPanel
              origin={origin}
              groupName={group?.name ?? "this hub"}
              invites={inviteRows}
            />
            <Typography variant="caption" color="text.secondary">
              Links are single-use and expire in 7 days unless you say
              otherwise. A &ldquo;join&rdquo; invite makes them a member of this
              hub; an &ldquo;own hub&rdquo; invite gives them a fresh private
              one.
            </Typography>
          </Stack>
        ) : null}

        {active === "activity" && viewer && activity ? (
          <ActivityLog
            initial={activity}
            sources={activitySources}
            owner={viewer.scope.groupId !== null}
            siteAdmin={viewer.scope.site === true}
          />
        ) : null}

        {active === "sign-in" ? (
          <SignInSection
            accountId={session.accountId}
            iat={session.iat}
            isOwner={viewerIsOwner}
            nudge={nudge === "1"}
            next={next ?? "/"}
          />
        ) : null}

        {active === "settings" ? (
          <Stack spacing={2.5}>
            <TimezoneSetting
              timezone={group?.timezone ?? "America/Chicago"}
              canEdit={canEdit}
            />
            {!group?.isDemo ? (
              <DangerZone
                isOwner={viewerIsOwner}
                groupName={group?.name ?? "this hub"}
                others={members
                  .filter((m) => m.id !== session.accountId)
                  .map((m) => ({ id: m.id, username: m.username }))}
              />
            ) : null}
          </Stack>
        ) : null}
      </Stack>
    </Container>
  );
}
