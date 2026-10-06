import "server-only";
import { and, desc, eq, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { eventLog } from "@/lib/db/schema";

// The app-wide event log: one place to record what happened and when (a bank's
// webhook, a sync and what started it), so health can be checked after the fact
// instead of in server logs that last an hour. Writing never throws: a failed
// log line must not break the work it describes.

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
  source: string;
  kind: string;
  message: string | null;
  data: Record<string, unknown> | null;
};

/** A household's most recent events, newest first. */
export async function listEvents(
  groupId: number,
  opts: { source?: string; limit?: number } = {},
): Promise<EventView[]> {
  const rows = await db
    .select()
    .from(eventLog)
    .where(and(eq(eventLog.groupId, groupId), opts.source ? eq(eventLog.source, opts.source) : undefined))
    .orderBy(desc(eventLog.createdAt), desc(eventLog.id))
    .limit(opts.limit ?? 20);
  return rows.map((r) => ({
    id: r.id,
    at: r.createdAt.toISOString(),
    source: r.source,
    kind: r.kind,
    message: r.message,
    data: r.data ?? null,
  }));
}

/** Drop events older than the retention window; the daily cron calls this. */
export async function pruneEvents(days = 180): Promise<number> {
  const gone = await db
    .delete(eventLog)
    .where(lt(eventLog.createdAt, sql`now() - make_interval(days => ${days})`))
    .returning({ id: eventLog.id });
  return gone.length;
}
