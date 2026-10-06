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
import { getMyGroup } from "@/lib/queries/groups";
import { listApiTokens } from "@/lib/queries/finance-tokens";
import { listFinancialAccounts } from "@/lib/queries/finance-networth";
import { listBankActivity, listBankConnections } from "@/lib/queries/finance-plaid";
import { formatDateTime } from "@/lib/format";
import { plaidConfigured, plaidEnv } from "@/lib/plaid/client";
import TokenManager from "@/components/finance/TokenManager";
import BankConnections from "@/components/finance/BankConnections";

export const metadata = { title: "Finance · Connections" };

// Finance settings: the banks synced through Plaid, plus the API tokens the
// phone automations use (ingest shortcut, widget reader). Household-shared;
// only the owner manages banks, and the demo login never sees them.
export default async function FinanceSettingsPage() {
  const session = await getSession();
  if (session === null) redirect("/login");
  const editor = await isEditor();

  // Bank tables are only read where Plaid is set up, so a deployment whose
  // database has not received them yet (a preview build) still renders.
  const configured = plaidConfigured();
  const [tokens, accounts, group, connections, activity] = await Promise.all([
    listApiTokens(),
    listFinancialAccounts(),
    getMyGroup(),
    configured ? listBankConnections() : Promise.resolve([]),
    configured ? listBankActivity() : Promise.resolve([]),
  ]);
  const tz = group?.timezone ?? "America/Chicago";
  const openAccounts = accounts.filter((a) => !a.archivedAt);
  const owner = group?.ownerAccountId === session.accountId;
  const showBanks = configured && !group?.isDemo;

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
          Your banks, synced through Plaid, and the tokens that link your phone
          to the budget: the shortcut that sends card alerts in, and the
          lock-screen widget that reads it back.
        </Typography>
      </Stack>

      <Stack spacing={3}>
        {showBanks ? (
          <BankConnections
            connections={connections.map((c) => ({
              id: c.id,
              institutionName: c.institutionName,
              status: c.status,
              lastError: c.lastError,
              lastSynced: c.lastSyncedAt ? formatDateTime(c.lastSyncedAt, tz) : null,
              lastWebhook: c.lastWebhookAt ? formatDateTime(c.lastWebhookAt, tz) : null,
              syncFrom: c.syncFrom,
              accounts: c.accounts.map((a) => ({
                id: a.id,
                name: a.name,
                mask: a.mask,
                financialAccountId: a.financialAccountId,
              })),
            }))}
            accounts={openAccounts.map((a) => ({ id: a.id, name: a.name }))}
            activity={activity.map((e) => ({
              id: e.id,
              when: formatDateTime(e.at, tz),
              message: e.message ?? e.kind,
              problem: e.kind === "webhook_rejected" || (e.kind === "sync" && e.data?.ok === false),
            }))}
            canManage={owner && configured}
            sandbox={plaidEnv() === "sandbox"}
          />
        ) : owner && !group?.isDemo ? (
          <Alert severity="info">
            Bank sync is not set up on this deployment yet. It needs
            PLAID_CLIENT_KEY, PLAID_TOKEN_KEY, and the secret matching PLAID_ENV
            (PLAID_SANDBOX_SECRET, or PLAID_PRODUCTION_SECRET with
            PLAID_ENV=production, which the live site requires).
          </Alert>
        ) : null}

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
            accounts={openAccounts.map((a) => ({ id: a.id, name: a.name }))}
          />
        ) : (
          <Alert severity="info">Sign in to manage connections.</Alert>
        )}
      </Stack>
    </Container>
  );
}
