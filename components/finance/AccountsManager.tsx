"use client";

import * as React from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Stack from "@mui/material/Stack";
import Box from "@mui/material/Box";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Chip from "@mui/material/Chip";
import Typography from "@mui/material/Typography";
import Divider from "@mui/material/Divider";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import Alert from "@mui/material/Alert";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import ArchiveOutlinedIcon from "@mui/icons-material/ArchiveOutlined";
import UnarchiveOutlinedIcon from "@mui/icons-material/UnarchiveOutlined";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import AddIcon from "@mui/icons-material/Add";
import SubmitButton from "@/components/shared/SubmitButton";
import DeleteIconButton from "@/components/shared/DeleteIconButton";
import {
  addAccountAction,
  updateAccountAction,
  setAccountArchivedAction,
  deleteAccountAction,
  moveAccountAction,
} from "@/app/actions/finance-networth";

export type ManagedAccount = {
  id: number;
  name: string;
  kind: string;
  transferPatterns: string[];
  trackBalance: boolean;
  carriesDiscretion: boolean;
  archived: boolean;
  notes: string | null;
};

const KINDS: { value: string; label: string }[] = [
  { value: "checking", label: "Checking" },
  { value: "savings", label: "Savings" },
  { value: "brokerage", label: "Brokerage" },
  { value: "retirement", label: "Retirement" },
  { value: "crypto", label: "Crypto" },
  { value: "hsa", label: "HSA" },
  { value: "credit_card", label: "Credit card" },
  { value: "wallet", label: "Spending wallet" },
  { value: "other", label: "Other" },
];

