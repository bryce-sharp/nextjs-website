import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import LoginForm from "./LoginForm";

// The one page a signed-out visitor can reach (proxy.ts allowlists it).
// Everything hub-shaped stays behind the gate — this page deliberately shows
// nothing about the household (no profile names/colors beyond the app shell).

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; reset?: string }>;
}) {
  // Already signed in? (e.g. a second tab) — nothing to do here.
  if ((await getSession()) !== null) redirect("/");

  const { from, reset } = await searchParams;
  return (
    <LoginForm
      from={from ?? ""}
      notice={reset ? "Your password is updated. Sign in with the new one." : undefined}
    />
  );
}
