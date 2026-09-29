import Link from "@/components/shared/AppLink";
import { redirect } from "next/navigation";
import Container from "@mui/material/Container";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { getSession } from "@/lib/session";
import { isEditor } from "@/lib/auth";
import { getGroupTimezone } from "@/lib/queries/group";
import { lastDayOfMonth, todayISO } from "@/lib/finance/parse";
import { formatMoney, formatMonth } from "@/lib/format";
import { searchTransactionsForGroup, type TxnFilters } from "@/lib/queries/finance-transactions";
import {
  cashFlowByMonth,
  incomeByTag,
  spendByTag,
  summarizeCashFlow,
} from "@/lib/queries/finance-cashflow";
import { getMerchantGroupsForGroup } from "@/lib/queries/finance-categories";
import { LANE_LABELS, UNTAGGED, flowOf, type Flow } from "@/lib/finance/cashflow";
import {
  getMonthReportForGroup,
  getRangeReportForGroup,
  listBills,
  listMerchantSuggestions,
  listOpenFunds,
} from "@/lib/queries/finance-budget";
import TxnFilterBar, { type RawFilters } from "@/components/finance/TxnFilterBar";
import TransactionsTable from "@/components/finance/TransactionsTable";
import CashFlowHistory from "@/components/finance/CashFlowHistory";
import ListFilterChip from "@/components/finance/ListFilterChip";

export const metadata = { title: "History" };