// Manage the group's financial accounts: add/edit, archive (soft — history
// kept, the recommended path), or hard-delete (archived accounts only; loudly
// destroys every snapshot). List ↔ form modes inside one dialog.
export default function AccountsManager({
  open,
  onClose,
  accounts,
}: {
  open: boolean;
  onClose: () => void;
  accounts: ManagedAccount[];
}) {
  // null = list view; "new" = add form; an account = edit form.
  const [mode, setMode] = React.useState<ManagedAccount | "new" | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [, startTransition] = React.useTransition();

  const close = () => {
    setMode(null);
    setError(null);
    onClose();
  };

  async function handleForm(formData: FormData) {
    setError(null);
    try {
      if (mode === "new") await addAccountAction(formData);
      else if (mode) await updateAccountAction(mode.id, formData);
      setMode(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the account.");
    }
  }

  function toggleArchived(a: ManagedAccount) {
    startTransition(() =>
      setAccountArchivedAction(a.id, !a.archived, new FormData()),
    );
  }

  function move(a: ManagedAccount, dir: "up" | "down") {
    startTransition(() => moveAccountAction(a.id, dir, new FormData()));
  }

  const editing = mode !== null && mode !== "new" ? mode : null;

  // Arrows are bounded by the account's own block — active and archived are
  // rendered (and reordered) as separate runs, matching the server action.
  const active = accounts.filter((a) => !a.archived);
  const archived = accounts.filter((a) => a.archived);
  const posOf = (a: ManagedAccount) => {
    const block = a.archived ? archived : active;
    return { index: block.indexOf(a), last: block.length - 1 };
  };

  return (
    <Dialog open={open} onClose={close} fullWidth maxWidth="sm">
      {mode === null ? (
        <>
          <DialogTitle>Financial accounts</DialogTitle>
          <DialogContent>
            <Stack spacing={1} sx={{ mt: 0.5 }}>
              {accounts.length === 0 ? (
                <Typography color="text.secondary">
                  No accounts yet — add the places your money lives (checking,
                  savings, brokerage, 401K…).
                </Typography>
              ) : (
                accounts.map((a) => {
                  const { index, last } = posOf(a);
                  return (
                  <Stack
                    key={a.id}
                    direction="row"
                    alignItems="center"
                    spacing={1}
                    sx={{ opacity: a.archived ? 0.6 : 1, flexWrap: "wrap" }}
                  >
                    <Stack direction="row" sx={{ flexShrink: 0 }}>
                      <IconButton
                        size="small"
                        disabled={index <= 0}
                        onClick={() => move(a, "up")}
                        aria-label={`Move ${a.name} up`}
                      >
                        <ArrowUpwardIcon fontSize="small" />
                      </IconButton>
                      <IconButton
                        size="small"
                        disabled={index === last}
                        onClick={() => move(a, "down")}
                        aria-label={`Move ${a.name} down`}
                      >
                        <ArrowDownwardIcon fontSize="small" />
                      </IconButton>
                    </Stack>
                    <Typography fontWeight={600} sx={{ flexGrow: 1, minWidth: 120 }}>
                      {a.name}
                    </Typography>
                    <Chip
                      size="small"
                      label={KINDS.find((k) => k.value === a.kind)?.label ?? a.kind}
                    />
                    {a.transferPatterns.length ? (
                      <Tooltip title={`Rows mentioning ${a.transferPatterns.join(", ")} become transfers into ${a.name}`}>
                        <Chip size="small" color="primary" variant="outlined" label="auto transfers" />
                      </Tooltip>
                    ) : null}
                    {a.carriesDiscretion ? (
                      <Chip size="small" color="warning" variant="outlined" label="spending" />
                    ) : null}
                    {!a.trackBalance ? (
                      <Chip size="small" variant="outlined" label="not tracked" />
                    ) : null}
                    {a.archived ? <Chip size="small" label="archived" /> : null}
                    <Tooltip title="Edit">
                      <IconButton size="small" onClick={() => setMode(a)} aria-label={`Edit ${a.name}`}>
                        <EditOutlinedIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={a.archived ? "Reopen" : "Archive (keeps history)"}>
                      <IconButton
                        size="small"
                        onClick={() => toggleArchived(a)}
                        aria-label={a.archived ? `Reopen ${a.name}` : `Archive ${a.name}`}
                      >
                        {a.archived ? (
                          <UnarchiveOutlinedIcon fontSize="small" />
                        ) : (
                          <ArchiveOutlinedIcon fontSize="small" />
                        )}
                      </IconButton>
                    </Tooltip>
                    {a.archived ? (
                      <DeleteIconButton
                        action={deleteAccountAction.bind(null, a.id)}
                        confirmMessage={`Delete ${a.name} FOREVER? Every monthly balance ever logged for it is erased. Archiving keeps the history — are you sure you want delete?`}
                        label={`Delete ${a.name}`}
                      />
                    ) : null}
                  </Stack>
                  );
                })
              )}
            </Stack>
            {accounts.length > 1 ? (
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: "block", mt: 2 }}
              >
                This order drives the history table&apos;s columns and the chart&apos;s
                stacking — arrange them however you read them.
              </Typography>
            ) : null}
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2 }}>
            <Button onClick={close} color="inherit">
              Close
            </Button>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setMode("new")}>
              Add account
            </Button>
          </DialogActions>
        </>
      ) : (
        <form action={handleForm} key={editing?.id ?? "new"}>
          <DialogTitle>{editing ? `Edit ${editing.name}` : "Add an account"}</DialogTitle>
          <DialogContent>
            <Stack spacing={2.5} sx={{ mt: 0.5 }}>
              {error ? <Alert severity="error">{error}</Alert> : null}
              <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: "2fr 1fr" }}>
                <TextField
                  name="name"
                  label="Name"
                  required
                  autoFocus={!editing}
                  defaultValue={editing?.name ?? ""}
                  placeholder="e.g. Ally Savings"
                />
                <TextField
                  name="kind"
                  label="Kind"
                  select
                  defaultValue={editing?.kind ?? "checking"}
                >
                  {KINDS.map((k) => (
                    <MenuItem key={k.value} value={k.value}>
                      {k.label}
                    </MenuItem>
                  ))}
                </TextField>
              </Box>
              <TextField
                name="transferPatterns"
                label="Transfer words (optional)"
                fullWidth
                multiline
                minRows={1}
                defaultValue={editing?.transferPatterns.join("\n") ?? ""}
                placeholder="SCHWAB"
                helperText="One per line. A transaction that mentions one becomes a transfer into this account, not spending."
              />
              <FormControlLabel
                control={
                  <Checkbox
                    name="trackBalance"
                    defaultChecked={editing?.trackBalance ?? true}
                  />
                }
                label={
                  <>
                    Track monthly balance
                    <Typography variant="caption" color="text.secondary" display="block">
                      Untick for accounts that only pay bills (a credit card) —
                      they skip the monthly ritual.
                    </Typography>
                  </>
                }
              />
              <FormControlLabel
                control={
                  <Checkbox
                    name="carriesDiscretion"
                    defaultChecked={editing?.carriesDiscretion ?? false}
                  />
                }
                label={
                  <>
                    Free spending happens here
                    <Typography variant="caption" color="text.secondary" display="block">
                      Routes the discretionary budget to this account (usually
                      just your main card). NOT needed to track its
                      transactions — bills paid from any account are always in
                      the plan.
                    </Typography>
                  </>
                }
              />
              <TextField
                name="notes"
                label="Notes (optional)"
                fullWidth
                multiline
                minRows={1}
                defaultValue={editing?.notes ?? ""}
              />
              <Divider />
            </Stack>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2 }}>
            <Button onClick={() => setMode(null)} color="inherit">
              Back
            </Button>
            <SubmitButton variant="contained" pendingLabel="Saving…">
              {editing ? "Save changes" : "Add account"}
            </SubmitButton>
          </DialogActions>
        </form>
      )}
    </Dialog>
  );
}
