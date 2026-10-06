"use client";

import * as React from "react";
import Box from "@mui/material/Box";
import { useTheme, alpha } from "@mui/material/styles";
import {
  sankey,
  sankeyLeft,
  sankeyLinkHorizontal,
  type SankeyNode,
  type SankeyLink,
} from "d3-sankey";
import { formatMoney } from "@/lib/format";

// ─────────────────────────────────────────────────────────────────────────────
// Reusable Sankey renderer: d3-sankey does the LAYOUT MATH ONLY (node/link
// positions); the SVG is ours — theme-aware text, alpha'd ribbons, native
// <title> tooltips. Knows nothing about money beyond the value formatter, so
// the same component draws the ATLAS planned flow today and the F4
// transactions-actuals flow later. (MUI X does ship a Sankey since v8.2, but
// only in the paid Pro tier — this stays free.)
// ─────────────────────────────────────────────────────────────────────────────

export type SankeyNodeInput = { id: string; label: string; color?: string };
export type SankeyLinkInput = { source: string; target: string; value: number };

type NodeDatum = SankeyNodeInput;
type LinkExtra = Record<string, never>;
type LaidNode = SankeyNode<NodeDatum, LinkExtra>;
type LaidLink = SankeyLink<NodeDatum, LinkExtra>;

const FALLBACK_PALETTE = [
  "#4f86e0",
  "#4caf7d",
  "#e0864f",
  "#9c6bd4",
  "#d45d7a",
  "#3fa796",
  "#c9a227",
  "#7a8699",
];

