"use client";

import { usePathname, useSearchParams } from "next/navigation";

/**
 * The Budget page's filter on its transaction table: a slice (`?tag=`, a tag or
 * UNTAGGED, and/or `?lane=`, an engine category) or `?unlinked=1` (bill
 * payments with no current bill). Set with replaceState — no reload, and Next's
 * router stays in sync without a server round trip.
 */
export function useTableFilter() {
  const pathname = usePathname();
  const params = useSearchParams();
  const tag = params.get("tag");
  const lane = params.get("lane");
  const unlinked = params.get("unlinked") === "1";

  // Swap in one filter (or none) and bring the table into view when one is set.
  function apply(next: Record<string, string | null>) {
    const p = new URLSearchParams(params.toString());
    for (const k of ["tag", "lane", "unlinked"]) p.delete(k);
    let any = false;
    for (const [k, v] of Object.entries(next)) {
      if (v) {
        p.set(k, v);
        any = true;
      }
    }
    if (any) document.getElementById("transactions")?.scrollIntoView({ behavior: "smooth", block: "start" });
    const qs = p.toString();
    window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);
  }

  /** Filter the table to this slice; picking the active slice again clears it. */
  function toggle(nextTag: string | null, nextLane: string | null) {
    const same = !unlinked && tag === nextTag && lane === nextLane;
    apply(same ? {} : { tag: nextTag, lane: nextLane });
  }

  /** Show only unlinked bill payments; again clears it. */
  function toggleUnlinked() {
    apply(unlinked ? {} : { unlinked: "1" });
  }

  return { tag, lane, unlinked, toggle, toggleUnlinked };
}
