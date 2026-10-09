"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { CcLeague } from "@/lib/commandCenter/types";
import ConnectWriteAccess from "./ConnectWriteAccess";
import PermissionBar from "./PermissionBar";
import ProposalsPanel from "./ProposalsPanel";
import { PageHead, SectionHead } from "./PageHead";
import { StatCard, StatCardGrid } from "./StatCard";

// Command Center 2.0 — Review Queue. One place for everything waiting on a decision:
//   · plans drafted by the Command Center chat (saved proposals): send one, send a reviewed batch, group-select by kind,
//     exclude a league from the batch, reject, or queue a failed one again
//   · alerts the sync raised (links to the Alerts page) and pending trades / waiver claims (links to Trades & Claims)
// Sending still needs Live mode + Sleeper access, and the executor re-checks every proposal against a fresh read first.
export default function ReviewQueue({ alertCount, actionRequired }: { alertCount: number; actionRequired: number }) {
  const [leagues, setLeagues] = useState<CcLeague[] | null>(null);
  const [error, setError] = useState("");
  const [waiting, setWaiting] = useState<number | null>(null);
  const [, setTokenTick] = useState(0); // re-render once Sleeper access connects so Send buttons enable

  useEffect(() => {
    let cancelled = false;
    fetch("/api/manager/command-leagues")
      .then(async (r) => {
        const b = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(b.error || "Couldn't load your leagues.");
        if (!cancelled) setLeagues(b.leagues as CcLeague[]);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Couldn't load your leagues."));
    fetch("/api/manager/proposals")
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => {
        if (!cancelled && b?.proposals) setWaiting((b.proposals as { status: string }[]).filter((p) => p.status === "proposed" || p.status === "approved").length);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <section className="sec" style={{ paddingBottom: 0 }}>
        <PageHead
          description={
            <>
              Everything waiting on your decision. Plans from the Command Center chat land here as proposals — nothing reaches
              Sleeper until you send it, and every one is re-checked against a fresh read of that league first.
            </>
          }
        />
        <StatCardGrid variant="grid">
          <StatCard label="Plans to review" value={waiting ?? "—"} valueColor={waiting ? "var(--amber)" : undefined} sub="from the chat" />
          <StatCard label="Open alerts" value={alertCount} sub={<Link href="/manager/actions">{actionRequired} need action →</Link>} />
          <StatCard label="Trades & claims" value="Scan" sub={<Link href="/manager/inbox">Pending offers and claims →</Link>} />
          <StatCard label="What was sent" value="Log" sub={<Link href="/manager/activity">Activity log →</Link>} />
        </StatCardGrid>
      </section>

      <section className="sec">
        <SectionHead title="Plans from the chat" />
        <PermissionBar />
        <ConnectWriteAccess onTokenReady={() => setTokenTick((t) => t + 1)} />
        {error && <div className="err">{error}</div>}
        {!leagues && !error && <p className="hint">Loading your leagues…</p>}
        {leagues && <ProposalsPanel leagues={leagues} version={0} />}
      </section>
    </>
  );
}
