import { NextRequest, NextResponse, after } from "next/server";
import { plaidConfigured } from "@/lib/plaid/client";
import { handlePlaidWebhook, verifyPlaidWebhook, type PlaidWebhook } from "@/lib/plaid/webhook";
import { logEvent } from "@/lib/events";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/plaid/webhook — Plaid's calls about connected banks. Public on
// purpose (proxy.ts allowlists it): the signature check IS the authentication.
// A verified call always gets a 200 at once, and any sync runs after the reply,
// because Plaid retries anything slower than 10 seconds or other than 2xx.
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  if (!plaidConfigured()) return NextResponse.json({ ok: false }, { status: 404 });

  const body = await req.text();
  if (!(await verifyPlaidWebhook(body, req.headers.get("plaid-verification")))) {
    // Logged without the body: an unverified caller's content is not worth keeping.
    await logEvent({ groupId: null, source: "plaid", kind: "webhook_rejected", message: "A webhook failed its signature check" });
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let hook: PlaidWebhook;
  try {
    hook = JSON.parse(body) as PlaidWebhook;
  } catch {
    await logEvent({ groupId: null, source: "plaid", kind: "webhook_rejected", message: "A signed webhook was not JSON" });
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  await handlePlaidWebhook(hook, (work) =>
    after(async () => {
      try {
        await work();
      } catch (err) {
        console.error("plaid webhook work failed", err instanceof Error ? err.message : "unknown error");
      }
    }),
  );
  return NextResponse.json({ ok: true });
}
