import { Manrope } from "next/font/google";
import { loadProtoData } from "@/lib/protoData";
import ProtoStatChasers from "@/components/proto/ProtoStatChasers";

const sc = Manrope({ subsets: ["latin"], weight: ["500", "600", "700", "800"], variable: "--font-sc" });

export default async function Page() {
  return (
    <div className={sc.variable}>
      <ProtoStatChasers data={await loadProtoData()} />
    </div>
  );
}
