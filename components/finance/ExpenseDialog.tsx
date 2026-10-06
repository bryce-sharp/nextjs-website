"use client";

import * as React from "react";
import Dialog from "@mui/material/Dialog";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useTheme } from "@mui/material/styles";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Stack from "@mui/material/Stack";
import Box from "@mui/material/Box";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import Button from "@mui/material/Button";
import Alert from "@mui/material/Alert";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import FormControlLabel from "@mui/material/FormControlLabel";
import Checkbox from "@mui/material/Checkbox";
import Divider from "@mui/material/Divider";
import Typography from "@mui/material/Typography";
import Autocomplete, { createFilterOptions } from "@mui/material/Autocomplete";
import SubmitButton from "@/components/shared/SubmitButton";
import NumberField from "@/components/shared/NumberField";
import MonthYearField from "@/components/shared/MonthYearField";
import {
  addExpenseAction,
  updateExpenseAction,
  replaceExpenseAction,
  endExpenseAction,
  deleteExpenseAction,
} from "@/app/actions/finance-atlas";

export type ExpenseValues = {
  id: number;
  name: string;
  category: string | null;
  necessity: string;
  amount: number;
  paymentsPerYear: number;
  dueMonths: number[] | null;
  dueDay: string | null;
  paidFromAccountId: number | null;
  paidFromName: string | null;
  isEstimate: boolean;
  merchantPatterns: string[];
  notes: string | null;
  monthly: number;
};

export type PayAccount = { id: number; name: string };

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

// The "creatable dropdown" recipe: existing categories are the menu; an
// unmatched typed value surfaces as an explicit `Add "…"` choice, so a typo
// has to be deliberately confirmed before it becomes a new category.
const categoryFilter = createFilterOptions<string>();
const ADD_RE = /^Add "(.+)"$/;

// Starter vocabulary for households with no categories yet — merged with (and
// superseded by) whatever labels the group actually uses.
const STARTER_CATEGORIES = [
  "Subscriptions",
  "Utilities",
  "Housing",
  "Car",
  "Groceries",
  "Insurance",
  "Financial Commitment",
];

