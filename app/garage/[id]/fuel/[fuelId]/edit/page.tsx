import { notFound } from "next/navigation";
import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import { getVehicle } from "@/lib/queries/vehicles";
import { getFuelLog } from "@/lib/queries/fuel";
import { updateFuel } from "@/app/actions/fuel";
import FuelForm from "@/components/garage/FuelForm";

export default async function EditFuelPage({
  params,
}: {
  params: Promise<{ id: string; fuelId: string }>;
}) {

  const { id: idParam, fuelId: fuelParam } = await params;
  const id = Number(idParam);
  const fuelId = Number(fuelParam);
  if (!Number.isInteger(id) || !Number.isInteger(fuelId)) notFound();

  const [vehicle, log] = await Promise.all([getVehicle(id), getFuelLog(fuelId)]);
  if (!vehicle || !log || log.vehicleId !== id) notFound();

  return (
    <Container maxWidth="md" sx={{ py: { xs: 4, md: 6 } }}>
      <Typography variant="h4" component="h1">
        Edit fill-up
      </Typography>
      <Typography variant="subtitle1" color="text.secondary" sx={{ mb: 3 }}>
        {vehicle.name}
      </Typography>
      <Paper variant="outlined" sx={{ p: { xs: 2.5, md: 4 } }}>
        <FuelForm
          action={updateFuel.bind(null, fuelId, id)}
          log={log}
          submitLabel="Save changes"
          cancelHref={`/garage/${id}?tab=fuel`}
        />
      </Paper>
    </Container>
  );
}
