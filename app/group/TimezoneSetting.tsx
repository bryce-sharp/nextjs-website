"use client";

import * as React from "react";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import ScheduleIcon from "@mui/icons-material/Schedule";
import SubmitButton from "@/components/shared/SubmitButton";
import { updateGroupTimezoneAction } from "@/app/actions/group";

// Common US zones; the household's current zone + the browser-detected one get
// merged in, so the list always contains both without hardcoding the world.
const COMMON_ZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
];

/**
 * The household timezone — what pins the finance app's "today" (budget, widget,
 * incoming texts) so it rolls over at your midnight, not UTC's. Offers the
 * browser-detected zone as a one-tap default.
 */
export default function TimezoneSetting({
  timezone,
  canEdit,
}: {
  timezone: string;
  canEdit: boolean;
}) {
  const [editing, setEditing] = React.useState(false);
  const [value, setValue] = React.useState(timezone);

  const detected = React.useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
    } catch {
      return null;
    }
  }, []);

  const zones = React.useMemo(() => {
    const set = new Set(COMMON_ZONES);
    if (timezone) set.add(timezone);
    if (detected) set.add(detected);
    return [...set].sort();
  }, [detected, timezone]);

  if (!editing) {
    return (
      <Stack direction="row" spacing={1} alignItems="center">
        <ScheduleIcon fontSize="small" color="action" />
        <Typography variant="body2" color="text.secondary">
          Timezone: <strong>{timezone}</strong>
        </Typography>
        {canEdit ? (
          <Tooltip title="Change timezone">
            <IconButton
              size="small"
              onClick={() => {
                setValue(timezone);
                setEditing(true);
              }}
              aria-label="Change timezone"
            >
              <EditOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        ) : null}
      </Stack>
    );
  }

  return (
    <form
      action={async (fd) => {
        await updateGroupTimezoneAction(fd);
        setEditing(false);
      }}
    >
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <TextField
          name="timezone"
          label="Timezone"
          select
          size="small"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          sx={{ minWidth: 220 }}
        >
          {zones.map((z) => (
            <MenuItem key={z} value={z}>
              {z}
            </MenuItem>
          ))}
        </TextField>
        {detected && detected !== value ? (
          <Button size="small" color="inherit" onClick={() => setValue(detected)}>
            Use this device ({detected})
          </Button>
        ) : null}
        <SubmitButton size="small" variant="contained" pendingLabel="Saving…">
          Save
        </SubmitButton>
        <Button size="small" color="inherit" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </Stack>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
        Sets when the finance app rolls to the next day — your budget, the widget,
        and incoming card texts all use this.
      </Typography>
    </form>
  );
}
