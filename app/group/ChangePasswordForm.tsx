"use client";

import * as React from "react";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Collapse from "@mui/material/Collapse";
import Typography from "@mui/material/Typography";
import SubmitButton from "@/components/shared/SubmitButton";
import { changePasswordAction } from "@/app/actions/password";

// Change your own password. Right after a sign-in (Face ID included) the
// current password is not needed, which is the way back for someone who
// forgot it but still has a passkey.
export default function ChangePasswordForm({ fresh, minLength }: { fresh: boolean; minLength: number }) {
  const [open, setOpen] = React.useState(false);
  // Closing on success unmounts the form, which also clears the fields.
  const [state, formAction] = React.useActionState(
    async (prev: Parameters<typeof changePasswordAction>[0], formData: FormData) => {
      const result = await changePasswordAction(prev, formData);
      if (result && "ok" in result) setOpen(false);
      return result;
    },
    null,
  );
  const done = state != null && "ok" in state && !open;

  return (
    <Stack spacing={1.5}>
      {done ? <Alert severity="success">Password changed. Your other devices are signed out.</Alert> : null}
      {!open ? (
        <Button variant="outlined" onClick={() => setOpen(true)} sx={{ alignSelf: "flex-start" }}>
          Change password
        </Button>
      ) : null}
      <Collapse in={open} unmountOnExit>
        <form action={formAction}>
          <Stack spacing={2}>
            {state && "error" in state ? <Alert severity="error">{state.error}</Alert> : null}
            {fresh ? (
              <Typography variant="body2" color="text.secondary">
                You signed in a moment ago, so your current password is not needed.
              </Typography>
            ) : (
              <TextField
                name="current"
                type="password"
                label="Current password"
                autoComplete="current-password"
                helperText="Forgot it? Sign out and back in with Face ID, then change it here without it."
              />
            )}
            <TextField
              name="password"
              type="password"
              label="New password"
              autoComplete="new-password"
              required
              helperText={`At least ${minLength} characters.`}
            />
            <TextField name="confirm" type="password" label="Confirm new password" autoComplete="new-password" required />
            <Stack direction="row" spacing={1}>
              <SubmitButton variant="contained" pendingLabel="Saving…">
                Save password
              </SubmitButton>
              <Button color="inherit" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </Stack>
          </Stack>
        </form>
      </Collapse>
    </Stack>
  );
}
