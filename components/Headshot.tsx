"use client";

import { useState } from "react";
import { playerPhotoUrl } from "@/lib/sleeper";
import { posChipStyle } from "@/lib/players";

// Round player photo from Sleeper's CDN, ringed in the position colour. Falls back
// to the position label in the same ring when Sleeper has no headshot (or the id
// isn't known yet). Self-contained on purpose: the manager's PlayerAvatar styles
// live in manager.css, which the public site and /admin don't load.
export default function Headshot({ id, pos, size = 38 }: { id: string | null; pos: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const ring = posChipStyle(pos).color as string;
  const box = { width: size, height: size, borderRadius: "50%", border: `2px solid ${ring}`, flex: "none" as const };
  if (!id || failed) {
    return (
      <span
        style={{ ...box, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: Math.max(9, Math.round(size * 0.29)), fontWeight: 700, color: ring }}
      >
        {pos}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={playerPhotoUrl(id)} alt="" loading="lazy" style={{ ...box, objectFit: "cover", background: "var(--ink)" }} onError={() => setFailed(true)} />
  );
}
