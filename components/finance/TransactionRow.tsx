"use client";

import type * as React from "react";
import TableRow from "@mui/material/TableRow";
import TableCell from "@mui/material/TableCell";
import Tooltip from "@mui/material/Tooltip";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Box from "@mui/material/Box";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import type { SxProps, Theme } from "@mui/material/styles";
import { formatMoney, formatDate } from "@/lib/format";
import { flowOf } from "@/lib/finance/cashflow";

type StyleObject = Exclude<SxProps<Theme>, ReadonlyArray<unknown> | ((theme: Theme) => unknown)>;

/** Styles applied only below `sm`, leaving the desktop table's defaults untouched. */
export function onPhone(styles: StyleObject) {
  return (theme: Theme) => ({ [theme.breakpoints.down("sm")]: styles });
}

// On a phone each cell becomes a grid item: no table borders or padding.
const phoneCell = (area: string, extra?: StyleObject) =>
  onPhone({ display: "block", gridArea: area, border: 0, p: 0, ...extra });

export type TxnFund = { id: number; name: string };
export type TxnBill = {
  id: number;
  name: string;
  paymentsPerYear: number;
  startDate: string; // YYYY-MM-DD; this version of the bill starts
  endDate: string | null; // null = still in effect
};

/** Each bill's version in effect on `date`: an "as of" change keeps the old version for past months. */
export function billsActiveOn(bills: TxnBill[], date: string): TxnBill[] {
  if (!date) return bills;
  return bills.filter((b) => b.startDate <= date && (b.endDate == null || b.endDate >= date));
}
export type TxnRowData = {
  id: number;
  postedOn: string;
  merchant: string | null;
  amount: number;
  originalAmount: number;
  category: string;
  spendCategory: string | null;
  fundId: number | null;
  recurringExpenseId: number | null;
  accountId: number | null;
  transferAccountId: number | null; // a transfer's "into" account
  needsReview: boolean;
  note: string | null;
  source: string;
  /** From the bank feed: null (not reported yet), "pending", or "posted". */
  bankStatus: string | null;
};

// `flow` groups the pickers: money out vs money in (a reimbursement pays you
// back) vs money moving between your own accounts.
export const CATEGORY_OPTIONS: { value: string; label: string; flow: "out" | "in" | "move" }[] = [
  { value: "discretionary", label: "Discretionary", flow: "out" },
  { value: "fixed", label: "Fixed bill", flow: "out" },
  { value: "amortized", label: "Amortized", flow: "out" },
  // Stored as "savings"; shown as Off-budget: real money out (the sofa, the
  // crowns) that never counts against the budget.
  { value: "savings", label: "Off-budget", flow: "out" },
  { value: "fund", label: "Fund", flow: "out" },
  { value: "income", label: "Income", flow: "in" },
  { value: "reimbursement", label: "Reimbursement", flow: "in" },
  { value: "transfer", label: "Transfer", flow: "move" },
];
export const FLOW_GROUP_LABELS = { out: "Money out", in: "Money in", move: "Between your accounts" } as const;
// "ignored" still renders if any legacy row has it, but it's no longer offered.
const CATEGORY_LABEL: Record<string, string> = {
  ...Object.fromEntries(CATEGORY_OPTIONS.map((c) => [c.value, c.label])),
  ignored: "Excluded",
};

// Money IN (into your pocket) vs OUT vs neutral transfers.
const INFLOW = new Set(["income", "reimbursement"]);
const NEUTRAL = new Set(["ignored", "transfer"]);
// Direction of the row by MEANING, not raw sign: money into your pocket OR into
// a fund reads green "+", money out reads red — magnitude always positive, so a
// fund deposit (stored negative) never shows as a baffling red "-$100".
function direction(category: string, amount: number): "in" | "out" | "neutral" {
  if (NEUTRAL.has(category)) return "neutral";
  if (INFLOW.has(category)) return "in";
  if (category === "fund") return amount < 0 ? "in" : "out"; // deposit vs draw
  return amount < 0 ? "in" : "out"; // a refund on a spend row is money back
}
function amountColor(dir: "in" | "out" | "neutral"): string {
  if (dir === "in") return "success.main";
  if (dir === "neutral") return "text.secondary";
  return "error.main";
}
function chipColor(category: string): "primary" | "success" | "warning" | "default" {
  if (category === "discretionary") return "primary";
  if (INFLOW.has(category)) return "success";
  if (NEUTRAL.has(category)) return "default";
  return "warning";
}

