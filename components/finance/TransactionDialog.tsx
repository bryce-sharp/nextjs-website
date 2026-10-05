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
import ListSubheader from "@mui/material/ListSubheader";
import Button from "@mui/material/Button";
import Alert from "@mui/material/Alert";
import Avatar from "@mui/material/Avatar";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import Typography from "@mui/material/Typography";
import CircularProgress from "@mui/material/CircularProgress";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useTheme } from "@mui/material/styles";
import SubmitButton from "@/components/shared/SubmitButton";
import NumberField from "@/components/shared/NumberField";
import SuggestField from "@/components/shared/SuggestField";
import TransferAccounts from "./TransferAccounts";
import { deleteTransactionAction, updateTransactionAction } from "@/app/actions/finance-budget";
import { getTransactionDetailAction } from "@/app/actions/finance-transactions";
import { flowOf, moneyDirection } from "@/lib/finance/cashflow";
import { formatDate, formatMoney } from "@/lib/format";
import type { TxnDetail } from "@/lib/queries/finance-transactions";
import {
  CATEGORY_OPTIONS,
  FLOW_GROUP_LABELS,
  billsActiveOn,
  type TxnRowData,
  type TxnFund,
  type TxnBill,
} from "./TransactionRow";
import type { TxnAccount } from "./TransactionsTable";

const SOURCE_LABEL: Record<string, string> = {
  sms: "Card text alert",
  plaid: "Bank feed",
  manual: "Entered by hand",
  import: "Imported",
  api: "Shortcut",
};

/** What a lane does with this row's money, in a sentence. */
function categoryHelp(category: string, direction: "in" | "out"): string | undefined {
  switch (category) {
    case "income":
      return "Counts as money in. It does not change this month's budget; put it in a fund to keep it for later.";
    case "reimbursement":
      return "Pays you back for a purchase: lowers your spending in the tag it pays back and raises what is left to spend. Not income.";
    case "savings":
      return "Real money out, but never counts against the budget.";
    case "transfer":
      return "Money moving between your own accounts: never income or spending.";
    case "fund":
      return direction === "in" ? "Adds to the fund." : "Spends from the fund instead of this month's budget.";
    case "discretionary":
      return direction === "in" ? "A refund: lowers Discretionary spending." : undefined;
    default:
      return undefined;
  }
}

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: "104px minmax(0, 1fr)", columnGap: 1.5, fontSize: 14 }}>
      <Box sx={{ color: "text.secondary" }}>{label}</Box>
      <Box sx={{ overflowWrap: "anywhere" }}>{children}</Box>
    </Box>
  );
}

