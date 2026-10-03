"use client";

import * as React from "react";
import Container from "@mui/material/Container";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import CircularProgress from "@mui/material/CircularProgress";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import FingerprintIcon from "@mui/icons-material/Fingerprint";
import SubmitButton from "@/components/shared/SubmitButton";
import { startAuthentication, browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { loginAction } from "@/app/actions/session";
import { startPasskeyLogin, finishPasskeyLogin } from "@/app/actions/passkeys";

/** Only ever navigate to a same-site path (mirrors the server-side guard). */
function safePath(from: string): string {
  return from.startsWith("/") && !from.startsWith("//") ? from : "/";
}

// The global sign-in form: passkey first (one Face ID tap), password as the
// universal fallback. autoComplete hints matter on the password path — they're
// what lets iCloud Keychain offer the saved login behind a Face ID prompt.
export default function LoginForm({ from, notice }: { from: string; notice?: string }) {
  const [state, formAction] = React.useActionState(loginAction, null);

  const [passkeyBusy, setPasskeyBusy] = React.useState(false);
  const [passkeyError, setPasskeyError] = React.useState<string | null>(null);
  const [supported, setSupported] = React.useState(false); // until mounted
  React.useEffect(() => setSupported(browserSupportsWebAuthn()), []);

  async function signInWithPasskey() {
    setPasskeyBusy(true);
    setPasskeyError(null);
    try {
      const options = await startPasskeyLogin();
      const response = await startAuthentication({ optionsJSON: options });
      const result = await finishPasskeyLogin(response, from);
      if (result.ok) {
        // Full navigation (not router.push) so every layout re-reads the fresh session.
        window.location.assign(safePath(result.next ?? from));
        return;
      }
      setPasskeyError(result.error);
    } catch (err) {
      if (err instanceof Error && err.name === "NotAllowedError") {
        // Prompt dismissed — silence, they can retry or use the password.
      } else {
        setPasskeyError("Passkey sign-in didn't work — use your password below.");
      }
    } finally {
      setPasskeyBusy(false);
    }
  }

  return (
    <Container maxWidth="xs" sx={{ py: { xs: 6, md: 10 } }}>
      <Paper variant="outlined" sx={{ p: { xs: 3, md: 4 } }}>
        <Stack spacing={2.5}>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <LockOutlinedIcon color="primary" />
            <Typography variant="h5" component="h1">
              Sign in
            </Typography>
          </Stack>
          <Typography variant="body2" color="text.secondary">
            This hub is private — sign in to continue.
          </Typography>
          {notice ? <Alert severity="success">{notice}</Alert> : null}

          {supported ? (
            <>
              {passkeyError ? <Alert severity="error">{passkeyError}</Alert> : null}
              <Button
                variant="contained"
                size="large"
                onClick={signInWithPasskey}
                disabled={passkeyBusy}
                startIcon={
                  passkeyBusy ? (
                    <CircularProgress size={18} color="inherit" />
                  ) : (
                    <FingerprintIcon />
                  )
                }
              >
                {passkeyBusy ? "Waiting for Face ID…" : "Sign in with a passkey"}
              </Button>
              <Divider>
                <Typography variant="body2" color="text.secondary">
                  or use a password
                </Typography>
              </Divider>
            </>
          ) : null}

          <form action={formAction}>
            <Stack spacing={2.5}>
              {state ? <Alert severity="error">{state.error}</Alert> : null}
              <input type="hidden" name="from" value={from} />
              <TextField
                name="username"
                label="Username"
                autoComplete="username"
                autoCapitalize="none"
                required
                fullWidth
              />
              <TextField
                name="password"
                type="password"
                label="Password"
                autoComplete="current-password"
                required
                fullWidth
              />
              <SubmitButton variant="outlined" size="large" pendingLabel="Signing in…">
                Sign in
              </SubmitButton>
            </Stack>
          </form>
        </Stack>
      </Paper>
    </Container>
  );
}
