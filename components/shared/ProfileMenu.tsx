"use client";

import * as React from "react";
import Link from "@/components/shared/AppLink";
import { useColorScheme } from "@mui/material/styles";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Avatar from "@mui/material/Avatar";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Divider from "@mui/material/Divider";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import PersonOutlineIcon from "@mui/icons-material/PersonOutline";
import DarkModeIcon from "@mui/icons-material/DarkModeOutlined";
import LightModeIcon from "@mui/icons-material/LightModeOutlined";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import LockOpenOutlinedIcon from "@mui/icons-material/LockOpenOutlined";
import GroupsIcon from "@mui/icons-material/Groups";
import FingerprintIcon from "@mui/icons-material/Fingerprint";
import LogoutIcon from "@mui/icons-material/Logout";
import CheckIcon from "@mui/icons-material/Check";
import { switchProfile } from "@/app/actions/profile";
import { enterEditModeAction, exitEditModeAction } from "@/app/actions/auth";
import { logoutAction } from "@/app/actions/session";

export type ProfilePick = {
  id: number;
  name: string;
  color: string | null;
  /** Username of the OTHER account claiming this profile, or null if it's
   *  unclaimed or claimed by you — i.e. whose data you can't edit. */
  lockedBy: string | null;
};

/** "Bryce" → "B", "Bryce Stock" → "BS". */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function ProfileAvatar({
  profile,
  size = 26,
}: {
  profile: ProfilePick;
  size?: number;
}) {
  return (
    <Avatar
      sx={{
        width: size,
        height: size,
        fontSize: size * 0.48,
        fontWeight: 700,
        bgcolor: profile.color ?? "primary.main",
        color: "#fff",
      }}
    >
      {initials(profile.name)}
    </Avatar>
  );
}

// The account menu for the whole hub: switch who you are, plus the app-wide
// bits — light/dark, the edit-mode toggle (passwordless since Phase D; claimed
// profiles are protected by their claim), and the account pages (Manage group,
// Passkeys, Sign out). All people/login management lives on /group.
export default function ProfileMenu({
  active,
  profiles,
  canEdit,
}: {
  active: ProfilePick | null;
  profiles: ProfilePick[];
  canEdit: boolean;
}) {
  const [anchor, setAnchor] = React.useState<null | HTMLElement>(null);
  const [, startTransition] = React.useTransition();

  // Color mode. useColorScheme() is undefined until mounted, so guard the toggle.
  const { mode, systemMode, setMode } = useColorScheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  const isDark = (mode === "system" ? systemMode : mode) === "dark";

  const closeMenu = () => setAnchor(null);

  function choose(id: number) {
    closeMenu();
    if (id !== active?.id) startTransition(() => switchProfile(id));
  }

  // One-click edit-mode toggle — no password, no dialog (see lib/auth).
  function toggleEditMode() {
    closeMenu();
    startTransition(() => (canEdit ? exitEditModeAction() : enterEditModeAction()));
  }

  return (
    <>
      <Button
        color="inherit"
        onClick={(e) => setAnchor(e.currentTarget)}
        aria-label={active ? `${active.name} — open account menu` : "Open account menu"}
        sx={{ textTransform: "none", minWidth: 0, gap: 0.75, px: 1 }}
      >
        {active ? (
          <>
            <ProfileAvatar profile={active} />
            <Box
              component="span"
              sx={{ display: { xs: "none", sm: "inline" }, fontWeight: 600 }}
            >
              {active.name}
            </Box>
          </>
        ) : (
          <PersonOutlineIcon />
        )}
        <KeyboardArrowDownIcon fontSize="small" />
      </Button>

      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={closeMenu}>
        {profiles.length > 0 ? (
          <Typography
            variant="overline"
            color="text.secondary"
            sx={{ px: 2, display: "block" }}
          >
            Switch profile
          </Typography>
        ) : null}
        {profiles.map((p) => (
          <MenuItem
            key={p.id}
            selected={p.id === active?.id}
            onClick={() => choose(p.id)}
          >
            <ListItemIcon>
              <ProfileAvatar profile={p} size={24} />
            </ListItemIcon>
            <ListItemText>{p.name}</ListItemText>
            {/* Edit mode is per-DEVICE, not per-profile: it still opens communal
                things (net worth, catalog, shared cars) while you're viewing
                someone else — only a claimed profile's OWN data is out of reach.
                The lock explains that on hover, and swallows its own click so
                tapping it on a phone reads the note instead of switching. */}
            {p.lockedBy ? (
              <Tooltip
                title={`${p.name}'s own data is locked — only ${p.lockedBy} can edit it. Household data still opens with edit mode.`}
                enterTouchDelay={0}
                leaveTouchDelay={4000}
              >
                <Box
                  component="span"
                  onClick={(e: React.MouseEvent) => e.stopPropagation()}
                  sx={{ display: "inline-flex", ml: 1 }}
                >
                  <LockOutlinedIcon
                    fontSize="small"
                    titleAccess={`${p.name} has their own login (${p.lockedBy})`}
                    sx={{ color: "text.disabled" }}
                  />
                </Box>
              </Tooltip>
            ) : null}
            {p.id === active?.id ? (
              <CheckIcon fontSize="small" color="primary" sx={{ ml: 1 }} />
            ) : null}
          </MenuItem>
        ))}

        {profiles.length > 0 ? <Divider /> : null}

        {/* App-wide settings: appearance + the edit-mode toggle. */}
        <MenuItem
          onClick={() => setMode(isDark ? "light" : "dark")}
          disabled={!mounted}
        >
          <ListItemIcon>
            {isDark ? (
              <LightModeIcon fontSize="small" />
            ) : (
              <DarkModeIcon fontSize="small" />
            )}
          </ListItemIcon>
          <ListItemText>{isDark ? "Light mode" : "Dark mode"}</ListItemText>
        </MenuItem>

        <MenuItem onClick={toggleEditMode}>
          <ListItemIcon>
            {canEdit ? (
              <LockOutlinedIcon fontSize="small" />
            ) : (
              <LockOpenOutlinedIcon fontSize="small" />
            )}
          </ListItemIcon>
          <ListItemText>{canEdit ? "Done editing" : "Enter edit mode"}</ListItemText>
        </MenuItem>

        <Divider />

        {/* The global login (whole household) — group, device passkeys, out. */}
        <MenuItem component={Link} href="/group" onClick={closeMenu}>
          <ListItemIcon>
            <GroupsIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Manage group…</ListItemText>
        </MenuItem>
        <MenuItem component={Link} href="/group#sign-in" onClick={closeMenu}>
          <ListItemIcon>
            <FingerprintIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Password & passkeys…</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            closeMenu();
            startTransition(() => logoutAction());
          }}
        >
          <ListItemIcon>
            <LogoutIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Sign out</ListItemText>
        </MenuItem>
      </Menu>
    </>
  );
}
