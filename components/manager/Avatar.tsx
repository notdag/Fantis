"use client";

import { useState } from "react";
import { avatar, playerPhotoUrl } from "@/lib/sleeper";
import { posChipStyle } from "@/lib/players";
import type { ManagedLeague } from "@/lib/manager";

// League settings is untyped JSON (see prisma/schema.prisma) — read
// defensively, same pattern used throughout the manager section.
function leagueAvatarId(settings: unknown): string | null {
  if (!settings || typeof settings !== "object") return null;
  const v = (settings as Record<string, unknown>).avatar;
  return typeof v === "string" ? v : null;
}

export function LeagueAvatar({ league, size = 24 }: { league: ManagedLeague; size?: number }) {
  const [failed, setFailed] = useState(false);
  const id = leagueAvatarId(league.settings);
  const url = avatar(id);
  if (!url || failed) {
    return (
      <span
        className="mgravatar"
        style={{
          width: size,
          height: size,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: Math.max(10, Math.round(size * 0.42)),
          fontWeight: 700,
          color: "var(--dim)",
          background: "var(--ink)",
        }}
      >
        {league.name.slice(0, 1).toUpperCase()}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="mgravatar"
      src={url}
      alt=""
      style={{ width: size, height: size }}
      onError={() => setFailed(true)}
    />
  );
}

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
