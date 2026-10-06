import "server-only";
import { and, desc, eq, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { eventLog } from "@/lib/db/schema";

// The app-wide event log: one place to record what happened and when (a bank's
// webhook, a sync and what started it), so health can be checked after the fact
// instead of in server logs that last an hour. Writing never throws: a failed
// log line must not break the work it describes. A failure is recorded with
// data.ok = false, or a kind ending in "_rejected" or "_failed", so readers can
// flag it. Events with no household (a webhook the site refused) are site
// events, readable by site admins only.

export type EventInput = {
  groupId: number | null;
  source: string;
  kind: string;
  message?: string | null;
  data?: Record<string, unknown> | null;
};

export async function logEvent(e: EventInput): Promise<void> {
  try {
    await db.insert(eventLog).values({
      groupId: e.groupId,
      source: e.source.slice(0, 40),
      kind: e.kind.slice(0, 60),
      message: e.message ?? null,
      data: e.data ?? null,
    });
  } catch (err) {
    console.error("event log write failed", err instanceof Error ? err.message : "unknown error");
  }
}

export type EventView = {
  id: number;
  at: string; // ISO timestamp
  groupId: number | null;
  source: string;
  kind: string;
  message: string | null;
  data: Record<string, unknown> | null;
};

/** Whose events to read: one household's (or none), plus site events when `site` is set. */
export type EventScope = { groupId: number | null; site?: boolean };

/** The filter for a scope, or null when it covers nothing (never "everything"). */
function scopeFilter(scope: EventScope): SQL | null {
  const parts: SQL[] = [];
  if (scope.groupId !== null) parts.push(eq(eventLog.groupId, scope.groupId));
  if (scope.site) parts.push(isNull(eventLog.groupId));
  return parts.length ? (or(...parts) ?? null) : null;
}

/** Did this event record something going wrong (a failed sync, a refused webhook)? */
export function isProblem(e: Pick<EventView, "kind" | "data">): boolean {
  return /_(rejected|failed)$/.test(e.kind) || e.data?.ok === false;
}

/**
 * Events in a scope, newest first, a page at a time: pass the last id of the
 * previous page as `before` for the next one.
 */
export async function listEvents(
  scope: EventScope,
  opts: { source?: string; before?: number; limit?: number } = {},
): Promise<EventView[]> {
  const who = scopeFilter(scope);
  if (!who) return [];
  const rows = await db
    .select()
    .from(eventLog)
    .where(
      and(
        who,
        opts.source ? eq(eventLog.source, opts.source) : undefined,
        opts.before !== undefined ? lt(eventLog.id, opts.before) : undefined,
      ),
    )
    .orderBy(desc(eventLog.id))
    .limit(opts.limit ?? 20);
  return rows.map((r) => ({
    id: r.id,
    at: r.createdAt.toISOString(),
    groupId: r.groupId,
    source: r.source,
    kind: r.kind,
    message: r.message,
    data: r.data ?? null,
  }));
}

/** The sources that have events in a scope, for a filter. */
export async function listEventSources(scope: EventScope): Promise<string[]> {
  const who = scopeFilter(scope);
  if (!who) return [];
  const rows = await db
    .selectDistinct({ source: eventLog.source })
    .from(eventLog)
    .where(who)
    .orderBy(eventLog.source);
  return rows.map((r) => r.source);
}

/** Drop events older than the retention window; the daily cron calls this. */
export async function pruneEvents(days = 180): Promise<number> {
  const gone = await db
    .delete(eventLog)
    .where(lt(eventLog.createdAt, sql`now() - make_interval(days => ${days})`))
    .returning({ id: eventLog.id });
  return gone.length;
}
