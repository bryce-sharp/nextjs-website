"use client";

import Link from "@/components/shared/AppLink";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";

// URL-driven tabs, like the garage's vehicle pages: each tab links to a query
// param on /group, so switching is a server navigation that loads only that
// tab's data and can be bookmarked. `active` comes from the server.

export type GroupTab = "people" | "invites" | "activity" | "sign-in" | "settings";

export default function GroupTabs({
  active,
  tabs,
}: {
  active: GroupTab;
  tabs: { value: GroupTab; label: string }[];
}) {
  return (
    <Tabs
      value={active}
      variant="scrollable"
      scrollButtons="auto"
      allowScrollButtonsMobile
      sx={{ borderBottom: 1, borderColor: "divider" }}
    >
      {tabs.map((t) => (
        <Tab
          key={t.value}
          label={t.label}
          value={t.value}
          component={Link}
          href={t.value === "people" ? "/group" : `/group?tab=${t.value}`}
        />
      ))}
    </Tabs>
  );
}
