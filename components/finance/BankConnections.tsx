"use client";

import * as React from "react";
import { usePlaidLink } from "react-plaid-link";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Alert from "@mui/material/Alert";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import AddIcon from "@mui/icons-material/Add";
import AccountBalanceIcon from "@mui/icons-material/AccountBalance";
import SyncIcon from "@mui/icons-material/Sync";
import DeleteIconButton from "@/components/shared/DeleteIconButton";
import { formatDate } from "@/lib/format";
import {
  connectBankAction,
  createLinkTokenAction,
  disconnectBankAction,
  mapBankAccountAction,
  markBankRepairedAction,
  syncBankAction,
} from "@/app/actions/finance-plaid";

export type BankAccount = {
  id: number;
  name: string;
  mask: string | null;
  financialAccountId: number | null;
};

export type BankConnection = {
  id: number;
  institutionName: string;
  status: string;
  lastError: string | null;
  lastSyncedAt: string | null;
  /** Bank transactions from this date on reach the ledger. */
  syncFrom: string;
  accounts: BankAccount[];
};

export type FeedableAccount = { id: number; name: string };

const STATUS: Record<string, { label: string; color: "success" | "warning" | "error" }> = {
  ok: { label: "Connected", color: "success" },
  login_required: { label: "Needs sign-in", color: "warning" },
  pending_disconnect: { label: "Expiring soon", color: "warning" },
  revoked: { label: "Access revoked", color: "error" },
  error: { label: "Error", color: "error" },
};

type Notice = { severity: "error" | "info"; text: string };

