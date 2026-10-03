import { notFound } from "next/navigation";
import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import { getExercise } from "@/lib/queries/workout";
import { updateExercise } from "@/app/actions/workout";
import ExerciseForm from "@/components/workout/ExerciseForm";

export const metadata = { title: "Edit exercise — Workout" };

export default async function EditExercisePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {

  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isInteger(id)) notFound();

  const exercise = await getExercise(id);
  if (!exercise) notFound();

  return (
    <Container maxWidth="md" sx={{ py: { xs: 4, md: 6 } }}>
      <Typography variant="h4" component="h1" sx={{ mb: 3 }}>
        Edit exercise
      </Typography>
      <Paper variant="outlined" sx={{ p: { xs: 2.5, md: 4 } }}>
        <ExerciseForm
          action={updateExercise.bind(null, id)}
          exercise={exercise}
          submitLabel="Save changes"
          cancelHref="/workout/catalog"
        />
      </Paper>
    </Container>
  );
}
