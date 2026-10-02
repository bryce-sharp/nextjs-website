import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import { formatMoneyDelta, formatMonth } from "@/lib/format";
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
}: {
  stats: NetWorthStats;
  /** The window's starting point (YYYY-MM-01) growth is measured from. */
  startMonth: string;
  rangeLabel: string;
}) {
  const elapsed = monthDiff(startMonth, stats.currentMonth);
  // Rounded to cents like the outlook's pace, so the two never differ by a dollar.
  const perMonth =
    stats.rangeChange != null && elapsed > 0 ? Math.round((stats.rangeChange / elapsed) * 100) / 100 : null;

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
        label="Cash"
        value={<Money value={stats.cashTotal} />}
        sub={
          stats.cashChange != null
            ? `checking and savings, ${formatMoneyDelta(stats.cashChange)} since ${formatMonth(startMonth)}`
            : "checking and savings"
        }
      />
      <Tile
        label="Per month"
        value={perMonth == null ? "—" : <Money value={perMonth} signed />}
        color={deltaColor(perMonth)}
        sub={elapsed > 0 ? `average over ${elapsed} month${elapsed === 1 ? "" : "s"}` : undefined}
      />
    </Box>
  );
}
