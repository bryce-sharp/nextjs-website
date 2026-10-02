// Build the ATLAS "planned money flow" Sankey graph — a PURE function from
// already-derived monthly numbers to nodes+links, so the server page computes
// it and the client SankeyChart just draws. Layers:
//
//   gross paycheck(s) → payroll deductions + net income
//   net income        → expense categories + savings goal + discretionary
//
// Employer-paid benefits are deliberately absent: they never pass through the
// paycheck, and drawing them as income inflates the picture. (F4's actuals
// Sankey, fed by real transactions, is where reality replaces this plan.)

import type { SankeyNodeInput, SankeyLinkInput } from "@/components/finance/SankeyChart";

export type AtlasFlowPerson = {
  name: string;
  grossMonthly: number;
  monthlyNet: number;
  deductions: {
    name: string;
    source: string; // payroll | employer
    type: string | null;
    monthly: number;
  }[];
};

export type AtlasFlowInput = {
  people: AtlasFlowPerson[];
  byCategory: { category: string; monthly: number }[];
  savingsGoal: number;
  discretionLeft: number;
};

const NET_COLOR = "#3fa796"; // the finance accent
const DISCRETION_COLOR = "#e0864f";
const SAVINGS_COLOR = "#4caf7d";
const DEDUCTION_COLORS: Record<string, string> = {
  tax: "#d45d7a",
  insurance: "#c9a227",
  retirement: "#4f86e0",
  health: "#4caf7d",
};
const CATEGORY_PALETTE = [
  "#4f86e0",
  "#4caf7d",
  "#9c6bd4",
  "#c9a227",
  "#d45d7a",
  "#7a8699",
  "#3fa796",
  "#e0864f",
];

export function buildAtlasFlows(input: AtlasFlowInput): {
  nodes: SankeyNodeInput[];
  links: SankeyLinkInput[];
} {
  const nodes: SankeyNodeInput[] = [];
  const links: SankeyLinkInput[] = [];
  const people = input.people.filter((p) => p.grossMonthly > 0);
  if (people.length === 0) return { nodes, links };

  const multi = people.length > 1;
  const net = { id: "net", label: "Net income", color: NET_COLOR };

  for (const [i, p] of people.entries()) {
    const grossId = `gross-${i}`;
    nodes.push({
      id: grossId,
      label: multi ? `${p.name}'s gross` : "Gross paycheck",
      color: NET_COLOR,
    });

    for (const [j, d] of p.deductions.entries()) {
      if (d.source !== "payroll" || d.monthly <= 0) continue;
      const id = `ded-${i}-${j}`;
      nodes.push({
        id,
        label: multi ? `${p.name[0]} · ${d.name}` : d.name,
        color: DEDUCTION_COLORS[d.type ?? ""] ?? "#7a8699",
      });
      links.push({ source: grossId, target: id, value: d.monthly });
    }
    if (p.monthlyNet > 0) {
      links.push({ source: grossId, target: net.id, value: p.monthlyNet });
    }
  }
  nodes.push(net);

  for (const [i, c] of input.byCategory.entries()) {
    if (c.monthly <= 0) continue;
    const id = `cat-${i}`;
    nodes.push({
      id,
      label: c.category,
      color: CATEGORY_PALETTE[i % CATEGORY_PALETTE.length],
    });
    links.push({ source: net.id, target: id, value: c.monthly });
  }

  if (input.savingsGoal > 0) {
    nodes.push({ id: "savings", label: "Savings (take-home)", color: SAVINGS_COLOR });
    links.push({ source: net.id, target: "savings", value: input.savingsGoal });
  }

  if (input.discretionLeft > 0) {
    nodes.push({ id: "discretion", label: "Discretionary", color: DISCRETION_COLOR });
    links.push({ source: net.id, target: "discretion", value: input.discretionLeft });
  }

  return { nodes, links };
}
