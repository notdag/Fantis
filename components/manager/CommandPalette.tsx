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
import { openCommandCenter } from "./FloatingCommandCenter";
import { requestChatPrefill } from "./ccStore";
import type { PlayerMapEntry } from "@/lib/types";

const OFFENSE_POS = new Set(["QB", "RB", "WR", "TE"]);
const MAX_LEAGUES = 6;
const MAX_PLAYERS = 6;
const NFL_TEAMS = new Set("ARI ATL BAL BUF CAR CHI CIN CLE DAL DEN DET GB HOU IND JAX KC LAC LAR LV MIA MIN NE NO NYG NYJ PHI PIT SEA SF TB TEN WAS".split(" "));

// Actions (Command Center 2.0): jump to a tool or run a whole-portfolio step from the command bar.
type PaletteAction = { id: string; label: string; hint: string; words: string; href?: string; run?: "sync" | "chat" };
const ACTIONS: PaletteAction[] = [
  { id: "review", label: "Open Review Queue", hint: "plans waiting to send", words: "review queue proposals approve pending plans", href: "/manager/review" },
  { id: "sync", label: "Sync all leagues now", hint: "about a minute", words: "sync scan refresh all leagues update", run: "sync" },
  { id: "chat", label: "Ask the Command Center", hint: "chat", words: "ask ai chat command center assistant", run: "chat" },
  { id: "lineups", label: "Lineups & weekly planner", hint: "optimize, set weeks", words: "lineups optimize start sit weeks planner", href: "/manager/lineups" },
  { id: "spots", label: "Empty roster spots", hint: "fill open spots", words: "empty open roster spots fill add", href: "/manager/open-spots" },
  { id: "waiver", label: "Waivers & adds", hint: "claims, FAAB", words: "waiver waivers adds claims faab trending", href: "/manager/waiver" },
  { id: "inbox", label: "Trades & claims", hint: "pending offers", words: "trades trade offers claims inbox", href: "/manager/inbox" },
  { id: "teams", label: "All leagues", hint: "league manager", words: "all leagues teams league manager list", href: "/manager/teams" },
  { id: "activity", label: "Activity log", hint: "what was sent", words: "activity log history sent audit", href: "/manager/activity" },
];

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
    // An NFL team abbreviation ("BUF") lists that team's players, best Sleeper rank first.
    const team = NFL_TEAMS.has(q.toUpperCase()) ? q.toUpperCase() : null;
    for (const [id, p] of Object.entries(pmap)) {
      if (OFFENSE_POS.has(p.p) && (team ? p.t === team : p.n.toLowerCase().includes(q))) matches.push([id, p]);
    }
    if (team) matches.sort((a, b) => (a[1].rk ?? 1e9) - (b[1].rk ?? 1e9));
    else matches.sort((a, b) => a[1].n.localeCompare(b[1].n));
    return matches.slice(0, MAX_PLAYERS);
  }, [pmap, query]);

  const actionResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ACTIONS.slice(0, 4);
    const hits = ACTIONS.filter((a) => q.split(/s+/).every((w) => a.words.includes(w) || a.label.toLowerCase().includes(w)));
    // Anything typed can be handed to the chat as a question.
    const ask: PaletteAction = { id: "ask", label: `Ask the Command Center: “${query.trim()}”`, hint: "typed in, not sent", words: "", run: "chat" };
    return [...hits.slice(0, 4), ask];
  }, [query]);

  const total = actionResults.length + leagueResults.length + playerResults.length;

  const goToLeague = (id: string) => {
    onClose();
    router.push(`/manager/${id}`);
  };
  const goToPlayer = (id: string) => {
    onClose();
    router.push(`/manager/player?playerId=${id}`);
  };
  const runAction = (a: PaletteAction) => {
    onClose();
    if (a.href) router.push(a.href);
    else if (a.run === "sync") window.dispatchEvent(new Event("fantis:sync-now"));
    else if (a.run === "chat") {
      requestChatPrefill(a.id === "ask" ? query.trim() : "");
      openCommandCenter();
    }
  };
  const activate = (index: number) => {
    if (index < leagueResults.length) goToLeague(leagueResults[index].id);
    else if (index < leagueResults.length + playerResults.length) goToPlayer(playerResults[index - leagueResults.length][0]);
    else if (index < total) runAction(actionResults[index - leagueResults.length - playerResults.length]);
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

  const actionBase = leagueResults.length + playerResults.length;
  const actionsBlock = (
    <>
      <div className="cmdpalgroup">Actions</div>
      {actionResults.map((a, i) => (
        <button
          key={a.id}
          type="button"
          className={`cmdpalitem${actionBase + i === highlight ? " active" : ""}`}
          onMouseEnter={() => setHighlight(actionBase + i)}
          onClick={() => runAction(a)}
        >
          <span className="tname" style={{ flex: 1 }}>{a.label}</span>
          <span className="portmeta">{a.hint}</span>
        </button>
      ))}
    </>
  );

  return (
    <div className="modalbg cmdpalbg" onClick={onClose}>
      <div className="cmdpal" onClick={(e) => e.stopPropagation()}>
        <div className="cmdpalsearch">
          <IconSearch width={16} height={16} style={{ color: "var(--dim)", flex: "none" }} />
          <input
            ref={inputRef}
            className="cmdpalinput"
            placeholder="Jump to a league, player or team — or type an action…"
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
          <div className="cmdpalresults">
            {actionsBlock}
            {pinnedLeagues.length > 0 ? (
              <>
                <div className="cmdpalgroup">Pinned</div>
                {pinnedLeagues.map((lg) => (
                  <button key={lg.id} type="button" className="cmdpalitem" onClick={() => goToLeague(lg.id)}>
                    <IconStar width={14} height={14} fill="currentColor" style={{ color: "var(--amber)" }} />
                    <span className="tname">{lg.name}</span>
                  </button>
                ))}
              </>
            ) : (
              <p className="hint" style={{ padding: "10px 18px 14px", margin: 0 }}>
                Type a league, a player, an NFL team (e.g. BUF) or an action like &ldquo;sync&rdquo; or &ldquo;review&rdquo;.
              </p>
            )}
          </div>
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
            {actionsBlock}
          </div>
        )}
      </div>
    </div>
  );
}
