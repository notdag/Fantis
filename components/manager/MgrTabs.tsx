"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/manager", label: "Today" },
  { href: "/manager/teams", label: "My Teams" },
  { href: "/manager/waiver", label: "Waiver" },
  { href: "/manager/player", label: "Player search" },
  { href: "/manager/drafts", label: "Drafts" },
  { href: "/manager/commissioner", label: "Commissioner" },
  { href: "/manager/history", label: "History" },
];

// Every /manager/* page is a real, uncached DB round-trip (the cookie auth
// check forces the whole tree dynamic), so a tab click can take up to ~1s
// with nothing on screen changing. useLinkStatus() gives per-link pending
// feedback the moment a click registers, without touching Suspense/loading
// boundaries at all — a loading.tsx-based fix was tried first and reverted
// after it left stale fallback content stuck in the DOM even in a real
// production build; this sidesteps that whole mechanism.
function TabLabel({ label }: { label: string }) {
  const { pending } = useLinkStatus();
  return (
    <>
      {label}
      {pending && <span className="mgrtabspin" aria-hidden="true" />}
    </>
  );
}

export default function MgrTabs() {
  const pathname = usePathname();
  return (
    <div className="mgrtabs">
      {TABS.map((t) => {
        const active = t.href === "/manager" ? pathname === "/manager" : pathname.startsWith(t.href);
        return (
          <Link key={t.href} href={t.href} className={`mgrtab ${active ? "on" : ""}`}>
            <TabLabel label={t.label} />
          </Link>
        );
      })}
    </div>
  );
}
