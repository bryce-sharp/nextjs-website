"use client";

import * as React from "react";
import Paper from "@mui/material/Paper";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Avatar from "@mui/material/Avatar";
import Button from "@mui/material/Button";
import ButtonBase from "@mui/material/ButtonBase";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Chip from "@mui/material/Chip";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import AddIcon from "@mui/icons-material/Add";
import { formatMoney } from "@/lib/format";
import CompensationDialog, { type CompValues } from "./CompensationDialog";
import DeductionDialog, { type DeductionValues } from "./DeductionDialog";

export type AtlasPersonProps = {
  profileId: number;
  name: string;
  color: string | null;
  /** null = no compensation plan yet (renders the set-up CTA). */
  comp: (CompValues & {
    paychecksPerYear: number;
    grossPerPaycheck: number;
    netPerPaycheck: number;
    payrollDeductionsPerPaycheck: number;
    employerPerPaycheck: number;
    monthlyNet: number;
    yearlyNet: number;
    hourly: number | null;
    tcv: number | null;
    investingPerYear: number;
  }) | null;
  deductions: DeductionValues[];
};

// Flat stat (no nested Paper — boxes-in-a-box read as clutter): label over
// value over context line, aligned on a shared grid so heights always match.
function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Box>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ textTransform: "uppercase", letterSpacing: "0.04em", whiteSpace: "nowrap" }}
      >
        {label}
      </Typography>
      <Typography variant="h6" component="div" sx={{ lineHeight: 1.3 }}>
        {value}
      </Typography>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ display: "block", minHeight: "1.2em" }}
      >
        {sub ?? ""}
      </Typography>
    </Box>
  );
}

const FREQ_LABEL: Record<string, string> = {
  weekly: "weekly",
  biweekly: "every 2 weeks",
  semimonthly: "twice a month",
  monthly: "monthly",
};

const TYPE_LABEL: Record<string, string> = {
  insurance: "Insurance",
  retirement: "Retirement",
  health: "Health",
  tax: "Tax",
  employer_benefit: "Employer",
};

// One stacked row per item on phones, where a table would need ~600px.
const phoneRowSx = {
  display: "flex",
  width: "100%",
  alignItems: "center",
  gap: 1.5,
  px: 1,
  py: 1.25,
  borderBottom: 1,
  borderColor: "divider",
  textAlign: "left",
} as const;

