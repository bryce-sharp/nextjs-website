"use client";

import * as React from "react";
import Stack from "@mui/material/Stack";
import Button from "@mui/material/Button";
import AddchartIcon from "@mui/icons-material/Addchart";
import TuneIcon from "@mui/icons-material/Tune";
import SnapshotDialog, { type SnapshotAccount } from "./SnapshotDialog";
import AccountsManager, { type ManagedAccount } from "./AccountsManager";

// Header button cluster (weight's WeightActions role): the monthly Log ritual
// front and center, account management beside it. Hosts both dialogs so the
// (server) page stays dialog-free. The savings goal lives in ATLAS.
export default function NetWorthActions({
  snapshotAccounts,
  allAccounts,
  logMonth,
  balancesByMonth,
  yearOptions,
}: {
  snapshotAccounts: SnapshotAccount[];
  allAccounts: ManagedAccount[];
  /** "YYYY-MM" — the month that just closed (the 1st-of-month ritual logs it). */
  logMonth: string;
  /** "YYYY-MM" → { accountId: balance }, for the per-month prefill. */
  balancesByMonth: Record<string, Record<number, number | null>>;
  yearOptions: number[];
}) {
  const [logOpen, setLogOpen] = React.useState(false);
  const [accountsOpen, setAccountsOpen] = React.useState(false);

  return (
    <>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap justifyContent="flex-end">
        <Button
          variant="contained"
          startIcon={<AddchartIcon />}
          onClick={() => setLogOpen(true)}
          disabled={snapshotAccounts.length === 0}
        >
          Log balances
        </Button>
        <Button
          variant="outlined"
          startIcon={<TuneIcon />}
          onClick={() => setAccountsOpen(true)}
        >
          Accounts
        </Button>
      </Stack>

      {logOpen ? (
        <SnapshotDialog
          open
          onClose={() => setLogOpen(false)}
          accounts={snapshotAccounts}
          month={logMonth}
          balancesByMonth={balancesByMonth}
          yearOptions={yearOptions}
        />
      ) : null}
      {accountsOpen ? (
        <AccountsManager
          open
          onClose={() => setAccountsOpen(false)}
          accounts={allAccounts}
        />
      ) : null}
    </>
  );
}
