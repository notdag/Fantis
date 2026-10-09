import { Geist } from "next/font/google";
import { loadProtoData } from "@/lib/protoData";
import ProtoTriage from "@/components/proto/ProtoTriage";

const geist = Geist({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-tr" });

export default async function Page() {
  return (
    <div className={geist.variable}>
      <ProtoTriage data={await loadProtoData()} />
    </div>
  );
}
