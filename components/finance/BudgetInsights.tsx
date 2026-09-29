"use client";

import * as React from "react";
import Paper from "@mui/material/Paper";
import Box from "@mui/material/Box";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Divider from "@mui/material/Divider";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import { useTheme, alpha } from "@mui/material/styles";
import InsightsIcon from "@mui/icons-material/Insights";
import SpendTrendChart from "./SpendTrendChart";
import SpendByTag, { type TagSpendRow } from "./SpendByTag";
import BudgetAnalytics, {
  CashFlowDetails,
  type BudgetAnalyticsData,
  type CashFlowDetailsData,
} from "./BudgetAnalytics";
import { useTableFilter } from "./useTableFilter";
import { LANE_LABELS, UNTAGGED } from "@/lib/finance/cashflow";
import { formatMoney, formatMoneySigned, formatDate } from "@/lib/format";

type Trend = {
  days: number[];
  thisMonth: (number | null)[];
  lastMonth: (number | null)[];
  thisLabel: string;
  lastLabel: string;
};

export type BudgetInsightsData = {
  month: string; // YYYY-MM-01, the viewed month
  trend: Trend;
  /** The discretionary budget; null when the month has no income to budget from. */
  budget: number | null;
  /** Discretionary spend today and over the last 7 days; null unless this is the current month. */
  lately: { today: number; last7: number } | null;
  /** Discretionary spend by tag (refunds netted), biggest first. */
  tags: TagSpendRow[];
  untagged: number; // untagged discretionary rows this month
  topPurchases: { merchant: string; amount: number; date: string }[];
  topMerchants: { merchant: string; total: number; count: number }[];
  details: BudgetAnalyticsData;
  /** The cash-flow view: every dollar in and out, never scored against the budget. */
  all: {
    moneyIn: number;
    moneyOut: number;
    trend: Trend;
    tags: TagSpendRow[];
    /** Money out by lane (keys are engine categories), biggest first. */
    types: TagSpendRow[];
    untagged: number; // untagged money-out rows this month
    details: CashFlowDetailsData;
  };
};

// A uniform full-width pill — same length for every row (Bryce: proportional
// bars read as noise here; the amount on the right already carries the size).
function PillRow({
  label,
  sub,
  value,
  tint,
}: {
  label: string;
  sub?: string;
  value: string;
  tint: string;
}) {
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 1,
        borderRadius: 1,
        bgcolor: tint,
        px: 1.25,
        py: 0.75,
        minHeight: 36,
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" noWrap fontWeight={600}>
          {label}
        </Typography>
        {sub ? (
          <Typography
            variant="caption"
            color="text.secondary"
            noWrap
            component="div"
          >
            {sub}
          </Typography>
        ) : null}
      </Box>
      <Typography
        variant="body2"
        fontWeight={700}
        sx={{ whiteSpace: "nowrap" }}
      >
        {value}
      </Typography>
    </Box>
  );
}

function Column({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode; // right-aligned beside the title
  children: React.ReactNode;
}) {
  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            fontWeight: 600,
          }}
        >
          {title}
        </Typography>
        {action}
      </Stack>
      <Stack spacing={0.75} sx={{ mt: 0.75 }}>
        {children}
      </Stack>
    </Box>
  );
}

type TileData = { label: string; value: string; sub: string; color?: string };

function Tile({ label, value, sub, color }: TileData) {
  return (
    <Box sx={{ bgcolor: "action.hover", borderRadius: 1, px: 1.5, py: 1.25 }}>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600 }}
      >
        {label}
      </Typography>
      <Typography variant="h6" component="div" sx={{ color }}>
        {value}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {sub}
      </Typography>
    </Box>
  );
}

function TileRow({ children }: { children: React.ReactNode }) {
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: { xs: "1fr", sm: "repeat(3, minmax(0, 1fr))" },
        gap: 1,
        mt: 1.5,
      }}
    >
      {children}
    </Box>
  );
}

// Untagged rows make the tag breakdown less useful, so say how many; tapping
// filters the table below to exactly those rows, where each can be tagged inline.
function UntaggedNudge({ count, lane }: { count: number; lane: string | null }) {
  const filter = useTableFilter();
  if (count === 0) return null;
  const active = filter.tag === UNTAGGED && filter.lane === lane;
  return (
    <Link
      component="button"
      type="button"
      variant="caption"
      underline="hover"
      onClick={() => filter.toggle(UNTAGGED, lane)}
      sx={{ alignSelf: "flex-start" }}
    >
      {active
        ? "Showing untagged below · show all"
        : `${count} untagged ${count === 1 ? "purchase" : "purchases"} · tag them below ↓`}
    </Link>
  );
}

