"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Button from "@mui/material/Button";
import Alert from "@mui/material/Alert";
import Stack from "@mui/material/Stack";
import CircularProgress from "@mui/material/CircularProgress";
import AddIcon from "@mui/icons-material/Add";
import { startRegistration, browserSupportsWebAuthn } from "@simplewebauthn/browser";
import {
  startPasskeyRegistration,
  finishPasskeyRegistration,
} from "@/app/actions/passkeys";

// "Add a passkey to this device": server mints the challenge, the platform
// authenticator (Face ID / Windows Hello) signs it, server verifies + stores.
export default function AddPasskeyButton() {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [supported, setSupported] = React.useState(true); // assume yes until mounted
  React.useEffect(() => setSupported(browserSupportsWebAuthn()), []);

  async function add() {
    setBusy(true);
    setError(null);
    try {
      const options = await startPasskeyRegistration();
      const response = await startRegistration({ optionsJSON: options });
      const result = await finishPasskeyRegistration(response);
      if (result.ok) router.refresh();
      else setError(result.error);
    } catch (err) {
      if (err instanceof Error && err.name === "NotAllowedError") {
        // User closed the Face ID prompt — not an error worth shouting about.
      } else if (err instanceof Error && err.name === "InvalidStateError") {
        setError("This device already has a passkey for the hub.");
      } else {
        setError(err instanceof Error ? err.message : "Couldn't add a passkey.");
      }
    } finally {
      setBusy(false);
    }
  }

  if (!supported) {
    return <Alert severity="info">This browser doesn&apos;t support passkeys.</Alert>;
  }

  return (
    <Stack spacing={1.5}>
      {error ? <Alert severity="error">{error}</Alert> : null}
      <Button
        variant="contained"
        size="large"
        onClick={add}
        disabled={busy}
        startIcon={busy ? <CircularProgress size={18} color="inherit" /> : <AddIcon />}
      >
        {busy ? "Waiting for Face ID…" : "Add a passkey to this device"}
      </Button>
    </Stack>
  );
}
