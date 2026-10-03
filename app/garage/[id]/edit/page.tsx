import { notFound } from "next/navigation";
import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import { getVehicle } from "@/lib/queries/vehicles";
import { listProfiles } from "@/lib/queries/profiles";
import { updateVehicle } from "@/app/actions/vehicles";
import VehicleForm from "@/components/garage/VehicleForm";

export default async function EditVehiclePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {

  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isInteger(id)) notFound();

  const [vehicle, profiles] = await Promise.all([getVehicle(id), listProfiles()]);
  if (!vehicle) notFound();

  return (
    <Container maxWidth="md" sx={{ py: { xs: 4, md: 6 } }}>
      <Typography variant="h4" component="h1" sx={{ mb: 3 }}>
        Edit {vehicle.name}
      </Typography>
      <Paper variant="outlined" sx={{ p: { xs: 2.5, md: 4 } }}>
        <VehicleForm
          action={updateVehicle.bind(null, vehicle.id)}
          vehicle={vehicle}
          profiles={profiles}
          submitLabel="Save changes"
          cancelHref={`/garage/${vehicle.id}`}
        />
      </Paper>
    </Container>
  );
}
