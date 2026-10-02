"use client";

import * as React from "react";
import { LineChart, lineClasses } from "@mui/x-charts/LineChart";
import { PieChart } from "@mui/x-charts/PieChart";
import { SparkLineChart } from "@mui/x-charts/SparkLineChart";
import { ChartsReferenceLine } from "@mui/x-charts/ChartsReferenceLine";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import ButtonBase from "@mui/material/ButtonBase";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import { useTheme } from "@mui/material/styles";
import {
  formatMoney,
  formatMoneyCompact,
  formatMoneyDelta,
  formatMoneySigned,
  formatMoneyShort,
  formatMonth,
} from "@/lib/format";
import {
  KIND_LABELS,
  TYPE_ORDER,
  accountStats,
  typeOfKind,
  type NetWorthRange,
} from "@/lib/finance/net-worth";
import type { AccountContributions } from "@/lib/queries/finance-networth";
import Money from "./Money";
import AccountDetail, { type DetailAccount } from "./AccountDetail";

const noopSubscribe = () => () => {};
function useMounted() {
  return React.useSyncExternalStore(noopSubscribe, () => true, () => false);
}

const chartColor = (i: number) => `var(--chart-${(i % 8) + 1})`;
const tone = (n: number | null | undefined) =>
  n == null || n === 0 ? "text.secondary" : n > 0 ? "success.main" : "warning.main";

type Slice = {
  key: string;
  label: string;
  sub: string;
  color: string;
  value: number | null; // balance at the month in view
  change: number | null; // vs the starting point
  trend: number[];
  accountId?: number;
};

