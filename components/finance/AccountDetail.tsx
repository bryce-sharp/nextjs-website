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
import { KIND_LABELS, accountStats, changesOf } from "@/lib/finance/net-worth";

const noopSubscribe = () => () => {};
function useMounted() {
  return React.useSyncExternalStore(noopSubscribe, () => true, () => false);
}

export type DetailAccount = {
  id: number;
  name: string;
  kind: string;
  includeInBankSaved: boolean;
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

const short = (m: string) => formatMonth(m).slice(0, 3);

// One account's story across the range: its balance line, how it moves per
// month, its share of the total, and every logged balance (newest first).
export default function AccountDetail({
  account,
  color,
  months,
  balances,
  totals,
  rangePhrase,
  onClose,
}: {
  account: DetailAccount;
  color: string;
  months: string[];
  balances: (number | null)[];
  totals: number[];
  rangePhrase: string; // "this year", "over 12 months", "since Dec 2025"
  onClose: () => void;
}) {
  const mounted = useMounted();
  const s = accountStats(months, balances, totals);
  const changes = changesOf(months, balances);
  const x = months.map((m) => new Date(`${m.slice(0, 7)}-01T12:00:00`));
  const rows = months.map((_, i) => i).reverse();

  const overline = [KIND_LABELS[account.kind] ?? account.kind, account.includeInBankSaved ? "Bank saved" : null, account.archived ? "Archived" : null]
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

      <Box sx={{ height: 200, mt: 1.5, mx: -1 }}>
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
            ]}
            xAxis={[
              {
                data: x,
                scaleType: "time",
                valueFormatter: (d: Date, ctx: { location: string }) =>
                  d.toLocaleDateString("en-US", ctx.location === "tick" ? { month: "short" } : { month: "long", year: "numeric" }),
              },
            ]}
            yAxis={[{ valueFormatter: (v: number) => formatMoneyCompact(v), width: 52 }]}
            hideLegend
            margin={{ top: 8, right: 12, bottom: 4, left: 4 }}
            sx={{ [`& .${lineClasses.area}`]: { opacity: 0.2 } }}
          />
        ) : null}
      </Box>

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
