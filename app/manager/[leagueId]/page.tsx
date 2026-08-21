import { redirect } from "next/navigation";

// Legacy bookmarks to the old single-page league view still work — they
// just land on the real Overview route now, part of the 8-way route split
// (overview/team/rosters/standings/transactions/draft/info/matchup).
export default async function ManagerLeaguePage({
  params,
}: {
  params: Promise<{ leagueId: string }>;
}) {
  const { leagueId } = await params;
  redirect(`/manager/${leagueId}/overview`);
}
