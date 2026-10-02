// The monthly savings goal is effective-dated segments (weight_plans pattern):
// startMonth..endMonth (null = still active). One goal feeds ATLAS (its
// take-home part comes off before discretionary) and the budget's month
// report, so both read it through this one rule.

export type GoalSegment = { monthlyGoal: string; startMonth: string; endMonth: string | null };

/** Does `month` (YYYY-MM-01) fall inside a goal segment? */
export function segmentCovers(g: GoalSegment, month: string): boolean {
  return g.startMonth <= month && (g.endMonth === null || month <= g.endMonth);
}

/** The segment in effect for a month; overlaps resolve latest-starting-wins.
 *  `goals` must be ordered by startMonth ascending. */
export function goalForMonth<T extends GoalSegment>(goals: T[], month: string): T | null {
  return [...goals].reverse().find((g) => segmentCovers(g, month)) ?? null;
}
