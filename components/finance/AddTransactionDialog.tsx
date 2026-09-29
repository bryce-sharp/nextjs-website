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
import Alert from "@mui/material/Alert";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import SubmitButton from "@/components/shared/SubmitButton";
import NumberField from "@/components/shared/NumberField";
import SuggestField from "@/components/shared/SuggestField";
import { addManualTransactionAction } from "@/app/actions/finance-budget";
import { CATEGORY_OPTIONS, billsActiveOn, type TxnFund, type TxnBill } from "./TransactionRow";
import type { TxnAccount } from "./TransactionsTable";
import { todayISO } from "@/lib/finance/parse";

// Quick-add for what the bank didn't text — a gas-station swipe, or INCOME
// (a paycheck, grandma's $100). The expense/income toggle picks the lane;
// income skips the category picker (it's never spend). Defaults to today.
export default function AddTransactionDialog({
  funds,
  bills,
  accounts,
  merchants,
  sources,
  onClose,
}: {
  funds: TxnFund[];
  bills: TxnBill[];
  accounts: TxnAccount[];
  merchants: string[];
  sources: string[];
  onClose: () => void;
}) {
  const [kind, setKind] = React.useState<"expense" | "income">("expense");
  // Default "auto" = let the merchant categorizer decide (same as SMS); you
  // only pick a category to override for the special lanes.
  const [category, setCategory] = React.useState("auto");
  // Income destination: "track" = recorded, no budget effect; "spend" = adds to
  // this month's Left-to-Spend; "reimbursement" = pays back a purchase (also
  // credits Left-to-Spend). (A fund bump is separate + optional, below.)
  const [destination, setDestination] = React.useState("track");
  const [date, setDate] = React.useState(todayISO);
  const [error, setError] = React.useState<string | null>(null);
  // Only the bill versions in effect on the entered date.
  const billChoices = billsActiveOn(bills, date).filter((b) =>
    category === "fixed" ? b.paymentsPerYear === 12 : b.paymentsPerYear !== 12,
  );

  async function handle(formData: FormData) {
    setError(null);
    try {
      await addManualTransactionAction(formData);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add.");
    }
  }

  const expenseCats = CATEGORY_OPTIONS.filter((c) => c.flow === "out");

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Add a transaction</DialogTitle>
      <form action={handle}>
        <input type="hidden" name="kind" value={kind} />
        <DialogContent sx={{ pt: 1 }}>
          <Stack spacing={2.5}>
            {error ? <Alert severity="error">{error}</Alert> : null}
            <ToggleButtonGroup
              exclusive
              fullWidth
              size="small"
              value={kind}
              onChange={(_, v: "expense" | "income" | null) => v && setKind(v)}
            >
              <ToggleButton value="expense">Expense</ToggleButton>
              <ToggleButton value="income">Income</ToggleButton>
            </ToggleButtonGroup>

            <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: "1fr 1fr" }}>
              <NumberField name="amount" label="Amount" prefix="$" decimalScale={2} />
              <TextField
                name="postedOn"
                label="Date"
                type="date"
                defaultValue={todayISO()}
                onChange={(e) => setDate(e.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
              />
            </Box>

            <SuggestField
              name="merchant"
              label={kind === "income" ? "Source" : "Merchant"}
              options={kind === "income" ? sources : merchants}
              placeholder={kind === "income" ? "e.g. Paycheck, Grandma" : "e.g. Shell, gas"}
            />

            {kind === "income" ? (
              <>
                <TextField
                  name="destination"
                  label="What should this money do?"
                  select
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                  helperText={
                    destination === "spend"
                      ? "Adds to this month's Left-to-Spend."
                      : destination === "reimbursement"
                        ? "Pays you back for a purchase — credits this month's Left-to-Spend."
                        : "Just recorded — no effect on the budget."
                  }
                >
                  <MenuItem value="track">Just track it</MenuItem>
                  <MenuItem value="spend">Spend it this month</MenuItem>
                  <MenuItem value="reimbursement">It&apos;s a reimbursement</MenuItem>
                </TextField>
                {funds.length > 0 ? (
                  <TextField
                    name="depositFundId"
                    label="Also add to a fund (optional)"
                    select
                    defaultValue=""
                    helperText="Bumps that envelope's balance — play money, not a real transaction."
                  >
                    <MenuItem value="">
                      <em>Don&apos;t add to a fund</em>
                    </MenuItem>
                    {funds.map((f) => (
                      <MenuItem key={f.id} value={f.id}>
                        {f.name}
                      </MenuItem>
                    ))}
                  </TextField>
                ) : null}
              </>
            ) : null}

            {kind === "expense" ? (
              <>
                <TextField
                  name="category"
                  label="Category"
                  select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  helperText={
                    category === "auto"
                      ? "Detected from the merchant name"
                      : category === "savings"
                        ? "Real money out, but never counts against the budget."
                        : undefined
                  }
                >
                  <MenuItem value="auto">Auto (detect from merchant)</MenuItem>
                  {expenseCats.map((c) => (
                    <MenuItem key={c.value} value={c.value}>
                      {c.label}
                    </MenuItem>
                  ))}
                </TextField>
                {category === "fund" ? (
                  <TextField
                    name="fundId"
                    label="Which fund"
                    select
                    defaultValue=""
                    helperText={funds.length === 0 ? "No funds yet." : undefined}
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
                    defaultValue=""
                    helperText={
                      category === "amortized"
                        ? "Draws its sinking fund, not this month's budget."
                        : "Reconciles against the bill's estimate."
                    }
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
              </>
            ) : null}

            {accounts.length > 0 ? (
              <TextField name="accountId" label="Account (optional)" select defaultValue="">
                <MenuItem value="">
                  <em>Unattributed</em>
                </MenuItem>
                {accounts.map((a) => (
                  <MenuItem key={a.id} value={a.id}>
                    {a.name}
                  </MenuItem>
                ))}
              </TextField>
            ) : null}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={onClose} color="inherit">
            Cancel
          </Button>
          <SubmitButton variant="contained" pendingLabel="Adding…">
            Add
          </SubmitButton>
        </DialogActions>
      </form>
    </Dialog>
  );
}
