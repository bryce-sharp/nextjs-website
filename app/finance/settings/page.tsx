import Link from "@/components/shared/AppLink";
import { redirect } from "next/navigation";
import Container from "@mui/material/Container";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Alert from "@mui/material/Alert";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { isEditor } from "@/lib/auth";
import { getSession } from "@/lib/session";
import { listApiTokens } from "@/lib/queries/finance-tokens";
import { listFinancialAccounts } from "@/lib/queries/finance-networth";
import TokenManager from "@/components/finance/TokenManager";

export const metadata = { title: "Finance · Connections" };

// Finance settings: the API tokens the phone automations use (ingest shortcut,
// widget reader). Household-shared.
export default async function FinanceSettingsPage() {
  if ((await getSession()) === null) redirect("/login");
  const editor = await isEditor();

  const [tokens, accounts] = await Promise.all([
    listApiTokens(),
    listFinancialAccounts(),
  ]);

  return (
    <Container maxWidth="sm" sx={{ py: { xs: 4, md: 6 } }}>
      <Button
        component={Link}
        href="/finance"
        startIcon={<ArrowBackIcon />}
        color="inherit"
        sx={{ mb: 2 }}
      >
        Back to budget
      </Button>

      <Stack spacing={0.5} sx={{ mb: 3 }}>
        <Typography variant="h4" component="h1">
          Connections
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Tokens that link your phone to the budget — the shortcut that sends
          card alerts in, and the lock-screen widget that reads it back.
        </Typography>
      </Stack>

      {editor ? (
        <TokenManager
          tokens={tokens.map((t) => ({
            id: t.id,
            label: t.label,
            scope: t.scope,
            accountName: t.accountName,
            lastUsedAt: t.lastUsedAt ? t.lastUsedAt.toISOString() : null,
            createdAt: t.createdAt.toISOString(),
          }))}
          accounts={accounts
            .filter((a) => !a.archivedAt)
            .map((a) => ({ id: a.id, name: a.name }))}
        />
      ) : (
        <Alert severity="info">Sign in to manage connections.</Alert>
      )}
    </Container>
  );
}
