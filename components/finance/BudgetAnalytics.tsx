"use client";

import Accordion from "@mui/material/Accordion";
import AccordionSummary from "@mui/material/AccordionSummary";
import AccordionDetails from "@mui/material/AccordionDetails";
import Box from "@mui/material/Box";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import AppLink from "@/components/shared/AppLink";
import { formatMoney, formatMonth } from "@/lib/format";
import type { MonthReport as MonthReportData } from "@/lib/finance/month-report";
import MonthReport from "./MonthReport";

// The deep numbers, an INLINE expander inside the Insights card (not its own
// card). Discretionary-only: what reimbursements handed back and how recent
// months went against their budgets. Income and off-budget live in All money.
export type BudgetAnalyticsData = {
  reimbursed: number;
  recentMonths: { month: string; spent: number; budget: number; remaining: number }[];
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600 }}
      >
        {title}
      </Typography>
      <Stack spacing={0.75} sx={{ mt: 0.75 }}>
        {children}
      </Stack>
    </Box>
  );
}

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <Stack direction="row" justifyContent="space-between" spacing={2}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2" fontWeight={600} color={color} sx={{ textAlign: "right" }}>
        {value}
      </Typography>
    </Stack>
  );
}

/** The inline "More details" expander (Budget Insights, History's month drill). */
export function MoreDetails({ children }: { children: React.ReactNode }) {
  return (
    <Accordion
      disableGutters
      square
      elevation={0}
      sx={{
        bgcolor: "transparent",
        border: 0,
        "&:before": { display: "none" },
        "& .MuiAccordionSummary-root": { px: 0, minHeight: 0 },
        "& .MuiAccordionDetails-root": { px: 0 },
      }}
    >
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Typography variant="body2" color="text.secondary" fontWeight={600}>
          More details
        </Typography>
      </AccordionSummary>
      <AccordionDetails>
        <Stack spacing={2.5}>{children}</Stack>
      </AccordionDetails>
    </Accordion>
  );
}

export type CashFlowDetailsData = {
  report: MonthReportData | null; // null = no ATLAS plan this month
  inProgress: boolean;
  sources: { source: string | null; category: string; amount: number }[];
  historyHref: string; // History drilled into this month
};

// The All-money counterpart: how the month went against the plan (the same
// report History shows) and money in by source (reimbursements pooled on one
// line). Month-over-month comparison lives in History, one link away.
export function CashFlowDetails({ d }: { d: CashFlowDetailsData }) {
  const income = d.sources.filter((s) => s.category === "income");
  const reimbursed = d.sources
    .filter((s) => s.category === "reimbursement")
    .reduce((sum, s) => sum + s.amount, 0);

  return (
    <MoreDetails>
      {d.report ? (
        <Section title="How the month went">
          <MonthReport report={d.report} inProgress={d.inProgress} />
        </Section>
      ) : null}

      {income.length > 0 || reimbursed !== 0 ? (
        <Section title="Money in">
          {income.map((s) => (
            <Row key={s.source ?? "—"} label={s.source ?? "—"} value={formatMoney(s.amount)} />
          ))}
          {reimbursed !== 0 ? <Row label="Reimbursements" value={formatMoney(reimbursed)} /> : null}
        </Section>
      ) : null}

      <Link component={AppLink} href={d.historyHref} variant="body2" fontWeight={600} underline="hover">
        Compare months in History →
      </Link>
    </MoreDetails>
  );
}

export default function BudgetAnalytics({ d }: { d: BudgetAnalyticsData }) {
  return (
    <MoreDetails>
      {d.reimbursed > 0 ? (
        <Section title="Credits">
          <Row label="Reimbursed back" value={formatMoney(d.reimbursed)} color="success.main" />
        </Section>
      ) : null}

      {d.recentMonths.length > 0 ? (
        <Section title="Recent months">
          {d.recentMonths.map((m) => (
            <Row
              key={m.month}
              label={formatMonth(m.month)}
              value={`${formatMoney(m.spent)} / ${formatMoney(m.budget)} · ${m.remaining >= 0 ? "left " : "over "}${formatMoney(Math.abs(m.remaining))}`}
              color={m.remaining >= 0 ? undefined : "warning.main"}
            />
          ))}
        </Section>
      ) : null}
    </MoreDetails>
  );
}
