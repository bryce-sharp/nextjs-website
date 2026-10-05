// ─────────────────────────────────────────────────────────────────────────────
// CARD-ALERT PARSING + MERCHANT CATEGORIZATION — a faithful port of the gist's
// battle-tested logic (years of real Chase texts), pure and dependency-free so
// it can be tested directly with node and reused by the ingest route, manual
// re-parses, and demo seeding alike.
//
// Format accepted (case-insensitive) — the raw Chase alert the iOS Shortcut
// forwards verbatim:
//   "You made a $52.16 transaction with CHICK-FIL-A #01975 on Aug 9, 2026"
//
// The pipe is intentionally dumb: no manual prefixes. Everything is categorized
// automatically by MERCHANT (see categorizeMerchant); anything else the user
// adjusts in the app. Unparseable text is NOT an error here — the caller stores
// it as a needs-review row so nothing is ever silently dropped.
// ─────────────────────────────────────────────────────────────────────────────

import { ianaForAbbrev, zonedWallToInstant } from "@/lib/finance/parse";

export type ParsedAlert = {
  /** Dollars as a "1234.56" string (DB numeric-friendly). */
  amount: string;
  merchant: string;
  /** YYYY-MM-DD, as written in the alert (i.e. in the alert's own zone). */
  postedOn: string;
  /** Exact instant (ms) when the alert carried a time + a zone we recognize.
   *  Lets the caller re-derive the date in the HOUSEHOLD zone — near midnight a
   *  Chase "12:52 AM ET" is the previous day in Central. Absent → postedOn stands. */
  instant?: number;
};

// The gist's main-alert regex, verbatim in spirit — matches anywhere in the text.
//
// Every quantifier is BOUNDED on purpose. The pattern is unanchored, so the
// engine retries at each start offset; an unbounded `(.+)` before ` on ` made
// that O(n²) on hostile input ("You made a $, transaction with aaaa…"), which
// is a denial-of-service on the ingest route (CodeQL js/polynomial-redos).
// Bounding caps the work per offset at a constant, so the scan is linear. The
// limits are far past any real card alert — a merchant field is ~20 chars, and
// "September" is the longest month — so nothing that used to parse stops.
// The trailing "at H:MM AM/PM ET" is OPTIONAL and separately captured (groups
// 4-7): Chase stamps its clock in Eastern, so when it's present we convert the
// instant into the household's zone rather than trusting the written date.
const TXN_RE =
  /You made a \$([\d,.]{1,20}) transaction with (.{1,120}) on (\w{1,12} \d{1,2}, \d{4})(?: at (\d{1,2}):(\d{2})\s*([AP]M)\s*([A-Za-z]{2,4}))?/i;

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  january: 1, february: 2, march: 3, april: 4, june: 6, july: 7,
  august: 8, september: 9, october: 10, november: 11, december: 12,
};

/** "Aug 9, 2026" / "August 09, 2026" → "2026-08-09"; null if bogus. */
export function parseAlertDate(raw: string): string | null {
  const m = /^\s*(\w+)\s+(\d{1,2}),\s*(\d{4})\s*$/.exec(raw);
  if (!m) return null;
  const month = MONTHS[m[1].toLowerCase()];
  const day = Number(m[2]);
  const year = Number(m[3]);
  if (!month || day < 1 || day > 31) return null;
  // Round-trip through Date to reject impossible days (Feb 30…).
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** "1,234.5" → "1234.50"; null for NaN/negative/zero-ish garbage. */
function parseAmount(raw: string): string | null {
  const n = Number.parseFloat(raw.replace(/,/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n.toFixed(2);
}

/** Parse one alert text. Null = unparseable (caller makes a review row). */
export function parseAlertText(text: string): ParsedAlert | null {
  const main = TXN_RE.exec(text);
  if (!main) return null;
  const amount = parseAmount(main[1]);
  const postedOn = parseAlertDate(main[3]);
  if (!amount || !postedOn) return null;

  const result: ParsedAlert = { amount, merchant: main[2].trim(), postedOn };

  // Time + a zone we know? Hand back the exact instant so the caller can date
  // it in the household's zone (12:52 AM ET → the day before, out west).
  const iana = main[7] ? ianaForAbbrev(main[7]) : null;
  if (main[4] && main[6] && iana) {
    const [y, mo, d] = postedOn.split("-").map(Number);
    let h = Number(main[4]) % 12; // 12 AM → 0
    if (main[6].toUpperCase() === "PM") h += 12; // 12 PM → 12, 1 PM → 13
    result.instant = zonedWallToInstant(y, mo, d, h, Number(main[5]), iana);
  }
  return result;
}

// ── Categorization ────────────────────────────────────────────────────────────
/** One recurring bill's matching rules, as the categorizer needs them. */
export type MerchantRule = {
  recurringExpenseId: number;
  /** 12 = a monthly bill ("fixed" lane); anything else amortizes. */
  paymentsPerYear: number;
  /** Substrings as they appear in card alerts (e.g. "PROGRESSIVE INS"). */
  patterns: string[];
  /** The bill's ATLAS category — a matched fixed/amortized txn inherits it as
   *  its spend-category (F4c). Null if the bill has no category set. */
  category: string | null;
  /** Expected amount per payment. When several bills match the same text
   *  (tithing and offerings at one church, two subscriptions from one store),
   *  the closest amount picks the bill. */
  amount?: number | null;
};

export type Categorized = {
  category: "discretionary" | "fixed" | "amortized";
  recurringExpenseId: number | null;
};

/**
 * Categorize purely by MERCHANT: fixed merchant match → amortized match →
 * discretionary. Patterns are matched longest-first across ALL rules so
 * "SPECTRUM MOBILE" beats "SPECTRUM", case-insensitively, substring-style.
 * Anything that isn't a known recurring bill lands in discretionary; the user
 * re-files reimbursements / savings / funds in the app. Given the amount, an
 * equally specific match on several bills goes to the closest expected amount.
 */
export function categorizeMerchant(
  merchant: string,
  rules: MerchantRule[],
  amount?: number,
): Categorized {
  const m = merchant.toLowerCase();
  const flat = rules
    .flatMap((r) =>
      r.patterns.map((p) => ({
        pattern: p.toLowerCase(),
        recurringExpenseId: r.recurringExpenseId,
        fixed: r.paymentsPerYear === 12,
        amount: r.amount ?? null,
      })),
    )
    .filter((r) => r.pattern.length > 0)
    .sort((a, b) => b.pattern.length - a.pattern.length);

  // Fixed rules win over amortized at equal specificity (gist checked fixed
  // first) — implemented as: first pass fixed-only, second pass amortized.
  let winner: (typeof flat)[number] | undefined;
  for (const pass of [true, false]) {
    winner = flat.find((r) => r.fixed === pass && m.includes(r.pattern));
    if (winner) break;
  }
  if (!winner) return { category: "discretionary", recurringExpenseId: null };

  if (amount != null && Number.isFinite(amount)) {
    const length = winner.pattern.length;
    const ties = flat.filter((r) => r.pattern.length === length && r.amount != null && m.includes(r.pattern));
    if (new Set(ties.map((t) => t.recurringExpenseId)).size > 1) {
      const target = Math.abs(amount);
      winner = ties.reduce((best, r) =>
        Math.abs(r.amount! - target) < Math.abs(best.amount! - target) ? r : best,
      );
    }
  }
  return {
    category: winner.fixed ? "fixed" : "amortized",
    recurringExpenseId: winner.recurringExpenseId,
  };
}
