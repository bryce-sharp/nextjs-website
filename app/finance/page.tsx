import Link from "@/components/shared/AppLink";
import { redirect } from "next/navigation";
import Container from "@mui/material/Container";
import Stack from "@mui/material/Stack";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Alert from "@mui/material/Alert";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import { getSession } from "@/lib/session";
import { isEditor } from "@/lib/auth";
import {
  getBudgetMonth,
  listMonthTransactionsForSession,
  listBudgetMonths,
  listBillsForMonth,
  listRecentMonths,
  listMerchantSuggestions,
  getSpendTrend,
  monthReportFrom,
} from "@/lib/queries/finance-budget";
import { listFinancialAccounts } from "@/lib/queries/finance-networth";
import { listIncomeCategories, listSpendCategories } from "@/lib/queries/finance-categories";
import { toTxnRow } from "@/lib/queries/finance-transactions";
import {
  cashFlowByCategory,
  cashFlowByMonth,
  moneyInBySource,
  spendByTag,
  summarizeCashFlow,
} from "@/lib/queries/finance-cashflow";
import { listProfiles } from "@/lib/queries/profiles";
import { currentMonthISO, lastDayOfMonth } from "@/lib/finance/parse";
import { getGroupTimezone } from "@/lib/queries/group";
import { formatMonth } from "@/lib/format";
import AtlasMonthSwitcher from "@/components/finance/AtlasMonthSwitcher";
import BudgetSummary from "@/components/finance/BudgetSummary";
import BudgetInsights from "@/components/finance/BudgetInsights";
import TransactionsTable from "@/components/finance/TransactionsTable";
import FundsPanel from "@/components/finance/FundsPanel";

export const metadata = { title: "Budget" };

const d = (c: number) => Math.round(c) / 100;

/** YYYY-MM-01 shifted by whole months. */
function shiftMonth(month: string, delta: number): string {
  const dt = new Date(`${month.slice(0, 7)}-01T12:00:00Z`);
  dt.setUTCMonth(dt.getUTCMonth() + delta);
  return dt.toISOString().slice(0, 10);
}

