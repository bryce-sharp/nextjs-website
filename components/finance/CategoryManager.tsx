"use client";

import * as React from "react";
import Dialog from "@mui/material/Dialog";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useTheme } from "@mui/material/styles";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Stack from "@mui/material/Stack";
import Box from "@mui/material/Box";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Chip from "@mui/material/Chip";
import Typography from "@mui/material/Typography";
import Alert from "@mui/material/Alert";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import CallMergeIcon from "@mui/icons-material/CallMerge";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import { reassignCategoryAction } from "@/app/actions/finance-atlas";

export type CategoryUsage = { category: string; count: number };

// Usage-derived category manager (no table): categories exist because bills use
// them. RENAME rewrites the label on every bill carrying it; MERGE moves them
// onto another category (which then absorbs them). Deleting = merge into
// another (or Uncategorized) — a category with no bills simply disappears.
export default function CategoryManager({
  open,
  onClose,
  usage,
}: {
  open: boolean;
  onClose: () => void;
  usage: CategoryUsage[];
}) {
  // Phones get the whole screen: room for the fields and the keyboard.
  const fullScreen = useMediaQuery(useTheme().breakpoints.down("sm"));
  const [renaming, setRenaming] = React.useState<string | null>(null);
  const [renameValue, setRenameValue] = React.useState("");
  const [merging, setMerging] = React.useState<string | null>(null);
  const [mergeTarget, setMergeTarget] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const names = usage.map((u) => u.category);

  function run(from: string, to: string | null) {
    setError(null);
    startTransition(async () => {
      try {
        await reassignCategoryAction(from, to, new FormData());
        setRenaming(null);
        setMerging(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't update.");
      }
    });
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs" fullScreen={fullScreen}>
      <DialogTitle>Categories</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Rename a category everywhere it&apos;s used, or merge it into another.
          New categories appear on their own when you type one on an expense.
        </Typography>
        {error ? <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert> : null}

        {usage.length === 0 ? (
          <Typography color="text.secondary">
            No categories yet — add one when you create an expense.
          </Typography>
        ) : (
          <Stack spacing={1}>
            {usage.map((u) => {
              const isRenaming = renaming === u.category;
              const isMerging = merging === u.category;
              return (
                <Box key={u.category}>
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <Typography sx={{ flexGrow: 1 }} noWrap>
                      {u.category}
                    </Typography>
                    <Chip
                      size="small"
                      label={`${u.count} ${u.count === 1 ? "bill" : "bills"}`}
                    />
                    <Tooltip title="Rename">
                      <IconButton
                        size="small"
                        disabled={pending}
                        onClick={() => {
                          setMerging(null);
                          setRenaming(u.category);
                          setRenameValue(u.category);
                        }}
                        aria-label={`Rename ${u.category}`}
                      >
                        <EditOutlinedIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Merge into another">
                      <span>
                        <IconButton
                          size="small"
                          disabled={pending || names.length < 2}
                          onClick={() => {
                            setRenaming(null);
                            setMerging(u.category);
                            setMergeTarget("");
                          }}
                          aria-label={`Merge ${u.category}`}
                        >
                          <CallMergeIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </Stack>

                  {isRenaming ? (
                    <Stack direction="row" spacing={1} sx={{ mt: 1, mb: 0.5 }}>
                      <TextField
                        size="small"
                        fullWidth
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        placeholder="New name"
                      />
                      <IconButton
                        size="small"
                        color="primary"
                        disabled={pending || !renameValue.trim()}
                        onClick={() => run(u.category, renameValue)}
                        aria-label="Save rename"
                      >
                        <CheckIcon fontSize="small" />
                      </IconButton>
                      <IconButton
                        size="small"
                        onClick={() => setRenaming(null)}
                        aria-label="Cancel rename"
                      >
                        <CloseIcon fontSize="small" />
                      </IconButton>
                    </Stack>
                  ) : null}

                  {isMerging ? (
                    <Stack direction="row" spacing={1} sx={{ mt: 1, mb: 0.5 }}>
                      <TextField
                        size="small"
                        select
                        fullWidth
                        label="Move its bills to"
                        value={mergeTarget}
                        onChange={(e) => setMergeTarget(e.target.value)}
                      >
                        {names
                          .filter((n) => n !== u.category)
                          .map((n) => (
                            <MenuItem key={n} value={n}>
                              {n}
                            </MenuItem>
                          ))}
                        <MenuItem value="__none__">Uncategorized</MenuItem>
                      </TextField>
                      <IconButton
                        size="small"
                        color="primary"
                        disabled={pending || !mergeTarget}
                        onClick={() =>
                          run(u.category, mergeTarget === "__none__" ? null : mergeTarget)
                        }
                        aria-label="Confirm merge"
                      >
                        <CheckIcon fontSize="small" />
                      </IconButton>
                      <IconButton
                        size="small"
                        onClick={() => setMerging(null)}
                        aria-label="Cancel merge"
                      >
                        <CloseIcon fontSize="small" />
                      </IconButton>
                    </Stack>
                  ) : null}
                </Box>
              );
            })}
          </Stack>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} color="inherit">
          Done
        </Button>
      </DialogActions>
    </Dialog>
  );
}
