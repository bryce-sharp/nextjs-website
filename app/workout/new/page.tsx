import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import { listProfiles } from "@/lib/queries/profiles";
import { listExercises } from "@/lib/queries/workout";
import { getActiveProfile } from "@/lib/profile";
import { createWorkoutWithItems } from "@/app/actions/workout";
import WorkoutDraftBuilder from "@/components/workout/WorkoutDraftBuilder";

export const metadata = { title: "New workout — Workout" };

// One-page create: the whole workout is drafted in client state and saved with
// a single action — nothing hits the database until "Create workout".
export default async function NewWorkoutPage({
  searchParams,
}: {
  searchParams: Promise<{ profile?: string; weekday?: string }>;
}) {

  const { profile, weekday } = await searchParams;
  const [profiles, catalog, active] = await Promise.all([
    listProfiles(),
    listExercises(),
    getActiveProfile(profile),
  ]);
  const defaultProfileId = active?.id ?? profiles[0]?.id;
  const assignWeekday =
    weekday != null && /^[0-6]$/.test(weekday) ? Number(weekday) : undefined;

  return (
    <Container maxWidth="md" sx={{ py: { xs: 4, md: 6 } }}>
      <Typography variant="h4" component="h1" sx={{ mb: 1 }}>
        New workout
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Name it, stack the exercises, tweak the numbers — it all saves in one go
        when you hit Create.
      </Typography>
      <WorkoutDraftBuilder
        action={createWorkoutWithItems}
        profiles={profiles}
        defaultProfileId={defaultProfileId}
        assignWeekday={assignWeekday}
        exercises={catalog}
        ownedEquipment={active?.equipment ?? []}
      />
    </Container>
  );
}
