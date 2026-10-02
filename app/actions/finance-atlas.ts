"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  compensationPlans,
  incomeDeductions,
  recurringExpenses,
  financialAccounts,
} from "@/lib/db/schema";
import { requireEditor, requireEditorFor } from "@/lib/auth";
import { requireGroupId } from "@/lib/session";
import { profileInGroup } from "@/lib/queries/scope";
import {
  normalizeMonth,
  parseMoney,
  parseInt as parseBoundedInt,
  parseStr,
  todayISO,
  currentMonthISO,
} from "@/lib/finance/parse";

// ATLAS writes. Compensation + deductions are PROFILE-owned (a claimed
// person's income is theirs alone) → requireEditorFor; recurring expenses are
// HOUSEHOLD → requireEditor. Effective-dated changes always INSERT the new
// segment FIRST, then end-date the old — a crash between the two leaves a
// harmless overlap (latest-starting wins) instead of a hole.

const ATLAS = "/finance/atlas";

/** The day before an ISO date (segment chaining: old ends where new begins). */
function dayBefore(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// ── Compensation (profile-owned) ──────────────────────────────────────────────
const PAY_FREQUENCIES = new Set(["weekly", "biweekly", "semimonthly", "monthly"]);

function parseComp(formData: FormData) {
  const freqRaw = String(formData.get("payFrequency") ?? "semimonthly");
  const gross = parseMoney(formData.get("grossPerPaycheck"));
  if (gross === null) throw new Error("Gross per paycheck is required.");
  const sharePriceRaw = parseStr(formData.get("sharePrice"));
  const sharePrice =
    sharePriceRaw !== null && Number.isFinite(Number(sharePriceRaw))
      ? Number(sharePriceRaw).toFixed(4)
      : null;
  return {
    payFrequency: PAY_FREQUENCIES.has(freqRaw) ? freqRaw : "semimonthly",
    grossPerPaycheck: gross,
    baseSalary: parseMoney(formData.get("baseSalary")),
    shares: parseBoundedInt(formData.get("shares"), 0, 100_000_000),
    sharePrice,
    notes: parseStr(formData.get("notes")),
  };
}

async function activeCompPlan(profileId: number) {
  const [row] = await db
    .select()
    .from(compensationPlans)
    .where(
      and(
        eq(compensationPlans.profileId, profileId),
        isNull(compensationPlans.endDate),
      ),
    )
    .orderBy(compensationPlans.startDate)
    .limit(1);
  return row ?? null;
}

/** Fix the ACTIVE plan in place (typo — recalculates its whole span). */
export async function saveCompPlanAction(
  profileId: number,
  formData: FormData,
): Promise<void> {
  await requireEditorFor(profileId);
  const data = parseComp(formData);

  const active = await activeCompPlan(profileId);
  if (active) {
    await db
      .update(compensationPlans)
      .set(data)
      .where(eq(compensationPlans.id, active.id));
  } else {
    const startDate =
      normalizeMonth(formData.get("startMonth")) ?? currentMonthISO();
    await db.insert(compensationPlans).values({ ...data, profileId, startDate });
  }
  revalidatePath(ATLAS);
}

/**
 * Remove a person's income entirely — every compensation segment AND their
 * deductions (deductions without a plan are meaningless). Reverts them to the
 * "set up income" state. The UI confirms.
 */
export async function removeCompensationAction(
  profileId: number,
  _formData: FormData,
): Promise<void> {
  await requireEditorFor(profileId);
  await db.delete(incomeDeductions).where(eq(incomeDeductions.profileId, profileId));
  await db.delete(compensationPlans).where(eq(compensationPlans.profileId, profileId));
  revalidatePath(ATLAS);
}

/** A raise: NEW segment from a month; past months keep the old numbers. */
export async function startCompPlanAction(
  profileId: number,
  formData: FormData,
): Promise<void> {
  await requireEditorFor(profileId);
  const data = parseComp(formData);
  const startDate = normalizeMonth(formData.get("startMonth"));
  if (!startDate) throw new Error("Pick the month the change takes effect.");

  const active = await activeCompPlan(profileId);
  await db.insert(compensationPlans).values({ ...data, profileId, startDate });
  if (active) {
    await db
      .update(compensationPlans)
      .set({
        endDate:
          active.startDate < startDate ? dayBefore(startDate) : active.startDate,
      })
      .where(eq(compensationPlans.id, active.id));
  }
  revalidatePath(ATLAS);
}

// ── Income deductions (profile-owned) ─────────────────────────────────────────
const DEDUCTION_TYPES = new Set([
  "insurance",
  "retirement",
  "health",
  "tax",
  "employer_benefit",
]);

/** An account id from the form, kept only when it is one of OUR accounts. */
async function scopedAccountId(raw: FormDataEntryValue | null): Promise<number | null> {
  const id = parseBoundedInt(raw, 1, 2 ** 31);
  if (id === null) return null;
  const groupId = await requireGroupId();
  const [acct] = await db
    .select({ id: financialAccounts.id })
    .from(financialAccounts)
    .where(and(eq(financialAccounts.id, id), eq(financialAccounts.groupId, groupId)))
    .limit(1);
  return acct ? id : null;
}

async function parseDeduction(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Name is required.");
  const typeRaw = parseStr(formData.get("type"));

  // Exactly one of flat-$ or %-of-gross (percent rows track raises for free).
  let amountPerPaycheck: string | null = null;
  let percentOfGross: string | null = null;
  if (formData.get("amountMode") === "percent") {
    const raw = parseStr(formData.get("percentOfGross"));
    const pct = raw !== null ? Number(raw) : NaN;
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
      throw new Error("Percent of gross must be between 0 and 100.");
    }
    percentOfGross = pct.toFixed(2);
  } else {
    amountPerPaycheck = parseMoney(formData.get("amountPerPaycheck"));
    if (amountPerPaycheck === null) {
      throw new Error("Amount per paycheck is required.");
    }
  }

  return {
    name,
    type: typeRaw !== null && DEDUCTION_TYPES.has(typeRaw) ? typeRaw : null,
    source: formData.get("source") === "employer" ? "employer" : "payroll",
    amountPerPaycheck,
    percentOfGross,
    depositAccountId: await scopedAccountId(formData.get("depositAccountId")),
    notes: parseStr(formData.get("notes")),
  };
}

