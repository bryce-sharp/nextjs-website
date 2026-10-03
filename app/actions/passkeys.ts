"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type RegistrationResponseJSON,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type AuthenticatorTransportFuture,
} from "@simplewebauthn/server";
import { db } from "@/lib/db";
import { accounts, passkeys } from "@/lib/db/schema";
import { createSession, requireSession } from "@/lib/session";
import { setActiveProfileCookie } from "@/lib/profile";
import { relyingParty, storeChallenge, takeChallenge } from "@/lib/webauthn";
import { listPasskeys, getPasskey } from "@/lib/queries/passkeys";
import { afterSignIn } from "@/lib/password-reset";

// ─────────────────────────────────────────────────────────────────────────────
// PASSKEYS (WebAuthn) — each flow is a two-action dance: start() makes the
// challenge + options, the browser has the authenticator (Face ID) sign it,
// finish() verifies. The challenge rides between the two in a one-shot signed
// cookie (lib/webauthn). Registration requires a session; LOGIN IS PUBLIC (it's
// the login) and is "usernameless" — no allowCredentials, the platform offers
// whatever discoverable credential it holds for this rpID and the credential id
// it returns tells us which account is signing in.
// ─────────────────────────────────────────────────────────────────────────────

export type PasskeyResult = { ok: true; next?: string } | { ok: false; error: string };

// ── Registration (signed in: add a passkey for YOUR account) ──────────────────
export async function startPasskeyRegistration(): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const { accountId } = await requireSession();
  const [account] = await db
    .select()
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .limit(1);
  if (!account) throw new Error("Account not found.");

  const { rpID, rpName } = await relyingParty();
  const existing = await listPasskeys(accountId);

  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userName: account.username,
    // Stable per-account handle: platforms key passkeys on (rpID, userID), so
    // re-registering on the same device REPLACES its old passkey (no dupes).
    // (The copy through new Uint8Array pins the ArrayBuffer flavor TS wants.)
    userID: new Uint8Array(new TextEncoder().encode(`hub-account-${account.id}`)),
    attestationType: "none",
    // Don't re-register a credential we already have.
    excludeCredentials: existing.map((p) => ({
      id: p.id,
      transports: p.transports as AuthenticatorTransportFuture[],
    })),
    authenticatorSelection: {
      residentKey: "required", // discoverable → enables usernameless login
      userVerification: "preferred", // Face ID / PIN
    },
  });

  await storeChallenge(options.challenge, "registration", accountId);
  return options;
}

export async function finishPasskeyRegistration(
  response: RegistrationResponseJSON,
): Promise<PasskeyResult> {
  const { accountId } = await requireSession();
  const pending = await takeChallenge("registration");
  if (!pending || pending.accountId !== accountId) {
    return { ok: false, error: "Registration expired — try again." };
  }

  const { rpID, origin } = await relyingParty();
  let verified = false;
  let info: Awaited<ReturnType<typeof verifyRegistrationResponse>>["registrationInfo"];
  try {
    const result = await verifyRegistrationResponse({
      response,
      expectedChallenge: pending.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
    });
    verified = result.verified;
    info = result.registrationInfo;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Verification failed." };
  }
  if (!verified || !info) return { ok: false, error: "Passkey could not be verified." };

  const { credential, credentialDeviceType, credentialBackedUp } = info;
  const label = `Passkey added ${new Date().toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })}`;

  await db
    .insert(passkeys)
    .values({
      id: credential.id,
      accountId,
      publicKey: Buffer.from(credential.publicKey).toString("base64url"),
      counter: credential.counter,
      transports: credential.transports ?? [],
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
      label,
    })
    // Same physical credential re-registered → refresh it instead of erroring.
    .onConflictDoUpdate({
      target: passkeys.id,
      set: {
        accountId,
        publicKey: Buffer.from(credential.publicKey).toString("base64url"),
        counter: credential.counter,
        backedUp: credentialBackedUp,
      },
    });

  revalidatePath("/group");
  return { ok: true };
}

// ── Login (PUBLIC — this runs from /login, signed out) ────────────────────────
export async function startPasskeyLogin(): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const { rpID } = await relyingParty();
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: "preferred",
    // No allowCredentials → usernameless: the device offers its passkey(s).
  });
  await storeChallenge(options.challenge, "authentication");
  return options;
}

export async function finishPasskeyLogin(
  response: AuthenticationResponseJSON,
  from = "",
): Promise<PasskeyResult> {
  const pending = await takeChallenge("authentication");
  if (!pending) return { ok: false, error: "Sign-in expired — try again." };

  const passkey = await getPasskey(response.id);
  if (!passkey) return { ok: false, error: "That passkey isn't registered here." };

  const { rpID, origin } = await relyingParty();
  let verified = false;
  let newCounter = passkey.counter;
  try {
    const result = await verifyAuthenticationResponse({
      response,
      expectedChallenge: pending.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: passkey.id,
        publicKey: new Uint8Array(Buffer.from(passkey.publicKey, "base64url")),
        counter: passkey.counter,
        transports: passkey.transports as AuthenticatorTransportFuture[],
      },
    });
    verified = result.verified;
    newCounter = result.authenticationInfo.newCounter;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Verification failed." };
  }
  if (!verified) return { ok: false, error: "Passkey could not be verified." };

  await db
    .update(passkeys)
    .set({ counter: newCounter, lastUsedAt: new Date() })
    .where(eq(passkeys.id, passkey.id));

  // The session needs the account's group — one lookup at login time only.
  const [account] = await db
    .select({ groupId: accounts.groupId, profileId: accounts.profileId })
    .from(accounts)
    .where(eq(accounts.id, passkey.accountId))
    .limit(1);
  if (!account) return { ok: false, error: "Account not found." };
  await createSession(passkey.accountId, account.groupId);
  // Signing in as a claimed account means "I am that person" — switch to them.
  if (account.profileId !== null) await setActiveProfileCookie(account.profileId);
  return { ok: true, next: await afterSignIn(passkey.accountId, from, "passkey") };
}

// ── Management ────────────────────────────────────────────────────────────────
/** Remove one of YOUR passkeys (scoped to the session's account). */
export async function deletePasskey(id: string): Promise<void> {
  const { accountId } = await requireSession();
  await db
    .delete(passkeys)
    .where(and(eq(passkeys.id, id), eq(passkeys.accountId, accountId)));
  revalidatePath("/group");
}
