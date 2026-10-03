import Link from "@/components/shared/AppLink";
import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import AddIcon from "@mui/icons-material/Add";
import DirectionsCarIcon from "@mui/icons-material/DirectionsCar";
import { listVehicles } from "@/lib/queries/vehicles";
import { listAllDueRecords } from "@/lib/queries/summaries";
import { isEditor } from "@/lib/auth";
import { getActiveProfile } from "@/lib/profile";
import { recordDueStatus, worstStatus, type DueStatus } from "@/lib/reminders";
import VehicleCard from "@/components/garage/VehicleCard";

export const metadata = { title: "Garage" };

export default async function GaragePage() {
  const active = await getActiveProfile();
  // -1 matches no real owner, so with no active profile only shared cars show.
  const pid = active?.id ?? -1;
  const [vehicles, editor, dueRecords] = await Promise.all([
    listVehicles(pid),
    isEditor(),
    listAllDueRecords(pid),
  ]);

  // Compute a "due soon / overdue" badge per vehicle from its next-due records.
  const now = new Date();
  const mileageById = new Map(vehicles.map((v) => [v.id, v.currentMileage]));
  const statusesByVehicle = new Map<number, DueStatus[]>();
  for (const d of dueRecords) {
    const status = recordDueStatus(d, mileageById.get(d.vehicleId) ?? null, now);
    const arr = statusesByVehicle.get(d.vehicleId) ?? [];
    arr.push(status);
    statusesByVehicle.set(d.vehicleId, arr);
  }
  const reminderFor = (id: number) =>
    worstStatus(statusesByVehicle.get(id) ?? []) ?? undefined;

  return (
    <Container maxWidth="lg" sx={{ py: { xs: 4, md: 6 } }}>
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        spacing={2}
        sx={{ mb: 3 }}
      >
        <Box>
          <Typography variant="h4" component="h1">
            The Garage
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {vehicles.length} {vehicles.length === 1 ? "vehicle" : "vehicles"}
          </Typography>
        </Box>
        {editor ? (
          <Button
            component={Link}
            href="/garage/new"
            variant="contained"
            startIcon={<AddIcon />}
          >
            Add vehicle
          </Button>
        ) : null}
      </Stack>

      {vehicles.length === 0 ? (
        <Paper variant="outlined" sx={{ p: { xs: 4, md: 6 }, textAlign: "center" }}>
          <DirectionsCarIcon
            sx={{ fontSize: 48, color: "text.disabled", mb: 1 }}
          />
          <Typography variant="h6" gutterBottom>
            No vehicles yet
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Add your first vehicle to start tracking maintenance, fuel, and the build.
          </Typography>
          {editor ? (
            <Button
              component={Link}
              href="/garage/new"
              variant="contained"
              startIcon={<AddIcon />}
            >
              Add vehicle
            </Button>
          ) : null}
        </Paper>
      ) : (
        <Box
          sx={{
            display: "grid",
            gap: 2,
            gridTemplateColumns: {
              xs: "1fr",
              sm: "1fr 1fr",
              md: "repeat(3, 1fr)",
            },
          }}
        >
          {vehicles.map((v) => (
            <VehicleCard
              key={v.id}
              vehicle={v}
              editor={editor}
              reminder={reminderFor(v.id)}
            />
          ))}
        </Box>
      )}
    </Container>
  );
}