const str = (v: string | undefined) => {
  const s = (v ?? "").trim();
  return s === "" ? undefined : s;
};
const numv = (v: string | undefined) => {
  const s = (v ?? "").trim().replace(/[$,]/g, "");
  if (s === "") return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
};
const datev = (v: string | undefined) => {
  const s = (v ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined;
};
/** First day of the month `n - 1` months before `iso`'s — n whole months incl. this one. */
function monthStartAgo(iso: string, n: number): string {
  const d = new Date(`${iso.slice(0, 7)}-01T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - (n - 1));
  return d.toISOString().slice(0, 10);
}

const RANGE_LABELS: Record<string, string> = {
  all: "All time",
  year: "This year",
  lastyear: "Last year",
  "6mo": "Past 6 months",
  "12mo": "Past 12 months",
  custom: "Custom range",
};

// History (F4b + cash flow) — money in & out by month for the filtered range,
// where it went by tag, and the searchable ledger beneath. Defaults to this
// year; presets resolve against the HOUSEHOLD's today and start on a month
// boundary so every bar is a whole month. `m` (YYYY-MM) drills into one month:
// the tag breakdown and the list follow it, while the bars keep the whole
// range. `tag` + `tagflow` narrow just the list to one tapped slice. `group`
// (+ `groupflow`) narrows everything to one merchant group — resolved to its
// merchants exactly as the Categories page lists them, so the two agree.
export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (session === null) redirect("/login");

  const sp = await searchParams;
  const get = (k: string) => {
    const v = sp[k];
    return Array.isArray(v) ? v[0] : v;
  };

  const groupId = session.groupId;
  const tz = await getGroupTimezone(groupId);
  const today = todayISO(tz);

  const range = str(get("range")) ?? "year";
  let from: string | undefined;
  let to: string | undefined;
  if (range === "custom") {
    from = datev(get("from"));
    to = datev(get("to"));
  } else if (range === "year") {
    from = `${today.slice(0, 4)}-01-01`;
  } else if (range === "lastyear") {
    const last = Number(today.slice(0, 4)) - 1;
    from = `${last}-01-01`;
    to = `${last}-12-31`;
  } else if (range === "6mo") {
    from = monthStartAgo(today, 6);
  } else if (range === "12mo") {
    from = monthStartAgo(today, 12);
  }

  // Both sides' groups feed the Group picker (and carry each side's tag list).
  const [outGroups, inGroups] = await Promise.all([
    getMerchantGroupsForGroup(groupId, "out"),
    getMerchantGroupsForGroup(groupId, "in"),
  ]);
  const groupName = str(get("group"));
  const groupFlow: Flow = get("groupflow") === "in" ? "in" : "out";
  const picked = groupName
    ? (groupFlow === "in" ? inGroups : outGroups).groups.find((g) => g.name === groupName)
    : undefined;

  // Type: every spending or income lane ("out"/"in"), or one lane — always with
  // its flow, so the bars, breakdown and list count exactly what cash flow does.
  const typeParam = str(get("type"));
  const typeFlow: Flow | undefined =
    typeParam === "out" || typeParam === "in"
      ? typeParam
      : typeParam
        ? (flowOf(typeParam) ?? undefined)
        : undefined;
  const typeLane = typeFlow && typeParam !== typeFlow ? typeParam : undefined;
  const typeLabel = typeLane
    ? LANE_LABELS[typeLane]
    : typeFlow === "out"
      ? "All spending"
      : typeFlow === "in"
        ? "All income"
        : null;

  const catParam = str(get("cat"));
  const filters: TxnFilters = {
    q: str(get("q")),
    min: numv(get("min")),
    max: numv(get("max")),
    from,
    to,
    category: catParam && catParam !== "__none__" ? catParam : undefined,
    uncategorized: catParam === "__none__",
    // A group that no longer exists matches nothing rather than everything.
    merchants: groupName ? (picked?.merchants.map((m) => m.merchant) ?? []) : undefined,
    flow: typeFlow,
    lane: typeLane,
  };

  // The drilled month, clipped to the range so a custom partial month stays honest.
  const mParam = str(get("m"));
  const month = mParam && /^\d{4}-\d{2}$/.test(mParam) ? `${mParam}-01` : null;
  const scoped: TxnFilters = month
    ? {
        ...filters,
        from: from && from > month ? from : month,
        to: to && to < lastDayOfMonth(month) ? to : lastDayOfMonth(month),
      }
    : filters;

  // A tapped slice: only the rows that make up that slice (same flow + tag).
  const tag = str(get("tag")) ?? null;
  const tagFlow: Flow = typeFlow ?? (get("tagflow") === "in" ? "in" : "out");
  const listFilters: TxnFilters = tag
    ? {
        ...scoped,
        category: tag === UNTAGGED ? undefined : tag,
        uncategorized: tag === UNTAGGED,
        flow: tagFlow,
      }
    : scoped;

  const narrowed = Boolean(
    filters.q || filters.min != null || filters.max != null || catParam || groupName || typeFlow,
  );

  const raw: RawFilters = {
    q: str(get("q")) ?? "",
    min: str(get("min")) ?? "",
    max: str(get("max")) ?? "",
    range,
    from: datev(get("from")) ?? "",
    to: datev(get("to")) ?? "",
    type: typeFlow ? (typeParam ?? "") : "",
    cat: catParam ?? "",
    group: groupName ?? "",
    groupflow: groupFlow,
  };
  const groupOptions = [
    ...outGroups.groups.map((g) => ({ name: g.name, flow: "out" as const })),
    ...inGroups.groups.map((g) => ({ name: g.name, flow: "in" as const })),
  ].sort((a, b) => (a.flow === b.flow ? a.name.localeCompare(b.name) : a.flow === "out" ? -1 : 1));

  const [
    page,
    listSummary,
    months,
    rangeTags,
    drillTags,
    rangeIncomeTags,
    drillIncomeTags,
    funds,
    bills,
    suggest,
    editor,
    report,
  ] = await Promise.all([
    searchTransactionsForGroup(groupId, listFilters, null),
    summarizeCashFlow(groupId, listFilters),
    cashFlowByMonth(groupId, filters),
    spendByTag(groupId, filters),
    month ? spendByTag(groupId, scoped) : Promise.resolve([]),
    incomeByTag(groupId, filters),
    month ? incomeByTag(groupId, scoped) : Promise.resolve([]),
    listOpenFunds(),
    listBills(),
    listMerchantSuggestions(),
    isEditor(),
    // The household's budget vs its ATLAS plan — for the drilled month, else
    // the whole timeframe. It can't honor narrowing filters (a Walmart filter
    // has no "plan"), so it's left out while one is active.
    narrowed
      ? Promise.resolve(null)
      : month
        ? getMonthReportForGroup(groupId, month, today)
        : getRangeReportForGroup(groupId, from, to, today),
  ]);
  const tagLabel = tag === UNTAGGED ? "Untagged" : tag;
  const categories = outGroups.categories;
  const incomeCategories = inGroups.categories;
  const scopeLabel = [RANGE_LABELS[range] ?? "This year", groupName, typeLabel].filter(Boolean).join(" · ");

  return (
    <Container maxWidth="md" sx={{ py: { xs: 4, md: 6 } }}>
      <Button
        component={Link}
        href="/finance"
        startIcon={<ArrowBackIcon />}
        color="inherit"
        sx={{ mb: 2 }}
      >
        Back to budget
      </Button>

      <Stack spacing={0.5} sx={{ mb: 3 }}>
        <Typography variant="h3" component="h1">
          History
        </Typography>
        <Typography variant="h6" component="p" color="text.secondary" fontWeight={400}>
          Everything that came in and went out
        </Typography>
      </Stack>

      <TxnFilterBar
        raw={raw}
        categories={[...new Set([...categories, ...incomeCategories])].sort()}
        groups={groupOptions}
      />

      <CashFlowHistory
        months={months}
        selected={month}
        rangeLabel={scopeLabel}
        rangeTags={rangeTags}
        drillTags={drillTags}
        rangeIncomeTags={rangeIncomeTags}
        drillIncomeTags={drillIncomeTags}
        tag={tag}
        tagFlow={tagFlow}
        report={report && "report" in report ? report.report : report}
        reportInProgress={month != null && month.slice(0, 7) === today.slice(0, 7)}
        lockedFlow={typeFlow ?? null}
        reportCaption={
          report && "report" in report
            ? `${report.months === 1 ? formatMonth(report.first) : `${formatMonth(report.first)} – ${formatMonth(report.last)}`} · ${report.months} ${report.months === 1 ? "month" : "months"} summed${report.skippedCurrent ? ` · ${formatMonth(today)} is still in progress, so it isn't included` : ""}`
            : undefined
        }
      />

      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5, px: 0.5, flexWrap: "wrap", rowGap: 1 }}>
        <Typography variant="body2" color="text.secondary">
          {listSummary.count === 0
            ? "No matches"
            : `${listSummary.count.toLocaleString()} ${
                listSummary.count === 1 ? "transaction" : "transactions"
              }${month ? ` in ${formatMonth(month)}` : ""}`}
        </Typography>
        {tagLabel ? (
          <ListFilterChip
            label={`${tagLabel} ${tagFlow === "in" ? "income" : "spending"} · ${formatMoney(
              tagFlow === "in" ? listSummary.moneyIn : listSummary.moneyOut,
            )}`}
            params={["tag", "tagflow"]}
          />
        ) : null}
      </Stack>

      <TransactionsTable
        key={JSON.stringify(listFilters)}
        filters={listFilters}
        initialRows={page.rows}
        initialCursor={page.nextCursor}
        emptyText="No transactions match these filters."
        funds={funds}
        bills={bills}
        merchants={suggest.merchants}
        sources={suggest.sources}
        categories={categories}
        incomeCategories={incomeCategories}
        editable={editor}
      />
    </Container>
  );
}
