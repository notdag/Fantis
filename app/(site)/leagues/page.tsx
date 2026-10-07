import type { Metadata } from "next";
import LeaguesView from "@/components/site/LeaguesView";

export const metadata: Metadata = {
  title: "Leagues — Fantis",
  description: "Sync your Sleeper username to see every league, roster and standing in one place.",
};

export default function Page() {
  return <LeaguesView />;
}