export default function SankeyChart({
  nodes,
  links,
  height = 400,
  minWidth = 0,
}: {
  nodes: SankeyNodeInput[];
  links: SankeyLinkInput[];
  height?: number;
  /** Narrower containers scroll sideways instead of squeezing labels together. */
  minWidth?: number;
}) {
  const theme = useTheme();
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [measured, setWidth] = React.useState(0);
  const width = measured > 0 ? Math.max(measured, minWidth) : 0;

  // Measure the container (and re-measure on resize). Setting state inside the
  // observer callback is async — not the setState-in-effect-body lint trap.
  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      setWidth(Math.floor(entries[0].contentRect.width));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const laid = React.useMemo(() => {
    if (width < 200 || nodes.length === 0 || links.length === 0) return null;
    const generator = sankey<NodeDatum, LinkExtra>()
      .nodeId((d) => d.id)
      // Pin nodes to their true depth from the source (default "justify"
      // shoves every dead-end node into the LAST column, collapsing the
      // deductions layer into the categories layer).
      .nodeAlign(sankeyLeft)
      .nodeWidth(12)
      .nodePadding(16)
      .extent([
        [0, 8],
        [width, height - 8],
      ]);
    try {
      return generator({
        nodes: nodes.map((n) => ({ ...n })),
        links: links
          .filter((l) => l.value > 0)
          .map((l) => ({ ...l })) as unknown as LaidLink[],
      });
    } catch {
      return null; // a malformed graph (cycle, unknown id) should never crash the page
    }
  }, [nodes, links, width, height]);

  const linkPath = React.useMemo(() => sankeyLinkHorizontal<NodeDatum, LinkExtra>(), []);

  const colorOf = (n: LaidNode, i: number) =>
    n.color ?? FALLBACK_PALETTE[i % FALLBACK_PALETTE.length];

  // The grand total = everything flowing out of the root nodes (no inflows) —
  // "% of total" measures against it, "% of <source>" against the ribbon's pot.
  const grandTotal = React.useMemo(
    () =>
      laid
        ? laid.nodes
            .filter((n) => (n.targetLinks?.length ?? 0) === 0)
            .reduce((s, n) => s + (n.value ?? 0), 0)
        : 0,
    [laid],
  );
  const share = (part: number, whole: number) => {
    if (whole <= 0) return null;
    const pct = (part / whole) * 100;
    return `${pct < 10 ? pct.toFixed(1) : Math.round(pct)}%`;
  };

  return (
    <Box ref={containerRef} sx={{ width: "100%", overflowX: "auto", overscrollBehaviorX: "contain" }}>
      {laid ? (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label="Money flow diagram"
          style={{ display: "block" }}
        >
          {/* Ribbons first (under the nodes) — colored by their DESTINATION,
              so what a dollar becomes is what you see. */}
          <g fill="none">
            {laid.links.map((l, i) => {
              const source = l.source as LaidNode;
              const target = l.target as LaidNode;
              const ti = laid.nodes.indexOf(target);
              return (
                <path
                  key={i}
                  d={linkPath(l) ?? undefined}
                  stroke={alpha(colorOf(target, ti), 0.4)}
                  strokeWidth={Math.max(1, l.width ?? 1)}
                  style={{ transition: "stroke 120ms" }}
                  onMouseEnter={(e) =>
                    e.currentTarget.setAttribute(
                      "stroke",
                      alpha(colorOf(target, ti), 0.65),
                    )
                  }
                  onMouseLeave={(e) =>
                    e.currentTarget.setAttribute(
                      "stroke",
                      alpha(colorOf(target, ti), 0.4),
                    )
                  }
                >
                  <title>
                    {(() => {
                      const isRootSource = (source.targetLinks?.length ?? 0) === 0;
                      const ofSource = share(l.value ?? 0, source.value ?? 0);
                      const ofTotal = share(l.value ?? 0, grandTotal);
                      const parts = [
                        `${source.label} → ${target.label}: ${formatMoney(l.value ?? 0)}/mo`,
                        ofSource ? `${ofSource} of ${source.label}` : null,
                        // For root-sourced ribbons the two shares are identical.
                        !isRootSource && ofTotal ? `${ofTotal} of total` : null,
                      ];
                      return parts.filter(Boolean).join(" · ");
                    })()}
                  </title>
                </path>
              );
            })}
          </g>
          {/* Nodes + labels. */}
          <g>
            {laid.nodes.map((n, i) => {
              const onLeft = (n.x0 ?? 0) < width / 2;
              const labelX = onLeft ? (n.x1 ?? 0) + 8 : (n.x0 ?? 0) - 8;
              const nodeH = Math.max(1, (n.y1 ?? 0) - (n.y0 ?? 0));
              // Two-line labels only when the node is tall enough to own the
              // vertical space; skinny nodes keep one line ($ in the tooltip).
              const showValue = nodeH >= 26;
              const midY = ((n.y0 ?? 0) + (n.y1 ?? 0)) / 2 - (showValue ? 6 : 0);
              return (
                <g key={n.id}>
                  <rect
                    x={n.x0}
                    y={n.y0}
                    width={(n.x1 ?? 0) - (n.x0 ?? 0)}
                    height={nodeH}
                    fill={colorOf(n, i)}
                    rx={2}
                  >
                    <title>
                      {(() => {
                        const isRoot = (n.targetLinks?.length ?? 0) === 0;
                        const ofTotal = share(n.value ?? 0, grandTotal);
                        return isRoot || !ofTotal
                          ? `${n.label}: ${formatMoney(n.value ?? 0)}/mo`
                          : `${n.label}: ${formatMoney(n.value ?? 0)}/mo · ${ofTotal} of total`;
                      })()}
                    </title>
                  </rect>
                  {/* theme.vars = CSS custom properties, so the fill follows
                      the light/dark toggle live (a static theme.palette value
                      is frozen to whichever scheme was default at render). */}
                  <text
                    x={labelX}
                    y={midY}
                    textAnchor={onLeft ? "start" : "end"}
                    dominantBaseline="middle"
                    fill={theme.vars?.palette.text.primary ?? theme.palette.text.primary}
                    fontSize={12}
                    fontFamily={theme.typography.fontFamily}
                  >
                    <tspan fontWeight={600}>{n.label}</tspan>
                    {showValue ? (
                      <tspan
                        x={labelX}
                        dy={14}
                        fill={
                          theme.vars?.palette.text.secondary ??
                          theme.palette.text.secondary
                        }
                        fontSize={11}
                      >
                        {formatMoney(n.value ?? 0)}
                      </tspan>
                    ) : null}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      ) : (
        <Box sx={{ height }} aria-hidden />
      )}
    </Box>
  );
}
