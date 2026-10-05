// ─────────────────────────────────────────────────────────────────────────────
// DATABASE SCHEMA (Drizzle / Postgres on Neon)
//
// One source of truth for every table. Change here, then `npm run db:push`
// syncs it to the live database. Status/category/priority fields are plain
// text (documented inline) rather than PG enums — deliberately flexible so the
// app can evolve without painful enum migrations.
// ─────────────────────────────────────────────────────────────────────────────

import {
  pgTable,
  serial,
  varchar,
  text,
  integer,
  numeric,
  boolean,
  date,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).defaultNow().notNull();

// ── Vehicles ────────────────────────────────────────────────────────────────
// Owned cars, sold cars, and the future dream Miata (status = 'dream').
export const vehicles = pgTable("vehicles", {
  id: serial("id").primaryKey(),
  groupId: integer("group_id").notNull().references(() => groups.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 120 }).notNull(),
  status: varchar("status", { length: 20 }).notNull().default("owned"), // owned | prospect | dream | sold
  make: varchar("make", { length: 80 }),
  model: varchar("model", { length: 80 }),
  year: integer("year"),
  trim: varchar("trim", { length: 80 }),
  vin: varchar("vin", { length: 40 }),
  licensePlate: varchar("license_plate", { length: 20 }),
  color: varchar("color", { length: 60 }),
  interiorColor: varchar("interior_color", { length: 60 }),
  transmission: varchar("transmission", { length: 40 }),
  purchaseDate: date("purchase_date"),
  purchasePrice: numeric("purchase_price", { precision: 10, scale: 2 }),
  purchaseMileage: integer("purchase_mileage"),
  currentMileage: integer("current_mileage"),
  heroPhotoUrl: text("hero_photo_url"),
  notes: text("notes"),
  // Owner + visibility — see ARCHITECTURE "Profiles, visibility & access". Profiles
  // aren't a security boundary; visibility is organization, not permission. A
  // `shared` car shows in everyone's garage, a `private` one only in its owner's.
  profileId: integer("profile_id").references(() => profiles.id, {
    onDelete: "set null",
  }),
  visibility: varchar("visibility", { length: 20 }).notNull().default("shared"), // shared | private
  createdAt: createdAt(),
});

