"use client";

import * as React from "react";
import Paper from "@mui/material/Paper";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Chip from "@mui/material/Chip";
import LinearProgress from "@mui/material/LinearProgress";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import AddIcon from "@mui/icons-material/Add";
import LabelOutlinedIcon from "@mui/icons-material/LabelOutlined";
import { formatMoney } from "@/lib/format";
import ExpenseDialog, {
  type ExpenseValues,
  type PayAccount,
} from "./ExpenseDialog";
import CategoryManager, { type CategoryUsage } from "./CategoryManager";

const NECESSITY_META: Record<
  string,
  { label: string; color: "default" | "warning" | "success" }
> = {
  essential: { label: "essential", color: "default" },
  lifestyle: { label: "lifestyle", color: "warning" },
  commitment: { label: "commitment", color: "success" },
};

export type ExpenseTotals = {
  monthlyNet: number;
  fixedMonthly: number;
  byCategory: { category: string; monthly: number }[];
  byNecessity: { necessity: string; monthly: number }[];
  byAccount: { name: string; kind: string | null; monthly: number }[];
  savingsGoal: number;
  discretionLeft: number;
  expectedOutflows: {
    name: string;
    kind: string | null;
    monthly: number;
    includesDiscretion: boolean;
  }[];
};

function Tile({
  label,
  value,
  sub,
  color,
  children,
}: {
  label: string;
  value?: string;
  sub?: string;
  color?: string;
  children?: React.ReactNode;
}) {
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ textTransform: "uppercase", letterSpacing: "0.04em" }}
      >
        {label}
      </Typography>
      {value != null ? (
        <Typography variant="h5" component="div" sx={{ mt: 0.5, color }}>
          {value}
        </Typography>
      ) : null}
      {sub ? (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: "block" }}
        >
          {sub}
        </Typography>
      ) : null}
      {children}
    </Paper>
  );
}

