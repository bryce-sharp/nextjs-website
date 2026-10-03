import Link from "@/components/shared/AppLink";
import { redirect } from "next/navigation";
import Container from "@mui/material/Container";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import {
  getAssignments,
  listWorkoutsWithCreator,
} from "@/lib/queries/workout";
import { listProfiles } from "@/lib/queries/profiles";
import { setAssignment } from "@/app/actions/workout";
import { switchProfile } from "@/app/actions/profile";
import { getActiveProfile } from "@/lib/profile";
import { WEEKDAYS } from "@/lib/workout";
import AssignSelect from "@/components/workout/AssignSelect";

export const metadata = { title: "Edit schedule — Workout" };

// Mon-first display order.
const ORDER = [1, 2, 3, 4, 5, 6, 0];

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ profile?: string }>;
}) {

  const { profile } = await searchParams;
  const [profiles, activeProfile] = await Promise.all([
    listProfiles(),
    getActiveProfile(profile),
  ]);
  if (!activeProfile) redirect("/workout");

  const [assignments, library] = await Promise.all([
    getAssignments(activeProfile.id),
    listWorkoutsWithCreator(),
  ]);
  const byDay = new Map(assignments.map((a) => [a.weekday, a.workoutId]));

  return (
    <Container maxWidth="sm" sx={{ py: { xs: 4, md: 6 } }}>
      <Button
        component={Link}
        href={`/workout?profile=${activeProfile.id}`}
        startIcon={<ArrowBackIcon />}
        sx={{ mb: 2 }}
      >
        Back
      </Button>

      <Typography variant="h4" component="h1">
        {activeProfile.name}&apos;s schedule
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Pick a workout for each day (or leave it as Rest). Changes save instantly.
      </Typography>

      {/* Switch which profile you're scheduling (persists across the app) */}
      {profiles.length > 1 ? (
        <Stack direction="row" spacing={1} sx={{ mb: 3, flexWrap: "wrap", gap: 1 }}>
          {profiles.map((p) => (
            <form key={p.id} action={switchProfile.bind(null, p.id)}>
              <Button
                type="submit"
                size="small"
                variant={p.id === activeProfile.id ? "contained" : "outlined"}
              >
                {p.name}
              </Button>
            </form>
          ))}
        </Stack>
      ) : null}

      <Stack spacing={1}>
        {ORDER.map((d) => (
          // Key by profile+day so switching profiles remounts the selects with
          // the new profile's values (uncontrolled defaults don't reset on nav).
          <Paper
            key={`${activeProfile.id}-${d}`}
            variant="outlined"
            sx={{ p: 1.5, display: "flex", alignItems: "center", gap: 2 }}
          >
            <Typography sx={{ width: 96, flexShrink: 0, fontWeight: 500 }}>
              {WEEKDAYS[d].label}
            </Typography>
            <AssignSelect
              action={setAssignment.bind(null, activeProfile.id, d)}
              workouts={library.map((w) => ({ id: w.id, name: w.name }))}
              current={byDay.get(d) ?? null}
            />
          </Paper>
        ))}
      </Stack>
    </Container>
  );
}
