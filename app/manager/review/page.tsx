import type { Metadata } from "next";
import ReviewQueue from "@/components/manager/ReviewQueue";
import { db } from "@/lib/db";

export const metadata: Metadata = {
  title: "Fantis — Review Queue",
  robots: { index: false, follow: false },
};

export default async function ReviewPage() {
  if (!process.env.DATABASE_URL) {
    return (
      <section className="sec">
        <h2>Review Queue</h2>
        <p className="hint">
          No database configured yet — set <code>DATABASE_URL</code> in your environment to use Sleeper Manager.
        </p>
      </section>
    );
  }
  // Counts only (pure DB read); proposals and leagues load client-side.
  const now = new Date();
  const open = { resolvedAt: null, OR: [{ snoozedUntil: null }, { snoozedUntil: { lt: now } }] };
  const [alertCount, actionRequired] = await Promise.all([
    db.alert.count({ where: open }),
    db.alert.count({ where: { ...open, severity: "action_required" } }),
  ]);
  return <ReviewQueue alertCount={alertCount} actionRequired={actionRequired} />;
}