// Add or edit one recurring bill. amount is the REAL per-occurrence price at
// its cadence (WoW = $77.94 every 6 months, not the divided $12.99) — the
// monthly figure is derived. Editing offers the effective-dating flavors +
// the danger zone (end vs delete). merchantPatterns feed the future budget
// tab's SMS auto-categorization.
export default function ExpenseDialog({
  open,
  onClose,
  expense,
  categoryOptions,
  accounts,
  yearOptions,
  defaultMonth,
}: {
  open: boolean;
  onClose: () => void;
  expense: ExpenseValues | null; // null = add new
  categoryOptions: string[];
  accounts: PayAccount[];
  yearOptions: number[];
  defaultMonth: string;
}) {
  // Phones get the whole screen: room for the fields and the keyboard.
  const fullScreen = useMediaQuery(useTheme().breakpoints.down("sm"));
  const [flavor, setFlavor] = React.useState<"fix" | "asof">("fix");
  const [startMonth, setStartMonth] = React.useState(defaultMonth);
  const [category, setCategory] = React.useState<string>(
    expense?.category ?? "",
  );
  const options = React.useMemo(() => {
    const seen = new Set(categoryOptions.map((c) => c.toLowerCase()));
    return [
      ...categoryOptions,
      ...STARTER_CATEGORIES.filter((s) => !seen.has(s.toLowerCase())),
    ];
  }, [categoryOptions]);
  const [dueMonths, setDueMonths] = React.useState<number[]>(
    expense?.dueMonths ?? [],
  );
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  async function handle(formData: FormData) {
    setError(null);
    try {
      if (!expense) await addExpenseAction(formData);
      else if (flavor === "asof")
        await replaceExpenseAction(expense.id, formData);
      else await updateExpenseAction(expense.id, formData);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save.");
    }
  }

  function runDanger(action: (id: number, fd: FormData) => Promise<void>) {
    if (!expense) return;
    startTransition(async () => {
      try {
        await action(expense.id, new FormData());
        onClose();
      } catch {
        setError("Couldn't update — try again.");
      }
    });
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" fullScreen={fullScreen}>
      <DialogTitle>
        {expense ? `Edit ${expense.name}` : "Add a recurring expense"}
      </DialogTitle>
      <form action={handle}>
        <DialogContent sx={{ pt: 1 }}>
          <Stack spacing={2.5}>
            {error ? <Alert severity="error">{error}</Alert> : null}
            {expense ? (
              <RadioGroup
                value={flavor}
                onChange={(e) => setFlavor(e.target.value as "fix" | "asof")}
              >
                <FormControlLabel
                  value="fix"
                  control={<Radio size="small" />}
                  label="Fix in place (typo — recalculates everywhere)"
                />
                <FormControlLabel
                  value="asof"
                  control={<Radio size="small" />}
                  label="Price changed as of a month (history keeps the old amount)"
                />
              </RadioGroup>
            ) : null}
            {!expense || flavor === "asof" ? (
              <MonthYearField
                name="startMonth"
                value={startMonth}
                onChange={setStartMonth}
                years={yearOptions}
                monthLabel={expense ? "Effective month" : "Starting month"}
                yearLabel="Year"
              />
            ) : null}

            <Box
              sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", sm: "2fr 1fr" } }}
            >
              <TextField
                name="name"
                label="Name"
                required
                autoFocus={!expense}
                defaultValue={expense?.name ?? ""}
                placeholder="e.g. Netflix, Electric, Rent"
              />
              <TextField
                name="necessity"
                label="Necessity"
                select
                defaultValue={expense?.necessity ?? "essential"}
              >
                <MenuItem value="essential">Essential</MenuItem>
                <MenuItem value="lifestyle">Lifestyle</MenuItem>
                <MenuItem value="commitment">Commitment</MenuItem>
              </TextField>
            </Box>

            <Box
              sx={{ display: "grid", gap: 2, gridTemplateColumns: "1fr 1fr" }}
            >
              <Autocomplete
                freeSolo
                selectOnFocus
                clearOnBlur
                handleHomeEndKeys
                options={options}
                value={category || null}
                onChange={(_, v) => {
                  if (typeof v !== "string" || !v) {
                    setCategory("");
                    return;
                  }
                  const added = ADD_RE.exec(v)?.[1] ?? v;
                  // Reuse an existing category's casing when it matches.
                  const existing = options.find(
                    (o) => o.toLowerCase() === added.toLowerCase(),
                  );
                  setCategory(existing ?? added);
                }}
                filterOptions={(opts, params) => {
                  const filtered = categoryFilter(opts, params);
                  const input = params.inputValue.trim();
                  if (
                    input &&
                    !opts.some((o) => o.toLowerCase() === input.toLowerCase())
                  ) {
                    filtered.push(`Add "${input}"`);
                  }
                  return filtered;
                }}
                getOptionLabel={(o) => ADD_RE.exec(o)?.[1] ?? o}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Category"
                    placeholder="Subscriptions, Utilities…"
                  />
                )}
              />
              <TextField
                name="paidFromAccountId"
                label="Paid from"
                select
                defaultValue={expense?.paidFromAccountId ?? ""}
              >
                <MenuItem value="">
                  <em>Unassigned</em>
                </MenuItem>
                {accounts.map((a) => (
                  <MenuItem key={a.id} value={a.id}>
                    {a.name}
                  </MenuItem>
                ))}
              </TextField>
            </Box>
            <input type="hidden" name="category" value={category} readOnly />

            <Box
              sx={{
                display: "grid",
                gap: 2,
                gridTemplateColumns: { xs: "1fr 1fr", sm: "1fr 1fr 1fr" },
              }}
            >
              <NumberField
                name="amount"
                label="Amount per payment"
                prefix="$"
                decimalScale={2}
                defaultValue={expense?.amount ?? null}
              />
              <NumberField
                name="paymentsPerYear"
                label="Payments / year"
                defaultValue={expense?.paymentsPerYear ?? 12}
              />
              <TextField
                name="dueDay"
                label="Due"
                defaultValue={expense?.dueDay ?? ""}
                placeholder="15th, EOM, ???"
              />
            </Box>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ mt: -1 }}
            >
              The real price at its real cadence — 12/yr = monthly, 2 = every
              six months, 1 = yearly. The monthly figure is derived.
            </Typography>

            <Autocomplete
              multiple
              options={MONTH_NAMES.map((_, i) => i + 1)}
              getOptionLabel={(m) => MONTH_NAMES[(m as number) - 1]}
              value={dueMonths}
              onChange={(_, v) =>
                setDueMonths((v as number[]).sort((a, b) => a - b))
              }
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Due months (optional)"
                  placeholder="For uneven cadences: Jan, Apr…"
                />
              )}
            />
            <input
              type="hidden"
              name="dueMonths"
              value={JSON.stringify(dueMonths)}
              readOnly
            />

            <FormControlLabel
              control={
                <Checkbox
                  name="isEstimate"
                  defaultChecked={expense?.isEstimate ?? false}
                />
              }
              label={
                <>
                  Amount is an estimate
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    display="block"
                  >
                    Label for variable bills (electric, water).
                  </Typography>
                </>
              }
            />

            <TextField
              name="merchantPatterns"
              label="Merchant matches (optional, one per line)"
              fullWidth
              multiline
              minRows={1}
              defaultValue={expense?.merchantPatterns.join("\n") ?? ""}
              helperText="How this bill appears in card alerts — lets the Budget tab auto-file its transactions."
            />
            <TextField
              name="notes"
              label="Notes (optional)"
              fullWidth
              multiline
              minRows={1}
              defaultValue={expense?.notes ?? ""}
            />

            {expense ? (
              <>
                <Divider />
                <Stack
                  direction="row"
                  spacing={1}
                  alignItems="center"
                  flexWrap="wrap"
                  useFlexGap
                >
                  <Typography
                    variant="overline"
                    sx={{ color: "error.main", mr: 1 }}
                  >
                    Danger zone
                  </Typography>
                  <Button
                    size="small"
                    color="inherit"
                    disabled={pending}
                    onClick={() => {
                      if (
                        window.confirm(
                          `End ${expense.name} as of today (canceled it)? Past months keep it.`,
                        )
                      )
                        runDanger(endExpenseAction);
                    }}
                  >
                    End as of today
                  </Button>
                  <Button
                    size="small"
                    color="error"
                    disabled={pending}
                    onClick={() => {
                      if (
                        window.confirm(
                          `Delete ${expense.name} entirely? It disappears from every month it ever touched.`,
                        )
                      )
                        runDanger(deleteExpenseAction);
                    }}
                  >
                    Delete forever
                  </Button>
                </Stack>
              </>
            ) : null}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={onClose} color="inherit">
            Cancel
          </Button>
          <SubmitButton
            variant="contained"
            pendingLabel="Saving…"
            disabled={pending}
          >
            Save
          </SubmitButton>
        </DialogActions>
      </form>
    </Dialog>
  );
}
