"use client";

import { createTheme, darken } from "@mui/material/styles";
import { chart, color, font, radius, spacing } from "./tokens";

const chartVars = (hues: readonly string[]) =>
  Object.fromEntries(hues.map((h, i) => [`--chart-${i + 1}`, h]));

// The theme is built from tokens (app/tokens.ts). The PRIMARY accent follows the
// active profile's picked color (passed down from the root layout), so the whole
// UI — buttons, links, active states — wears that person's color. When there's no
// profile/color it falls back to the brand default. There's no secondary accent
// anymore — everything that used to be tan now uses primary.
export function createAppTheme(accent?: string | null) {
  // The color picker guarantees a valid 6-digit hex, but guard anyway so a
  // malformed stored color can never white-screen the whole app.
  let accentMain: string = color.brandAccent;
  let accentDeep: string = color.brandAccentDeep;
  if (accent) {
    try {
      // Deepen for light mode so it stays legible on the near-white background,
      // mirroring the old green → deep-green pairing.
      accentDeep = darken(accent, 0.15);
      accentMain = accent;
    } catch {
      accentMain = color.brandAccent;
      accentDeep = color.brandAccentDeep;
    }
  }

  return createTheme({
    cssVariables: { colorSchemeSelector: "class" },
    spacing: spacing.unit,
    shape: { borderRadius: radius.base },
    colorSchemes: {
      dark: {
        palette: {
          primary: { main: accentMain },
          background: { default: color.darkBg, paper: color.darkSurface },
          divider: color.darkDivider,
        },
      },
      light: {
        palette: {
          primary: { main: accentDeep },
          background: { default: color.lightBg, paper: color.lightSurface },
          divider: color.lightDivider,
        },
      },
    },
    typography: {
      fontFamily: font.body,
      h1: { fontFamily: font.display, fontWeight: 700, letterSpacing: "-0.02em" },
      h2: { fontFamily: font.display, fontWeight: 700, letterSpacing: "-0.02em" },
      h3: {
        fontFamily: font.display,
        fontWeight: 700,
        letterSpacing: "-0.02em",
        // Page titles: 48px crowds a phone screen.
        "@media (max-width:599.95px)": { fontSize: "2.25rem" },
      },
      h4: { fontFamily: font.display, fontWeight: 600, letterSpacing: "-0.01em" },
      h5: { fontFamily: font.display, fontWeight: 600 },
      h6: { fontFamily: font.display, fontWeight: 600 },
      button: { textTransform: "none", fontWeight: 600 },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          a: { color: "inherit", textDecoration: "none" },
          // Chart hues swap with the scheme class, like the --mui-palette-* vars.
          ":root": { ...chartVars(chart.light), "--chart-other": chart.other },
          ":root.dark": chartVars(chart.dark),
        },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: { borderRadius: radius.button, paddingInline: 18, paddingBlock: 8 },
        },
      },
      MuiPaper: {
        styleOverrides: { root: { backgroundImage: "none" } },
      },
      MuiCard: {
        styleOverrides: {
          root: {
            backgroundImage: "none",
            border: "1px solid var(--mui-palette-divider)",
          },
        },
      },
      MuiAppBar: {
        defaultProps: { elevation: 0 },
      },
      // One pill style used everywhere (targets, rounds, "saved by", categories,
      // profile labels, statuses) so chips are always consistent — no custom
      // wrapper to remember to import. Chips default to the compact outlined
      // "pill" look; pass variant="filled" / size="medium" to opt out per use.
      MuiChip: {
        defaultProps: { size: "small", variant: "outlined" },
        styleOverrides: {
          root: {
            height: 26,
            borderRadius: 13,
            // A bit of breathing room around any icon, and comfortable label padding.
            "& .MuiChip-icon": { marginLeft: 8, marginRight: -2, fontSize: 16 },
            "& .MuiChip-label": { paddingLeft: 10, paddingRight: 10 },
          },
        },
      },
    },
  });
}
