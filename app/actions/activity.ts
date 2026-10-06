"use server";

import { activityViewer, listActivity, type ActivityPage } from "@/lib/queries/activity";

// The Activity list on /group pages through the event log here: the source
// filter and "Show more". activityViewer decides what the account may read.

/** One page of activity; `before` is the last id already shown. */
export async function listActivityAction(opts: {
  source: string | null;
  before: number | null;
}): Promise<ActivityPage | { error: string }> {
  const viewer = await activityViewer();
  if (!viewer) return { error: "Only the household owner can see its activity." };
  const source = typeof opts?.source === "string" && opts.source.length <= 40 ? opts.source : undefined;
  const before = Number.isInteger(opts?.before) && Number(opts.before) > 0 ? Number(opts.before) : undefined;
  return listActivity(viewer, { source, before });
}
