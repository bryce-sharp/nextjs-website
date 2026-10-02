"use client";

import * as React from "react";
import { LineChart, lineClasses } from "@mui/x-charts/LineChart";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import DetailSheet from "@/components/shared/DetailSheet";
import {
  formatMoney,
  formatMoneyCompact,
  formatMoneyDelta,
  formatMoneyWhole,
  formatMonth,
} from "@/lib/format";
import { INVESTMENT_KINDS, KIND_LABELS, accountStats, changesOf } from "@/lib/finance/net-worth";
import type { AccountContributions, AccountFlows } from "@/lib/queries/finance-networth";

const noopSubscribe = () => () => {};
function useMounted() {
  return React.useSyncExternalStore(noopSubscribe, () => true, () => false);
}

export type DetailAccount = {
  id: number;
  name: string;
  kind: string;
  archived: boolean;
};

const tone = (n: number | null | undefined) =>
  n == null || n === 0 ? undefined : n > 0 ? "success.main" : "warning.main";

function Stat({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <Paper variant="outlined" sx={{ p: 1.5 }}>
      <Typography variant="caption" color="text.secondary" component="div">
        {label}
      </Typography>
      <Typography fontWeight={600} sx={{ color }}>
        {value}
        {sub ? (
          <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.75 }}>
            {sub}
          </Typography>
        ) : null}
      </Typography>
    </Paper>
  );
}

function Line({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <Box sx={{ display: "flex", justifyContent: "space-between", gap: 2, py: 0.5 }}>
      <Typography variant="body2">{label}</Typography>
      <Typography variant="body2" fontWeight={600} sx={{ color }}>
        {value}
      </Typography>
    </Box>
  );
}

const short = (m: string) => formatMonth(m).slice(0, 3);

