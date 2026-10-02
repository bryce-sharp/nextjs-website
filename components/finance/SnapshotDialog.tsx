"use client";

import * as React from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Button from "@mui/material/Button";
import Alert from "@mui/material/Alert";
import Typography from "@mui/material/Typography";
import SubmitButton from "@/components/shared/SubmitButton";
import NumberField from "@/components/shared/NumberField";
import MonthYearField from "@/components/shared/MonthYearField";
import { saveSnapshotsAction } from "@/app/actions/finance-networth";

export type SnapshotAccount = { id: number; name: string };

// THE monthly ritual: one dialog, one $ field per account, one submit. The
// month is picked with explicit dropdowns (no free-form text), and the $ fields
// always reflect the SELECTED month's stored balances — so switching to a past
// month to backfill shows that month's values, and opening fresh always starts
// on the month that just closed (balances are logged on the 1st for it). Blank fields are skipped server-side (a partial log
// never wipes an existing balance); re-logging a month overwrites it.
export default function SnapshotDialog({
  open,
  onClose,
  accounts,
  month,
  balancesByMonth,
  yearOptions,
  title = "Log balances",
}: {
  open: boolean;
  onClose: () => void;
  accounts: SnapshotAccount[];
  /** "YYYY-MM" — the month selected when the dialog opens. */
  month: string;
  /** "YYYY-MM" → { accountId: balance }. Drives the per-month prefill. */
  balancesByMonth: Record<string, Record<number, number | null>>;
  yearOptions: number[];
  title?: string;
}) {
  // Selected month lives here; re-initializes to `month` every time the dialog
  // mounts (the parent conditionally renders it), so "Log balances" always
  // opens on the month that just closed regardless of a prior backfill.
  const [ym, setYm] = React.useState(month);
  const [error, setError] = React.useState<string | null>(null);

  const balances = balancesByMonth[ym] ?? {};
  const alreadyLogged = ym in balancesByMonth;

  async function handle(formData: FormData) {
    setError(null);
    try {
      await saveSnapshotsAction(formData);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save balances.");
    }
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{title}</DialogTitle>
      <form action={handle}>
        <DialogContent sx={{ pt: 1 }}>
          <Stack spacing={2.5}>
            {error ? <Alert severity="error">{error}</Alert> : null}
            <MonthYearField name="month" value={ym} onChange={setYm} years={yearOptions} />
            <Typography variant="caption" color="text.secondary" sx={{ mt: -1 }}>
              {alreadyLogged
                ? "This month is already logged — saving overwrites it. Blank fields stay untouched."
                : "Blank fields are left untouched — log what you have."}
            </Typography>
            {/* keyed by month so each field resets to the selected month's value */}
            <Box
              key={ym}
              sx={{ display: "grid", gap: 2, gridTemplateColumns: "1fr 1fr" }}
            >
              {accounts.map((a) => (
                <NumberField
                  key={a.id}
                  name={`balance_${a.id}`}
                  label={a.name}
                  prefix="$"
                  decimalScale={2}
                  defaultValue={balances[a.id] ?? null}
                />
              ))}
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={onClose} color="inherit">
            Cancel
          </Button>
          <SubmitButton variant="contained" pendingLabel="Saving…">
            Save balances
          </SubmitButton>
        </DialogActions>
      </form>
    </Dialog>
  );
}