// One popup per transaction: what the app knows about it (where it came from,
// when, the bank's own wording) above the fields you can change, one Save.
// Opened by clicking any row; read-only for viewers.
export default function TransactionDialog({
  txn,
  editable,
  funds,
  accounts = [],
  bills,
  merchants,
  sources,
  categories,
  incomeCategories,
  onSaved,
  onDeleted,
  onClose,
}: {
  txn: TxnRowData;
  editable: boolean;
  funds: TxnFund[];
  accounts?: TxnAccount[];
  bills: TxnBill[];
  merchants: string[];
  sources: string[];
  categories: string[]; // spending tags
  incomeCategories: string[]; // income tags
  onSaved: (row: TxnRowData) => void;
  onDeleted: (id: number) => void;
  onClose: () => void;
}) {
  const fullScreen = useMediaQuery(useTheme().breakpoints.down("sm"));
  const [category, setCategory] = React.useState(txn.category);
  const [date, setDate] = React.useState(txn.postedOn);
  const [error, setError] = React.useState<string | null>(null);
  const [detail, setDetail] = React.useState<TxnDetail | null | undefined>(undefined);
  const [deleting, startDelete] = React.useTransition();

  React.useEffect(() => {
    let live = true;
    getTransactionDetailAction(txn.id)
      .then((d) => live && setDetail(d))
      .catch(() => live && setDetail(null));
    return () => {
      live = false;
    };
  }, [txn.id]);

  // The money's direction is a fact of the row; the lane only decides how it counts.
  const direction = moneyDirection(txn.category, txn.amount, txn.accountId, txn.transferAccountId);
  const flow = flowOf(category);
  const accountName = (id: number | null) => (id == null ? null : accounts.find((a) => a.id === id)?.name ?? null);
  const billChoices = billsActiveOn(bills, date).filter((b) =>
    category === "fixed" ? b.paymentsPerYear === 12 : b.paymentsPerYear !== 12,
  );
  const staleLink =
    txn.recurringExpenseId != null && !billChoices.some((b) => b.id === txn.recurringExpenseId);
  const logo = detail?.bank.find((b) => b.logoUrl)?.logoUrl ?? null;
  const adjusted = txn.amount !== txn.originalAmount;
  const amountText = `${direction === "in" && txn.category !== "transfer" ? "+" : ""}${formatMoney(Math.abs(txn.amount))}`;

  async function handle(formData: FormData) {
    setError(null);
    try {
      onSaved(await updateTransactionAction(txn.id, formData));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save.");
    }
  }

  function remove() {
    if (!window.confirm(`Delete this ${txn.merchant ?? "transaction"}?`)) return;
    startDelete(async () => {
      try {
        await deleteTransactionAction(txn.id, new FormData());
        onDeleted(txn.id);
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't delete.");
      }
    });
  }

  const facts = (
    <Stack spacing={0.75}>
      <Fact label="From">
        {SOURCE_LABEL[txn.source] ?? txn.source}
        {accountName(txn.accountId) ? ` · ${accountName(txn.accountId)}` : ""}
        {txn.category === "transfer" && accountName(txn.transferAccountId)
          ? ` → ${accountName(txn.transferAccountId)}`
          : ""}
      </Fact>
      {detail === undefined ? (
        <CircularProgress size={18} sx={{ alignSelf: "center", my: 1 }} />
      ) : detail === null ? null : (
        <>
          <Fact label="Arrived">{when(detail.arrivedAt)}</Fact>
          {detail.bank.map((b, i) => (
            <React.Fragment key={i}>
              <Fact label="Bank">
                {b.institution} · {b.account}
              </Fact>
              <Fact label="Bank reported">
                {when(b.reportedAt)}
                {b.pending ? " · pending" : b.postedAt ? ` · posted ${when(b.postedAt)}` : " · posted"}
              </Fact>
              <Fact label="Bank's text">{b.name}</Fact>
              {b.statementText && b.statementText !== b.name ? (
                <Fact label="Statement">{b.statementText}</Fact>
              ) : null}
              {b.merchantName && b.merchantName !== b.name ? (
                <Fact label="Merchant">
                  {b.merchantName}
                  {b.website ? ` · ${b.website}` : ""}
                </Fact>
              ) : null}
              {b.category ? <Fact label="Plaid category">{b.category}</Fact> : null}
            </React.Fragment>
          ))}
          {detail.bank.length === 0 && detail.accountConnected && txn.source !== "plaid" ? (
            <Fact label="Bank">Not reported by the bank yet</Fact>
          ) : null}
          {detail.split ? (
            <Fact label="Paid as">
              One bank payment of {formatMoney(detail.split.total)} covering {detail.split.parts} entries
            </Fact>
          ) : null}
          {detail.rawText ? (
            <Fact label="Text alert">
              <Box component="span" sx={{ fontFamily: "monospace", fontSize: 13 }}>
                {detail.rawText}
              </Box>
            </Fact>
          ) : null}
        </>
      )}
      {adjusted ? (
        <Fact label={detail?.bank.length ? "Bank amount" : "Original amount"}>
          {formatMoney(Math.abs(txn.originalAmount))} (you changed it)
        </Fact>
      ) : null}
    </Stack>
  );

  const header = (
    <DialogTitle component="div" sx={{ display: "flex", alignItems: "center", gap: 1.5, pr: 2 }}>
      <Avatar src={logo ?? undefined} alt="" sx={{ width: 40, height: 40, bgcolor: "action.selected", color: "text.primary" }}>
        {(txn.merchant ?? "?").charAt(0).toUpperCase()}
      </Avatar>
      <Box sx={{ minWidth: 0, flexGrow: 1 }}>
        <Typography variant="h6" noWrap>
          {txn.merchant ?? (txn.needsReview ? "Unreadable alert" : "Transaction")}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {formatDate(txn.postedOn)}
          {txn.bankStatus === "pending" ? " · pending at the bank" : ""}
        </Typography>
      </Box>
      <Stack alignItems="flex-end" spacing={0.5}>
        <Typography
          variant="h6"
          sx={{
            color:
              txn.category === "transfer" ? "text.secondary" : direction === "in" ? "success.main" : "error.main",
            whiteSpace: "nowrap",
          }}
        >
          {amountText}
        </Typography>
        {txn.needsReview ? <Chip size="small" color="warning" label="Needs review" /> : null}
      </Stack>
    </DialogTitle>
  );

  if (!editable) {
    return (
      <Dialog open onClose={onClose} fullWidth maxWidth="sm" fullScreen={fullScreen}>
        {header}
        <DialogContent sx={{ pt: 1 }}>
          <Stack spacing={0.75}>
            {facts}
            <Divider sx={{ my: 1 }} />
            <Fact label="Category">{CATEGORY_OPTIONS.find((c) => c.value === txn.category)?.label ?? txn.category}</Fact>
            {txn.spendCategory ? <Fact label="Tag">{txn.spendCategory}</Fact> : null}
            {txn.note ? <Fact label="Note">{txn.note}</Fact> : null}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={onClose}>Close</Button>
        </DialogActions>
      </Dialog>
    );
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm" fullScreen={fullScreen}>
      {header}
      <form action={handle}>
        <DialogContent sx={{ pt: 1 }}>
          <Stack spacing={2.5}>
            {error ? <Alert severity="error">{error}</Alert> : null}
            {facts}
            <Divider />
            <SuggestField
              name="merchant"
              label={category === "reimbursement" ? "From" : flow === "in" ? "Source" : "Merchant"}
              options={flow === "in" ? sources : merchants}
              defaultValue={txn.merchant ?? ""}
              autoFocus={txn.needsReview}
            />
            <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: "1fr 1fr" }}>
              <NumberField
                name="amount"
                label="Amount"
                prefix="$"
                decimalScale={2}
                defaultValue={Math.abs(txn.amount)}
              />
              <TextField
                name="postedOn"
                label="Date"
                type="date"
                defaultValue={txn.postedOn}
                onChange={(e) => setDate(e.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
              />
            </Box>
            <TextField
              name="category"
              label="Category"
              select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              helperText={categoryHelp(category, direction)}
            >
              {/* Select can't take fragments, so the grouped list is one flat array. */}
              {(["out", "in", "move"] as const).flatMap((group) => [
                <ListSubheader key={group}>{FLOW_GROUP_LABELS[group]}</ListSubheader>,
                ...CATEGORY_OPTIONS.filter((c) => c.flow === group).map((c) => (
                  <MenuItem key={c.value} value={c.value}>
                    {c.label}
                  </MenuItem>
                )),
              ])}
            </TextField>
            {category === "transfer" ? (
              <TransferAccounts accounts={accounts} fromId={txn.accountId} intoId={txn.transferAccountId} />
            ) : null}
            {category === "fund" ? (
              <TextField
                name="fundId"
                label="Which fund"
                select
                defaultValue={txn.fundId ?? ""}
                helperText={funds.length === 0 ? "No funds yet — create one first." : undefined}
              >
                {funds.map((f) => (
                  <MenuItem key={f.id} value={f.id}>
                    {f.name}
                  </MenuItem>
                ))}
              </TextField>
            ) : null}
            {category === "income" && funds.length > 0 ? (
              <TextField
                name="fundId"
                label="Put it in a fund (optional)"
                select
                defaultValue={txn.category === "income" ? (txn.fundId ?? "") : ""}
                helperText="Still counts as income; the fund keeps it until you spend it, in any month."
              >
                <MenuItem value="">
                  <em>No fund</em>
                </MenuItem>
                {funds.map((f) => (
                  <MenuItem key={f.id} value={f.id}>
                    {f.name}
                  </MenuItem>
                ))}
              </TextField>
            ) : null}
            {category === "fixed" || category === "amortized" ? (
              <TextField
                name="recurringExpenseId"
                label="Which bill"
                select
                defaultValue={txn.recurringExpenseId ?? ""}
                helperText={
                  staleLink
                    ? "Linked to a bill that isn't current here (likely an older version) — pick the right one."
                    : category === "amortized"
                      ? "Links this payment to its sinking fund — it draws the reserve, not this month's budget."
                      : "Links to the bill so its estimate reconciles."
                }
                error={staleLink}
              >
                <MenuItem value="">
                  <em>None</em>
                </MenuItem>
                {billChoices.map((b) => (
                  <MenuItem key={b.id} value={b.id}>
                    {b.name}
                  </MenuItem>
                ))}
              </TextField>
            ) : null}
            {category !== "transfer" ? (
              // Remounts when the side changes, so a spending tag never sticks to income.
              <SuggestField
                key={`tag-${flow}`}
                name="spendCategory"
                label={category === "reimbursement" ? "What it pays back" : "Tag"}
                options={flow === "in" ? incomeCategories : categories}
                defaultValue={flowOf(txn.category) === flow ? (txn.spendCategory ?? "") : ""}
                placeholder={flow === "in" ? "Paycheck, Gift…" : "Groceries, Dining…"}
              />
            ) : null}
            <TextField
              name="note"
              label="Note"
              defaultValue={txn.note ?? ""}
              fullWidth
              multiline
              minRows={1}
              placeholder="what was this?"
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={remove} color="error" disabled={deleting} sx={{ mr: "auto" }}>
            {deleting ? "Deleting…" : "Delete"}
          </Button>
          <Button onClick={onClose} color="inherit">
            Cancel
          </Button>
          <SubmitButton variant="contained" pendingLabel="Saving…">
            Save
          </SubmitButton>
        </DialogActions>
      </form>
    </Dialog>
  );
}
