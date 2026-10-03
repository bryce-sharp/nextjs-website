import { notFound } from "next/navigation";
import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import { getVehicle } from "@/lib/queries/vehicles";
import { listAllServiceTypes } from "@/lib/queries/maintenance";
import { addMaintenance } from "@/app/actions/maintenance";
import MaintenanceForm from "@/components/garage/MaintenanceForm";

export default async function NewMaintenancePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {

  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isInteger(id)) notFound();

  const [vehicle, serviceOptions] = await Promise.all([
    getVehicle(id),
    listAllServiceTypes(),
  ]);
  if (!vehicle) notFound();

  return (
    <Container maxWidth="md" sx={{ py: { xs: 4, md: 6 } }}>
      <Typography variant="h4" component="h1">
        Add service record
      </Typography>
      <Typography variant="subtitle1" color="text.secondary" sx={{ mb: 3 }}>
        {vehicle.name}
      </Typography>
      <Paper variant="outlined" sx={{ p: { xs: 2.5, md: 4 } }}>
        <MaintenanceForm
          action={addMaintenance.bind(null, id)}
          submitLabel="Add record"
          cancelHref={`/garage/${id}?tab=maintenance`}
          serviceOptions={serviceOptions}
        />
      </Paper>
    </Container>
  );
}
