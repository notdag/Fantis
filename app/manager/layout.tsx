import { cookies } from "next/headers";
import { ADMIN_COOKIE, isValidToken } from "@/lib/adminAuth";
import AdminLogin from "@/components/AdminLogin";
import MgrTabs from "@/components/manager/MgrTabs";
import "./manager.css";

// Shared shell for every /manager/* page — auth gate, brand header, and the
// segmented tab nav all lived duplicated across six page.tsx files before
// this; consolidating here means each page only owns its own data-fetching
// and content, not four copies of the same cookie check.
export default async function ManagerLayout({ children }: { children: React.ReactNode }) {
  const store = await cookies();
  const authed = isValidToken(store.get(ADMIN_COOKIE)?.value);

  return (
    <div className="fantis">
      <div className="wrap">
        <nav className="nav" style={{ flexWrap: "wrap", gap: 14 }}>
          <div className="brand">
            <div className="mark">F</div>
            <b>Fantis</b>
            <span style={{ color: "var(--dim)", fontSize: 12, marginLeft: 6 }}>sleeper manager</span>
          </div>
          {authed && <MgrTabs />}
        </nav>
        {authed ? (
          children
        ) : (
          <AdminLogin
            title="Sleeper Manager access"
            description="Owner-only dashboard for managing your real Sleeper leagues. Not for regular visitors."
          />
        )}
      </div>
    </div>
  );
}
