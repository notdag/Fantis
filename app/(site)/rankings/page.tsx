import type { Metadata } from "next";
import Rankings from "@/components/Rankings";

export const metadata: Metadata = {
  title: "Fantasy Football Rankings — Fantis",
  description: "Fantis tiered fantasy football rankings with live Sleeper ADP, projected points and expert comparisons.",
};

export default function Page() {
  return <Rankings />;
}