/** A deduction row, only if its profile is in OUR group. */
async function scopedDeduction(id: number) {
  const groupId = await requireGroupId();
  const [row] = await db
    .select()
    .from(incomeDeductions)
    .where(
      and(
        eq(incomeDeductions.id, id),
        profileInGroup(incomeDeductions.profileId, groupId),
      ),
    )
    .limit(1);
  if (!row) throw new Error("Deduction not found.");
  return row;
}

export async function addDeductionAction(
  profileId: number,
  formData: FormData,
): Promise<void> {
  await requireEditorFor(profileId);
  const data = await parseDeduction(formData);
  const startDate =
    normalizeMonth(formData.get("startMonth")) ?? currentMonthISO();
  await db.insert(incomeDeductions).values({ ...data, profileId, startDate });
  revalidatePath(ATLAS);
}

/** Fix a row in place (typo — changes its whole effective span). */
export async function updateDeductionAction(
  id: number,
  formData: FormData,
): Promise<void> {
  const row = await scopedDeduction(id);
  await requireEditorFor(row.profileId);
  await db
    .update(incomeDeductions)
    .set(await parseDeduction(formData))
    .where(eq(incomeDeductions.id, id));
  revalidatePath(ATLAS);
}

/** "Changed as of month M": new segment M-forward, old keeps history. */
export async function replaceDeductionAction(
  id: number,
  formData: FormData,
): Promise<void> {
  const row = await scopedDeduction(id);
  await requireEditorFor(row.profileId);
  const data = await parseDeduction(formData);
  const startDate = normalizeMonth(formData.get("startMonth"));
  if (!startDate) throw new Error("Pick the month the change takes effect.");

  await db
    .insert(incomeDeductions)
    .values({ ...data, profileId: row.profileId, startDate });
  await db
    .update(incomeDeductions)
    .set({ endDate: row.startDate < startDate ? dayBefore(startDate) : row.startDate })
    .where(eq(incomeDeductions.id, id));
  revalidatePath(ATLAS);
}

/** Retire a deduction (it ended in real life) — history intact. */
export async function endDeductionAction(
  id: number,
  _formData: FormData,
): Promise<void> {
  const row = await scopedDeduction(id);
  await requireEditorFor(row.profileId);
  await db
    .update(incomeDeductions)
    .set({ endDate: todayISO() })
    .where(eq(incomeDeductions.id, id));
  revalidatePath(ATLAS);
}

/** Hard delete (added by mistake) — gone from every month it touched. */
export async function deleteDeductionAction(
  id: number,
  _formData: FormData,
): Promise<void> {
  const row = await scopedDeduction(id);
  await requireEditorFor(row.profileId);
  await db.delete(incomeDeductions).where(eq(incomeDeductions.id, id));
  revalidatePath(ATLAS);
}

// ── Categories (usage-derived — no table; a category exists because a bill uses
// it). Rename and merge are the SAME bulk update: set the category string on
// every matching row. "to" null = Uncategorized. ───────────────────────────────
export async function reassignCategoryAction(
  from: string,
  to: string | null,
  _formData: FormData,
): Promise<void> {
  await requireEditor();
  const groupId = await requireGroupId();
  const target = to?.trim() || null;
  if (!from.trim() || from.trim() === target) return;

  await db
    .update(recurringExpenses)
    .set({ category: target })
    .where(
      and(
        eq(recurringExpenses.groupId, groupId),
        eq(recurringExpenses.category, from),
      ),
    );
  revalidatePath(ATLAS);
}

