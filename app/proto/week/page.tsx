import { Hanken_Grotesk } from "next/font/google";
import { loadProtoData } from "@/lib/protoData";
import ProtoWeek from "@/components/proto/ProtoWeek";

const hanken = Hanken_Grotesk({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-wk" });

export default async function Page() {
  return (
    <div className={hanken.variable}>
      <ProtoWeek data={await loadProtoData()} />
    </div>
  );
}
