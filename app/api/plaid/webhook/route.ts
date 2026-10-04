import { NextRequest, NextResponse, after } from "next/server";
import { plaidConfigured } from "@/lib/plaid/client";
import { handlePlaidWebhook, verifyPlaidWebhook, type PlaidWebhook } from "@/lib/plaid/webhook";

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
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let hook: PlaidWebhook;
  try {
    hook = JSON.parse(body) as PlaidWebhook;
  } catch {
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
