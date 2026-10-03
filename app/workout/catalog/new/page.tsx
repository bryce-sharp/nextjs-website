import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import { addExercise } from "@/app/actions/workout";
import ExerciseForm from "@/components/workout/ExerciseForm";

export const metadata = { title: "Add exercise — Workout" };

export default async function NewExercisePage() {
  return (
    <Container maxWidth="md" sx={{ py: { xs: 4, md: 6 } }}>
      <Typography variant="h4" component="h1" sx={{ mb: 3 }}>
        Add exercise
      </Typography>
      <Paper variant="outlined" sx={{ p: { xs: 2.5, md: 4 } }}>
        <ExerciseForm
          action={addExercise}
          submitLabel="Add exercise"
          cancelHref="/workout/catalog"
        />
      </Paper>
    </Container>
  );
}
