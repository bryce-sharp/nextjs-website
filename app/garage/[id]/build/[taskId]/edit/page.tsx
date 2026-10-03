import { notFound } from "next/navigation";
import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import { getVehicle } from "@/lib/queries/vehicles";
import { getBuildTask } from "@/lib/queries/build";
import { updateBuildTask } from "@/app/actions/build";
import BuildTaskForm from "@/components/garage/BuildTaskForm";

export default async function EditBuildTaskPage({
  params,
}: {
  params: Promise<{ id: string; taskId: string }>;
}) {

  const { id: idParam, taskId: taskParam } = await params;
  const id = Number(idParam);
  const taskId = Number(taskParam);
  if (!Number.isInteger(id) || !Number.isInteger(taskId)) notFound();

  const [vehicle, task] = await Promise.all([
    getVehicle(id),
    getBuildTask(taskId),
  ]);
  if (!vehicle || !task || task.vehicleId !== id) notFound();

  return (
    <Container maxWidth="md" sx={{ py: { xs: 4, md: 6 } }}>
      <Typography variant="h4" component="h1">
        Edit build task
      </Typography>
      <Typography variant="subtitle1" color="text.secondary" sx={{ mb: 3 }}>
        {vehicle.name}
      </Typography>
      <Paper variant="outlined" sx={{ p: { xs: 2.5, md: 4 } }}>
        <BuildTaskForm
          action={updateBuildTask.bind(null, taskId, id)}
          task={task}
          submitLabel="Save changes"
          cancelHref={`/garage/${id}?tab=build`}
        />
      </Paper>
    </Container>
  );
}
