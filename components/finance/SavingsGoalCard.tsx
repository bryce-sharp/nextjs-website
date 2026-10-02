"use client";

import * as React from "react";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import SavingsOutlinedIcon from "@mui/icons-material/SavingsOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import SavingsGoalDialog from "./SavingsGoalDialog";
import { formatMoney, formatMonth } from "@/lib/format";

// ATLAS's savings goal. Savings means money in any account you own, so the
// goal counts what paychecks already save (401k, HSA) plus a take-home part
// set aside before discretionary, so spending your whole discretionary budget
// still leaves the goal saved.
export default function SavingsGoalCard({
  goal,
  paycheckSavings,
  paycheckNames,
  since,
  editable,
  defaultMonth,
  yearOptions,
}: {
  goal: number; // the take-home part, monthly dollars (0 = none)
  paycheckSavings: number; // monthly, already saved by deductions
  paycheckNames: string[];
  since: string | null; // YYYY-MM-01 the goal in effect started
  editable: boolean;
  defaultMonth: string;
  yearOptions: number[];
}) {
  const [open, setOpen] = React.useState(false);
  const has = goal > 0;

  return (
    <Paper id="savings" variant="outlined" sx={{ p: { xs: 1.5, sm: 2.5 }, mb: 3, scrollMarginTop: 88 }}>
      <Stack direction="row" spacing={1.5} alignItems="center" justifyContent="space-between" sx={{ flexWrap: "wrap", rowGap: 1 }}>
        <Stack direction="row" spacing={1.5} alignItems="center">
          <SavingsOutlinedIcon color="action" />
          <div>
            <Typography variant="h6" component="h2">
              Savings goal
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {has
                ? `${formatMoney(goal + paycheckSavings)} a month${since ? `, since ${formatMonth(since)}` : ""}`
                : "Not set — everything left after bills counts as discretionary."}
            </Typography>
          </div>
        </Stack>
        {editable ? (
          <Button
            size="small"
            variant={has ? "text" : "contained"}
            startIcon={has ? <EditOutlinedIcon /> : undefined}
            onClick={() => setOpen(true)}
          >
            {has ? "Edit" : "Set a goal"}
          </Button>
        ) : null}
      </Stack>
      {has && paycheckSavings > 0 ? (
        <Typography variant="body2" sx={{ mt: 1 }}>
          {formatMoney(paycheckSavings)} from your paycheck ({paycheckNames.join(", ")}) +{" "}
          {formatMoney(goal)} from take-home pay
        </Typography>
      ) : null}
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
        Savings counts every account you own, so your paycheck&apos;s 401k and HSA money
        is part of it. Only the take-home part comes off the top before your discretionary
        budget, and it never needs a transaction.
      </Typography>

      {open ? (
        <SavingsGoalDialog
          open
          onClose={() => setOpen(false)}
          activeGoal={has && since ? { monthlyGoal: goal, startMonth: since } : null}
          paycheckSavings={paycheckSavings}
          paycheckNames={paycheckNames}
          defaultMonth={defaultMonth}
          yearOptions={yearOptions}
        />
      ) : null}
    </Paper>
  );
}
