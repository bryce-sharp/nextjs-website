import Container from "@mui/material/Container";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Alert from "@mui/material/Alert";
import Paper from "@mui/material/Paper";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import { isEditor } from "@/lib/auth";
import { getAtlasView } from "@/lib/queries/finance-atlas";
import { listFinancialAccounts } from "@/lib/queries/finance-networth";
import { listProfiles } from "@/lib/queries/profiles";
import { currentMonthISO } from "@/lib/finance/parse";
import { requireGroupId } from "@/lib/session";
import { getGroupTimezone } from "@/lib/queries/group";
import { formatMonth } from "@/lib/format";
import AtlasMonthSwitcher from "@/components/finance/AtlasMonthSwitcher";
import AtlasPersonCard, {
  type AtlasPersonProps,
} from "@/components/finance/AtlasPersonCard";
import ExpensesSection from "@/components/finance/ExpensesSection";
import SankeyChart from "@/components/finance/SankeyChart";
import SavingsGoalCard from "@/components/finance/SavingsGoalCard";
import { buildAtlasFlows } from "@/lib/finance/atlas-flows";
import type { ExpenseValues } from "@/components/finance/ExpenseDialog";

export const metadata = { title: "ATLAS" };

// ATLAS — Asset Tracking and Long-term Accounting System (Bryce's name, kept):
// income + the recurring-spend registry, viewed AT a month. Every number is
// derived from the config effective then; the month switcher is time travel,
// and editing is only offered on the current month (the past is an exhibit).
export default async function AtlasPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month } = await searchParams;
  const [view, profiles, allAccounts, editor] = await Promise.all([
    getAtlasView(month),
    listProfiles(),
    listFinancialAccounts(),
    isEditor(),
  ]);

  const editable = editor && view.isCurrentMonth;
  const currentMonth = currentMonthISO(await getGroupTimezone(await requireGroupId()));
  const defaultMonth = currentMonth.slice(0, 7);

  const cy = Number(currentMonth.slice(0, 4));
  const earliestYear = view.earliestMonth
    ? Number(view.earliestMonth.slice(0, 4))
    : cy;
  const yearOptions: number[] = [];
  for (let y = cy + 1; y >= Math.min(earliestYear, cy - 5); y--)
    yearOptions.push(y);

  // Serializable slices for the client cards: people WITH income first (view
  // math), then plan-less profiles as set-up CTAs (editor only).
  const people: AtlasPersonProps[] = view.people.map((p) => ({
    profileId: p.profileId,
    name: p.name,
    color: p.color,
    comp: {
      payFrequency: p.plan.payFrequency,
      grossPerPaycheck: p.grossPerPaycheck,
      baseSalary: p.plan.baseSalary != null ? Number(p.plan.baseSalary) : null,
      shares: p.plan.shares,
      sharePrice: p.plan.sharePrice != null ? Number(p.plan.sharePrice) : null,
      notes: p.plan.notes,
      paychecksPerYear: p.paychecksPerYear,
      netPerPaycheck: p.netPerPaycheck,
      payrollDeductionsPerPaycheck: p.payrollDeductionsPerPaycheck,
      employerPerPaycheck: p.employerPerPaycheck,
      monthlyNet: p.monthlyNet,
      yearlyNet: p.yearlyNet,
      hourly: p.hourly,
      tcv: p.tcv,
      investingPerYear: p.investingPerYear,
    },
    deductions: p.deductions.map((d) => ({
      id: d.id,
      name: d.name,
      type: d.type,
      source: d.source,
      amountPerPaycheck:
        d.amountPerPaycheck != null ? Number(d.amountPerPaycheck) : null,
      percentOfGross:
        d.percentOfGross != null ? Number(d.percentOfGross) : null,
      effectivePerPaycheck: d.effectivePerPaycheck,
      isPercent: d.isPercent,
      monthly: d.monthly,
      pctOfGross: d.pctOfGross,
      depositAccountId: d.depositAccountId,
      notes: d.notes,
    })),
  }));
  const planless: AtlasPersonProps[] = editable
    ? profiles
        .filter((p) => !view.people.some((v) => v.profileId === p.id))
        .map((p) => ({
          profileId: p.id,
          name: p.name,
          color: p.color,
          comp: null,
          deductions: [],
        }))
    : [];

  const expenses: ExpenseValues[] = view.expenses.map((e) => ({
    id: e.id,
    name: e.name,
    category: e.category,
    necessity: e.necessity,
    amount: Number(e.amount),
    paymentsPerYear: e.paymentsPerYear,
    dueMonths: e.dueMonths,
    dueDay: e.dueDay,
    paidFromAccountId: e.paidFromAccountId,
    paidFromName: e.paidFromName,
    isEstimate: e.isEstimate,
    merchantPatterns: e.merchantPatterns,
    notes: e.notes,
    monthly: e.monthly,
  }));

  // "Paid from" options: every non-archived account (the credit-card one is
  // what makes the envelope tile light up).
  const accounts = allAccounts
    .filter((a) => !a.archivedAt)
    .map((a) => ({ id: a.id, name: a.name }));

  // The planned money flow (paycheck → deductions/net → bills/discretionary),
  // built server-side from the same derived numbers as everything above.
  const flows = buildAtlasFlows({
    people: view.people.map((p) => ({
      name: p.name,
      grossMonthly:
        Math.round(((p.grossPerPaycheck * p.paychecksPerYear) / 12) * 100) / 100,
      monthlyNet: p.monthlyNet,
      deductions: p.deductions.map((d) => ({
        name: d.name,
        source: d.source,
        type: d.type,
        monthly: d.monthly,
      })),
    })),
    byCategory: view.totals.byCategory,
    savingsGoal: view.totals.savingsGoal,
    discretionLeft: view.totals.discretionLeft,
  });
  // Give every label breathing room: size the chart to its busiest column
  // (middle = payroll deductions + net; right = categories + discretionary).
  const middleCount =
    view.people.reduce(
      (n, p) => n + p.deductions.filter((d) => d.source === "payroll").length,
      0,
    ) + 1;
  const rightCount = view.totals.byCategory.length + (view.totals.savingsGoal > 0 ? 2 : 1);
  const sankeyHeight = Math.max(400, Math.max(middleCount, rightCount) * 48);

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
            ATLAS
          </Typography>
          <Typography
            variant="h6"
            component="p"
            color="text.secondary"
            fontWeight={400}
          >
            Asset Tracking and Long-term Accounting System
          </Typography>
        </Stack>
        <AtlasMonthSwitcher
          month={view.month}
          earliestMonth={view.earliestMonth}
          currentMonth={currentMonth}
        />
      </Stack>

      {!view.isCurrentMonth ? (
        <Alert severity="info" sx={{ mb: 3 }}>
          Viewing {formatMonth(view.month)} — the numbers use the pay &amp;
          bills that were in effect then. Editing happens on the current month.
        </Alert>
      ) : null}

      {/* One long page, three destinations — anchor chips instead of tabs. */}
      <Stack direction="row" spacing={1} sx={{ mb: 3 }}>
        <Chip component="a" href="#income" clickable size="small" label="Income" />
        <Chip component="a" href="#savings" clickable size="small" label="Savings goal" />
        {flows.links.length > 0 ? (
          <Chip component="a" href="#flow" clickable size="small" label="Money flow" />
        ) : null}
        <Chip component="a" href="#spending" clickable size="small" label="Spending" />
      </Stack>

      <Box id="income" sx={{ scrollMarginTop: 88 }}>
        {[...people, ...planless].map((p) => (
          <AtlasPersonCard
            key={p.profileId}
            person={p}
            editable={editable}
            yearOptions={yearOptions}
            defaultMonth={defaultMonth}
            accounts={accounts}
          />
        ))}
      </Box>
      {people.length === 0 && planless.length === 0 ? (
        <Alert severity="info" sx={{ mb: 3 }}>
          No income set up yet{editor ? " — enter edit mode to add it." : "."}
        </Alert>
      ) : null}

      <SavingsGoalCard
        goal={view.totals.savingsGoal}
        paycheckSavings={view.totals.savingsFromPaycheck}
        paycheckNames={view.totals.paycheckSavingsNames}
        since={view.totals.savingsGoalSince}
        editable={editable}
        defaultMonth={defaultMonth}
        yearOptions={yearOptions}
      />

      {flows.links.length > 0 ? (
        <Paper
          id="flow"
          variant="outlined"
          sx={{ p: { xs: 1.5, sm: 2.5 }, mb: 3, scrollMarginTop: 88 }}
        >
          <Typography variant="h6" sx={{ px: 1 }}>
            Money flow
          </Typography>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ px: 1, mb: 1.5, display: "block" }}
          >
            The monthly plan: paycheck → deductions &amp; net → bills, savings
            goal &amp; discretionary. Hover a ribbon for the numbers.
          </Typography>
          <SankeyChart nodes={flows.nodes} links={flows.links} height={sankeyHeight} />
        </Paper>
      ) : null}

      <Box id="spending" sx={{ scrollMarginTop: 88 }}>
        <ExpensesSection
          expenses={expenses}
          totals={view.totals}
          categoryOptions={view.categoryOptions}
          categoryUsage={view.categoryUsage}
          accounts={accounts}
          editable={editable}
          yearOptions={yearOptions}
          defaultMonth={defaultMonth}
        />
      </Box>
    </Container>
  );
}