// Banks synced through Plaid, each bank account pointed at one app account.
// Only the owner connects, repairs, maps, and disconnects; everyone else sees
// the status read-only.
export default function BankConnections({
  connections,
  accounts,
  canManage,
  sandbox,
}: {
  connections: BankConnection[];
  accounts: FeedableAccount[];
  canManage: boolean;
  sandbox: boolean;
}) {
  const [linkToken, setLinkToken] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [syncingId, setSyncingId] = React.useState<number | null>(null);
  const [notice, setNotice] = React.useState<Notice | null>(null);
  // The item being repaired in update mode; null = a brand-new connection.
  // A ref, because Plaid keeps the callbacks from when its pop-up was created.
  const repairId = React.useRef<number | null>(null);

  const [mapping, applyMapping] = React.useOptimistic(
    Object.fromEntries(
      connections.flatMap((c) => c.accounts.map((a) => [a.id, a.financialAccountId])),
    ) as Record<number, number | null>,
    (state, update: { id: number; to: number | null }) => ({ ...state, [update.id]: update.to }),
  );
  const [, startTransition] = React.useTransition();

  async function finish(publicToken: string | null) {
    setLinkToken(null);
    setBusy(true);
    const repairing = repairId.current;
    repairId.current = null;
    const res =
      repairing !== null
        ? await markBankRepairedAction(repairing)
        : publicToken
          ? await connectBankAction(publicToken)
          : { error: "Plaid did not return a connection." };
    setBusy(false);
    if ("error" in res) {
      setNotice({ severity: "error", text: res.error });
    } else if ("duplicateOf" in res && res.duplicateOf) {
      setNotice({
        severity: "info",
        text: `${res.duplicateOf} was already connected. Disconnect one of the two so nothing is imported twice.`,
      });
    } else if ("summary" in res) {
      setNotice({ severity: "info", text: `${repairing !== null ? "Reconnected" : "Connected"}. ${res.summary}` });
    }
  }

  async function sync(c: BankConnection) {
    setNotice(null);
    setSyncingId(c.id);
    const res = await syncBankAction(c.id);
    setSyncingId(null);
    setNotice(
      "error" in res
        ? { severity: "error", text: res.error }
        : { severity: "info", text: `${c.institutionName}: ${res.summary}` },
    );
  }

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: (publicToken) => void finish(publicToken),
    onExit: (err) => {
      setLinkToken(null);
      repairId.current = null;
      if (err) setNotice({ severity: "error", text: err.display_message ?? err.error_message });
    },
  });

  // Plaid's pop-up opens as soon as the freshly fetched token has loaded.
  React.useEffect(() => {
    if (linkToken && ready) open();
  }, [linkToken, ready, open]);

  async function start(itemId: number | null) {
    if (itemId === null && connections.length > 0) {
      const names = connections.map((c) => c.institutionName).join(", ");
      const ok = window.confirm(
        `Already connected: ${names}. To fix one of those, use its Reconnect button instead. Each new connection uses one of your free Plaid slots, even if it is later removed.`,
      );
      if (!ok) return;
    }
    setNotice(null);
    setBusy(true);
    const res = await createLinkTokenAction(itemId);
    setBusy(false);
    if ("error" in res) {
      setNotice({ severity: "error", text: res.error });
      return;
    }
    repairId.current = itemId;
    setLinkToken(res.linkToken);
  }

  function map(id: number, to: number | null) {
    startTransition(async () => {
      applyMapping({ id, to });
      const res = await mapBankAccountAction(id, to);
      if ("error" in res) setNotice({ severity: "error", text: res.error });
    });
  }

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 2.5 } }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
        <Typography variant="h6" sx={{ flexGrow: 1 }}>
          Bank connections
        </Typography>
        {sandbox ? <Chip size="small" color="warning" variant="outlined" label="Sandbox" /> : null}
        {canManage ? (
          <Button size="small" startIcon={<AddIcon />} onClick={() => void start(null)} disabled={busy}>
            Connect a bank
          </Button>
        ) : null}
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Transactions from your banks, synced through Plaid. Card alerts from the
        shortcut still post instantly, and the bank confirms them later.
        {sandbox ? " Sandbox mode: these are Plaid's test banks, not real accounts." : ""}
      </Typography>

      {notice ? (
        <Alert severity={notice.severity} onClose={() => setNotice(null)} sx={{ mb: 2 }}>
          {notice.text}
        </Alert>
      ) : null}

      {connections.length === 0 ? (
        <Typography color="text.secondary">No banks connected yet.</Typography>
      ) : (
        <Stack spacing={2.5}>
          {connections.map((c) => {
            const status = STATUS[c.status] ?? STATUS.error;
            return (
              <Stack key={c.id} spacing={1.25}>
                <Stack direction="row" alignItems="center" spacing={1} sx={{ flexWrap: "wrap", rowGap: 1 }}>
                  <AccountBalanceIcon fontSize="small" color="action" />
                  <Typography sx={{ fontWeight: 500 }}>{c.institutionName}</Typography>
                  <Chip size="small" color={status.color} variant="outlined" label={status.label} />
                  <Typography variant="caption" color="text.secondary" sx={{ flexGrow: 1 }}>
                    {c.lastSyncedAt ? `synced ${formatDate(c.lastSyncedAt)}` : "not synced yet"}
                    {` · importing from ${formatDate(c.syncFrom)}`}
                  </Typography>
                  {canManage && c.status === "ok" ? (
                    <Button
                      size="small"
                      startIcon={<SyncIcon />}
                      onClick={() => void sync(c)}
                      disabled={busy || syncingId !== null}
                    >
                      {syncingId === c.id ? "Syncing…" : "Sync now"}
                    </Button>
                  ) : null}
                  {canManage && c.status !== "ok" ? (
                    <Button size="small" onClick={() => void start(c.id)} disabled={busy}>
                      Reconnect
                    </Button>
                  ) : null}
                  {canManage ? (
                    <DeleteIconButton
                      action={disconnectBankAction.bind(null, c.id)}
                      confirmMessage={`Disconnect ${c.institutionName}? Syncing stops; its transactions stay in your budget. On Plaid's free Trial this does not free up a connection slot, so use Reconnect if the connection is only broken.`}
                      label={`Disconnect ${c.institutionName}`}
                    />
                  ) : null}
                </Stack>
                {c.lastError && c.status !== "ok" ? (
                  <Typography variant="caption" color="error">
                    {c.lastError}
                  </Typography>
                ) : null}
                {c.accounts.map((a) => (
                  <Stack
                    key={a.id}
                    direction={{ xs: "column", sm: "row" }}
                    alignItems={{ xs: "stretch", sm: "center" }}
                    spacing={1}
                    sx={{ pl: { sm: 3.5 } }}
                  >
                    <Typography variant="body2" color="text.secondary" sx={{ flexGrow: 1 }} noWrap>
                      {a.name}
                      {a.mask ? ` ending ${a.mask}` : ""}
                    </Typography>
                    <TextField
                      select
                      size="small"
                      label="Feeds"
                      value={mapping[a.id] ?? ""}
                      onChange={(e) => map(a.id, e.target.value === "" ? null : Number(e.target.value))}
                      disabled={!canManage}
                      slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
                      sx={{ minWidth: { sm: 200 } }}
                    >
                      <MenuItem value="">
                        <em>Do not import</em>
                      </MenuItem>
                      {accounts.map((f) => (
                        <MenuItem key={f.id} value={f.id}>
                          {f.name}
                        </MenuItem>
                      ))}
                    </TextField>
                  </Stack>
                ))}
              </Stack>
            );
          })}
        </Stack>
      )}
    </Paper>
  );
}
