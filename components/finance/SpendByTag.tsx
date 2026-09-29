"use client";

import * as React from "react";
import { PieChart } from "@mui/x-charts/PieChart";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { formatMoney } from "@/lib/format";
import { UNTAGGED } from "@/lib/finance/cashflow";
import { CASHFLOW_COLORS } from "./chartColors";

export type TagSpendRow = { tag: string | null; amount: number };

const noopSubscribe = () => () => {};
function useMounted() {
  return React.useSyncExternalStore(noopSubscribe, () => true, () => false);
}

const OTHER = "__other__";
const labelOf = (key: string) =>
  key === OTHER ? "Everything else" : key === UNTAGGED ? "Untagged" : key;

/**
 * Pick the top slices and give each a color. Tags in `stableOrder`'s top slots
 * keep that slot's hue (so "Groceries" stays one color as you click through
 * months); a tag new to this period takes the next free hue. The rest fold
 * into a neutral "Everything else" so the ring stays readable.
 */
function slices(rows: TagSpendRow[], stableOrder: (string | null)[]) {
  const palette = CASHFLOW_COLORS.tags;
  const top = rows.slice(0, palette.length);
  const rest = rows.slice(palette.length).reduce((s, r) => s + r.amount, 0);
  const reserved = new Map<string | null, number>();
  stableOrder.slice(0, palette.length).forEach((tag, i) => reserved.set(tag, i));
  const used = new Set<number>();
  for (const r of top) {
    const slot = reserved.get(r.tag);
    if (slot !== undefined) used.add(slot);
  }
  const out: { key: string; amount: number; color: string }[] = top.map((r) => {
    let slot = reserved.get(r.tag);
    if (slot === undefined) {
      slot = palette.findIndex((_, i) => !used.has(i));
      used.add(slot);
    }
    return { key: r.tag ?? UNTAGGED, amount: r.amount, color: palette[slot] };
  });
  if (rest > 0) out.push({ key: OTHER, amount: rest, color: CASHFLOW_COLORS.other });
  return out;
}

// Where the money went (or came from), by tag: a donut for the shape of it and
// a list beside it carrying the exact amounts (the list is the readable record;
// the ring is the glance). With `onSelect`, tapping a slice or its row picks
// that tag (UNTAGGED for untagged; "Everything else" isn't one tag, so it
// isn't pickable) and the picked one stays lit.
export default function SpendByTag({
  rows,
  stableOrder,
  selected,
  onSelect,
  centerLabel = "spent",
  emptyText = "No spending in this period.",
  labels,
}: {
  rows: TagSpendRow[];
  stableOrder?: (string | null)[];
  selected?: string | null; // a tag key (tag name or UNTAGGED); null = none
  onSelect?: (key: string) => void;
  centerLabel?: string;
  emptyText?: string;
  /** Display names for keys that aren't readable as-is (e.g. lane keys). */
  labels?: Record<string, string>;
}) {
  const mounted = useMounted();
  const [hover, setHover] = React.useState<number | null>(null);
  const data = slices(rows, stableOrder ?? rows.map((r) => r.tag));
  const nameOf = (key: string) => labels?.[key] ?? labelOf(key);
  const total = data.reduce((s, d) => s + d.amount, 0);
  const selectedIndex = selected == null ? -1 : data.findIndex((d) => d.key === selected);
  const lit = hover ?? (selectedIndex >= 0 ? selectedIndex : null);
  const pickable = (i: number) => onSelect != null && data[i]?.key !== OTHER;

  if (data.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
        {emptyText}
      </Typography>
    );
  }

  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: { xs: "1fr", sm: "200px 1fr" },
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
            highlightedItem={lit == null ? null : { seriesId: "tags", dataIndex: lit }}
            onHighlightChange={(item) => setHover(item?.dataIndex ?? null)}
            onItemClick={(_, item) => {
              if (pickable(item.dataIndex)) onSelect?.(data[item.dataIndex].key);
            }}
            series={[
              {
                id: "tags",
                innerRadius: 62,
                outerRadius: 96,
                paddingAngle: 1.5,
                cornerRadius: 3,
                highlightScope: { highlight: "item", fade: "global" },
                faded: { additionalRadius: -3 },
                valueFormatter: (v) => formatMoney(v.value),
                data: data.map((d, i) => ({
                  id: i,
                  value: d.amount,
                  label: nameOf(d.key),
                  color: d.color,
                })),
              },
            ]}
            sx={onSelect ? { cursor: "pointer" } : undefined}
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
            {formatMoney(total)}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {centerLabel}
          </Typography>
        </Box>
      </Box>

      <Stack spacing={0.25}>
        {data.map((d, i) => (
          <ButtonBase
            key={d.key}
            disabled={!pickable(i)}
            onClick={() => onSelect?.(d.key)}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            aria-pressed={pickable(i) ? i === selectedIndex : undefined}
            sx={{
              display: "grid",
              gridTemplateColumns: "10px minmax(0, 1fr) auto 40px",
              alignItems: "center",
              gap: 1,
              px: 0.75,
              py: 0.5,
              borderRadius: 1,
              textAlign: "left",
              bgcolor: i === selectedIndex ? "action.selected" : lit === i ? "action.hover" : undefined,
              "&.Mui-disabled": { pointerEvents: "auto" },
            }}
          >
            <Box sx={{ width: 10, height: 10, borderRadius: 0.5, bgcolor: d.color }} />
            <Typography variant="body2" noWrap fontWeight={i === selectedIndex ? 600 : undefined}>
              {nameOf(d.key)}
            </Typography>
            <Typography variant="body2" fontWeight={600} sx={{ textAlign: "right" }}>
              {formatMoney(d.amount)}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ textAlign: "right" }}>
              {Math.round((d.amount / total) * 100)}%
            </Typography>
          </ButtonBase>
        ))}
      </Stack>
    </Box>
  );
}
