"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import {
  SEASONS,
  avatar,
  getLeagueDetail,
  getLeagues,
  getLeagueUsers,
  getPlayers,
  getRosters,
  getUser,
} from "@/lib/sleeper";
import type { LeagueBundle, PlayerMap, SleeperLeague, Team } from "@/lib/types";

// Every public tab is its own URL now. The league the visitor synced (username,
// leagues, the opened league, the player map) lives HERE, in a layout, which Next
// keeps mounted while you move between pages — so syncing on /leagues and then
// opening /trade still has your league, with no reload and no refetch.
export type SiteTarget = "leagues" | "rankings" | "trade" | "startsit" | "portfolio";

export const SITE_PATHS: Record<SiteTarget, string> = {
  leagues: "/leagues",
  rankings: "/rankings",
  trade: "/trade",
  startsit: "/start-sit",
  portfolio: "/portfolio",
};

const NAV: [SiteTarget, string][] = [
  ["leagues", "Leagues"],
  ["rankings", "Rankings"],
  ["trade", "Trade"],
  ["startsit", "Start/Sit"],
  ["portfolio", "Portfolio"],
];

interface SiteState {
  username: string;
  setUsername: (v: string) => void;
  season: string;
  setSeason: (v: string) => void;
  seasons: string[];
  loading: boolean;
  error: string;
  leagues: SleeperLeague[];
  sel: LeagueBundle | null;
  setSel: (v: LeagueBundle | null) => void;
  selLoading: boolean;
  myUserId: string | null;
  sync: () => Promise<void>;
  openLeague: (lg: SleeperLeague) => Promise<void>;
  go: (target: SiteTarget) => void;
}

const SiteContext = createContext<SiteState | null>(null);

export function useSite(): SiteState {
  const v = useContext(SiteContext);
  if (!v) throw new Error("useSite must be used inside <SiteShell>");
  return v;
}

function activeTab(pathname: string): SiteTarget | null {
  if (pathname === "/") return null; // the landing page
  if (pathname.startsWith("/leagues")) return "leagues";
  for (const [k, p] of Object.entries(SITE_PATHS) as [SiteTarget, string][]) {
    if (pathname === p || pathname.startsWith(p + "/")) return k;
  }
  return null;
}

export default function SiteShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const tab = activeTab(pathname);

  const [username, setUsername] = useState("");
  const [season, setSeason] = useState("2026");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [leagues, setLeagues] = useState<SleeperLeague[]>([]);
  const [players, setPlayers] = useState<PlayerMap | null>(null);
  const [sel, setSel] = useState<LeagueBundle | null>(null);
  const [selLoading, setSelLoading] = useState(false);
  const [myUserId, setMyUserId] = useState<string | null>(null);

  const go = useCallback((target: SiteTarget) => router.push(SITE_PATHS[target]), [router]);

  const sync = useCallback(async () => {
    const u = username.trim();
    if (!u) {
      setError("Enter your Sleeper username first.");
      return;
    }
    setError("");
    setLoading(true);
    setLeagues([]);
    setSel(null);
    try {
      const user = await getUser(u);
      if (!user || !user.user_id) throw new Error("not found");
      setMyUserId(user.user_id);
      let lgs = await getLeagues(user.user_id, season);
      if ((!lgs || !lgs.length) && season === "2026") {
        lgs = await getLeagues(user.user_id, "2025");
      }
      if (!lgs || !lgs.length) {
        setError(`No NFL leagues found for ${u} in ${season}. Try another season.`);
      }
      setLeagues(lgs || []);
    } catch {
      setError(`Couldn't reach Sleeper for "${u}". Check the username and try again.`);
    } finally {
      setLoading(false);
    }
  }, [username, season]);

  const openLeague = useCallback(
    async (lg: SleeperLeague) => {
      setSelLoading(true);
      setError("");
      try {
        const [rosters, users, pmap, detail] = await Promise.all([
          getRosters(lg.league_id),
          getLeagueUsers(lg.league_id),
          players ? Promise.resolve(players) : getPlayers(),
          getLeagueDetail(lg.league_id),
        ]);
        if (!players) setPlayers(pmap);
        const uById: Record<string, (typeof users)[number]> = {};
        users.forEach((x) => (uById[x.user_id] = x));
        const teams: Team[] = rosters
          .map((r) => {
            const owner = uById[r.owner_id] || ({} as (typeof users)[number]);
            const meta = owner.metadata || {};
            const s = r.settings || {};
            return {
              rid: r.roster_id,
              ownerId: r.owner_id,
              name: meta.team_name || owner.display_name || `Team ${r.roster_id}`,
              avatar: avatar(owner.avatar),
              w: s.wins || 0,
              l: s.losses || 0,
              t: s.ties || 0,
              pf: (s.fpts || 0) + (s.fpts_decimal || 0) / 100,
              pa: (s.fpts_against || 0) + (s.fpts_against_decimal || 0) / 100,
              starters: (r.starters || []).filter(Boolean),
              players: r.players || [],
            };
          })
          .sort((a, b) => b.w - a.w || b.pf - a.pf);
        setSel({
          lg,
          teams,
          pmap: players || pmap,
          rosterPositions: detail.roster_positions || [],
          scoringRec: detail.scoring_settings?.rec ?? 0,
        });
      } catch {
        setError("Couldn't load that league's rosters. Try again in a moment.");
      } finally {
        setSelLoading(false);
      }
    },
    [players]
  );

  const value = useMemo<SiteState>(
    () => ({
      username, setUsername, season, setSeason, seasons: SEASONS, loading, error, leagues,
      sel, setSel, selLoading, myUserId, sync, openLeague, go,
    }),
    [username, season, loading, error, leagues, sel, selLoading, myUserId, sync, openLeague, go]
  );

  return (
    <SiteContext.Provider value={value}>
      <div className="fantis">
        <div className="wrap">
          <nav className="nav">
            <Link className="brand" href="/" aria-label="Fantis home" style={{ textDecoration: "none", color: "inherit" }}>
              <div className="mark">F</div>
              <b>Fantis</b>
            </Link>
            <div className="tabs">
              {NAV.map(([k, label]) => (
                <Link
                  key={k}
                  href={SITE_PATHS[k]}
                  className={`tab ${tab === k ? "on" : ""}`}
                  aria-current={tab === k ? "page" : undefined}
                  style={{ textDecoration: "none" }}
                >
                  {label}
                </Link>
              ))}
            </div>
          </nav>

          {children}

          <footer className="footer">
            Fantis MVP · league data via the Sleeper public API · rankings & values
            are an editable starter set, not investment advice. Swap them for your
            own feed anytime. Not affiliated with Sleeper, ESPN, or Yahoo.
          </footer>
        </div>
      </div>
    </SiteContext.Provider>
  );
}
