import type { Metadata } from "next";
import ActivityLog from "@/components/manager/ActivityLog";
import { db } from "@/lib/db";

export const metadata: Metadata = {
  title: "Fantis — Activity Log",
  robots: { index: false, follow: false },
};

export default async function ActivityPage() {
  if (!process.env.DATABASE_URL) {
    return (
      <section className="sec">
        <h2>Activity Log</h2>
        <p className="hint">
          No database configured yet — set <code>DATABASE_URL</code> in your environment to use Sleeper Manager.
        </p>
      </section>
    );
  }
  // League names for the filter only; the log itself is fetched client-side through /api/manager/activity.
  const leagues = await db.league.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
  return <ActivityLog leagues={leagues} />;
}
