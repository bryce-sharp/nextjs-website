import { notFound } from "next/navigation";
import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import { getVehicle } from "@/lib/queries/vehicles";
import { addBuildTask } from "@/app/actions/build";
import BuildTaskForm from "@/components/garage/BuildTaskForm";

export default async function NewBuildTaskPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {

  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isInteger(id)) notFound();

  const vehicle = await getVehicle(id);
  if (!vehicle) notFound();

  return (
    <Container maxWidth="md" sx={{ py: { xs: 4, md: 6 } }}>
      <Typography variant="h4" component="h1">
        Add build task
      </Typography>
      <Typography variant="subtitle1" color="text.secondary" sx={{ mb: 3 }}>
        {vehicle.name}
      </Typography>
      <Paper variant="outlined" sx={{ p: { xs: 2.5, md: 4 } }}>
        <BuildTaskForm
          action={addBuildTask.bind(null, id)}
          submitLabel="Add task"
          cancelHref={`/garage/${id}?tab=build`}
        />
      </Paper>
    </Container>
  );
}
