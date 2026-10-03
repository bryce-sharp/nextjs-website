"use client";

import * as React from "react";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import LockResetIcon from "@mui/icons-material/LockReset";
import SubmitButton from "@/components/shared/SubmitButton";
import { resetPasswordAction } from "@/app/actions/password";

// Pick a new password with a one-time link. On success the link is spent and
// every device signed in as this login is signed out.
export default function ResetForm({
  token,
  username,
  minLength,
  signedIn,
}: {
  token: string;
  username: string;
  minLength: number;
  signedIn: boolean;
}) {
  const [state, formAction] = React.useActionState(resetPasswordAction, null);

  if (state && "done" in state) {
    return (
      <Paper variant="outlined" sx={{ p: { xs: 3, md: 4 } }}>
        <Stack spacing={2} alignItems="flex-start">
          <LockResetIcon color="success" fontSize="large" />
          <Typography variant="h5" component="h1">
            Password updated
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Sign in as <strong>{state.username}</strong> with your new password. Every device that was
            signed in as {state.username} has been signed out.
          </Typography>
          {/* /signout clears any session on this device, then lands on /login. */}
          <Button variant="contained" href={signedIn ? "/signout" : "/login?reset=1"}>
            Sign in
          </Button>
        </Stack>
      </Paper>
    );
  }

  return (
    <Paper variant="outlined" sx={{ p: { xs: 3, md: 4 } }}>
      <form action={formAction}>
        <input type="hidden" name="token" value={token} />
        <Stack spacing={2.5}>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <LockResetIcon color="primary" />
            <Typography variant="h5" component="h1">
              Reset your password
            </Typography>
          </Stack>
          <Typography variant="body2" color="text.secondary">
            Pick a new password for <strong>{username}</strong>. This link works once.
          </Typography>
          {state && "error" in state ? <Alert severity="error">{state.error}</Alert> : null}
          {/* A hidden username field lets password managers save the new password to the right login. */}
          <input type="text" name="username" value={username} autoComplete="username" readOnly hidden />
          <TextField
            name="password"
            type="password"
            label="New password"
            autoComplete="new-password"
            required
            autoFocus
            helperText={`At least ${minLength} characters.`}
          />
          <TextField name="confirm" type="password" label="Confirm new password" autoComplete="new-password" required />
          <SubmitButton variant="contained" size="large" pendingLabel="Saving…">
            Save new password
          </SubmitButton>
        </Stack>
      </form>
    </Paper>
  );
}
