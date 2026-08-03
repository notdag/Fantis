import type { Metadata } from "next";
import { cookies } from "next/headers";
import { ADMIN_COOKIE, isValidToken } from "@/lib/adminAuth";
import { PLAYERS } from "@/lib/players";
import AdminLogin from "@/components/AdminLogin";
import TierBoard from "@/components/TierBoard";

// Not linked from the main nav and not indexable — reachable only if you
// know the URL, same spirit as the passphrase gate below.
export const metadata: Metadata = {
  title: "Fantis — Admin",
  robots: { index: false, follow: false },
};

export default async function AdminPage() {
  const store = await cookies();
  const authed = isValidToken(store.get(ADMIN_COOKIE)?.value);

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
        {authed ? <TierBoard initialPlayers={PLAYERS} /> : <AdminLogin />}
      </div>
    </div>
  );
}
