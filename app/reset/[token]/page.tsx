import Container from "@mui/material/Container";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import LinkOffIcon from "@mui/icons-material/LinkOff";
import { getSession } from "@/lib/session";
import { MIN_PASSWORD_LENGTH, findLiveReset } from "@/lib/password-reset";
import ResetForm from "./ResetForm";

export const metadata = { title: "Reset your password — Hub" };

// The reset landing page — public like /join (the proxy allowlists /reset/*;
// the unguessable token is the credential). Dead links (unknown, used,
// revoked, expired) all get the same message.
export default async function ResetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [reset, session] = await Promise.all([findLiveReset(token), getSession()]);

  if (!reset) {
    return (
      <Container maxWidth="xs" sx={{ py: { xs: 6, md: 10 } }}>
        <Paper variant="outlined" sx={{ p: { xs: 3, md: 4 } }}>
          <Stack spacing={2} alignItems="flex-start">
            <LinkOffIcon color="disabled" fontSize="large" />
            <Typography variant="h5" component="h1">
              This reset link is not valid
            </Typography>
            <Typography variant="body2" color="text.secondary">
              It may have expired, been used already, or been cancelled. Ask the hub&apos;s owner
              for a new one.
            </Typography>
          </Stack>
        </Paper>
      </Container>
    );
  }

  return (
    <Container maxWidth="xs" sx={{ py: { xs: 6, md: 10 } }}>
      <ResetForm
        token={token}
        username={reset.username}
        minLength={MIN_PASSWORD_LENGTH}
        signedIn={session !== null}
      />
    </Container>
  );
}
