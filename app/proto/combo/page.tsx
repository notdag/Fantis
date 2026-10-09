import { Manrope } from "next/font/google";
import { loadProtoData } from "@/lib/protoData";
import ProtoCombo from "@/components/proto/ProtoCombo";

const manrope = Manrope({ subsets: ["latin"], weight: ["500", "600", "700", "800"], variable: "--font-cb" });

export default async function Page() {
  return (
    <div className={manrope.variable}>
      <ProtoCombo data={await loadProtoData()} />
    </div>
  );
}
