"use client";

// Global Cmd/Ctrl+K search — jump straight to a league or a player from
// anywhere under /manager instead of hunting through nav or scrolling a
// 200+ league list. Mounted by ManagerShell.tsx only while open (so the
// real player dump fetch behind usePlayerMap() is deferred until someone
// actually opens this, not paid on every /manager page load); the always-
// on Cmd/Ctrl+K listener that flips `open` lives in ManagerShell itself.
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { usePlayerMap } from "@/lib/usePlayerMap";
import { useLeagueFavorites } from "@/lib/leagueFavorites";
import { posChipStyle } from "@/lib/players";
import { PlayerAvatar } from "./Avatar";
import { IconSearch, IconStar } from "./MgrIcons";
import type { PlayerMapEntry } from "@/lib/types";

const OFFENSE_POS = new Set(["QB", "RB", "WR", "TE"]);
const MAX_LEAGUES = 6;
const MAX_PLAYERS = 6;

export default function CommandPalette({
  leagues,
  onClose,
}: {
  leagues: { id: string; name: string }[];
  onClose: () => void;
}) {
  const router = useRouter();
  const { pmap } = usePlayerMap();
  const { favorites } = useLeagueFavorites();
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Pinned leagues shown as a quick-jump list before anything is typed —
  // the whole point of pinning a handful of leagues is reaching them
  // without having to type their name at all.
  const pinnedLeagues = useMemo(
    () => leagues.filter((lg) => favorites.has(lg.id)),
    [leagues, favorites]
  );

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const leagueResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return leagues
      .filter((lg) => lg.name.toLowerCase().includes(q))
      .sort((a, b) => Number(favorites.has(b.id)) - Number(favorites.has(a.id)))
      .slice(0, MAX_LEAGUES);
  }, [leagues, query, favorites]);

  // Same search idiom as PlayerLeagues.tsx / WaiverAssistant.tsx's
  // single-player lookup — offense-only, substring match, alphabetical.
  const playerResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!pmap || q.length < 2) return [];
    const matches: [string, PlayerMapEntry][] = [];
    for (const [id, p] of Object.entries(pmap)) {
      if (OFFENSE_POS.has(p.p) && p.n.toLowerCase().includes(q)) matches.push([id, p]);
    }
    matches.sort((a, b) => a[1].n.localeCompare(b[1].n));
    return matches.slice(0, MAX_PLAYERS);
  }, [pmap, query]);

  const total = leagueResults.length + playerResults.length;

  const goToLeague = (id: string) => {
    onClose();
    router.push(`/manager/${id}`);
  };
  const goToPlayer = (id: string) => {
    onClose();
    router.push(`/manager/player?playerId=${id}`);
  };
  const activate = (index: number) => {
    if (index < leagueResults.length) goToLeague(leagueResults[index].id);
    else if (index < total) goToPlayer(playerResults[index - leagueResults.length][0]);
  };

  const onInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, total - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (total > 0) activate(highlight);
    }
  };

  return (
    <div className="modalbg cmdpalbg" onClick={onClose}>
      <div className="cmdpal" onClick={(e) => e.stopPropagation()}>
        <div className="cmdpalsearch">
          <IconSearch width={16} height={16} style={{ color: "var(--dim)", flex: "none" }} />
          <input
            ref={inputRef}
            className="cmdpalinput"
            placeholder="Jump to a league or player…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setHighlight(0);
            }}
            onKeyDown={onInputKeyDown}
          />
          <span className="cmdpalesc">Esc</span>
        </div>
        {query.trim() === "" ? (
          pinnedLeagues.length > 0 ? (
            <div className="cmdpalresults">
              <div className="cmdpalgroup">Pinned</div>
              {pinnedLeagues.map((lg) => (
                <button key={lg.id} type="button" className="cmdpalitem" onClick={() => goToLeague(lg.id)}>
                  <IconStar width={14} height={14} fill="currentColor" style={{ color: "var(--amber)" }} />
                  <span className="tname">{lg.name}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="hint" style={{ padding: "16px 18px", margin: 0 }}>
              Search every league you manage and any real player — no need to know which page it&rsquo;s on.
            </p>
          )
        ) : total === 0 ? (
          <p className="hint" style={{ padding: "16px 18px", margin: 0 }}>No matches.</p>
        ) : (
          <div className="cmdpalresults">
            {leagueResults.length > 0 && (
              <>
                <div className="cmdpalgroup">Leagues</div>
                {leagueResults.map((lg, i) => (
                  <button
                    key={lg.id}
                    type="button"
                    className={`cmdpalitem${i === highlight ? " active" : ""}`}
                    onMouseEnter={() => setHighlight(i)}
                    onClick={() => goToLeague(lg.id)}
                  >
                    <span className="tname">{lg.name}</span>
                  </button>
                ))}
              </>
            )}
            {playerResults.length > 0 && (
              <>
                <div className="cmdpalgroup">Players</div>
                {playerResults.map(([id, p], i) => {
                  const idx = leagueResults.length + i;
                  return (
                    <button
                      key={id}
                      type="button"
                      className={`cmdpalitem${idx === highlight ? " active" : ""}`}
                      onMouseEnter={() => setHighlight(idx)}
                      onClick={() => goToPlayer(id)}
                    >
                      <PlayerAvatar playerId={id} pos={p.p} size={22} />
                      <span className="tname">{p.n}</span>
                      <span className="pos" style={posChipStyle(p.p)}>{p.p}</span>
                      <span className="portmeta">{p.t}</span>
                    </button>
                  );
                })}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
