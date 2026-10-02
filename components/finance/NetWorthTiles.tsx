import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import LinearProgress from "@mui/material/LinearProgress";
import { formatMoney, formatMoneyWhole, formatMonth } from "@/lib/format";
import { monthDiff } from "@/lib/finance/net-worth";
import type { NetWorthStats } from "@/lib/queries/finance-networth";
import Money from "./Money";

// Server component — the top-of-page stat grid (weight-app Tile composition).
function Tile({
  label,
  value,
  sub,
  color,
  children,
}: {
  label: string;
  value?: React.ReactNode;
  sub?: React.ReactNode;
  color?: string;
  children?: React.ReactNode;
}) {
  return (
    <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2 }, minWidth: 0 }}>
      <Typography
        variant="caption"
        color="text.secondary"
        noWrap
        component="div"
        sx={{ textTransform: "uppercase", letterSpacing: "0.04em" }}
      >
        {label}
      </Typography>
      {value != null ? (
        <Typography variant="h5" component="div" sx={{ mt: 0.5, color, whiteSpace: "nowrap" }}>
          {value}
        </Typography>
      ) : null}
      {sub ? (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
          {sub}
        </Typography>
      ) : null}
      {children}
    </Paper>
  );
}

const deltaColor = (n: number | null) =>
  n == null || n === 0 ? undefined : n > 0 ? "success.main" : "warning.main";

export default function NetWorthTiles({
  stats,
  startMonth,
  rangeLabel,
  activeGoal,
  editor,
}: {
  stats: NetWorthStats;
  /** The window's starting point (YYYY-MM-01) growth is measured from. */
  startMonth: string;
  rangeLabel: string;
  /** The open-ended goal segment, if any — used to explain a missing goal line. */
  activeGoal: { monthlyGoal: number; startMonth: string } | null;
  editor: boolean;
}) {
  const goalPct =
    stats.bankCumulative != null && stats.bankGoalToDate != null && stats.bankGoalToDate > 0
      ? (stats.bankCumulative / stats.bankGoalToDate) * 100
      : null;
  const elapsed = monthDiff(startMonth, stats.currentMonth);
  const perMonth = stats.rangeChange != null && elapsed > 0 ? stats.rangeChange / elapsed : null;

  return (
    <Box
      sx={{
        display: "grid",
        gap: 1.5,
        gridTemplateColumns: { xs: "repeat(2, minmax(0, 1fr))", md: "repeat(4, minmax(0, 1fr))" },
        mb: 2,
      }}
    >
      <Tile
        label="Net worth"
        value={<Money value={stats.currentTotal} />}
        sub={`end of ${formatMonth(stats.currentMonth)}`}
      />
      <Tile
        label={rangeLabel}
        value={stats.rangeChange == null ? "—" : <Money value={stats.rangeChange} signed />}
        color={deltaColor(stats.rangeChange)}
        sub={
          stats.rangeChangePct != null
            ? `${stats.rangeChangePct >= 0 ? "+" : "−"}${Math.abs(stats.rangeChangePct).toFixed(1)}% since ${formatMonth(startMonth)}`
            : undefined
        }
      />
      <Tile
        label="Bank saved"
        value={stats.bankCumulative == null ? "—" : <Money value={stats.bankCumulative} signed />}
        color={
          stats.bankVsGoal == null ? undefined : stats.bankVsGoal >= 0 ? "success.main" : "warning.main"
        }
        sub={
          stats.bankGoalToDate != null && stats.bankVsGoal != null
            ? `${formatMoneyWhole(Math.abs(stats.bankVsGoal))} ${stats.bankVsGoal >= 0 ? "ahead of" : "behind"} the ${formatMoneyWhole(stats.bankGoalToDate)} goal`
            : // A goal can exist and still have no line here: it starts after the
              // last month logged (or after this whole window). Say which, so the
              // tile never contradicts the "Saving goal $X/mo" in the header.
              activeGoal
              ? `${formatMoney(activeGoal.monthlyGoal)}/mo goal starts ${formatMonth(activeGoal.startMonth)}`
              : editor
                ? "no savings goal yet — set one under Goal"
                : "no savings goal yet"
        }
      >
        {goalPct != null ? (
          <LinearProgress
            variant="determinate"
            value={Math.max(0, Math.min(100, goalPct))}
            color={goalPct >= 100 ? "success" : "primary"}
            sx={{ mt: 1, height: 6, borderRadius: 3 }}
          />
        ) : null}
      </Tile>
      <Tile
        label="Per month"
        value={perMonth == null ? "—" : <Money value={perMonth} signed />}
        color={deltaColor(perMonth)}
        sub={elapsed > 0 ? `average over ${elapsed} month${elapsed === 1 ? "" : "s"}` : undefined}
      />
    </Box>
  );
}
