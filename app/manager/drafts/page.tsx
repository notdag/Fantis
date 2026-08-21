import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { formatUpcoming } from "@/lib/manager";
import { IconCalendar, IconFlag, IconSearch } from "@/components/manager/MgrIcons";

export const metadata: Metadata = {
  title: "Fantis — Drafts",
  robots: { index: false, follow: false },
};

export default async function DraftsPage() {
  if (!process.env.DATABASE_URL) {
    return (
      <section className="sec">
        <h2>Drafts</h2>
        <p className="hint">
          No database configured yet — set <code>DATABASE_URL</code> in your environment to use
          Sleeper Manager. See <code>.env.example</code>.
        </p>
      </section>
    );
  }

  const drafts = await db.draft.findMany({
    where: { status: { not: "complete" } },
    include: { league: true },
  });

  const now = new Date();
  const dayMs = 24 * 60 * 60 * 1000;
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const today = startOfDay(now);

  const groups = {
    today: [] as typeof drafts,
    tomorrow: [] as typeof drafts,
    thisWeek: [] as typeof drafts,
    later: [] as typeof drafts,
    unscheduled: [] as typeof drafts,
  };

  for (const d of drafts) {
    if (!d.startTime) {
      groups.unscheduled.push(d);
      continue;
    }
    const diffDays = Math.round((startOfDay(d.startTime) - today) / dayMs);
    if (diffDays === 0) groups.today.push(d);
    else if (diffDays === 1) groups.tomorrow.push(d);
    else if (diffDays > 1 && diffDays < 7) groups.thisWeek.push(d);
    else groups.later.push(d);
  }

  const sections: { label: string; rows: typeof drafts }[] = [
    { label: "Today", rows: groups.today },
    { label: "Tomorrow", rows: groups.tomorrow },
    { label: "This week", rows: groups.thisWeek },
    { label: "Later", rows: groups.later },
    { label: "Unscheduled", rows: groups.unscheduled },
  ];

  return (
    <>
      <section className="sec" style={{ paddingBottom: 0 }}>
        <div className="mgrhead">
          <div className="mgraccentbar" />
          <h1>Drafts</h1>
          <p>{drafts.length} league{drafts.length === 1 ? "" : "s"} with a draft still ahead.</p>
        </div>
        {drafts.length > 0 && (
          <div className="mgrherorow">
            <div className="mgrstat">
              <div
                className="mgrstaticon"
                style={{
                  color: groups.today.length > 0 ? "var(--amber)" : "var(--muted)",
                  background: `color-mix(in srgb, ${groups.today.length > 0 ? "var(--amber)" : "var(--muted)"} 16%, transparent)`,
                }}
              >
                <IconCalendar width={17} height={17} />
              </div>
              <div className="mgrstatbody">
                <p className="mgrstatlabel">Today</p>
                <p className="mgrstatvalue" style={{ color: groups.today.length > 0 ? "var(--amber)" : undefined }}>
                  {groups.today.length}
                </p>
              </div>
            </div>
            <div className="mgrstat">
              <div
                className="mgrstaticon"
                style={{
                  color: groups.tomorrow.length + groups.thisWeek.length > 0 ? "var(--amber)" : "var(--muted)",
                  background: `color-mix(in srgb, ${groups.tomorrow.length + groups.thisWeek.length > 0 ? "var(--amber)" : "var(--muted)"} 16%, transparent)`,
                }}
              >
                <IconFlag width={17} height={17} />
              </div>
              <div className="mgrstatbody">
                <p className="mgrstatlabel">This week</p>
                <p className="mgrstatvalue">{groups.tomorrow.length + groups.thisWeek.length}</p>
              </div>
            </div>
            <div className="mgrstat">
              <div
                className="mgrstaticon"
                style={{ color: "var(--muted)", background: "color-mix(in srgb, var(--muted) 16%, transparent)" }}
              >
                <IconSearch width={17} height={17} />
              </div>
              <div className="mgrstatbody">
                <p className="mgrstatlabel">Unscheduled</p>
                <p className="mgrstatvalue">{groups.unscheduled.length}</p>
              </div>
            </div>
          </div>
        )}
      </section>

      {drafts.length === 0 ? (
        <section className="sec">
          <p className="hint">No upcoming drafts — every synced league has already drafted.</p>
        </section>
      ) : (
        sections
          .filter((s) => s.rows.length > 0)
          .map((s) => (
            <section className="sec" key={s.label}>
              <div className="sechead">
                <h2 style={{ fontSize: 18 }}>{s.label}</h2>
                <span className="rt">{s.rows.length} leagues</span>
              </div>
              <div className="mgrtable">
                {s.rows.map((d) => (
                  <Link href={`/manager/${d.leagueId}`} className="mgrrow" key={d.id}>
                    <span className="tname" style={{ flex: 1 }}>{d.league.name}</span>
                    <span className="portvalue">
                      {d.startTime ? formatUpcoming(d.startTime.toISOString()) : "no date set"}
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          ))
      )}
    </>
  );
}
