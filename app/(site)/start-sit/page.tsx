import type { Metadata } from "next";
import { StartSitView } from "@/components/site/ToolViews";

export const metadata: Metadata = {
  title: "Start/Sit — Fantis",
  description: "Start/sit help for your real Sleeper lineup, using this week's projections and matchups.",
};

export default function Page() {
  return <StartSitView />;
}
