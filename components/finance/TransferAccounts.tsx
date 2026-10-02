"use client";

import Box from "@mui/material/Box";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import Typography from "@mui/material/Typography";
import type { TxnAccount } from "./TransactionsTable";

// The two sides of a transfer. Spending wallets are left out: money moved into
// one counts as spent, so it is recorded as Discretionary instead.
export default function TransferAccounts({
  accounts,
  fromId,
  intoId,
}: {
  accounts: TxnAccount[];
  fromId: number | null;
  intoId: number | null;
}) {
  const choices = accounts.filter((a) => a.kind !== "wallet");
  return (
    <Box>
      <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: "1fr 1fr" }}>
        <TextField name="accountId" label="From" select required defaultValue={fromId ?? ""}>
          {choices.map((a) => (
            <MenuItem key={a.id} value={a.id}>
              {a.name}
            </MenuItem>
          ))}
        </TextField>
        <TextField name="transferAccountId" label="Into" select required defaultValue={intoId ?? ""}>
          {choices.map((a) => (
            <MenuItem key={a.id} value={a.id}>
              {a.name}
            </MenuItem>
          ))}
        </TextField>
      </Box>
      <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.75 }}>
        Money moving between your own accounts. It is not spending or income, so it does not
        change your budget or your savings.
      </Typography>
    </Box>
  );
}
