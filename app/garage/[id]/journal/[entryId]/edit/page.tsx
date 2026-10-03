import { notFound } from "next/navigation";
import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import { getVehicle } from "@/lib/queries/vehicles";
import { getJournalEntry } from "@/lib/queries/journal";
import { updateJournal } from "@/app/actions/journal";
import JournalForm from "@/components/garage/JournalForm";

export default async function EditJournalPage({
  params,
}: {
  params: Promise<{ id: string; entryId: string }>;
}) {

  const { id: idParam, entryId: entryParam } = await params;
  const id = Number(idParam);
  const entryId = Number(entryParam);
  if (!Number.isInteger(id) || !Number.isInteger(entryId)) notFound();

  const [vehicle, entry] = await Promise.all([
    getVehicle(id),
    getJournalEntry(entryId),
  ]);
  if (!vehicle || !entry || entry.vehicleId !== id) notFound();

  return (
    <Container maxWidth="md" sx={{ py: { xs: 4, md: 6 } }}>
      <Typography variant="h4" component="h1">
        Edit journal entry
      </Typography>
      <Typography variant="subtitle1" color="text.secondary" sx={{ mb: 3 }}>
        {vehicle.name}
      </Typography>
      <Paper variant="outlined" sx={{ p: { xs: 2.5, md: 4 } }}>
        <JournalForm
          action={updateJournal.bind(null, entryId, id)}
          entry={entry}
          submitLabel="Save changes"
          cancelHref={`/garage/${id}?tab=journal`}
        />
      </Paper>
    </Container>
  );
}
