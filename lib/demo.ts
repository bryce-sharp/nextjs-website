// ─────────────────────────────────────────────────────────────────────────────
// DEMO GROUP RESEED — wipes and re-plants the demo group's data on EVERY demo
// login (hooked in app/actions/session.ts), so each visitor tours a pristine,
// alive-looking hub no matter what the previous visitor edited or deleted.
//
// Safety: refuses to touch any group whose isDemo flag isn't set — this
// function must never be able to wipe a real household, even if miscalled.
//
// All dates are computed relative to "today" (weigh-ins on the last ~14
// Mondays, maintenance spread over the past year), so the demo never looks
// stale. Data is fictional: profiles Alex & Sam, a '94 Miata + a CR-V daily.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  groups,
  profiles,
  vehicles,
  maintenanceRecords,
  fuelLogs,
  buildTasks,
  wishlistItems,
  journalEntries,
  exercises,
  workouts,
  workoutItems,
  workoutAssignments,
  weighIns,
  weightPlans,
  resources,
  checklists,
  financialAccounts,
  accountSnapshots,
  savingsGoals,
  recurringExpenses,
  compensationPlans,
  incomeDeductions,
} from "@/lib/db/schema";

// ── Date helpers (all ISO YYYY-MM-DD, anchored at noon UTC) ───────────────────
function daysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}
/** The Monday `weeksBack` weeks ago (0 = this week's Monday). */
function mondaysAgo(weeksBack: number): string {
  const d = new Date();
  const day = d.getUTCDay(); // 0 Sun .. 6 Sat
  d.setUTCDate(d.getUTCDate() - ((day + 6) % 7) - weeksBack * 7);
  return d.toISOString().slice(0, 10);
}
/** First-of-month ISO for the month `monthsBack` months ago (0 = this month). */
function monthsAgo(monthsBack: number): string {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - monthsBack);
  return d.toISOString().slice(0, 10);
}