// The Net Worth overview: how it grew (or how bank saved tracks its goal),
// then where it lives at one month as a donut whose list doubles as the
// legend. Tapping a month on the chart moves the donut to that month; tapping
// an account opens its detail sheet.
export default function NetWorthOverview({
  range,
  months,
  windowStart,
  accounts,
  balances,
  totals,
  bank,
  kept,
  contributions,
}: {
  range: NetWorthRange;
  months: string[];
  windowStart: number;
  accounts: DetailAccount[];
  balances: Record<number, (number | null)[]>;
  totals: number[];
  bank: {
    names: string[];
    cumulative: (number | null)[];
    goal: (number | null)[];
    monthlyGoal: number | null;
  };
  kept: { kept: number; from: string; to: string } | null;
  contributions: Record<number, AccountContributions>;
}) {
  const mounted = useMounted();
  const theme = useTheme();
  const last = months.length - 1;
  const [sel, setSel] = React.useState(last);
  const [view, setView] = React.useState<"total" | "bank">("total");
  const [group, setGroup] = React.useState<"accounts" | "types">("accounts");
  const [hover, setHover] = React.useState<number | null>(null);
  const [openId, setOpenId] = React.useState<number | null>(null);
  const at = Math.min(sel, last);

  const x = React.useMemo(() => months.map((m) => new Date(`${m.slice(0, 7)}-01T12:00:00`)), [months]);
  const spansYears = new Set(months.map((m) => m.slice(0, 4))).size > 1;
  // Ticks name the year only at January ("Jan '26"), so "Jan 26" never reads as a date.
  const tickFormat = (d: Date, ctx: { location: string }) => {
    if (ctx.location !== "tick") return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    const mon = d.toLocaleDateString("en-US", { month: "short" });
    return spansYears && d.getMonth() === 0 ? `${mon} '${String(d.getFullYear()).slice(2)}` : mon;
  };

  const rangePhrase =
    windowStart === 1 && range === "year"
      ? "this year"
      : windowStart === 1 && range === "12mo"
        ? "over 12 months"
        : `since ${formatMonth(months[0])}`;

  const colorOf = new Map(accounts.map((a, i) => [a.id, chartColor(i)]));
  const total = totals[at] ?? 0;
  const shareOf = (v: number | null) => (v != null && total > 0 ? Math.round((v / total) * 100) : null);

  const accountSlices: Slice[] = accounts.map((a) => {
    const series = balances[a.id] ?? [];
    const s = accountStats(months, series, totals, at);
    const share = shareOf(s.end);
    return {
      key: `a${a.id}`,
      label: a.name,
      sub: [KIND_LABELS[a.kind] ?? a.kind, share != null ? `${share < 1 && s.end ? "<1" : share}%` : null]
        .filter(Boolean)
        .join(" · "),
      color: colorOf.get(a.id)!,
      value: s.end,
      change: s.change,
      trend: series.map((v) => v ?? 0),
      accountId: a.id,
    };
  });

  const typeSlices: Slice[] = TYPE_ORDER.flatMap((type, ti) => {
    const members = accounts.filter((a) => typeOfKind(a.kind) === type);
    if (!members.length) return [];
    const sumAt = (i: number) => members.reduce((s, a) => s + (balances[a.id]?.[i] ?? 0), 0);
    const value = sumAt(at);
    const share = shareOf(value);
    return [
      {
        key: type,
        label: type,
        sub: [`${members.length} account${members.length === 1 ? "" : "s"}`, share != null ? `${share < 1 && value ? "<1" : share}%` : null]
          .filter(Boolean)
          .join(" · "),
        color: chartColor(ti),
        value,
        change: at > 0 ? Math.round((value - sumAt(0)) * 100) / 100 : null,
        trend: months.map((_, i) => sumAt(i)),
      },
    ];
  });

  const slices = group === "accounts" ? accountSlices : typeSlices;
  const ring = slices.filter((s) => (s.value ?? 0) > 0);
  const open = openId != null ? accounts.find((a) => a.id === openId) : undefined;

  const primary = theme.vars?.palette.primary.main ?? theme.palette.primary.main;
  const muted = theme.vars?.palette.text.secondary ?? theme.palette.text.secondary;
  const fromPay = Object.values(contributions).reduce((s, c) => s + c.cumulative[last], 0);
  const payNames = accounts.filter((a) => contributions[a.id]).map((a) => a.name);
  const goalLine = bank.goal.map((g, i) => (i === 0 && bank.goal.some((v) => v != null) ? 0 : g));
  const bankLine = bank.cumulative.map((v, i) => (i === 0 ? 0 : v));

  return (
    <>
      <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2.5 }, mb: 2 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ flexWrap: "wrap", gap: 1 }}>
          <Typography variant="h6">{view === "total" ? "Growth" : "Bank saved vs goal"}</Typography>
          {bank.names.length ? (
            <ToggleButtonGroup
              size="small"
              exclusive
              value={view}
              onChange={(_, v: "total" | "bank" | null) => v && setView(v)}
            >
              <ToggleButton value="total" sx={{ px: 1.5, py: 0.4 }}>
                Total
              </ToggleButton>
              <ToggleButton value="bank" sx={{ px: 1.5, py: 0.4 }}>
                Bank saved
              </ToggleButton>
            </ToggleButtonGroup>
          ) : null}
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {view === "total"
            ? "Tap a month to see where it was."
            : `${bank.names.join(" + ")}${bank.monthlyGoal ? ` against ${formatMoney(bank.monthlyGoal)}/mo` : ""}`}
        </Typography>

        <Box sx={{ minHeight: 240 }}>
          {mounted ? (
            <LineChart
              height={240}
              xAxis={[{ data: x, scaleType: "time", valueFormatter: tickFormat }]}
              yAxis={[
                {
                  min: view === "total" ? 0 : undefined,
                  valueFormatter: (v: number) => formatMoneyCompact(v),
                  width: 56,
                },
              ]}
              series={
                view === "total"
                  ? [
                      {
                        id: "total",
                        label: "Net worth",
                        data: totals,
                        color: primary,
                        area: true,
                        showMark: false,
                        curve: "monotoneX",
                        valueFormatter: (v) => formatMoney(v ?? 0),
                      },
                    ]
                  : [
                      {
                        id: "bank",
                        label: "Bank saved",
                        data: bankLine,
                        color: "var(--chart-3)",
                        showMark: false,
                        connectNulls: true,
                        curve: "monotoneX",
                        valueFormatter: (v) => (v == null ? "—" : formatMoneySigned(v)),
                      },
                      {
                        id: "goal",
                        label: "Goal",
                        data: goalLine,
                        color: muted,
                        showMark: false,
                        connectNulls: true,
                        valueFormatter: (v) => (v == null ? "—" : formatMoney(v)),
                      },
                    ]
              }
              hideLegend={view === "total"}
              onAxisClick={(_, d) => {
                if (d) setSel(d.dataIndex);
              }}
              margin={{ top: 8, right: 20, bottom: 4, left: 4 }}
              sx={{
                cursor: "pointer",
                [`& .${lineClasses.area}`]: { opacity: 0.18 },
                [`& .${lineClasses.line}[data-series="goal"]`]: { strokeDasharray: "6 4" },
              }}
            >
              {at !== last ? (
                <ChartsReferenceLine x={x[at]} lineStyle={{ stroke: muted, strokeDasharray: "2 3" }} />
              ) : null}
            </LineChart>
          ) : null}
        </Box>

        {view === "total" && fromPay > 0 && last > 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Of the {formatMoneyDelta(totals[last] - totals[0])} {rangePhrase},{" "}
            <strong>{formatMoneyDelta(fromPay)}</strong> went straight from paychecks into{" "}
            {payNames.join(" and ")}.
          </Typography>
        ) : null}

        {view === "bank" && kept && bank.cumulative[last] != null ? (
          <Box sx={{ mt: 1.5, p: 1.5, borderRadius: 1, bgcolor: "action.hover" }}>
            <Typography variant="body2">
              The budget kept <strong>{formatMoneySigned(kept.kept)}</strong> from {formatMonth(kept.from)} to{" "}
              {formatMonth(kept.to)}. Bank saved changed <strong>{formatMoneySigned(bank.cumulative[last])}</strong>.
            </Typography>
            <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.5 }}>
              The difference is money that moved without a budget transaction: transfers into
              investments, Venmo or cash spending, and interest.
            </Typography>
          </Box>
        ) : null}
      </Paper>

      <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2.5 }, mb: 2 }}>
        <Stack direction="row" alignItems="flex-start" justifyContent="space-between" sx={{ flexWrap: "wrap", gap: 1, mb: 1.5 }}>
          <Box>
            <Typography variant="h6">Where it lives</Typography>
            <Typography variant="body2" color="text.secondary">
              End of {formatMonth(months[at])}
              {at !== last ? (
                <Button size="small" onClick={() => setSel(last)} sx={{ ml: 1, py: 0, minWidth: 0 }}>
                  Show latest
                </Button>
              ) : null}
            </Typography>
          </Box>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={group}
            onChange={(_, v: "accounts" | "types" | null) => {
              if (v) {
                setGroup(v);
                setHover(null);
              }
            }}
          >
            <ToggleButton value="accounts" sx={{ px: 1.5, py: 0.4 }}>
              Accounts
            </ToggleButton>
            <ToggleButton value="types" sx={{ px: 1.5, py: 0.4 }}>
              Types
            </ToggleButton>
          </ToggleButtonGroup>
        </Stack>

        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", sm: "200px minmax(0, 1fr)" },
            gap: { xs: 1.5, sm: 3 },
            alignItems: "center",
          }}
        >
          <Box sx={{ position: "relative", width: 200, height: 200, justifySelf: "center" }}>
            {mounted ? (
              <PieChart
                width={200}
                height={200}
                hideLegend
                margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
                highlightedItem={hover == null ? null : { seriesId: "where", dataIndex: hover }}
                onHighlightChange={(item) => setHover(item?.dataIndex ?? null)}
                onItemClick={(_, item) => {
                  const id = ring[item.dataIndex]?.accountId;
                  if (id != null) setOpenId(id);
                }}
                series={[
                  {
                    id: "where",
                    innerRadius: 62,
                    outerRadius: 96,
                    paddingAngle: 1.5,
                    cornerRadius: 3,
                    highlightScope: { highlight: "item", fade: "global" },
                    faded: { additionalRadius: -3 },
                    valueFormatter: (v) => formatMoney(v.value),
                    data: ring.map((s, i) => ({ id: i, value: s.value ?? 0, label: s.label, color: s.color })),
                  },
                ]}
                sx={group === "accounts" ? { cursor: "pointer" } : undefined}
              />
            ) : null}
            <Box
              sx={{
                position: "absolute",
                inset: 0,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                pointerEvents: "none",
              }}
            >
              <Typography variant="h6" component="div" sx={{ lineHeight: 1.1 }}>
                {formatMoneyShort(total)}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                net worth
              </Typography>
            </Box>
          </Box>

          <Stack>
            {slices.map((s) => {
              const ringIndex = ring.findIndex((r) => r.key === s.key);
              const lit = hover != null && hover === ringIndex;
              const clickable = s.accountId != null;
              return (
                <ButtonBase
                  key={s.key}
                  disabled={!clickable}
                  onClick={clickable ? () => setOpenId(s.accountId!) : undefined}
                  onMouseEnter={() => setHover(ringIndex >= 0 ? ringIndex : null)}
                  onMouseLeave={() => setHover(null)}
                  sx={{
                    display: "grid",
                    gridTemplateColumns: "10px minmax(0, 1fr) 64px auto",
                    alignItems: "center",
                    gap: 1.25,
                    px: 0.75,
                    py: 0.9,
                    borderRadius: 1,
                    textAlign: "left",
                    bgcolor: lit ? "action.hover" : undefined,
                    "&.Mui-disabled": { pointerEvents: "auto", color: "inherit" },
                  }}
                >
                  <Box sx={{ width: 10, height: 10, borderRadius: 0.5, bgcolor: s.color }} />
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="body2" fontWeight={600} noWrap>
                      {s.label}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" noWrap component="div">
                      {s.sub}
                    </Typography>
                  </Box>
                  <Box sx={{ height: 24 }} aria-hidden>
                    {mounted && s.trend.length > 1 ? (
                      <SparkLineChart data={s.trend} height={24} width={64} color={s.color} curve="monotoneX" />
                    ) : null}
                  </Box>
                  <Box sx={{ textAlign: "right", minWidth: 64 }}>
                    <Typography variant="body2" fontWeight={600}>
                      {s.value == null ? "—" : <Money value={s.value} />}
                    </Typography>
                    {s.change != null ? (
                      <Typography variant="caption" sx={{ color: tone(s.change) }} component="div">
                        <Money value={s.change} signed />
                      </Typography>
                    ) : null}
                  </Box>
                </ButtonBase>
              );
            })}
          </Stack>
        </Box>
        <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1.5 }}>
          Changes are {rangePhrase}
          {at !== last ? `, through ${formatMonth(months[at])}` : ""}.
          {group === "accounts" ? " Tap an account for its details." : ""}
        </Typography>
      </Paper>

      {open ? (
        <AccountDetail
          account={open}
          color={colorOf.get(open.id)!}
          months={months}
          balances={balances[open.id] ?? []}
          totals={totals}
          rangePhrase={rangePhrase}
          contributions={contributions[open.id]}
          onClose={() => setOpenId(null)}
        />
      ) : null}
    </>
  );
}
