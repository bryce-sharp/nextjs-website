import { notFound } from "next/navigation";
import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import { getVehicle } from "@/lib/queries/vehicles";
import { getPart } from "@/lib/queries/parts";
import { updatePart } from "@/app/actions/parts";
import PartForm from "@/components/garage/PartForm";

export default async function EditPartPage({
  params,
}: {
  params: Promise<{ id: string; partId: string }>;
}) {

  const { id: idParam, partId: partParam } = await params;
  const id = Number(idParam);
  const partId = Number(partParam);
  if (!Number.isInteger(id) || !Number.isInteger(partId)) notFound();

  const [vehicle, part] = await Promise.all([getVehicle(id), getPart(partId)]);
  if (!vehicle || !part || part.vehicleId !== id) notFound();

  return (
    <Container maxWidth="md" sx={{ py: { xs: 4, md: 6 } }}>
      <Typography variant="h4" component="h1">
        Edit part
      </Typography>
      <Typography variant="subtitle1" color="text.secondary" sx={{ mb: 3 }}>
        {vehicle.name}
      </Typography>
      <Paper variant="outlined" sx={{ p: { xs: 2.5, md: 4 } }}>
        <PartForm
          action={updatePart.bind(null, partId, id)}
          part={part}
          submitLabel="Save changes"
          cancelHref={`/garage/${id}?tab=parts`}
        />
      </Paper>
    </Container>
  );
}