export async function reseedDemoGroup(groupId: number): Promise<void> {
  const [group] = await db.select().from(groups).where(eq(groups.id, groupId)).limit(1);
  if (!group?.isDemo) {
    throw new Error("reseedDemoGroup called on a non-demo group — refusing.");
  }

  // ── Wipe (order matters: workouts RESTRICT on their creator profile) ────────
  const groupProfiles = db
    .select({ id: profiles.id })
    .from(profiles)
    .where(eq(profiles.groupId, groupId));
  await db.delete(workouts).where(inArray(workouts.createdByProfileId, groupProfiles));
  await db.delete(profiles).where(eq(profiles.groupId, groupId)); // cascades weight, schedule
  await db.delete(vehicles).where(eq(vehicles.groupId, groupId)); // cascades records/fuel/…
  await db.delete(exercises).where(eq(exercises.groupId, groupId));
  await db.delete(resources).where(eq(resources.groupId, groupId));
  await db.delete(checklists).where(eq(checklists.groupId, groupId));
  await db.delete(financialAccounts).where(eq(financialAccounts.groupId, groupId)); // cascades snapshots
  await db.delete(savingsGoals).where(eq(savingsGoals.groupId, groupId));
  // ATLAS: comp plans + deductions cascade with profiles above; the household
  // expense registry carries groupId directly, so wipe it explicitly.
  await db.delete(recurringExpenses).where(eq(recurringExpenses.groupId, groupId));

  // ── People ───────────────────────────────────────────────────────────────────
  const [alex, sam] = await db
    .insert(profiles)
    .values([
      { groupId, name: "Alex", color: "#4caf7d", sortOrder: 0 },
      { groupId, name: "Sam", color: "#7d6bd4", sortOrder: 1 },
    ])
    .returning({ id: profiles.id });

  // ── Garage: the project Miata + the daily ───────────────────────────────────
  const [miata, daily] = await db
    .insert(vehicles)
    .values([
      {
        groupId,
        name: "Project Miata",
        status: "owned",
        make: "Mazda",
        model: "MX-5 Miata",
        year: 1994,
        trim: "Base",
        color: "Classic Red",
        interiorColor: "Black",
        transmission: "5-speed manual",
        purchaseDate: daysAgo(320),
        purchasePrice: "6800.00",
        purchaseMileage: 84200,
        currentMileage: 87450,
        notes:
          "Weekend project car. Bought with a soft top in decent shape and a folder of old receipts. Plan: reliability first, then handling, then fun.",
        profileId: alex.id,
        visibility: "shared",
      },
      {
        groupId,
        name: "The Daily",
        status: "owned",
        make: "Honda",
        model: "CR-V",
        year: 2019,
        color: "Modern Steel",
        transmission: "CVT",
        purchaseDate: daysAgo(1500),
        purchasePrice: "24500.00",
        purchaseMileage: 12000,
        currentMileage: 58200,
        profileId: sam.id,
        visibility: "shared",
      },
    ])
    .returning({ id: vehicles.id });

  await db.insert(maintenanceRecords).values([
    {
      vehicleId: miata.id,
      serviceType: "Timing belt + water pump",
      category: "maintenance",
      serviceDate: daysAgo(210),
      mileage: 85100,
      cost: "420.00",
      vendor: "DIY (weekend #3)",
      notes: "Preventive — no service history past 60k. Did cam seals while in there.",
    },
    {
      vehicleId: miata.id,
      serviceType: "Oil change",
      category: "maintenance",
      serviceDate: daysAgo(45),
      mileage: 87100,
      cost: "38.50",
      vendor: "DIY",
      nextDueDate: daysAgo(-135), // ~3 months out
      nextDueMileage: 90100,
    },
    {
      vehicleId: miata.id,
      serviceType: "Tires (4) — Falken RT660",
      category: "upgrade",
      serviceDate: daysAgo(90),
      mileage: 86600,
      cost: "612.00",
      vendor: "Discount Tire",
      notes: "200TW for autocross season.",
    },
    {
      vehicleId: daily.id,
      serviceType: "Oil change + rotation",
      category: "maintenance",
      serviceDate: daysAgo(30),
      mileage: 57800,
      cost: "89.00",
      vendor: "Dealer",
      nextDueMileage: 62800,
    },
    {
      vehicleId: daily.id,
      serviceType: "Cabin air filter",
      category: "maintenance",
      serviceDate: daysAgo(30),
      mileage: 57800,
      cost: "24.00",
      vendor: "DIY",
    },
  ]);

  await db.insert(buildTasks).values([
    {
      vehicleId: miata.id,
      phase: 1,
      title: "Timing belt + water pump",
      category: "maintenance",
      priority: "high",
      status: "done",
      actualCost: "420.00",
      completedDate: daysAgo(210),
      sortOrder: 0,
    },
    {
      vehicleId: miata.id,
      phase: 1,
      title: "Replace rear main seal",
      category: "maintenance",
      priority: "medium",
      status: "in_progress",
      costEstimate: "60.00",
      sortOrder: 1,
    },
    {
      vehicleId: miata.id,
      phase: 2,
      title: "Coilovers (Xida entry or Bilstein/FM springs)",
      category: "suspension",
      priority: "high",
      status: "planned",
      costEstimate: "1400.00",
      sortOrder: 2,
    },
    {
      vehicleId: miata.id,
      phase: 2,
      title: "Front sway bar + endlinks",
      category: "suspension",
      priority: "medium",
      status: "planned",
      costEstimate: "220.00",
      sortOrder: 3,
    },
    {
      vehicleId: miata.id,
      phase: 3,
      title: "Frog Arms + frame rails",
      description: "Chassis stiffening before any power goals.",
      category: "chassis",
      priority: "low",
      status: "planned",
      costEstimate: "450.00",
      sortOrder: 4,
    },
  ]);

  await db.insert(wishlistItems).values([
    {
      vehicleId: miata.id,
      item: "OEM hardtop",
      price: "1800.00",
      rating: 5,
      priority: "high",
      notes: "The white whale. Watching marketplace weekly.",
    },
    {
      vehicleId: miata.id,
      item: "Nardi Classic 330mm",
      brand: "Nardi",
      price: "330.00",
      rating: 4,
      priority: "medium",
    },
    {
      vehicleId: miata.id,
      item: "RoadsterSport Race exhaust",
      brand: "Good-Win Racing",
      price: "465.00",
      rating: 4,
      priority: "low",
      purchased: true,
      purchasedDate: daysAgo(60),
    },
  ]);

  await db.insert(fuelLogs).values([
    { vehicleId: miata.id, fillDate: daysAgo(74), odometer: 86750, gallons: "9.8", pricePerGallon: "3.899", totalCost: "38.21" },
    { vehicleId: miata.id, fillDate: daysAgo(47), odometer: 87020, gallons: "9.2", pricePerGallon: "3.759", totalCost: "34.58" },
    { vehicleId: miata.id, fillDate: daysAgo(18), odometer: 87290, gallons: "9.5", pricePerGallon: "3.699", totalCost: "35.14" },
    { vehicleId: daily.id, fillDate: daysAgo(12), odometer: 58050, gallons: "12.1", pricePerGallon: "3.599", totalCost: "43.55" },
  ]);

  await db.insert(journalEntries).values([
    {
      vehicleId: miata.id,
      entryDate: daysAgo(120),
      title: "First autocross!",
      body: "Ran the local SCCA event on the old tires. Mid-pack in ES but grinning the whole drive home. The car needs shocks badly — everything else can wait.",
      mileage: 86400,
    },
    {
      vehicleId: miata.id,
      entryDate: daysAgo(38),
      title: "Exhaust on",
      body: "RoadsterSport installed in the driveway in an hour. Sounds like a proper roadster now without droning on the highway.",
      mileage: 87150,
    },
  ]);

  // ── Workout catalog + routines ───────────────────────────────────────────────
  const cat = await db
    .insert(exercises)
    .values([
      { groupId, name: "Jumping jacks", category: "warmup", defaultDuration: 45 },
      { groupId, name: "Arm circles", category: "warmup", defaultReps: "10 each way" },
      { groupId, name: "Bodyweight squat", category: "legs", defaultReps: "12-15" },
      { groupId, name: "Push-up", category: "push", defaultReps: "10-12" },
      { groupId, name: "Dumbbell row", category: "pull", defaultReps: "10 each side", defaultWeight: "25 lb", sides: 2, equipment: ["dumbbells"] },
      { groupId, name: "Reverse lunge", category: "legs", defaultReps: "8 each leg", sides: 2 },
      { groupId, name: "Plank", category: "core", defaultDuration: 45 },
      { groupId, name: "Dead bug", category: "core", defaultReps: "8 each side" },
      { groupId, name: "Glute bridge", category: "core", defaultReps: "15" },
      { groupId, name: "Hamstring stretch", category: "mobility", defaultDuration: 30, sides: 2 },
    ])
    .returning({ id: exercises.id, name: exercises.name });
  const ex = Object.fromEntries(cat.map((e) => [e.name, e.id]));

  const [fullBody, quickCore] = await db
    .insert(workouts)
    .values([
      {
        createdByProfileId: alex.id,
        name: "Full Body Circuit",
        rounds: 3,
        restBetweenRounds: 60,
        notes: "The default — 25 minutes, no excuses.",
        sortOrder: 0,
      },
      {
        createdByProfileId: sam.id,
        name: "Quick Core",
        rounds: 2,
        restBetweenRounds: 45,
        sortOrder: 1,
      },
    ])
    .returning({ id: workouts.id });

  await db.insert(workoutItems).values([
    { workoutId: fullBody.id, exerciseId: ex["Jumping jacks"], section: "warmup", sortOrder: 0 },
    { workoutId: fullBody.id, exerciseId: ex["Arm circles"], section: "warmup", sortOrder: 1 },
    { workoutId: fullBody.id, exerciseId: ex["Bodyweight squat"], section: "main", sortOrder: 2 },
    { workoutId: fullBody.id, exerciseId: ex["Push-up"], section: "main", sortOrder: 3 },
    { workoutId: fullBody.id, exerciseId: ex["Dumbbell row"], section: "main", sortOrder: 4 },
    { workoutId: fullBody.id, exerciseId: ex["Reverse lunge"], section: "main", sortOrder: 5 },
    { workoutId: fullBody.id, exerciseId: ex["Plank"], section: "main", sortOrder: 6 },
    { workoutId: fullBody.id, exerciseId: ex["Hamstring stretch"], section: "cooldown", sortOrder: 7 },
    { workoutId: quickCore.id, exerciseId: ex["Dead bug"], section: "main", sortOrder: 0 },
    { workoutId: quickCore.id, exerciseId: ex["Plank"], section: "main", sortOrder: 1 },
    { workoutId: quickCore.id, exerciseId: ex["Glute bridge"], section: "main", sortOrder: 2 },
  ]);

  await db.insert(workoutAssignments).values([
    { profileId: alex.id, weekday: 1, workoutId: fullBody.id },
    { profileId: alex.id, weekday: 3, workoutId: fullBody.id },
    { profileId: alex.id, weekday: 5, workoutId: fullBody.id },
    { profileId: sam.id, weekday: 2, workoutId: quickCore.id },
    { profileId: sam.id, weekday: 4, workoutId: quickCore.id },
  ]);

  // ── Weight: Alex cutting, Sam maintaining (shows both plan modes) ───────────
  // Weekly Monday weigh-ins, newest ~this week. Wobble is a fixed pattern so the
  // charts look human without being random on every reseed.
  const WEEKS = 14;
  const wobble = [0.4, -0.3, 0.6, -0.5, 0.2, -0.2, 0.8, -0.4, 0.1, -0.6, 0.5, -0.1, 0.3, -0.2];
  const rows: (typeof weighIns.$inferInsert)[] = [];
  for (let i = 0; i < WEEKS; i++) {
    const weeksBack = WEEKS - 1 - i;
    // Alex: 196 → ~185, losing ~0.8/week.
    rows.push({
      profileId: alex.id,
      measuredOn: mondaysAgo(weeksBack),
      weight: (196 - i * 0.8 + wobble[i]).toFixed(1),
    });
    // Sam: holding ~151 ± the wobble.
    rows.push({
      profileId: sam.id,
      measuredOn: mondaysAgo(weeksBack),
      weight: (151 + wobble[(i + 5) % WEEKS]).toFixed(1),
    });
  }
  await db.insert(weighIns).values(rows);

  await db.insert(weightPlans).values([
    {
      profileId: alex.id,
      mode: "lose",
      startWeight: "196.0",
      startDate: mondaysAgo(WEEKS - 1),
      goalWeight: "180.0",
      perWeekPace: "0.800",
    },
    {
      profileId: sam.id,
      mode: "maintain",
      startWeight: "151.0",
      startDate: mondaysAgo(WEEKS - 1),
      goalWeight: "151.0",
      perWeekPace: "0",
      rangeLb: "3.0",
    },
  ]);

  // ── Finance: net worth — 8 months of balances across 6 tracked accounts ─────
  // The Rewards Card is a credit card (trackBalance false) so it exists for the
  // future budget/ATLAS tabs without cluttering the monthly net-worth ritual.
  // Savings is every account owned; the goal ($1,000/mo from take-home, with
  // the 401(k) deductions on top) lives with the budget, not here.
  const accountDefs = [
    { name: "Everyday Checking", kind: "checking", start: 3800, step: 120, wob: 260 },
    { name: "High-Yield Savings", kind: "savings", start: 21000, step: 900, wob: 400 },
    { name: "Brokerage", kind: "brokerage", start: 34500, step: 650, wob: 700 },
    { name: "401(k)", kind: "retirement", start: 41000, step: 1100, wob: 300 },
    { name: "Crypto", kind: "crypto", start: 900, step: 140, wob: 180 },
    { name: "Emergency Fund", kind: "savings", start: 6000, step: 250, wob: 120 },
  ];
  const finAccounts = await db
    .insert(financialAccounts)
    .values([
      ...accountDefs.map((a, i) => ({
        groupId,
        name: a.name,
        kind: a.kind,
        sortOrder: i,
      })),
      {
        groupId,
        name: "Rewards Card",
        kind: "credit_card",
        trackBalance: false,
        carriesDiscretion: true,
        sortOrder: 6,
      },
    ])
    .returning({ id: financialAccounts.id, name: financialAccounts.name });
  const idByName = Object.fromEntries(finAccounts.map((a) => [a.name, a.id]));

  // Monthly series oldest→newest (8 months incl. the baseline). A fixed wobble
  // keeps the charts human-looking without being random on every reseed.
  const NW_MONTHS = 8;
  const nwWobble = [0.4, -0.6, 0.3, 0.8, -0.2, 0.5, -0.4, 0.1];
  const snapshotRows: (typeof accountSnapshots.$inferInsert)[] = [];
  for (let i = 0; i < NW_MONTHS; i++) {
    const month = monthsAgo(NW_MONTHS - 1 - i);
    for (const a of accountDefs) {
      const val = a.start + a.step * i + nwWobble[i] * a.wob;
      snapshotRows.push({
        accountId: idByName[a.name],
        month,
        balance: Math.max(0, Math.round(val * 100) / 100).toFixed(2),
      });
    }
  }
  await db.insert(accountSnapshots).values(snapshotRows);

  await db.insert(savingsGoals).values({
    groupId,
    monthlyGoal: "1000.00",
    startMonth: monthsAgo(NW_MONTHS - 1),
  });

  // ── Finance: ATLAS — Alex's paycheck + the household's recurring bills ──────
  // Effective-dated from the first tracked month so every view "as of now" sees
  // them. Shows off: a %-of-gross 401k (follows raises), employer benefits (not
  // subtracted from net), a semiannual bill (amortized), and a Chase-vs-bank
  // split so the spending envelope has something to compute.
  const finStart = monthsAgo(NW_MONTHS - 1);

  await db.insert(compensationPlans).values({
    profileId: alex.id,
    payFrequency: "semimonthly",
    grossPerPaycheck: "4200.00",
    baseSalary: "100800.00",
    shares: 2000,
    sharePrice: "3.5000",
    startDate: finStart,
  });

  await db.insert(incomeDeductions).values([
    { profileId: alex.id, name: "Federal Tax", type: "tax", source: "payroll", amountPerPaycheck: "520.00", startDate: finStart },
    { profileId: alex.id, name: "Social Security", type: "tax", source: "payroll", percentOfGross: "6.20", startDate: finStart },
    { profileId: alex.id, name: "Medicare", type: "tax", source: "payroll", percentOfGross: "1.45", startDate: finStart },
    { profileId: alex.id, name: "Medical", type: "insurance", source: "payroll", amountPerPaycheck: "180.00", startDate: finStart },
    { profileId: alex.id, name: "401(k)", type: "retirement", source: "payroll", percentOfGross: "8.00", depositAccountId: idByName["401(k)"], startDate: finStart },
    { profileId: alex.id, name: "HSA", type: "health", source: "payroll", amountPerPaycheck: "75.00", startDate: finStart },
    { profileId: alex.id, name: "401(k) match", type: "retirement", source: "employer", percentOfGross: "4.00", depositAccountId: idByName["401(k)"], startDate: finStart },
    { profileId: alex.id, name: "HSA contribution", type: "health", source: "employer", amountPerPaycheck: "40.00", startDate: finStart },
  ]);

  const checkingId = idByName["Everyday Checking"];
  const cardId = idByName["Rewards Card"];
  await db.insert(recurringExpenses).values([
    { groupId, name: "Rent", category: "Housing", necessity: "essential", amount: "1850.00", paymentsPerYear: 12, paidFromAccountId: checkingId, dueDay: "1st", startDate: finStart },
    { groupId, name: "Electric", category: "Utilities", necessity: "essential", amount: "140.00", paymentsPerYear: 12, paidFromAccountId: cardId, dueDay: "20th", isEstimate: true, merchantPatterns: ["POWER", "ELECTRIC"], startDate: finStart },
    { groupId, name: "Internet", category: "Utilities", necessity: "essential", amount: "75.00", paymentsPerYear: 12, paidFromAccountId: cardId, dueDay: "13th", merchantPatterns: ["FIBERNET"], startDate: finStart },
    { groupId, name: "Netflix", category: "Subscriptions", necessity: "lifestyle", amount: "19.99", paymentsPerYear: 12, paidFromAccountId: cardId, dueDay: "15th", merchantPatterns: ["NETFLIX"], startDate: finStart },
    { groupId, name: "Spotify", category: "Subscriptions", necessity: "lifestyle", amount: "11.99", paymentsPerYear: 12, paidFromAccountId: cardId, dueDay: "8th", merchantPatterns: ["SPOTIFY"], startDate: finStart },
    { groupId, name: "Car Insurance", category: "Car", necessity: "essential", amount: "1180.00", paymentsPerYear: 2, dueMonths: [3, 9], dueDay: "Mar / Sep", paidFromAccountId: cardId, startDate: finStart },
    { groupId, name: "Amazon Prime", category: "Subscriptions", necessity: "lifestyle", amount: "139.00", paymentsPerYear: 1, dueMonths: [2], dueDay: "Feb", paidFromAccountId: cardId, startDate: finStart },
    { groupId, name: "Giving", category: "Financial Commitment", necessity: "commitment", amount: "400.00", paymentsPerYear: 12, paidFromAccountId: checkingId, dueDay: "1st", startDate: finStart },
  ]);
}
