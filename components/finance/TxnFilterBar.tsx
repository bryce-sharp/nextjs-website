"use client";

import * as React from "react";
import { useRouter, usePathname } from "next/navigation";
import Paper from "@mui/material/Paper";
import Box from "@mui/material/Box";
import TextField from "@mui/material/TextField";
import InputAdornment from "@mui/material/InputAdornment";
import MenuItem from "@mui/material/MenuItem";
import ListSubheader from "@mui/material/ListSubheader";
import Button from "@mui/material/Button";
import Autocomplete from "@mui/material/Autocomplete";
import SearchIcon from "@mui/icons-material/Search";
import { IN_CATEGORIES, LANE_LABELS, OUT_CATEGORIES, type Flow } from "@/lib/finance/cashflow";

export type RawFilters = {
  q: string;
  min: string;
  max: string;
  range: string;
  from: string;
  to: string;
  type: string; // "" = all, "out"/"in" = every spending/income lane, else one lane
  cat: string; // "" = all, "__none__" = uncategorized, else the category
  group: string; // "" = all, else a merchant group's name
  groupflow: Flow; // which side that group lives on
};

/** A merchant group offered by the Group filter (from the Categories page). */
export type GroupOption = { name: string; flow: Flow };

const UNCATEGORIZED = "__none__";
// History opens on this year; any other range (All time included) goes in the URL.
const DEFAULT_RANGE = "year";

const RANGES = [
  { value: "all", label: "All time" },
  { value: "year", label: "This year" },
  { value: "lastyear", label: "Last year" },
  { value: "6mo", label: "Past 6 months" },
  { value: "12mo", label: "Past 12 months" },
  { value: "custom", label: "Custom range" },
];

