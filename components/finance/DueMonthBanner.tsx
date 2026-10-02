"use client";

import * as React from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import { formatMonth } from "@/lib/format";
import SnapshotDialog, { type SnapshotAccount } from "./SnapshotDialog";

// The 1st-of-the-month nudge: last month has closed and is not logged yet.
export default function DueMonthBanner({
  month,
  accounts,
  balancesByMonth,
  yearOptions,
}: {
  month: string; // YYYY-MM-01
  accounts: SnapshotAccount[];
  balancesByMonth: Record<string, Record<number, number | null>>;
  yearOptions: number[];
}) {
  const [open, setOpen] = React.useState(false);
  const name = new Date(`${month.slice(0, 7)}-01T12:00:00`).toLocaleDateString("en-US", { month: "long" });

  return (
    <>
      <Alert
        severity="info"
        sx={{ mb: 2 }}
        action={
          <Button color="inherit" size="small" onClick={() => setOpen(true)}>
            Log {name}
          </Button>
        }
      >
        {formatMonth(month)} has closed. Log its ending balances.
      </Alert>
      {open ? (
        <SnapshotDialog
          open
          onClose={() => setOpen(false)}
          accounts={accounts}
          month={month.slice(0, 7)}
          balancesByMonth={balancesByMonth}
          yearOptions={yearOptions}
          title={`Log ${formatMonth(month)}`}
        />
      ) : null}
    </>
  );
}