// ── Maintenance records ───────────────────────────────────────────────────────
export const maintenanceRecords = pgTable(
  "maintenance_records",
  {
    id: serial("id").primaryKey(),
    vehicleId: integer("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "cascade" }),
    serviceType: varchar("service_type", { length: 120 }).notNull(),
    category: varchar("category", { length: 40 }), // maintenance | repair | upgrade | cosmetic | safety
    serviceDate: date("service_date").notNull(),
    mileage: integer("mileage"),
    cost: numeric("cost", { precision: 10, scale: 2 }),
    vendor: varchar("vendor", { length: 120 }),
    notes: text("notes"),
    nextDueDate: date("next_due_date"), // reminders
    nextDueMileage: integer("next_due_mileage"),
    createdAt: createdAt(),
  },
  (t) => [index("idx_records_vehicle").on(t.vehicleId)],
);

// ── Fuel logs (MPG computed in queries) ───────────────────────────────────────
export const fuelLogs = pgTable(
  "fuel_logs",
  {
    id: serial("id").primaryKey(),
    vehicleId: integer("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "cascade" }),
    fillDate: date("fill_date").notNull(),
    odometer: integer("odometer"),
    gallons: numeric("gallons", { precision: 7, scale: 3 }),
    pricePerGallon: numeric("price_per_gallon", { precision: 6, scale: 3 }),
    totalCost: numeric("total_cost", { precision: 10, scale: 2 }),
    isFullTank: boolean("is_full_tank").notNull().default(true),
    notes: text("notes"),
    createdAt: createdAt(),
  },
  (t) => [index("idx_fuel_vehicle").on(t.vehicleId)],
);

// ── Parts inventory ───────────────────────────────────────────────────────────
export const parts = pgTable("parts", {
  id: serial("id").primaryKey(),
  vehicleId: integer("vehicle_id").references(() => vehicles.id, {
    onDelete: "cascade",
  }),
  name: varchar("name", { length: 160 }).notNull(),
  brand: varchar("brand", { length: 120 }),
  partNumber: varchar("part_number", { length: 80 }),
  category: varchar("category", { length: 40 }),
  link: text("link"),
  cost: numeric("cost", { precision: 10, scale: 2 }),
  installedDate: date("installed_date"),
  maintenanceRecordId: integer("maintenance_record_id").references(
    () => maintenanceRecords.id,
    { onDelete: "set null" },
  ),
  notes: text("notes"),
  createdAt: createdAt(),
});

// ── Build tasks (phased plan + goals + immediate-maintenance list) ────────────
export const buildTasks = pgTable("build_tasks", {
  id: serial("id").primaryKey(),
  vehicleId: integer("vehicle_id")
    .notNull()
    .references(() => vehicles.id, { onDelete: "cascade" }),
  phase: integer("phase"), // 1..6 (Reliability→Power); null = general goal
  title: varchar("title", { length: 160 }).notNull(),
  description: text("description"),
  category: varchar("category", { length: 40 }),
  priority: varchar("priority", { length: 20 }).default("medium"), // high | medium | low
  status: varchar("status", { length: 20 }).notNull().default("planned"), // planned | in_progress | done
  costEstimate: numeric("cost_estimate", { precision: 10, scale: 2 }),
  actualCost: numeric("actual_cost", { precision: 10, scale: 2 }),
  completedDate: date("completed_date"),
  sortOrder: integer("sort_order").default(0),
  createdAt: createdAt(),
});

// ── Wishlist / dream parts (with budget tracking) ─────────────────────────────
export const wishlistItems = pgTable("wishlist_items", {
  id: serial("id").primaryKey(),
  vehicleId: integer("vehicle_id").references(() => vehicles.id, {
    onDelete: "cascade",
  }),
  item: varchar("item", { length: 160 }).notNull(),
  brand: varchar("brand", { length: 120 }),
  price: numeric("price", { precision: 10, scale: 2 }),
  rating: integer("rating"), // 1..5
  priority: varchar("priority", { length: 20 }).default("medium"),
  link: text("link"),
  purchased: boolean("purchased").notNull().default(false),
  purchasedDate: date("purchased_date"),
  notes: text("notes"),
  createdAt: createdAt(),
});

// ── Build journal ─────────────────────────────────────────────────────────────
export const journalEntries = pgTable("journal_entries", {
  id: serial("id").primaryKey(),
  vehicleId: integer("vehicle_id")
    .notNull()
    .references(() => vehicles.id, { onDelete: "cascade" }),
  entryDate: date("entry_date").notNull(),
  title: varchar("title", { length: 200 }),
  body: text("body").notNull(),
  mileage: integer("mileage"),
  createdAt: createdAt(),
});

// ── Inspection checklists (one per candidate car you go look at) ───────────────
export const checklists = pgTable("checklists", {
  id: serial("id").primaryKey(),
  groupId: integer("group_id").notNull().references(() => groups.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 200 }).notNull(),
  vehicleId: integer("vehicle_id").references(() => vehicles.id, {
    onDelete: "set null",
  }),
  year: integer("year"),
  price: numeric("price", { precision: 10, scale: 2 }),
  location: varchar("location", { length: 160 }),
  seller: varchar("seller", { length: 160 }),
  mileage: integer("mileage"),
  link: text("link"),
  verdict: varchar("verdict", { length: 40 }), // undecided | pass | notes | walk-away
  inspectedDate: date("inspected_date"),
  overallNotes: text("overall_notes"),
  createdAt: createdAt(),
});

export const checklistItems = pgTable(
  "checklist_items",
  {
    id: serial("id").primaryKey(),
    checklistId: integer("checklist_id")
      .notNull()
      .references(() => checklists.id, { onDelete: "cascade" }),
    category: varchar("category", { length: 60 }),
    label: varchar("label", { length: 240 }).notNull(),
    status: varchar("status", { length: 20 }).default("unchecked"), // ok | concern | fail | unchecked
    checked: boolean("checked").notNull().default(false),
    notes: text("notes"),
    sortOrder: integer("sort_order").default(0),
  },
  (t) => [index("idx_checklist_items_checklist").on(t.checklistId)],
);

// ── Attachments (photos / receipts) — polymorphic owner ───────────────────────
// No group_id ON PURPOSE: the polymorphic (ownerType, ownerId) parent is always
// a group-scoped row, and attachments are only ever fetched through an already-
// authorized owner. Revisit if attachments ever get a standalone listing.
export const attachments = pgTable(
  "attachments",
  {
    id: serial("id").primaryKey(),
    ownerType: varchar("owner_type", { length: 40 }).notNull(), // vehicle | maintenance | journal | wishlist
    ownerId: integer("owner_id").notNull(),
    url: text("url").notNull(),
    pathname: text("pathname"),
    contentType: varchar("content_type", { length: 80 }),
    caption: varchar("caption", { length: 240 }),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index("idx_attachments_owner").on(t.ownerType, t.ownerId)],
);

// ── Resources (links / specs you collect over time) ───────────────────────────
export const resources = pgTable("resources", {
  id: serial("id").primaryKey(),
  groupId: integer("group_id").notNull().references(() => groups.id, { onDelete: "cascade" }),
  category: varchar("category", { length: 60 }),
  title: varchar("title", { length: 200 }).notNull(),
  url: text("url"),
  notes: text("notes"),
  sortOrder: integer("sort_order").default(0),
  createdAt: createdAt(),
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUPS — the tenancy boundary (Phase C of the auth roadmap). A group is a
// household: it owns ACCOUNTS (logins), PROFILES (people), and all data. The
// mental model: accounts authenticate, profiles identify, groups own. Tables
// carry group_id either directly (profiles, vehicles, exercises, resources,
// checklists) or by inheritance through an owning row (everything hanging off
// a vehicle/profile/workout/account). Every query in lib/queries scopes to the
// session's group — the session token carries groupId (lib/session).
// ─────────────────────────────────────────────────────────────────────────────
export const groups = pgTable("groups", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 120 }).notNull(),
  // Demo groups are wiped + reseeded on every demo login (lib/demo.ts) so each
  // visitor gets a pristine tour no matter what the last one deleted.
  isDemo: boolean("is_demo").notNull().default(false),
  // THE OWNER (Phase E): the one account that manages membership — mints/revokes
  // invite links and removes logins (/group). Deliberately thin: owning grants
  // nothing else (data writes still go through the claims). Circular FK
  // with accounts.group_id, hence the lazy reference; SET NULL so deleting the
  // owner account orphans the role rather than the group (recoverable by hand).
  // Null = no owner (the demo group; legacy groups until backfilled).
  ownerAccountId: integer("owner_account_id").references(
    (): AnyPgColumn => accounts.id,
    { onDelete: "set null" },
  ),
  // The household's IANA timezone (e.g. "America/Chicago"). Vercel runs in UTC,
  // so this pins server-side "today"/"current month" — otherwise the budget
  // flips at UTC midnight (~7pm Central). Set from the browser's detected zone in
  // /group settings; defaults to Central.
  timezone: varchar("timezone", { length: 64 }).notNull().default("America/Chicago"),
  createdAt: createdAt(),
});

