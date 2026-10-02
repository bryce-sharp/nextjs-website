"use client";

import * as React from "react";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import ButtonBase from "@mui/material/ButtonBase";
import Collapse from "@mui/material/Collapse";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import { formatMoney, formatMonth } from "@/lib/format";
import { changesOf } from "@/lib/finance/net-worth";
import DeleteIconButton from "@/components/shared/DeleteIconButton";
import { deleteMonthSnapshotsAction } from "@/app/actions/finance-networth";
import SnapshotDialog, { type SnapshotAccount } from "./SnapshotDialog";
import Money from "./Money";

type Entry = { kind: "logged"; index: number } | { kind: "missing"; month: string };

// The ritual's record, newest first: one line per month (total and its
// change), tapped open to every account's balance plus edit/delete. Months
// skipped inside the range show as gaps you can log from here.
export default function MonthlyLog({
  months,
  windowStart,
  accounts,
  balances,
  totals,
  missingMonths,
  balancesByMonth,
  yearOptions,
  editor,
}: {
  months: string[];
  windowStart: number;
  accounts: SnapshotAccount[];
  balances: Record<number, (number | null)[]>;
  totals: number[];
  missingMonths: string[];
  balancesByMonth: Record<string, Record<number, number | null>>;
  yearOptions: number[];
  editor: boolean;
}) {
  const [open, setOpen] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<{ month: string; title: string } | null>(null);
  const changes = changesOf(months, totals);

  const entries: Entry[] = [
    ...months.map((m, index) => ({ kind: "logged" as const, index, month: m })),
    ...missingMonths.map((month) => ({ kind: "missing" as const, month })),
  ]
    .sort((a, b) => (a.month < b.month ? 1 : -1))
    .map((e) => (e.kind === "logged" ? { kind: e.kind, index: e.index } : { kind: e.kind, month: e.month }));

  return (
    <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2.5 }, mb: 2 }}>
      <Typography variant="h6">Monthly log</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        Each row is the balances at the end of that month. Tap one for every account.
      </Typography>
      <Stack divider={<Box sx={{ borderTop: 1, borderColor: "divider" }} />}>
        {entries.map((e) => {
          if (e.kind === "missing") {
            return (
              <Box
                key={e.month}
                sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", py: 1, px: 0.75 }}
              >
                <Box>
                  <Typography variant="body2">{formatMonth(e.month)}</Typography>
                  <Typography variant="caption" color="warning.main">
                    Not logged
                  </Typography>
                </Box>
                {editor ? (
                  <Button
                    size="small"
                    onClick={() => setEditing({ month: e.month.slice(0, 7), title: `Log ${formatMonth(e.month)}` })}
                  >
                    Log it
                  </Button>
                ) : null}
              </Box>
            );
          }
          const i = e.index;
          const m = months[i];
          const c = changes[i];
          const isOpen = open === m;
          return (
            <Box key={m}>
              <ButtonBase
                onClick={() => setOpen(isOpen ? null : m)}
                aria-expanded={isOpen}
                sx={{
                  width: "100%",
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 1fr) auto 24px",
                  alignItems: "center",
                  gap: 1.5,
                  py: 1,
                  px: 0.75,
                  borderRadius: 1,
                  textAlign: "left",
                }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body2" fontWeight={600}>
                    {formatMonth(m)}
                  </Typography>
                  {i < windowStart ? (
                    <Typography variant="caption" color="text.secondary">
                      Starting point
                    </Typography>
                  ) : null}
                </Box>
                <Box sx={{ textAlign: "right" }}>
                  <Typography variant="body2" fontWeight={600}>
                    <Money value={totals[i]} />
                  </Typography>
                  {c ? (
                    <Typography
                      variant="caption"
                      component="div"
                      sx={{ color: c.change === 0 ? "text.secondary" : c.change > 0 ? "success.main" : "warning.main" }}
                    >
                      <Money value={c.change} signed />
                      {c.span > 1 ? ` · ${c.span} mo` : ""}
                    </Typography>
                  ) : null}
                </Box>
                <ExpandMoreIcon
                  fontSize="small"
                  sx={{ color: "text.secondary", transform: isOpen ? "rotate(180deg)" : undefined, transition: "transform 150ms" }}
                />
              </ButtonBase>
              <Collapse in={isOpen} unmountOnExit>
                <Box
                  sx={{
                    display: "grid",
                    gridTemplateColumns: { xs: "repeat(2, minmax(0, 1fr))", sm: "repeat(3, minmax(0, 1fr))" },
                    gap: 1,
                    px: 0.75,
                    pb: 1.5,
                  }}
                >
                  {accounts.map((a) => {
                    const v = balances[a.id]?.[i] ?? null;
                    return (
                      <Box key={a.id} sx={{ minWidth: 0 }}>
                        <Typography variant="caption" color="text.secondary" noWrap component="div">
                          {a.name}
                        </Typography>
                        <Typography variant="body2" sx={{ color: v == null ? "text.disabled" : undefined }}>
                          {v == null ? "—" : formatMoney(v)}
                        </Typography>
                      </Box>
                    );
                  })}
                </Box>
                {editor ? (
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ px: 0.75, pb: 1.5 }}>
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<EditOutlinedIcon />}
                      onClick={() => setEditing({ month: m.slice(0, 7), title: `Edit ${formatMonth(m)}` })}
                    >
                      Edit
                    </Button>
                    <DeleteIconButton
                      action={deleteMonthSnapshotsAction.bind(null, m)}
                      confirmMessage={`Delete the entire ${formatMonth(m)} row (every account's balance for that month)?`}
                      label={`Delete ${formatMonth(m)}`}
                    />
                  </Stack>
                ) : null}
              </Collapse>
            </Box>
          );
        })}
      </Stack>

      {editing ? (
        <SnapshotDialog
          open
          onClose={() => setEditing(null)}
          accounts={accounts}
          month={editing.month}
          balancesByMonth={balancesByMonth}
          yearOptions={yearOptions}
          title={editing.title}
        />
      ) : null}
    </Paper>
  );
}