// The Budget tab (F3): this month's transactions + the discretionary pace,
// computed live from the ledger. Past months render frozen once closed (CP4b).
export default async function BudgetPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const session = await getSession();
  if (session === null) redirect("/login");

  const { month: monthParam } = await searchParams;
  const currentMonth = currentMonthISO(await getGroupTimezone(session.groupId));
  const month =
    monthParam && /^\d{4}-\d{2}/.test(monthParam)
      ? `${monthParam.slice(0, 7)}-01`
      : currentMonth;

  // The All-money lens reads the shared cash-flow definition for this month.
  const monthRange = { from: month, to: lastDayOfMonth(month) };
  const groupId = session.groupId;
  const [
    [view, txns, accounts, monthsWithData, bills, groupProfiles, recentMonths, trend, suggest, categories, editor],
    [flow, allTrend, tagSpend, lanes, sources, recentFlows, incomeCategories],
  ] = await Promise.all([
    Promise.all([
      getBudgetMonth(month),
      listMonthTransactionsForSession(month),
      listFinancialAccounts(),
      listBudgetMonths(),
      listBillsForMonth(month),
      listProfiles(),
      listRecentMonths(month, 3),
      getSpendTrend(month),
      listMerchantSuggestions(),
      listSpendCategories(),
      isEditor(),
    ]),
    Promise.all([
      summarizeCashFlow(groupId, monthRange),
      getSpendTrend(month, "all"),
      spendByTag(groupId, monthRange),
      cashFlowByCategory(groupId, monthRange),
      moneyInBySource(groupId, monthRange),
      cashFlowByMonth(groupId, { from: shiftMonth(month, -3), to: lastDayOfMonth(shiftMonth(month, -1)) }),
      listIncomeCategories(),
    ]),
  ]);
  const c = view.computation;
  const disc = c.discretionary;

  const rows = txns.map(toTxnRow);

  const fundPicks = c.funds.map((f) => ({ id: f.id, name: f.name }));
  const fundViews = c.funds.map((f) => ({
    id: f.id,
    name: f.name,
    ownerName: f.ownerName,
    balance: d(f.balanceC),
    drawnThisMonth: d(f.drawnThisMonthC),
  }));
  const accountPicks = accounts
    .filter((a) => !a.archivedAt)
    .map((a) => ({ id: a.id, name: a.name }));
  const ownerPicks = groupProfiles.map((p) => ({ id: p.id, name: p.name }));
  const earliestMonth = monthsWithData[0] ?? null;

  // Insights top-3s are DISCRETIONARY only — the controllable spend. Rent and
  // tithing dominate raw "biggest purchase," which isn't insight; bills show in
  // the billed breakdown instead.
  const discSpend = rows.filter((r) => r.category === "discretionary" && r.amount > 0);
  const topPurchases = [...discSpend]
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 3)
    .map((r) => ({ merchant: r.merchant ?? "—", amount: r.amount, date: r.postedOn }));
  const merchantAgg = new Map<string, { total: number; count: number }>();
  for (const r of discSpend) {
    if (!r.merchant) continue;
    const cur = merchantAgg.get(r.merchant) ?? { total: 0, count: 0 };
    cur.total += r.amount;
    cur.count += 1;
    merchantAgg.set(r.merchant, cur);
  }
  const topMerchants = [...merchantAgg.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 3)
    .map(([merchant, { total, count }]) => ({ merchant, total, count }));

  // Income this month, grouped by source (the merchant field on income rows).
  // Only true income rows — the fund top-up an income entry may spawn is a
  // separate "fund" row and never counts here.
  const incomeRows = rows.filter((r) => r.category === "income");
  const incomeTotal = incomeRows.reduce((s, r) => s + r.amount, 0);
  const incomeSourceTotals = new Map<string, number>();
  for (const r of incomeRows) {
    const k = r.merchant || "—";
    incomeSourceTotals.set(k, (incomeSourceTotals.get(k) ?? 0) + r.amount);
  }
  const incomeBySource = [...incomeSourceTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([source, amount]) => ({ source, amount }));

  return (
    <Container maxWidth="md" sx={{ py: { xs: 4, md: 6 } }}>
      <Stack
        direction="row"
        alignItems="flex-start"
        justifyContent="space-between"
        spacing={2}
        sx={{ mb: 3, flexWrap: "wrap", rowGap: 2 }}
      >
        <Stack spacing={0.5}>
          <Typography variant="h3" component="h1">
            Budget
          </Typography>
          <Typography variant="h6" component="p" color="text.secondary" fontWeight={400}>
            {month === currentMonth ? "This month's spending, live" : formatMonth(month)}
          </Typography>
        </Stack>
        <Stack direction="row" spacing={1} alignItems="center">
          <AtlasMonthSwitcher
            month={month}
            earliestMonth={earliestMonth}
            currentMonth={currentMonth}
            basePath="/finance"
          />
          {editor ? (
            <Button
              component={Link}
              href="/finance/settings"
              size="small"
              color="inherit"
              startIcon={<SettingsOutlinedIcon />}
            >
              Connections
            </Button>
          ) : null}
        </Stack>
      </Stack>

      {!view.hasIncome ? (
        <Alert severity="info" sx={{ mb: 3 }}>
          No income is set for {formatMonth(month)}, so there&apos;s no spending
          budget to compute — only the bills that were active then.
          {editor
            ? " Back-date compensation in ATLAS if you want to budget this month."
            : ""}
        </Alert>
      ) : (
        <BudgetSummary
          isCurrentMonth={month === currentMonth}
          d={{
            budget: d(disc.budgetC),
            netSpent: d(disc.netSpentC),
            remaining: d(disc.remainingC),
            perDay: d(disc.perDayC),
            paceDelta: d(disc.paceDeltaC),
            allowedSoFar: d(disc.allowedSoFarC),
            dayOfMonth: c.dayOfMonth,
            daysInMonth: c.daysInMonth,
            fixed: { actual: d(c.fixed.actualC), expected: d(c.fixed.expectedC) },
            amortized: { paid: d(c.amortized.paidThisMonthC), reserved: d(c.amortized.reservedMonthlyC) },
          }}
        />
      )}

      {disc.estimateAdjustmentC !== 0 ? (
        <Alert severity="info" variant="outlined" sx={{ mb: 3 }}>
          Budget adjusted {formatMonth(month)} by{" "}
          {d(disc.estimateAdjustmentC) >= 0 ? "+" : "−"}$
          {Math.abs(d(disc.estimateAdjustmentC)).toFixed(2)} — a variable bill
          posted differently than its estimate.
        </Alert>
      ) : null}

      <BudgetInsights
        d={{
          trend,
          budget: view.hasIncome ? d(disc.budgetC) : null,
          topPurchases,
          topMerchants,
          details: {
            isCurrentMonth: month === currentMonth,
            reimbursed: d(disc.reimbursedC),
            savings: d(c.savingsC),
            income: { total: incomeTotal, bySource: incomeBySource },
            today: d(c.analytics.todayC),
            yesterday: d(c.analytics.yesterdayC),
            last7: d(c.analytics.last7C),
            recentMonths,
          },
          all: {
            moneyIn: flow.moneyIn,
            moneyOut: flow.moneyOut,
            trend: allTrend,
            tags: tagSpend,
            details: {
              report: monthReportFrom(view, lanes),
              inProgress: month === currentMonth,
              sources,
              recent: recentFlows,
            },
          },
        }}
      />

      <Box sx={{ mt: 3 }}>
        <TransactionsTable
          initialRows={rows}
          title="Transactions"
          emptyText={`No transactions yet this month.${
            editor ? " Add one, or let your card alerts flow in." : ""
          }`}
          funds={fundPicks}
          bills={bills}
          accounts={accountPicks}
          merchants={suggest.merchants}
          sources={suggest.sources}
          categories={categories}
          incomeCategories={incomeCategories}
          editable={editor}
          allowAdd
        />
        {c.needsReviewCount > 0 && editor ? (
          <Box sx={{ mt: 2 }}>
            <Typography variant="caption" color="text.secondary">
              Tip: the ⚠ rows couldn&apos;t be read automatically — open the ⋮ menu
              (or tap the row on a phone) to set their details.
            </Typography>
          </Box>
        ) : null}
      </Box>

      <Box sx={{ mt: 3 }}>
        <FundsPanel funds={fundViews} owners={ownerPicks} editable={editor} />
      </Box>
    </Container>
  );
}
