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
  moneyInBySource,
  spendByTag,
  summarizeCashFlow,
} from "@/lib/queries/finance-cashflow";
import { listProfiles } from "@/lib/queries/profiles";
import { listBankAlerts } from "@/lib/queries/finance-plaid";
import { plaidConfigured } from "@/lib/plaid/client";
import { currentMonthISO, lastDayOfMonth } from "@/lib/finance/parse";
import { OUT_CATEGORIES, REIMBURSEMENT, isMoneyOut, isUnlinkedBillPayment } from "@/lib/finance/cashflow";
import { getGroupTimezone } from "@/lib/queries/group";
import { formatMonth } from "@/lib/format";
import AtlasMonthSwitcher from "@/components/finance/AtlasMonthSwitcher";
import BudgetSummary from "@/components/finance/BudgetSummary";
import BudgetInsights from "@/components/finance/BudgetInsights";
import TransactionsTable from "@/components/finance/TransactionsTable";
import FundsPanel from "@/components/finance/FundsPanel";

export const metadata = { title: "Budget" };

const d = (c: number) => Math.round(c) / 100;

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
    [flow, allTrend, tagSpend, lanes, sources, incomeCategories, bankAlerts],
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
      listIncomeCategories(),
      plaidConfigured() ? listBankAlerts() : Promise.resolve([]),
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
    .map((a) => ({ id: a.id, name: a.name, kind: a.kind }));
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

  // Discretionary by tag — the same rows the table's lane=discretionary slice
  // filter keeps (refunds and reimbursements net in, unreadable rows stay out),
  // so a tapped slice's list adds up to it.
  const discTagTotals = new Map<string | null, number>();
  for (const r of rows) {
    if ((r.category !== "discretionary" && r.category !== REIMBURSEMENT) || r.needsReview) continue;
    const signed = r.category === REIMBURSEMENT ? -r.amount : r.amount;
    discTagTotals.set(r.spendCategory, (discTagTotals.get(r.spendCategory) ?? 0) + signed);
  }
  const discTags = [...discTagTotals.entries()]
    .map(([tag, amount]) => ({ tag, amount: Math.round(amount * 100) / 100 }))
    .filter((r) => r.amount > 0)
    .sort((a, b) => b.amount - a.amount);

  // Money out by lane for All money's Type view — the same sums as its totals.
  // Reimbursements (a negative lane) net into Discretionary, like the budget.
  const paidBack = lanes.find((l) => l.category === REIMBURSEMENT)?.moneyOut ?? 0;
  const types = lanes
    .filter((l) => (OUT_CATEGORIES as readonly string[]).includes(l.category) && l.category !== REIMBURSEMENT)
    .map((l) => ({ tag: l.category, amount: l.moneyOut + (l.category === "discretionary" ? paidBack : 0) }))
    .filter((l) => l.amount > 0)
    .sort((a, b) => b.amount - a.amount);

  // History drilled into this month. Its default range is this year, so an
  // older month brings a range that contains it.
  const year = Number(month.slice(0, 4));
  const thisYear = Number(currentMonth.slice(0, 4));
  const historyRange =
    year === thisYear
      ? ""
      : year === thisYear - 1
        ? "range=lastyear&"
        : `range=custom&from=${year}-01-01&to=${year}-12-31&`;
  const historyHref = `/finance/transactions?${historyRange}m=${month.slice(0, 7)}`;

  // Untagged money out, per lens — the rows each lens's untagged filter shows.
  const untaggedOut = rows.filter(
    (r) => r.spendCategory == null && isMoneyOut(r.category, r.amount, r.needsReview),
  );
  const untaggedDisc = untaggedOut.filter((r) => r.category === "discretionary").length;

  // Bill payments the lanes can't count — `bills` is exactly this month's active bills.
  const activeBillIds = new Set(bills.map((b) => b.id));
  const unlinkedBills = rows.filter((r) =>
    isUnlinkedBillPayment(r.category, r.recurringExpenseId, r.needsReview, activeBillIds),
  ).length;

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

      {bankAlerts.length > 0 ? (
        <Alert
          severity="warning"
          sx={{ mb: 3 }}
          action={
            editor ? (
              <Button component={Link} href="/finance/settings" color="inherit" size="small">
                Reconnect
              </Button>
            ) : undefined
          }
        >
          {bankAlerts
            .map((b) => `${b.institutionName}: ${b.lastError ?? "The bank connection needs attention."}`)
            .join(" ")}
        </Alert>
      ) : null}

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
          unlinkedBills={unlinkedBills}
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
          month,
          trend,
          budget: view.hasIncome ? d(disc.budgetC) : null,
          lately:
            month === currentMonth
              ? { today: d(c.analytics.todayC), last7: d(c.analytics.last7C) }
              : null,
          tags: discTags,
          untagged: untaggedDisc,
          topPurchases,
          topMerchants,
          details: {
            reimbursed: d(disc.reimbursedC),
            recentMonths,
          },
          all: {
            moneyIn: flow.moneyIn,
            moneyOut: flow.moneyOut,
            trend: allTrend,
            tags: tagSpend,
            types,
            untagged: untaggedOut.length,
            details: {
              report: monthReportFrom(view, lanes),
              inProgress: month === currentMonth,
              sources,
              historyHref,
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
              Tip: the ⚠ rows need a look (an unreadable alert, a one-sided
              transfer, or a charge the bank dropped). Open the ⋮ menu (or tap the
              row on a phone) to set their details.
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
