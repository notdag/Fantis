import { Barlow_Condensed, Libre_Franklin } from "next/font/google";
import { loadProtoData } from "@/lib/protoData";
import ProtoSportsPage from "@/components/proto/ProtoSportsPage";

const franklin = Libre_Franklin({ subsets: ["latin"], weight: ["400", "600", "700", "800", "900"], variable: "--font-sp" });
const agate = Barlow_Condensed({ subsets: ["latin"], weight: ["500", "600"], variable: "--font-sp-agate" });

export default async function Page() {
  return (
    <div className={`${franklin.variable} ${agate.variable}`}>
      <ProtoSportsPage data={await loadProtoData()} />
    </div>
  );
}
