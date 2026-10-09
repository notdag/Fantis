"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useLeagueSelection, type Selection } from "@/lib/leagueSelection";

// `?scope=selection` (set by the League Manager's "… for these" buttons) narrows a bulk tool to the leagues selected
// on /manager/teams. Without the param, or with an empty selection, the tool shows every league as before.
export function useSelectionScope(): { on: boolean; selection: Selection } {
  const sp = useSearchParams();
  const selection = useLeagueSelection();
  return { on: sp.get("scope") === "selection" && selection.size > 0, selection };
}

export function ScopeBanner({ shown, total }: { shown: number; total: number }) {
  const pathname = usePathname();
  return (
    <div className="lmscope" role="status">
      <span>
        Showing only your <b>{shown}</b> selected league{shown === 1 ? "" : "s"} (of {total}).
      </span>
      <Link className="linklike" href="/manager/teams">Change selection</Link>
      <Link className="linklike" href={pathname}>Show every league</Link>
    </div>
  );
}
