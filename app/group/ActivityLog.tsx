"use client";

import * as React from "react";
import Stack from "@mui/material/Stack";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Divider from "@mui/material/Divider";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import ButtonBase from "@mui/material/ButtonBase";
import Chip from "@mui/material/Chip";
import Collapse from "@mui/material/Collapse";
import Alert from "@mui/material/Alert";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import { listActivityAction } from "@/app/actions/activity";
import type { ActivityPage, ActivityRow } from "@/lib/queries/activity";

// The event log for the household owner (and site admins): newest first, a
// page at a time, filterable by source once there is more than one. A row
// opens to show what was recorded with it.

const SOURCE_LABEL: Record<string, string> = { plaid: "Bank" };
const sourceLabel = (source: string) =>
  SOURCE_LABEL[source] ?? source.charAt(0).toUpperCase() + source.slice(1);

function Row({ row, open, onToggle }: { row: ActivityRow; open: boolean; onToggle: () => void }) {
  return (
    <Box>
      <ButtonBase
        onClick={onToggle}
        aria-expanded={open}
        sx={{
          width: "100%",
          textAlign: "left",
          display: "grid",
          gridTemplateColumns: "112px minmax(0, 1fr) auto",
          columnGap: 1.5,
          alignItems: "start",
          px: 2,
          py: 1,
          fontSize: 13,
        }}
      >
        <Box sx={{ color: "text.secondary", whiteSpace: "nowrap" }}>{row.when}</Box>
        <Box sx={{ overflowWrap: "anywhere", color: row.problem ? "error.main" : "text.primary" }}>
          {row.message}
          {row.site ? <Chip size="small" label="Site" variant="outlined" sx={{ ml: 1, height: 18, fontSize: 11 }} /> : null}
        </Box>
        {open ? (
          <ExpandLessIcon fontSize="small" color="action" />
        ) : (
          <ExpandMoreIcon fontSize="small" color="action" />
        )}
      </ButtonBase>
      <Collapse in={open} unmountOnExit>
        <Box sx={{ px: 2, pb: 1.5, pl: { xs: 2, sm: "calc(112px + 28px)" } }}>
          <Typography variant="caption" color="text.secondary" component="div">
            {sourceLabel(row.source)} · {row.kind.replace(/_/g, " ")}
            {row.site ? " · belongs to no household" : ""}
          </Typography>
          {row.data ? (
            <Box
              component="pre"
              sx={{
                m: 0,
                mt: 0.5,
                p: 1,
                borderRadius: 1,
                bgcolor: "action.hover",
                fontSize: 12,
                overflowX: "auto",
                whiteSpace: "pre-wrap",
                overflowWrap: "anywhere",
              }}
            >
              {JSON.stringify(row.data, null, 2)}
            </Box>
          ) : null}
        </Box>
      </Collapse>
    </Box>
  );
}

export default function ActivityLog({
  initial,
  sources,
  owner,
  siteAdmin,
}: {
  initial: ActivityPage;
  sources: string[];
  owner: boolean;
  siteAdmin: boolean;
}) {
  const [source, setSource] = React.useState<string | null>(null);
  const [rows, setRows] = React.useState(initial.rows);
  const [more, setMore] = React.useState(initial.more);
  const [openId, setOpenId] = React.useState<number | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function load(nextSource: string | null, before: number | null) {
    setLoading(true);
    setError(null);
    const res = await listActivityAction({ source: nextSource, before });
    setLoading(false);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    setRows((current) => (before === null ? res.rows : [...current, ...res.rows]));
    setMore(res.more);
  }

  function pick(next: string | null) {
    if (next === source || loading) return;
    setSource(next);
    setOpenId(null);
    void load(next, null);
  }

  return (
    <Stack spacing={1.5}>
      <Typography variant="body2" color="text.secondary">
        {owner
          ? "What the site has done for this household, newest first: so far, the banks' change notices and every sync. Kept for 180 days, and only the owner sees it."
          : "Kept for 180 days, newest first."}
        {siteAdmin
          ? " As a site admin you also see site events, marked Site: ones that belong to no household, such as a bank notice the site refused."
          : ""}
      </Typography>

      {sources.length > 1 ? (
        <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", rowGap: 1 }}>
          <Chip
            label="All"
            size="small"
            color={source === null ? "primary" : "default"}
            variant={source === null ? "filled" : "outlined"}
            onClick={() => pick(null)}
          />
          {sources.map((s) => (
            <Chip
              key={s}
              label={sourceLabel(s)}
              size="small"
              color={source === s ? "primary" : "default"}
              variant={source === s ? "filled" : "outlined"}
              onClick={() => pick(s)}
            />
          ))}
        </Stack>
      ) : null}

      {error ? (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      ) : null}

      {rows.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Nothing recorded yet.
        </Typography>
      ) : (
        <Paper variant="outlined" sx={{ overflow: "hidden", opacity: loading && rows.length ? 0.7 : 1 }}>
          {rows.map((row, i) => (
            <React.Fragment key={row.id}>
              {i > 0 ? <Divider /> : null}
              <Row
                row={row}
                open={openId === row.id}
                onToggle={() => setOpenId((id) => (id === row.id ? null : row.id))}
              />
            </React.Fragment>
          ))}
        </Paper>
      )}

      {more ? (
        <Box>
          <Button
            size="small"
            color="inherit"
            disabled={loading}
            onClick={() => void load(source, rows[rows.length - 1]?.id ?? null)}
          >
            {loading ? "Loading…" : "Show more"}
          </Button>
        </Box>
      ) : null}
    </Stack>
  );
}
