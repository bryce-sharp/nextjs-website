"use client";

import * as React from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { BarChart, type BarSeries } from "@mui/x-charts/BarChart";
import {
  ChartsTooltipCell,
  ChartsTooltipContainer,
  ChartsTooltipPaper,
  ChartsTooltipRow,
  ChartsTooltipTable,
  chartsTooltipClasses as tc,
  useAxesTooltip,
  type ChartsTooltipProps,
} from "@mui/x-charts/ChartsTooltip";
import { ChartsLabelMark } from "@mui/x-charts/ChartsLabel";
import Paper from "@mui/material/Paper";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import Divider from "@mui/material/Divider";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import type { Flow } from "@/lib/finance/cashflow";
import type { MonthReport as MonthReportData } from "@/lib/finance/month-report";
import MonthReport from "./MonthReport";
import { MoreDetails } from "./BudgetAnalytics";
import { formatCashFlow, formatMoney, formatMoneyCompact, formatMoneySigned } from "@/lib/format";
import SpendByTag, { type TagSpendRow } from "./SpendByTag";
import { CASHFLOW_COLORS, dimmed } from "./chartColors";

export type MonthFlowRow = { month: string; moneyIn: number; moneyOut: number };

const noopSubscribe = () => () => {};
function useMounted() {
  return React.useSyncExternalStore(noopSubscribe, () => true, () => false);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// The month's hover card: income and spending exactly as the default axis
// tooltip draws them, plus what the month kept (in − out) underneath, so the
// shape of each month reads at a glance.
function MonthTooltipContent() {
  const month = useAxesTooltip({ directions: ["x"] })?.[0];
  if (!month) return null;
  const value = (id: string) => Number(month.seriesItems.find((s) => s.seriesId === id)?.value ?? 0);
  const kept = value("in") - value("out");
  // A Type filter leaves one side charted, and "kept" needs both.
  const showKept = month.seriesItems.length > 1;
  return (
    <ChartsTooltipPaper className={tc.paper}>
      <ChartsTooltipTable className={tc.table}>
        <Typography component="caption">{month.axisFormattedValue}</Typography>
        <tbody>
          {month.seriesItems.map((s) => (
            <ChartsTooltipRow key={s.seriesId} className={tc.row}>
              <ChartsTooltipCell component="th" className={`${tc.labelCell} ${tc.cell}`}>
                <div className={tc.markContainer}>
                  <ChartsLabelMark type={s.markType} color={s.color} className={tc.mark} />
                </div>
                {s.formattedLabel}
              </ChartsTooltipCell>
              <ChartsTooltipCell component="td" className={`${tc.valueCell} ${tc.cell}`}>{s.formattedValue}</ChartsTooltipCell>
            </ChartsTooltipRow>
          ))}
          {showKept ? (
            <ChartsTooltipRow className={tc.row}>
              <ChartsTooltipCell
                component="th"
                className={`${tc.labelCell} ${tc.cell}`}
                sx={{ borderTop: 1, borderColor: "divider", fontWeight: 600 }}
              >
                Kept
              </ChartsTooltipCell>
              <ChartsTooltipCell
                component="td"
                className={`${tc.valueCell} ${tc.cell}`}
                // "&&" outranks the tooltip table's own value-cell color rule.
                sx={{ borderTop: 1, borderColor: "divider", fontWeight: 600, "&&": { color: kept < 0 ? "warning.main" : undefined } }}
              >
                {formatMoneySigned(kept)}
              </ChartsTooltipCell>
            </ChartsTooltipRow>
          ) : null}
        </tbody>
      </ChartsTooltipTable>
    </ChartsTooltipPaper>
  );
}

function MonthTooltip(props: ChartsTooltipProps) {
  return (
    <ChartsTooltipContainer {...props} trigger="axis">
      <MonthTooltipContent />
    </ChartsTooltipContainer>
  );
}

const monthName = (iso: string, withYear: boolean) =>
  `${MONTHS[Number(iso.slice(5, 7)) - 1]}${withYear ? ` ${iso.slice(0, 4)}` : ""}`;

// History's top card: income vs money out per month across the filtered range
// (Chase's "spending by month"), then where it went (or came from) by tag — for
// the whole range, or one month once you tap its bars. Month (?m=YYYY-MM) and
// a tapped tag (?tag=…&tagflow=out|in) live in the URL, so the transaction
// list below follows both.
export default function CashFlowHistory({
  months,
  selected,
  rangeLabel,
  rangeTags,
  drillTags,
  rangeIncomeTags,
  drillIncomeTags,
  tag,
  tagFlow,
  report,
  reportInProgress,
  reportCaption,
  lockedFlow,
}: {
  months: MonthFlowRow[];
  selected: string | null; // YYYY-MM-01
  rangeLabel: string;
  rangeTags: TagSpendRow[];
  drillTags: TagSpendRow[];
  rangeIncomeTags: TagSpendRow[];
  drillIncomeTags: TagSpendRow[];
  tag: string | null; // the tapped tag key filtering the list
  tagFlow: Flow;
  report: MonthReportData | null; // the selected month (or the timeframe) vs its plan
  reportInProgress: boolean;
  reportCaption?: string; // what a timeframe report covers
  lockedFlow?: Flow | null; // a Type filter pins the whole card to one side
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const mounted = useMounted();
  const [pickedView, setView] = React.useState<Flow>(tagFlow);
  const view = lockedFlow ?? pickedView;
  const flowText = (moneyIn: number, moneyOut: number) =>
    lockedFlow === "in"
      ? `In ${formatMoney(moneyIn)}`
      : lockedFlow === "out"
        ? `Out ${formatMoney(moneyOut)}`
        : formatCashFlow(moneyIn, moneyOut);

  const spansYears = new Set(months.map((m) => m.month.slice(0, 4))).size > 1;
  const selIndex = selected ? months.findIndex((m) => m.month === selected) : -1;
  const sel = selIndex >= 0 ? months[selIndex] : null;
  const totalIn = months.reduce((s, m) => s + m.moneyIn, 0);
  const totalOut = months.reduce((s, m) => s + m.moneyOut, 0);

  function go(p: URLSearchParams) {
    const qs = p.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  function select(month: string | null) {
    const p = new URLSearchParams(params.toString());
    if (month && month !== selected) p.set("m", month.slice(0, 7));
    else p.delete("m");
    go(p);
  }

  // Tap a tag to list its transactions below; tap it again to clear.
  function pickTag(key: string) {
    const p = new URLSearchParams(params.toString());
    if (tag === key && tagFlow === view) {
      p.delete("tag");
      p.delete("tagflow");
    } else {
      p.set("tag", key);
      p.set("tagflow", view);
      document.getElementById("transactions")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    go(p);
  }

  const income = view === "in";
  const breakdown = income ? (sel ? drillIncomeTags : rangeIncomeTags) : sel ? drillTags : rangeTags;
  const stable = (income ? rangeIncomeTags : rangeTags).map((r) => r.tag);

  const tone = (c: string) => (index: number) => (selIndex < 0 || index === selIndex ? c : dimmed(c));
  const toneIn = tone(CASHFLOW_COLORS.income);
  const toneOut = tone(CASHFLOW_COLORS.spending);
  const barSeries: BarSeries[] = [
    {
      id: "in",
      label: "Income",
      data: months.map((m) => m.moneyIn),
      color: CASHFLOW_COLORS.income,
      colorGetter: ({ dataIndex }) => toneIn(dataIndex),
      valueFormatter: (v) => formatMoney(v ?? 0),
    },
    {
      id: "out",
      label: "Spending",
      data: months.map((m) => m.moneyOut),
      color: CASHFLOW_COLORS.spending,
      colorGetter: ({ dataIndex }) => toneOut(dataIndex),
      valueFormatter: (v) => formatMoney(v ?? 0),
    },
  ];

  return (
    <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2.5 }, mb: 2 }}>
      <Typography variant="h6">Money in &amp; out</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        {rangeLabel} · {flowText(totalIn, totalOut)}
      </Typography>

      {months.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ py: 3 }}>
          Nothing in this range.
        </Typography>
      ) : mounted ? (
        <BarChart
          height={240}
          borderRadius={4}
          xAxis={[
            {
              data: months.map((m) => monthName(m.month, spansYears)),
              scaleType: "band",
              categoryGapRatio: 0.35,
              barGapRatio: 0.12,
            },
          ]}
          yAxis={[{ valueFormatter: (v: number) => formatMoneyCompact(v), width: 52 }]}
          series={barSeries.filter((s) => lockedFlow == null || s.id === lockedFlow)}
          onAxisClick={(_, d) => {
            if (d) select(months[d.dataIndex]?.month ?? null);
          }}
          slots={{ tooltip: MonthTooltip }}
          margin={{ top: 8, right: 8, bottom: 4, left: 4 }}
          sx={{ cursor: "pointer" }}
        />
      ) : (
        <Box sx={{ height: 240 }} aria-hidden />
      )}

      <Divider sx={{ my: 2 }} />

      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        spacing={1}
        sx={{ mb: 1.5, flexWrap: "wrap", rowGap: 1 }}
      >
        <Box>
          <Typography variant="subtitle1" fontWeight={600}>
            {/* A Type filter already names its side inside rangeLabel. */}
            {sel ? monthName(sel.month, true) : rangeLabel}
            {lockedFlow && !sel ? "" : income ? " income" : " spending"} by tag
          </Typography>
          {sel ? (
            <Typography variant="body2" color="text.secondary">
              {flowText(sel.moneyIn, sel.moneyOut)}
            </Typography>
          ) : null}
        </Box>
        <Box sx={{ flexGrow: 1 }} />
        {lockedFlow == null ? (
          <ToggleButtonGroup
            exclusive
            size="small"
            value={view}
            onChange={(_, v: Flow | null) => v && setView(v)}
            aria-label="Breakdown"
          >
            <ToggleButton value="out" sx={{ px: 1.5, py: 0.25 }}>
              Spending
            </ToggleButton>
            <ToggleButton value="in" sx={{ px: 1.5, py: 0.25 }}>
              Income
            </ToggleButton>
          </ToggleButtonGroup>
        ) : null}
        {/* The chart's keyboard- and phone-friendly twin for picking a month. */}
        <TextField
          select
          size="small"
          label="Month"
          value={sel ? sel.month : ""}
          onChange={(e) => select(e.target.value || null)}
          sx={{ minWidth: 150 }}
          slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
        >
          <MenuItem value="">All months</MenuItem>
          {[...months].reverse().map((m) => (
            <MenuItem key={m.month} value={m.month}>
              {monthName(m.month, true)}
            </MenuItem>
          ))}
        </TextField>
      </Stack>

      <SpendByTag
        rows={breakdown}
        stableOrder={stable}
        selected={tagFlow === view ? tag : null}
        onSelect={pickTag}
        centerLabel={income ? "came in" : "spent"}
        emptyText={income ? "No income in this period." : "No spending in this period."}
      />

      {/* The budget report — the selected month's, else the whole timeframe
          summed — tucked away like the Budget page's. */}
      {report ? (
        <Box sx={{ mt: 1.5 }}>
          <MoreDetails>
            {reportCaption && !sel ? (
              <Typography variant="caption" color="text.secondary">
                {reportCaption}
              </Typography>
            ) : null}
            <MonthReport report={report} inProgress={sel ? reportInProgress : false} />
          </MoreDetails>
        </Box>
      ) : null}
    </Paper>
  );
}
