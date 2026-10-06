import { redirect } from "next/navigation";

// Passkeys (and your password) moved to the hub page's "Your sign-in" section.
export default function PasskeysPage() {
  redirect("/group?tab=sign-in");
}
