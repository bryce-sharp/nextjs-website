"use client";

import * as React from "react";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import Alert from "@mui/material/Alert";
import AddIcon from "@mui/icons-material/Add";
import SavingsOutlinedIcon from "@mui/icons-material/SavingsOutlined";
import CloseFundIcon from "@mui/icons-material/RemoveCircleOutline";
import SubmitButton from "@/components/shared/SubmitButton";
import NumberField from "@/components/shared/NumberField";
import { formatMoney } from "@/lib/format";
import {
  createFundAction,
  adjustFundAction,
  closeFundAction,
} from "@/app/actions/finance-budget";

export type FundView = {
  id: number;
  name: string;
  ownerName: string | null;
  balance: number;
  drawnThisMonth: number;
};
export type FundOwner = { id: number; name: string };

// One-time funds = imaginary envelopes: a balance you draw from, disconnected
// from real accounts. Create with a starting balance (seed money — can be
// pretend), add money anytime (deposits, also possibly pretend), and spend by
// tagging a transaction to the fund (that draws it down). Balances are derived.
export default function FundsPanel({
  funds,
  owners,
  editable,
}: {
  funds: FundView[];
  owners: FundOwner[];
  editable: boolean;
}) {
  const [createOpen, setCreateOpen] = React.useState(false);
  const [depositFor, setDepositFor] = React.useState<FundView | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [, startTransition] = React.useTransition();

  async function handleCreate(fd: FormData) {
    setError(null);
    try {
      await createFundAction(fd);
      setCreateOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create the fund.");
    }
  }
  async function handleDeposit(fd: FormData) {
    if (!depositFor) return;
    setError(null);
    try {
      await adjustFundAction(depositFor.id, fd);
      setDepositFor(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't update the fund.");
    }
  }
  function close(f: FundView) {
    if (window.confirm(`Close "${f.name}"? Its history stays but it leaves the list.`)) {
      startTransition(() => closeFundAction(f.id, new FormData()));
    }
  }

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 2.5 }, mt: 3 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.5 }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <SavingsOutlinedIcon fontSize="small" color="action" />
          <Typography variant="h6">Funds</Typography>
        </Stack>
        {editable ? (
          <Button size="small" startIcon={<AddIcon />} onClick={() => setCreateOpen(true)}>
            New fund
          </Button>
        ) : null}
      </Stack>

      {funds.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No funds yet. A fund is a bucket you set aside — a vacation pot, or an
          allowance — that you draw from without touching the monthly budget.
        </Typography>
      ) : (
        <Stack spacing={1.5}>
          {funds.map((f) => (
            <Box
              key={f.id}
              sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}
            >
              <Box sx={{ flexGrow: 1, minWidth: 140 }}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Typography fontWeight={600} component="span">
                    {f.name}
                  </Typography>
                  {f.ownerName ? (
                    <Chip size="small" label={f.ownerName} variant="outlined" />
                  ) : null}
                </Stack>
                {f.drawnThisMonth !== 0 ? (
                  <Typography variant="caption" color="text.secondary">
                    {f.drawnThisMonth > 0
                      ? `−${formatMoney(f.drawnThisMonth)} this month`
                      : `+${formatMoney(-f.drawnThisMonth)} added this month`}
                  </Typography>
                ) : null}
              </Box>
              <Typography
                variant="h6"
                sx={{ color: f.balance < 0 ? "warning.main" : "success.main" }}
              >
                {formatMoney(f.balance)}
              </Typography>
              {editable ? (
                <>
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => {
                      setError(null);
                      setDepositFor(f);
                    }}
                  >
                    Adjust
                  </Button>
                  <Tooltip title="Close fund">
                    <IconButton size="small" onClick={() => close(f)} aria-label={`Close ${f.name}`}>
                      <CloseFundIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </>
              ) : null}
            </Box>
          ))}
        </Stack>
      )}

      {editable ? (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 2 }}>
          To spend from a fund, set a transaction&apos;s category to{" "}
          <strong>Fund</strong> and pick it — that draws the balance down. To save money
          in one, mark income as <strong>Put it in a fund</strong>.
        </Typography>
      ) : null}

      {/* Create fund */}
      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} fullWidth maxWidth="xs">
        <form action={handleCreate}>
          <DialogTitle>New fund</DialogTitle>
          <DialogContent>
            <Stack spacing={2.5} sx={{ mt: 0.5 }}>
              {error ? <Alert severity="error">{error}</Alert> : null}
              <TextField name="name" label="Name" required autoFocus placeholder="e.g. Vacation, Lauren's allowance" />
              <NumberField name="startingBalance" label="Starting balance" prefix="$" decimalScale={2} defaultValue={0} />
              <TextField name="ownerProfileId" label="Belongs to (optional)" select defaultValue="">
                <MenuItem value="">
                  <em>Shared / household</em>
                </MenuItem>
                {owners.map((o) => (
                  <MenuItem key={o.id} value={o.id}>
                    {o.name}
                  </MenuItem>
                ))}
              </TextField>
              <Typography variant="caption" color="text.secondary">
                Starting balance is just a number — it doesn&apos;t move any real
                account. Great for allowances or pretend money.
              </Typography>
            </Stack>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2 }}>
            <Button onClick={() => setCreateOpen(false)} color="inherit">
              Cancel
            </Button>
            <SubmitButton variant="contained" pendingLabel="Creating…">
              Create
            </SubmitButton>
          </DialogActions>
        </form>
      </Dialog>

      {/* Adjust — positive adds, negative removes */}
      <Dialog open={depositFor !== null} onClose={() => setDepositFor(null)} fullWidth maxWidth="xs">
        <form action={handleDeposit}>
          <DialogTitle>Adjust {depositFor?.name}</DialogTitle>
          <DialogContent>
            <Stack spacing={2.5} sx={{ mt: 0.5 }}>
              {error ? <Alert severity="error">{error}</Alert> : null}
              <NumberField name="amount" label="Amount" prefix="$" decimalScale={2} allowNegative />
              <TextField name="note" label="Note (optional)" placeholder="e.g. lost a bet 😄" fullWidth />
              <Typography variant="caption" color="text.secondary">
                A positive amount adds; a <strong>negative</strong> amount removes
                (e.g. −{depositFor ? formatMoney(depositFor.balance) : "153.33"} to zero it
                out). Pure bucket money — no real account is touched.
              </Typography>
            </Stack>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2 }}>
            <Button onClick={() => setDepositFor(null)} color="inherit">
              Cancel
            </Button>
            <SubmitButton variant="contained" pendingLabel="Saving…">
              Save
            </SubmitButton>
          </DialogActions>
        </form>
      </Dialog>
    </Paper>
  );
}