// ── Invites (Phase E) — how new logins join without the terminal script ───────
// An invite is a capability URL: /join/<token>. Whoever opens a live one may
// create ONE login (more if maxUses allows). `groupId` is the destination —
// a household to join (Lauren-style) or NULL for "their own new empty hub"
// (Val-style, mirroring create-account.mjs without --join). Minted and revoked
// by the group OWNER at /group; single-use + 7-day expiry by default, so a
// leaked old link is worthless. Rows are kept after use/revoke/expiry (they're
// the audit trail of who was let in); "pending" is computed, never stored.
export const invites = pgTable("invites", {
  id: serial("id").primaryKey(),
  token: varchar("token", { length: 64 }).notNull().unique(), // base64url(randomBytes)
  groupId: integer("group_id").references(() => groups.id, { onDelete: "cascade" }),
  createdByAccountId: integer("created_by_account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),
  note: varchar("note", { length: 120 }), // "for Val" — shown in the pending list
  maxUses: integer("max_uses").default(1), // null = reusable until expiry/revoke
  usedCount: integer("used_count").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: createdAt(),
});

// ─────────────────────────────────────────────────────────────────────────────
// ACCOUNTS — the global login (Phase A of the auth roadmap). An account is a
// LOGIN IDENTITY for the whole hub, distinct from profiles (the household's
// people/data — a kid can have a profile with no login). A group can hold
// several accounts (Bryce + Lauren each get a key). No signup UI by design —
// accounts are created with `node scripts/create-account.mjs <username>`.
// ─────────────────────────────────────────────────────────────────────────────
export const accounts = pgTable("accounts", {
  id: serial("id").primaryKey(),
  groupId: integer("group_id").notNull().references(() => groups.id, { onDelete: "cascade" }),
  username: varchar("username", { length: 80 }).notNull().unique(), // stored lowercase
  passwordHash: text("password_hash").notNull(), // scrypt "scrypt$salt$hash" (lib/auth)
  // THE CLAIM (Phase D): this login IS this person. Signing in auto-switches to
  // the claimed profile, and a claimed profile's stuff is editable ONLY by its
  // claiming account — "claim is the lock", replacing the old per-profile edit
  // passwords. Unclaimed profiles (a kid) stay open to the whole group. unique:
  // one account per profile; nullable: an account may claim nothing. Managed at
  // /group; set null when the profile is deleted.
  profileId: integer("profile_id")
    .unique()
    .references(() => profiles.id, { onDelete: "set null" }),
  // When the password last changed (self-service or a reset link). Sessions
  // signed before it are dead (lib/session liveness), so a reset signs every
  // other device out. Null = never changed since the account was made.
  passwordChangedAt: timestamp("password_changed_at", { withTimezone: true }),
  createdAt: createdAt(),
});

// ── Passkeys (Phase B: WebAuthn / Face ID) ────────────────────────────────────
// One row per registered authenticator; an account can have several (one per
// device, or one synced iCloud/Google passkey shared across devices). The
// password stays as the fallback — a passkey is an ADDITIONAL door key, and
// deleting the last one must never lock anyone out. Registered at /passkeys
// (signed in); usernameless login via the discoverable credential ("resident
// key") that Face ID picks for you. Sign/verify flows: app/actions/passkeys.ts.
export const passkeys = pgTable(
  "passkeys",
  {
    // The credential's own WebAuthn ID (base64url) — globally unique by spec,
    // and what the authenticator sends at login, so it's the natural PK.
    id: text("id").primaryKey(),
    accountId: integer("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    publicKey: text("public_key").notNull(), // base64url COSE public key bytes
    // Signature counter — SimpleWebAuthn compares it to catch cloned
    // authenticators. Apple platform authenticators always report 0; store it anyway.
    counter: integer("counter").notNull().default(0),
    transports: jsonb("transports").$type<string[]>().notNull().default([]), // e.g. ["internal","hybrid"]
    deviceType: varchar("device_type", { length: 20 }), // singleDevice | multiDevice (synced)
    backedUp: boolean("backed_up").notNull().default(false), // synced to iCloud/Google
    label: varchar("label", { length: 120 }), // human name shown at /passkeys
    createdAt: createdAt(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (t) => [index("idx_passkeys_account").on(t.accountId)],
);

// ── Password resets ───────────────────────────────────────────────────────────
// A one-time link (/reset/<token>) that lets a person pick a new password on
// their own device. Minted by the group OWNER for another member at /group, or
// by the site admin with scripts/reset-link.mjs (createdByAccountId null) —
// the owner's own way back when they have no passkey. Only the token's sha256
// is stored, so reading this table never yields a working link. Single use,
// 24-hour expiry, revocable; minting a new one revokes the account's older
// live links. Rows stay as the audit trail the member sees on /group, and
// noticeSeenAt drives the one-time "your password was reset" notice.
export const passwordResets = pgTable(
  "password_resets",
  {
    id: serial("id").primaryKey(),
    accountId: integer("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    createdByAccountId: integer("created_by_account_id").references(() => accounts.id, {
      onDelete: "set null",
    }),
    // Named as Postgres named it when scripts/migrate-password-resets.mjs made
    // the table, so db:push sees the constraint instead of re-adding it.
    tokenHash: varchar("token_hash", { length: 64 })
      .notNull()
      .unique("password_resets_token_hash_key"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    noticeSeenAt: timestamp("notice_seen_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("idx_password_resets_account").on(t.accountId)],
);

// ─────────────────────────────────────────────────────────────────────────────
// PROFILES — the hub-wide people (Bryce, Lauren). Data, not accounts. NOT a
// security boundary (no passwords, free switching) — see ARCHITECTURE. First used
// by the workout app; now hub-wide (vehicles.profile_id, active_profile cookie).
// ─────────────────────────────────────────────────────────────────────────────
export const profiles = pgTable("profiles", {
  id: serial("id").primaryKey(),
  groupId: integer("group_id").notNull().references(() => groups.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 80 }).notNull(),
  color: varchar("color", { length: 20 }), // tile accent / avatar color
  sortOrder: integer("sort_order").default(0),
  // Apps this person has hidden from their hub (by slug, see lib/apps). A
  // personal declutter preference, NOT a permission — the hub has no roles.
  // Default [] = every app visible; new apps show up automatically.
  hiddenApps: jsonb("hidden_apps").$type<string[]>().notNull().default([]),
  // Workout gear this person OWNS (slugs from lib/workout EQUIPMENT). The workout
  // catalog greys out / warns on exercises whose required gear isn't here. Default
  // [] = "not set up yet" → nothing is filtered (show everything). Editor-gated to
  // change, so the read-only showcase stays read-only — see auth notes.
  equipment: jsonb("equipment").$type<string[]>().notNull().default([]),
  // (Phase D removed the per-profile edit passwords — a profile is protected by
  // being CLAIMED by an account instead; see accounts.profileId.)
  // Soft-delete: "Deactivate" sets this (hidden from the switcher, can't be
  // active) but keeps all their data. "Delete forever" removes the row after
  // reassigning shared cars/workouts. null = active.
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: createdAt(),
});

// ─────────────────────────────────────────────────────────────────────────────
// WORKOUT APP — nightly exercise companion (catalog, routines, items, schedule)
// ─────────────────────────────────────────────────────────────────────────────

// ── Exercise catalog (shared across profiles; carries recommended defaults) ───
// mode: 'reps' (manual "Done → Next") | 'timed' (countdown). reps/weight are text
// on purpose — real workouts say "10-12", "8 each leg", "15s", "5 or 8s".
export const exercises = pgTable("exercises", {
  id: serial("id").primaryKey(),
  // Each group has its own catalog ("shared" means shared within the household).
  groupId: integer("group_id").notNull().references(() => groups.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 120 }).notNull(),
  category: varchar("category", { length: 40 }), // warmup|legs|push|pull|core|cardio|carry|mobility
  // Recommended defaults; a workout item can override reps/time/weight. Mode is
  // derived (reps present → rep-based; else timed). reps/weight are text on
  // purpose — real workouts say "10-12", "8 each leg", "15s", "5 or 8s".
  defaultReps: varchar("default_reps", { length: 40 }), // "10-12", "8 each leg"
  defaultDuration: integer("default_duration"), // seconds; per-rep when reps set, else total hold
  defaultWeight: varchar("default_weight", { length: 40 }), // "25 lb", "15s", "bodyweight"
  holdLast: boolean("hold_last").notNull().default(false), // hold the final rep (needs per-rep time)
  // 1 = normal; 2 = performed per side (e.g. Bulgarian split squats, planks each
  // side) — the runner runs the set once per side with a short "switch" between.
  sides: integer("sides").notNull().default(1),
  // Gear this exercise REQUIRES, as slugs from lib/workout EQUIPMENT (e.g.
  // ["dumbbells"], ["pullup-bar"]). Intrinsic to the exercise (a pull-up always
  // needs a bar), so it's catalog-only — NO per-item override, same as `sides`.
  // Empty [] = bodyweight, needs nothing. A profile only sees exercises whose
  // required gear it owns (profiles.equipment); [] always shows.
  equipment: jsonb("equipment").$type<string[]>().notNull().default([]),
  description: text("description"),
  tips: text("tips"),
  createdAt: createdAt(),
});

// ── Workouts (a saved routine / "day") — a SHARED library ─────────────────────
// Every profile can see every workout; `createdByProfileId` is just "saved by"
// (which profile authored it). A workout has three sections (warmup / main /
// cooldown). MAIN is a circuit: `rounds` = how many times to rotate the main
// items; warmup + cooldown run once. Scheduling is separate — see
// `workout_assignments` (a workout can be assigned to many days/profiles).
export const workouts = pgTable(
  "workouts",
  {
    id: serial("id").primaryKey(),
    // Column stays `profile_id`; semantics are "saved by" (creator), not owner.
    // RESTRICT (not cascade): workouts are a SHARED library, so a profile can't be
    // deleted while it still authors any — deleteProfileForever() reassigns them to
    // an heir first. Prevents a profile delete from nuking others' shared routines.
    createdByProfileId: integer("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    name: varchar("name", { length: 120 }).notNull(),
    rounds: integer("rounds").notNull().default(1), // times to rotate the MAIN circuit
    restBetweenRounds: integer("rest_between_rounds").notNull().default(60), // seconds
    notes: text("notes"),
    sortOrder: integer("sort_order").default(0),
    createdAt: createdAt(),
  },
  (t) => [index("idx_workouts_profile").on(t.createdByProfileId)],
);

// ── Workout assignments — each profile maps their own week ─────────────────────
// (profileId, weekday) → workoutId. Unique per profile+weekday, so a profile has
// at most one workout per day; the same workout can be reused across days/profiles.
export const workoutAssignments = pgTable(
  "workout_assignments",
  {
    id: serial("id").primaryKey(),
    profileId: integer("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    weekday: integer("weekday").notNull(), // 0..6 (Sun..Sat)
    workoutId: integer("workout_id")
      .notNull()
      .references(() => workouts.id, { onDelete: "cascade" }),
  },
  (t) => [
    uniqueIndex("uniq_assignment_profile_weekday").on(t.profileId, t.weekday),
  ],
);

// ── Workout items (ordered exercises in a workout; null override = use default) ─
// `section` places the item in warmup | main | cooldown. Reps/duration/weight are
// per-item overrides (null = inherit the exercise). "How many times" is the
// workout's `rounds` (main only), not a per-item value.
export const workoutItems = pgTable(
  "workout_items",
  {
    id: serial("id").primaryKey(),
    workoutId: integer("workout_id")
      .notNull()
      .references(() => workouts.id, { onDelete: "cascade" }),
    exerciseId: integer("exercise_id")
      .notNull()
      .references(() => exercises.id, { onDelete: "restrict" }),
    section: varchar("section", { length: 20 }).notNull().default("main"), // warmup | main | cooldown
    reps: varchar("reps", { length: 40 }),
    duration: integer("duration"), // seconds; per-rep when reps set, else total hold
    weight: varchar("weight", { length: 40 }),
    holdLast: boolean("hold_last"), // override; null = inherit the exercise's default
    // NOTE: per-side is intentionally catalog-only (see exercises.sides) — it's an
    // intrinsic property of the exercise, not a per-workout dial, so no override here.
    note: text("note"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("idx_workout_items_workout").on(t.workoutId)],
);

// ─────────────────────────────────────────────────────────────────────────────
// WEIGHT TRACKER — weekly weigh-ins per profile + a goal/pace plan. Everything
// derived (WoW, total lost, the target line, pace buffer, trend, projected goal
// date) is COMPUTED in lib/queries/weight.ts, never stored — same spirit as MPG
// living in the fuel queries. Owned by a profile (Bryce's data ≠ Lauren's),
// gated for writes via requireEditorFor(profileId) like the rest of the hub.
// ─────────────────────────────────────────────────────────────────────────────

// ── Weigh-ins (one row per profile per day; re-logging a day UPDATES it) ───────
// weight is text-free numeric(5,1): scales are 0.2-lb granularity in practice,
// one decimal is plenty (e.g. 224.6). The unique (profile, day) index is what
// makes "log today" idempotent — a second entry for a date overwrites the first.
export const weighIns = pgTable(
  "weigh_ins",
  {
    id: serial("id").primaryKey(),
    profileId: integer("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    measuredOn: date("measured_on").notNull(),
    weight: numeric("weight", { precision: 5, scale: 1 }).notNull(), // lbs, e.g. 224.6
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("uniq_weigh_in_profile_date").on(t.profileId, t.measuredOn)],
);

// ── Weight goal / plan (ONE per profile; "re-plan" overwrites this row) ────────
// The target line is startWeight declining by perWeekPace lbs/week from startDate,
// flattening once it reaches goalWeight. Pace is numeric(5,3) so the seeded line
// reproduces the spreadsheet exactly ((start − goal) / 52 weeks, e.g. 0.577).
export const weightGoals = pgTable("weight_goals", {
  id: serial("id").primaryKey(),
  profileId: integer("profile_id")
    .notNull()
    .unique()
    .references(() => profiles.id, { onDelete: "cascade" }),
  startWeight: numeric("start_weight", { precision: 5, scale: 1 }).notNull(),
  startDate: date("start_date").notNull(),
  goalWeight: numeric("goal_weight", { precision: 5, scale: 1 }).notNull(),
  perWeekPace: numeric("per_week_pace", { precision: 5, scale: 3 }).notNull(), // lbs/week
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  createdAt: createdAt(),
});

// ── Weight plans (Phase 2b: many per profile, dated, with a mode) ─────────────
// Supersedes weight_goals (one-per-profile). A plan is a dated segment you chain:
// lose → maintain → lose, switched any time. `mode` picks the target shape —
// 'lose' = a declining line to goalWeight at perWeekPace; 'maintain' = a flat
// band at goalWeight ± rangeLb. `endDate` null = the active plan; set it (past OR
// a future deadline like "lose 5 by the wedding") and the next plan takes over.
export const weightPlans = pgTable(
  "weight_plans",
  {
    id: serial("id").primaryKey(),
    profileId: integer("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    mode: varchar("mode", { length: 20 }).notNull().default("lose"), // lose | maintain
    startWeight: numeric("start_weight", { precision: 5, scale: 1 }).notNull(),
    startDate: date("start_date").notNull(),
    goalWeight: numeric("goal_weight", { precision: 5, scale: 1 }).notNull(),
    perWeekPace: numeric("per_week_pace", { precision: 5, scale: 3 }).notNull().default("0"), // lose
    rangeLb: numeric("range_lb", { precision: 4, scale: 1 }), // maintain: ± band around goalWeight
    endDate: date("end_date"), // null = active plan; else the segment's last day
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("idx_weight_plans_profile").on(t.profileId, t.startDate)],
);

// ─────────────────────────────────────────────────────────────────────────────
// FINANCE — Net worth (F1 of the finance roadmap; ATLAS + budget follow).
// Accounts are the group's money places; snapshots are the first-of-the-month
// ritual (log every balance once a month). Everything derived — totals, MoM,
// cumulative growth, cash, paycheck contributions — is COMPUTED in
// lib/queries/finance-networth.ts, never stored (same spirit as MPG/weight).
// ─────────────────────────────────────────────────────────────────────────────
export const financialAccounts = pgTable(
  "financial_accounts",
  {
    id: serial("id").primaryKey(),
    groupId: integer("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    // Display grouping + chart stacking:
    // checking | savings | brokerage | retirement | crypto | hsa | credit_card |
    // wallet | other. A wallet (Venmo, cash) is spending money: moving money
    // into it counts as spent, never as a transfer.
    kind: varchar("kind", { length: 20 }).notNull().default("other"),
    // Retired: savings are now every account you own (see lib/finance/net-worth),
    // so nothing reads this flag any more.
    includeInBankSaved: boolean("include_in_bank_saved").notNull().default(false),
    // Case-insensitive words that mark a transaction as money moving INTO this
    // account ("SCHWAB"), so an ingested row becomes a transfer automatically.
    transferPatterns: jsonb("transfer_patterns").$type<string[]>().notNull().default([]),
    // false = not part of the monthly balance ritual (e.g. a credit card row
    // that exists only as a payment source for recurring expenses, F2+).
    trackBalance: boolean("track_balance").notNull().default(true),
    // The account day-to-day discretionary spending runs through (the budget
    // envelope = discretion + this account's fixed bills). An EXPLICIT flag —
    // never inferred from kind — because multi-card households are normal and
    // a debit family's "spending card" is their checking account.
    carriesDiscretion: boolean("carries_discretion").notNull().default(false),
    sortOrder: integer("sort_order").default(0),
    // Soft close — accounts come and go (an HSA opens mid-year, Venmo+ dies).
    // Hidden from new snapshots, history intact. Mirrors profiles.archivedAt.
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    notes: text("notes"),
    createdAt: createdAt(),
  },
  (t) => [index("idx_fin_accounts_group").on(t.groupId)],
);

// One row per account per month; re-logging a month UPDATES it (same unique-
// index idempotency as weigh_ins). month is always normalized to YYYY-MM-01.
export const accountSnapshots = pgTable(
  "account_snapshots",
  {
    id: serial("id").primaryKey(),
    accountId: integer("account_id")
      .notNull()
      .references(() => financialAccounts.id, { onDelete: "cascade" }),
    month: date("month").notNull(),
    balance: numeric("balance", { precision: 12, scale: 2 }).notNull(),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("uniq_snapshot_account_month").on(t.accountId, t.month)],
);

// Effective-dated savings goal segments (weight_plans pattern). monthlyGoal is
// the TAKE-HOME part ATLAS sets aside before discretionary; the whole goal adds
// what paychecks already save (401k, HSA). endMonth null = the active segment,
// so changing the goal never rewrites past months.
export const savingsGoals = pgTable("savings_goals", {
  id: serial("id").primaryKey(),
  groupId: integer("group_id")
    .notNull()
    .references(() => groups.id, { onDelete: "cascade" }),
  monthlyGoal: numeric("monthly_goal", { precision: 10, scale: 2 }).notNull(),
  startMonth: date("start_month").notNull(),
  endMonth: date("end_month"),
  createdAt: createdAt(),
});

export type FinancialAccount = typeof financialAccounts.$inferSelect;
export type NewFinancialAccount = typeof financialAccounts.$inferInsert;
export type AccountSnapshot = typeof accountSnapshots.$inferSelect;
export type NewAccountSnapshot = typeof accountSnapshots.$inferInsert;
export type SavingsGoal = typeof savingsGoals.$inferSelect;
export type NewSavingsGoal = typeof savingsGoals.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// FINANCE — ATLAS (F2): income + the recurring-spend registry. ALL THREE tables
// are EFFECTIVE-DATED (startDate + endDate null = active, the weight_plans
// pattern): a raise or a bill change starts a NEW segment instead of editing
// history, so any past month can be viewed with the config that was true THEN
// (and the future budget tab's closed months stay honest). Nothing derived is
// stored — net pay, monthly totals, the discretionary envelope, category
// subtotals and %-of-paycheck analytics are all computed in
// lib/queries/finance-atlas.ts from the rows effective at the viewed month.
// ─────────────────────────────────────────────────────────────────────────────

// Compensation — PROFILE-owned (income is a person's; Lauren's can be added
// later; writes go through requireEditorFor). Net/hourly/TCV always derived.
export const compensationPlans = pgTable(
  "compensation_plans",
  {
    id: serial("id").primaryKey(),
    profileId: integer("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    // semimonthly (24/yr) | biweekly (26/yr) | monthly (12/yr) — paychecks/year derived.
    payFrequency: varchar("pay_frequency", { length: 20 })
      .notNull()
      .default("semimonthly"),
    grossPerPaycheck: numeric("gross_per_paycheck", { precision: 10, scale: 2 }).notNull(),
    baseSalary: numeric("base_salary", { precision: 12, scale: 2 }), // display; hourly = base/2080
    shares: integer("shares"),
    sharePrice: numeric("share_price", { precision: 10, scale: 4 }), // TCV = base + shares×price
    notes: text("notes"),
    startDate: date("start_date").notNull(),
    endDate: date("end_date"), // null = active segment
    createdAt: createdAt(),
  },
  (t) => [index("idx_comp_plans_profile").on(t.profileId, t.startDate)],
);

// Per-paycheck deductions — PROFILE-owned, effective-dated independently of the
// comp plan (insurance renews on its own clock). source decides the math:
// 'payroll' is subtracted from gross to get net; 'employer' is an employer-paid
// benefit (tracked for the investing analytics, NOT subtracted).
export const incomeDeductions = pgTable(
  "income_deductions",
  {
    id: serial("id").primaryKey(),
    profileId: integer("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    // insurance | retirement | health | tax | employer_benefit — display grouping.
    type: varchar("type", { length: 30 }),
    source: varchar("source", { length: 20 }).notNull().default("payroll"), // payroll | employer
    // EXACTLY ONE of these is set (app-enforced): a flat $ per paycheck, OR a
    // % of gross (a 6% 401k) — percent rows track raises automatically, since
    // the dollar amount is derived from whichever comp plan is effective.
    amountPerPaycheck: numeric("amount_per_paycheck", { precision: 10, scale: 2 }),
    percentOfGross: numeric("percent_of_gross", { precision: 5, scale: 2 }),
    // Where the money lands (a 401k → the retirement account, an HSA → the
    // HSA), so Net Worth can split that account's growth into paycheck
    // contributions vs everything else. null = it leaves for good (taxes).
    depositAccountId: integer("deposit_account_id").references(
      () => financialAccounts.id,
      { onDelete: "set null" },
    ),
    notes: text("notes"),
    startDate: date("start_date").notNull(),
    endDate: date("end_date"),
    createdAt: createdAt(),
  },
  (t) => [index("idx_deductions_profile").on(t.profileId, t.startDate)],
);

// The household's recurring bills — GROUP-owned; ALSO the future budget
// engine's fixed/amortized config (merchantPatterns + isEstimate are its
// hooks). `amount` is per-occurrence at the bill's real cadence; the monthly
// figure is derived as amount × paymentsPerYear / 12 (the gist's math), so a
// $993 six-month insurance bill reads as $165.50/mo.
export const recurringExpenses = pgTable(
  "recurring_expenses",
  {
    id: serial("id").primaryKey(),
    groupId: integer("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    // Freeform label (Subscriptions, Utilities, Housing…) — suggested via
    // autocomplete, never a locked enum, so each household grows its own set.
    category: varchar("category", { length: 60 }),
    // essential (rent, utilities) | lifestyle (subscriptions you could drop) |
    // commitment (savings, tithing — intentional transfers, not consumption).
    necessity: varchar("necessity", { length: 20 }).notNull().default("essential"),
    amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
    paymentsPerYear: integer("payments_per_year").notNull().default(12),
    // Named due months for uneven cadences ("Jan / April" = [1,4]); null = evenly spaced.
    dueMonths: jsonb("due_months").$type<number[]>(),
    dueDay: varchar("due_day", { length: 20 }), // free text on purpose: "5th", "EOM", "???"
    // Which account pays it (the Chase-vs-Ally split; drives the budget envelope).
    paidFromAccountId: integer("paid_from_account_id").references(
      () => financialAccounts.id,
      { onDelete: "set null" },
    ),
    // Variable bills (electric): amount is an estimate; the budget tab adjusts
    // when the actual posts.
    isEstimate: boolean("is_estimate").notNull().default(false),
    // SMS merchant substrings for the budget tab's auto-categorization
    // (matched longest-first, e.g. ["SPECTRUM MOBILE", "SPECTRUM"]).
    merchantPatterns: jsonb("merchant_patterns").$type<string[]>().notNull().default([]),
    notes: text("notes"),
    startDate: date("start_date").notNull(),
    endDate: date("end_date"),
    createdAt: createdAt(),
  },
  (t) => [index("idx_recurring_group").on(t.groupId, t.startDate)],
);

export type CompensationPlan = typeof compensationPlans.$inferSelect;
export type NewCompensationPlan = typeof compensationPlans.$inferInsert;
export type IncomeDeduction = typeof incomeDeductions.$inferSelect;
export type NewIncomeDeduction = typeof incomeDeductions.$inferInsert;
export type RecurringExpense = typeof recurringExpenses.$inferSelect;
export type NewRecurringExpense = typeof recurringExpenses.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// FINANCE — Budget (F3): the transaction ledger + its machinery. Open months
// are computed LIVE by lib/finance/budget-engine from transactions + the
// effective ATLAS config; CLOSED months render from their stored snapshot (the
// one sanctioned derived-storage bend — txn categories stay editable forever,
// and immutability of the past is the requirement). The engine's lanes:
// discretionary spent-vs-budget is the headline; fixed = billed-vs-expected;
// amortized = sinking-fund reserve accrue/consume. NEVER raw outflow vs
// envelope (matching the envelope in a no-bills month means the reserves got
// spent).
// ─────────────────────────────────────────────────────────────────────────────

// Every card alert / manual entry. Direct groupId (the ingest route has no
// session — a token resolves the tenant). `amount` is the EFFECTIVE, editable
// value (signed; negative = credit / fund top-up); originalAmount preserves
// what actually posted so adjustments are visible ("adjusted from $X").
export const transactions = pgTable(
  "transactions",
  {
    id: serial("id").primaryKey(),
    groupId: integer("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    // Which account the charge hit (per-card analytics; per-bank feeds).
    accountId: integer("account_id").references(() => financialAccounts.id, {
      onDelete: "set null",
    }),
    postedOn: date("posted_on").notNull(),
    merchant: varchar("merchant", { length: 200 }),
    amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
    originalAmount: numeric("original_amount", { precision: 10, scale: 2 }).notNull(),
    // Engine semantics (fixed enum — labels live on ATLAS categories instead):
    // discretionary | fixed | amortized | savings | reimbursement | fund |
    // income | transfer | ignored. income never touches spend math; transfer
    // moves money between your own accounts; ignored is the trash that still
    // keeps its audit trail.
    category: varchar("category", { length: 20 }).notNull().default("discretionary"),
    // fixed/amortized txns match a recurring bill → estimate-vs-actual deltas
    // and sinking-fund consumption.
    recurringExpenseId: integer("recurring_expense_id").references(
      () => recurringExpenses.id,
      { onDelete: "set null" },
    ),
    fundId: integer("fund_id").references(() => funds.id, { onDelete: "set null" }),
    // A transfer's other side: money moved from accountId INTO this account.
    // Transfers are between your own accounts, so they are never income or
    // spending and never tagged.
    transferAccountId: integer("transfer_account_id").references(() => financialAccounts.id, {
      onDelete: "set null",
    }),
    source: varchar("source", { length: 20 }).notNull(), // sms | manual | api | import | plaid
    rawText: text("raw_text"), // full SMS body kept for audit + re-parse
    rawHash: varchar("raw_hash", { length: 64 }), // sha256; short-window dedupe, NOT unique
    // Unparseable SMS lands as amount 0 + needsReview — surfaced, never dropped.
    needsReview: boolean("needs_review").notNull().default(false),
    note: text("note"),
    // Analytics label (F4c) — Groceries / Dining / Gas… DISTINCT from `category`
    // (the budget engine's lane). Bill-linked rows inherit their bill's ATLAS
    // category; discretionary rows get tagged by merchant rules or by hand. Null
    // = untagged.
    spendCategory: varchar("spend_category", { length: 40 }),
    // The bank feed's word on this row: null = no bank has reported it yet,
    // "pending" = authorized, "posted" = settled. Display only; the budget
    // counts pending rows the same way it counts card alerts.
    bankStatus: varchar("bank_status", { length: 10 }),
    createdAt: createdAt(),
  },
  (t) => [
    index("idx_txn_group_posted").on(t.groupId, t.postedOn),
    index("idx_txn_recurring").on(t.recurringExpenseId),
  ],
);

// Merchant → spend-category rules (F4c). A pattern is a case-insensitive
// substring of the card-alert merchant (same style as recurringExpenses
// merchantPatterns); longest match wins, so "WM SUPERCENTER" beats a broad
// "WALMART". Seeded from Bryce's real merchants, grown as he tags — the
// "learns from you" auto-tagger, no LLM.
export const merchantCategories = pgTable(
  "merchant_categories",
  {
    id: serial("id").primaryKey(),
    groupId: integer("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    pattern: varchar("pattern", { length: 100 }).notNull(),
    category: varchar("category", { length: 40 }).notNull(),
    // The named merchant GROUP this pattern belongs to (F4d) — several patterns
    // (WM SUPERCENTER, WAL-MART, WALMART.COM) can share one group name ("Walmart")
    // and category. Purely organizational: categorization is still longest-pattern
    // wins. Backfilled to = pattern, so every rule starts as its own group.
    groupName: varchar("group_name", { length: 60 }),
    // Which side of the ledger the rule tags: "out" = spending tags, "in" =
    // income tags. A rule only ever matches rows of its own flow, so a spending
    // "Venmo" rule can't tag a Venmo payment to you (scripts/migrate-rule-flow).
    flow: varchar("flow", { length: 3 }).notNull().default("out"),
    createdAt: createdAt(),
  },
  (t) => [index("idx_merchcat_group").on(t.groupId)],
);

// One-time pools (Lauren's fund, Bryce's fund, a shared vacation pot…) — a txn
// assigned to a fund draws it down instead of the month's budget. Balance is
// ALWAYS derived: startingBalance − Σ(fund txns); top-ups are negative txns.
// ownerProfileId is display/ownership (and the future teen-budget seam).
export const funds = pgTable("funds", {
  id: serial("id").primaryKey(),
  groupId: integer("group_id")
    .notNull()
    .references(() => groups.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 120 }).notNull(),
  ownerProfileId: integer("owner_profile_id").references(() => profiles.id, {
    onDelete: "set null",
  }),
  startingBalance: numeric("starting_balance", { precision: 10, scale: 2 }).notNull(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  notes: text("notes"),
  createdAt: createdAt(),
});

// NOTE: there is deliberately NO budget_months / snapshot table. Months are
// never "frozen" — config is effective-dated (a past month always reads the pay
// & bills that were true then), so history can't be rewritten by a later change
// and every month stays freely editable. The whole budget computes live.

// Machine auth for the ingest + widget endpoints (the hub's first). Per-device
// tokens ("Bryce shortcut", "Lauren widget") so revoking a lost phone breaks
// nothing else. Only the sha256 lands in the DB — the secret is shown ONCE at
// mint (a leak of this table leaks nothing usable). Liveness = revokedAt null,
// invites-style.
export const apiTokens = pgTable("api_tokens", {
  id: serial("id").primaryKey(),
  groupId: integer("group_id")
    .notNull()
    .references(() => groups.id, { onDelete: "cascade" }),
  tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
  label: varchar("label", { length: 120 }).notNull(),
  scope: varchar("scope", { length: 20 }).notNull(), // ingest | widget
  // Ingest tokens are per-FEED (the Chase SMS shortcut, a future Ally feed) —
  // binding one to an account stamps every transaction it ingests with where
  // the money moved. Null = unattributed.
  accountId: integer("account_id").references(() => financialAccounts.id, {
    onDelete: "set null",
  }),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
export type Fund = typeof funds.$inferSelect;
export type NewFund = typeof funds.$inferInsert;
export type ApiToken = typeof apiTokens.$inferSelect;
export type NewApiToken = typeof apiTokens.$inferInsert;
export type MerchantCategory = typeof merchantCategories.$inferSelect;
export type NewMerchantCategory = typeof merchantCategories.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// FINANCE — Bank sync (Plaid). An item is one bank login; its accounts map onto
// the group's financial_accounts; plaid_transactions keeps the bank's version
// of every transaction, linked to the ledger row it created or claimed. The
// ledger row stays the truth: a sync refreshes only what the bank owns (the
// posted amount, pending → posted), never the household's edits.
// ─────────────────────────────────────────────────────────────────────────────
export const plaidItems = pgTable(
  "plaid_items",
  {
    id: serial("id").primaryKey(),
    groupId: integer("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    itemId: varchar("item_id", { length: 100 }).notNull().unique(),
    // AES-256-GCM via lib/plaid/crypto; the raw token never leaves the server.
    accessTokenEnc: text("access_token_enc").notNull(),
    institutionId: varchar("institution_id", { length: 40 }),
    institutionName: varchar("institution_name", { length: 120 }).notNull(),
    // ok | login_required | pending_disconnect | revoked | error. Anything but
    // ok puts a Reconnect button on the Connections page.
    status: varchar("status", { length: 30 }).notNull().default("ok"),
    lastError: text("last_error"),
    // The /transactions/sync bookmark; null = start from the beginning.
    cursor: text("cursor"),
    // Bank rows dated before this stay in plaid_transactions and never reach
    // the ledger (that history already came in by SMS, import, and hand).
    syncFrom: date("sync_from").notNull(),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    // Lease that keeps a webhook, the cron, and the button from syncing one
    // item at the same time (the Neon HTTP driver has no held row locks).
    syncLockedUntil: timestamp("sync_locked_until", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("idx_plaid_items_group").on(t.groupId)],
);

export const plaidAccounts = pgTable(
  "plaid_accounts",
  {
    id: serial("id").primaryKey(),
    plaidItemId: integer("plaid_item_id")
      .notNull()
      .references(() => plaidItems.id, { onDelete: "cascade" }),
    accountId: varchar("account_id", { length: 100 }).notNull().unique(),
    // The app account this bank account feeds; null = not imported.
    financialAccountId: integer("financial_account_id").references(() => financialAccounts.id, {
      onDelete: "set null",
    }),
    name: varchar("name", { length: 200 }).notNull(),
    officialName: varchar("official_name", { length: 200 }),
    mask: varchar("mask", { length: 10 }),
    type: varchar("type", { length: 30 }).notNull(), // depository | credit | loan | investment | other
    subtype: varchar("subtype", { length: 40 }),
    // The bank's cached balances (free with every sync), for snapshot pre-fill.
    currentBalance: numeric("current_balance", { precision: 12, scale: 2 }),
    availableBalance: numeric("available_balance", { precision: 12, scale: 2 }),
    balanceAsOf: timestamp("balance_as_of", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("idx_plaid_accounts_item").on(t.plaidItemId)],
);

// The bank's copy of each transaction, upserted on every sync (the role rawText
// plays for SMS rows). appliedAt null = the ledger has not caught up with this
// version yet, so re-running the apply step is always safe.
export const plaidTransactions = pgTable(
  "plaid_transactions",
  {
    id: serial("id").primaryKey(),
    plaidAccountId: integer("plaid_account_id")
      .notNull()
      .references(() => plaidAccounts.id, { onDelete: "cascade" }),
    transactionId: varchar("transaction_id", { length: 100 }).notNull().unique(),
    // On a posted row: the pending row it replaces.
    pendingTransactionId: varchar("pending_transaction_id", { length: 100 }),
    // The ledger row this created or claimed; null = not in the ledger (before
    // syncFrom, an unmapped account, a card payment, or removed by the bank).
    ledgerTransactionId: integer("ledger_transaction_id").references(() => transactions.id, {
      onDelete: "set null",
    }),
    pending: boolean("pending").notNull(),
    // Plaid's sign: positive = money out of the account.
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    date: date("date").notNull(),
    authorizedDate: date("authorized_date"),
    name: varchar("name", { length: 300 }).notNull(),
    merchantName: varchar("merchant_name", { length: 200 }),
    pfcPrimary: varchar("pfc_primary", { length: 60 }),
    pfcDetailed: varchar("pfc_detailed", { length: 100 }),
    raw: jsonb("raw").notNull(),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    // Set when the household deletes the ledger row: the bank's later updates
    // (and the posted version of a pending row) must never bring it back.
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    // One payment the household recorded in parts: ledgerTransactionId holds
    // the largest part and these the rest. Syncs never change split amounts.
    splitLedgerIds: integer("split_ledger_ids").array(),
    createdAt: createdAt(),
  },
  (t) => [
    index("idx_plaid_txn_ledger").on(t.ledgerTransactionId),
    index("idx_plaid_txn_account_date").on(t.plaidAccountId, t.date),
  ],
);

export type PlaidItem = typeof plaidItems.$inferSelect;
export type NewPlaidItem = typeof plaidItems.$inferInsert;
export type PlaidAccount = typeof plaidAccounts.$inferSelect;
export type NewPlaidAccount = typeof plaidAccounts.$inferInsert;
export type PlaidTransaction = typeof plaidTransactions.$inferSelect;
export type NewPlaidTransaction = typeof plaidTransactions.$inferInsert;

// ── Inferred types for use across the app ─────────────────────────────────────
export type Group = typeof groups.$inferSelect;
export type NewGroup = typeof groups.$inferInsert;
export type Invite = typeof invites.$inferSelect;
export type NewInvite = typeof invites.$inferInsert;
export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
export type Passkey = typeof passkeys.$inferSelect;
export type NewPasskey = typeof passkeys.$inferInsert;
export type Vehicle = typeof vehicles.$inferSelect;
export type NewVehicle = typeof vehicles.$inferInsert;
export type MaintenanceRecord = typeof maintenanceRecords.$inferSelect;
export type NewMaintenanceRecord = typeof maintenanceRecords.$inferInsert;
export type FuelLog = typeof fuelLogs.$inferSelect;
export type NewFuelLog = typeof fuelLogs.$inferInsert;
export type Part = typeof parts.$inferSelect;
export type NewPart = typeof parts.$inferInsert;
export type BuildTask = typeof buildTasks.$inferSelect;
export type NewBuildTask = typeof buildTasks.$inferInsert;
export type WishlistItem = typeof wishlistItems.$inferSelect;
export type NewWishlistItem = typeof wishlistItems.$inferInsert;
export type JournalEntry = typeof journalEntries.$inferSelect;
export type NewJournalEntry = typeof journalEntries.$inferInsert;
export type Checklist = typeof checklists.$inferSelect;
export type NewChecklist = typeof checklists.$inferInsert;
export type ChecklistItem = typeof checklistItems.$inferSelect;
export type NewChecklistItem = typeof checklistItems.$inferInsert;
export type Attachment = typeof attachments.$inferSelect;
export type NewAttachment = typeof attachments.$inferInsert;
export type Resource = typeof resources.$inferSelect;
export type NewResource = typeof resources.$inferInsert;
export type Profile = typeof profiles.$inferSelect;
export type NewProfile = typeof profiles.$inferInsert;
export type Exercise = typeof exercises.$inferSelect;
export type NewExercise = typeof exercises.$inferInsert;
export type Workout = typeof workouts.$inferSelect;
export type NewWorkout = typeof workouts.$inferInsert;
export type WorkoutItem = typeof workoutItems.$inferSelect;
export type NewWorkoutItem = typeof workoutItems.$inferInsert;
export type WorkoutAssignment = typeof workoutAssignments.$inferSelect;
export type NewWorkoutAssignment = typeof workoutAssignments.$inferInsert;
export type WeighIn = typeof weighIns.$inferSelect;
export type NewWeighIn = typeof weighIns.$inferInsert;
export type WeightGoal = typeof weightGoals.$inferSelect;
export type NewWeightGoal = typeof weightGoals.$inferInsert;
export type WeightPlan = typeof weightPlans.$inferSelect;
export type NewWeightPlan = typeof weightPlans.$inferInsert;