// ── Recurring expenses (household) ────────────────────────────────────────────
const NECESSITIES = new Set(["essential", "lifestyle", "commitment"]);

async function parseExpense(formData: FormData) {
  const groupId = await requireGroupId();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Name is required.");
  const amount = parseMoney(formData.get("amount"));
  if (amount === null) throw new Error("Amount is required.");
  const necessityRaw = String(formData.get("necessity") ?? "essential");

  // dueMonths arrives as a JSON array of 1..12 (or empty for evenly spaced).
  let dueMonths: number[] | null = null;
  const dueRaw = parseStr(formData.get("dueMonths"));
  if (dueRaw) {
    try {
      const parsed: unknown = JSON.parse(dueRaw);
      if (Array.isArray(parsed)) {
        const clean = [...new Set(parsed.map(Number))]
          .filter((n) => Number.isInteger(n) && n >= 1 && n <= 12)
          .sort((a, b) => a - b);
        dueMonths = clean.length ? clean : null;
      }
    } catch {
      dueMonths = null;
    }
  }

  // Merchant patterns: one per line, deduped, longest kept as typed.
  const patterns = String(formData.get("merchantPatterns") ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  // paidFrom must be one of OUR accounts (or none).
  let paidFromAccountId = parseBoundedInt(formData.get("paidFromAccountId"), 1, 2 ** 31);
  if (paidFromAccountId !== null) {
    const [acct] = await db
      .select({ id: financialAccounts.id })
      .from(financialAccounts)
      .where(
        and(
          eq(financialAccounts.id, paidFromAccountId),
          eq(financialAccounts.groupId, groupId),
        ),
      )
      .limit(1);
    if (!acct) paidFromAccountId = null;
  }

  return {
    name,
    category: parseStr(formData.get("category")),
    necessity: NECESSITIES.has(necessityRaw) ? necessityRaw : "essential",
    amount,
    paymentsPerYear: parseBoundedInt(formData.get("paymentsPerYear"), 1, 52) ?? 12,
    dueMonths,
    dueDay: parseStr(formData.get("dueDay")),
    paidFromAccountId,
    isEstimate: formData.get("isEstimate") != null,
    merchantPatterns: [...new Set(patterns)],
    notes: parseStr(formData.get("notes")),
  };
}

/** An expense row in OUR group. */
async function scopedExpense(id: number) {
  const groupId = await requireGroupId();
  const [row] = await db
    .select()
    .from(recurringExpenses)
    .where(
      and(eq(recurringExpenses.id, id), eq(recurringExpenses.groupId, groupId)),
    )
    .limit(1);
  if (!row) throw new Error("Expense not found.");
  return row;
}

export async function addExpenseAction(formData: FormData): Promise<void> {
  await requireEditor();
  const groupId = await requireGroupId();
  const data = await parseExpense(formData);
  const startDate =
    normalizeMonth(formData.get("startMonth")) ?? currentMonthISO();
  await db.insert(recurringExpenses).values({ ...data, groupId, startDate });
  revalidatePath(ATLAS);
}

/** Fix a bill in place (typo — its whole effective span changes). */
export async function updateExpenseAction(
  id: number,
  formData: FormData,
): Promise<void> {
  await requireEditor();
  const row = await scopedExpense(id);
  await db
    .update(recurringExpenses)
    .set(await parseExpense(formData))
    .where(eq(recurringExpenses.id, row.id));
  revalidatePath(ATLAS);
}

/** "Price changed as of month M": new segment; past months keep the old. */
export async function replaceExpenseAction(
  id: number,
  formData: FormData,
): Promise<void> {
  await requireEditor();
  const row = await scopedExpense(id);
  const data = await parseExpense(formData);
  const startDate = normalizeMonth(formData.get("startMonth"));
  if (!startDate) throw new Error("Pick the month the change takes effect.");

  await db
    .insert(recurringExpenses)
    .values({ ...data, groupId: row.groupId, startDate });
  await db
    .update(recurringExpenses)
    .set({ endDate: row.startDate < startDate ? dayBefore(startDate) : row.startDate })
    .where(eq(recurringExpenses.id, row.id));
  revalidatePath(ATLAS);
}

/** The bill ended in real life (canceled Netflix) — history intact. */
export async function endExpenseAction(
  id: number,
  _formData: FormData,
): Promise<void> {
  await requireEditor();
  const row = await scopedExpense(id);
  await db
    .update(recurringExpenses)
    .set({ endDate: todayISO() })
    .where(eq(recurringExpenses.id, row.id));
  revalidatePath(ATLAS);
}

/** Hard delete (added by mistake) — gone from every month it touched. */
export async function deleteExpenseAction(
  id: number,
  _formData: FormData,
): Promise<void> {
  await requireEditor();
  const row = await scopedExpense(id);
  await db.delete(recurringExpenses).where(eq(recurringExpenses.id, row.id));
  revalidatePath(ATLAS);
}