// One person's income: the compensation summary tiles (all derived — the
// paycheck math lives in lib/queries/finance-atlas) + their deductions table.
// Editing is only offered on the CURRENT month; past months are exhibits.
export default function AtlasPersonCard({
  person,
  editable,
  yearOptions,
  defaultMonth,
  accounts,
}: {
  person: AtlasPersonProps;
  editable: boolean;
  yearOptions: number[];
  /** "YYYY-MM" (current month) for new effective-dated segments. */
  defaultMonth: string;
  /** Accounts a deduction can land in (the "Goes into" picker). */
  accounts: { id: number; name: string }[];
}) {
  const accountName = (id: number | null) => (id == null ? null : accounts.find((a) => a.id === id)?.name ?? null);
  const [compOpen, setCompOpen] = React.useState(false);
  const [editingDeduction, setEditingDeduction] =
    React.useState<DeductionValues | "new" | null>(null);

  const { comp } = person;
  const payroll = person.deductions.filter((d) => d.source === "payroll");
  const employer = person.deductions.filter((d) => d.source === "employer");

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 2.5 }, mb: 3 }}>
      <Stack
        direction="row"
        alignItems="center"
        spacing={1.5}
        sx={{ mb: 2, flexWrap: "wrap", rowGap: 1 }}
      >
        <Avatar
          sx={{
            width: 30,
            height: 30,
            fontSize: 14,
            fontWeight: 700,
            bgcolor: person.color ?? "primary.main",
            color: "#fff",
          }}
        >
          {person.name.trim()[0]?.toUpperCase() ?? "?"}
        </Avatar>
        <Typography variant="h6" sx={{ flexGrow: 1 }}>
          {person.name}&apos;s income
        </Typography>
        {comp ? (
          <Chip size="small" variant="outlined" label={FREQ_LABEL[comp.payFrequency] ?? comp.payFrequency} />
        ) : null}
        {editable ? (
          <Button
            size="small"
            variant={comp ? "outlined" : "contained"}
            startIcon={comp ? <EditOutlinedIcon /> : <AddIcon />}
            onClick={() => setCompOpen(true)}
          >
            {comp ? "Compensation" : "Set up income"}
          </Button>
        ) : null}
      </Stack>

      {comp ? (
        <>
          <Box
            sx={{
              display: "grid",
              columnGap: 3,
              rowGap: 1.5,
              gridTemplateColumns: {
                xs: "repeat(2, 1fr)",
                sm: "repeat(3, 1fr)",
                md: "repeat(6, auto)",
              },
              justifyContent: { md: "space-between" },
              mb: 2.5,
              px: 0.5,
            }}
          >
            <Stat label="Gross" value={formatMoney(comp.grossPerPaycheck)} sub="per paycheck" />
            <Stat
              label="Net"
              value={formatMoney(comp.netPerPaycheck)}
              sub={`after ${formatMoney(comp.payrollDeductionsPerPaycheck)} deductions`}
            />
            <Stat label="Monthly" value={formatMoney(comp.monthlyNet)} sub="net income" />
            <Stat label="Yearly" value={formatMoney(comp.yearlyNet)} sub="net income" />
            <Stat
              label="Hourly"
              value={comp.hourly != null ? formatMoney(comp.hourly) : "—"}
              sub={comp.baseSalary != null ? `base ${formatMoney(comp.baseSalary)}` : undefined}
            />
            <Stat
              label="TCV"
              value={comp.tcv != null ? formatMoney(comp.tcv) : "—"}
              sub={
                comp.shares != null && comp.sharePrice != null
                  ? `${comp.shares.toLocaleString()} sh × ${formatMoney(comp.sharePrice)}`
                  : undefined
              }
            />
          </Box>

          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
            sx={{ mb: 1, flexWrap: "wrap", rowGap: 1 }}
          >
            <Typography variant="subtitle2" color="text.secondary">
              Deductions & benefits · investing {formatMoney(comp.investingPerYear)}/yr
            </Typography>
            {editable ? (
              <Button size="small" startIcon={<AddIcon />} onClick={() => setEditingDeduction("new")}>
                Add deduction
              </Button>
            ) : null}
          </Stack>

          {person.deductions.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No deductions yet — add taxes, insurance, 401k… to derive net pay.
            </Typography>
          ) : (
            <>
              {/* Phones: name and where it goes over the monthly cost; tap to edit. */}
              <Box sx={{ display: { xs: "block", sm: "none" }, mx: -1 }}>
                {[...payroll, ...employer].map((d) => {
                  const row = (
                    <>
                      <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                        <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
                          <Typography variant="body2" fontWeight={600} noWrap>
                            {d.name}
                          </Typography>
                          {d.source === "employer" ? (
                            <Chip label="employer-paid" size="small" variant="outlined" />
                          ) : null}
                        </Stack>
                        <Typography variant="caption" color="text.secondary" component="div" noWrap>
                          {[
                            d.type ? (TYPE_LABEL[d.type] ?? d.type) : null,
                            accountName(d.depositAccountId) ? `into ${accountName(d.depositAccountId)}` : null,
                          ]
                            .filter(Boolean)
                            .join(" · ") || "—"}
                        </Typography>
                      </Box>
                      <Box sx={{ textAlign: "right", flexShrink: 0 }}>
                        <Typography variant="body2" fontWeight={600}>
                          {formatMoney(d.monthly)}/mo
                        </Typography>
                        <Typography variant="caption" color="text.secondary" component="div">
                          {formatMoney(d.effectivePerPaycheck)}/check
                          {d.pctOfGross != null ? ` · ${d.pctOfGross}%` : ""}
                        </Typography>
                      </Box>
                    </>
                  );
                  return editable ? (
                    <ButtonBase
                      key={d.id}
                      onClick={() => setEditingDeduction(d)}
                      aria-label={`Edit ${d.name}`}
                      sx={phoneRowSx}
                    >
                      {row}
                    </ButtonBase>
                  ) : (
                    <Box key={d.id} sx={phoneRowSx}>
                      {row}
                    </Box>
                  );
                })}
              </Box>
              <Table size="small" sx={{ display: { xs: "none", sm: "table" } }}>
                <TableHead>
                  <TableRow>
                    <TableCell>Name</TableCell>
                    <TableCell>Type</TableCell>
                    <TableCell align="right">$ / check</TableCell>
                    <TableCell align="right">$ / mo</TableCell>
                    <TableCell align="right">% of gross</TableCell>
                    {editable ? <TableCell align="right" /> : null}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {[...payroll, ...employer].map((d) => (
                    <TableRow key={d.id} hover>
                      <TableCell>
                        {d.name}
                        {d.source === "employer" ? (
                          <Chip label="employer-paid" size="small" sx={{ ml: 1 }} variant="outlined" />
                        ) : null}
                        {accountName(d.depositAccountId) ? (
                          <Typography variant="caption" color="text.secondary" component="div">
                            into {accountName(d.depositAccountId)}
                          </Typography>
                        ) : null}
                      </TableCell>
                      <TableCell>{d.type ? (TYPE_LABEL[d.type] ?? d.type) : "—"}</TableCell>
                      <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
                        {formatMoney(d.effectivePerPaycheck)}
                      </TableCell>
                      <TableCell align="right">{formatMoney(d.monthly)}</TableCell>
                      <TableCell align="right" sx={{ color: "text.secondary" }}>
                        {d.isPercent ? (
                          <Tooltip title="Defined as % of gross — the dollar amount follows raises automatically">
                            <Typography component="span" variant="body2" fontWeight={700}>
                              {d.pctOfGross}%
                            </Typography>
                          </Tooltip>
                        ) : d.pctOfGross != null ? (
                          `${d.pctOfGross}%`
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      {editable ? (
                        <TableCell align="right">
                          <Tooltip title={`Edit ${d.name}`}>
                            <IconButton
                              size="small"
                              onClick={() => setEditingDeduction(d)}
                              aria-label={`Edit ${d.name}`}
                            >
                              <EditOutlinedIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </TableCell>
                      ) : null}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}
        </>
      ) : (
        <Typography variant="body2" color="text.secondary">
          No income set up{editable ? " — add their pay to include them in the household math." : "."}
        </Typography>
      )}

      {compOpen ? (
        <CompensationDialog
          open
          onClose={() => setCompOpen(false)}
          profileId={person.profileId}
          personName={person.name}
          current={comp}
          yearOptions={yearOptions}
          defaultMonth={defaultMonth}
        />
      ) : null}
      {editingDeduction !== null ? (
        <DeductionDialog
          open
          onClose={() => setEditingDeduction(null)}
          profileId={person.profileId}
          personName={person.name}
          deduction={editingDeduction === "new" ? null : editingDeduction}
          yearOptions={yearOptions}
          defaultMonth={defaultMonth}
          accounts={accounts}
        />
      ) : null}
    </Paper>
  );
}
