import type { Metadata } from "next";
import { PortfolioView } from "@/components/site/ToolViews";

export const metadata: Metadata = {
  title: "Portfolio — Fantis",
  description: "See all your fantasy football leagues, exposure and trades across every league.",
};

export default function Page() {
  return <PortfolioView />;
}
