"use client";

import * as React from "react";
import Paper from "@mui/material/Paper";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useTheme } from "@mui/material/styles";
import AddIcon from "@mui/icons-material/Add";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import TransactionRow, {
  onPhone,
  type TxnRowData,
  type TxnFund,
  type TxnBill,
} from "./TransactionRow";
import TransactionDetailDialog from "./TransactionDetailDialog";
import AddTransactionDialog from "./AddTransactionDialog";
import CategoryEditPopover from "./CategoryEditPopover";
import { usePathname, useSearchParams } from "next/navigation";
import {
  LANE_LABELS,
  UNTAGGED,
  flowOf,
  isMoneyOut,
  isUnlinkedBillPayment,
} from "@/lib/finance/cashflow";
import { deleteTransactionAction } from "@/app/actions/finance-budget";
import {
  loadMoreTransactionsAction,
  setSpendCategoryAction,
} from "@/app/actions/finance-transactions";
import type { TxnFilters } from "@/lib/queries/finance-transactions";

export type TxnAccount = { id: number; name: string };

type Anchored = { txn: TxnRowData; anchor: HTMLElement };

// The transaction ledger — the app's center of gravity, shared by the budget
// month and the all-time explorer so both edit the same way: tap the spend chip
// to tag it, or open the ⋮ for the fuller edit + delete. The budget hands over
// its whole month; the explorer passes `filters`, and older pages stream in
// via a server action as the sentinel scrolls into view.
export default function TransactionsTable({
  initialRows,
  initialCursor = null,
  filters,
  title,
  emptyText,
  funds,
  bills,
  accounts = [],
  merchants,
  sources,
  categories,
  incomeCategories,
  editable,
  allowAdd = false,
}: {
  initialRows: TxnRowData[];
  initialCursor?: string | null;
  // Present ⇒ paged (infinite scroll through these filters).
  filters?: TxnFilters;
  // Present ⇒ a header row with the title + "to review" count.
  title?: string;
  emptyText: string;
  funds: TxnFund[];
  bills: TxnBill[];
  accounts?: TxnAccount[];
  merchants: string[];
  sources: string[];
  categories: string[]; // spending tags
  incomeCategories: string[]; // income tags
  editable: boolean;
  allowAdd?: boolean;
}) {
  const paged = filters !== undefined;
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Phones hide the ⋮ (TransactionRow), so tapping the row opens its actions.
  const isPhone = useMediaQuery(useTheme().breakpoints.down("sm"));
  const [rows, setRows] = React.useState(initialRows);
  const [cursor, setCursor] = React.useState(initialCursor);
  const [loading, setLoading] = React.useState(false);
  const [menu, setMenu] = React.useState<Anchored | null>(null);
  const [tagging, setTagging] = React.useState<Anchored | null>(null);
  const [detail, setDetail] = React.useState<TxnRowData | null>(null);
  const [addOpen, setAddOpen] = React.useState(false);
  const [, startTransition] = React.useTransition();
  const sentinel = React.useRef<HTMLDivElement | null>(null);
  const loadingRef = React.useRef(false); // guards overlapping fetches

  // An edit's revalidatePath re-renders the page with fresh rows. A complete
  // list (the budget month) adopts them outright; a paged one only refreshes
  // rows it already shows, so the pages scrolled in so far survive.
  const [seenInitial, setSeenInitial] = React.useState(initialRows);
  if (initialRows !== seenInitial) {
    setSeenInitial(initialRows);
    if (paged) {
      const fresh = new Map(initialRows.map((r) => [r.id, r]));
      setRows((prev) => prev.map((r) => fresh.get(r.id) ?? r));
    } else {
      setRows(initialRows);
    }
  }

  const reviewCount = rows.filter((t) => t.needsReview).length;

  // The budget's slice filter (?tag=… and/or ?lane=…, set without a reload):
  // only rows that count toward that slice, so the list adds up to it. A paged
  // list gets the same filter server-side instead.
  const tagFilter = paged ? null : searchParams.get("tag");
  const laneFilter = paged ? null : searchParams.get("lane");
  // ?unlinked=1: bill payments with no current bill (`bills` = this month's active bills).
  const unlinkedFilter = !paged && searchParams.get("unlinked") === "1";
  const activeBillIds = React.useMemo(() => new Set(bills.map((b) => b.id)), [bills]);
  const filtering = tagFilter != null || laneFilter != null || unlinkedFilter;
  const shown = !filtering
    ? rows
    : unlinkedFilter
      ? rows.filter((r) =>
          isUnlinkedBillPayment(r.category, r.recurringExpenseId, r.needsReview, activeBillIds),
        )
      : rows.filter(
          (r) =>
            isMoneyOut(r.category, r.amount, r.needsReview) &&
            (laneFilter == null || r.category === laneFilter) &&
            (tagFilter == null ||
              (tagFilter === UNTAGGED ? r.spendCategory == null : r.spendCategory === tagFilter)),
        );
  const filterLabel = unlinkedFilter
    ? "Not linked to a bill"
    : [
        tagFilter == null ? null : tagFilter === UNTAGGED ? "Untagged" : tagFilter,
        laneFilter == null ? null : (LANE_LABELS[laneFilter] ?? laneFilter),
      ]
        .filter(Boolean)
        .join(" · ");
  function clearTagFilter() {
    const p = new URLSearchParams(searchParams.toString());
    p.delete("tag");
    p.delete("lane");
    p.delete("unlinked");
    const qs = p.toString();
    window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);
  }

  const openMenu = editable
    ? (txn: TxnRowData, anchor: HTMLElement) => setMenu({ txn, anchor })
    : undefined;

  function patchRow(row: TxnRowData) {
    setRows((prev) => prev.map((r) => (r.id === row.id ? row : r)));
  }

  function del(txn: TxnRowData) {
    setMenu(null);
    if (!window.confirm(`Delete this ${txn.merchant ?? "transaction"}?`)) return;
    startTransition(async () => {
      await deleteTransactionAction(txn.id, new FormData());
      setRows((prev) => prev.filter((r) => r.id !== txn.id));
    });
  }

  // Optimistic: update the tapped row now (and its merchant-siblings when
  // "apply to all"), then persist. Matches the server sweep so the two agree.
  async function saveCategory(category: string | null, applyToMerchant: boolean) {
    const target = tagging?.txn;
    setTagging(null);
    if (!target) return;
    setRows((prev) =>
      prev.map((r) => {
        if (r.id === target.id) return { ...r, spendCategory: category };
        if (
          applyToMerchant &&
          category &&
          target.merchant &&
          r.merchant === target.merchant &&
          flowOf(r.category) === flowOf(target.category)
        )
          return { ...r, spendCategory: category };
        return r;
      }),
    );
    try {
      await setSpendCategoryAction(target.id, category, applyToMerchant);
    } catch {
      // A failed save just means the optimistic chip is ahead of the server;
      // the next filter/navigation reloads the truth.
    }
  }

  const loadMore = React.useCallback(async () => {
    if (!filters || loadingRef.current || cursor == null) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      const page = await loadMoreTransactionsAction(filters, cursor);
      setRows((prev) => [...prev, ...page.rows]);
      setCursor(page.nextCursor);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [filters, cursor]);

  React.useEffect(() => {
    const el = sentinel.current;
    if (!el || !paged || cursor == null) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMore();
      },
      { rootMargin: "400px" }, // prefetch before the sentinel is on screen
    );
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore, cursor, paged]);

  // The budget's month scrolls inside the card; the explorer scrolls the page.
  const capped = !paged && shown.length > 12;

  return (
    <Paper id="transactions" variant="outlined" sx={{ p: { xs: 1.5, sm: 2 }, scrollMarginTop: 72 }}>
      {title ? (
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          sx={{ mb: 1, px: 0.5, flexWrap: "wrap", rowGap: 1 }}
        >
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="h6">{title}</Typography>
            {reviewCount > 0 ? (
              <Chip size="small" color="warning" label={`${reviewCount} to review`} />
            ) : null}
            {filtering ? (
              <Chip
                size="small"
                color="primary"
                label={`${filterLabel} · ${shown.length}`}
                onDelete={clearTagFilter}
              />
            ) : null}
          </Stack>
          {editable && allowAdd ? (
            <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={() => setAddOpen(true)}>
              Add
            </Button>
          ) : null}
        </Stack>
      ) : null}

      {shown.length === 0 ? (
        <Typography color="text.secondary" sx={{ p: 3, textAlign: "center" }}>
          {filtering ? "Nothing in this slice this month." : emptyText}
        </Typography>
      ) : (
        <TableContainer sx={{ overflowX: "auto", maxHeight: capped ? 520 : undefined }}>
          {/* Phones get stacked rows (TransactionRow), so no header or min width. */}
          <Table
            size="small"
            stickyHeader={capped}
            sx={[{ minWidth: 520 }, onPhone({ display: "block", minWidth: 0 })]}
          >
            <TableHead sx={onPhone({ display: "none" })}>
              <TableRow>
                <TableCell>Date</TableCell>
                <TableCell>Merchant</TableCell>
                <TableCell align="right">Amount</TableCell>
                <TableCell>Category</TableCell>
                {editable ? <TableCell align="right" /> : null}
              </TableRow>
            </TableHead>
            <TableBody sx={onPhone({ display: "block" })}>
              {shown.map((t) => (
                <TransactionRow
                  key={t.id}
                  txn={t}
                  funds={funds}
                  onMenu={openMenu}
                  onRowClick={isPhone ? openMenu : undefined}
                  onEditCategory={editable ? (txn, anchor) => setTagging({ txn, anchor }) : undefined}
                />
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {paged && rows.length > 0 ? (
        <Box ref={sentinel} sx={{ display: "flex", justifyContent: "center", py: 2 }}>
          {loading ? (
            <CircularProgress size={22} />
          ) : cursor == null ? (
            <Typography variant="caption" color="text.secondary">
              End of results
            </Typography>
          ) : null}
        </Box>
      ) : null}

      <Menu
        anchorEl={menu?.anchor}
        open={Boolean(menu)}
        onClose={() => setMenu(null)}
        // Anchored to a whole row on phones: drop below it, flush right.
        {...(isPhone
          ? {
              anchorOrigin: { vertical: "bottom", horizontal: "right" },
              transformOrigin: { vertical: "top", horizontal: "right" },
            }
          : {})}
      >
        <MenuItem
          onClick={() => {
            if (menu) setDetail(menu.txn);
            setMenu(null);
          }}
        >
          <ListItemIcon>
            <EditOutlinedIcon fontSize="small" />
          </ListItemIcon>
          Edit details
        </MenuItem>
        <MenuItem onClick={() => menu && del(menu.txn)} sx={{ color: "error.main" }}>
          <ListItemIcon>
            <DeleteOutlineIcon fontSize="small" color="error" />
          </ListItemIcon>
          Delete
        </MenuItem>
      </Menu>

      {tagging ? (
        <CategoryEditPopover
          anchorEl={tagging.anchor}
          merchant={tagging.txn.merchant}
          current={tagging.txn.spendCategory}
          categories={flowOf(tagging.txn.category) === "in" ? incomeCategories : categories}
          placeholder={
            flowOf(tagging.txn.category) === "in" ? "Paycheck, Interest…" : "Groceries, Dining…"
          }
          onSave={saveCategory}
          onClose={() => setTagging(null)}
        />
      ) : null}
      {detail ? (
        <TransactionDetailDialog
          txn={detail}
          funds={funds}
          bills={bills}
          merchants={merchants}
          sources={sources}
          onSaved={patchRow}
          onClose={() => setDetail(null)}
        />
      ) : null}
      {addOpen ? (
        <AddTransactionDialog
          funds={funds}
          bills={bills}
          accounts={accounts}
          merchants={merchants}
          sources={sources}
          onClose={() => setAddOpen(false)}
        />
      ) : null}
    </Paper>
  );
}