// Builds the URL from a full set of values — the URL is the source of truth
// (bookmarkable/shareable), and the server re-renders the first page on change.
function buildUrl(pathname: string, v: RawFilters): string {
  const p = new URLSearchParams();
  if (v.q) p.set("q", v.q);
  if (v.min) p.set("min", v.min);
  if (v.max) p.set("max", v.max);
  if (v.range && v.range !== DEFAULT_RANGE) p.set("range", v.range);
  if (v.range === "custom") {
    if (v.from) p.set("from", v.from);
    if (v.to) p.set("to", v.to);
  }
  if (v.type) p.set("type", v.type);
  if (v.cat) p.set("cat", v.cat);
  if (v.group) {
    p.set("group", v.group);
    if (v.groupflow === "in") p.set("groupflow", "in");
  }
  const qs = p.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

export default function TxnFilterBar({
  raw,
  categories,
  groups,
}: {
  raw: RawFilters;
  categories: string[];
  groups: GroupOption[]; // sorted spending-first, so the picker's headings group cleanly
}) {
  const router = useRouter();
  const pathname = usePathname();

  const [q, setQ] = React.useState(raw.q);
  const [min, setMin] = React.useState(raw.min);
  const [max, setMax] = React.useState(raw.max);
  const [range, setRange] = React.useState(raw.range || DEFAULT_RANGE);
  const [from, setFrom] = React.useState(raw.from);
  const [to, setTo] = React.useState(raw.to);
  const [type, setType] = React.useState(raw.type);
  const [cat, setCat] = React.useState(raw.cat);
  const [group, setGroup] = React.useState<GroupOption | null>(
    raw.group ? { name: raw.group, flow: raw.groupflow } : null,
  );

  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // `immediate` for discrete controls (range/date/clear); debounced for the
  // free-text and amount fields so we don't navigate on every keystroke.
  const commit = React.useCallback(
    (v: RawFilters, immediate = false) => {
      if (timer.current) clearTimeout(timer.current);
      const run = () => router.push(buildUrl(pathname, v));
      if (immediate) run();
      else timer.current = setTimeout(run, 450);
    },
    [router, pathname],
  );

  const vals = (over: Partial<RawFilters>): RawFilters => ({
    q,
    min,
    max,
    range,
    from,
    to,
    type,
    cat,
    group: group?.name ?? "",
    groupflow: group?.flow ?? "out",
    ...over,
  });

  const clearAll = () => {
    setQ("");
    setMin("");
    setMax("");
    setRange(DEFAULT_RANGE);
    setFrom("");
    setTo("");
    setType("");
    setCat("");
    setGroup(null);
    if (timer.current) clearTimeout(timer.current);
    router.push(pathname);
  };

  const hasAny = q || min || max || (range && range !== DEFAULT_RANGE) || type || cat || group;

  return (
    <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2 }, mb: 2 }}>
      <Box
        sx={{
          display: "flex",
          flexWrap: "wrap",
          gap: 1.5,
          alignItems: "center",
        }}
      >
        <TextField
          size="small"
          label="Search merchant"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            commit(vals({ q: e.target.value }));
          }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            },
          }}
          sx={{ flex: "1 1 200px", minWidth: 180 }}
        />

        <TextField
          size="small"
          label="Min"
          value={min}
          onChange={(e) => {
            setMin(e.target.value);
            commit(vals({ min: e.target.value }));
          }}
          inputMode="decimal"
          slotProps={{
            input: {
              startAdornment: <InputAdornment position="start">$</InputAdornment>,
            },
          }}
          sx={{ width: 110 }}
        />
        <TextField
          size="small"
          label="Max"
          value={max}
          onChange={(e) => {
            setMax(e.target.value);
            commit(vals({ max: e.target.value }));
          }}
          inputMode="decimal"
          slotProps={{
            input: {
              startAdornment: <InputAdornment position="start">$</InputAdornment>,
            },
          }}
          sx={{ width: 110 }}
        />

        <TextField
          size="small"
          select
          label="When"
          value={range}
          onChange={(e) => {
            setRange(e.target.value);
            commit(vals({ range: e.target.value }), true);
          }}
          sx={{ width: 160 }}
        >
          {RANGES.map((r) => (
            <MenuItem key={r.value} value={r.value}>
              {r.label}
            </MenuItem>
          ))}
        </TextField>

        {range === "custom" ? (
          <>
            <TextField
              size="small"
              type="date"
              label="From"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                commit(vals({ from: e.target.value }), true);
              }}
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ width: 160 }}
            />
            <TextField
              size="small"
              type="date"
              label="To"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                commit(vals({ to: e.target.value }), true);
              }}
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ width: 160 }}
            />
          </>
        ) : null}

        {/* Spending and income lanes sit under their own headings; "All spending" /
            "All income" pick every lane on that side. */}
        <TextField
          size="small"
          select
          label="Type"
          value={type}
          onChange={(e) => {
            setType(e.target.value);
            commit(vals({ type: e.target.value }), true);
          }}
          sx={{ width: 180 }}
        >
          <MenuItem value="">All types</MenuItem>
          <ListSubheader>Spending</ListSubheader>
          <MenuItem value="out">All spending</MenuItem>
          {OUT_CATEGORIES.map((c) => (
            <MenuItem key={c} value={c} sx={{ pl: 3 }}>
              {LANE_LABELS[c]}
            </MenuItem>
          ))}
          <ListSubheader>Income</ListSubheader>
          <MenuItem value="in">All income</MenuItem>
          {IN_CATEGORIES.map((c) => (
            <MenuItem key={c} value={c} sx={{ pl: 3 }}>
              {LANE_LABELS[c]}
            </MenuItem>
          ))}
        </TextField>

        <TextField
          size="small"
          select
          label="Tag"
          value={cat}
          onChange={(e) => {
            setCat(e.target.value);
            commit(vals({ cat: e.target.value }), true);
          }}
          sx={{ width: 170 }}
        >
          <MenuItem value="">All tags</MenuItem>
          <MenuItem value={UNCATEGORIZED}>Untagged</MenuItem>
          {categories.map((c) => (
            <MenuItem key={c} value={c}>
              {c}
            </MenuItem>
          ))}
        </TextField>

        {/* A merchant group covers every spelling it catches (WAL-MART #4279,
            WM SUPERCENTER #284…), which one merchant search can't. */}
        <Autocomplete
          size="small"
          options={groups}
          groupBy={(g) => (g.flow === "in" ? "Income groups" : "Spending groups")}
          getOptionLabel={(g) => g.name}
          isOptionEqualToValue={(a, b) => a.name === b.name && a.flow === b.flow}
          value={group}
          onChange={(_, g) => {
            setGroup(g);
            commit(vals({ group: g?.name ?? "", groupflow: g?.flow ?? "out" }), true);
          }}
          renderInput={(params) => <TextField {...params} label="Group" placeholder="Walmart…" />}
          sx={{ width: 220 }}
        />

        {hasAny ? (
          <Button size="small" color="inherit" onClick={clearAll}>
            Clear
          </Button>
        ) : null}
      </Box>
    </Paper>
  );
}
