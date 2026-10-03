"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import Alert from "@mui/material/Alert";
import LockResetIcon from "@mui/icons-material/LockReset";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import { createResetLinkAction } from "@/app/actions/password";

// Owner only: mint a one-time reset link for a member and show it to copy.
// The link is shown once; reopening makes a new one (and kills the old).
export default function ResetLinkButton({
  accountId,
  username,
  origin,
}: {
  accountId: number;
  username: string;
  origin: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [link, setLink] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const result = await createResetLinkAction(accountId);
      if (result.ok) {
        setLink(`${origin}/reset/${result.token}`);
        router.refresh();
      } else setError(result.error);
    } catch {
      setError("Could not create a link. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <>
      <Button size="small" startIcon={<LockResetIcon />} onClick={create} disabled={busy}>
        Reset password
      </Button>
      {error ? (
        <Alert severity="error" sx={{ width: "100%" }}>
          {error}
        </Alert>
      ) : null}
      <Dialog
        open={link !== null}
        onClose={() => {
          setLink(null);
          setCopied(false);
        }}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>Reset link for {username}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField value={link ?? ""} label="Link" fullWidth slotProps={{ input: { readOnly: true } }} />
            <Typography variant="body2" color="text.secondary">
              Send this to {username}. They open it on their own device and pick a new password, so
              you never see it. It works once, expires in 24 hours, and signs {username} out on every
              device. They will see that you sent it.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button
            onClick={() => {
              setLink(null);
              setCopied(false);
            }}
            color="inherit"
          >
            Done
          </Button>
          <Button variant="contained" startIcon={<ContentCopyIcon />} onClick={copy}>
            {copied ? "Copied" : "Copy link"}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
