"use client";

import * as React from "react";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import { formatMoneyShort, formatMoneyWhole, formatMoneyDelta, formatMonth } from "@/lib/format";
import { addMonths, projectLinear, type Pace } from "@/lib/finance/net-worth";
import type { NetWorthExtras } from "@/lib/queries/finance-networth";

function Line({ label, sub, value }: { label: React.ReactNode; sub?: React.ReactNode; value: React.ReactNode }) {
  return (
    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 2, py: 0.75 }}>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2">{label}</Typography>
        {sub ? (
          <Typography variant="caption" color="text.secondary" component="div">
            {sub}
          </Typography>
        ) : null}
      </Box>
      <Typography variant="body2" fontWeight={600} sx={{ whiteSpace: "nowrap" }}>
        {value}
      </Typography>
    </Box>
  );
}

/** "5.6 months" / "2.3 years" of runway. */
function duration(months: number): string {
  if (months >= 24) return `${(months / 12).toFixed(1)} years`;
  return `${months.toFixed(1)} months`;
}

// Two forward-looking reads off the balances: where the total heads if the
// recent pace holds, and how long bank savings would last on their own.
export default function NetWorthInsights({
  latestMonth,
  latestTotal,
  pace,
  runway,
  today,
}: {
  latestMonth: string;
  latestTotal: number;
  pace: { short: Pace | null; long: Pace | null };
  runway: NetWorthExtras["runway"];
  today: string;
}) {
  const [basis, setBasis] = React.useState<"short" | "long">(pace.long ? "long" : "short");
  const p = pace[basis] ?? pace.short ?? pace.long;
  const outlook = p ? projectLinear(latestMonth, latestTotal, p.perMonth) : null;
  const thisMonth = `${today.slice(0, 7)}-01`;
  const lastsUntil = (months: number) => formatMonth(addMonths(thisMonth, Math.floor(months)));

  if (!outlook && !runway) return null;

  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))" },
        gap: 2,
        mb: 2,
      }}
    >
      {outlook && p ? (
        <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2.5 } }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ gap: 1, flexWrap: "wrap" }}>
            <Typography variant="h6">Outlook</Typography>
            {pace.short && pace.long && pace.short.months !== pace.long.months ? (
              <ToggleButtonGroup
                size="small"
                exclusive
                value={basis}
                onChange={(_, v: "short" | "long" | null) => v && setBasis(v)}
              >
                <ToggleButton value="short" sx={{ px: 1.25, py: 0.3 }}>
                  {pace.short.months} mo
                </ToggleButton>
                <ToggleButton value="long" sx={{ px: 1.25, py: 0.3 }}>
                  {pace.long.months} mo
                </ToggleButton>
              </ToggleButtonGroup>
            ) : null}
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            At {formatMoneyDelta(p.perMonth)}/mo, your average over the last {p.months} months
          </Typography>
          {outlook.projections.map((pr) => (
            <Line
              key={pr.years}
              label={`In ${pr.years} year${pr.years === 1 ? "" : "s"}`}
              sub={formatMonth(pr.month)}
              value={formatMoneyShort(pr.value)}
            />
          ))}
          {outlook.milestones.length ? (
            <>
              <Typography variant="subtitle2" color="text.secondary" sx={{ mt: 1.5 }}>
                Next milestones
              </Typography>
              {outlook.milestones.map((m) => (
                <Line key={m.amount} label={formatMoneyShort(m.amount)} value={`about ${formatMonth(m.month)}`} />
              ))}
            </>
          ) : null}
          <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>
            A straight line: every future month adds what your average month did. Market growth on top
            of that is not assumed.
          </Typography>
        </Paper>
      ) : null}

      {runway ? (
        <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2.5 } }}>
          <Typography variant="h6">Runway</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            How long {formatMoneyWhole(runway.cash)} in bank savings lasts with no income
          </Typography>
          {runway.avgOut ? (
            <Line
              label="As you spend now"
              sub={`${formatMoneyWhole(runway.avgOut)}/mo, average of the last ${runway.avgOutMonths} months`}
              value={duration(runway.cash / runway.avgOut)}
            />
          ) : null}
          {runway.bills > 0 ? (
            <Line
              label="Bills only"
              sub={`${formatMoneyWhole(runway.bills)}/mo of ATLAS bills, no free spending`}
              value={duration(runway.cash / runway.bills)}
            />
          ) : null}
          {runway.avgOut ? (
            <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.5 }}>
              At today&apos;s spending that lasts until about {lastsUntil(runway.cash / runway.avgOut)}.
            </Typography>
          ) : null}
          {runway.brokerage > 0 && (runway.avgOut || runway.bills) ? (
            <>
              <Typography variant="subtitle2" color="text.secondary" sx={{ mt: 1.5 }}>
                Adding brokerage ({formatMoneyShort(runway.brokerage)})
              </Typography>
              {runway.avgOut ? (
                <Line label="As you spend now" value={duration((runway.cash + runway.brokerage) / runway.avgOut)} />
              ) : null}
              {runway.bills > 0 ? (
                <Line label="Bills only" value={duration((runway.cash + runway.brokerage) / runway.bills)} />
              ) : null}
            </>
          ) : null}
          <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>
            Bills only is the floor if all free spending stopped. Without a paycheck, payroll items like
            health insurance would become bills too.
          </Typography>
        </Paper>
      ) : null}
    </Box>
  );
}