function lastIndex(values: (number | null)[]): number {
  for (let i = values.length - 1; i >= 0; i--) if (values[i] != null) return i;
  return -1;
}

// Discretionary's three numbers — ones the Summary card above doesn't already
// show. Mid-month: today, the last week, and the gap to last month on the same
// day. Closed month: the daily average and biggest day instead.
function discretionaryTiles(d: BudgetInsightsData): TileData[] {
  const { thisMonth, lastMonth, lastLabel } = d.trend;
  const i = lastIndex(thisMonth);
  const spent = i >= 0 ? thisMonth[i]! : 0;
  const j = Math.min(i, lastIndex(lastMonth));
  const prior = j >= 0 ? lastMonth[j] : null;
  const diff = prior == null ? null : spent - prior;
  const vs: TileData = {
    label: `vs ${lastLabel}`,
    value: diff == null ? "—" : formatMoneySigned(diff),
    sub: `by day ${i + 1}`,
    color: diff == null || diff === 0 ? undefined : diff > 0 ? "warning.main" : "success.main",
  };

  if (d.lately) {
    return [
      { label: "Today", value: formatMoney(d.lately.today), sub: "so far today" },
      { label: "Last 7 days", value: formatMoney(d.lately.last7), sub: `~${formatMoney(d.lately.last7 / 7)}/day` },
      vs,
    ];
  }

  // Daily spend is the step between neighboring days of the cumulative line.
  let bigDay = 0;
  let bigAmount = 0;
  for (let k = 0; k <= i; k++) {
    const amount = (thisMonth[k] ?? 0) - (k > 0 ? (thisMonth[k - 1] ?? 0) : 0);
    if (amount > bigAmount) {
      bigAmount = amount;
      bigDay = k + 1;
    }
  }
  return [
    { label: "Daily average", value: formatMoney(i >= 0 ? spent / (i + 1) : 0), sub: `over ${i + 1} days` },
    {
      label: "Biggest day",
      value: bigAmount > 0 ? formatMoney(bigAmount) : "—",
      sub: bigAmount > 0 ? formatDate(`${d.month.slice(0, 8)}${String(bigDay).padStart(2, "0")}`) : "no spending",
    },
    vs,
  ];
}

// "All money": what actually moved this month — in, out, kept, the money-out
// curve vs last month, where it went (by tag, or by type: discretionary, bills,
// off-budget…), and the month against its plan. The top-3 pills drop here on
// purpose: rent and tithing would win them every month.
function AllMoney({ d }: { d: BudgetInsightsData["all"] }) {
  const { tag, lane, toggle } = useTableFilter();
  const [by, setBy] = React.useState<"tag" | "type">(tag == null && lane != null ? "type" : "tag");

  return (
    <>
      <TileRow>
        <Tile label="Money in" value={formatMoney(d.moneyIn)} sub="income + reimbursements" />
        <Tile label="Money out" value={formatMoney(d.moneyOut)} sub="every dollar spent" />
        <Tile label="Kept" value={formatMoneySigned(d.moneyIn - d.moneyOut)} sub="in minus out" />
      </TileRow>

      <Box sx={{ mt: 2 }}>
        <Typography variant="caption" color="text.secondary">
          Money out so far — {d.trend.thisLabel} vs {d.trend.lastLabel}
        </Typography>
        <SpendTrendChart
          days={d.trend.days}
          thisMonth={d.trend.thisMonth}
          lastMonth={d.trend.lastMonth}
          thisLabel={d.trend.thisLabel}
          lastLabel={d.trend.lastLabel}
        />
      </Box>

      <Divider sx={{ my: 2 }} />
      <Column
        title="Where it went"
        action={
          <ToggleButtonGroup
            exclusive
            size="small"
            value={by}
            onChange={(_, v: "tag" | "type" | null) => v && setBy(v)}
            aria-label="Break down by"
          >
            <ToggleButton value="tag" sx={{ px: 1.25, py: 0.125 }}>
              Tag
            </ToggleButton>
            <ToggleButton value="type" sx={{ px: 1.25, py: 0.125 }}>
              Type
            </ToggleButton>
          </ToggleButtonGroup>
        }
      >
        {by === "tag" ? (
          <>
            <SpendByTag
              rows={d.tags}
              selected={lane == null ? tag : null}
              onSelect={(key) => toggle(key, null)}
              emptyText="No spending this month yet."
            />
            <UntaggedNudge count={d.untagged} lane={null} />
          </>
        ) : (
          <SpendByTag
            rows={d.types}
            labels={LANE_LABELS}
            selected={tag == null ? lane : null}
            onSelect={(key) => toggle(null, key)}
            emptyText="No spending this month yet."
          />
        )}
      </Column>

      <Divider sx={{ my: 1.5 }} />
      <CashFlowDetails d={d.details} />
    </>
  );
}

