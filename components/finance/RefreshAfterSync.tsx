"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

// The page's bank data was a few hours old, so the server started a sync after
// sending it. Re-render once the sync has had time to land, so new transactions
// show without a reload. Renders nothing.
export default function RefreshAfterSync({ active, afterMs = 8000 }: { active: boolean; afterMs?: number }) {
  const router = useRouter();
  const done = React.useRef(false);
  React.useEffect(() => {
    if (!active || done.current) return;
    const timer = window.setTimeout(() => {
      done.current = true;
      router.refresh();
    }, afterMs);
    return () => window.clearTimeout(timer);
  }, [active, afterMs, router]);
  return null;
}
