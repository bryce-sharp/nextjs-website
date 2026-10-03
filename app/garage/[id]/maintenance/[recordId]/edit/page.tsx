import { notFound } from "next/navigation";
import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import { getVehicle } from "@/lib/queries/vehicles";
import {
  getMaintenanceRecord,
  listAllServiceTypes,
} from "@/lib/queries/maintenance";
import { updateMaintenance } from "@/app/actions/maintenance";
import MaintenanceForm from "@/components/garage/MaintenanceForm";

export default async function EditMaintenancePage({
  params,
}: {
  params: Promise<{ id: string; recordId: string }>;
}) {

  const { id: idParam, recordId: recParam } = await params;
  const id = Number(idParam);
  const recordId = Number(recParam);
  if (!Number.isInteger(id) || !Number.isInteger(recordId)) notFound();

  const [vehicle, record, serviceOptions] = await Promise.all([
    getVehicle(id),
    getMaintenanceRecord(recordId),
    listAllServiceTypes(),
  ]);
  // Guard against editing a record via the wrong vehicle URL.
  if (!vehicle || !record || record.vehicleId !== id) notFound();

  return (
    <Container maxWidth="md" sx={{ py: { xs: 4, md: 6 } }}>
      <Typography variant="h4" component="h1">
        Edit service record
      </Typography>
      <Typography variant="subtitle1" color="text.secondary" sx={{ mb: 3 }}>
        {vehicle.name}
      </Typography>
      <Paper variant="outlined" sx={{ p: { xs: 2.5, md: 4 } }}>
        <MaintenanceForm
          action={updateMaintenance.bind(null, recordId, id)}
          record={record}
          submitLabel="Save changes"
          cancelHref={`/garage/${id}?tab=maintenance`}
          serviceOptions={serviceOptions}
        />
      </Paper>
    </Container>
  );
}
