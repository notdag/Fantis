import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { ADMIN_COOKIE, isValidToken } from "@/lib/adminAuth";

// Redesign prototypes — owner-only, same passphrase cookie as /manager (unauthed visitors are sent to /manager's sign-in).
export const metadata: Metadata = { title: "Fantis — prototypes", robots: { index: false, follow: false } };

export default async function ProtoLayout({ children }: { children: React.ReactNode }) {
  const store = await cookies();
  if (!isValidToken(store.get(ADMIN_COOKIE)?.value)) redirect("/manager");
  return <>{children}</>;
}
