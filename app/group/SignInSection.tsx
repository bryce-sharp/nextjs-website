import Link from "@/components/shared/AppLink";
import { eq } from "drizzle-orm";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import Chip from "@mui/material/Chip";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import { db } from "@/lib/db";
import { accounts } from "@/lib/db/schema";
import { listPasskeys } from "@/lib/queries/passkeys";
import { MIN_PASSWORD_LENGTH, isFreshSignIn, listUsedResets } from "@/lib/password-reset";
import { deletePasskey } from "@/app/actions/passkeys";
import { acknowledgeResetNoticeAction } from "@/app/actions/password";
import DeleteIconButton from "@/components/shared/DeleteIconButton";
import SubmitButton from "@/components/shared/SubmitButton";
import AddPasskeyButton from "./AddPasskeyButton";
import ChangePasswordForm from "./ChangePasswordForm";

const fmtDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

// The signed-in ACCOUNT's own keys (not the household's): the reset notice,
// the add-Face-ID nudge, Change password, and passkeys. It is the Sign-in tab
// of /group (?tab=sign-in), where sign-in sends people with something to see.
export default async function SignInSection({
  accountId,
  iat,
  isOwner,
  nudge,
  next,
}: {
  accountId: number;
  iat: number | undefined;
  isOwner: boolean;
  nudge: boolean;
  next: string;
}) {
  const [keys, resets, [account]] = await Promise.all([
    listPasskeys(accountId),
    listUsedResets(accountId),
    db
      .select({ passwordChangedAt: accounts.passwordChangedAt })
      .from(accounts)
      .where(eq(accounts.id, accountId))
      .limit(1),
  ]);
  const unseen = resets.filter((r) => !r.noticeSeen);
  const fresh = isFreshSignIn(iat);
  const who = (r: (typeof resets)[number]) =>
    r.createdBy == null ? "the site admin" : r.createdBySelf ? "you" : r.createdBy;
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";

  return (
    <Stack spacing={2}>
      {unseen.length ? (
        <Alert
          severity="warning"
          action={
            <form action={acknowledgeResetNoticeAction}>
              <SubmitButton color="inherit" size="small" pendingLabel="…">
                Got it
              </SubmitButton>
            </form>
          }
        >
          Your password was reset on {fmtDate.format(unseen[0].usedAt)} with a link from{" "}
          {who(unseen[0])}. If that was you, you are all set. If not, change your password below
          and talk to {who(unseen[0])}.
        </Alert>
      ) : null}

      {nudge && keys.length === 0 ? (
        <Alert severity="info" action={<Button component={Link} href={safeNext} color="inherit" size="small">Not now</Button>}>
          Add Face ID (a passkey) on this device so you never need your password again.
        </Alert>
      ) : null}

      {isOwner && keys.length === 0 ? (
        <Alert severity="warning">
          You own this hub, so no one can send you a reset link. Add Face ID so you can always get
          back in.
        </Alert>
      ) : null}

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack spacing={1.5}>
          <div>
            <Typography fontWeight={600}>Password</Typography>
            <Typography variant="body2" color="text.secondary">
              {account?.passwordChangedAt
                ? `Last changed ${fmtDate.format(account.passwordChangedAt)}.`
                : "Your fallback when Face ID is not available."}
            </Typography>
          </div>
          <ChangePasswordForm fresh={fresh} minLength={MIN_PASSWORD_LENGTH} />
          {resets.length ? (
            <Typography variant="caption" color="text.secondary">
              Reset links used:{" "}
              {resets.map((r) => `${fmtDate.format(r.usedAt)} (from ${who(r)})`).join(", ")}
            </Typography>
          ) : null}
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack spacing={1.5}>
          <div>
            <Typography fontWeight={600}>Passkeys</Typography>
            <Typography variant="body2" color="text.secondary">
              Sign in with Face ID, Touch ID, or your device PIN. Add one per device (an iCloud-synced
              passkey covers all your Apple devices). Your password keeps working as the fallback.
            </Typography>
          </div>
          <AddPasskeyButton />
          {keys.map((k) => (
            <Paper
              key={k.id}
              variant="outlined"
              sx={{ p: 1.5, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}
            >
              <Stack spacing={0.25} sx={{ minWidth: 0 }}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Typography fontWeight={600} noWrap>
                    {k.label ?? "Passkey"}
                  </Typography>
                  {k.backedUp ? <Chip label="synced" size="small" variant="outlined" /> : null}
                </Stack>
                <Typography variant="body2" color="text.secondary">
                  {k.lastUsedAt
                    ? `Last used ${fmtDate.format(k.lastUsedAt)}`
                    : `Never used · added ${fmtDate.format(k.createdAt)}`}
                </Typography>
              </Stack>
              <DeleteIconButton
                action={deletePasskey.bind(null, k.id)}
                confirmMessage="Remove this passkey? The device it lives on will need the password (or a new passkey) to sign in."
                label="Remove passkey"
              />
            </Paper>
          ))}
        </Stack>
      </Paper>
    </Stack>
  );
}
