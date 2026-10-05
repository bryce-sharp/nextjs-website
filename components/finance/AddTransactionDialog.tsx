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
import TransferAccounts from "./TransferAccounts";
import { addManualTransactionAction } from "@/app/actions/finance-budget";
import { CATEGORY_OPTIONS, billsActiveOn, type TxnFund, type TxnBill } from "./TransactionRow";
import type { TxnAccount } from "./TransactionsTable";
import { todayISO } from "@/lib/finance/parse";

// Quick-add for what the bank didn't text — a gas-station swipe, MONEY IN (a
// paycheck, grandma's $100, a friend paying back dinner), or a TRANSFER between
// your own accounts (Ally → Schwab). The toggle picks the side; money in and
// transfers skip the spending category picker. Defaults to today.
export default function AddTransactionDialog({
  funds,
  bills,
  accounts,
  merchants,
  sources,
  categories,
  onClose,
}: {
  funds: TxnFund[];
  bills: TxnBill[];
  accounts: TxnAccount[];
  merchants: string[];
  sources: string[];
  categories: string[]; // spending tags, for what a reimbursement pays back
  onClose: () => void;
}) {
  const [kind, setKind] = React.useState<"expense" | "income" | "transfer">("expense");
  // Default "auto" = let the merchant categorizer decide (same as SMS); you
  // only pick a category to override for the special lanes.
  const [category, setCategory] = React.useState("auto");
  // Money in is income (yours; optionally put into a fund) or a reimbursement
  // (pays back a purchase, so it nets against that spending).
  const [moneyKind, setMoneyKind] = React.useState<"income" | "reimbursement">("income");
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
              onChange={(_, v: "expense" | "income" | "transfer" | null) => v && setKind(v)}
            >
              <ToggleButton value="expense">Expense</ToggleButton>
              <ToggleButton value="income">Money in</ToggleButton>
              {accounts.length > 1 ? <ToggleButton value="transfer">Transfer</ToggleButton> : null}
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

            {kind === "transfer" ? (
              <>
                <TransferAccounts accounts={accounts} fromId={null} intoId={null} />
                <TextField name="merchant" label="Description (optional)" placeholder="e.g. Monthly Schwab deposit" />
              </>
            ) : (
              <SuggestField
                name="merchant"
                label={kind === "income" ? (moneyKind === "income" ? "Source" : "From") : "Merchant"}
                options={kind === "income" ? sources : merchants}
                placeholder={
                  kind === "income"
                    ? moneyKind === "income"
                      ? "e.g. Paycheck, Grandma"
                      : "e.g. Sam, for dinner"
                    : "e.g. Shell, gas"
                }
              />
            )}

            {kind === "income" ? (
              <>
                <TextField
                  name="moneyKind"
                  label="What is this money?"
                  select
                  value={moneyKind}
                  onChange={(e) => setMoneyKind(e.target.value === "reimbursement" ? "reimbursement" : "income")}
                  helperText={
                    moneyKind === "income"
                      ? "Counts as money in. It does not change this month's budget."
                      : "Pays you back for a purchase: lowers your spending in the tag it pays back and raises what is left to spend. Not income."
                  }
                >
                  <MenuItem value="income">Income (yours to keep)</MenuItem>
                  <MenuItem value="reimbursement">Reimbursement (pays back a purchase)</MenuItem>
                </TextField>
                {moneyKind === "income" && funds.length > 0 ? (
                  <TextField
                    name="fundId"
                    label="Put it in a fund (optional)"
                    select
                    defaultValue=""
                    helperText="Still counts as income; the fund keeps it until you spend it, in any month."
                  >
                    <MenuItem value="">
                      <em>No fund</em>
                    </MenuItem>
                    {funds.map((f) => (
                      <MenuItem key={f.id} value={f.id}>
                        {f.name}
                      </MenuItem>
                    ))}
                  </TextField>
                ) : null}
                {moneyKind === "reimbursement" ? (
                  <SuggestField
                    name="spendCategory"
                    label="What it pays back"
                    options={categories}
                    placeholder="Dining, Groceries…"
                  />
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

            {accounts.length > 0 && kind !== "transfer" ? (
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
