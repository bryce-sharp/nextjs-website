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
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import FormControlLabel from "@mui/material/FormControlLabel";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Divider from "@mui/material/Divider";
import Typography from "@mui/material/Typography";
import SubmitButton from "@/components/shared/SubmitButton";
import NumberField from "@/components/shared/NumberField";
import MonthYearField from "@/components/shared/MonthYearField";
import {
  addDeductionAction,
  updateDeductionAction,
  replaceDeductionAction,
  endDeductionAction,
  deleteDeductionAction,
} from "@/app/actions/finance-atlas";

export type DeductionValues = {
  id: number;
  name: string;
  type: string | null;
  source: string; // payroll | employer
  amountPerPaycheck: number | null; // flat $, or null for %-based rows
  percentOfGross: number | null; // % of gross, or null for flat rows
  effectivePerPaycheck: number; // the derived $ either way
  isPercent: boolean;
  monthly: number;
  pctOfGross: number | null;
  depositAccountId: number | null; // the account it lands in (401k, HSA)
  notes: string | null;
};

const TYPES = [
  { value: "tax", label: "Tax" },
  { value: "insurance", label: "Insurance" },
  { value: "retirement", label: "Retirement" },
  { value: "health", label: "Health (HSA…)" },
  { value: "employer_benefit", label: "Employer benefit" },
];

