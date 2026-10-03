"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { weighIns, weightPlans } from "@/lib/db/schema";
import { requireEditorFor } from "@/lib/auth";
import { getActivePlan } from "@/lib/queries/weight";

// Whole weeks between two YYYY-MM-DD dates (≥1, so deadline math never divides by 0).
function weeksBetween(startISO: string, endISO: string): number {
  const ms = new Date(`${endISO}T12:00:00Z`).getTime() - new Date(`${startISO}T12:00:00Z`).getTime();
  return Math.max(1, Math.round(ms / (7 * 86_400_000)));
}

// Weigh-ins & goals are OWNED by a profile (Bryce's ≠ Lauren's), so every write
// goes through requireEditorFor(profileId) — the same owner-gate workouts use.
// Viewing and logging are open to the household; a claimed person's data is theirs alone.

const str = (formData: FormData, k: string) => {
  const v = String(formData.get(k) ?? "").trim();
  return v === "" ? null : v;
};

/** Log (or overwrite) a weigh-in for a day. Unique (profile, day) → idempotent. */
export async function logWeight(profileId: number, formData: FormData): Promise<void> {
  await requireEditorFor(profileId);

  const measuredOn = str(formData, "measuredOn");
  const weight = str(formData, "weight");
  const note = str(formData, "note");
  if (!measuredOn) throw new Error("Date is required.");
  if (!weight) throw new Error("Weight is required.");

  await db
    .insert(weighIns)
    .values({ profileId, measuredOn, weight, note })
    .onConflictDoUpdate({
      target: [weighIns.profileId, weighIns.measuredOn],
      set: { weight, note },
    });

  revalidatePath("/weight");
  revalidatePath("/weight/history");
}

/**
 * Start a FRESH plan from a chosen date (default today), ending the current one
 * the day before so plans never overlap. This is the "switch mode / new season"
 * chaining tool (lose → maintain, or a dated cut). `mode` picks the shape:
 *   • lose      → pace or target-date (same as savePlan)
 *   • maintain  → hold weight (goalWeight) ± rangeLb band, pace 0
 */
export async function startPlan(profileId: number, formData: FormData): Promise<void> {
  await requireEditorFor(profileId);
  const values = buildPlanValues(formData);

  // Close the current plan the day before the new one starts (no overlap).
  const active = await getActivePlan(profileId);
  if (active) {
    const d = new Date(`${values.startDate}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    await db
      .update(weightPlans)
      .set({ endDate: d.toISOString().slice(0, 10), updatedAt: new Date() })
      .where(and(eq(weightPlans.id, active.id), eq(weightPlans.profileId, profileId)));
  }

  await db.insert(weightPlans).values({ ...values, profileId });

  revalidatePath("/weight");
  revalidatePath("/weight/history");
}

/** Edit an existing weigh-in by id (can change its date/weight/note). */
export async function updateWeighIn(
  id: number,
  profileId: number,
  formData: FormData,
): Promise<void> {
  await requireEditorFor(profileId);

  const measuredOn = str(formData, "measuredOn");
  const weight = str(formData, "weight");
  const note = str(formData, "note");
  if (!measuredOn) throw new Error("Date is required.");
  if (!weight) throw new Error("Weight is required.");

  await db
    .update(weighIns)
    .set({ measuredOn, weight, note })
    .where(and(eq(weighIns.id, id), eq(weighIns.profileId, profileId)));

  revalidatePath("/weight");
  revalidatePath("/weight/history");
}

/** Remove a weigh-in (scoped to the profile so you can't delete another's). */
export async function deleteWeighIn(
  id: number,
  profileId: number,
  _formData: FormData,
): Promise<void> {
  await requireEditorFor(profileId);

  await db
    .delete(weighIns)
    .where(and(eq(weighIns.id, id), eq(weighIns.profileId, profileId)));

  revalidatePath("/weight");
  revalidatePath("/weight/history");
}

// Parse a plan form (lose or maintain) into DB values. Lose = pace OR a target
// date (deadline → pace derived, endDate = deadline). Maintain = a flat band, so
// startWeight = the hold weight (goalWeight), pace 0, and a rangeLb ± band.
function buildPlanValues(formData: FormData) {
  const mode = str(formData, "mode") ?? "lose";
  const startDate = str(formData, "startDate");
  const goalWeight = str(formData, "goalWeight");
  if (!startDate || !goalWeight) {
    throw new Error("Start date and goal weight are required.");
  }

  let startWeight = str(formData, "startWeight");
  let perWeekPace = str(formData, "perWeekPace") ?? "0";
  let rangeLb: string | null = null;
  let endDate: string | null = null;

  if (mode === "maintain") {
    startWeight = startWeight ?? goalWeight; // start maintaining AT the hold weight
    rangeLb = str(formData, "rangeLb") ?? "3";
    perWeekPace = "0";
  } else {
    if (!startWeight) throw new Error("Start weight is required.");
    const paceMode = str(formData, "paceMode") ?? "pace";
    if (paceMode === "date") {
      const targetDate = str(formData, "targetDate");
      if (!targetDate) throw new Error("Target date is required.");
      perWeekPace = (
        (Number(startWeight) - Number(goalWeight)) / weeksBetween(startDate, targetDate)
      ).toFixed(3);
      endDate = targetDate;
    } else if (!str(formData, "perWeekPace")) {
      throw new Error("Pace is required.");
    }
  }

  return {
    mode,
    startWeight: startWeight ?? goalWeight,
    startDate,
    goalWeight,
    perWeekPace,
    rangeLb,
    endDate,
  };
}

/** Create or edit the ACTIVE plan in place (same timeframe; lose or maintain). */
export async function savePlan(profileId: number, formData: FormData): Promise<void> {
  await requireEditorFor(profileId);
  const values = buildPlanValues(formData);

  const active = await getActivePlan(profileId);
  if (active) {
    await db
      .update(weightPlans)
      .set({ ...values, updatedAt: new Date() })
      .where(and(eq(weightPlans.id, active.id), eq(weightPlans.profileId, profileId)));
  } else {
    await db.insert(weightPlans).values({ ...values, profileId });
  }

  revalidatePath("/weight");
  revalidatePath("/weight/history");
}
