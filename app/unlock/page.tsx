import { redirect } from "next/navigation";

// Edit mode is gone (signed in = can edit), so old links to the unlock screen
// just go home.
export default function UnlockPage() {
  redirect("/");
}
