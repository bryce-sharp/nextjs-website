// Display formatters (Intl-based, no date library).

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

const dateFmt = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
});

const numFmt = new Intl.NumberFormat("en-US");

export function formatMoney(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "string" ? Number(value) : value;
  return Number.isNaN(n) ? "—" : money.format(n);
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  // Drizzle `date` columns come back as "YYYY-MM-DD"; anchor at noon so local
  // timezone rendering never rolls the day backward.
  const d =
    typeof value === "string"
      ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value)
      : value;
  return Number.isNaN(d.getTime()) ? "—" : dateFmt.format(d);
}

/** "Oct 5, 9:19 PM" in a household's time zone. Format on the server so the
 *  page never depends on the viewer's clock. */
export function formatDateTime(value: string | Date, timeZone: string): string {
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

export function formatMiles(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${numFmt.format(value)} mi`;
}

/** "+$4,071.95" / "−$388.75" — money deltas that wear their sign. */
export function formatMoneySigned(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${value >= 0 ? "+" : "−"}${money.format(Math.abs(value))}`;
}

/** "In $X · Out $Y · Kept +$Z" (cash flow); just "Out $Y" when nothing came in. */
export function formatCashFlow(moneyIn: number, moneyOut: number): string {
  if (moneyIn === 0) return `Out ${formatMoney(moneyOut)}`;
  return `In ${formatMoney(moneyIn)} · Out ${formatMoney(moneyOut)} · Kept ${formatMoneySigned(moneyIn - moneyOut)}`;
}

/** "$135k" axis labels; falls back to plain currency under $10k. */
export function formatMoneyCompact(value: number): string {
  if (Math.abs(value) >= 10_000) return `$${Math.round(value / 1000)}k`;
  return money.format(value).replace(/\.\d+$/, "");
}

const wholeMoney = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/** "$143,560": dollars without cents, for balances where cents are noise. */
export function formatMoneyWhole(value: number): string {
  return wholeMoney.format(value);
}

/** "$143.6k" / "$1.2M" / "$157": a balance short enough for a phone column. */
export function formatMoneyShort(value: number): string {
  const a = Math.abs(value);
  const sign = value < 0 ? "−" : "";
  const trim = (n: number, d: number) => n.toFixed(d).replace(/\.0$/, "");
  if (a >= 999_950) return `${sign}$${trim(a / 1_000_000, a >= 9_999_500 ? 0 : 1)}M`;
  if (a >= 999.5) return `${sign}$${trim(a / 1000, 1)}k`;
  return `${sign}$${Math.round(a)}`;
}

/** formatMoneyShort / formatMoneyWhole that wear their sign: "+$17.8k", "−$2,505". */
export function formatMoneyDelta(value: number, short = false): string {
  const body = short ? formatMoneyShort(Math.abs(value)) : formatMoneyWhole(Math.abs(value));
  return `${value >= 0 ? "+" : "−"}${body}`;
}

/** "Aug 2026" from a YYYY-MM-01 month string. */
export function formatMonth(month: string): string {
  const d = new Date(`${month.slice(0, 7)}-01T12:00:00`);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}
