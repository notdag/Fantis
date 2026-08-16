"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/manager", label: "Today" },
  { href: "/manager/waiver", label: "Waiver" },
  { href: "/manager/player", label: "Player search" },
  { href: "/manager/drafts", label: "Drafts" },
  { href: "/manager/commissioner", label: "Commissioner" },
  { href: "/manager/history", label: "History" },
];

export default function MgrTabs() {
  const pathname = usePathname();
  return (
    <div className="mgrtabs">
      {TABS.map((t) => {
        const active = t.href === "/manager" ? pathname === "/manager" : pathname.startsWith(t.href);
        return (
          <Link key={t.href} href={t.href} className={`mgrtab ${active ? "on" : ""}`}>
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
