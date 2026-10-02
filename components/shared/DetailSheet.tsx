"use client";

import type * as React from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import IconButton from "@mui/material/IconButton";
import Typography from "@mui/material/Typography";
import CloseIcon from "@mui/icons-material/Close";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useTheme } from "@mui/material/styles";

// A read-only drill-down for one item of a list (an account, a bill, a fund):
// full screen on a phone, a regular dialog from `sm` up. Edit forms stay
// their own dialogs; this one only explains.
export default function DetailSheet({
  open,
  onClose,
  overline,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  overline?: React.ReactNode;
  title: React.ReactNode;
  children: React.ReactNode;
}) {
  const fullScreen = useMediaQuery(useTheme().breakpoints.down("sm"));

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullScreen={fullScreen}
      fullWidth
      maxWidth="sm"
      scroll="paper"
      slotProps={{ paper: { sx: { pt: fullScreen ? "env(safe-area-inset-top)" : undefined } } }}
    >
      <DialogTitle component="div" sx={{ pr: 7, pb: 1 }}>
        {overline ? (
          <Typography variant="caption" color="text.secondary" component="div">
            {overline}
          </Typography>
        ) : null}
        <Typography variant="h5" component="h2">
          {title}
        </Typography>
        <IconButton
          aria-label="Close"
          onClick={onClose}
          sx={{ position: "absolute", right: 12, top: fullScreen ? "calc(env(safe-area-inset-top) + 12px)" : 12 }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ pb: 4 }}>{children}</DialogContent>
    </Dialog>
  );
}
