import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import Landing from "@/components/landing/Landing";

const manrope = Manrope({ subsets: ["latin"], weight: ["500", "600", "700", "800"], variable: "--font-ld" });

export const metadata: Metadata = {
  title: "Fantis — a command center for Sleeper fantasy football",
  description: "Lineups, waivers, IR and win chances across every league you manage — with the math shown, and free tier-by-tier rankings.",
};

export default function Page() {
  return (
    <div className={manrope.variable}>
      <Landing />
    </div>
  );
}
