import Box from "@mui/material/Box";
import { formatMoneyDelta, formatMoneyShort, formatMoneyWhole } from "@/lib/format";

// A balance that fits its screen: "$143.6k" on a phone, "$143,560" from `sm`
// up. Both render and CSS picks one, so it works in server components too.
export default function Money({ value, signed = false }: { value: number; signed?: boolean }) {
  const short = signed ? formatMoneyDelta(value, true) : formatMoneyShort(value);
  const whole = signed ? formatMoneyDelta(value) : formatMoneyWhole(value);
  return (
    <>
      <Box component="span" sx={{ display: { xs: "inline", sm: "none" } }}>
        {short}
      </Box>
      <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>
        {whole}
      </Box>
    </>
  );
}
