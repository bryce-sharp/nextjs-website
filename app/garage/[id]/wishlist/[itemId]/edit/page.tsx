import { notFound } from "next/navigation";
import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import { getVehicle } from "@/lib/queries/vehicles";
import { getWishlistItem } from "@/lib/queries/wishlist";
import { updateWishlistItem } from "@/app/actions/wishlist";
import WishlistForm from "@/components/garage/WishlistForm";

export default async function EditWishlistPage({
  params,
}: {
  params: Promise<{ id: string; itemId: string }>;
}) {

  const { id: idParam, itemId: itemParam } = await params;
  const id = Number(idParam);
  const itemId = Number(itemParam);
  if (!Number.isInteger(id) || !Number.isInteger(itemId)) notFound();

  const [vehicle, item] = await Promise.all([
    getVehicle(id),
    getWishlistItem(itemId),
  ]);
  if (!vehicle || !item || item.vehicleId !== id) notFound();

  return (
    <Container maxWidth="md" sx={{ py: { xs: 4, md: 6 } }}>
      <Typography variant="h4" component="h1">
        Edit wishlist item
      </Typography>
      <Typography variant="subtitle1" color="text.secondary" sx={{ mb: 3 }}>
        {vehicle.name}
      </Typography>
      <Paper variant="outlined" sx={{ p: { xs: 2.5, md: 4 } }}>
        <WishlistForm
          action={updateWishlistItem.bind(null, itemId, id)}
          item={item}
          submitLabel="Save changes"
          cancelHref={`/garage/${id}?tab=wishlist`}
        />
      </Paper>
    </Container>
  );
}