// One account's story across the range: its balance line, how it moves per
// month, its share of the total, and every logged balance (newest first).
// Investment accounts split their growth into money put in (paycheck 401k/HSA
// money and transfers from your other accounts) vs everything else, with a
// dashed "money put in" line. Every account lists the income that landed in it.
export default function AccountDetail({
  account,
  color,
  months,
  balances,
  totals,
  rangePhrase,
  contributions,
  flows,
  onClose,
}: {
  account: DetailAccount;
  color: string;
  months: string[];
  balances: (number | null)[];
  totals: number[];
  rangePhrase: string; // "this year", "over 12 months", "since Dec 2025"
  contributions?: AccountContributions;
  flows?: AccountFlows;
  onClose: () => void;
}) {
  const mounted = useMounted();
  const s = accountStats(months, balances, totals);
  const changes = changesOf(months, balances);
  const x = months.map((m) => new Date(`${m.slice(0, 7)}-01T12:00:00`));
  const rows = months.map((_, i) => i).reverse();
  const last = months.length - 1;
  const investing = INVESTMENT_KINDS.includes(account.kind);

  // Every series counts from the account's first logged balance on.
  const firstIdx = balances.findIndex((v) => v != null);
  const since = (series: number[] | undefined) =>
    series && firstIdx >= 0 ? series[last] - series[firstIdx] : 0;
  const paid = since(contributions?.cumulative);
  const movedIn = since(flows?.movedIn);
  const movedOut = since(flows?.movedOut);
  const landed = flows?.landed ?? [];
  const landedTotal = landed.reduce((t, l) => t + l.amount, 0);
  const putIn = paid + movedIn - movedOut + landedTotal;
  const hasPutIn = paid !== 0 || movedIn !== 0 || movedOut !== 0 || landedTotal !== 0;
  const rest = s.change != null ? s.change - putIn : null;

  // The dashed line: where the balance would be on money put in alone.
  const putInLine =
    investing && hasPutIn && firstIdx >= 0
      ? months.map((_, i) => {
          if (i < firstIdx) return null;
          const at = (series: number[] | undefined) => (series ? series[i] - series[firstIdx] : 0);
          return balances[firstIdx]! + at(contributions?.cumulative) + at(flows?.movedIn) - at(flows?.movedOut);
        })
      : null;
  // With the dashed line, zoom in so the gap between the two lines reads.
  const lows = [...balances, ...(putInLine ?? [])].filter((v): v is number => v != null);
  const floor = putInLine && lows.length ? Math.max(0, Math.floor((Math.min(...lows) * 0.9) / 1000) * 1000) : undefined;

  const overline = [KIND_LABELS[account.kind] ?? account.kind, account.archived ? "Archived" : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <DetailSheet open onClose={onClose} overline={overline} title={account.name}>
      <Typography variant="h4" component="div" sx={{ fontWeight: 600 }}>
        {s.end == null ? "—" : formatMoneyWhole(s.end)}
      </Typography>
      {s.change != null ? (
        <Typography variant="body2" sx={{ color: tone(s.change) }}>
          {formatMoneyDelta(s.change)} {rangePhrase}
          {s.changePct != null ? ` (${s.changePct >= 0 ? "+" : "−"}${Math.abs(s.changePct).toFixed(1)}%)` : ""}
        </Typography>
      ) : null}

      <Box sx={{ minHeight: 200, mt: 1.5, mx: -1 }}>
        {mounted ? (
          <LineChart
            height={200}
            series={[
              {
                id: "balance",
                label: account.name,
                data: balances,
                color,
                area: true,
                showMark: false,
                connectNulls: true,
                curve: "monotoneX",
                valueFormatter: (v) => (v == null ? "—" : formatMoney(v)),
              },
              ...(putInLine
                ? [
                    {
                      id: "putin",
                      label: "Money put in only",
                      data: putInLine,
                      color: "var(--chart-other)",
                      showMark: false,
                      valueFormatter: (v: number | null) => (v == null ? "—" : formatMoney(v)),
                    },
                  ]
                : []),
            ]}
            xAxis={[
              {
                data: x,
                scaleType: "time",
                valueFormatter: (d: Date, ctx: { location: string }) =>
                  d.toLocaleDateString("en-US", ctx.location === "tick" ? { month: "short" } : { month: "long", year: "numeric" }),
              },
            ]}
            yAxis={[{ min: floor, valueFormatter: (v: number) => formatMoneyCompact(v), width: 52 }]}
            hideLegend={!putInLine}
            margin={{ top: 8, right: 12, bottom: 4, left: 4 }}
            sx={{
              [`& .${lineClasses.area}`]: { opacity: 0.2 },
              [`& .${lineClasses.line}[data-series="putin"]`]: { strokeDasharray: "6 4" },
            }}
          />
        ) : null}
      </Box>

      {investing && hasPutIn ? (
        <>
          <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1, mt: 2 }}>
            <Stat label="Money put in" value={formatMoneyDelta(putIn)} color={tone(putIn)} />
            <Stat label="Everything else" value={rest == null ? "—" : formatMoneyDelta(rest)} color={tone(rest)} />
          </Box>
          <Box sx={{ mt: 1 }}>
            {paid !== 0 ? <Line label="From paychecks" value={formatMoneyDelta(paid)} /> : null}
            {movedIn !== 0 ? <Line label="Moved in from your accounts" value={formatMoneyDelta(movedIn)} /> : null}
            {movedOut !== 0 ? <Line label="Moved out to your accounts" value={formatMoneyDelta(-movedOut)} /> : null}
            {landedTotal !== 0 ? <Line label="Income that landed here" value={formatMoneyDelta(landedTotal)} /> : null}
          </Box>
          <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.5 }}>
            {contributions && contributions.you + contributions.employer > 0
              ? `${contributions.names.join(" and ")} adds ${formatMoneyWhole(contributions.you + contributions.employer)}/mo${
                  contributions.employer > 0
                    ? ` (you ${formatMoneyWhole(contributions.you)}, employer ${formatMoneyWhole(contributions.employer)})`
                    : ""
                }. `
              : ""}
            Everything else is market growth, interest, fees, and anything not recorded.
          </Typography>
        </>
      ) : null}

      {!investing && (landed.length > 0 || movedIn !== 0 || movedOut !== 0) ? (
        <Box sx={{ mt: 2 }}>
          <Typography variant="subtitle2" color="text.secondary">
            Money that landed here
          </Typography>
          {landed.slice(0, 6).map((l) => (
            <Line key={l.tag ?? "untagged"} label={l.tag ?? "Untagged"} value={formatMoneyDelta(l.amount)} />
          ))}
          {landed.length > 6 ? (
            <Line
              label="Everything else"
              value={formatMoneyDelta(landed.slice(6).reduce((t, l) => t + l.amount, 0))}
            />
          ) : null}
          {movedIn !== 0 ? <Line label="Moved in from your accounts" value={formatMoneyDelta(movedIn)} /> : null}
          {movedOut !== 0 ? <Line label="Moved out to your accounts" value={formatMoneyDelta(-movedOut)} /> : null}
        </Box>
      ) : null}

      <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1, mt: 2 }}>
        <Stat
          label="Average per month"
          value={s.avgPerMonth == null ? "—" : formatMoneyDelta(s.avgPerMonth)}
          color={tone(s.avgPerMonth)}
        />
        <Stat
          label="Share of net worth"
          value={s.share == null ? "—" : `${Math.round(s.share)}%`}
          sub={s.startShare != null && s.share != null && Math.round(s.startShare) !== Math.round(s.share) ? `from ${Math.round(s.startShare)}%` : undefined}
        />
        <Stat
          label="Best month"
          value={s.best ? `${short(s.best.month)} ${formatMoneyDelta(s.best.change)}` : "—"}
          color={s.best ? "success.main" : undefined}
        />
        <Stat
          label="Worst month"
          value={s.worst ? `${short(s.worst.month)} ${formatMoneyDelta(s.worst.change)}` : "—"}
          color={s.worst ? "warning.main" : undefined}
        />
      </Box>

      <Typography variant="subtitle2" color="text.secondary" sx={{ mt: 3, mb: 0.5 }}>
        Monthly balances
      </Typography>
      <Stack divider={<Box sx={{ borderTop: 1, borderColor: "divider" }} />}>
        {rows.map((i) => {
          const c = changes[i];
          return (
            <Box
              key={months[i]}
              sx={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", py: 1, gap: 2 }}
            >
              <Typography variant="body2">{formatMonth(months[i])}</Typography>
              <Box sx={{ textAlign: "right" }}>
                <Typography variant="body2" component="span" fontWeight={600}>
                  {balances[i] == null ? "—" : formatMoney(balances[i])}
                </Typography>
                {c ? (
                  <Typography variant="caption" component="span" sx={{ ml: 1, color: tone(c.change) }}>
                    {formatMoneyDelta(c.change)}
                    {c.span > 1 ? ` · ${c.span} mo` : ""}
                  </Typography>
                ) : i === 0 ? (
                  <Typography variant="caption" component="span" color="text.secondary" sx={{ ml: 1 }}>
                    starting point
                  </Typography>
                ) : null}
              </Box>
            </Box>
          );
        })}
      </Stack>
    </DetailSheet>
  );
}