// Add or edit one paycheck deduction. Editing offers the two effective-dating
// flavors (fix in place vs changed-as-of-month), plus a danger zone: END it
// (stopped in real life — history intact) or DELETE it (added by mistake).
export default function DeductionDialog({
  open,
  onClose,
  profileId,
  personName,
  deduction,
  yearOptions,
  defaultMonth,
  accounts,
}: {
  open: boolean;
  onClose: () => void;
  profileId: number;
  personName: string;
  deduction: DeductionValues | null; // null = add new
  yearOptions: number[];
  defaultMonth: string;
  /** Where a deduction can land (non-archived financial accounts). */
  accounts: { id: number; name: string }[];
}) {
  const [flavor, setFlavor] = React.useState<"fix" | "asof">("fix");
  const [startMonth, setStartMonth] = React.useState(defaultMonth);
  const [amountMode, setAmountMode] = React.useState<"dollar" | "percent">(
    deduction?.isPercent ? "percent" : "dollar",
  );
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  async function handle(formData: FormData) {
    setError(null);
    try {
      if (!deduction) await addDeductionAction(profileId, formData);
      else if (flavor === "asof") await replaceDeductionAction(deduction.id, formData);
      else await updateDeductionAction(deduction.id, formData);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save.");
    }
  }

  function runDanger(action: (id: number, fd: FormData) => Promise<void>) {
    if (!deduction) return;
    startTransition(async () => {
      try {
        await action(deduction.id, new FormData());
        onClose();
      } catch {
        setError("Couldn't update — try again.");
      }
    });
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>
        {deduction ? `Edit ${deduction.name}` : `Add a deduction for ${personName}`}
      </DialogTitle>
      <form action={handle}>
        <DialogContent sx={{ pt: 1 }}>
          <Stack spacing={2.5}>
            {error ? <Alert severity="error">{error}</Alert> : null}
            {deduction ? (
              <RadioGroup
                value={flavor}
                onChange={(e) => setFlavor(e.target.value as "fix" | "asof")}
              >
                <FormControlLabel
                  value="fix"
                  control={<Radio size="small" />}
                  label="Fix in place (typo — recalculates everywhere)"
                />
                <FormControlLabel
                  value="asof"
                  control={<Radio size="small" />}
                  label="Changed as of a month (history keeps the old amount)"
                />
              </RadioGroup>
            ) : null}
            {(!deduction || flavor === "asof") ? (
              <MonthYearField
                name="startMonth"
                value={startMonth}
                onChange={setStartMonth}
                years={yearOptions}
                monthLabel={deduction ? "Effective month" : "Starting month"}
                yearLabel="Year"
              />
            ) : null}
            <TextField
              name="name"
              label="Name"
              required
              fullWidth
              autoFocus={!deduction}
              defaultValue={deduction?.name ?? ""}
              placeholder="e.g. Medical, 401k, Federal Tax"
            />
            <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: "auto 1fr" }}>
              <ToggleButtonGroup
                size="small"
                exclusive
                value={amountMode}
                onChange={(_, v: "dollar" | "percent" | null) => v && setAmountMode(v)}
                aria-label="Amount type"
              >
                <ToggleButton value="dollar" sx={{ px: 1.5 }}>
                  $
                </ToggleButton>
                <ToggleButton value="percent" sx={{ px: 1.5 }}>
                  %
                </ToggleButton>
              </ToggleButtonGroup>
              {amountMode === "percent" ? (
                <NumberField
                  name="percentOfGross"
                  label="% of gross"
                  decimalScale={2}
                  defaultValue={deduction?.percentOfGross ?? null}
                />
              ) : (
                <NumberField
                  name="amountPerPaycheck"
                  label="$ / paycheck"
                  prefix="$"
                  decimalScale={2}
                  defaultValue={deduction?.amountPerPaycheck ?? null}
                />
              )}
            </Box>
            <input type="hidden" name="amountMode" value={amountMode} readOnly />
            {amountMode === "percent" ? (
              <Typography variant="caption" color="text.secondary" sx={{ mt: -1 }}>
                Percent rows follow the paycheck — a raise updates the dollar
                amount automatically.
              </Typography>
            ) : null}
            <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: "1fr 1fr" }}>
              <TextField
                name="type"
                label="Type"
                select
                defaultValue={deduction?.type ?? "tax"}
              >
                {TYPES.map((t) => (
                  <MenuItem key={t.value} value={t.value}>
                    {t.label}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                name="source"
                label="Paid by"
                select
                defaultValue={deduction?.source ?? "payroll"}
              >
                <MenuItem value="payroll">Payroll (reduces net)</MenuItem>
                <MenuItem value="employer">Employer (benefit)</MenuItem>
              </TextField>
            </Box>
            {accounts.length > 0 ? (
              <TextField
                name="depositAccountId"
                label="Goes into (optional)"
                select
                defaultValue={deduction?.depositAccountId ?? ""}
                helperText="For a 401k or HSA: the account it lands in, so Net Worth can split that account's growth into paycheck money and market."
              >
                <MenuItem value="">
                  <em>Nowhere you track (taxes, insurance)</em>
                </MenuItem>
                {accounts.map((a) => (
                  <MenuItem key={a.id} value={a.id}>
                    {a.name}
                  </MenuItem>
                ))}
              </TextField>
            ) : null}
            <TextField
              name="notes"
              label="Notes (optional)"
              fullWidth
              multiline
              minRows={1}
              defaultValue={deduction?.notes ?? ""}
            />

            {deduction ? (
              <>
                <Divider />
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                  <Typography variant="overline" sx={{ color: "error.main", mr: 1 }}>
                    Danger zone
                  </Typography>
                  <Button
                    size="small"
                    color="inherit"
                    disabled={pending}
                    onClick={() => {
                      if (window.confirm(`End ${deduction.name} as of today? Past months keep it.`))
                        runDanger(endDeductionAction);
                    }}
                  >
                    End as of today
                  </Button>
                  <Button
                    size="small"
                    color="error"
                    disabled={pending}
                    onClick={() => {
                      if (window.confirm(`Delete ${deduction.name} entirely? It disappears from every month it ever touched.`))
                        runDanger(deleteDeductionAction);
                    }}
                  >
                    Delete forever
                  </Button>
                </Stack>
              </>
            ) : null}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={onClose} color="inherit">
            Cancel
          </Button>
          <SubmitButton variant="contained" pendingLabel="Saving…" disabled={pending}>
            Save
          </SubmitButton>
        </DialogActions>
      </form>
    </Dialog>
  );
}
