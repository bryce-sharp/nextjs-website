import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { plaidItems } from "@/lib/db/schema";
import { plaidConfigured } from "@/lib/plaid/client";
import { syncPlaidItem } from "@/lib/plaid/sync";
import { pruneEvents } from "@/lib/events";

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/cron/plaid — the daily backstop (vercel.json crons). Syncs every
// connected bank, so anything a missed webhook would have delivered still
// arrives within a day, and a broken login still surfaces as Reconnect. Vercel
// sends "Authorization: Bearer $CRON_SECRET"; anything else is refused, and
// with no secret configured the route fails closed. It also trims the event
// log to its 180-day window.
// ─────────────────────────────────────────────────────────────────────────────

function fromVercelCron(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(req.headers.get("authorization") ?? "");
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export async function GET(req: NextRequest) {
  if (!fromVercelCron(req)) return NextResponse.json({ ok: false }, { status: 401 });
  const pruned = await pruneEvents();
  if (!plaidConfigured()) return NextResponse.json({ ok: true, synced: 0, pruned });

  const items = await db.select({ id: plaidItems.id }).from(plaidItems);
  const results = [];
  for (const item of items) {
    const outcome = await syncPlaidItem(item.id, "cron");
    results.push(
      outcome.ok
        ? { id: item.id, ok: true, applied: outcome.applied }
        : { id: item.id, ok: false, busy: outcome.busy === true },
    );
  }
  return NextResponse.json({ ok: true, synced: results.length, results, pruned });
}
