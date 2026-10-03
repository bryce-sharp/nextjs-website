import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import { listProfiles } from "@/lib/queries/profiles";
import { getActiveProfile } from "@/lib/profile";
import { addVehicle } from "@/app/actions/vehicles";
import VehicleForm from "@/components/garage/VehicleForm";

export default async function NewVehiclePage() {

  const [profiles, active] = await Promise.all([
    listProfiles(),
    getActiveProfile(),
  ]);

  return (
    <Container maxWidth="md" sx={{ py: { xs: 4, md: 6 } }}>
      <Typography variant="h4" component="h1" sx={{ mb: 3 }}>
        Add vehicle
      </Typography>
      <Paper variant="outlined" sx={{ p: { xs: 2.5, md: 4 } }}>
        <VehicleForm
          action={addVehicle}
          profiles={profiles}
          defaultProfileId={active?.id}
          submitLabel="Add vehicle"
          cancelHref="/garage"
        />
      </Paper>
    </Container>
  );
}