// The default view, laid out like All money: three numbers, discretionary pace
// vs last month, where it went by tag, the top-3s (uniform pills), and the
// granular numbers in an inline expander.
function DiscretionaryView({ d }: { d: BudgetInsightsData }) {
  const theme = useTheme();
  const tint = alpha(theme.palette.primary.main, 0.1);
  const hasTop = d.topPurchases.length > 0 || d.topMerchants.length > 0;
  const hasDetails = d.details.reimbursed > 0 || d.details.recentMonths.length > 0;
  const { tag, lane, toggle } = useTableFilter();

  return (
    <>
      <TileRow>
        {discretionaryTiles(d).map((t) => (
          <Tile key={t.label} {...t} />
        ))}
      </TileRow>

      {/* Spend vs last month */}
      <Box sx={{ mt: 2 }}>
        <Typography variant="caption" color="text.secondary">
          Spending so far — {d.trend.thisLabel} vs {d.trend.lastLabel}
        </Typography>
        <SpendTrendChart
          days={d.trend.days}
          thisMonth={d.trend.thisMonth}
          lastMonth={d.trend.lastMonth}
          thisLabel={d.trend.thisLabel}
          lastLabel={d.trend.lastLabel}
          budget={d.budget}
        />
      </Box>

      <Divider sx={{ my: 2 }} />
      <Column title="Where it went">
        <SpendByTag
          rows={d.tags}
          selected={lane === "discretionary" ? tag : null}
          onSelect={(key) => toggle(key, "discretionary")}
          emptyText="No discretionary spending this month yet."
        />
        <UntaggedNudge count={d.untagged} lane="discretionary" />
      </Column>

      {/* Discretionary top-3s — controllable spend (bills live in the Summary) */}
      {hasTop ? (
        <>
          <Divider sx={{ my: 2 }} />
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
              gap: 2,
            }}
          >
            {d.topPurchases.length > 0 ? (
              <Column title="Top purchases">
                {d.topPurchases.map((p, i) => (
                  <PillRow
                    key={`${p.merchant}-${i}`}
                    label={p.merchant}
                    sub={formatDate(p.date)}
                    value={formatMoney(p.amount)}
                    tint={tint}
                  />
                ))}
              </Column>
            ) : null}
            {d.topMerchants.length > 0 ? (
              <Column title="Top spots">
                {d.topMerchants.map((m, i) => (
                  <PillRow
                    key={`${m.merchant}-${i}`}
                    label={m.merchant}
                    sub={`${m.count} ${m.count === 1 ? "purchase" : "purchases"}`}
                    value={formatMoney(m.total)}
                    tint={tint}
                  />
                ))}
              </Column>
            ) : null}
          </Box>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: "block", mt: 1.5 }}
          >
            Discretionary only
          </Typography>
        </>
      ) : null}

      {/* The granular numbers, inline — not a third card */}
      {hasDetails ? (
        <>
          <Divider sx={{ my: 1.5 }} />
          <BudgetAnalytics d={d.details} />
        </>
      ) : null}
    </>
  );
}

// The Insights card — one card, two lenses: Discretionary (the default, "how
// much free money is left") and All money ("what actually moved").
export default function BudgetInsights({ d }: { d: BudgetInsightsData }) {
  const [view, setView] = React.useState<"disc" | "all">("disc");

  return (
    <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2.5 }, mb: 3 }}>
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        spacing={1}
        sx={{ mb: 0.5, flexWrap: "wrap", rowGap: 1 }}
      >
        <Stack direction="row" spacing={1} alignItems="center">
          <InsightsIcon fontSize="small" color="action" />
          <Typography variant="h6">Insights</Typography>
        </Stack>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={view}
          onChange={(_, v: "disc" | "all" | null) => v && setView(v)}
          aria-label="Insights view"
        >
          <ToggleButton value="disc" sx={{ px: 1.5, py: 0.25 }}>
            Discretionary
          </ToggleButton>
          <ToggleButton value="all" sx={{ px: 1.5, py: 0.25 }}>
            All money
          </ToggleButton>
        </ToggleButtonGroup>
      </Stack>

      {view === "all" ? <AllMoney d={d.all} /> : <DiscretionaryView d={d} />}
    </Paper>
  );
}
