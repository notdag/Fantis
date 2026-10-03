import type { Metadata } from "next";
import { TradeView } from "@/components/site/ToolViews";

export const metadata: Metadata = {
  title: "Trade Calculator — Fantis",
  description: "Fantasy football trade calculator built on real projections and market data.",
};

export default function Page() {
  return <TradeView />;
}
