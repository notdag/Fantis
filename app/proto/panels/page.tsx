import { Onest } from "next/font/google";
import { loadProtoData } from "@/lib/protoData";
import ProtoPanels from "@/components/proto/ProtoPanels";

const onest = Onest({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-pn" });

export default async function Page() {
  return (
    <div className={onest.variable}>
      <ProtoPanels data={await loadProtoData()} />
    </div>
  );
}
