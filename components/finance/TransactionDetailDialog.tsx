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
import ListSubheader from "@mui/material/ListSubheader";
import Button from "@mui/material/Button";
import Alert from "@mui/material/Alert";
import SubmitButton from "@/components/shared/SubmitButton";
import NumberField from "@/components/shared/NumberField";
import SuggestField from "@/components/shared/SuggestField";
import { updateTransactionAction } from "@/app/actions/finance-budget";
import {
  CATEGORY_OPTIONS,
  type TxnRowData,
  type TxnFund,
  type TxnBill,
} from "./TransactionRow";

// The fuller edit for a transaction (the ⋮ → Edit details): everything the
// inline row doesn't cover — merchant, date, note, fund, category, amount — in
// one save. Same partial action, so it also fixes an unreadable (needs-review)
// row into a real one.
export default function TransactionDetailDialog({
  txn,
  funds,
  bills,
  merchants,
  sources,
  onSaved,
  onClose,
}: {
  txn: TxnRowData;
  funds: TxnFund[];
  bills: TxnBill[];
  merchants: string[];
  sources: string[];
  onSaved: (row: TxnRowData) => void;
  onClose: () => void;
}) {
  const [category, setCategory] = React.useState(txn.category);
  const [error, setError] = React.useState<string | null>(null);
  const billChoices = bills.filter((b) =>
    category === "fixed" ? b.paymentsPerYear === 12 : b.paymentsPerYear !== 12,
  );
  // A link to a bill not offered here (e.g. a version an "as of" change retired)
  // shows as blank, so say why rather than let it look unlinked by mistake.
  const staleLink =
    txn.recurringExpenseId != null && !billChoices.some((b) => b.id === txn.recurringExpenseId);

  async function handle(formData: FormData) {
    setError(null);
    try {
      onSaved(await updateTransactionAction(txn.id, formData));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save.");
    }
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Edit transaction</DialogTitle>
      <form action={handle}>
        <DialogContent sx={{ pt: 1 }}>
          <Stack spacing={2.5}>
            {error ? <Alert severity="error">{error}</Alert> : null}
            <SuggestField
              name="merchant"
              label={txn.category === "income" ? "Source" : "Merchant"}
              options={txn.category === "income" ? sources : merchants}
              defaultValue={txn.merchant ?? ""}
              autoFocus={txn.needsReview}
            />
            <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: "1fr 1fr" }}>
              <NumberField
                name="amount"
                label="Amount"
                prefix="$"
                decimalScale={2}
                defaultValue={txn.amount}
              />
              <TextField
                name="postedOn"
                label="Date"
                type="date"
                defaultValue={txn.postedOn}
                slotProps={{ inputLabel: { shrink: true } }}
              />
            </Box>
            <TextField
              name="category"
              label="Category"
              select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              helperText={
                category === "savings"
                  ? "Real money out, but never counts against the budget."
                  : undefined
              }
            >
              {/* Select can't take fragments, so the grouped list is one flat array. */}
              {(["out", "in"] as const).flatMap((flow) => [
                <ListSubheader key={flow}>{flow === "out" ? "Money out" : "Money in"}</ListSubheader>,
                ...CATEGORY_OPTIONS.filter((c) => c.flow === flow).map((c) => (
                  <MenuItem key={c.value} value={c.value}>
                    {c.label}
                  </MenuItem>
                )),
              ])}
            </TextField>
            {category === "fund" ? (
              <TextField
                name="fundId"
                label="Which fund"
                select
                defaultValue={txn.fundId ?? ""}
                helperText={funds.length === 0 ? "No funds yet — create one first." : undefined}
              >
                {funds.map((f) => (
                  <MenuItem key={f.id} value={f.id}>
                    {f.name}
                  </MenuItem>
                ))}
              </TextField>
            ) : null}
            {category === "fixed" || category === "amortized" ? (
              <TextField
                name="recurringExpenseId"
                label="Which bill"
                select
                defaultValue={txn.recurringExpenseId ?? ""}
                helperText={
                  staleLink
                    ? "Linked to a bill that isn't current here (likely an older version) — pick the right one."
                    : category === "amortized"
                      ? "Links this payment to its sinking fund — it draws the reserve, not this month's budget."
                      : "Links to the bill so its estimate reconciles."
                }
                error={staleLink}
              >
                <MenuItem value="">
                  <em>None</em>
                </MenuItem>
                {billChoices.map((b) => (
                  <MenuItem key={b.id} value={b.id}>
                    {b.name}
                  </MenuItem>
                ))}
              </TextField>
            ) : null}
            <TextField
              name="note"
              label="Note"
              defaultValue={txn.note ?? ""}
              fullWidth
              multiline
              minRows={1}
              placeholder="what was this?"
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={onClose} color="inherit">
            Cancel
          </Button>
          <SubmitButton variant="contained" pendingLabel="Saving…">
            Save
          </SubmitButton>
        </DialogActions>
      </form>
    </Dialog>
  );
}
