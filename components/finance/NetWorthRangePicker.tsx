import Link from "@/components/shared/AppLink";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import { NET_WORTH_RANGES, type NetWorthRange } from "@/lib/finance/net-worth";

// This year / 12 months / All time — each a full server render via ?range=
// (This year is the default and keeps the URL bare).
export default function NetWorthRangePicker({ current }: { current: NetWorthRange }) {
  return (
    <ToggleButtonGroup size="small" exclusive value={current} aria-label="Time range">
      {NET_WORTH_RANGES.map((r) => (
        <ToggleButton
          key={r.value}
          value={r.value}
          component={Link}
          href={r.value === "year" ? "/finance/net-worth" : `/finance/net-worth?range=${r.value}`}
          selected={r.value === current}
          sx={{ px: 1.5, py: 0.4 }}
        >
          {r.label}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}
