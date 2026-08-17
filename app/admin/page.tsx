import type { Metadata } from "next";
import { cookies } from "next/headers";
import { ADMIN_COOKIE, isValidToken } from "@/lib/adminAuth";
import { db } from "@/lib/db";
import AdminLogin from "@/components/AdminLogin";
import TierBoard from "@/components/TierBoard";
import type { Player } from "@/lib/types";

// Not linked from the main nav and not indexable — reachable only if you
// know the URL, same spirit as the passphrase gate below.
export const metadata: Metadata = {
  title: "Fantis — Admin",
  robots: { index: false, follow: false },
};

export default async function AdminPage() {
  const store = await cookies();
  const authed = isValidToken(store.get(ADMIN_COOKIE)?.value);

  // Server-side DB read (same RankedPlayer table /api/players serves) —
  // avoids a client-side fetch just to get the board's starting state.
  const rows = authed
    ? await db.rankedPlayer.findMany({ orderBy: { order: "asc" } })
    : [];
  const initialPlayers: Player[] = rows.map((r) => ({
    name: r.name,
    pos: r.pos,
    team: r.team,
    tier: r.tier,
    posRank: r.posRank,
  }));

  return (
    <div className="fantis">
      <div className="wrap">
        <nav className="nav">
          <div className="brand">
            <div className="mark">F</div>
            <b>Fantis</b>
            <span style={{ color: "var(--dim)", fontSize: 12, marginLeft: 6 }}>admin</span>
          </div>
        </nav>
        {authed ? <TierBoard initialPlayers={initialPlayers} /> : <AdminLogin />}
      </div>
    </div>
  );
}
