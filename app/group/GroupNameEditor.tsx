"use client";

import * as React from "react";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Button from "@mui/material/Button";
import GroupsIcon from "@mui/icons-material/Groups";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import SubmitButton from "@/components/shared/SubmitButton";
import { renameGroupAction } from "@/app/actions/group";

/** The /group heading: household name with an inline rename. */
export default function GroupNameEditor({
  name,
  canEdit,
}: {
  name: string;
  canEdit: boolean;
}) {
  const [editing, setEditing] = React.useState(false);

  if (editing) {
    return (
      <form
        action={async (fd) => {
          await renameGroupAction(fd);
          setEditing(false);
        }}
      >
        <Stack direction="row" spacing={1} alignItems="center">
          <GroupsIcon color="primary" />
          <TextField
            name="name"
            defaultValue={name}
            size="small"
            autoFocus
            required
            slotProps={{ htmlInput: { maxLength: 120 } }}
          />
          <SubmitButton size="small" variant="contained" pendingLabel="Saving…">
            Save
          </SubmitButton>
          <Button size="small" color="inherit" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </Stack>
      </form>
    );
  }

  return (
    <Stack direction="row" spacing={1.5} alignItems="center">
      <GroupsIcon color="primary" />
      <Typography variant="h5" component="h1">
        {name}
      </Typography>
      {canEdit ? (
        <Tooltip title="Rename group">
          <IconButton size="small" onClick={() => setEditing(true)} aria-label="Rename group">
            <EditOutlinedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      ) : null}
    </Stack>
  );
}
