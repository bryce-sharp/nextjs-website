import { notFound } from "next/navigation";
import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import { getVehicle } from "@/lib/queries/vehicles";
import { addJournal } from "@/app/actions/journal";
import JournalForm from "@/components/garage/JournalForm";

export default async function NewJournalPage({
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
        New journal entry
      </Typography>
      <Typography variant="subtitle1" color="text.secondary" sx={{ mb: 3 }}>
        {vehicle.name}
      </Typography>
      <Paper variant="outlined" sx={{ p: { xs: 2.5, md: 4 } }}>
        <JournalForm
          action={addJournal.bind(null, id)}
          submitLabel="Save entry"
          cancelHref={`/garage/${id}?tab=journal`}
        />
      </Paper>
    </Container>
  );
}
