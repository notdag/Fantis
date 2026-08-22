"use client";

import { useState } from "react";
import { playerPhotoUrl } from "@/lib/sleeper";
import { posChipStyle } from "@/lib/players";

export function PlayerAvatar({ playerId, pos, size }: { playerId: string; pos?: string; size: number }) {
  const [failed, setFailed] = useState(false);
  const ring = pos ? posChipStyle(pos).color : "var(--line)";

  if (failed) {
    return (
      <span
        className="mgravatar mgravatarfallback"
        style={{ width: size, height: size, borderColor: ring, color: ring }}
      >
        {pos ? pos.slice(0, 2) : "?"}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="mgravatar"
      src={playerPhotoUrl(playerId)}
      alt=""
      style={{ width: size, height: size, borderColor: ring }}
      onError={() => setFailed(true)}
    />
  );
}
