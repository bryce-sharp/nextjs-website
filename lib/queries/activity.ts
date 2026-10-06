import "server-only";
import { getSession } from "@/lib/session";
import { isOwner, isSiteAdmin } from "@/lib/auth";
import { getGroupTimezone } from "@/lib/queries/group";
import { isProblem, listEvents, listEventSources, type EventScope } from "@/lib/events";
import { formatDateTime } from "@/lib/format";

// The Activity list on /group: the event log as the household owner sees it
// (their household's events) and as a site admin sees it (plus the events
// that belong to no household). Anyone else sees nothing.

export const ACTIVITY_PAGE = 15;

/** One line of the Activity list, ready to show. */
export type ActivityRow = {
  id: number;
  /** When it happened, in the household's time zone. */
  when: string;
  source: string;
  kind: string;
  message: string;
  problem: boolean;
  /** A site event (no household), shown to site admins only. */
  site: boolean;
  data: Record<string, unknown> | null;
};

export type ActivityPage = { rows: ActivityRow[]; more: boolean };

type Viewer = { scope: EventScope; timeZone: string };

/** What the signed-in account may read, or null when it may read nothing. */
export async function activityViewer(): Promise<Viewer | null> {
  const session = await getSession();
  if (!session) return null;
  const [owner, admin] = await Promise.all([isOwner(), isSiteAdmin()]);
  if (!owner && !admin) return null;
  return {
    scope: { groupId: owner ? session.groupId : null, site: admin },
    timeZone: await getGroupTimezone(session.groupId),
  };
}

/** One page of events, newest first; `before` is the last id already shown. */
export async function listActivity(
  viewer: Viewer,
  opts: { source?: string; before?: number } = {},
): Promise<ActivityPage> {
  const events = await listEvents(viewer.scope, { ...opts, limit: ACTIVITY_PAGE + 1 });
  return {
    rows: events.slice(0, ACTIVITY_PAGE).map((e) => ({
      id: e.id,
      when: formatDateTime(e.at, viewer.timeZone),
      source: e.source,
      kind: e.kind,
      message: e.message ?? e.kind,
      problem: isProblem(e),
      site: e.groupId === null,
      data: e.data,
    })),
    more: events.length > ACTIVITY_PAGE,
  };
}

/** The sources with events this viewer can read, for the filter. */
export async function listActivitySources(viewer: Viewer): Promise<string[]> {
  return listEventSources(viewer.scope);
}
