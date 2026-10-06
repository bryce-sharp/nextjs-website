"use client";

import * as React from "react";
import Dialog from "@mui/material/Dialog";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useTheme } from "@mui/material/styles";
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
import Typography from "@mui/material/Typography";
import SubmitButton from "@/components/shared/SubmitButton";
import NumberField from "@/components/shared/NumberField";
import MonthYearField from "@/components/shared/MonthYearField";
import Divider from "@mui/material/Divider";
import {
  saveCompPlanAction,
  startCompPlanAction,
  removeCompensationAction,
} from "@/app/actions/finance-atlas";

export type CompValues = {
  payFrequency: string;
  grossPerPaycheck: number;
  baseSalary: number | null;
  shares: number | null;
  sharePrice: number | null;
  notes: string | null;
};

const FREQUENCIES = [
  { value: "weekly", label: "Weekly (52/yr)" },
  { value: "biweekly", label: "Every two weeks (26/yr)" },
  { value: "semimonthly", label: "Twice a month (24/yr)" },
  { value: "monthly", label: "Monthly (12/yr)" },
];

// Set up or change a person's pay. Two save flavors (the effective-dating
// pattern): FIX the current numbers in place (typo — every month it covers
// recalculates) or A RAISE starting a chosen month (new segment; past months
// keep the old paycheck, exactly like the real world).
export default function CompensationDialog({
  open,
  onClose,
  profileId,
  personName,
  current,
  yearOptions,
  defaultMonth,
}: {
  open: boolean;
  onClose: () => void;
  profileId: number;
  personName: string;
  current: CompValues | null;
  yearOptions: number[];
  defaultMonth: string; // "YYYY-MM"
}) {
  // Phones get the whole screen: room for the fields and the keyboard.
  const fullScreen = useMediaQuery(useTheme().breakpoints.down("sm"));
  const [flavor, setFlavor] = React.useState<"fix" | "raise">(
    current ? "raise" : "fix", // a raise is the common reason to open this
  );
  const [startMonth, setStartMonth] = React.useState(defaultMonth);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function removeIncome() {
    if (
      !window.confirm(
        `Remove ${personName}'s income entirely? Their compensation and all deductions are deleted (past months included).`,
      )
    )
      return;
    startTransition(async () => {
      try {
        await removeCompensationAction(profileId, new FormData());
        onClose();
      } catch {
        setError("Couldn't remove — try again.");
      }
    });
  }

  async function handle(formData: FormData) {
    setError(null);
    try {
      if (current && flavor === "raise") {
        await startCompPlanAction(profileId, formData);
      } else {
        await saveCompPlanAction(profileId, formData);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save.");
    }
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs" fullScreen={fullScreen}>
      <DialogTitle>
        {current ? `${personName}'s compensation` : `Set up ${personName}'s income`}
      </DialogTitle>
      <form action={handle}>
        <DialogContent sx={{ pt: 1 }}>
          <Stack spacing={2.5}>
            {error ? <Alert severity="error">{error}</Alert> : null}
            {current ? (
              <RadioGroup
                value={flavor}
                onChange={(e) => setFlavor(e.target.value as "fix" | "raise")}
              >
                <FormControlLabel
                  value="raise"
                  control={<Radio size="small" />}
                  label="Change starting a month (a raise — history keeps the old pay)"
                />
                <FormControlLabel
                  value="fix"
                  control={<Radio size="small" />}
                  label="Fix the current numbers (typo — recalculates in place)"
                />
              </RadioGroup>
            ) : null}
            {(!current || flavor === "raise") ? (
              <MonthYearField
                name="startMonth"
                value={startMonth}
                onChange={setStartMonth}
                years={yearOptions}
                monthLabel={current ? "Effective month" : "Starting month"}
                yearLabel="Year"
              />
            ) : null}
            <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: "1fr 1fr" }}>
              <NumberField
                name="grossPerPaycheck"
                label="Gross per paycheck"
                prefix="$"
                decimalScale={2}
                defaultValue={current?.grossPerPaycheck ?? null}
              />
              <TextField
                name="payFrequency"
                label="Pay frequency"
                select
                defaultValue={current?.payFrequency ?? "semimonthly"}
              >
                {FREQUENCIES.map((f) => (
                  <MenuItem key={f.value} value={f.value}>
                    {f.label}
                  </MenuItem>
                ))}
              </TextField>
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ mt: -1 }}>
              Net pay is derived: gross − payroll deductions. The rest is optional context.
            </Typography>
            <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr 1fr" } }}>
              <NumberField
                name="baseSalary"
                label="Base salary"
                prefix="$"
                decimalScale={2}
                defaultValue={current?.baseSalary ?? null}
              />
              <NumberField
                name="shares"
                label="Shares"
                defaultValue={current?.shares ?? null}
              />
              <NumberField
                name="sharePrice"
                label="Share value"
                prefix="$"
                decimalScale={4}
                defaultValue={current?.sharePrice ?? null}
              />
            </Box>
            <TextField
              name="notes"
              label="Notes (optional)"
              fullWidth
              multiline
              minRows={1}
              defaultValue={current?.notes ?? ""}
            />
            {current ? (
              <>
                <Divider />
                <Button
                  color="error"
                  size="small"
                  disabled={pending}
                  onClick={removeIncome}
                  sx={{ alignSelf: "flex-start" }}
                >
                  Remove {personName}&apos;s income
                </Button>
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
