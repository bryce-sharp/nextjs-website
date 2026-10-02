"use client";

import * as React from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Stack from "@mui/material/Stack";
import Button from "@mui/material/Button";
import Alert from "@mui/material/Alert";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import FormControlLabel from "@mui/material/FormControlLabel";
import Typography from "@mui/material/Typography";
import SubmitButton from "@/components/shared/SubmitButton";
import NumberField from "@/components/shared/NumberField";
import MonthYearField from "@/components/shared/MonthYearField";
import {
  saveSavingsGoalAction,
  startSavingsGoalAction,
} from "@/app/actions/finance-networth";
import { formatMoney, formatMonth } from "@/lib/format";

// The monthly savings goal. Savings means money in any account you own, so
// the goal you type includes what paychecks already put into 401k and HSA;
// the server stores the take-home rest, which ATLAS sets aside before
// discretionary. Two save flavors, matching the weight app's
// plan dialog: ADJUST the current goal in place (typo/tune-up — the whole goal
// line recomputes) or START a new segment from a month (raise season — history
// keeps the old goal, the line bends going forward).
export default function SavingsGoalDialog({
  open,
  onClose,
  activeGoal,
  paycheckSavings,
  paycheckNames,
  defaultMonth,
  yearOptions,
}: {
  open: boolean;
  onClose: () => void;
  /** monthlyGoal is the stored take-home part. */
  activeGoal: { monthlyGoal: number; startMonth: string } | null;
  /** What paychecks save each month right now (401k, HSA). */
  paycheckSavings: number;
  paycheckNames: string[];
  /** "YYYY-MM" default for new segments. */
  defaultMonth: string;
  /** Years for the month picker (current year back through the oldest data). */
  yearOptions: number[];
}) {
  const [flavor, setFlavor] = React.useState<"adjust" | "new">(
    activeGoal ? "adjust" : "new",
  );
  // Adjust edits the existing segment's start; New picks where the next one
  // begins — so switching flavors re-seeds the picker to the right default.
  const [startMonth, setStartMonth] = React.useState(
    activeGoal ? activeGoal.startMonth.slice(0, 7) : defaultMonth,
  );
  const [error, setError] = React.useState<string | null>(null);
  const total = activeGoal ? activeGoal.monthlyGoal + paycheckSavings : null;
  const paycheckLabel = paycheckNames.length ? paycheckNames.join(" and ") : "401k and HSA";

  // A goal can legitimately start next year (a raise you already know about),
  // which the snapshot years never need — you can't log a future balance.
  const years = React.useMemo(
    () => (yearOptions.length ? [yearOptions[0] + 1, ...yearOptions] : yearOptions),
    [yearOptions],
  );

  function pickFlavor(next: "adjust" | "new") {
    setFlavor(next);
    setStartMonth(
      next === "adjust" && activeGoal
        ? activeGoal.startMonth.slice(0, 7)
        : defaultMonth,
    );
  }

  async function handle(formData: FormData) {
    setError(null);
    try {
      if (activeGoal && flavor === "new") await startSavingsGoalAction(formData);
      else await saveSavingsGoalAction(formData);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the goal.");
    }
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Savings goal</DialogTitle>
      <form action={handle}>
        <DialogContent sx={{ pt: 1 }}>
          <Stack spacing={2.5}>
            {error ? <Alert severity="error">{error}</Alert> : null}
            {activeGoal ? (
              <>
                <Typography variant="body2" color="text.secondary">
                  Current: <strong>{formatMoney(total)}/mo</strong> since{" "}
                  {formatMonth(activeGoal.startMonth)}.
                </Typography>
                <RadioGroup
                  value={flavor}
                  onChange={(e) => pickFlavor(e.target.value as "adjust" | "new")}
                >
                  <FormControlLabel
                    value="adjust"
                    control={<Radio size="small" />}
                    label="Adjust this goal (recalculates its whole line)"
                  />
                  <FormControlLabel
                    value="new"
                    control={<Radio size="small" />}
                    label="New goal starting a given month (history keeps the old one)"
                  />
                </RadioGroup>
              </>
            ) : (
              <Typography variant="body2" color="text.secondary">
                How much to save each month, counting every account you own.
                ATLAS sets the take-home part aside before your discretionary
                budget.
              </Typography>
            )}
            <Stack spacing={0.75}>
              <NumberField
                name="monthlyGoal"
                label="Monthly savings goal"
                prefix="$"
                decimalScale={2}
                defaultValue={total}
              />
              {paycheckSavings > 0 ? (
                <Typography variant="caption" color="text.secondary">
                  Includes the {formatMoney(paycheckSavings)}/mo your paycheck already puts into{" "}
                  {paycheckLabel}. Only the rest comes out of take-home pay.
                </Typography>
              ) : null}
            </Stack>
            {/* Always editable: the start month decides when the goal line
                begins accumulating, so a wrong one silently leaves the tile
                with no goal at all. */}
            <Stack spacing={0.75}>
              <MonthYearField
                name="startMonth"
                value={startMonth}
                onChange={setStartMonth}
                years={years}
                monthLabel="Starting month"
                yearLabel="Starting year"
              />
              <Typography variant="caption" color="text.secondary">
                The first month this goal counts — set it to your earliest tracked
                month to measure the whole year.
              </Typography>
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={onClose} color="inherit">
            Cancel
          </Button>
          <SubmitButton variant="contained" pendingLabel="Saving…">
            Save goal
          </SubmitButton>
        </DialogActions>
      </form>
    </Dialog>
  );
}