// The household's recurring-spend registry: summary tiles (fixed total, split
// by paying account; discretion left; the Budget tab's envelope), a where-does-
// it-go necessity breakdown, and the bills table grouped by category.
export default function ExpensesSection({
  expenses,
  totals,
  categoryOptions,
  categoryUsage,
  accounts,
  editable,
  yearOptions,
  defaultMonth,
}: {
  expenses: ExpenseValues[];
  totals: ExpenseTotals;
  categoryOptions: string[];
  categoryUsage: CategoryUsage[];
  accounts: PayAccount[];
  editable: boolean;
  yearOptions: number[];
  defaultMonth: string;
}) {
  const [editing, setEditing] = React.useState<ExpenseValues | "new" | null>(
    null,
  );
  const [categoriesOpen, setCategoriesOpen] = React.useState(false);
  // For "bills actually hitting this month" awareness on non-monthly rows.
  const viewedMonthNum = Number(defaultMonth.slice(5, 7));

  // Group rows by category for the table (largest categories first).
  const byCategory = new Map<string, ExpenseValues[]>();
  for (const e of expenses) {
    const key = e.category ?? "Uncategorized";
    byCategory.set(key, [...(byCategory.get(key) ?? []), e]);
  }
  const categoryOrder = totals.byCategory.map((c) => c.category);
  const categorySubtotal = new Map(
    totals.byCategory.map((c) => [c.category, c.monthly]),
  );

  return (
    <>
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ mb: 1.5, flexWrap: "wrap", rowGap: 1 }}
      >
        <Typography variant="h5" component="h2">
          Recurring spend
        </Typography>
        {editable ? (
          <Stack direction="row" spacing={1}>
            <Button
              size="small"
              startIcon={<LabelOutlinedIcon />}
              onClick={() => setCategoriesOpen(true)}
            >
              Categories
            </Button>
            <Button
              variant="contained"
              size="small"
              startIcon={<AddIcon />}
              onClick={() => setEditing("new")}
            >
              Add expense
            </Button>
          </Stack>
        ) : null}
      </Stack>

      <Box
        sx={{
          display: "grid",
          gap: 1.5,
          gridTemplateColumns: { xs: "1fr 1fr", md: "repeat(4, 1fr)" },
          mb: 2,
        }}
      >
        <Tile
          label="Monthly net income"
          value={formatMoney(totals.monthlyNet)}
        />
        <Tile
          label="Fixed monthly"
          value={formatMoney(totals.fixedMonthly)}
          sub={`${expenses.length} recurring ${expenses.length === 1 ? "bill" : "bills"}`}
        />

        <Tile
          label="Discretion left"
          value={formatMoney(totals.discretionLeft)}
          color={totals.discretionLeft >= 0 ? "success.main" : "warning.main"}
          sub={totals.savingsGoal > 0 ? "net income − fixed − take-home savings" : "net income − fixed"}
        />
        {/* No headline on purpose: the sum is always monthly net minus the
            savings goal (fixed + discretion) — the information here is the
            SPLIT by source. */}
        <Tile
          label="Where it flows out"
          sub="budgeted per source · annual bills amortized, not billed"
        >
          <Stack spacing={0.5} sx={{ mt: 1 }}>
            {totals.expectedOutflows.length === 0 ? (
              <Typography variant="caption" color="text.secondary">
                Assign bills to accounts to see the split.
              </Typography>
            ) : (
              totals.expectedOutflows.map((o) => (
                <Stack
                  key={o.name}
                  direction="row"
                  justifyContent="space-between"
                  spacing={1}
                >
                  <Typography variant="body2" color="text.secondary" noWrap>
                    {o.name}
                    {o.includesDiscretion ? " · incl. discretionary" : ""}
                  </Typography>
                  <Typography variant="body2" fontWeight={600}>
                    {formatMoney(o.monthly)}
                  </Typography>
                </Stack>
              ))
            )}
          </Stack>
        </Tile>
      </Box>

      {totals.fixedMonthly > 0 ? (
        <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ textTransform: "uppercase", letterSpacing: "0.04em" }}
          >
            Where the fixed money goes
          </Typography>
          <Stack spacing={1} sx={{ mt: 1 }}>
            {totals.byNecessity.map((n) => {
              const meta = NECESSITY_META[n.necessity] ?? {
                label: n.necessity,
                color: "default" as const,
              };
              const pct = (n.monthly / totals.fixedMonthly) * 100;
              return (
                <Stack
                  key={n.necessity}
                  direction="row"
                  alignItems="center"
                  spacing={1.5}
                >
                  <Chip
                    size="small"
                    color={meta.color}
                    variant="outlined"
                    label={meta.label}
                    sx={{ width: 110 }}
                  />
                  <LinearProgress
                    variant="determinate"
                    value={pct}
                    sx={{ flexGrow: 1, height: 8, borderRadius: 4 }}
                  />
                  <Typography
                    variant="body2"
                    sx={{ minWidth: 110, textAlign: "right" }}
                  >
                    {formatMoney(n.monthly)} · {Math.round(pct)}%
                  </Typography>
                </Stack>
              );
            })}
          </Stack>
        </Paper>
      ) : null}

      {expenses.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 4, textAlign: "center" }}>
          <Typography color="text.secondary">
            {editable
              ? "No recurring expenses yet — add rent, utilities, subscriptions…"
              : "No recurring expenses yet."}
          </Typography>
        </Paper>
      ) : (
        <TableContainer
          component={Paper}
          variant="outlined"
          sx={{ overflowX: "auto" }}
        >
          <Table size="small" sx={{ minWidth: 640 }}>
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Necessity</TableCell>
                <TableCell align="right">Amount</TableCell>
                <TableCell align="right">Monthly</TableCell>
                <TableCell>Paid from</TableCell>
                <TableCell>Due</TableCell>
                {editable ? <TableCell align="right" /> : null}
              </TableRow>
            </TableHead>
            <TableBody>
              {categoryOrder.map((cat) => (
                <React.Fragment key={cat}>
                  <TableRow sx={{ bgcolor: "action.hover" }}>
                    <TableCell colSpan={3} sx={{ fontWeight: 700 }}>
                      {cat}
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700 }}>
                      {formatMoney(categorySubtotal.get(cat) ?? 0)}
                    </TableCell>
                    <TableCell colSpan={editable ? 3 : 2} />
                  </TableRow>
                  {(byCategory.get(cat) ?? []).map((e) => {
                    const meta = NECESSITY_META[e.necessity] ?? {
                      label: e.necessity,
                      color: "default" as const,
                    };
                    return (
                      <TableRow key={e.id} hover>
                        <TableCell sx={{ pl: 3, whiteSpace: "nowrap" }}>
                          {e.name}
                          {e.isEstimate ? (
                            <Chip
                              label="estimate"
                              size="small"
                              variant="outlined"
                              sx={{ ml: 1 }}
                            />
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <Chip
                            size="small"
                            color={meta.color}
                            variant="outlined"
                            label={meta.label}
                          />
                        </TableCell>
                        <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
                          {formatMoney(e.amount)}
                          {e.paymentsPerYear !== 12 ? (
                            <Typography
                              component="span"
                              variant="caption"
                              color="text.secondary"
                            >
                              {" "}
                              ×{e.paymentsPerYear}/yr
                            </Typography>
                          ) : null}
                        </TableCell>
                        <TableCell align="right">
                          {formatMoney(e.monthly)}
                        </TableCell>
                        <TableCell>{e.paidFromName ?? "—"}</TableCell>
                        <TableCell
                          sx={{ color: "text.secondary", whiteSpace: "nowrap" }}
                        >
                          {e.paymentsPerYear !== 12 &&
                          e.dueMonths?.includes(viewedMonthNum) ? (
                            <Tooltip
                              title={`Bills its full ${formatMoney(e.amount)} this month — the rest of the year it only reserves ${formatMoney(e.monthly)}/mo`}
                            >
                              <Typography
                                component="span"
                                variant="body2"
                                sx={{ color: "warning.main", fontWeight: 600 }}
                              >
                                {e.dueDay ?? "this month"}
                              </Typography>
                            </Tooltip>
                          ) : (
                            (e.dueDay ?? "—")
                          )}
                        </TableCell>
                        {editable ? (
                          <TableCell align="right">
                            <Tooltip title={`Edit ${e.name}`}>
                              <IconButton
                                size="small"
                                onClick={() => setEditing(e)}
                                aria-label={`Edit ${e.name}`}
                              >
                                <EditOutlinedIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          </TableCell>
                        ) : null}
                      </TableRow>
                    );
                  })}
                </React.Fragment>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {editing !== null ? (
        <ExpenseDialog
          open
          onClose={() => setEditing(null)}
          expense={editing === "new" ? null : editing}
          categoryOptions={categoryOptions}
          accounts={accounts}
          yearOptions={yearOptions}
          defaultMonth={defaultMonth}
        />
      ) : null}

      {categoriesOpen ? (
        <CategoryManager
          open
          onClose={() => setCategoriesOpen(false)}
          usage={categoryUsage}
        />
      ) : null}
    </>
  );
}