// A display-only transaction row: date · merchant · formatted amount (green in
// / red out) · category chip. Clicking it opens its details and edit popup; the
// tag chip is its own tap target. Below `sm` it restacks into two lines —
// merchant · amount over date · category — so a phone never scrolls sideways.
export default function TransactionRow({
  txn,
  funds,
  accounts = [],
  onRowClick,
  onEditCategory,
}: {
  txn: TxnRowData;
  funds: TxnFund[];
  /** Names for a transfer's "from → into" line. */
  accounts?: { id: number; name: string }[];
  // Present ⇒ clicking anywhere on the row opens its details.
  onRowClick?: (txn: TxnRowData, anchor: HTMLElement) => void;
  // Present ⇒ the spend-category chip is tappable to set/change it.
  onEditCategory?: (txn: TxnRowData, anchor: HTMLElement) => void;
}) {
  const adjusted = txn.amount !== txn.originalAmount;
  const accountName = (id: number | null) => (id == null ? null : accounts.find((a) => a.id === id)?.name ?? null);
  const fundName =
    txn.category === "transfer"
      ? `${accountName(txn.accountId) ?? "?"} → ${accountName(txn.transferAccountId) ?? "?"}`
      : txn.fundId
        ? funds.find((f) => f.id === txn.fundId)?.name
        : null;
  const dir = direction(txn.category, txn.amount);
  // Every counted row is taggable — spending tags on money out, income tags on
  // money in. Excluded rows are never counted, so never tagged.
  const editCat = onEditCategory && flowOf(txn.category) ? onEditCategory : undefined;
  // The chip has its own tap target, so it must not also open the row's details.
  const tag = (e: React.MouseEvent<HTMLElement>) => {
    e.stopPropagation();
    editCat?.(txn, e.currentTarget);
  };

  return (
    <TableRow
      hover
      onClick={onRowClick ? (e) => onRowClick(txn, e.currentTarget) : undefined}
      onKeyDown={
        onRowClick
          ? (e) => {
              if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
              e.preventDefault();
              onRowClick(txn, e.currentTarget);
            }
          : undefined
      }
      tabIndex={onRowClick ? 0 : undefined}
      sx={[
        {
          bgcolor: txn.needsReview ? "action.hover" : undefined,
          cursor: onRowClick ? "pointer" : undefined,
        },
        // Date and category get their own columns on line two, so neither
        // squeezes the merchant name on line one.
        onPhone({
          display: "grid",
          gridTemplateColumns: "auto minmax(0, 1fr) auto",
          gridTemplateAreas: `"merchant merchant amount" "date category category"`,
          alignItems: "center",
          columnGap: 1.5,
          rowGap: 0.5,
          px: 0.5,
          py: 1.25,
          borderBottom: 1,
          borderColor: "divider",
        }),
      ]}
    >
      <TableCell
        sx={[
          { whiteSpace: "nowrap", color: "text.secondary" },
          phoneCell("date", { fontSize: 12 }),
        ]}
      >
        {formatDate(txn.postedOn)}
      </TableCell>

      <TableCell sx={[{ maxWidth: 240 }, phoneCell("merchant", { maxWidth: "none", minWidth: 0 })]}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
          {txn.needsReview ? (
            <Tooltip
              title={
                txn.source === "sms"
                  ? "Couldn't read this one — click it to set its details"
                  : "Needs a look: click it to check its details"
              }
            >
              <WarningAmberIcon fontSize="small" color="warning" />
            </Tooltip>
          ) : null}
          <Box sx={{ minWidth: 0 }}>
            <Box
              sx={[
                { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
                onPhone({ fontWeight: 600 }),
              ]}
            >
              {txn.merchant ?? (txn.needsReview ? "Unreadable alert" : "—")}
            </Box>
            {fundName || txn.note ? (
              <Box
                sx={{
                  fontSize: 12,
                  color: "text.secondary",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {fundName ? (txn.category === "transfer" ? fundName : `→ ${fundName}`) : ""}
                {fundName && txn.note ? " · " : ""}
                {txn.note ?? ""}
              </Box>
            ) : null}
          </Box>
        </Box>
      </TableCell>

      <TableCell
        align="right"
        sx={[
          { whiteSpace: "nowrap", color: amountColor(dir), fontWeight: 600 },
          phoneCell("amount"),
        ]}
      >
        {dir === "in" ? "+" : ""}
        {formatMoney(Math.abs(txn.amount))}
        {adjusted ? (
          <Tooltip title={`Adjusted from ${formatMoney(txn.originalAmount)}`}>
            <Box component="span" sx={{ color: "text.disabled", ml: 0.25 }}>
              *
            </Box>
          </Tooltip>
        ) : null}
      </TableCell>

      <TableCell sx={phoneCell("category")}>
        <Stack
          direction="row"
          spacing={0.5}
          sx={[{ flexWrap: "wrap", rowGap: 0.5 }, onPhone({ justifyContent: "flex-end" })]}
        >
          <Chip
            size="small"
            variant="outlined"
            color={chipColor(txn.category)}
            label={CATEGORY_LABEL[txn.category] ?? txn.category}
          />
          {txn.bankStatus === "pending" ? (
            <Tooltip title="Authorized at the bank but not posted yet; it updates in place when it posts">
              <Chip size="small" variant="outlined" label="Pending" sx={{ borderStyle: "dotted" }} />
            </Tooltip>
          ) : null}
          {txn.spendCategory ? (
            <Chip
              size="small"
              label={txn.spendCategory}
              onClick={editCat ? tag : undefined}
              sx={{ bgcolor: "action.selected", cursor: editCat ? "pointer" : "default" }}
            />
          ) : editCat ? (
            <Chip
              size="small"
              variant="outlined"
              label="Tag…"
              onClick={tag}
              sx={{ cursor: "pointer", borderStyle: "dashed" }}
            />
          ) : null}
        </Stack>
      </TableCell>

    </TableRow>
  );
}
