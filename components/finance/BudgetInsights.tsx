"use client";

import * as React from "react";
import { usePathname, useSearchParams } from "next/navigation";
import Paper from "@mui/material/Paper";
import Box from "@mui/material/Box";
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
import { formatMoney, formatMoneySigned, formatDate } from "@/lib/format";

type Trend = {
  days: number[];
  thisMonth: (number | null)[];
  lastMonth: (number | null)[];
  thisLabel: string;
  lastLabel: string;
};

export type BudgetInsightsData = {
  trend: Trend;
  /** The discretionary budget; null when the month has no income to budget from. */
  budget: number | null;
  topPurchases: { merchant: string; amount: number; date: string }[];
  topMerchants: { merchant: string; total: number; count: number }[];
  details: BudgetAnalyticsData;
  /** The cash-flow view: every dollar in and out, never scored against the budget. */
  all: {
    moneyIn: number;
    moneyOut: number;
    trend: Trend;
    tags: TagSpendRow[];
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
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Box>
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
      <Stack spacing={0.75} sx={{ mt: 0.75 }}>
        {children}
      </Stack>
    </Box>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <Box sx={{ bgcolor: "action.hover", borderRadius: 1, px: 1.5, py: 1.25 }}>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600 }}
      >
        {label}
      </Typography>
      <Typography variant="h6" component="div">
        {value}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {sub}
      </Typography>
    </Box>
  );
}

// "All money": what actually moved this month — in, out, kept, the money-out
// curve vs last month, where it went by tag, and money out by type. The top-3
// pills drop here on purpose: rent and tithing would win them every month.
function AllMoney({ d }: { d: BudgetInsightsData["all"] }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const selected = params.get("tag");

  // Tapping a slice narrows the month's table below (?tag=…) with no reload —
  // replaceState keeps Next's router in sync without a server round trip.
  function pickTag(key: string) {
    const p = new URLSearchParams(params.toString());
    if (selected === key) {
      p.delete("tag");
    } else {
      p.set("tag", key);
      document.getElementById("transactions")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    const qs = p.toString();
    window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", sm: "repeat(3, minmax(0, 1fr))" },
          gap: 1,
          mt: 1.5,
        }}
      >
        <Tile label="Money in" value={formatMoney(d.moneyIn)} sub="income + reimbursements" />
        <Tile label="Money out" value={formatMoney(d.moneyOut)} sub="every dollar spent" />
        <Tile label="Kept" value={formatMoneySigned(d.moneyIn - d.moneyOut)} sub="in minus out" />
      </Box>

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
      <Column title="Where it went">
        <SpendByTag
          rows={d.tags}
          selected={selected}
          onSelect={pickTag}
          emptyText="No spending this month yet."
        />
      </Column>

      <Divider sx={{ my: 1.5 }} />
      <CashFlowDetails d={d.details} />
    </>
  );
}

// The default view: discretionary pace vs last month, the discretionary
// top-3s (uniform pills), and the granular numbers in an inline expander.
function DiscretionaryView({ d }: { d: BudgetInsightsData }) {
  const theme = useTheme();
  const tint = alpha(theme.palette.primary.main, 0.1);
  const hasTop = d.topPurchases.length > 0 || d.topMerchants.length > 0;

  return (
    <>
      {/* Spend vs last month */}
      <Box sx={{ mt: 1 }}>
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
      <Divider sx={{ my: 1.5 }} />
      <BudgetAnalytics d={d.details} />
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
