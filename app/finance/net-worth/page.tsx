import { redirect } from "next/navigation";
import Container from "@mui/material/Container";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import SavingsOutlinedIcon from "@mui/icons-material/SavingsOutlined";
import { isEditor } from "@/lib/auth";
import { getSession } from "@/lib/session";
import { getGroupTimezone } from "@/lib/queries/group";
import { todayISO } from "@/lib/finance/parse";
import { addMonths, rangeLabel, type NetWorthRange } from "@/lib/finance/net-worth";
import {
  getNetWorthDashboardForGroup,
  getNetWorthExtrasForGroup,
} from "@/lib/queries/finance-networth";
import NetWorthActions from "@/components/finance/NetWorthActions";
import NetWorthTiles from "@/components/finance/NetWorthTiles";
import NetWorthOverview from "@/components/finance/NetWorthOverview";
import NetWorthInsights from "@/components/finance/NetWorthInsights";
import NetWorthRangePicker from "@/components/finance/NetWorthRangePicker";
import MonthlyLog from "@/components/finance/MonthlyLog";
import DueMonthBanner from "@/components/finance/DueMonthBanner";

export const metadata = { title: "Net Worth" };

const RANGES: NetWorthRange[] = ["year", "12mo", "all"];

// The Net Worth tab (F1 of the finance app): monthly per-account balances →
// growth, where the money lives, and what the pace and the cash cushion mean
// going forward. It only tracks money up and down; the savings goal lives
// with the budget. Household data: everyone in the
// group sees and edits it.
export default async function NetWorthPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const session = await getSession();
  if (session === null) redirect("/login");
  const { range: rawRange } = await searchParams;
  const range = RANGES.includes(rawRange as NetWorthRange) ? (rawRange as NetWorthRange) : "year";

  const groupId = session.groupId;
  const today = todayISO(await getGroupTimezone(groupId));
  const [dash, editor] = await Promise.all([
    getNetWorthDashboardForGroup(groupId, range, today),
    isEditor(),
  ]);
  const extras = await getNetWorthExtrasForGroup(groupId, dash, today);

  const currentMonth = today.slice(0, 7);
  // Balances are logged on the 1st for the month that just closed.
  const logMonth = addMonths(`${currentMonth}-01`, -1).slice(0, 7);

  // Serializable slices for the client components.
  const snapshotAccounts = dash.allAccounts
    .filter((a) => !a.archivedAt && a.trackBalance)
    .map((a) => ({ id: a.id, name: a.name }));
  const managedAccounts = dash.allAccounts.map((a) => ({
    id: a.id,
    name: a.name,
    kind: a.kind,
    transferPatterns: a.transferPatterns ?? [],
    trackBalance: a.trackBalance,
    carriesDiscretion: a.carriesDiscretion,
    archived: a.archivedAt !== null,
    notes: a.notes,
  }));
  const windowAccounts = dash.accounts.map((a) => ({
    id: a.id,
    name: a.name,
    kind: a.kind,
    archived: a.archivedAt !== null,
  }));

  // Year dropdown: current year back through the oldest data (min 6 years back),
  // so backfilling an arbitrary past month is always possible.
  const cy = Number(currentMonth.slice(0, 4));
  const minYear = Math.min(cy - 5, dash.firstLogged ? Number(dash.firstLogged.slice(0, 4)) : cy);
  const yearOptions: number[] = [];
  for (let y = cy; y >= minYear; y--) yearOptions.push(y);

  const last = dash.months.length - 1;
  const hasData = last >= 0 && dash.stats !== null;

  return (
    <Container maxWidth="md" sx={{ py: { xs: 4, md: 6 } }}>
      <Stack
        direction="row"
        alignItems="flex-start"
        justifyContent="space-between"
        spacing={2}
        sx={{ mb: 2, flexWrap: "wrap", rowGap: 2 }}
      >
        <Stack spacing={0.5}>
          <Typography variant="h3" component="h1">
            Net Worth
          </Typography>
          <Typography variant="h6" component="p" color="text.secondary" fontWeight={400}>
            Balances across your accounts
          </Typography>
        </Stack>
        {editor ? (
          <NetWorthActions
            snapshotAccounts={snapshotAccounts}
            allAccounts={managedAccounts}
            logMonth={logMonth}
            balancesByMonth={dash.balancesByMonth}
            yearOptions={yearOptions}
          />
        ) : null}
      </Stack>

      {hasData ? (
        <Stack direction="row" sx={{ mb: 2 }}>
          <NetWorthRangePicker current={range} />
        </Stack>
      ) : null}

      {editor && dash.dueMonth && snapshotAccounts.length > 0 ? (
        <DueMonthBanner
          month={dash.dueMonth}
          accounts={snapshotAccounts}
          balancesByMonth={dash.balancesByMonth}
          yearOptions={yearOptions}
        />
      ) : null}

      {!hasData || !dash.stats ? (
        <Paper variant="outlined" sx={{ p: 5, textAlign: "center" }}>
          <SavingsOutlinedIcon sx={{ fontSize: 44, color: "text.disabled", mb: 1 }} />
          <Typography color="text.secondary">
            {snapshotAccounts.length === 0
              ? editor
                ? "Start with Accounts — add the places your money lives, then log your first month."
                : "No financial accounts set up yet."
              : editor
                ? "Accounts are ready — hit Log balances to record your first month."
                : "No balances logged yet."}
          </Typography>
        </Paper>
      ) : (
        <>
          <NetWorthTiles
            stats={dash.stats}
            startMonth={dash.months[0]}
            rangeLabel={rangeLabel(range)}
          />

          <NetWorthOverview
            range={range}
            months={dash.months}
            windowStart={dash.windowStart}
            accounts={windowAccounts}
            balances={dash.balances}
            totals={dash.totals}
            contributions={dash.contributions}
            flows={dash.flows}
          />

          <NetWorthInsights
            latestMonth={dash.months[last]}
            latestTotal={dash.totals[last]}
            pace={dash.pace}
            runway={extras.runway}
            today={today}
          />

          <MonthlyLog
            months={dash.months}
            windowStart={dash.windowStart}
            accounts={windowAccounts.map((a) => ({ id: a.id, name: a.name }))}
            balances={dash.balances}
            totals={dash.totals}
            missingMonths={dash.missingMonths}
            balancesByMonth={dash.balancesByMonth}
            yearOptions={yearOptions}
            editor={editor}
          />
        </>
      )}
    </Container>
  );
}
