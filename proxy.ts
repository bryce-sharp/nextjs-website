import { NextRequest, NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  mintSessionToken,
  readSessionToken,
} from "@/lib/session-core";

// ─────────────────────────────────────────────────────────────────────────────
// GLOBAL LOGIN GATE — the hub is private; every request needs a valid session
// cookie or gets redirected to /login. (Next 16.3 renamed the `middleware` file
// convention to `proxy` — same feature.) This is the convenience layer (the
// redirect); the data layer double-checks via requireSession() in the write
// guards, so a proxy bypass can't mutate anything.
//
// Also handles ROLLING EXPIRY: sessions last 90 days, and any visit in the
// second half of that window re-issues a fresh cookie — so a device in regular
// use never logs out, while one untouched for 90 days expires. The re-issue
// happens here (not in lib/session) because only the proxy/actions may set
// cookies, and the proxy sees every request.
// ─────────────────────────────────────────────────────────────────────────────

// Reachable while signed out: the login page itself, everything a PWA install /
// browser tab needs before auth (manifest + icons — see the note in
// app/manifest.ts), and the Phase E doors: /join/<token> (an invite IS the
// credential — the visitor doesn't have a login yet), /reset/<token> (a reset
// link is the credential for someone locked out), and /signout (where dead
// sessions go to clear their cookie). Everything else redirects.
const PUBLIC_PATHS = new Set([
  "/login",
  "/signout",
  "/manifest.webmanifest",
  "/manifest-icon",
  "/apple-icon",
  "/profile-icon",
  "/icon.svg",
  "/favicon.ico",
]);

function isPublic(pathname: string): boolean {
  return (
    PUBLIC_PATHS.has(pathname) ||
    pathname.startsWith("/join/") ||
    pathname.startsWith("/reset/") ||
    // Finance machine endpoints — token-authed themselves (Bearer fin_…), so
    // the session gate must let them through. Without this the Shortcut's POST
    // 307s to /login and the alert is silently lost.
    pathname.startsWith("/api/finance/") ||
    // Plaid's webhook (signature-verified) and Vercel Cron (CRON_SECRET bearer)
    // also authenticate themselves; redirected to /login they would be lost.
    pathname === "/api/plaid/webhook" ||
    pathname.startsWith("/api/cron/")
  );
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // 307 keeps the method (fine for GET); non-GET (server-action POSTs from a
  // logged-out tab) gets 303 so the browser lands on /login as a plain GET.
  const redirectStatus = req.method === "GET" ? 307 : 303;

  // No secret configured → fail CLOSED (redirect loop-free: /login is public).
  // Better a locked-out deploy you notice than a silently public one.
  const secret = process.env.COOKIE_SECRET;
  const session = secret
    ? await readSessionToken(req.cookies.get(SESSION_COOKIE)?.value, secret)
    : null;

  if (!session) {
    if (isPublic(pathname)) return NextResponse.next();
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    // Remember where they were headed (GET only — a replayed POST path is useless).
    if (req.method === "GET" && pathname !== "/") {
      url.searchParams.set("from", pathname + req.nextUrl.search);
    }
    return NextResponse.redirect(url, redirectStatus);
  }

  // Signed in — /login has nothing to offer.
  if (pathname === "/login") {
    return NextResponse.redirect(new URL("/", req.url), redirectStatus);
  }

  const res = NextResponse.next();

  // Rolling renewal: past the session's half-life → re-issue for a fresh 90d.
  const now = Math.floor(Date.now() / 1000);
  if (secret && session.exp - now < SESSION_TTL_SECONDS / 2) {
    const token = await mintSessionToken(
      {
        accountId: session.accountId,
        groupId: session.groupId,
        exp: now + SESSION_TTL_SECONDS,
        iat: session.iat, // the sign-in time survives renewal, or a reset could be outlived
      },
      secret,
    );
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_TTL_SECONDS,
    });
  }

  return res;
}

export const config = {
  // Everything except Next's own assets (/_next/* — build chunks, HMR, images).
  matcher: ["/((?!_next/).*)"],
};
